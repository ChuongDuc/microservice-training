import { createRpcValidationPipe } from '@app/common';
import { INestApplication, INestMicroservice } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import * as request from 'supertest';
import { AuthServiceModule } from '../../auth-service/src/auth-service.module';
import { PrismaService as AuthPrismaService } from '../../auth-service/src/prisma/prisma.service';
import { RedisService } from '../../auth-service/src/redis/redis.service';
import { PrismaService as UserPrismaService } from '../../user-service/src/prisma/prisma.service';
import { UserServiceModule } from '../../user-service/src/user-service.module';
import { GatewayModule } from '../src/gateway.module';

/**
 * E2E: bật User Service + Auth Service thật (TCP) và Gateway (HTTP), gọi REST
 * `/auth/*` bằng supertest để kiểm tra Gateway forward xuống Auth qua TCP và trả
 * đúng HTTP status. Cần Postgres (đã migrate user_db + auth_db) và Redis đang chạy.
 */
const AUTH_PORT = 4201; // cổng riêng cho test, tránh đụng service đang chạy
const USER_PORT = 4202;
const UNUSED_PORT = 4209; // không service nào nghe, dùng cho test 503
const EMAIL_PREFIX = 'e2e-gateway-';

// Gateway và Auth Service đọc địa chỉ service từ env (ConfigModule không ghi đè biến đã có)
process.env.AUTH_SERVICE_HOST = '127.0.0.1';
process.env.AUTH_SERVICE_PORT = String(AUTH_PORT);
process.env.USER_SERVICE_HOST = '127.0.0.1';
process.env.USER_SERVICE_PORT = String(USER_PORT);

