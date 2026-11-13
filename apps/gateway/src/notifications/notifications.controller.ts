import {
  AuthUserDto,
  ListNotificationsDto,
  NOTIFICATION_PATTERNS,
  NOTIFICATION_SERVICE,
} from '@app/common';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CurrentUser } from '../auth/current-user.decorator';
import { sendRpc } from '../rpc/send-rpc';

/**
 * REST `/notifications` (cần access token): thông báo của người gọi, forward xuống
 * NOTIFICATION SERVICE qua TCP với payload `{ user, data }` — `user` lấy từ token nên
 * không xem được thông báo của người khác.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATION_SERVICE) private readonly client: ClientProxy,
  ) {}

  /** Danh sách thông báo, mới nhất trước: `?page=&limit=`. */
  @Get()
  findAll(
    @CurrentUser() user: AuthUserDto,
    @Query() query: ListNotificationsDto,
  ) {
    return sendRpc(
      this.client,
      NOTIFICATION_PATTERNS.FIND_ALL,
      { user, data: query },
      'Notification Service',
    );
  }
}
