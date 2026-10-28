import { RpcException } from '@nestjs/microservices';
import { isPrismaErrorCode, rpcError } from './rpc-errors';

describe('isPrismaErrorCode', () => {
  // Giống PrismaClientKnownRequestError (name + code); lỗi Prisma thật được kiểm tra
  // trong unit test của từng service (mỗi service có client generate riêng)
  const prismaError = (code: string) =>
    Object.assign(new Error('x'), {
      name: 'PrismaClientKnownRequestError',
      code,
    });

  it('đúng lỗi Prisma + đúng mã -> true', () => {
    expect(isPrismaErrorCode(prismaError('P2025'), 'P2025')).toBe(true);
  });

  it.each([
    ['khác mã', prismaError('P2002')],
    ['Error thường có code', Object.assign(new Error('x'), { code: 'P2025' })],
    ['object thường', { code: 'P2025' }],
    ['null', null],
    ['chuỗi', 'P2025'],
  ])('%s -> false', (_case, error) => {
    expect(isPrismaErrorCode(error, 'P2025')).toBe(false);
  });
});

describe('rpcError', () => {
  it('RpcException mang { statusCode, message }', () => {
    const error = rpcError(404, 'Không tìm thấy');
    expect(error).toBeInstanceOf(RpcException);
    expect(error.getError()).toEqual({
      statusCode: 404,
      message: 'Không tìm thấy',
    });
  });
});
