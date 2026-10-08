import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Payload message `user.list` (phân trang).
 * `@Type(() => Number)` để chấp nhận cả giá trị dạng chuỗi (vd: query string từ Gateway).
 */
export class ListUsersDto {
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

/** Kết quả trả về của `user.list`. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
