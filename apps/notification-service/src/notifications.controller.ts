import {
  AllRpcExceptionsFilter,
  createRpcValidationPipe,
  ListNotificationsPayloadDto,
  NOTIFICATION_PATTERNS,
} from '@app/common';
import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { NotificationServiceService } from './notification-service.service';

/**
 * Message TCP từ Gateway (request-response), payload `{ user, data }`: chỉ trả thông
 * báo của người gọi. Validate chặt như các service TCP khác, lỗi trả về theo dạng
 * thống nhất `{ statusCode, message, errors? }`.
 */
@Controller()
@UsePipes(createRpcValidationPipe())
@UseFilters(AllRpcExceptionsFilter)
export class NotificationsController {
  constructor(private readonly notifications: NotificationServiceService) {}

  @MessagePattern(NOTIFICATION_PATTERNS.FIND_ALL, Transport.TCP)
  findAll(@Payload() { user, data }: ListNotificationsPayloadDto) {
    return this.notifications.findAll(user, data);
  }
}
