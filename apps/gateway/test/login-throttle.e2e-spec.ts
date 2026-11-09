import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { LOGIN_THROTTLE_MESSAGE } from '../src/auth/login-throttle';
import { GatewayModule } from '../src/gateway.module';
import { applyTrustProxy } from '../src/http/trust-proxy';

/**
 * E2E: giới hạn /auth/login và /auth/register ở Gateway. Không cần service nào phía
 * trong: Auth Service trỏ tới cổng không ai nghe nên request trong ngưỡng nhận 503,
 * request vượt ngưỡng bị chặn trước (429) — không tới được Auth Service.
 *
 * Gateway bật TRUST_PROXY=loopback (giống khi đứng sau reverse proxy) nên mỗi test giả
 * một IP client riêng qua X-Forwarded-For, các bộ đếm không ảnh hưởng nhau.
 */
const ACCOUNT_LIMIT = 2; // mỗi IP + email
const IP_LIMIT = 4; // mỗi IP
process.env.AUTH_SERVICE_HOST = '127.0.0.1';
process.env.AUTH_SERVICE_PORT = '4239'; // không service nào nghe
// Ghi đè giá trị nới lỏng của setup-e2e.ts
process.env.LOGIN_THROTTLE_LIMIT = String(ACCOUNT_LIMIT);
process.env.LOGIN_THROTTLE_IP_LIMIT = String(IP_LIMIT);
process.env.LOGIN_THROTTLE_TTL_MS = '60000';

describe('Giới hạn /auth/login, /auth/register (e2e)', () => {
  let gateway: NestExpressApplication;

  const login = (ip: string, email: string) =>
    request(gateway.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'sai-mat-khau' });

  const register = (ip: string, email: string) =>
    request(gateway.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'matkhau123', displayName: 'R' });

  /** 429 đúng thông báo, có Retry-After (giây) trong khoảng TTL. */
  const expectBlocked = (res: request.Response) => {
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      statusCode: 429,
      message: LOGIN_THROTTLE_MESSAGE,
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = moduleRef.createNestApplication<NestExpressApplication>();
    applyTrustProxy(gateway, 'loopback');
    await gateway.init();
  });

  afterAll(async () => {
    await gateway?.close();
  });

  it(`login cùng IP + email: ${ACCOUNT_LIMIT} lần tới Auth Service, lần sau -> 429`, async () => {
    for (let i = 0; i < ACCOUNT_LIMIT; i++) {
      const res = await login('10.0.0.1', 'nan-nhan@test.com');
      expect(res.status).toBe(503); // tới được Auth Service (đang tắt)
      expect(res.headers['x-ratelimit-remaining']).toBe(
        String(ACCOUNT_LIMIT - i - 1),
      );
    }
    expectBlocked(await login('10.0.0.1', 'nan-nhan@test.com'));
    // Email viết hoa / khoảng trắng vẫn là cùng tài khoản
    expectBlocked(await login('10.0.0.1', '  NAN-NHAN@test.com '));
  });

  it('tài khoản khác cùng IP (văn phòng chung IP) không bị chặn theo', async () => {
    expect((await login('10.0.0.1', 'dong-nghiep@test.com')).status).toBe(503);
  });

  it('cùng tài khoản từ IP khác không bị chặn theo', async () => {
    expect((await login('10.0.0.2', 'nan-nhan@test.com')).status).toBe(503);
  });

  it(`một IP dò nhiều tài khoản: quá ${IP_LIMIT} lần -> 429 (giới hạn theo IP)`, async () => {
    for (let i = 0; i < IP_LIMIT; i++) {
      expect((await login('10.0.0.3', `acc${i}@test.com`)).status).toBe(503);
    }
    expectBlocked(await login('10.0.0.3', 'acc-moi@test.com'));
  });

  it(`register: chỉ giới hạn theo IP, quá ${IP_LIMIT} lần -> 429`, async () => {
    for (let i = 0; i < IP_LIMIT; i++) {
      // Cùng một email nhiều lần: không bị giới hạn theo IP + email
      expect((await register('10.0.0.4', 'trung@test.com')).status).toBe(503);
    }
    expectBlocked(await register('10.0.0.4', 'khac@test.com'));
    // IP khác vẫn đăng ký được
    expect((await register('10.0.0.5', 'khac@test.com')).status).toBe(503);
  });

  it('route khác không bị giới hạn (refresh, route cần token)', async () => {
    for (let i = 0; i < IP_LIMIT + 2; i++) {
      await request(gateway.getHttpServer())
        .post('/auth/refresh')
        .set('X-Forwarded-For', '10.0.0.6')
        .send({ refreshToken: 'x' })
        .expect(503); // tới được Auth Service (đang tắt), không bị 429
      await request(gateway.getHttpServer())
        .get('/auth/me')
        .set('X-Forwarded-For', '10.0.0.6')
        .expect(401);
    }
  });
});
