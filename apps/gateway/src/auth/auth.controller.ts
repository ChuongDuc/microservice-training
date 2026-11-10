import {
  AUTH_PATTERNS,
  AUTH_SERVICE,
  AuthUserDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
} from '@app/common';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SkipThrottle } from '@nestjs/throttler';
import { sendRpc } from '../rpc/send-rpc';
import { CurrentUser } from './current-user.decorator';
import { AuthThrottlerGuard } from './login-throttle';
import { Public } from './public.decorator';

/**
 * REST `/auth/*`: forward body xuống AUTH SERVICE qua TCP. Body được validate ở Gateway
 * (ValidationPipe toàn cục, lỗi 400 kèm chi tiết field); Auth Service validate lại.
 * register/login/refresh/logout công khai (@Public); `/auth/me` cần access token.
 */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authClient: ClientProxy) {}

  /** Chỉ giới hạn theo IP: chặn dò email đã đăng ký và tạo tài khoản rác hàng loạt. */
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @SkipThrottle({ default: true })
  @Post('register') // 201
  register(@Body() dto: RegisterDto) {
    return this.send(AUTH_PATTERNS.REGISTER, dto);
  }

  /** Giới hạn theo IP + email và theo IP (chống dò mật khẩu), vượt ngưỡng -> 429. */
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.send(AUTH_PATTERNS.LOGIN, dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.send(AUTH_PATTERNS.REFRESH, dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.send(AUTH_PATTERNS.LOGOUT, dto);
  }

  /** Danh tính lấy từ access token (đã verify ở JwtAuthGuard), không gọi service nào. */
  @Get('me')
  me(@CurrentUser() user: AuthUserDto) {
    return user;
  }

  private send(pattern: string, payload: unknown) {
    return sendRpc(this.authClient, pattern, payload, 'Auth Service');
  }
}
