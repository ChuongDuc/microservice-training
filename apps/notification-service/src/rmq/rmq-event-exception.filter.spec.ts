import { Logger } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { RmqEventExceptionFilter } from './rmq-event-exception.filter';

describe('RmqEventExceptionFilter', () => {
  it('chuyển lỗi đi tiếp nguyên vẹn, không ghi log (interceptor đã ghi)', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const exception = new Error('db down');

    await expect(
      lastValueFrom(new RmqEventExceptionFilter().catch(exception)),
    ).rejects.toBe(exception);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