describe('Gateway /auth/* (e2e)', () => {
  let userApp: INestMicroservice;
  let authApp: INestMicroservice;
  let gateway: INestApplication;
  let userDb: UserPrismaService;
  let authDb: AuthPrismaService;
  let redis: RedisService;
  /** Refresh token tạo trong test, xoá khỏi Redis khi dọn dẹp. */
  const issuedTokens: string[] = [];
  const refreshKey = (token: string) =>
    'refresh_token:' + createHash('sha256').update(token).digest('hex');

  const email = (name: string) => `${EMAIL_PREFIX}${name}@test.com`;
  const password = 'matkhau123';
  const post = (path: string, body: object) =>
    request(gateway.getHttpServer()).post(path).send(body);

  /** Đăng ký + đăng nhập, trả về cặp token. */
  const registerAndLogin = async (name: string) => {
    await post('/auth/register', {
      email: email(name),
      password,
      displayName: name,
    }).expect(201);
    const { body } = await post('/auth/login', {
      email: email(name),
      password,
    }).expect(200);
    issuedTokens.push(body.refreshToken);
    return body as { accessToken: string; refreshToken: string };
  };

  const startMicroservice = async (module: unknown, port: number) => {
    const moduleRef = await Test.createTestingModule({
      imports: [module as never],
    }).compile();
    const app = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port },
    });
    app.useGlobalPipes(createRpcValidationPipe());
    await app.listen();
    return app;
  };

  const cleanup = async () => {
    const where = { email: { startsWith: EMAIL_PREFIX } };
    if (issuedTokens.length) await redis?.del(...issuedTokens.map(refreshKey));
    await authDb?.credential.deleteMany({ where });
    await userDb?.user.deleteMany({ where });
  };

  beforeAll(async () => {
    userApp = await startMicroservice(UserServiceModule, USER_PORT);
    authApp = await startMicroservice(AuthServiceModule, AUTH_PORT);
    userDb = userApp.get(UserPrismaService);
    authDb = authApp.get(AuthPrismaService);
    redis = authApp.get(RedisService);
    await cleanup();

    const moduleRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = moduleRef.createNestApplication();
    await gateway.init();
  });

  afterAll(async () => {
    await cleanup();
    await gateway?.close();
    await authApp?.close();
    await userApp?.close();
  });

  describe('POST /auth/register', () => {
    it('201 + hồ sơ user, không trả password', async () => {
      const { body } = await post('/auth/register', {
        email: email('register'),
        password,
        displayName: 'An',
      }).expect(201);

      expect(body).toMatchObject({
        id: expect.any(String),
        email: email('register'),
        displayName: 'An',
        role: 'USER',
      });
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('passwordHash');
    });

    it('trùng email -> 409', async () => {
      const { body } = await post('/auth/register', {
        email: email('register'),
        password,
        displayName: 'An',
      }).expect(409);

      expect(body).toEqual({
        statusCode: 409,
        message: `Email ${email('register')} đã được đăng ký`,
      });
    });

    it('body sai -> 400 kèm chi tiết field từ Auth Service', async () => {
      const { body } = await post('/auth/register', {
        email: 'khong-phai-email',
        password: 'ngan',
        displayName: 'An',
      }).expect(400);

      expect(body.message).toBe('Validation failed');
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    });
  });

  describe('POST /auth/login', () => {
    it('200 + access token + refresh token', async () => {
      const tokens = await registerAndLogin('login');

      expect(tokens).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
    });

    it('sai mật khẩu -> 401', async () => {
      await post('/auth/login', {
        email: email('login'),
        password: 'sai-mat-khau',
      }).expect(401);
    });
  });

  describe('POST /auth/refresh + /auth/logout', () => {
    it('refresh -> 200 + cặp token mới, token cũ không dùng lại được (401)', async () => {
      const { refreshToken } = await registerAndLogin('refresh');

      const { body } = await post('/auth/refresh', { refreshToken }).expect(
        200,
      );
      issuedTokens.push(body.refreshToken);
      expect(body.refreshToken).not.toBe(refreshToken);

      await post('/auth/refresh', { refreshToken }).expect(401);
    });

    it('logout -> 200, sau đó refresh bằng token đó -> 401', async () => {
      const { refreshToken } = await registerAndLogin('logout');

      await post('/auth/logout', { refreshToken })
        .expect(200)
        .expect({ success: true });
      await post('/auth/refresh', { refreshToken }).expect(401);
    });

    it('refresh token không phải JWT -> 400', async () => {
      await post('/auth/refresh', { refreshToken: 'abc' }).expect(400);
    });
  });

  describe('GET /auth/me (JwtAuthGuard)', () => {
    const me = (authorization?: string) => {
      const req = request(gateway.getHttpServer()).get('/auth/me');
      return authorization ? req.set('Authorization', authorization) : req;
    };

    it('access token hợp lệ -> 200 + userId/role của người gọi', async () => {
      const { accessToken } = await registerAndLogin('me');
      const user = await userDb.user.findUniqueOrThrow({
        where: { email: email('me') },
      });

      await me(`Bearer ${accessToken}`)
        .expect(200)
        .expect({ userId: user.id, role: 'USER' });
    });

    it('role đổi bên User Service -> đăng nhập lại, token mang role mới (ADMIN)', async () => {
      await registerAndLogin('me-admin');
      const user = await userDb.user.update({
        where: { email: email('me-admin') },
        data: { role: 'ADMIN' },
      });
      const { body } = await post('/auth/login', {
        email: email('me-admin'),
        password,
      }).expect(200);
      issuedTokens.push(body.refreshToken);

      await me(`Bearer ${body.accessToken}`)
        .expect(200)
        .expect({ userId: user.id, role: 'ADMIN' });
    });

    it('thiếu token -> 401 + WWW-Authenticate: Bearer', async () => {
      const { body } = await me()
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer');
      expect(body).toEqual({ statusCode: 401, message: 'Thiếu access token' });
    });

    it('header sai định dạng -> 401 invalid_request', async () => {
      await me('Basic YTpi')
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer error="invalid_request"');
    });

    it('token sai -> 401 invalid_token', async () => {
      await me('Bearer abc.def.ghi')
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer error="invalid_token"');
    });

    it('dùng refresh token thay access token -> 401', async () => {
      const { refreshToken } = await registerAndLogin('me-refresh');
      await me(`Bearer ${refreshToken}`).expect(401);
    });

    it('route @Public() không cần token (login vẫn 401 do sai mật khẩu, không phải do guard)', async () => {
      const { body, headers } = await post('/auth/login', {
        email: email('me'),
        password: 'sai-mat-khau',
      }).expect(401);
      expect(body.message).toBe('Email hoặc mật khẩu không đúng');
      expect(headers['www-authenticate']).toBeUndefined();
    });
  });

  describe('Auth Service không khả dụng', () => {
    it('-> 503', async () => {
      // Gateway riêng trỏ tới cổng không có service nào (không tắt authApp: các
      // kết nối TCP đang mở vẫn được phục vụ sau khi server close)
      process.env.AUTH_SERVICE_PORT = String(UNUSED_PORT);
      const moduleRef = await Test.createTestingModule({
        imports: [GatewayModule],
      }).compile();
      const downGateway = moduleRef.createNestApplication();
      await downGateway.init();
      process.env.AUTH_SERVICE_PORT = String(AUTH_PORT);

      try {
        const { body } = await request(downGateway.getHttpServer())
          .post('/auth/login')
          .send({ email: email('login'), password })
          .expect(503);
        expect(body).toEqual({
          statusCode: 503,
          message: 'Auth Service không khả dụng',
        });
      } finally {
        await downGateway.close();
      }
    });
  });
});
