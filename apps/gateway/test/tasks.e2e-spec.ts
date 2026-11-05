import { createRpcValidationPipe, JWT_ALGORITHM } from '@app/common';
import { INestApplication, INestMicroservice } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService as TaskPrismaService } from '../../task-service/src/prisma/prisma.service';
import { TaskServiceModule } from '../../task-service/src/task-service.module';
import { GatewayModule } from '../src/gateway.module';

/**
 * E2E: bật Task Service thật (TCP) và Gateway (HTTP), gọi REST `/tasks` bằng supertest.
 * Access token ký trực tiếp bằng JWT_ACCESS_SECRET (giống Auth Service) để không phải
 * bật Auth/User Service — luồng đăng nhập đã có ở auth.e2e-spec. Cần Postgres đã
 * migrate task_db.
 */
const TASK_PORT = 4213; // cổng riêng cho test, tránh đụng service đang chạy
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

process.env.TASK_SERVICE_HOST = '127.0.0.1';
process.env.TASK_SERVICE_PORT = String(TASK_PORT);

type Send = (path: string) => request.Test;
/** Người gọi trong test: gửi request kèm access token của chính người đó. */
type Caller = {
  userId: string;
  get: Send;
  post: Send;
  patch: Send;
  delete: Send;
};

describe('Gateway /tasks (e2e)', () => {
  let taskApp: INestMicroservice;
  let gateway: INestApplication;
  let taskDb: TaskPrismaService;
  let secret: string;
  const jwt = new JwtService();
  /** Mỗi lần chạy dùng user mới, dọn dẹp theo ownerId (không đụng task khác). */
  const owners: string[] = [];

  /** Người gọi mới: gửi request tới Gateway kèm access token hợp lệ của người đó. */
  const newCaller = async (
    role: 'USER' | 'ADMIN' = 'USER',
  ): Promise<Caller> => {
    const userId = randomUUID();
    owners.push(userId);
    const token = await jwt.signAsync(
      { sub: userId, role },
      { secret, algorithm: JWT_ALGORITHM, expiresIn: '5m' },
    );
    const as =
      (method: 'get' | 'post' | 'patch' | 'delete'): Send =>
      (path) =>
        http()[method](path).set('Authorization', `Bearer ${token}`);
    return {
      userId,
      get: as('get'),
      post: as('post'),
      patch: as('patch'),
      delete: as('delete'),
    };
  };

  const http = () => request(gateway.getHttpServer());

  beforeAll(async () => {
    const taskRef = await Test.createTestingModule({
      imports: [TaskServiceModule],
    }).compile();
    taskApp = taskRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: TASK_PORT },
    });
    taskApp.useGlobalPipes(createRpcValidationPipe());
    await taskApp.listen();
    taskDb = taskApp.get(TaskPrismaService);

    const gatewayRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayRef.createNestApplication();
    await gateway.init();
    secret = gateway.get(ConfigService).getOrThrow('JWT_ACCESS_SECRET');
  });

  afterAll(async () => {
    await taskDb?.task.deleteMany({ where: { ownerId: { in: owners } } });
    await gateway?.close();
    await taskApp?.close();
  });

  describe('CRUD qua REST', () => {
    let a: Caller;
    let taskId: string;

    beforeAll(async () => {
      a = await newCaller();
    });

    it('POST /tasks -> 201, ownerId lấy từ token', async () => {
      const { body } = await a
        .post('/tasks')
        .send({ title: '  Viết e2e gateway  ', priority: 'HIGH' })
        .expect(201);

      expect(body).toMatchObject({
        id: expect.any(String),
        title: 'Viết e2e gateway',
        priority: 'HIGH',
        status: 'TODO',
        ownerId: a.userId,
      });
      taskId = body.id;
    });

    it('GET /tasks -> 200 + danh sách phân trang của người gọi', async () => {
      await a
        .post('/tasks')
        .send({ title: 'Task DONE', status: 'DONE' })
        .expect(201);

      const { body } = await a.get('/tasks').expect(200);
      expect(body).toMatchObject({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(body.items).toHaveLength(2);
    });

    it('GET /tasks?status=DONE&page=1&limit=1 -> query string được đổi kiểu và lọc', async () => {
      const { body } = await a
        .get('/tasks')
        .query({ status: 'DONE', page: '1', limit: '1' })
        .expect(200);
      expect(body).toMatchObject({ total: 1, page: 1, limit: 1 });
      expect(body.items).toEqual([
        expect.objectContaining({ title: 'Task DONE', status: 'DONE' }),
      ]);
    });

    it('GET /tasks/:id -> 200', async () => {
      const { body } = await a.get(`/tasks/${taskId}`).expect(200);
      expect(body).toMatchObject({ id: taskId, ownerId: a.userId });
    });

    it('PATCH /tasks/:id -> 200 + task đã cập nhật', async () => {
      const { body } = await a
        .patch(`/tasks/${taskId}`)
        .send({ status: 'IN_PROGRESS', dueDate: '2026-12-01' })
        .expect(200);
      expect(body).toMatchObject({
        id: taskId,
        status: 'IN_PROGRESS',
        dueDate: '2026-12-01T00:00:00.000Z',
      });
    });

    it('PATCH: `id` trong body không đổi được task bị sửa (id trên URL thắng)', async () => {
      const { body: other } = await a
        .post('/tasks')
        .send({ title: 'Task khác' })
        .expect(201);

      const { body } = await a
        .patch(`/tasks/${taskId}`)
        .send({ id: other.id, title: 'Đổi tên' })
        .expect(200);
      expect(body).toMatchObject({ id: taskId, title: 'Đổi tên' });
      await expect(
        taskDb.task.findUnique({ where: { id: other.id } }),
      ).resolves.toMatchObject({ title: 'Task khác' });
    });

    it('DELETE /tasks/:id -> 200 + task vừa xoá, sau đó GET -> 404', async () => {
      const { body } = await a.delete(`/tasks/${taskId}`).expect(200);
      expect(body).toMatchObject({ id: taskId });

      await a.get(`/tasks/${taskId}`).expect(404);
    });
  });

  describe('Lỗi từ Task Service được trả đúng HTTP status', () => {
    let a: Caller;

    beforeAll(async () => {
      a = await newCaller();
    });

    it('body sai -> 400 kèm chi tiết field data.*', async () => {
      const { body } = await a
        .post('/tasks')
        .send({ title: '', status: 'DOING' })
        .expect(400);
      expect(body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'data.title' }),
          expect.objectContaining({ field: 'data.status' }),
        ]),
      );
    });

    it('body tự chọn ownerId -> 400 (không được gán task cho người khác)', async () => {
      await a
        .post('/tasks')
        .send({ title: 'x', ownerId: randomUUID() })
        .expect(400);
    });

    it('body là mảng -> 400 (không lọt xuống DB thành 500)', async () => {
      await a.post('/tasks').send([]).expect(400);
      await a
        .post('/tasks')
        .send([{ title: 'x' }])
        .expect(400);
    });

    it('query sai (status lạ, limit > 100) -> 400', async () => {
      await a.get('/tasks?status=DOING').expect(400);
      await a.get('/tasks?limit=101').expect(400);
    });

    it('id không phải UUID -> 400', async () => {
      await a.get('/tasks/abc').expect(400);
    });

    it('PATCH body rỗng -> 400', async () => {
      const { body: task } = await a
        .post('/tasks')
        .send({ title: 'x' })
        .expect(201);
      const { body } = await a.patch(`/tasks/${task.id}`).send({}).expect(400);
      expect(body).toEqual({
        statusCode: 400,
        message: 'Không có field nào để cập nhật',
      });
    });

    it('task không tồn tại -> 404 với GET/PATCH/DELETE', async () => {
      await a.get(`/tasks/${MISSING_ID}`).expect(404);
      await a.patch(`/tasks/${MISSING_ID}`).send({ title: 'x' }).expect(404);
      await a.delete(`/tasks/${MISSING_ID}`).expect(404);
    });
  });

  describe('Resource ownership qua REST', () => {
    it('user B không thấy, sửa, xoá được task của user A (404)', async () => {
      const a = await newCaller();
      const b = await newCaller();
      const { body: task } = await a
        .post('/tasks')
        .send({ title: 'Của A' })
        .expect(201);

      const { body: list } = await b.get('/tasks').expect(200);
      expect(list).toMatchObject({ total: 0, items: [] });

      await b.get(`/tasks/${task.id}`).expect(404);
      await b.patch(`/tasks/${task.id}`).send({ title: 'B sửa' }).expect(404);
      await b.delete(`/tasks/${task.id}`).expect(404);

      await expect(
        taskDb.task.findUnique({ where: { id: task.id } }),
      ).resolves.toMatchObject({ title: 'Của A', ownerId: a.userId });
    });

    it('query/body không ghi đè được danh tính (user, ownerId)', async () => {
      const a = await newCaller();
      const b = await newCaller();
      await a.post('/tasks').send({ title: 'Của A' }).expect(201);

      // Query lạ bị Task Service từ chối, không thành bộ lọc theo chủ khác
      await b.get(`/tasks?ownerId=${a.userId}`).expect(400);
      await b
        .post('/tasks')
        .send({ title: 'x', user: { userId: a.userId, role: 'ADMIN' } })
        .expect(400);
    });
  });

  describe('JwtAuthGuard', () => {
    it('thiếu token -> 401 với mọi route /tasks, không tạo task nào', async () => {
      // Title riêng của lần chạy: kiểm tra đúng task này không được tạo, không phụ thuộc
      // việc tiến trình khác có ghi task_db cùng lúc hay không
      const title = `no-token-${randomUUID()}`;
      await http().get('/tasks').expect(401);
      await http().post('/tasks').send({ title }).expect(401);
      await http().get(`/tasks/${MISSING_ID}`).expect(401);
      await http()
        .patch(`/tasks/${MISSING_ID}`)
        .send({ title: 'x' })
        .expect(401);
      await http().delete(`/tasks/${MISSING_ID}`).expect(401);
      await expect(taskDb.task.count({ where: { title } })).resolves.toBe(0);
    });

    it('token ký bằng secret khác -> 401', async () => {
      const forged = await jwt.signAsync(
        { sub: randomUUID(), role: 'ADMIN' },
        { secret: 'x'.repeat(40), expiresIn: '5m' },
      );
      await http()
        .get('/tasks')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });
});
