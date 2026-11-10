import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { RmqContext, RpcException } from '@nestjs/microservices';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RmqAckInterceptor } from './rmq-ack.interceptor';

describe('RmqAckInterceptor', () => {
  const interceptor = new RmqAckInterceptor();
  const message = { content: Buffer.from('{}') };
  const channel = { ack: jest.fn(), nack: jest.fn() };

  const contextOf = (rpcContext: unknown, type = 'rpc') =>
    ({
      getType: () => type,
      switchToRpc: () => ({ getContext: () => rpcContext }),
    }) as unknown as ExecutionContext;
  const rmqContext = () =>
    new RmqContext([message, channel, 'task.created'] as never);
  const handler = (result: CallHandler['handle']) => ({ handle: result });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('handler xong -> ack đúng message, không nack', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextOf(rmqContext()),
        handler(() => of(undefined)),
      ),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it.each([
    ['lỗi validate', new RpcException({ statusCode: 400, message: 'x' })],
    ['handler ném lỗi', new Error('db down')],
  ])(
    '%s -> nack không requeue (tránh lặp vô hạn), lỗi vẫn ném tiếp',
    async (_n, error) => {
      await expect(
        lastValueFrom(
          interceptor.intercept(
            contextOf(rmqContext()),
            handler(() => throwError(() => error)),
          ),
        ),
      ).rejects.toBe(error);
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(channel.ack).not.toHaveBeenCalled();
    },
  );

  it('payload sai -> WARN, lỗi lạ -> ERROR kèm stack (chỉ log một lần)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const error = jest.spyOn(Logger.prototype, 'error');
    const run = (e: unknown) =>
      lastValueFrom(
        interceptor.intercept(
          contextOf(rmqContext()),
          handler(() => throwError(() => e)),
        ),
      ).catch(() => undefined);

    await run(new RpcException({ statusCode: 400, message: 'x' }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    const boom = new Error('db down');
    await run(boom);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('task.created'),
      boom.stack,
    );
  });

  it('không phải RMQ (vd: TCP) -> không đụng tới channel', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextOf({}),
        handler(() => of(1)),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        contextOf(rmqContext(), 'http'),
        handler(() => of(1)),
      ),
    );
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });
});
