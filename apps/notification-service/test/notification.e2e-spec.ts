import {
  deadLetterQueue,
  NOTIFICATION_EVENTS,
  NOTIFICATION_PATTERNS,
  notificationsRmqOptions,
  rabbitmqUrl,
  TaskCreatedEvent,
  UserRegisteredEvent,
} from '@app/common';
import { INestApplication, Logger } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { NotificationServiceModule } from '../src/notification-service.module';
import { NotificationServiceService } from '../src/notification-service.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { connectTransports } from '../src/transports';
import { eventually } from '../../../test/e2e/eventually';

/**
 * E2E: Notification Service thật (hybrid) nhận event qua RabbitMQ — phía phát dùng
 * ClientProxy RMQ giống Auth/Task Service — và trả danh sách thông báo qua TCP giống
 * Gateway gọi. Mỗi lần chạy dùng một queue riêng (+ DLQ của nó), xoá khi xong; thông
 * báo tạo trong test xoá theo userId. Cần RabbitMQ + Postgres (đã migrate
 * notification_db) đang chạy.
 */
const QUEUE = `notifications_queue_e2e_${randomUUID()}`;
const DLQ = deadLetterQueue(QUEUE);
// Module đọc tên queue từ env (DeadLetterQueueSetup khai báo DLQ theo queue này)
process.env.RABBITMQ_QUEUE = QUEUE;
// Cổng TCP riêng cho test, tránh đụng service đang chạy ở 4004
const TCP_PORT = 4104;
process.env.NOTIFICATION_SERVICE_BIND_HOST = '127.0.0.1';
process.env.NOTIFICATION_SERVICE_PORT = String(TCP_PORT);

/** User dùng trong test: dọn thông báo theo userId khi xong. */
const users: string[] = [];
const newUserId = () => {
  const id = randomUUID();
  users.push(id);
  return id;
};

const userRegistered = (): UserRegisteredEvent => ({
  eventId: randomUUID(),
  userId: newUserId(),
  email: `an.${randomUUID()}@test.com`,
  displayName: 'An',
});
const taskCreated = (ownerId = newUserId()): TaskCreatedEvent => ({
  eventId: randomUUID(),
  taskId: randomUUID(),
  ownerId,
  title: 'Viết báo cáo',
});

