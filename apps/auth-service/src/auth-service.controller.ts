import { AUTH_PATTERNS, RegisterDto } from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthServiceService } from './auth-service.service';

/**
 * Nhận message TCP cho Auth Service. Payload được validate bởi
 * createRpcValidationPipe() theo DTO tương ứng.
 */
@Controller()
export class AuthServiceController {
  constructor(private readonly authService: AuthServiceService) {}

  @MessagePattern(AUTH_PATTERNS.REGISTER)
  register(@Payload() dto: RegisterDto) {
    return this.authService.register(dto);
  }
}
