import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Dữ liệu đăng nhập (message `auth.login`). */
export class LoginDto {
  // Chuẩn hoá giống RegisterDto để "An@x.com" đăng nhập được tài khoản "an@x.com"
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  // Không kiểm tra MinLength: sai mật khẩu thì trả 401 chung, không gợi ý luật mật khẩu
  @IsString()
  @IsNotEmpty()
  @MaxLength(128) // chặn chuỗi quá dài làm tốn CPU khi verify
  password: string;
}

/** Cặp token trả về khi đăng nhập. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Nội dung (payload) của access token. `sub` là userId. */
export interface JwtPayload {
  sub: string;
  role: string;
}
