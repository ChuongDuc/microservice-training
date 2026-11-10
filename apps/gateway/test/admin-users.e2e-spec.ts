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
 * E2E: `/admin/users` qua Gateway với User + Auth Service thật (TCP). Token lấy qua
 * đăng nhập thật để kiểm tra cả vòng: đổi role / khoá ở User Service -> lần đăng nhập
 * hoặc refresh sau phản ánh đúng. Cần Postgres (user_db + auth_db) và Redis.
 */
const AUTH_PORT = 4221; // cổng riêng, không trùng auth.e2e-spec (4201/4202)
const USER_PORT = 4222;
const EMAIL_PREFIX = 'e2e-admin-';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

process.env.AUTH_SERVICE_HOST = '127.0.0.1';
process.env.AUTH_SERVICE_PORT = String(AUTH_PORT);
process.env.USER_SERVICE_HOST = '127.0.0.1';
process.env.USER_SERVICE_PORT = String(USER_PORT);

type Tokens = { accessToken: string; refreshToken: string };

describe('Gateway /admin/users (e2e)', () => {
  let userApp: INestMicroservice;
  let authApp: INestMicroservice;
  let gateway: INestApplication;
  let userDb: UserPrismaService;
  let authDb: AuthPrismaService;
  let redis: RedisService;
  const issuedTokens: string[] = [];
  const refreshKey = (token: string) =>
    'refresh_token:' + createHash('sha256').update(token).digest('hex');

  // Tag riêng cho lần chạy: tìm kiếm chỉ khớp user tạo trong test này
  const tag = `t${Date.now()}`;
  const email = (name: string) => `${EMAIL_PREFIX}${name}-${tag}@test.com`;
  const password = 'matkhau123';
  const http = () => request(gateway.getHttpServer());

  const login = async (name: string, expected = 200) => {
    const res = await http()
      .post('/auth/login')
      .send({ email: email(name), password })
      .expect(expected);
    if (res.body.refreshToken) issuedTokens.push(res.body.refreshToken);
    return res.body as Tokens;
  };

  /** Đăng ký + đăng nhập, trả về id user và cặp token. */
  const register = async (name: string) => {
    const { body } = await http()
      .post('/auth/register')
      .send({ email: email(name), password, displayName: `${name} ${tag}` })
      .expect(201);
    return { id: body.id as string, ...(await login(name)) };
  };

  const as = (token: string) => ({
    get: (path: string) =>
      http().get(path).set('Authorization', `Bearer ${token}`),
    patch: (path: string) =>
      http().patch(path).set('Authorization', `Bearer ${token}`),
  });

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

  let admin: { id: string } & Tokens;
  let member: { id: string } & Tokens;

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

    // ADMIN đầu tiên phải tạo trực tiếp trong DB (chưa có admin nào để cấp quyền)
    const created = await register('admin');
    await userDb.user.update({
      where: { id: created.id },
      data: { role: 'ADMIN' },
    });
    admin = { id: created.id, ...(await login('admin')) };
    member = await register('member');
  });

  afterAll(async () => {
    await cleanup();
    await gateway?.close();
    await authApp?.close();
    await userApp?.close();
  });

  describe('Phân quyền', () => {
    it('USER -> 403 với mọi route /admin/users, DB không đổi', async () => {
      const user = as(member.accessToken);
      await user.get('/admin/users').expect(403);
      await user
        .patch(`/admin/users/${admin.id}/role`)
        .send({ role: 'USER' })
        .expect(403);
      await user
        .patch(`/admin/users/${admin.id}/status`)
        .send({ status: 'BLOCKED' })
        .expect(403);
      await expect(
        userDb.user.findUnique({ where: { id: admin.id } }),
      ).resolves.toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    });

    it('thiếu token -> 401', async () => {
      await http().get('/admin/users').expect(401);
    });
  });

  describe('GET /admin/users', () => {
    it('phân trang + tìm theo email/tên (không phân biệt hoa thường)', async () => {
      const { body } = await as(admin.accessToken)
        .get('/admin/users')
        .query({ search: tag.toUpperCase(), limit: '1', page: '2' })
        .expect(200);
      expect(body).toMatchObject({
        total: 2,
        page: 2,
        limit: 1,
        totalPages: 2,
      });
      expect(body.items).toHaveLength(1);

      const byEmail = await as(admin.accessToken)
        .get('/admin/users')
        .query({ search: `member-${tag}` })
        .expect(200);
      expect(byEmail.body.items).toEqual([
        expect.objectContaining({ id: member.id, role: 'USER' }),
      ]);
    });

    it('lọc theo role', async () => {
      const { body } = await as(admin.accessToken)
        .get('/admin/users')
        .query({ search: tag, role: 'ADMIN' })
        .expect(200);
      expect(body.items).toEqual([expect.objectContaining({ id: admin.id })]);
    });

    it('query sai (role/status lạ, limit > 100, field lạ) -> 400', async () => {
      const adminApi = as(admin.accessToken);
      await adminApi.get('/admin/users?role=ROOT').expect(400);
      await adminApi.get('/admin/users?status=LOCKED').expect(400);
      await adminApi.get('/admin/users?limit=101').expect(400);
      await adminApi.get('/admin/users?email=x').expect(400);
    });
  });

  describe('PATCH /admin/users/:id/role', () => {
    it('đổi role -> 200; token cũ giữ role cũ, đăng nhập lại mang role mới', async () => {
      const { body } = await as(admin.accessToken)
        .patch(`/admin/users/${member.id}/role`)
        .send({ role: 'ADMIN' })
        .expect(200);
      expect(body).toMatchObject({ id: member.id, role: 'ADMIN' });

      // Access token cũ vẫn mang role USER tới khi hết hạn (role đọc từ token)
      await as(member.accessToken).get('/admin/users').expect(403);
      const fresh = await login('member');
      await as(fresh.accessToken).get('/admin/users').expect(200);

      // Trả lại USER cho các test sau
      await as(admin.accessToken)
        .patch(`/admin/users/${member.id}/role`)
        .send({ role: 'USER' })
        .expect(200);
    });

    it('tự đổi role của chính mình -> 400', async () => {
      const { body } = await as(admin.accessToken)
        .patch(`/admin/users/${admin.id}/role`)
        .send({ role: 'USER' })
        .expect(400);
      expect(body.message).toBe('Không thể tự đổi role của chính mình');
    });

    it('role sai / id sai / user không tồn tại -> 400 / 400 / 404', async () => {
      const adminApi = as(admin.accessToken);
      await adminApi
        .patch(`/admin/users/${member.id}/role`)
        .send({ role: 'ROOT' })
        .expect(400);
      await adminApi
        .patch('/admin/users/abc/role')
        .send({ role: 'USER' })
        .expect(400);
      await adminApi
        .patch(`/admin/users/${MISSING_ID}/role`)
        .send({ role: 'USER' })
        .expect(404);
    });

    it('`id` trong body -> 400, không đổi được user khác', async () => {
      const { body } = await as(admin.accessToken)
        .patch(`/admin/users/${member.id}/role`)
        .send({ role: 'USER', id: admin.id })
        .expect(400);
      expect(body.errors).toEqual([expect.objectContaining({ field: 'id' })]);
      await expect(
        userDb.user.findUnique({ where: { id: admin.id } }),
      ).resolves.toMatchObject({ role: 'ADMIN' });
    });
  });

  describe('PATCH /admin/users/:id/status', () => {
    it('khoá -> không đăng nhập / refresh được nữa (403); mở khoá -> đăng nhập lại được', async () => {
      const before = await login('member');

      const { body } = await as(admin.accessToken)
        .patch(`/admin/users/${member.id}/status`)
        .send({ status: 'BLOCKED' })
        .expect(200);
      expect(body).toMatchObject({ id: member.id, status: 'BLOCKED' });

      await login('member', 403);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: before.refreshToken })
        .expect(403);

      await as(admin.accessToken)
        .patch(`/admin/users/${member.id}/status`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      await login('member');
    });

    it('tự khoá chính mình -> 400; status sai -> 400', async () => {
      await as(admin.accessToken)
        .patch(`/admin/users/${admin.id}/status`)
        .send({ status: 'BLOCKED' })
        .expect(400);
      await as(admin.accessToken)
        .patch(`/admin/users/${member.id}/status`)
        .send({ status: 'LOCKED' })
        .expect(400);
    });
  });
});
