import { HttpException, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NEVER, of, throwError } from 'rxjs';
import { runInNewContext } from 'vm';
import { RPC_TIMEOUT_MS, sendRpc } from './send-rpc';

describe('sendRpc', () => {
  const client = { send: jest.fn() };
  let logError: jest.SpyInstance;
  const call = () =>
    sendRpc(client as unknown as ClientProxy, 'auth.login', { a: 1 }, 'Auth');

  const callError = async (): Promise<HttpException> => {
    try {
      await call();
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('Expected sendRpc to fail');
  };

  beforeEach(() => {
    jest.resetAllMocks();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.useRealTimers());

  it('trả kết quả của service, gửi đúng pattern + payload', async () => {
    client.send.mockReturnValue(of({ ok: true }));

    await expect(call()).resolves.toEqual({ ok: true });
    expect(client.send).toHaveBeenCalledWith('auth.login', { a: 1 });
  });

  it('lỗi nghiệp vụ có statusCode -> HttpException cùng status, giữ nguyên body', async () => {
    const rpcError = {
      statusCode: 400,
      message: 'Validation failed',
      errors: [{ field: 'email', constraints: { isEmail: 'email' } }],
    };
    client.send.mockReturnValue(throwError(() => rpcError));

    const error = await callError();
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual(rpcError);
    expect(logError).not.toHaveBeenCalled();
  });

  it('không kết nối được service -> 503', async () => {
    client.send.mockReturnValue(
      throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:4001')),
    );

    const error = await callError();
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({
      statusCode: 503,
      message: 'Auth không khả dụng',
    });
  });

  it('ClientTCP báo "Connection closed" -> 503', async () => {
    client.send.mockReturnValue(
      throwError(() => new Error('Connection closed')),
    );

    expect((await callError()).getStatus()).toBe(503);
  });

  it('lỗi socket tạo ở realm khác (không instanceof Error) -> 503', async () => {
    const foreignError = runInNewContext(
      'Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })',
    );
    expect(foreignError).not.toBeInstanceOf(Error);
    client.send.mockReturnValue(throwError(() => foreignError));

    expect((await callError()).getStatus()).toBe(503);
  });

  it('service không phản hồi -> 503 sau RPC_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    client.send.mockReturnValue(NEVER);

    const pending = callError();
    jest.advanceTimersByTime(RPC_TIMEOUT_MS);

    expect((await pending).getStatus()).toBe(503);
  });

  it('timeout của Gateway lớn hơn timeout Auth -> User (5s)', () => {
    expect(RPC_TIMEOUT_MS).toBeGreaterThan(5000);
  });

  it('service lỗi nội bộ (object không có statusCode) -> 500, log có nội dung lỗi', async () => {
    client.send.mockReturnValue(
      throwError(() => ({
        status: 'error',
        message: 'Internal server error',
      })),
    );

    const error = await callError();
    expect(error.getStatus()).toBe(500);
    expect(error.getResponse()).toEqual({
      statusCode: 500,
      message: 'Auth gặp lỗi nội bộ',
    });
    expect(logError).toHaveBeenCalledWith(
      'Lỗi nội bộ ở Auth (auth.login)',
      '{"status":"error","message":"Internal server error"}',
    );
  });

  it.each([0, 200, 302, 1000, 404.5, '404'])(
    'statusCode không phải mã lỗi HTTP hợp lệ (%p) -> 500',
    async (statusCode) => {
      client.send.mockReturnValue(
        throwError(() => ({ statusCode, message: 'x' })),
      );

      expect((await callError()).getStatus()).toBe(500);
    },
  );
});
