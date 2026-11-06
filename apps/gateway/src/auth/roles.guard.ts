import { UserRole } from '@app/common';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './current-user.decorator';
import { ROLES_KEY } from './roles.decorator';

/**
 * Guard toàn cục, chạy SAU JwtAuthGuard: route có @Roles(...) chỉ cho qua khi role
 * trong access token (`request.user.role`) nằm trong danh sách, ngược lại 403. Route
 * không gắn @Roles() thì chỉ cần đăng nhập (JwtAuthGuard đã kiểm tra).
 *
 * Role lấy từ token, không hỏi User Service: đổi role (vd: hạ ADMIN xuống USER) chỉ có
 * hiệu lực khi người đó lấy access token mới — tối đa JWT_ACCESS_EXPIRES_IN (15 phút).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles) return true;

    // JwtAuthGuard luôn verify token cho route có @Roles() (kể cả @Public()), nên thiếu
    // user ở đây chỉ khi guard bị đăng ký sai thứ tự: chặn thay vì cho qua
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập tài nguyên này',
      );
    }
    return true;
  }
}
