import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';
import { TaskServiceService } from './task-service.service';

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
    it('phân trang, mới nhất trước, total cùng bộ lọc', async () => {
      prisma.task.findMany.mockResolvedValue([task]);
      prisma.task.count.mockResolvedValue(11);

      await expect(
        service.findAll({ page: 2, limit: 5, status: 'TODO' }),
      ).resolves.toEqual({
        items: [task],
        total: 11,
        page: 2,
        limit: 5,
        totalPages: 3,
      });
      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { status: 'TODO' },
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(prisma.task.count).toHaveBeenCalledWith({
        where: { status: 'TODO' },
      });
    });
  });

  describe('findOne', () => {
    it('trả task', async () => {
      prisma.task.findUnique.mockResolvedValue(task);
      await expect(service.findOne(task.id)).resolves.toEqual(task);
    });

    it('không tìm thấy -> 404', async () => {
      prisma.task.findUnique.mockResolvedValue(null);
      await expect(rpcError(service.findOne(task.id))).resolves.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('update', () => {
    it('cập nhật theo id, không đưa id vào data', async () => {
      prisma.task.update.mockResolvedValue({ ...task, status: 'DONE' });

      await service.update({ id: task.id, status: 'DONE' });
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: { status: 'DONE' },
      });
    });

    it('không tìm thấy (P2025) -> 404', async () => {
      prisma.task.update.mockRejectedValue(prismaError('P2025'));
      await expect(
        rpcError(service.update({ id: task.id, title: 'x' })),
      ).resolves.toMatchObject({ statusCode: 404 });
    });

    it('lỗi khác -> ném nguyên lỗi', async () => {
      prisma.task.update.mockRejectedValue(new Error('DB down'));
      await expect(service.update({ id: task.id, title: 'x' })).rejects.toThrow(
        'DB down',
      );
    });

    it('không có field nào để đổi -> 400, không gọi DB', async () => {
      await expect(rpcError(service.update({ id: task.id }))).resolves.toEqual({
        statusCode: 400,
        message: 'Không có field nào để cập nhật',
      });
      expect(prisma.task.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('xoá và trả task vừa xoá', async () => {
      prisma.task.delete.mockResolvedValue(task);
      await expect(service.remove(task.id)).resolves.toEqual(task);
      expect(prisma.task.delete).toHaveBeenCalledWith({
        where: { id: task.id },
      });
    });

    it('không tìm thấy (P2025) -> 404', async () => {
      prisma.task.delete.mockRejectedValue(prismaError('P2025'));
      await expect(rpcError(service.remove(task.id))).resolves.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
