import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma';
import { NotificationServiceService } from './notification-service.service';
import { PrismaService } from './prisma/prisma.service';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('error', {
    code,
    clientVersion: 'test',
  });

describe('NotificationServiceService', () => {
  let service: NotificationServiceService;
  const prisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const user = { userId: 'user-uuid', role: 'USER' as const };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const module = await Test.createTestingModule({
      providers: [
        NotificationServiceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(NotificationServiceService);
  });

  afterAll(() => jest.restoreAllMocks());

  it('user.registered -> thông báo chào mừng cho user vừa đăng ký', async () => {
    await service.handleUserRegistered({
      eventId: 'event-1',
      userId: user.userId,
      email: 'an@test.com',
      displayName: 'An',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        eventId: 'event-1',
        userId: user.userId,
        type: 'USER_REGISTERED',
        title: 'Chào mừng bạn',
        message: 'Chào An, tài khoản của bạn đã được tạo.',
      },
    });
  });

  it('task.created -> thông báo cho chủ task, kèm taskId', async () => {
    await service.handleTaskCreated({
      eventId: 'event-2',
      taskId: 'task-uuid',
      ownerId: user.userId,
      title: 'Viết báo cáo',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        eventId: 'event-2',
        userId: user.userId,
        type: 'TASK_CREATED',
        title: 'Task mới',
        message: 'Bạn vừa tạo task "Viết báo cáo".',
        data: { taskId: 'task-uuid' },
      },
    });
  });

  it('event giao lại (eventId trùng, P2002) -> bỏ qua, không ném lỗi', async () => {
    prisma.notification.create.mockRejectedValueOnce(prismaError('P2002'));

    await expect(
      service.handleTaskCreated({
        eventId: 'event-2',
        taskId: 'task-uuid',
        ownerId: user.userId,
        title: 'x',
      }),
    ).resolves.toBeUndefined();
  });

  describe('lỗi DB', () => {
    const event = {
      eventId: 'event-3',
      userId: user.userId,
      email: 'an@test.com',
      displayName: 'An',
    };
    const connectionLost = () => prismaError('P1001');

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      service.retryDelaysMs = [0, 0];
    });

    it('lỗi kết nối tạm thời -> thử lại, lần sau thành công thì không ném lỗi', async () => {
      prisma.notification.create
        .mockRejectedValueOnce(connectionLost())
        .mockRejectedValueOnce(
          new Prisma.PrismaClientInitializationError('db khởi động', 'test'),
        )
        .mockResolvedValueOnce({});

      await expect(
        service.handleUserRegistered(event),
      ).resolves.toBeUndefined();
      expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    });

    it('DB tắt lâu hơn số lần thử lại -> ném lỗi (event vào DLQ, không mất)', async () => {
      prisma.notification.create.mockRejectedValue(connectionLost());

      await expect(service.handleUserRegistered(event)).rejects.toMatchObject({
        code: 'P1001',
      });
      // 1 lần đầu + 2 lần thử lại
      expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    });

    it('lỗi không phải do kết nối -> ném lỗi ngay, không thử lại', async () => {
      prisma.notification.create.mockRejectedValue(new Error('bug'));

      await expect(service.handleUserRegistered(event)).rejects.toThrow('bug');
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  it('findAll: chỉ thông báo của người gọi, mới nhất trước, phân trang', async () => {
    const items = [{ id: 'n-1' }];
    prisma.notification.findMany.mockResolvedValue(items);
    prisma.notification.count.mockResolvedValue(11);

    await expect(service.findAll(user, { page: 2, limit: 5 })).resolves.toEqual(
      { items, total: 11, page: 2, limit: 5, totalPages: 3 },
    );
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: user.userId },
      skip: 5,
      take: 5,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: user.userId },
    });
  });
});
