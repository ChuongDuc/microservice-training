import { OmitType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { USER_ROLES, UserRole, WithAuthUser } from '../identity';
import { PaginationDto } from '../pagination.dto';

/** Đồng bộ với enum UserStatus trong schema Prisma của User Service. */
export const USER_STATUSES = ['ACTIVE', 'BLOCKED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_SEARCH_MAX_LENGTH = 100;

/** Trim; chuỗi rỗng (vd: `?search=` khi ô tìm kiếm để trống) coi như không lọc. */
const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
};

/**
 * Bộ lọc danh sách user cho admin (`user.admin.list`): phân trang + tìm theo email
 * hoặc tên hiển thị (không phân biệt hoa thường) + lọc theo role/status.
 */
export class AdminListUsersDto extends PaginationDto {
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(USER_SEARCH_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;
}

/** Đổi role một user (`user.admin.update_role`). */
export class UpdateUserRoleDto {
  @IsUUID()
  id: string;

  @IsIn(USER_ROLES)
  role: UserRole;
}

/** Khoá / mở khoá một user (`user.admin.update_status`). */
export class UpdateUserStatusDto {
  @IsUUID()
  id: string;

  @IsIn(USER_STATUSES)
  status: UserStatus;
}

// Body REST ở Gateway: `id` lấy từ URL, không nhận từ body
export class UpdateUserRoleBodyDto extends OmitType(UpdateUserRoleDto, [
  'id',
] as const) {}
export class UpdateUserStatusBodyDto extends OmitType(UpdateUserStatusDto, [
  'id',
] as const) {}

// Payload các message admin: `{ user, data }`, User Service kiểm tra lại `user.role`.
export class AdminListUsersPayloadDto extends WithAuthUser(AdminListUsersDto) {}
export class UpdateUserRolePayloadDto extends WithAuthUser(UpdateUserRoleDto) {}
export class UpdateUserStatusPayloadDto extends WithAuthUser(
  UpdateUserStatusDto,
) {}
