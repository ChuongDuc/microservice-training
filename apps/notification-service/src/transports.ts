import { notificationsConsumerOptions, SERVICE_TCP_PORTS } from '@app/common';
import { INestApplication } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

type Env = Record<string, string | undefined>;

/** Địa chỉ TCP Notification Service nghe (Gateway gọi tới để lấy danh sách thông báo). */
export function notificationTcpAddress(env: Env) {
  return {
    // Mặc định chỉ nghe localhost: service tin danh tính `{ user }` trong payload, nên
    // chỉ Gateway được gọi tới. Trong Docker đặt 0.0.0.0 và KHÔNG publish cổng ra ngoài.
    host: env.NOTIFICATION_SERVICE_BIND_HOST ?? '127.0.0.1',
    port: Number(
      env.NOTIFICATION_SERVICE_PORT ?? SERVICE_TCP_PORTS.NOTIFICATION,
    ),
  };
}

/**
 * Gắn hai transport vào app (hybrid): RabbitMQ (nhận event, ack thủ công) + TCP (Gateway
 * gọi). Dùng chung cho main.ts và e2e. Gọi `app.init()` trước `startAllMicroservices()`
 * để DeadLetterQueueSetup khai báo DLQ trước khi bắt đầu nhận event.
 */
export function connectTransports(app: INestApplication, env: Env): void {
  app.connectMicroservice<MicroserviceOptions>(
    notificationsConsumerOptions(env),
  );
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: notificationTcpAddress(env),
  });
}
