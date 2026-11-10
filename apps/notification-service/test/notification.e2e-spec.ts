import {
  deadLetterQueue,
  NOTIFICATION_EVENTS,
  notificationsConsumerOptions,
  notificationsRmqOptions,
  rabbitmqUrl,
  TaskCreatedEvent,
  UserRegisteredEvent,
} from '@app/common';
import { INestMicroservice, Logger } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';
import { lastValueFrom } from 'rxjs';
import { NotificationServiceModule } from '../src/notification-service.module';
import { NotificationServiceService } from '../src/notification-service.service';

/**
 * E2E: Notification Service thật nhận event qua RabbitMQ; phía phát dùng ClientProxy RMQ
 * (giống User/Task Service sẽ dùng). Mỗi lần chạy dùng một queue riêng (+ DLQ của nó),
 * xoá khi xong. Cần RabbitMQ đang chạy (docker compose up -d).
 */
const QUEUE = `notifications_queue_e2e_${randomUUID()}`;
const DLQ = deadLetterQueue(QUEUE);
// Module đọc tên queue từ env (DeadLetterQueueSetup khai báo DLQ theo queue này)
process.env.RABBITMQ_QUEUE = QUEUE;

const WAIT_MS = 5000;

const userRegistered = (): UserRegisteredEvent => ({
  eventId: randomUUID(),
  userId: randomUUID(),
  email: `an.${randomUUID()}@test.com`,
  displayName: 'An',
});
const taskCreated = (): TaskCreatedEvent => ({
  eventId: randomUUID(),
  taskId: randomUUID(),
  ownerId: randomUUID(),
  title: 'Viết báo cáo',
});

/** Chờ tới khi `check` (đồng bộ hoặc async) không ném lỗi nữa. */
async function eventually(
  check: () => unknown | Promise<unknown>,
  timeoutMs = WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

describe('Notification Service (e2e, RabbitMQ)', () => {
  let app: INestMicroservice;
  let client: ClientProxy;
  let broker: amqp.ChannelModel;
  let channel: amqp.Channel;
  let onUserRegistered: jest.SpyInstance;
  let onTaskCreated: jest.SpyInstance;

  const startConsumer = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationServiceModule],
    }).compile();
    app = moduleRef.createNestMicroservice(
      notificationsConsumerOptions(process.env),
    );
    await app.listen();
    const service = app.get(NotificationServiceService);
    onUserRegistered = jest.spyOn(service, 'handleUserRegistered');
    onTaskCreated = jest.spyOn(service, 'handleTaskCreated');
  };

  const emit = (pattern: string, data: unknown) =>
    lastValueFrom(client.emit(pattern, data), { defaultValue: undefined });

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
  });

  afterAll(async () => {
    await client?.close();
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
