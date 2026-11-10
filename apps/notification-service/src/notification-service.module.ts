import { createRpcValidationPipe } from '@app/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { NotificationServiceController } from './notification-service.controller';
import { NotificationServiceService } from './notification-service.service';
import { DeadLetterQueueSetup } from './rmq/dead-letter-queue.setup';
import { RmqAckInterceptor } from './rmq/rmq-ack.interceptor';
import { RmqEventExceptionFilter } from './rmq/rmq-event-exception.filter';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [NotificationServiceController],
  providers: [
    NotificationServiceService,
    // Khai báo DLQ trước khi nhận event: message bị nack được giữ lại, không mất
    DeadLetterQueueSetup,
    // ack khi xử lý xong, nack (vào dead-letter queue) khi payload sai hoặc handler lỗi
    { provide: APP_INTERCEPTOR, useClass: RmqAckInterceptor },
    // Validate payload event. Không chặn field lạ: phía phát thêm field mới vào event
    // thì field đó bị bỏ qua, không làm mất cả event
    {
      provide: APP_PIPE,
      useFactory: () =>
        createRpcValidationPipe({ forbidNonWhitelisted: false }),
    },
    // Lỗi chỉ ghi log một lần (ở RmqAckInterceptor)
    { provide: APP_FILTER, useClass: RmqEventExceptionFilter },
  ],
})
export class NotificationServiceModule {}
