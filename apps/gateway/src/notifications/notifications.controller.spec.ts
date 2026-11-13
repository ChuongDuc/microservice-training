import { NOTIFICATION_PATTERNS, NOTIFICATION_SERVICE } from '@app/common';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const client = { send: jest.fn() };
  const user = { userId: 'user-uuid', role: 'USER' as const };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NOTIFICATION_SERVICE, useValue: client }],
    }).compile();
    controller = module.get(NotificationsController);
  });

  it('findAll gửi { user, data } tới Notification Service', async () => {
    const page = { items: [], total: 0, page: 2, limit: 5, totalPages: 0 };
    client.send.mockReturnValue(of(page));

    await expect(controller.findAll(user, { page: 2, limit: 5 })).resolves.toBe(
      page,
    );
    expect(client.send).toHaveBeenCalledWith(NOTIFICATION_PATTERNS.FIND_ALL, {
      user,
      data: { page: 2, limit: 5 },
    });
  });
});
