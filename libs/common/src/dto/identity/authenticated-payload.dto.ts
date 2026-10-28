import { Type as NestType } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsUUID, ValidateNested } from 'class-validator';

/** Các role hợp lệ (đồng bộ với enum Role trong schema Prisma của User Service). */
export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const isUserRole = (value: unknown): value is UserRole =>
  (USER_ROLES as readonly unknown[]).includes(value);

/**
 * Danh tính người gọi: Gateway lấy từ access token đã verify rồi truyền xuống
 * service trong. Service trong tin danh tính này mà không kiểm tra lại, nên chỉ Gateway
 * được phép gọi tới: service nghe 127.0.0.1 (`*_SERVICE_BIND_HOST`), trong Docker
 * không publish cổng TCP ra ngoài.
 */
export class AuthUserDto {
  @IsUUID()
  userId: string;

  @IsIn(USER_ROLES)
  role: UserRole;
}

/**
 * Payload message cần biết người gọi: `{ user }`. TCP của NestJS không có
 * header/metadata nên danh tính đi trong payload, tách riêng khỏi dữ liệu nghiệp vụ.
 */
export class AuthenticatedPayloadDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => AuthUserDto)
  user: AuthUserDto;
}

/**
 * Tạo DTO payload `{ user, data }` cho message có dữ liệu nghiệp vụ, validate cả hai.
 * Vd: `class CreateTaskPayloadDto extends WithAuthUser(CreateTaskDto) {}`.
 */
export function WithAuthUser<T>(DataDto: NestType<T>) {
  class PayloadWithData extends AuthenticatedPayloadDto {
    @IsDefined()
    @ValidateNested()
    @Type(() => DataDto)
    data: T;
  }
  return PayloadWithData;
}
