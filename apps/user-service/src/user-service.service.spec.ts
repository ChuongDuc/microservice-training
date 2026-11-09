import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';
import { escapeLike, UserServiceService } from './user-service.service';

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
    // Mảng query (đọc nhất quán) hoặc callback (interactive transaction, tx = prisma)
    $transaction: jest.fn((arg: unknown): unknown =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });
  });

  describe('admin', () => {
    const admin = { userId: 'admin-uuid', role: 'ADMIN' as const };
    const normal = { userId: 'user-uuid', role: 'USER' as const };
    const target = 'target-uuid';
    /** Role/status hiện tại của người gọi trong DB (assertAdmin đọc từ đây, không từ token). */
    const callerInDb = (role: string, status = 'ACTIVE') =>
      prisma.user.findUnique.mockResolvedValue({ role, status });

    beforeEach(() => callerInDb('ADMIN'));

    it('adminList: tìm theo email/tên (không phân biệt hoa thường) + lọc role/status', async () => {
      prisma.user.findMany.mockResolvedValue([user]);
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.adminList(admin, {
          page: 1,
          limit: 10,
          search: 'an',
          role: 'USER',
          status: 'BLOCKED',
        }),
      ).resolves.toMatchObject({ items: [user], total: 1, totalPages: 1 });
      const where = {
        role: 'USER',
        status: 'BLOCKED',
        OR: [
          { email: { contains: 'an', mode: 'insensitive' } },
          { displayName: { contains: 'an', mode: 'insensitive' } },
        ],
      };
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where, skip: 0, take: 10 }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith({ where });
    });

    it('adminList: không search -> không có điều kiện OR', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);
      await service.adminList(admin, { page: 2, limit: 5 });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { role: undefined, status: undefined },
      });
    });

    it.each([
      ['adminList', () => service.adminList(normal, { page: 1, limit: 10 })],
      [
        'updateRole',
        () => service.updateRole(normal, { id: target, role: 'ADMIN' }),
      ],
      [
        'updateStatus',
        () => service.updateStatus(normal, { id: target, status: 'BLOCKED' }),
      ],
    ])(
      '%s: người gọi không phải ADMIN trong DB -> 403, không ghi DB',
      async (_name, call) => {
        callerInDb('USER');
        await expect(rpcError((async () => call())())).resolves.toEqual({
          statusCode: 403,
          message: 'Chỉ ADMIN được thực hiện thao tác này',
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.findMany).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['đã bị hạ xuống USER', { role: 'USER', status: 'ACTIVE' }],
      ['đã bị khoá', { role: 'ADMIN', status: 'BLOCKED' }],
      ['không còn tồn tại', null],
    ])(
      'token ghi ADMIN nhưng trong DB người gọi %s -> 403, không ghi DB',
      async (_case, current) => {
        prisma.user.findUnique.mockResolvedValue(current);
        await expect(
          rpcError(service.updateRole(admin, { id: target, role: 'USER' })),
        ).resolves.toMatchObject({ statusCode: 403 });
        await expect(
          rpcError(service.adminList(admin, { page: 1, limit: 10 })),
        ).resolves.toMatchObject({ statusCode: 403 });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: { id: admin.userId },
          select: { role: true, status: true },
        });
      },
    );

    it('kiểm tra quyền + ghi trong cùng transaction Serializable, có ghi log', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.user.update.mockResolvedValue({ ...user, status: 'BLOCKED' });

      await service.updateStatus(admin, { id: target, status: 'BLOCKED' });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(log).toHaveBeenCalledWith(
        `Admin ${admin.userId} cập nhật user ${target}: {"status":"BLOCKED"}`,
      );
      log.mockRestore();
    });

    it('xung đột ghi đồng thời (P2034) -> 409', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2034'));
      await expect(
        rpcError(service.updateRole(admin, { id: target, role: 'USER' })),
      ).resolves.toMatchObject({ statusCode: 409 });
    });

    it('updateRole: cập nhật role theo id', async () => {
      prisma.user.update.mockResolvedValue({ ...user, role: 'ADMIN' });
      await service.updateRole(admin, { id: target, role: 'ADMIN' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: target },
        data: { role: 'ADMIN' },
      });
    });

    it('updateStatus: cập nhật status theo id', async () => {
      prisma.user.update.mockResolvedValue({ ...user, status: 'BLOCKED' });
      await service.updateStatus(admin, { id: target, status: 'BLOCKED' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: target },
        data: { status: 'BLOCKED' },
      });
    });

    it.each([
      [
        'updateRole',
        () => service.updateRole(admin, { id: admin.userId, role: 'USER' }),
      ],
      [
        'updateStatus',
        () =>
          service.updateStatus(admin, { id: admin.userId, status: 'BLOCKED' }),
      ],
    ])('%s: tự thao tác trên chính mình -> 400', async (_name, call) => {
      await expect(rpcError((async () => call())())).resolves.toMatchObject({
        statusCode: 400,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('user không tồn tại (P2025) -> 404', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));
      await expect(
        rpcError(
          service.updateStatus(admin, { id: target, status: 'BLOCKED' }),
        ),
      ).resolves.toMatchObject({ statusCode: 404 });
    });
  });

  it('escapeLike: escape \\, % và _ cho LIKE, giữ nguyên ký tự khác', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('Nguyễn An')).toBe('Nguyễn An');
  });
});
