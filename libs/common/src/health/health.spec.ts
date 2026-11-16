import { Logger } from '@nestjs/common';
import { checkDependencies, overallStatus } from './health';

describe('checkDependencies', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('mọi phụ thuộc resolve -> up', async () => {
    await expect(
      checkDependencies({
        database: async () => 1,
        redis: async () => 'PONG',
      }),
    ).resolves.toEqual({
      status: 'up',
      dependencies: { database: 'up', redis: 'up' },
    });
  });

  it('một phụ thuộc lỗi -> phụ thuộc đó down, service down; không reject', async () => {
    await expect(
      checkDependencies({
        database: async () => 1,
        redis: async () => {
          throw new Error('ECONNREFUSED 10.0.0.5:6379');
        },
      }),
    ).resolves.toEqual({
      status: 'down',
      dependencies: { database: 'up', redis: 'down' },
    });
    // Lỗi chi tiết chỉ ghi log, không nằm trong kết quả
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
    );
  });

  it('phụ thuộc không trả lời -> down sau timeout', async () => {
    const started = Date.now();
    const result = await checkDependencies(
      { database: () => new Promise(() => {}) },
      50,
    );
    expect(result).toEqual({
      status: 'down',
      dependencies: { database: 'down' },
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('không có phụ thuộc -> up', async () => {
    await expect(checkDependencies({})).resolves.toEqual({
      status: 'up',
      dependencies: {},
    });
  });
});

describe('overallStatus', () => {
  it.each([
    [[], 'up'],
    [['up', 'up'], 'up'],
    [['up', 'down'], 'down'],
  ] as const)('%p -> %s', (statuses, expected) => {
    expect(overallStatus([...statuses])).toBe(expected);
  });
});
