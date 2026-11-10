import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';
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

export const VALIDATION_FAILED_MESSAGE = 'Validation failed';

/** Body lỗi validate (400) dùng chung cho Gateway (HTTP) và các service (TCP). */
export function validationErrorBody(errors: ValidationError[]) {
  return {
    statusCode: 400,
    message: VALIDATION_FAILED_MESSAGE,
    errors: flattenValidationErrors(errors),
  };
}

/** Tuỳ chọn ValidationPipe dùng chung cho Gateway và các service. */
export const VALIDATION_PIPE_OPTIONS = {
  whitelist: true, // bỏ field không khai báo trong DTO
  forbidNonWhitelisted: true, // báo lỗi nếu gửi field lạ (vd: role, ownerId)
  transform: true, // payload -> instance DTO
} as const;

/**
 * ValidationPipe dùng cho các microservice (TCP).
 * Mặc định ValidationPipe ném BadRequestException (lỗi HTTP) — qua TCP phía gọi chỉ nhận
 * "Internal server error". Đổi sang RpcException để trả về đủ statusCode + chi tiết lỗi.
 *
 * `overrides`: vd Notification Service nhận event với `forbidNonWhitelisted: false` —
 * phía phát thêm field mới vào event thì field đó bị bỏ qua thay vì làm mất cả event.
 */
export function createRpcValidationPipe(
  overrides: Pick<ValidationPipeOptions, 'forbidNonWhitelisted'> = {},
): ValidationPipe {
  return new ValidationPipe({
    ...VALIDATION_PIPE_OPTIONS,
    ...overrides,
    exceptionFactory: (errors) => new RpcException(validationErrorBody(errors)),
  });
}

/**
 * ValidationPipe toàn cục của Gateway (HTTP): chặn request sai ngay ở cửa vào, không
 * tốn một lượt gọi TCP. Lỗi 400 cùng dạng với lỗi validate của các service.
 */
export function createHttpValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    ...VALIDATION_PIPE_OPTIONS,
    exceptionFactory: (errors) =>
      new BadRequestException(validationErrorBody(errors)),
  });
}
