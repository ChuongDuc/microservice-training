import {
  AUTH_PATTERNS,
  AUTH_SERVICE,
  AuthUserDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
} from '@app/common';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { sendRpc } from '../rpc/send-rpc';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';

/**
 * REST `/auth/*`: forward body xuống AUTH SERVICE qua TCP. Validate payload do Auth
 * Service đảm nhận (lỗi 400 kèm chi tiết field được trả nguyên về client).
 * register/login/refresh/logout công khai (@Public); `/auth/me` cần access token.
 */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authClient: ClientProxy) {}

  @Public()
  @Post('register') // 201
  register(@Body() dto: RegisterDto) {
    return this.send(AUTH_PATTERNS.REGISTER, dto);
  }

  @Public()
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
