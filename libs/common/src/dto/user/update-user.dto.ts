import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * Dữ liệu cập nhật hồ sơ (message `user.update`): mọi field đều tuỳ chọn.
 * Không cho đổi `email` vì email gắn với tài khoản đăng nhập bên AUTH SERVICE.
 * `avatar: null` hợp lệ (xoá ảnh đại diện, cột nullable).
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'displayName'] as const),
) {
  // Không dùng @IsOptional(): nó bỏ qua cả `null`, null đi thẳng xuống Prisma và cột
  // NOT NULL ném lỗi 500. Chỉ bỏ qua khi không gửi field (undefined).
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName?: string;
}
