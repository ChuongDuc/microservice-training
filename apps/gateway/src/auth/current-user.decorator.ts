import { JwtPayload } from '@app/common';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Request đã qua JwtAuthGuard: `user` là payload của access token. */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/** Lấy payload access token (`sub` = userId, `role`) mà JwtAuthGuard gắn vào request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