describe('Notification Service (e2e, RabbitMQ)', () => {
  let app: INestApplication;
  let client: ClientProxy;
  /** Phía Gateway: gọi notification.find_all qua TCP. */
  let tcpClient: ClientProxy;
  let broker: amqp.ChannelModel;
  let channel: amqp.Channel;
  let onUserRegistered: jest.SpyInstance;
  let onTaskCreated: jest.SpyInstance;

  const startConsumer = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationServiceModule],
    }).compile();
    app = moduleRef.createNestApplication();
    connectTransports(app, process.env);
    await app.init();
    await app.startAllMicroservices();
    const service = app.get(NotificationServiceService);
    onUserRegistered = jest.spyOn(service, 'handleUserRegistered');
    onTaskCreated = jest.spyOn(service, 'handleTaskCreated');
  };

  const emit = (pattern: string, data: unknown) =>
    lastValueFrom(client.emit(pattern, data), { defaultValue: undefined });

  /** Danh sách thông báo của `userId` qua TCP (giống Gateway gọi). */
  const listNotifications = (userId: string, data: object = {}) =>
    firstValueFrom(
      tcpClient.send(NOTIFICATION_PATTERNS.FIND_ALL, {
        user: { userId, role: 'USER' },
        data,
      }),
    );

  /** messageCount: message sẵn sàng giao (không tính message đã giao chưa ack). */
  const queueInfo = (queue: string) => channel.checkQueue(queue);

  /** Lấy (và xoá) toàn bộ message trong DLQ: `{ pattern, data }` của từng event. */
  const drainDlq = async () => {
    const messages: { pattern: string; data: unknown }[] = [];
    for (;;) {
      const message = await channel.get(DLQ, { noAck: true });
      if (!message) return messages;
      messages.push(JSON.parse(message.content.toString()));
    }
  };

  beforeAll(async () => {
    // Log nack của RmqAckInterceptor là kết quả mong đợi trong test, không in ra
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    broker = await amqp.connect(rabbitmqUrl(process.env));
    channel = await broker.createChannel();
    await startConsumer();
    client = ClientProxyFactory.create(notificationsRmqOptions(process.env));
    await client.connect();
    tcpClient = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: TCP_PORT },
    });
    await tcpClient.connect();
  });

  afterAll(async () => {
    await app
      ?.get(PrismaService)
      .notification.deleteMany({ where: { userId: { in: users } } });
    await client?.close();
    await tcpClient?.close();
    await app?.close();
    await channel?.deleteQueue(QUEUE);
    await channel?.deleteQueue(DLQ);
    await broker?.close();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    onUserRegistered.mockClear();
    onTaskCreated.mockClear();
    await channel.purgeQueue(DLQ);
  });

  it('nhận user.registered, payload là instance DTO', async () => {
    const event = userRegistered();
    await emit(NOTIFICATION_EVENTS.USER_REGISTERED, event);

    await eventually(() =>
      expect(onUserRegistered).toHaveBeenCalledWith(event),
    );
    expect(onUserRegistered.mock.calls[0][0]).toBeInstanceOf(
      UserRegisteredEvent,
    );
  });

  it('nhận task.created; field lạ bị bỏ, không làm mất event', async () => {
    const event = taskCreated();
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, { ...event, extra: 'x' });

    await eventually(() => expect(onTaskCreated).toHaveBeenCalledWith(event));
    expect(onTaskCreated.mock.calls[0][0]).not.toHaveProperty('extra');
  });

  it('xử lý xong -> ack, queue trống, DLQ trống', async () => {
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, taskCreated());
    await eventually(() => expect(onTaskCreated).toHaveBeenCalled());
    await eventually(async () =>
      expect((await queueInfo(QUEUE)).messageCount).toBe(0),
    );
    expect(await drainDlq()).toEqual([]);
  });

  it('payload sai (thiếu eventId...) -> vào DLQ, không giao lại; event sau vẫn xử lý', async () => {
    const invalid = { ...taskCreated(), eventId: undefined, title: '' };
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, invalid);
    const valid = taskCreated();
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, valid);

    await eventually(() => expect(onTaskCreated).toHaveBeenCalledWith(valid));
    await eventually(async () =>
      expect((await queueInfo(DLQ)).messageCount).toBe(1),
    );
    expect(onTaskCreated).toHaveBeenCalledTimes(1);
    expect(await drainDlq()).toEqual([
      {
        pattern: NOTIFICATION_EVENTS.TASK_CREATED,
        data: { taskId: invalid.taskId, ownerId: invalid.ownerId, title: '' },
      },
    ]);
  });

  it('handler lỗi (vd: DB tắt) -> event giữ trong DLQ, không mất, không lặp vô hạn', async () => {
    onTaskCreated.mockRejectedValueOnce(new Error('db down'));
    const failing = taskCreated();
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, failing);
    const next = taskCreated();
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, next);

    await eventually(() => expect(onTaskCreated).toHaveBeenCalledWith(next));
    await eventually(async () =>
      expect((await queueInfo(DLQ)).messageCount).toBe(1),
    );
    expect(onTaskCreated).toHaveBeenCalledTimes(2);
    expect(await drainDlq()).toEqual([
      { pattern: NOTIFICATION_EVENTS.TASK_CREATED, data: failing },
    ]);
  });

  it('event không có handler -> vào DLQ, không kẹt queue', async () => {
    await emit('event.khong_ton_tai', { a: 1 });
    await emit(NOTIFICATION_EVENTS.USER_REGISTERED, userRegistered());

    await eventually(() => expect(onUserRegistered).toHaveBeenCalled());
    await eventually(async () =>
      expect((await queueInfo(DLQ)).messageCount).toBe(1),
    );
    expect((await queueInfo(QUEUE)).messageCount).toBe(0);
  });

  it('user.registered -> lưu thông báo chào mừng, user xem được qua TCP', async () => {
    const event = userRegistered();
    await emit(NOTIFICATION_EVENTS.USER_REGISTERED, event);

    await eventually(async () =>
      expect((await listNotifications(event.userId)).total).toBe(1),
    );
    const page = await listNotifications(event.userId);
    expect(page).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(page.items[0]).toMatchObject({
      eventId: event.eventId,
      userId: event.userId,
      type: 'USER_REGISTERED',
      message: 'Chào An, tài khoản của bạn đã được tạo.',
    });
  });

  it('danh sách: mới nhất trước, phân trang, chỉ thông báo của người gọi', async () => {
    const ownerId = newUserId();
    const first = taskCreated(ownerId);
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, first);
    await eventually(async () =>
      expect((await listNotifications(ownerId)).total).toBe(1),
    );
    const second = taskCreated(ownerId);
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, second);
    await eventually(async () =>
      expect((await listNotifications(ownerId)).total).toBe(2),
    );

    const page1 = await listNotifications(ownerId, { page: 1, limit: 1 });
    expect(page1).toMatchObject({ total: 2, totalPages: 2 });
    expect(page1.items[0]).toMatchObject({
      eventId: second.eventId,
      data: { taskId: second.taskId },
    });
    const page2 = await listNotifications(ownerId, { page: 2, limit: 1 });
    expect(page2.items[0]).toMatchObject({ eventId: first.eventId });

    // Người khác không thấy
    await expect(listNotifications(newUserId())).resolves.toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('event giao lại (cùng eventId) -> chỉ một thông báo, không vào DLQ', async () => {
    const event = taskCreated();
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, event);
    await emit(NOTIFICATION_EVENTS.TASK_CREATED, event);

    await eventually(() => expect(onTaskCreated).toHaveBeenCalledTimes(2));
    await eventually(async () =>
      expect((await queueInfo(QUEUE)).messageCount).toBe(0),
    );
    await expect(listNotifications(event.ownerId)).resolves.toMatchObject({
      total: 1,
    });
    expect(await drainDlq()).toEqual([]);
  });

  it('TCP: payload sai -> 400 kèm chi tiết field', async () => {
    await expect(
      listNotifications(newUserId(), { limit: 1000 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errors: [expect.objectContaining({ field: 'data.limit' })],
    });
  });

  it('TCP không nhận event: không tạo được thông báo qua cổng TCP', async () => {
    const event = userRegistered();
    await lastValueFrom(
      tcpClient.emit(NOTIFICATION_EVENTS.USER_REGISTERED, event),
      { defaultValue: undefined },
    );
    // Request sau đi cùng kết nối TCP: server đọc message theo thứ tự, nên khi có phản
    // hồi thì event phía trước chắc chắn đã được nhận và điều phối (không đoán bằng sleep).
    // Nếu event lọt vào handler, handler chạy trước khi query DB của request này xong.
    await expect(listNotifications(event.userId)).resolves.toMatchObject({
      total: 0,
    });
    expect(onUserRegistered).not.toHaveBeenCalled();
  });

  it('event phát lúc service tắt -> nằm chờ trong queue, service bật lại thì nhận', async () => {
    await app.close();
    // app.close() không chờ channel đóng hẳn: chờ consumer rời queue rồi mới phát,
    // nếu không event có thể bị giao cho consumer đang đóng
    await eventually(async () =>
      expect((await queueInfo(QUEUE)).consumerCount).toBe(0),
    );
    const event = userRegistered();
    await emit(NOTIFICATION_EVENTS.USER_REGISTERED, event);
    await eventually(async () =>
      expect((await queueInfo(QUEUE)).messageCount).toBe(1),
    );

    await startConsumer();
    await eventually(() =>
      expect(onUserRegistered).toHaveBeenCalledWith(event),
    );
  });
});
