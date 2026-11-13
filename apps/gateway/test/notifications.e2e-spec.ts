import { createRpcValidationPipe, JWT_ALGORITHM } from '@app/common';
import { INestApplication, INestMicroservice, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { eventually } from '../../../test/e2e/eventually';
import { NotificationServiceModule } from '../../notification-service/src/notification-service.module';
import { PrismaService as NotificationPrismaService } from '../../notification-service/src/prisma/prisma.service';
import { connectTransports } from '../../notification-service/src/transports';
import { PrismaService as TaskPrismaService } from '../../task-service/src/prisma/prisma.service';
import { TaskServiceModule } from '../../task-service/src/task-service.module';
import { GatewayModule } from '../src/gateway.module';

/**
 * E2E trọn luồng thông báo: POST /tasks (Gateway -> Task Service) -> Task Service phát
 * `task.created` qua RabbitMQ -> Notification Service lưu thông báo -> GET
 * /notifications (Gateway -> Notification Service qua TCP). Queue RabbitMQ riêng của
 * file này do setupFilesAfterEnv (notifications-queue-e2e.ts) tạo. Access token ký trực
 * tiếp bằng JWT_ACCESS_SECRET như tasks.e2e-spec. Cần Postgres (đã migrate task_db +
 * notification_db) và RabbitMQ.
 */
const TASK_PORT = 4223; // cổng riêng cho test, tránh đụng service đang chạy
const NOTIFICATION_PORT = 4224;

process.env.TASK_SERVICE_HOST = '127.0.0.1';
process.env.TASK_SERVICE_PORT = String(TASK_PORT);
// Gateway gọi tới và Notification Service nghe cùng cổng này
process.env.NOTIFICATION_SERVICE_HOST = '127.0.0.1';
process.env.NOTIFICATION_SERVICE_BIND_HOST = '127.0.0.1';
process.env.NOTIFICATION_SERVICE_PORT = String(NOTIFICATION_PORT);

describe('Gateway /notifications (e2e)', () => {
  let taskApp: INestMicroservice;
  let notificationApp: INestApplication;
  let gateway: INestApplication;
  let secret: string;
  const jwt = new JwtService();
  /** User dùng trong test, dọn task + thông báo theo userId. */
  const users: string[] = [];

  const http = () => request(gateway.getHttpServer());

  /** Người gọi mới: request tới Gateway kèm access token hợp lệ của người đó. */
  const newCaller = async () => {
    const userId = randomUUID();
    users.push(userId);
    const token = await jwt.signAsync(
      { sub: userId, role: 'USER' },
      { secret, algorithm: JWT_ALGORITHM, expiresIn: '5m' },
    );
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${token}`);
    return {
      userId,
      get: (path: string) => auth(http().get(path)),
      post: (path: string) => auth(http().post(path)),
    };
  };

  beforeAll(async () => {
    // Log khởi động của các service không cần trong output test
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const taskRef = await Test.createTestingModule({
      imports: [TaskServiceModule],
    }).compile();
    taskApp = taskRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: TASK_PORT },
    });
    taskApp.useGlobalPipes(createRpcValidationPipe());
    await taskApp.listen();

    const notificationRef = await Test.createTestingModule({
      imports: [NotificationServiceModule],
    }).compile();
    notificationApp = notificationRef.createNestApplication();
    connectTransports(notificationApp, process.env);
    await notificationApp.init();
    await notificationApp.startAllMicroservices();

    const gatewayRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayRef.createNestApplication();
    await gateway.init();
    secret = gateway.get(ConfigService).getOrThrow('JWT_ACCESS_SECRET');
  });

  afterAll(async () => {
    await taskApp
      ?.get(TaskPrismaService)
      .task.deleteMany({ where: { ownerId: { in: users } } });
    await notificationApp
      ?.get(NotificationPrismaService)
      .notification.deleteMany({ where: { userId: { in: users } } });
    await gateway?.close();
    await notificationApp?.close();
    await taskApp?.close();
    jest.restoreAllMocks();
  });

  it('tạo task -> người tạo thấy thông báo ở GET /notifications', async () => {
    const a = await newCaller();
    const { body: task } = await a
      .post('/tasks')
      .send({ title: 'Viết báo cáo' })
      .expect(201);

    const { body } = await eventually(async () => {
      const res = await a.get('/notifications').expect(200);
      expect(res.body.total).toBe(1);
      return res;
    });
    expect(body).toMatchObject({ page: 1, limit: 10, totalPages: 1 });
    expect(body.items[0]).toMatchObject({
      userId: a.userId,
      type: 'TASK_CREATED',
      message: 'Bạn vừa tạo task "Viết báo cáo".',
      data: { taskId: task.id },
    });

    // Người khác không thấy thông báo của a
    const b = await newCaller();
    await b.get('/notifications').expect(200, {
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    });
  });

  it('?page=&limit= -> phân trang, mới nhất trước', async () => {
    const a = await newCaller();
    await a.post('/tasks').send({ title: 'Task 1' }).expect(201);
    await eventually(async () => {
      const res = await a.get('/notifications').expect(200);
      expect(res.body.total).toBe(1);
    });
    await a.post('/tasks').send({ title: 'Task 2' }).expect(201);
    await eventually(async () => {
      const res = await a.get('/notifications').expect(200);
      expect(res.body.total).toBe(2);
    });

    const { body } = await a
      .get('/notifications')
      .query({ page: '1', limit: '1' })
      .expect(200);
    expect(body).toMatchObject({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(body.items[0].message).toBe('Bạn vừa tạo task "Task 2".');
  });

  it('query sai (limit > 100, field lạ) -> 400', async () => {
    const a = await newCaller();
    await a.get('/notifications').query({ limit: '1000' }).expect(400);
    await a.get('/notifications').query({ userId: randomUUID() }).expect(400);
  });

  it('thiếu token -> 401', async () => {
    await http().get('/notifications').expect(401);
  });
});
