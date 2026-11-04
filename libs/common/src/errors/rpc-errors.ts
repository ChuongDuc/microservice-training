import { RpcException } from '@nestjs/microservices';

/**
 * Lỗi Prisma có mã `code` (vd: P2002 trùng unique, P2025 không tìm thấy bản ghi).
 * Kiểm tra theo `name` thay vì `instanceof`: mỗi service có PrismaClient generate riêng
 * nên class lỗi của từng service khác nhau, helper dùng chung không import được.
 */
export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'PrismaClientKnownRequestError' &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Lỗi nghiệp vụ gửi qua TCP: `{ statusCode, message }` để Gateway trả đúng HTTP status.
 * Không dùng HttpException — qua TCP phía gọi chỉ nhận "Internal server error".
 */
export function rpcError(statusCode: number, message: string): RpcException {
  return new RpcException({ statusCode, message });
}
