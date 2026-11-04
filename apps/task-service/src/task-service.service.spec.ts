import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';
import { ownedBy, TaskServiceService } from './task-service.service';

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

describe('TaskServiceService', () => {
  let service: TaskServiceService;
  const prisma = {
    task: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const user = { userId: 'user-uuid', role: 'USER' as const };
  const task = { id: 'task-uuid', ownerId: user.userId, title: 'Viết test' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TaskServiceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(TaskServiceService);
  });

  describe('create', () => {
    it('gắn ownerId = userId của người gọi', async () => {
      prisma.task.create.mockResolvedValue(task);

      await expect(
        service.create(user, { title: 'Viết test', priority: 'HIGH' }),
      ).resolves.toEqual(task);
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: { title: 'Viết test', priority: 'HIGH', ownerId: user.userId },
      });
    });
  });

  describe('findAll', () => {
    it('chỉ task của người gọi, phân trang, mới nhất trước, total cùng bộ lọc', async () => {
      prisma.task.findMany.mockResolvedValue([task]);
      prisma.task.count.mockResolvedValue(11);

      await expect(
        service.findAll(user, { page: 2, limit: 5, status: 'TODO' }),
      ).resolves.toEqual({
        items: [task],
        total: 11,
        page: 2,
        limit: 5,
        totalPages: 3,
      });
      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { ownerId: user.userId, status: 'TODO' },
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(prisma.task.count).toHaveBeenCalledWith({
        where: { ownerId: user.userId, status: 'TODO' },
      });
    });
  });

  describe('findOne', () => {
    it('tìm theo id + ownerId của người gọi', async () => {
      prisma.task.findUnique.mockResolvedValue(task);
      await expect(service.findOne(user, task.id)).resolves.toEqual(task);
      expect(prisma.task.findUnique).toHaveBeenCalledWith({
        where: { id: task.id, ownerId: user.userId },
      });
    });

    it('không tìm thấy hoặc task của người khác -> 404', async () => {
      prisma.task.findUnique.mockResolvedValue(null);
      await expect(
        rpcError(service.findOne(user, task.id)),
      ).resolves.toMatchObject({ statusCode: 404 });
    });
  });

  describe('update', () => {
    it('cập nhật theo id + ownerId (trong cùng câu update), không đưa id vào data', async () => {
      prisma.task.update.mockResolvedValue({ ...task, status: 'DONE' });

      await service.update(user, { id: task.id, status: 'DONE' });
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: task.id, ownerId: user.userId },
        data: { status: 'DONE' },
      });
    });

    it('không tìm thấy hoặc task của người khác (P2025) -> 404', async () => {
      prisma.task.update.mockRejectedValue(prismaError('P2025'));
      await expect(
        rpcError(service.update(user, { id: task.id, title: 'x' })),
      ).resolves.toMatchObject({ statusCode: 404 });
    });

    it('lỗi khác -> ném nguyên lỗi', async () => {
      prisma.task.update.mockRejectedValue(new Error('DB down'));
      await expect(
        service.update(user, { id: task.id, title: 'x' }),
      ).rejects.toThrow('DB down');
    });

    it('không có field nào để đổi -> 400, không gọi DB', async () => {
      await expect(
        rpcError(service.update(user, { id: task.id })),
      ).resolves.toEqual({
        statusCode: 400,
        message: 'Không có field nào để cập nhật',
      });
      expect(prisma.task.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('xoá theo id + ownerId, trả task vừa xoá', async () => {
      prisma.task.delete.mockResolvedValue(task);
      await expect(service.remove(user, task.id)).resolves.toEqual(task);
      expect(prisma.task.delete).toHaveBeenCalledWith({
        where: { id: task.id, ownerId: user.userId },
      });
    });

    it('không tìm thấy hoặc task của người khác (P2025) -> 404', async () => {
      prisma.task.delete.mockRejectedValue(prismaError('P2025'));
      await expect(
        rpcError(service.remove(user, task.id)),
      ).resolves.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('ownedBy', () => {
    it('where luôn kèm ownerId của người gọi', () => {
      expect(ownedBy(user).where()).toEqual({ ownerId: user.userId });
      expect(ownedBy(user).where({ status: 'DONE' })).toEqual({
        status: 'DONE',
        ownerId: user.userId,
      });
    });

    it('điều kiện truyền vào không ghi đè được ownerId', () => {
      expect(ownedBy(user).where({ ownerId: 'nguoi-khac' })).toEqual({
        ownerId: user.userId,
      });
      expect(ownedBy(user).where({ OR: [{ ownerId: 'nguoi-khac' }] })).toEqual({
        OR: [{ ownerId: 'nguoi-khac' }],
        ownerId: user.userId,
      });
    });

    it('byId = id + ownerId', () => {
      expect(ownedBy(user).byId('task-uuid')).toEqual({
        id: 'task-uuid',
        ownerId: user.userId,
      });
    });
  });
});
