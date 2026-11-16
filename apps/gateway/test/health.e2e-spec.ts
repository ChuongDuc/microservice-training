import { createRpcValidationPipe } from '@app/common';
import { INestApplication, INestMicroservice, Logger } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { UserServiceModule } from '../../user-service/src/user-service.module';
import { GatewayModule } from '../src/gateway.module';

/**
 * E2E: `GET /health` của Gateway thật gọi health check qua TCP. Chỉ chạy User Service
 * (cần Postgres đã migrate user_db); Auth/Task/Notification trỏ tới cổng không ai nghe
 * -> phải được báo `down`, cả hệ thống `down` (503).
 */
const USER_PORT = 4292; // cổng riêng cho test, tránh đụng service đang chạy
const DEAD_PORTS = { AUTH: 4291, TASK: 4293, NOTIFICATION: 4294 };

for (const [name, port] of Object.entries({
  ...DEAD_PORTS,
  USER: USER_PORT,
})) {
  process.env[`${name}_SERVICE_HOST`] = '127.0.0.1';
  process.env[`${name}_SERVICE_PORT`] = String(port);
}

describe('Gateway /health (e2e)', () => {
  let userApp: INestMicroservice;
  let gateway: INestApplication;

  const http = () => request(gateway.getHttpServer());

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    // Service chết được ghi log warn: là kết quả mong đợi của test
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const userRef = await Test.createTestingModule({
      imports: [UserServiceModule],
    }).compile();
    userApp = userRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: USER_PORT },
    });
    userApp.useGlobalPipes(createRpcValidationPipe());
    await userApp.listen();

    const gatewayRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayRef.createNestApplication();
    await gateway.init();
  });

  afterAll(async () => {
    await gateway?.close();
    await userApp?.close();
    jest.restoreAllMocks();
  });

  it('GET /health/live -> 200 không cần token, không gọi service', async () => {
    const res = await http().get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'up' });
  });

  it('GET /health -> 503: service sống báo up kèm DB, service chết báo down', async () => {
    const res = await http().get('/health').expect(503);
    expect(res.body).toEqual({
      status: 'down',
      services: {
        gateway: { status: 'up' },
        'user-service': { status: 'up', dependencies: { database: 'up' } },
        'auth-service': { status: 'down' },
        'task-service': { status: 'down' },
        'notification-service': { status: 'down' },
      },
    });
  });
});
