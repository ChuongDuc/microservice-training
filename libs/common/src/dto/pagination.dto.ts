import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Tham số phân trang dùng chung (`user.list`, `task.find_all`...).
 * `@Type(() => Number)` để chấp nhận cả giá trị dạng chuỗi (vd: query string từ Gateway).
 *
 * Khai báo `?` để tài liệu API (Swagger) ghi đúng là tuỳ chọn; sau ValidationPipe
 * (transform) hai field luôn có giá trị nhờ giá trị mặc định.
 */
export class PaginationDto {
  /** Trang, bắt đầu từ 1. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** Số phần tử mỗi trang (tối đa 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // chặn việc kéo cả bảng trong một lần gọi
  limit?: number = 10;
}

/** Kết quả trả về của các message danh sách có phân trang. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
