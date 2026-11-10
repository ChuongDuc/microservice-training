// Nạp trước mọi import: decorator của class-transformer (DTO trong @app/common)
// gọi Reflect.getMetadata ngay khi file được nạp, trước khi @nestjs/core kịp nạp nó.
import 'reflect-metadata';
import { notificationsConsumerOptions, notificationsQueue } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { NotificationServiceModule } from './notification-service.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong NotificationServiceModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cấu hình RabbitMQ ở đây.
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    NotificationServiceModule,
    notificationsConsumerOptions(process.env),
  );
  // SIGTERM/SIGINT (vd: docker stop) -> đóng kết nối RabbitMQ; message chưa ack được
  // RabbitMQ giao lại cho lần chạy sau
  app.enableShutdownHooks();

  await app.listen();
  Logger.log(
    `Notification Service (RabbitMQ) đang lắng nghe queue ${notificationsQueue(process.env)}`,
    'Bootstrap',
  );
}
bootstrap();
