import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Dữ liệu đăng ký tài khoản (message `auth.register`).
 * `email` + `displayName` được chuyển sang USER SERVICE để tạo hồ sơ;
 * `password` chỉ ở lại AUTH SERVICE (lưu dưới dạng hash).
 */
export class RegisterDto {
  // Chuẩn hoá (trim + chữ thường): unique của Postgres phân biệt hoa/thường,
  // không chuẩn hoá thì "An@x.com" và "an@x.com" thành 2 tài khoản khác nhau.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  // KHÔNG trim password: khoảng trắng là một phần của mật khẩu người dùng chọn
  @IsString()
  @MinLength(8)
  @MaxLength(128) // chặn chuỗi quá dài làm tốn CPU khi hash
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName: string;
}
