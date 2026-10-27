import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Đánh dấu route công khai: JwtAuthGuard (đăng ký toàn cục) bỏ qua, không cần
 * access token. Mặc định mọi route đều cần token, route mới quên đánh dấu vẫn an toàn.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
