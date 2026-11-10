import {
  ErrorResponse,
  internalErrorResponse,
  toKnownErrorResponse,
} from '@app/common';
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Exception filter toàn cục của Gateway: mọi lỗi trả cho client có cùng dạng
 * `{ statusCode, message, errors? }` (ErrorResponse) — giống lỗi các service trả qua TCP
 * mà sendRpc() chuyển tiếp.
 *
 * - HttpException (guard, ValidationPipe, sendRpc, 404 route không tồn tại, 429...):
 *   giữ status, bỏ field `error: 'Bad Request'` mặc định của Nest, `message` luôn là chuỗi.
 * - Lỗi body-parser (JSON sai cú pháp, body quá lớn): giữ status 4xx của nó.
 * - Lỗi lạ: ghi log kèm stack, trả 500 chung — không lộ chi tiết nội bộ.
 */
@Catch()
export class AllHttpExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const body: ErrorResponse =
      toKnownErrorResponse(exception) ?? this.unexpected(exception, request);

    // Lỗi xảy ra sau khi đã gửi header (vd: đang stream) thì không gửi body lỗi được
    if (response.headersSent) return;
    response.status(body.statusCode).json(body);
  }

  private unexpected(exception: unknown, request: Request): ErrorResponse {
    this.logger.error(
      `Lỗi không xử lý được: ${request.method} ${request.originalUrl ?? request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return internalErrorResponse();
  }
}
