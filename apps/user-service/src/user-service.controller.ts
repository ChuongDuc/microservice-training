import {
  CreateUserDto,
  FindUserByEmailDto,
  FindUserByIdDto,
  ListUsersDto,
  UpdateUserPayloadDto,
  USER_PATTERNS,
} from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserServiceService } from './user-service.service';

/**
 * Nhận message TCP cho User Service. Payload đã được validate bởi
 * createRpcValidationPipe() (đăng ký global trong main.ts) theo DTO tương ứng.
 */
@Controller()
export class UserServiceController {
  constructor(private readonly userService: UserServiceService) {}

  @MessagePattern(USER_PATTERNS.CREATE)
  create(@Payload() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @MessagePattern(USER_PATTERNS.FIND_BY_ID)
  findById(@Payload() { id }: FindUserByIdDto) {
    return this.userService.findById(id);
  }

  @MessagePattern(USER_PATTERNS.FIND_BY_EMAIL)
  findByEmail(@Payload() { email }: FindUserByEmailDto) {
    return this.userService.findByEmail(email);
  }

  @MessagePattern(USER_PATTERNS.UPDATE)
  update(@Payload() { id, data }: UpdateUserPayloadDto) {
    return this.userService.update(id, data);
  }

  @MessagePattern(USER_PATTERNS.LIST)
  list(@Payload() dto: ListUsersDto) {
    return this.userService.list(dto);
  }
}
