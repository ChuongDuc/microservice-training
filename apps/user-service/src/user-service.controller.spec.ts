import { Test, TestingModule } from '@nestjs/testing';
import { UserServiceController } from './user-service.controller';
import { UserServiceService } from './user-service.service';

describe('UserServiceController', () => {
  let controller: UserServiceController;
  const service = {
    create: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [UserServiceController],
      providers: [{ provide: UserServiceService, useValue: service }],
    }).compile();

    controller = app.get(UserServiceController);
  });

  it('user.create -> service.create(dto)', async () => {
    const dto = { email: 'a@b.com', displayName: 'An' };
    service.create.mockResolvedValue({ id: '1', ...dto });
    await expect(controller.create(dto)).resolves.toEqual({ id: '1', ...dto });
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('user.find_by_id -> service.findById(id)', async () => {
    await controller.findById({ id: 'uuid' });
    expect(service.findById).toHaveBeenCalledWith('uuid');
  });

  it('user.find_by_email -> service.findByEmail(email)', async () => {
    await controller.findByEmail({ email: 'a@b.com' });
    expect(service.findByEmail).toHaveBeenCalledWith('a@b.com');
  });

  it('user.update -> service.update(id, data)', async () => {
    await controller.update({ id: 'uuid', data: { displayName: 'Bình' } });
    expect(service.update).toHaveBeenCalledWith('uuid', {
      displayName: 'Bình',
    });
  });

  it('user.list -> service.list(dto)', async () => {
    await controller.list({ page: 2, limit: 5 });
    expect(service.list).toHaveBeenCalledWith({ page: 2, limit: 5 });
  });
});
