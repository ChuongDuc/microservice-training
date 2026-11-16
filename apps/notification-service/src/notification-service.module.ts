import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationServiceController } from './notification-service.controller';
import { NotificationServiceService } from './notification-service.service';
import { NotificationsController } from './notifications.controller';
import { PrismaModule } from './prisma/prisma.module';
import { DeadLetterQueueSetup } from './rmq/dead-letter-queue.setup';

/**
 * Hai transport (xem transports.ts): RabbitMQ nhận event (NotificationServiceController),
 * TCP trả danh sách thông báo cho Gateway (NotificationsController). Pipe/filter/
 * interceptor gắn theo từng controller vì hai phía xử lý lỗi khác nhau (event: nack vào
 * DLQ; TCP: trả lỗi cho phía gọi).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
  ],
  controllers: [NotificationServiceController, NotificationsController],
  providers: [
    NotificationServiceService,
    // Khai báo DLQ trước khi nhận event: message bị nack được giữ lại, không mất
    DeadLetterQueueSetup,
  ],
})
export class NotificationServiceModule {}
