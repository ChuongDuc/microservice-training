import {
  ArgumentsHost,
  Catch,
  Logger,
  RpcExceptionFilter,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import {
  ErrorResponse,
  internalErrorResponse,
  isErrorStatusCode,
  normalizeErrorBody,
  toKnownErrorResponse,
} from './error-response';

/**
 * Exception filter toàn cục cho các microservice (TCP): mọi lỗi trả về phía gọi đều có
 * dạng ErrorResponse `{ statusCode, message, errors? }`, để Gateway trả đúng HTTP status.
 *
 * Filter mặc định của Nest chỉ giữ nguyên lỗi của RpcException; HttpException (vd:
 * `throw new NotFoundException()` trong service) hay lỗi lạ đều thành
 * `{ status: 'error', message: 'Internal server error' }` — mất statusCode.
 */
@Catch()
export class AllRpcExceptionsFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('RpcException');

  catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    const body = this.toErrorResponse(exception, host);
    return throwError(() => body);
  }

  private toErrorResponse(
    exception: unknown,
    host: ArgumentsHost,
  ): ErrorResponse {
    if (exception instanceof RpcException) {
      const error = exception.getError();
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
      // rpcError() / createRpcValidationPipe() luôn kèm statusCode hợp lệ
      if (
        typeof error === 'object' &&
        error !== null &&
        isErrorStatusCode(statusCode)
      ) {
        return normalizeErrorBody(statusCode, error, exception.message);
      }
    } else {
      const known = toKnownErrorResponse(exception);
      if (known) return known;
    }

    // RpcException không có statusCode hoặc lỗi lạ: ghi log, trả 500 chung
    const pattern = this.patternOf(host);
    this.logger.error(
      `Lỗi không xử lý được${pattern ? ` (${pattern})` : ''}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );
    return internalErrorResponse();
  }

  private patternOf(host: ArgumentsHost): string | undefined {
    try {
      const pattern: unknown = host.switchToRpc().getContext()?.getPattern?.();
      return typeof pattern === 'string' ? pattern : undefined;
    } catch {
      return undefined;
    }
  }
}
