import {
  NOTIFICATION_EVENTS,
  TaskCreatedEvent,
  UserRegisteredEvent,
} from '@app/common';
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { NotificationServiceService } from './notification-service.service';

/**
 * Nhận event từ queue thông báo (RabbitMQ) bằng @EventPattern: phía phát không chờ
 * phản hồi. Payload được validate theo DTO (pipe đăng ký trong module); ack/nack do
 * RmqAckInterceptor đảm nhận.
 */
@Controller()
export class NotificationServiceController {
  constructor(private readonly notifications: NotificationServiceService) {}

  @EventPattern(NOTIFICATION_EVENTS.USER_REGISTERED)
  userRegistered(@Payload() event: UserRegisteredEvent) {
    return this.notifications.handleUserRegistered(event);
  }

  @EventPattern(NOTIFICATION_EVENTS.TASK_CREATED)
  taskCreated(@Payload() event: TaskCreatedEvent) {
    return this.notifications.handleTaskCreated(event);
  }
}
