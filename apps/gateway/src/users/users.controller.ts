import {
  AuthenticatedPayloadDto,
  AuthUserDto,
  USER_PATTERNS,
  USER_SERVICE,
} from '@app/common';
import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CurrentUser } from '../auth/current-user.decorator';
import { sendRpc } from '../rpc/send-rpc';

/**
 * REST `/users/*` (cần access token): forward xuống USER SERVICE qua TCP, payload
 * kèm danh tính người gọi `{ user }` lấy từ token — không lấy từ body/query.
 */
@Controller('users')
export class UsersController {
  constructor(@Inject(USER_SERVICE) private readonly userClient: ClientProxy) {}

  /** Hồ sơ đầy đủ của người gọi, User Service tra theo `user.userId`. */
  @Get('me')
  me(@CurrentUser() user: AuthUserDto) {
    const payload: AuthenticatedPayloadDto = { user };
    return sendRpc(
      this.userClient,
      USER_PATTERNS.FIND_ME,
      payload,
      'User Service',
    );
  }
}
