import { Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { of, Subject, throwError } from 'rxjs';
import { NOTIFICATION_EVENTS } from '../constants/events';
import { NotificationPublisher } from './notification-publisher';

describe('NotificationPublisher', () => {
  const client = { emit: jest.fn(), close: jest.fn() };
  const publisher = new NotificationPublisher(client as unknown as ClientProxy);
  const data = { taskId: 't-1', ownerId: 'u-1', title: 'Viết báo cáo' };
  let logError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterAll(() => jest.restoreAllMocks());

  it('emit event kèm eventId (UUID) mới, trả về eventId đó', () => {
    client.emit.mockReturnValue(of(undefined));

    const eventId = publisher.publish(NOTIFICATION_EVENTS.TASK_CREATED, data);

    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(client.emit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.TASK_CREATED, {
      ...data,
      eventId,
    });
  });

  it('mỗi lần phát một eventId khác nhau', () => {
    client.emit.mockReturnValue(of(undefined));

    const first = publisher.publish(NOTIFICATION_EVENTS.TASK_CREATED, data);
    const second = publisher.publish(NOTIFICATION_EVENTS.TASK_CREATED, data);

    expect(first).not.toBe(second);
  });

  it('không chờ RabbitMQ xác nhận: trả về ngay khi việc gửi chưa xong', () => {
    client.emit.mockReturnValue(new Subject());

    expect(() =>
      publisher.publish(NOTIFICATION_EVENTS.TASK_CREATED, data),
    ).not.toThrow();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('phát lỗi (RabbitMQ tắt) -> không ném lỗi, ghi log, đóng client để lần sau kết nối lại', () => {
    client.emit.mockReturnValue(
      throwError(() => new Error('connect ECONNREFUSED')),
    );

    const eventId = publisher.publish(NOTIFICATION_EVENTS.TASK_CREATED, data);

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(
        `${NOTIFICATION_EVENTS.TASK_CREATED} (eventId ${eventId})`,
      ),
      expect.stringContaining('ECONNREFUSED'),
    );
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
