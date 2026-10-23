import { USER_PATTERNS, USER_SERVICE } from '@app/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { NEVER, of, throwError } from 'rxjs';
import { Prisma } from '../generated/prisma';
import { AuthServiceService } from './auth-service.service';
import { PrismaService } from './prisma/prisma.service';

/** Lấy object lỗi bên trong RpcException để kiểm tra statusCode. */
const rpcError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(RpcException);
    return (e as RpcException).getError();
  }
  throw new Error('Expected RpcException');
};

describe('AuthServiceService', () => {
  let service: AuthServiceService;
  const prisma = {
    credential: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn() },
  };
  const env: Record<string, string> = {
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  };
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
    getOrThrow: (key: string) => env[key],
  };
  const jwt = new JwtService();
  const userClient = { send: jest.fn() };
  const dto = { email: 'a@b.com', password: 'matkhau123', displayName: 'An' };
  const user = {
    id: 'uuid',
    email: dto.email,
    displayName: 'An',
    role: 'USER',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
    const module = await Test.createTestingModule({
      providers: [
        AuthServiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: USER_SERVICE, useValue: userClient },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(AuthServiceService);
    prisma.credential.findUnique.mockResolvedValue(null);
  });

  describe('register', () => {
    it('tạo user bên User Service rồi lưu credential với password đã hash', async () => {
      userClient.send.mockReturnValue(of(user));

      await expect(service.register(dto)).resolves.toEqual(user);

      expect(userClient.send).toHaveBeenCalledWith(USER_PATTERNS.CREATE, {
        email: dto.email,
        displayName: dto.displayName,
      });
      const { data } = prisma.credential.create.mock.calls[0][0];
      expect(data).toMatchObject({ userId: user.id, email: dto.email });
      expect(data.passwordHash).not.toBe(dto.password);
      await expect(
        argon2.verify(data.passwordHash, dto.password),
      ).resolves.toBe(true);
    });

    it('email đã có credential -> 409, không gọi User Service', async () => {
      prisma.credential.findUnique.mockResolvedValue({ userId: 'x' });

      await expect(rpcError(service.register(dto))).resolves.toMatchObject({
        statusCode: 409,
      });
      expect(userClient.send).not.toHaveBeenCalled();
    });

    it('chuyển tiếp lỗi nghiệp vụ từ User Service (409)', async () => {
      userClient.send.mockReturnValue(
        throwError(() => ({ statusCode: 409, message: 'Email đã tồn tại' })),
      );

      await expect(rpcError(service.register(dto))).resolves.toEqual({
        statusCode: 409,
        message: 'Email đã tồn tại',
      });
      expect(prisma.credential.create).not.toHaveBeenCalled();
    });

    it('User Service không kết nối được -> 503', async () => {
      userClient.send.mockReturnValue(
        throwError(() => new Error('connect ECONNREFUSED')),
      );

      await expect(rpcError(service.register(dto))).resolves.toMatchObject({
        statusCode: 503,
      });
    });

    it('User Service không phản hồi -> 503 (timeout)', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      userClient.send.mockReturnValue(NEVER);

      const result = rpcError(service.register(dto));
      // Đợi hash xong và request đã được gửi rồi mới tua thời gian
      while (!userClient.send.mock.calls.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      await jest.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({ statusCode: 503 });
    });

    it('lưu credential bị trùng email (P2002) -> 409', async () => {
      userClient.send.mockReturnValue(of(user));
      prisma.credential.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('error', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(rpcError(service.register(dto))).resolves.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe('login', () => {
    const loginDto = { email: dto.email, password: dto.password };
    let passwordHash: string;

    beforeAll(async () => {
      passwordHash = await argon2.hash(dto.password);
    });

    beforeEach(() => {
      prisma.credential.findUnique.mockResolvedValue({
        userId: user.id,
        email: dto.email,
        passwordHash,
      });
      userClient.send.mockReturnValue(of(user));
    });

    it('đúng mật khẩu -> cặp token, access token chứa userId + role', async () => {
      const tokens = await service.login(loginDto);

      const access = await jwt.verifyAsync(tokens.accessToken, {
        secret: 'access-secret',
      });
      expect(access).toMatchObject({ sub: user.id, role: 'USER' });
      // access token hết hạn sau 15 phút, refresh token sau 7 ngày
      expect(access.exp - access.iat).toBe(15 * 60);

      const refresh = await jwt.verifyAsync(tokens.refreshToken, {
        secret: 'refresh-secret',
      });
      expect(refresh).toMatchObject({ sub: user.id, jti: expect.any(String) });
      expect(refresh.exp - refresh.iat).toBe(7 * 24 * 60 * 60);

      expect(userClient.send).toHaveBeenCalledWith(USER_PATTERNS.FIND_BY_ID, {
        id: user.id,
      });
    });

    it('lưu hash SHA-256 của refresh token (không lưu token gốc)', async () => {
      const { refreshToken } = await service.login(loginDto);

      const { data } = prisma.refreshToken.create.mock.calls[0][0];
      expect(data).toEqual({
        userId: user.id,
        tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        expiresAt: new Date(jwt.decode(refreshToken).exp * 1000),
      });
    });

    it('2 lần đăng nhập -> 2 refresh token khác nhau', async () => {
      const first = await service.login(loginDto);
      const second = await service.login(loginDto);
      expect(first.refreshToken).not.toBe(second.refreshToken);
    });

    it('role lấy từ User Service (ADMIN)', async () => {
      userClient.send.mockReturnValue(of({ ...user, role: 'ADMIN' }));

      const { accessToken } = await service.login(loginDto);
      expect(jwt.decode(accessToken).role).toBe('ADMIN');
    });

    it('sai mật khẩu -> 401, không cấp token', async () => {
      await expect(
        rpcError(service.login({ ...loginDto, password: 'saimatkhau' })),
      ).resolves.toMatchObject({ statusCode: 401 });
      expect(userClient.send).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('email không tồn tại -> cùng lỗi 401 như sai mật khẩu', async () => {
      prisma.credential.findUnique.mockResolvedValue(null);
      const wrongPassword = await rpcError(
        service.login({ ...loginDto, password: 'saimatkhau' }),
      );

      prisma.credential.findUnique.mockResolvedValue(null);
      await expect(rpcError(service.login(loginDto))).resolves.toEqual(
        wrongPassword,
      );
    });

    it('tài khoản bị khoá -> 403', async () => {
      userClient.send.mockReturnValue(of({ ...user, status: 'BLOCKED' }));

      await expect(rpcError(service.login(loginDto))).resolves.toMatchObject({
        statusCode: 403,
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('User Service không còn hồ sơ (404) -> 401', async () => {
      userClient.send.mockReturnValue(
        throwError(() => ({ statusCode: 404, message: 'Không tìm thấy' })),
      );

      await expect(rpcError(service.login(loginDto))).resolves.toMatchObject({
        statusCode: 401,
      });
    });

    it('User Service không kết nối được -> 503', async () => {
      userClient.send.mockReturnValue(
        throwError(() => new Error('connect ECONNREFUSED')),
      );

      await expect(rpcError(service.login(loginDto))).resolves.toMatchObject({
        statusCode: 503,
      });
    });
  });
});
