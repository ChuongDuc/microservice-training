import { Test, TestingModule } from '@nestjs/testing';
import { TaskServiceController } from './task-service.controller';
import { TaskServiceService } from './task-service.service';

describe('TaskServiceController', () => {
  let controller: TaskServiceController;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const user = { userId: 'user-uuid', role: 'USER' as const };

  beforeEach(async () => {
    jest.resetAllMocks();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [TaskServiceController],
      providers: [{ provide: TaskServiceService, useValue: service }],
    }).compile();
    controller = app.get(TaskServiceController);
  });

  it('task.create -> service.create(user, data)', async () => {
    await controller.create({ user, data: { title: 'x' } });
    expect(service.create).toHaveBeenCalledWith(user, { title: 'x' });
  });

  it('task.find_all -> service.findAll(data)', async () => {
    await controller.findAll({ user, data: { page: 1, limit: 10 } });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
  });

  it('task.find_one -> service.findOne(id)', async () => {
    await controller.findOne({ user, data: { id: 'task-uuid' } });
    expect(service.findOne).toHaveBeenCalledWith('task-uuid');
  });

  it('task.update -> service.update(data)', async () => {
    await controller.update({ user, data: { id: 'task-uuid', title: 'y' } });
    expect(service.update).toHaveBeenCalledWith({
      id: 'task-uuid',
      title: 'y',
    });
  });

  it('task.delete -> service.remove(id)', async () => {
    await controller.remove({ user, data: { id: 'task-uuid' } });
    expect(service.remove).toHaveBeenCalledWith('task-uuid');
  });
});
