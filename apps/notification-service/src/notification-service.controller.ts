import {
  createRpcValidationPipe,
  NOTIFICATION_EVENTS,
  TaskCreatedEvent,
  UserRegisteredEvent,
} from '@app/common';
import {
  Controller,
  UseFilters,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { EventPattern, Payload, Transport } from '@nestjs/microservices';
import { NotificationServiceService } from './notification-service.service';
import { RmqAckInterceptor } from './rmq/rmq-ack.interceptor';
import { RmqEventExceptionFilter } from './rmq/rmq-event-exception.filter';

/**
 * Nhận event từ queue thông báo (RabbitMQ) bằng @EventPattern: phía phát không chờ
 * phản hồi. Chỉ đăng ký trên transport RMQ — TCP (dành cho Gateway) không nhận event,
 * không ai tạo được thông báo giả qua cổng TCP.
 */
@Controller()
// ack khi xử lý xong, nack (vào dead-letter queue) khi payload sai hoặc handler lỗi
@UseInterceptors(RmqAckInterceptor)
// Validate payload event. Không chặn field lạ: phía phát thêm field mới vào event thì
// field đó bị bỏ qua, không làm mất cả event
@UsePipes(createRpcValidationPipe({ forbidNonWhitelisted: false }))
// Lỗi chỉ ghi log một lần (ở RmqAckInterceptor)
@UseFilters(RmqEventExceptionFilter)
export class NotificationServiceController {
  constructor(private readonly notifications: NotificationServiceService) {}

  @EventPattern(NOTIFICATION_EVENTS.USER_REGISTERED, Transport.RMQ)
  userRegistered(@Payload() event: UserRegisteredEvent) {
    return this.notifications.handleUserRegistered(event);
  }

  @EventPattern(NOTIFICATION_EVENTS.TASK_CREATED, Transport.RMQ)
  taskCreated(@Payload() event: TaskCreatedEvent) {
    return this.notifications.handleTaskCreated(event);
  }
}
