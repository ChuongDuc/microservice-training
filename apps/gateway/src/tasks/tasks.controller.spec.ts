import { TASK_PATTERNS, TASK_SERVICE } from '@app/common';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { TasksController } from './tasks.controller';

describe('TasksController', () => {
  let controller: TasksController;
  const client = { send: jest.fn() };
  const user = { userId: 'user-uuid', role: 'USER' as const };
  const id = 'task-uuid';

  beforeEach(async () => {
    jest.clearAllMocks();
    client.send.mockReturnValue(of({ ok: true }));
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TASK_SERVICE, useValue: client }],
    }).compile();
    controller = module.get(TasksController);
  });

  it.each([
    [
      'create',
      () => controller.create(user, { title: 'x' }),
      TASK_PATTERNS.CREATE,
      { title: 'x' },
    ],
    [
      'findAll',
      () => controller.findAll(user, { page: 2, limit: 5, status: 'DONE' }),
      TASK_PATTERNS.FIND_ALL,
      { page: 2, limit: 5, status: 'DONE' },
    ],
    [
      'findOne',
      () => controller.findOne(user, id),
      TASK_PATTERNS.FIND_ONE,
      { id },
    ],
    [
      'update',
      () => controller.update(user, id, { title: 'y' }),
      TASK_PATTERNS.UPDATE,
      { title: 'y', id },
    ],
    ['remove', () => controller.remove(user, id), TASK_PATTERNS.DELETE, { id }],
  ])(
    '%s gửi { user, data } tới Task Service',
    async (_name, call, pattern, data) => {
      await expect(call()).resolves.toEqual({ ok: true });
      expect(client.send).toHaveBeenCalledWith(pattern, { user, data });
    },
  );

  it('update: id trên URL ghi đè id trong body', async () => {
    await controller.update(user, id, { id: 'khac', title: 'y' } as never);
    expect(client.send).toHaveBeenCalledWith(TASK_PATTERNS.UPDATE, {
      user,
      data: { title: 'y', id },
    });
  });

  it('lỗi nghiệp vụ từ Task Service -> HttpException cùng statusCode', async () => {
    client.send.mockReturnValue(
      throwError(() => ({ statusCode: 404, message: 'Không tìm thấy' })),
    );
    const result = controller.findOne(user, id);
    await expect(result).rejects.toBeInstanceOf(HttpException);
    await expect(result).rejects.toMatchObject({ status: 404 });
  });
});
