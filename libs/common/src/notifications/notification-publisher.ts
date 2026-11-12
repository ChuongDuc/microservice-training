import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { NOTIFICATION_EVENTS, NotificationEvent } from '../constants/events';
import { TaskCreatedEvent, UserRegisteredEvent } from '../dto/events';

/** Injection token của ClientProxy RMQ tới queue thông báo. */
export const NOTIFICATIONS_CLIENT = 'NOTIFICATIONS_CLIENT';

/** Payload của từng event (kiểm tra kiểu khi phát). */
export interface NotificationEventPayloads {
  [NOTIFICATION_EVENTS.USER_REGISTERED]: UserRegisteredEvent;
  [NOTIFICATION_EVENTS.TASK_CREATED]: TaskCreatedEvent;
}

/** Dữ liệu phía phát truyền vào: mọi field trừ `eventId` (publisher tự tạo). */
export type NotificationEventData<E extends NotificationEvent> = Omit<
  NotificationEventPayloads[E],
  'eventId'
>;

/**
 * Phát event bất đồng bộ tới Notification Service qua RabbitMQ (`ClientProxy.emit`).
 *
 * "Bắn rồi quên": `publish` trả về ngay, không chờ RabbitMQ xác nhận — thông báo là
 * việc phụ, request chính (đăng ký, tạo task) không chậm đi và không lỗi theo khi
 * RabbitMQ gặp sự cố. Đánh đổi: RabbitMQ tắt lúc phát thì event đó mất (chỉ ghi log).
 * Muốn không mất event nào cần outbox pattern (lưu event cùng transaction với dữ liệu
 * rồi phát sau) — chưa làm ở bước này.
 *
 * Chỉ gọi SAU KHI dữ liệu đã ghi xong: event mô tả việc đã xảy ra.
 */
@Injectable()
export class NotificationPublisher {
  private readonly logger = new Logger(NotificationPublisher.name);

  constructor(
    @Inject(NOTIFICATIONS_CLIENT) private readonly client: ClientProxy,
  ) {}

  /** Phát event, trả về `eventId` đã gắn vào event. */
  publish<E extends NotificationEvent>(
    pattern: E,
    data: NotificationEventData<E>,
  ): string {
    const eventId = randomUUID();
    // emit() kết nối + gửi ngay cả khi không subscribe; subscribe chỉ để bắt lỗi
    this.client.emit(pattern, { ...data, eventId }).subscribe({
      error: (error: unknown) => {
        this.logger.error(
          `Không phát được event ${pattern} (eventId ${eventId})`,
          error instanceof Error ? error.stack : String(error),
        );
        // ClientRMQ giữ lại kết nối đã lỗi (lần kết nối đầu thất bại thì mọi lần emit
        // sau cũng lỗi theo). Đóng để lần phát sau tạo kết nối mới.
        void Promise.resolve(this.client.close()).catch(() => undefined);
      },
    });
    return eventId;
  }
}
