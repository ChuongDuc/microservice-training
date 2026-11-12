import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { notificationsRmqOptions, rabbitmqEnv } from '../config/rabbitmq';
import {
  NOTIFICATIONS_CLIENT,
  NotificationPublisher,
} from './notification-publisher';

/**
 * Cho service phát event thông báo: import module này rồi inject `NotificationPublisher`.
 * Kết nối RabbitMQ theo RABBITMQ_* (cần ConfigModule global), khai báo queue giống hệt
 * phía Notification Service. Kết nối mở ở lần phát đầu tiên: RabbitMQ tắt không làm
 * service không khởi động được.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NOTIFICATIONS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          notificationsRmqOptions(rabbitmqEnv(config)),
      },
    ]),
  ],
  providers: [NotificationPublisher],
  exports: [NotificationPublisher],
})
export class NotificationsPublisherModule {}
