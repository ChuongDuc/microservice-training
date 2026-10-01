import { ValidationPipe } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

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
        errors: errors.map((e) => ({
          field: e.property,
          constraints: e.constraints,
        })),
      }),
  });
}
