import { Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { HealthService, SERVICE_HEALTH_TIMEOUT_MS } from './health.service';

describe('HealthService', () => {
  /** ClientProxy giả: `send` trả về observable cho sẵn. */
  const client = (reply: () => Observable<unknown>) =>
    ({ send: jest.fn(reply) }) as unknown as ClientProxy;
  const up = (dependencies: object) => () => of({ status: 'up', dependencies });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('mọi service up -> up, kèm phụ thuộc của từng service', async () => {
    const auth = client(up({ database: 'up', redis: 'up' }));
    const service = new HealthService(
      auth,
      client(up({ database: 'up' })),
      client(up({ database: 'up' })),
      client(up({ database: 'up', rabbitmq: 'up' })),
    );

    await expect(service.check()).resolves.toEqual({
      status: 'up',
      services: {
        gateway: { status: 'up' },
        'auth-service': {
          status: 'up',
          dependencies: { database: 'up', redis: 'up' },
        },
        'user-service': { status: 'up', dependencies: { database: 'up' } },
        'task-service': { status: 'up', dependencies: { database: 'up' } },
        'notification-service': {
          status: 'up',
          dependencies: { database: 'up', rabbitmq: 'up' },
        },
      },
    });
    expect(auth.send).toHaveBeenCalledWith('health.check', {});
  });

  it('service không gọi được -> service down, hệ thống down', async () => {
    const service = new HealthService(
      client(up({ database: 'up', redis: 'up' })),
      client(() => throwError(() => new Error('connect ECONNREFUSED'))),
      client(up({ database: 'up' })),
      client(up({ database: 'down', rabbitmq: 'up' })),
    );

    const health = await service.check();
    expect(health.status).toBe('down');
    expect(health.services['user-service']).toEqual({ status: 'down' });
    // Service trả lời nhưng phụ thuộc chết
    expect(health.services['notification-service']).toEqual({
      status: 'down',
      dependencies: { database: 'down', rabbitmq: 'up' },
    });
    expect(health.services['auth-service'].status).toBe('up');
  });

  it('service treo -> down sau SERVICE_HEALTH_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    const service = new HealthService(
      client(() => NEVER),
      client(up({})),
      client(up({})),
      client(up({})),
    );

    const result = service.check();
    await jest.advanceTimersByTimeAsync(SERVICE_HEALTH_TIMEOUT_MS);
    const health = await result;
    expect(health.services['auth-service']).toEqual({ status: 'down' });
    expect(health.status).toBe('down');
  });

  it('phản hồi lạ: trạng thái khác "up" coi là down, không trả thêm field', async () => {
    const service = new HealthService(
      client(() =>
        of({
          status: 'up',
          dependencies: { database: 'ok' },
          error: 'postgres://user:secret@db',
        }),
      ),
      client(() => of(null)),
      client(up({})),
      client(up({})),
    );

    const health = await service.check();
    expect(health.services['auth-service']).toEqual({
      status: 'down',
      dependencies: { database: 'down' },
    });
    expect(health.services['user-service']).toEqual({
      status: 'down',
      dependencies: {},
    });
  });
});
