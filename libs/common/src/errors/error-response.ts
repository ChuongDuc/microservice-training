import { HttpException } from '@nestjs/common';

/**
 * Cấu trúc lỗi thống nhất của toàn hệ thống: Gateway trả cho client và các service trả
 * qua TCP đều theo dạng này.
 * - `statusCode`: mã HTTP (400–599).
 * - `message`: mô tả ngắn, luôn là chuỗi.
 * - `errors`: chỉ có với lỗi validate — danh sách `{ field, constraints }`.
 */
export interface ErrorResponse {
  statusCode: number;
  message: string;
  errors?: unknown[];
}

export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** Mã lỗi HTTP hợp lệ (400–599). */
export function isErrorStatusCode(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 400 && Number(value) <= 599
  );
}

/**
 * Đổi body lỗi bất kỳ (của HttpException, RpcException...) sang ErrorResponse với
 * `statusCode` cho trước. Body mặc định của Nest có thêm `error: 'Bad Request'` và
 * `message` có thể là mảng chuỗi — cả hai được chuẩn hoá ở đây.
 */
export function normalizeErrorBody(
  statusCode: number,
  body: unknown,
  fallbackMessage: string,
): ErrorResponse {
  const result: ErrorResponse = {
    statusCode,
    message: fallbackMessage,
  };

  if (typeof body === 'string') {
    if (body) result.message = body;
    return result;
  }
  if (typeof body !== 'object' || body === null) return result;

  const { message, errors } = body as { message?: unknown; errors?: unknown };
  if (typeof message === 'string' && message) {
    result.message = message;
  } else if (Array.isArray(message) && message.length > 0) {
    result.message = message.map(String).join('; ');
  }
  if (Array.isArray(errors)) result.errors = errors;
  return result;
}

/**
 * Lỗi đã biết -> ErrorResponse; trả `undefined` nếu là lỗi lạ (bug, lỗi DB...), để nơi
 * gọi ghi log và trả 500 chung — không lộ chi tiết nội bộ cho client.
 * - HttpException: lấy status + body của nó.
 * - Lỗi theo chuẩn http-errors có `expose: true` (vd: body-parser báo JSON sai -> 400,
 *   body quá lớn -> 413): thông điệp vốn dành cho client nên giữ nguyên.
 */
export function toKnownErrorResponse(
  exception: unknown,
): ErrorResponse | undefined {
  if (exception instanceof HttpException) {
    return normalizeErrorBody(
      exception.getStatus(),
      exception.getResponse(),
      exception.message,
    );
  }

  if (typeof exception === 'object' && exception !== null) {
    const { status, statusCode, expose, message } = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
      message?: unknown;
    };
    const code = status ?? statusCode;
    if (expose === true && isErrorStatusCode(code)) {
      return normalizeErrorBody(code, { message }, INTERNAL_ERROR_MESSAGE);
    }
  }
  return undefined;
}

/** Body 500 chung cho lỗi không lường trước. */
export function internalErrorResponse(): ErrorResponse {
  return { statusCode: 500, message: INTERNAL_ERROR_MESSAGE };
}
