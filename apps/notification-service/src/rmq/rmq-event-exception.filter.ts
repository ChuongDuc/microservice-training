import { Catch, RpcExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';

/**
 * Exception filter cho handler event (RabbitMQ): event không có phía chờ phản hồi nên
 * không cần chuẩn hoá body lỗi như AllRpcExceptionsFilter; chỉ chuyển lỗi đi tiếp,
 * KHÔNG ghi log — RmqAckInterceptor đã ghi log và nack. Thiếu filter này, filter mặc
 * định của Nest ghi log lỗi thêm một lần nữa.
 */
@Catch()
export class RmqEventExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(exception: unknown): Observable<never> {
    return throwError(() => exception);
  }
}
