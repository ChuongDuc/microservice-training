import { RmqOptions, Transport } from '@nestjs/microservices';

/** Queue mặc định Notification Service lắng nghe (ghi đè bằng RABBITMQ_QUEUE). */
export const DEFAULT_NOTIFICATIONS_QUEUE = 'notifications_queue';

type Env = Record<string, string | undefined>;

/** Các biến môi trường RabbitMQ mà các hàm dưới đây đọc. */
const RABBITMQ_ENV_KEYS = [
  'RABBITMQ_USER',
  'RABBITMQ_PASSWORD',
  'RABBITMQ_HOST',
  'RABBITMQ_PORT',
  'RABBITMQ_QUEUE',
] as const;

/**
 * Lấy các biến RABBITMQ_* qua ConfigService (đã nạp `.env`) thành object Env cho các
 * hàm bên dưới.
 */
export function rabbitmqEnv(config: {
  get<T = string>(key: string): T | undefined;
}): Env {
  return Object.fromEntries(
    RABBITMQ_ENV_KEYS.map((key) => [key, config.get<string>(key)]),
  );
}

/**
 * URL kết nối RabbitMQ từ RABBITMQ_USER / RABBITMQ_PASSWORD / RABBITMQ_HOST /
 * RABBITMQ_PORT. User/password được encode: mật khẩu có ký tự như `@`, `/`, `:` làm
 * hỏng URL nếu ghép thẳng.
 */
export function rabbitmqUrl(env: Env): string {
  const user = encodeURIComponent(env.RABBITMQ_USER || 'guest');
  const password = encodeURIComponent(env.RABBITMQ_PASSWORD || 'guest');
  const host = env.RABBITMQ_HOST || 'localhost';
  const port = env.RABBITMQ_PORT || '5672';
  return `amqp://${user}:${password}@${host}:${port}`;
}

/** Tên queue thông báo (RABBITMQ_QUEUE, mặc định `notifications_queue`). */
export function notificationsQueue(env: Env): string {
  return env.RABBITMQ_QUEUE || DEFAULT_NOTIFICATIONS_QUEUE;
}

/**
 * Dead-letter queue của một queue: message bị consumer từ chối (payload sai, handler
 * lỗi, không có handler) được RabbitMQ chuyển vào đây thay vì xoá — xem lại được và
 * đưa về queue chính để xử lý lại khi đã sửa lỗi (vd: DB đã chạy lại).
 */
export function deadLetterQueue(queue: string): string {
  return `${queue}.dlq`;
}

/**
 * Khai báo queue thông báo — phải giống hệt nhau ở phía phát và phía nhận: cùng queue
 * mà khai báo khác (durable, arguments) thì RabbitMQ từ chối (PRECONDITION_FAILED).
 * - `durable`: queue còn sau khi RabbitMQ khởi động lại.
 * - dead-letter qua exchange mặc định (`''`) với routing key là tên DLQ: message bị
 *   nack không requeue đi thẳng vào DLQ.
 */
export function notificationsQueueOptions(queue: string) {
  return {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: deadLetterQueue(queue),
  };
}

/** Phần cấu hình RMQ chung của hai phía: kết nối + queue. */
function baseRmqOptions(env: Env, queue: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl(env)],
      queue,
      queueOptions: notificationsQueueOptions(queue),
    },
  };
}

/**
 * Phía phát event (ClientProxy của User/Task Service): message `persistent` (ghi xuống
 * đĩa) để không mất event chưa xử lý khi broker restart.
 */
export function notificationsRmqOptions(
  env: Env,
  queue = notificationsQueue(env),
): RmqOptions {
  const base = baseRmqOptions(env, queue);
  return { ...base, options: { ...base.options, persistent: true } };
}

/** Số message tối đa Notification Service nhận cùng lúc mà chưa ack. */
export const NOTIFICATIONS_PREFETCH = 10;

/**
 * Phía nhận (Notification Service): ack thủ công (`noAck: false`) — message chỉ bị
 * xoá khỏi queue sau khi xử lý xong (xem RmqAckInterceptor), service chết giữa chừng
 * thì RabbitMQ giao lại cho lần chạy sau.
 */
export function notificationsConsumerOptions(
  env: Env,
  queue = notificationsQueue(env),
): RmqOptions {
  const base = baseRmqOptions(env, queue);
  return {
    ...base,
    options: {
      ...base.options,
      noAck: false,
      prefetchCount: NOTIFICATIONS_PREFETCH,
    },
  };
}
