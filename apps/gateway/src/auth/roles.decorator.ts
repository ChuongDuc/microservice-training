import { UserRole } from '@app/common';
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Giới hạn route cho các role được liệt kê, RolesGuard (toàn cục) kiểm tra theo role
 * trong access token. Gắn ở controller hoặc ở từng route; gắn ở cả hai thì route
 * thắng (vd: controller `@Roles('ADMIN')`, một route `@Roles('USER', 'ADMIN')`).
 * Bắt buộc ít nhất một role: `@Roles()` rỗng là lỗi biên dịch, không thành "ai cũng qua".
 */
export const Roles = (...roles: [UserRole, ...UserRole[]]) =>
  SetMetadata(ROLES_KEY, roles);
