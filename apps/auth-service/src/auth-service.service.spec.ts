import { USER_PATTERNS, USER_SERVICE } from '@app/common';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
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
  };
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
});
