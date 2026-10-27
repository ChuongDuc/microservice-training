import {
  AUTH_PATTERNS,
  AUTH_SERVICE,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
} from '@app/common';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { sendRpc } from '../rpc/send-rpc';

/**
 * REST `/auth/*`: forward body xuống AUTH SERVICE qua TCP. Validate payload do Auth
 * Service đảm nhận (lỗi 400 kèm chi tiết field được trả nguyên về client).
 */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authClient: ClientProxy) {}

  @Post('register') // 201
  register(@Body() dto: RegisterDto) {
    return this.send(AUTH_PATTERNS.REGISTER, dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.send(AUTH_PATTERNS.LOGIN, dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.send(AUTH_PATTERNS.REFRESH, dto);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.send(AUTH_PATTERNS.LOGOUT, dto);
  }

  private send(pattern: string, payload: unknown) {
    return sendRpc(this.authClient, pattern, payload, 'Auth Service');
  }
}
