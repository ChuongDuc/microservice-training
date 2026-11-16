// Nạp trước mọi import: decorator của class-transformer (DTO trong @app/common)
// gọi Reflect.getMetadata ngay khi file được nạp, trước khi @nestjs/core kịp nạp nó.
import 'reflect-metadata';
import { notificationsQueue } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NotificationServiceModule } from './notification-service.module';
import { connectTransports, notificationTcpAddress } from './transports';

async function bootstrap() {
  // App hybrid không mở cổng HTTP (không gọi app.listen): chỉ chạy các microservice
  // gắn vào. ConfigModule.forRoot() trong module đã nạp .env vào process.env.
  const app = await NestFactory.create(NotificationServiceModule);
  connectTransports(app, process.env);
  // SIGTERM/SIGINT (vd: docker stop) -> đóng kết nối RabbitMQ + DB; message chưa ack
  // được RabbitMQ giao lại cho lần chạy sau
  app.enableShutdownHooks();

  await app.init();
  await app.startAllMicroservices();
  const { host, port } = notificationTcpAddress(process.env);
  Logger.log(
    `Notification Service đang lắng nghe queue ${notificationsQueue(process.env)} (RabbitMQ) và ${host}:${port} (TCP)`,
    'Bootstrap',
  );
}
bootstrap();
