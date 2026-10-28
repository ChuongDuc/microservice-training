import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Tham số phân trang dùng chung (`user.list`, `task.find_all`...).
 * `@Type(() => Number)` để chấp nhận cả giá trị dạng chuỗi (vd: query string từ Gateway).
 */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // chặn việc kéo cả bảng trong một lần gọi
  limit: number = 10;
}

/** Kết quả trả về của các message danh sách có phân trang. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
