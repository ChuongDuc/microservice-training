import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';
import { UserServiceService } from './user-service.service';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('error', {
    code,
    clientVersion: 'test',
  });

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

describe('UserServiceService', () => {
  let service: UserServiceService;
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const user = { id: 'uuid', email: 'a@b.com', displayName: 'An' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UserServiceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UserServiceService);
  });

  describe('create', () => {
    it('tạo user', async () => {
      prisma.user.create.mockResolvedValue(user);
      await expect(
        service.create({ email: 'a@b.com', displayName: 'An' }),
      ).resolves.toEqual(user);
    });

    it('trùng email -> 409', async () => {
      prisma.user.create.mockRejectedValue(prismaError('P2002'));
      const err = await rpcError(
        service.create({ email: 'a@b.com', displayName: 'An' }),
      );
      expect(err).toMatchObject({ statusCode: 409 });
    });

    it('lỗi khác được ném lại nguyên vẹn', async () => {
      const boom = new Error('db down');
      prisma.user.create.mockRejectedValue(boom);
      await expect(
        service.create({ email: 'a@b.com', displayName: 'An' }),
      ).rejects.toBe(boom);
    });
  });

  describe('findById / findByEmail', () => {
    it('tìm thấy', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.findById('uuid')).resolves.toEqual(user);
      await expect(service.findByEmail('a@b.com')).resolves.toEqual(user);
    });

    it('không tìm thấy -> 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await rpcError(service.findById('uuid'))).toMatchObject({
        statusCode: 404,
      });
      expect(await rpcError(service.findByEmail('x@b.com'))).toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('update', () => {
    it('cập nhật user', async () => {
      prisma.user.update.mockResolvedValue({ ...user, displayName: 'Bình' });
      await service.update('uuid', { displayName: 'Bình' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid' },
        data: { displayName: 'Bình' },
      });
    });

    it('không tìm thấy -> 404', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));
      expect(await rpcError(service.update('uuid', {}))).toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('list', () => {
    it('phân trang đúng skip/take và tính totalPages', async () => {
      prisma.user.findMany.mockResolvedValue([user]);
      prisma.user.count.mockResolvedValue(11);

      await expect(service.list({ page: 3, limit: 5 })).resolves.toEqual({
        items: [user],
        total: 11,
        page: 3,
        limit: 5,
        totalPages: 3,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        skip: 10,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
