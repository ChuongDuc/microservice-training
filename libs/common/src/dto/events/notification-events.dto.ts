import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * Payload các event trong NOTIFICATION_EVENTS — "hợp đồng" giữa phía phát (User/Task
 * Service) và Notification Service. Notification Service validate theo các class này;
 * event sai dạng bị chuyển vào dead-letter queue (không giao lại, tránh lặp vô hạn).
 *
 * Chỉ chứa dữ liệu cần cho thông báo, không chứa dữ liệu nhạy cảm (mật khẩu, token).
 */

/**
 * Trường chung của mọi event. `eventId` (UUID phía phát tạo, mỗi event một giá trị)
 * để phía nhận chống xử lý trùng: RabbitMQ giao "ít nhất một lần" — service tắt sau
 * khi xử lý mà trước khi ack thì event được giao lại.
 */
export abstract class NotificationEventBase {
  @IsUUID()
  eventId: string;
}

export class UserRegisteredEvent extends NotificationEventBase {
  @IsUUID()
  userId: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;
}

export class TaskCreatedEvent extends NotificationEventBase {
  @IsUUID()
  taskId: string;

  /** Chủ task — người nhận thông báo. */
  @IsUUID()
  ownerId: string;

  @IsString()
  @IsNotEmpty()
  title: string;
}
