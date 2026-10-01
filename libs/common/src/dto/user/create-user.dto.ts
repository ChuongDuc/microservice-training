import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Dữ liệu tạo hồ sơ người dùng (message `user.create`).
 * Không có `role`/`status` (dùng default trong DB, admin đổi sau) và không có `password`
 * (thông tin xác thực thuộc AUTH SERVICE).
 */
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName: string;

  @IsOptional()
  @IsUrl()
  avatar?: string;
}
