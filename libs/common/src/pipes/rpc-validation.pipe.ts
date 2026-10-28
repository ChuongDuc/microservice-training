import { ValidationError, ValidationPipe } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

/** Một lỗi validate: `field` là đường dẫn đầy đủ (vd: `data.title`, `user.userId`). */
export interface FieldError {
  field: string;
  constraints: Record<string, string>;
}

/**
 * Trải phẳng lỗi validate thành danh sách theo đường dẫn field. Lỗi của object lồng
 * nhau (@ValidateNested: `{ user, data }`) nằm trong `children`, không có
 * `constraints` ở cấp ngoài — chỉ lấy cấp ngoài thì mất hết chi tiết.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = error.constraints
      ? [{ field, constraints: error.constraints }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/**
 * ValidationPipe dùng cho các microservice (TCP).
 * Mặc định ValidationPipe ném BadRequestException (lỗi HTTP) — qua TCP phía gọi chỉ nhận
 * "Internal server error". Đổi sang RpcException để trả về đủ statusCode + chi tiết lỗi.
 */
export function createRpcValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true, // bỏ field không khai báo trong DTO
    forbidNonWhitelisted: true, // báo lỗi nếu gửi field lạ (vd: role)
    transform: true, // payload -> instance DTO
    exceptionFactory: (errors) =>
      new RpcException({
        statusCode: 400,
        message: 'Validation failed',
        errors: flattenValidationErrors(errors),
      }),
  });
}
