import { AUTH_PATTERNS, createRpcValidationPipe } from '@app/common';
import { INestMicroservice } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { firstValueFrom } from 'rxjs';
import { PrismaService as UserPrismaService } from '../../user-service/src/prisma/prisma.service';
import { UserServiceModule } from '../../user-service/src/user-service.module';
import { AuthServiceModule } from '../src/auth-service.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E: khởi động User Service + Auth Service thật (TCP), gửi `auth.register` giống cách
 * Gateway sẽ gọi, rồi kiểm tra dữ liệu ở CẢ HAI database.
 * Cần Postgres đang chạy và đã migrate user_db + auth_db.
 */
const AUTH_PORT = 4101; // cổng riêng cho test, tránh đụng service đang chạy
const USER_PORT = 4102;
const EMAIL_PREFIX = 'e2e-auth-';

// Auth Service đọc cổng User Service từ env (ConfigModule không ghi đè biến đã có)
process.env.USER_SERVICE_HOST = '127.0.0.1';
process.env.USER_SERVICE_PORT = String(USER_PORT);

describe('Auth Service (e2e qua TCP)', () => {
  let userApp: INestMicroservice;
  let authApp: INestMicroservice;
  let client: ClientProxy;
  let authDb: PrismaService;
  let userDb: UserPrismaService;

  const send = <T = any>(pattern: string, payload: unknown) =>
    firstValueFrom(client.send<T>(pattern, payload));

  const sendError = async (pattern: string, payload: unknown) => {
    try {
      await send(pattern, payload);
    } catch (error) {
      return error;
    }
    throw new Error(`Expected ${pattern} to fail`);
  };

  const email = (name: string) => `${EMAIL_PREFIX}${name}@test.com`;

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
    await authDb?.credential.deleteMany({ where });
    await userDb?.user.deleteMany({ where });
  };

  beforeAll(async () => {
    userApp = await startMicroservice(UserServiceModule, USER_PORT);
    authApp = await startMicroservice(AuthServiceModule, AUTH_PORT);
    userDb = userApp.get(UserPrismaService);
    authDb = authApp.get(PrismaService);
    await cleanup();

    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: AUTH_PORT },
    });
    await client.connect();
  });

  afterAll(async () => {
    await cleanup();
    await client?.close();
    await authApp?.close();
    await userApp?.close();
  });

  describe(AUTH_PATTERNS.REGISTER, () => {
    const payload = {
      email: email('register'),
      password: 'matkhau123',
      displayName: 'An',
    };

    it('tạo user (user_db) + credential (auth_db), không trả password', async () => {
      const user = await send(AUTH_PATTERNS.REGISTER, payload);
      expect(user).toMatchObject({
        id: expect.any(String),
        email: payload.email,
        displayName: 'An',
        role: 'USER',
      });
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('passwordHash');

      await expect(
        userDb.user.findUnique({ where: { id: user.id } }),
      ).resolves.toMatchObject({ email: payload.email });

      const credential = await authDb.credential.findUnique({
        where: { userId: user.id },
      });
      expect(credential).toMatchObject({ email: payload.email });
      await expect(
        argon2.verify(credential!.passwordHash, payload.password),
      ).resolves.toBe(true);
    });

    it('đăng ký lại cùng email -> 409', async () => {
      await expect(
        sendError(AUTH_PATTERNS.REGISTER, payload),
      ).resolves.toMatchObject({ statusCode: 409 });
    });

    it('cùng email nhưng khác hoa/thường -> 409', async () => {
      await expect(
        sendError(AUTH_PATTERNS.REGISTER, {
          ...payload,
          email: payload.email.toUpperCase(),
        }),
      ).resolves.toMatchObject({ statusCode: 409 });
    });

    it('email đã có hồ sơ bên User Service -> 409, không tạo credential', async () => {
      await userDb.user.create({
        data: { email: email('profile-only'), displayName: 'Bình' },
      });

      await expect(
        sendError(AUTH_PATTERNS.REGISTER, {
          ...payload,
          email: email('profile-only'),
        }),
      ).resolves.toMatchObject({ statusCode: 409 });
      await expect(
        authDb.credential.findUnique({
          where: { email: email('profile-only') },
        }),
      ).resolves.toBeNull();
    });

    it('payload sai -> 400 kèm chi tiết field', async () => {
      const error = await sendError(AUTH_PATTERNS.REGISTER, {
        email: 'abc',
        password: '123',
        displayName: 'An',
      });
      expect(error).toMatchObject({ statusCode: 400 });
      expect(error.errors.map((e: { field: string }) => e.field)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    });
  });
});
