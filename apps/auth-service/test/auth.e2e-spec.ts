import { AUTH_PATTERNS, createRpcValidationPipe } from '@app/common';
import { INestMicroservice } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService as UserPrismaService } from '../../user-service/src/prisma/prisma.service';
import { UserServiceModule } from '../../user-service/src/user-service.module';
import { AuthServiceModule } from '../src/auth-service.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

/**
 * E2E: khởi động User Service + Auth Service thật (TCP), gửi `auth.*` giống cách
 * Gateway sẽ gọi, rồi kiểm tra dữ liệu ở CẢ HAI database.
 * Cần Postgres (đã migrate user_db + auth_db) và Redis đang chạy.
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
  let redis: RedisService;
  /** Refresh token tạo trong test, xoá khỏi Redis khi dọn dẹp. */
  const issuedTokens: string[] = [];
  const refreshKey = (token: string) =>
    'refresh_token:' + createHash('sha256').update(token).digest('hex');
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
    if (issuedTokens.length) await redis?.del(...issuedTokens.map(refreshKey));
    await authDb?.credential.deleteMany({ where });
    await userDb?.user.deleteMany({ where });
  };

  beforeAll(async () => {
    userApp = await startMicroservice(UserServiceModule, USER_PORT);
    authApp = await startMicroservice(AuthServiceModule, AUTH_PORT);
    userDb = userApp.get(UserPrismaService);
    authDb = authApp.get(PrismaService);
    redis = authApp.get(RedisService);
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

  describe(AUTH_PATTERNS.LOGIN, () => {
    const jwt = new JwtService();
    const payload = {
      email: email('login'),
      password: 'matkhau123',
      displayName: 'Cường',
    };
    let userId: string;

    beforeAll(async () => {
      ({ id: userId } = await send(AUTH_PATTERNS.REGISTER, payload));
    });

    it('đúng mật khẩu -> access token (userId + role) + refresh token đã lưu hash', async () => {
      const tokens = await send(AUTH_PATTERNS.LOGIN, {
        email: payload.email.toUpperCase(), // email được chuẩn hoá như lúc đăng ký
        password: payload.password,
      });
      issuedTokens.push(tokens.refreshToken);

      const access = await jwt.verifyAsync(tokens.accessToken, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      expect(access).toMatchObject({ sub: userId, role: 'USER' });
      await expect(
        jwt.verifyAsync(tokens.refreshToken, {
          secret: process.env.JWT_REFRESH_SECRET,
        }),
      ).resolves.toMatchObject({ sub: userId });

      // Redis lưu hash -> userId, hết hạn đúng lúc JWT hết hạn
      const key = refreshKey(tokens.refreshToken);
      await expect(redis.get(key)).resolves.toBe(userId);
      await expect(redis.expiretime(key)).resolves.toBe(
        jwt.decode(tokens.refreshToken).exp,
      );
    });

    it('role trong token lấy từ User Service (đổi sang ADMIN)', async () => {
      await userDb.user.update({
        where: { id: userId },
        data: { role: 'ADMIN' },
      });

      const { accessToken, refreshToken } = await send(AUTH_PATTERNS.LOGIN, {
        email: payload.email,
        password: payload.password,
      });
      issuedTokens.push(refreshToken);
      expect(jwt.decode(accessToken)).toMatchObject({ role: 'ADMIN' });
    });

    it('sai mật khẩu -> 401', async () => {
      await expect(
        sendError(AUTH_PATTERNS.LOGIN, {
          email: payload.email,
          password: 'saimatkhau',
        }),
      ).resolves.toMatchObject({ statusCode: 401 });
    });

    it('email chưa đăng ký -> 401', async () => {
      await expect(
        sendError(AUTH_PATTERNS.LOGIN, {
          email: email('khong-ton-tai'),
          password: payload.password,
        }),
      ).resolves.toMatchObject({ statusCode: 401 });
    });

    it('tài khoản bị khoá -> 403', async () => {
      await userDb.user.update({
        where: { id: userId },
        data: { status: 'BLOCKED' },
      });

      await expect(
        sendError(AUTH_PATTERNS.LOGIN, {
          email: payload.email,
          password: payload.password,
        }),
      ).resolves.toMatchObject({ statusCode: 403 });
    });
  });

  describe(`${AUTH_PATTERNS.REFRESH} + ${AUTH_PATTERNS.LOGOUT}`, () => {
    const jwt = new JwtService();
    const credentials = { email: email('refresh'), password: 'matkhau123' };

    const login = async () => {
      const tokens = await send(AUTH_PATTERNS.LOGIN, credentials);
      issuedTokens.push(tokens.refreshToken);
      return tokens;
    };

    const refresh = async (refreshToken: string) => {
      const tokens = await send(AUTH_PATTERNS.REFRESH, { refreshToken });
      issuedTokens.push(tokens.refreshToken);
      return tokens;
    };

    beforeAll(async () => {
      await send(AUTH_PATTERNS.REGISTER, {
        ...credentials,
        displayName: 'Dũng',
      });
    });

    it('refresh -> cặp token mới hợp lệ, token cũ bị xoá khỏi Redis', async () => {
      const old = await login();
      const tokens = await refresh(old.refreshToken);

      expect(tokens.refreshToken).not.toBe(old.refreshToken);
      await expect(
        jwt.verifyAsync(tokens.accessToken, {
          secret: process.env.JWT_ACCESS_SECRET,
        }),
      ).resolves.toMatchObject({ role: 'USER' });
      await expect(redis.exists(refreshKey(old.refreshToken))).resolves.toBe(0);
      await expect(redis.exists(refreshKey(tokens.refreshToken))).resolves.toBe(
        1,
      );
    });

    it('dùng lại refresh token cũ sau khi đã refresh -> 401', async () => {
      const old = await login();
      await refresh(old.refreshToken);

      await expect(
        sendError(AUTH_PATTERNS.REFRESH, { refreshToken: old.refreshToken }),
      ).resolves.toMatchObject({ statusCode: 401 });
    });

    it('2 request refresh cùng lúc bằng 1 token -> chỉ 1 request thành công', async () => {
      const { refreshToken } = await login();

      const results = await Promise.allSettled([
        refresh(refreshToken),
        refresh(refreshToken),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
    });

    it('logout -> refresh token không dùng được nữa', async () => {
      const { refreshToken } = await login();

      await expect(
        send(AUTH_PATTERNS.LOGOUT, { refreshToken }),
      ).resolves.toEqual({ success: true });
      await expect(
        sendError(AUTH_PATTERNS.REFRESH, { refreshToken }),
      ).resolves.toMatchObject({ statusCode: 401 });
    });

    it('logout chỉ thu hồi token của phiên đó, phiên khác vẫn refresh được', async () => {
      const sessionA = await login();
      const sessionB = await login();

      await send(AUTH_PATTERNS.LOGOUT, { refreshToken: sessionA.refreshToken });
      await expect(refresh(sessionB.refreshToken)).resolves.toHaveProperty(
        'accessToken',
      );
    });

    it('logout 2 lần -> vẫn thành công', async () => {
      const { refreshToken } = await login();
      await send(AUTH_PATTERNS.LOGOUT, { refreshToken });

      await expect(
        send(AUTH_PATTERNS.LOGOUT, { refreshToken }),
      ).resolves.toEqual({ success: true });
    });

    it('refresh token giả mạo -> 401', async () => {
      const forged = await jwt.signAsync(
        { sub: 'x' },
        { secret: 'secret-gia', expiresIn: '7d' },
      );

      await expect(
        sendError(AUTH_PATTERNS.REFRESH, { refreshToken: forged }),
      ).resolves.toMatchObject({ statusCode: 401 });
    });

    it('payload không phải JWT -> 400', async () => {
      await expect(
        sendError(AUTH_PATTERNS.REFRESH, { refreshToken: 'abc' }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });
});
