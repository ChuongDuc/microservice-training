import { TaskCreatedEvent, UserRegisteredEvent } from '@app/common';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Xử lý event nhận từ RabbitMQ. Hiện chỉ ghi log để xác nhận đã nhận; lưu thông báo
 * theo user và API xem danh sách làm ở bước sau (#27).
 */
@Injectable()
export class NotificationServiceService {
  private readonly logger = new Logger(NotificationServiceService.name);

  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    this.logger.log(`Nhận user.registered: user ${event.userId}`);
  }

  async handleTaskCreated(event: TaskCreatedEvent): Promise<void> {
    this.logger.log(
      `Nhận task.created: task ${event.taskId} của user ${event.ownerId}`,
    );
  }
}
