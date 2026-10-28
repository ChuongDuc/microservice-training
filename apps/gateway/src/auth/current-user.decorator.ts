import { AuthUserDto } from '@app/common';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Request đã qua JwtAuthGuard: `user` là danh tính lấy từ access token. */
export interface AuthenticatedRequest extends Request {
  user: AuthUserDto;
}

/**
 * Lấy danh tính người gọi (`userId`, `role`) mà JwtAuthGuard gắn vào request, dùng để
 * truyền xuống service trong qua payload `{ user, data }`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserDto =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
