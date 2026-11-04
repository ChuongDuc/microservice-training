import { createRpcValidationPipe, TASK_PATTERNS } from '@app/common';
import { INestMicroservice } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskServiceModule } from '../src/task-service.module';

/**
 * E2E: khởi động Task Service thật (TCP) và gửi `task.*` qua ClientProxy kèm danh tính
 * `{ user, data }` — giống cách Gateway sẽ gọi. Cần Postgres đã migrate task_db.
 */
const PORT = 4103; // cổng riêng cho test, tránh đụng service đang chạy ở 4003
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Task Service (e2e qua TCP)', () => {
  let app: INestMicroservice;
  let client: ClientProxy;
  let prisma: PrismaService;
  /** Mỗi lần chạy dùng owner mới, dọn dẹp theo ownerId (không đụng task khác). */
  const owners: string[] = [];
  const newUser = () => {
    const userId = randomUUID();
    owners.push(userId);
    return { userId, role: 'USER' };
  };
  const user = newUser();

  const send = <T = any>(pattern: string, payload: unknown) =>
    firstValueFrom(client.send<T>(pattern, payload));

  const sendError = async (pattern: string, payload: unknown) => {
    try {
      await send(pattern, payload);
    } catch (error) {
      return error;
    }
    throw new Error(`Expected ${pattern} to fail`);
  };

  const createTask = (data: object, caller = user) =>
    send(TASK_PATTERNS.CREATE, { user: caller, data });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TaskServiceModule],
    }).compile();
    app = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: PORT },
    });
    app.useGlobalPipes(createRpcValidationPipe());
    await app.listen();
    prisma = app.get(PrismaService);

    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: PORT },
    });
    await client.connect();
  });

  afterAll(async () => {
    await prisma?.task.deleteMany({ where: { ownerId: { in: owners } } });
    await client?.close();
    await app?.close();
  });

  describe(TASK_PATTERNS.CREATE, () => {
    it('tạo task: ownerId = người gọi, mặc định TODO/MEDIUM, title đã trim', async () => {
      const task = await createTask({
        title: '  Viết e2e  ',
        dueDate: '2026-11-01T10:00:00+07:00',
      });

      expect(task).toMatchObject({
        id: expect.any(String),
        ownerId: user.userId,
        title: 'Viết e2e',
        description: null,
        status: 'TODO',
        priority: 'MEDIUM',
        dueDate: '2026-11-01T03:00:00.000Z',
      });
      await expect(
        prisma.task.findUnique({ where: { id: task.id } }),
      ).resolves.toMatchObject({ ownerId: user.userId });
    });

    it('data sai -> 400 kèm đường dẫn field', async () => {
      const error = await sendError(TASK_PATTERNS.CREATE, {
        user,
        data: { title: '', priority: 'URGENT' },
      });
      expect(error.statusCode).toBe(400);
      expect(
        error.errors.map((e: { field: string }) => e.field).sort(),
      ).toEqual(['data.priority', 'data.title']);
    });

    it('client tự chọn ownerId -> 400', async () => {
      await expect(
        sendError(TASK_PATTERNS.CREATE, {
          user,
          data: { title: 'x', ownerId: randomUUID() },
        }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });

    it('thiếu danh tính user -> 400', async () => {
      await expect(
        sendError(TASK_PATTERNS.CREATE, { data: { title: 'x' } }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });

  describe(TASK_PATTERNS.FIND_ONE, () => {
    it('tìm theo id', async () => {
      const task = await createTask({ title: 'find one' });
      await expect(
        send(TASK_PATTERNS.FIND_ONE, { user, data: { id: task.id } }),
      ).resolves.toMatchObject({ id: task.id, title: 'find one' });
    });

    it('không tìm thấy -> 404, id không phải UUID -> 400', async () => {
      await expect(
        sendError(TASK_PATTERNS.FIND_ONE, { user, data: { id: MISSING_ID } }),
      ).resolves.toMatchObject({ statusCode: 404 });
      await expect(
        sendError(TASK_PATTERNS.FIND_ONE, { user, data: { id: '123' } }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });

  describe(TASK_PATTERNS.FIND_ALL, () => {
    it('phân trang, lọc theo status, mới nhất trước', async () => {
      const owner = newUser();
      // Task cũ ghi thẳng DB với createdAt lùi 1 phút: thứ tự không phụ thuộc việc
      // 2 lần create có rơi vào cùng một mili giây hay không
      const first = await prisma.task.create({
        data: {
          ownerId: owner.userId,
          title: 'cũ',
          status: 'DONE',
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      const second = await createTask({ title: 'mới', status: 'DONE' }, owner);

      const result = await send(TASK_PATTERNS.FIND_ALL, {
        user: owner,
        data: { status: 'DONE', limit: 100 },
      });
      expect(result).toMatchObject({ page: 1, limit: 100 });
      expect(
        result.items.every((t: { status: string }) => t.status === 'DONE'),
      ).toBe(true);

      const ids = result.items.map((t: { id: string }) => t.id);
      expect(ids.indexOf(second.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    });

    it('limit > 100 -> 400', async () => {
      await expect(
        sendError(TASK_PATTERNS.FIND_ALL, { user, data: { limit: 101 } }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });

  describe(TASK_PATTERNS.UPDATE, () => {
    it('đổi status, xoá description/dueDate bằng null', async () => {
      const task = await createTask({
        title: 'update',
        description: 'mô tả',
        dueDate: '2026-12-01T00:00:00Z',
      });

      await expect(
        send(TASK_PATTERNS.UPDATE, {
          user,
          data: {
            id: task.id,
            status: 'IN_PROGRESS',
            description: null,
            dueDate: null,
          },
        }),
      ).resolves.toMatchObject({
        id: task.id,
        title: 'update',
        status: 'IN_PROGRESS',
        description: null,
        dueDate: null,
      });
    });

    it('title null -> 400 (không lọt xuống Prisma thành 500)', async () => {
      const task = await createTask({ title: 'update null' });
      await expect(
        sendError(TASK_PATTERNS.UPDATE, {
          user,
          data: { id: task.id, title: null },
        }),
      ).resolves.toMatchObject({
        statusCode: 400,
        errors: [expect.objectContaining({ field: 'data.title' })],
      });
    });

    it('không tìm thấy -> 404', async () => {
      await expect(
        sendError(TASK_PATTERNS.UPDATE, {
          user,
          data: { id: MISSING_ID, title: 'x' },
        }),
      ).resolves.toMatchObject({ statusCode: 404 });
    });

    it('chỉ có id, không field nào để đổi -> 400', async () => {
      const task = await createTask({ title: 'update rỗng' });
      await expect(
        sendError(TASK_PATTERNS.UPDATE, { user, data: { id: task.id } }),
      ).resolves.toEqual({
        statusCode: 400,
        message: 'Không có field nào để cập nhật',
      });
    });

    it('dueDate kiểu boolean -> 400 (không thành ngày 1970)', async () => {
      const task = await createTask({ title: 'update dueDate' });
      await expect(
        sendError(TASK_PATTERNS.UPDATE, {
          user,
          data: { id: task.id, dueDate: true },
        }),
      ).resolves.toMatchObject({
        statusCode: 400,
        errors: [expect.objectContaining({ field: 'data.dueDate' })],
      });
    });
  });

  describe(TASK_PATTERNS.DELETE, () => {
    it('xoá -> trả task vừa xoá, sau đó find_one/delete -> 404', async () => {
      const task = await createTask({ title: 'delete' });
      const payload = { user, data: { id: task.id } };

      await expect(send(TASK_PATTERNS.DELETE, payload)).resolves.toMatchObject({
        id: task.id,
      });
      await expect(
        sendError(TASK_PATTERNS.FIND_ONE, payload),
      ).resolves.toMatchObject({ statusCode: 404 });
      await expect(
        sendError(TASK_PATTERNS.DELETE, payload),
      ).resolves.toMatchObject({ statusCode: 404 });
    });
  });

  describe('Resource ownership: user B không truy cập được task của user A', () => {
    const userA = newUser();
    const userB = newUser();
    let taskOfA: { id: string };
    const notFound = { statusCode: 404 };

    beforeAll(async () => {
      taskOfA = await createTask(
        { title: 'task của A', description: 'bí mật' },
        userA,
      );
      await createTask({ title: 'task của B' }, userB);
    });

    it('find_all chỉ trả task của người gọi, total không đếm task người khác', async () => {
      const resultB = await send(TASK_PATTERNS.FIND_ALL, {
        user: userB,
        data: { limit: 100 },
      });
      expect(resultB.total).toBe(1);
      expect(resultB.items).toEqual([
        expect.objectContaining({ title: 'task của B', ownerId: userB.userId }),
      ]);
    });

    it('find_all có lọc status vẫn chỉ trả task của người gọi', async () => {
      // Cả A và B đều có task DONE: lọc status không được làm mất điều kiện chủ task
      await createTask({ title: 'A xong', status: 'DONE' }, userA);
      await createTask({ title: 'B xong', status: 'DONE' }, userB);

      const resultB = await send(TASK_PATTERNS.FIND_ALL, {
        user: userB,
        data: { status: 'DONE', limit: 100 },
      });
      expect(resultB.total).toBe(1);
      expect(resultB.items).toEqual([
        expect.objectContaining({
          title: 'B xong',
          status: 'DONE',
          ownerId: userB.userId,
        }),
      ]);
    });

    it('find_one task của A bằng danh tính B -> 404 (không lộ là task có tồn tại)', async () => {
      const error = await sendError(TASK_PATTERNS.FIND_ONE, {
        user: userB,
        data: { id: taskOfA.id },
      });
      // Giống hệt lỗi của id không tồn tại
      expect(error).toEqual({
        statusCode: 404,
        message: `Không tìm thấy task với id ${taskOfA.id}`,
      });
    });

    it('update task của A bằng danh tính B -> 404, task của A không đổi', async () => {
      await expect(
        sendError(TASK_PATTERNS.UPDATE, {
          user: userB,
          data: { id: taskOfA.id, title: 'B sửa', status: 'DONE' },
        }),
      ).resolves.toMatchObject(notFound);

      await expect(
        prisma.task.findUnique({ where: { id: taskOfA.id } }),
      ).resolves.toMatchObject({ title: 'task của A', status: 'TODO' });
    });

    it('delete task của A bằng danh tính B -> 404, task của A vẫn còn', async () => {
      await expect(
        sendError(TASK_PATTERNS.DELETE, {
          user: userB,
          data: { id: taskOfA.id },
        }),
      ).resolves.toMatchObject(notFound);

      await expect(
        prisma.task.findUnique({ where: { id: taskOfA.id } }),
      ).resolves.not.toBeNull();
    });

    it('role ADMIN cũng chỉ thấy task của mình (quyền admin làm ở #21/#22)', async () => {
      await expect(
        sendError(TASK_PATTERNS.FIND_ONE, {
          user: { ...userB, role: 'ADMIN' },
          data: { id: taskOfA.id },
        }),
      ).resolves.toMatchObject(notFound);
    });

    it('chủ task (A) vẫn đọc/sửa/xoá được task của mình', async () => {
      const payload = { user: userA, data: { id: taskOfA.id } };
      await expect(
        send(TASK_PATTERNS.FIND_ONE, payload),
      ).resolves.toMatchObject({ description: 'bí mật' });
      await expect(
        send(TASK_PATTERNS.UPDATE, {
          user: userA,
          data: { id: taskOfA.id, status: 'DONE' },
        }),
      ).resolves.toMatchObject({ status: 'DONE' });
      await expect(send(TASK_PATTERNS.DELETE, payload)).resolves.toMatchObject({
        id: taskOfA.id,
      });
    });
  });
});
