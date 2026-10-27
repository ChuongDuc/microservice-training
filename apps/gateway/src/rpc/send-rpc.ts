import { HttpException, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { types } from 'util';

/**
 * Thời gian tối đa chờ một service phía trong phản hồi. Phải lớn hơn timeout các
 * service gọi nhau (vd: Auth -> User 5s): nếu bằng nhau, Gateway trả 503 trong khi
 * Auth vẫn chạy tiếp và ghi dữ liệu (refresh đã thu hồi token cũ, client mất token mới).
 */
export const RPC_TIMEOUT_MS = 8000;

const logger = new Logger('SendRpc');

/**
 * Gửi message TCP tới service phía trong và đổi lỗi RPC sang lỗi HTTP:
 * - Lỗi nghiệp vụ `{ statusCode, message, ... }` (RpcException) -> HttpException cùng
 *   statusCode, body giữ nguyên (vd: 400 kèm `errors` chi tiết từng field).
 * - Timeout, không kết nối được (lỗi tầng transport, là `Error`) -> 503.
 * - Service trả lỗi không có statusCode hợp lệ (lỗi nội bộ của service) -> 500.
 */
export async function sendRpc<T>(
  client: ClientProxy,
  pattern: string,
  payload: unknown,
  serviceName: string,
): Promise<T> {
  try {
    return await firstValueFrom(
      client.send<T>(pattern, payload).pipe(timeout(RPC_TIMEOUT_MS)),
    );
  } catch (error) {
    if (hasErrorStatusCode(error)) {
      throw new HttpException(error, error.statusCode);
    }

    const unavailable = isTransportError(error);
    logger.error(
      `${unavailable ? 'Không gọi được' : 'Lỗi nội bộ ở'} ${serviceName} (${pattern})`,
      describeError(error),
    );
    const statusCode = unavailable ? 503 : 500;
    throw new HttpException(
      {
        statusCode,
        message: unavailable
          ? `${serviceName} không khả dụng`
          : `${serviceName} gặp lỗi nội bộ`,
      },
      statusCode,
    );
  }
}

/**
 * Lỗi tầng transport: timeout, lỗi socket của Node (ECONNREFUSED...) hoặc
 * `Error('Connection closed')` của ClientTCP. Lỗi do service trả về đi qua TCP dưới
 * dạng JSON nên là object thường. Dùng isNativeError thay vì `instanceof Error` vì
 * lỗi socket có thể được tạo ở realm khác (vd: vm context của jest).
 */
function isTransportError(error: unknown): boolean {
  return error instanceof TimeoutError || types.isNativeError(error);
}

/** Lỗi có statusCode là mã lỗi HTTP hợp lệ (400–599). */
function hasErrorStatusCode(error: unknown): error is { statusCode: number } {
  if (typeof error !== 'object' || error === null) return false;
  const { statusCode } = error as { statusCode?: unknown };
  return (
    Number.isInteger(statusCode) &&
    (statusCode as number) >= 400 &&
    (statusCode as number) <= 599
  );
}

/** Chuỗi mô tả lỗi để ghi log: stack nếu là Error, JSON nếu là object thường. */
function describeError(error: unknown): string {
  if (isTransportError(error)) {
    const { stack, message } = error as Error;
    return stack ?? message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
