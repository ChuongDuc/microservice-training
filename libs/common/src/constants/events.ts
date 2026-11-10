/**
 * Các event bất đồng bộ (qua RabbitMQ, queue thông báo). Khác message pattern TCP:
 * phía phát `emit` rồi đi tiếp, không chờ phản hồi; Notification Service nhận bằng
 * @EventPattern.
 */
export const NOTIFICATION_EVENTS = {
  /** User vừa đăng ký xong tài khoản. */
  USER_REGISTERED: 'user.registered',
  /** Một task vừa được tạo. */
  TASK_CREATED: 'task.created',
} as const;

export type NotificationEvent =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
