import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

/**
 * Dữ liệu cập nhật hồ sơ (message `user.update`): mọi field đều tuỳ chọn.
 * Không cho đổi `email` vì email gắn với tài khoản đăng nhập bên AUTH SERVICE.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email'] as const),
) {}
