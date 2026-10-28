import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsDate,
  isISO8601,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../pagination.dto';
import { WithAuthUser } from '../identity/authenticated-payload.dto';

/** Đồng bộ với enum TaskStatus / TaskPriority trong schema Prisma của Task Service. */
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Giới hạn khớp cột DB: title varchar(200). */
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 2000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi ISO 8601 hợp lệ -> Date; giá trị khác giữ nguyên để @IsDate() từ chối. */
const toIsoDate = ({ value }: { value: unknown }) =>
  typeof value === 'string' && isISO8601(value, { strict: true })
    ? new Date(value)
    : value;

/**
 * Dữ liệu tạo task. Không có `ownerId`: Task Service gắn theo danh tính người gọi
 * (`user.userId`), client không tự chọn chủ task được.
 */
export class CreateTaskDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  // Chỉ nhận chuỗi ISO 8601 (qua TCP/JSON), không kèm múi giờ thì hiểu là UTC.
  // Không dùng @Type(() => Date): nó chạy new Date(value) với mọi kiểu, `true`/`0`
  // thành ngày 1970 mà vẫn qua @IsDate().
  @IsOptional()
  @Transform(toIsoDate)
  @IsDate({ message: 'dueDate phải là chuỗi ngày giờ ISO 8601' })
  dueDate?: Date | null;
}

/**
 * Dữ liệu cập nhật task: mọi field tuỳ chọn. `description`/`dueDate: null` để xoá
 * (cột nullable); `title`/`status`/`priority` là cột NOT NULL nên chặn `null` —
 * không dùng @IsOptional() (bỏ qua cả null, lọt xuống Prisma thành 500). Ba field này
 * phải Omit trước khi khai báo lại, nếu không @IsOptional() của PartialType vẫn còn.
 */
export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['title', 'status', 'priority'] as const),
) {
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;
}

/** Id của một task. */
export class TaskIdDto {
  @IsUUID()
  id: string;
}

/** Dữ liệu message `task.update`: id + các field cần đổi. */
export class UpdateTaskDataDto extends UpdateTaskDto {
  @IsUUID()
  id: string;
}

/** Bộ lọc + phân trang cho `task.find_all`. */
export class ListTasksDto extends PaginationDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;
}

// Payload các message TASK_PATTERNS: `{ user, data }` (danh tính người gọi từ Gateway).
export class CreateTaskPayloadDto extends WithAuthUser(CreateTaskDto) {}
export class ListTasksPayloadDto extends WithAuthUser(ListTasksDto) {}
export class TaskIdPayloadDto extends WithAuthUser(TaskIdDto) {}
export class UpdateTaskPayloadDto extends WithAuthUser(UpdateTaskDataDto) {}
