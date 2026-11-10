import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { RmqContext, RpcException } from '@nestjs/microservices';
import { Observable, tap } from 'rxjs';

/**
 * Ack thủ công cho consumer RabbitMQ (`noAck: false`):
 * - Handler chạy xong -> `ack`: RabbitMQ xoá message khỏi queue.
 * - Lỗi (payload sai do ValidationPipe, handler ném lỗi) -> `nack` không requeue:
 *   RabbitMQ chuyển message vào dead-letter queue (`<queue>.dlq`) để xem lại / xử lý
 *   lại sau. Không requeue vì message lỗi được giao lại ngay và lặp vô hạn.
 * - Service chết trước khi ack: RabbitMQ giao lại message cho lần chạy sau (giao "ít
 *   nhất một lần" — handler chống trùng bằng `eventId`).
 *
 * Interceptor bọc cả pipe lẫn handler, nên lỗi validate cũng đi qua đây. Đây là nơi
 * DUY NHẤT ghi log lỗi của event (exception filter của service không ghi lại lần nữa).
 */
@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RmqAck');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const rmq = context.switchToRpc().getContext<RmqContext>();
    if (!(rmq instanceof RmqContext)) return next.handle();

    const channel = rmq.getChannelRef();
    const message = rmq.getMessage();
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    return next.handle().pipe(
      tap({
        complete: () => settle(() => channel.ack(message)),
        error: (error: unknown) =>
          settle(() => {
            this.logError(rmq.getPattern(), error);
            channel.nack(message, false, false);
          }),
      }),
    );
  }

  /** Payload sai (lỗi 4xx đã biết) -> WARN; lỗi lạ (bug, DB...) -> ERROR kèm stack. */
  private logError(pattern: string, error: unknown): void {
    const prefix = `Chuyển event ${pattern} vào dead-letter queue`;
    if (error instanceof RpcException) {
      this.logger.warn(`${prefix}: ${safeJson(error.getError())}`);
    } else if (error instanceof Error) {
      this.logger.error(`${prefix}: ${error.message}`, error.stack);
    } else {
      this.logger.error(`${prefix}: ${safeJson(error)}`);
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
