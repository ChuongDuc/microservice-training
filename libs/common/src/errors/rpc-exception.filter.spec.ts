import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { createRpcValidationPipe } from '../pipes';
import { rpcError } from './rpc-errors';
import { AllRpcExceptionsFilter } from './rpc-exception.filter';

describe('AllRpcExceptionsFilter', () => {
  const filter = new AllRpcExceptionsFilter();
  const host = {
    switchToRpc: () => ({
      getContext: () => ({ getPattern: () => 'task.create' }),
    }),
  } as unknown as ArgumentsHost;
  let logError: jest.SpyInstance;

  /** Lỗi filter trả về phía gọi (qua TCP). */
  const errorOf = async (exception: unknown) => {
    try {
      await lastValueFrom(filter.catch(exception, host));
    } catch (error) {
      return error;
    }
    throw new Error('Expected filter to emit an error');
  };

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('rpcError() -> giữ nguyên { statusCode, message }', async () => {
    await expect(
      errorOf(rpcError(404, 'Không tìm thấy task')),
    ).resolves.toEqual({
      statusCode: 404,
      message: 'Không tìm thấy task',
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('lỗi validate -> 400 kèm errors', async () => {
    const pipe = createRpcValidationPipe();
    class Dto {}
    const exception = await pipe
      .transform({ x: 1 }, { type: 'body', metatype: Dto })
      .catch((e: unknown) => e);

    await expect(errorOf(exception)).resolves.toEqual({
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        expect.objectContaining({
          field: 'x',
          constraints: expect.objectContaining({
            whitelistValidation: expect.any(String),
          }),
        }),
      ],
    });
  });

  it('HttpException ném trong service -> giữ status (mặc định Nest thành 500)', async () => {
    await expect(errorOf(new NotFoundException('Không thấy'))).resolves.toEqual(
      {
        statusCode: 404,
        message: 'Không thấy',
      },
    );
  });

  it.each([
    ['lỗi lạ', new Error('connection string ...')],
    ['RpcException chuỗi', new RpcException('lỗi nội bộ')],
    [
      'RpcException statusCode sai',
      new RpcException({ statusCode: 200, message: 'x' }),
    ],
  ])('%s -> 500 chung + ghi log kèm pattern', async (_name, exception) => {
    await expect(errorOf(exception)).resolves.toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('task.create'),
      expect.anything(),
    );
  });
});
