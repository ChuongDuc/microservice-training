import { USER_PATTERNS, USER_SERVICE } from '@app/common';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminUsersController } from './admin-users.controller';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  const client = { send: jest.fn() };
  const user = { userId: 'admin-uuid', role: 'ADMIN' as const };
  const id = 'user-uuid';

  beforeEach(async () => {
    jest.clearAllMocks();
    client.send.mockReturnValue(of({ ok: true }));
    const module = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [{ provide: USER_SERVICE, useValue: client }],
    }).compile();
    controller = module.get(AdminUsersController);
  });

  it('cả controller gắn @Roles("ADMIN")', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual([
      'ADMIN',
    ]);
  });

  it('list gửi { user, data: query } tới user.admin.list', async () => {
    const query = { page: 1, limit: 10, search: 'an' };
    await expect(controller.list(user, query)).resolves.toEqual({ ok: true });
    expect(client.send).toHaveBeenCalledWith(USER_PATTERNS.ADMIN_LIST, {
      user,
      data: query,
    });
  });

  it('updateRole/updateStatus: id trên URL ghi đè id trong body', async () => {
    await controller.updateRole(user, id, {
      role: 'ADMIN',
      id: 'khac',
    } as never);
    expect(client.send).toHaveBeenCalledWith(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
      user,
      data: { role: 'ADMIN', id },
    });

    await controller.updateStatus(user, id, {
      status: 'BLOCKED',
      id: 'khac',
    } as never);
    expect(client.send).toHaveBeenCalledWith(
      USER_PATTERNS.ADMIN_UPDATE_STATUS,
      { user, data: { status: 'BLOCKED', id } },
    );
  });
});
