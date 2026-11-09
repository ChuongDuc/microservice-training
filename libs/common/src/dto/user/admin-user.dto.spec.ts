import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import {
  AdminListUsersPayloadDto,
  UpdateUserRolePayloadDto,
  UpdateUserStatusPayloadDto,
  USER_SEARCH_MAX_LENGTH,
} from './admin-user.dto';

const pipe = createRpcValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});
const UUID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';
const user = { userId: UUID, role: 'ADMIN' };

const rejects = (payload: unknown, metatype: ArgumentMetadata['metatype']) =>
  expect(pipe.transform(payload, meta(metatype))).rejects.toBeInstanceOf(
    RpcException,
  );

describe('AdminListUsersPayloadDto', () => {
  it('query string -> số, search được trim, mặc định page=1 limit=10', async () => {
    await expect(
      pipe.transform(
        { user, data: { search: '  an  ', role: 'USER', status: 'BLOCKED' } },
        meta(AdminListUsersPayloadDto),
      ),
    ).resolves.toMatchObject({
      data: {
        page: 1,
        limit: 10,
        search: 'an',
        role: 'USER',
        status: 'BLOCKED',
      },
    });
    await expect(
      pipe.transform(
        { user, data: { page: '2', limit: '5' } },
        meta(AdminListUsersPayloadDto),
      ),
    ).resolves.toMatchObject({ data: { page: 2, limit: 5 } });
  });

  it.each([[''], ['   ']])(
    'search rỗng (%p) -> bỏ qua bộ lọc, không báo lỗi',
    async (search) => {
      const { data } = await pipe.transform(
        { user, data: { search } },
        meta(AdminListUsersPayloadDto),
      );
      expect(data.search).toBeUndefined();
    },
  );

  it.each([
    ['search quá dài', { search: 'a'.repeat(USER_SEARCH_MAX_LENGTH + 1) }],
    ['search là mảng', { search: ['a', 'b'] }],
    ['role sai', { role: 'SUPERADMIN' }],
    ['status sai', { status: 'DELETED' }],
    ['limit > 100', { limit: 101 }],
    ['field lạ', { email: 'a@b.com' }],
  ])('từ chối: %s', async (_case, data) => {
    await rejects({ user, data }, AdminListUsersPayloadDto);
  });
});

describe('UpdateUserRolePayloadDto / UpdateUserStatusPayloadDto', () => {
  it('chấp nhận id UUID + role/status hợp lệ', async () => {
    await expect(
      pipe.transform(
        { user, data: { id: UUID, role: 'ADMIN' } },
        meta(UpdateUserRolePayloadDto),
      ),
    ).resolves.toMatchObject({ data: { id: UUID, role: 'ADMIN' } });
    await expect(
      pipe.transform(
        { user, data: { id: UUID, status: 'ACTIVE' } },
        meta(UpdateUserStatusPayloadDto),
      ),
    ).resolves.toMatchObject({ data: { id: UUID, status: 'ACTIVE' } });
  });

  it.each([
    ['thiếu role', { id: UUID }],
    ['role sai', { id: UUID, role: 'admin' }],
    ['role null', { id: UUID, role: null }],
    ['id không phải UUID', { id: '1', role: 'USER' }],
    ['kèm field khác (status)', { id: UUID, role: 'USER', status: 'BLOCKED' }],
  ])('role — từ chối: %s', async (_case, data) => {
    await rejects({ user, data }, UpdateUserRolePayloadDto);
  });

  it.each([
    ['thiếu status', { id: UUID }],
    ['status sai', { id: UUID, status: 'LOCKED' }],
    ['kèm field khác (role)', { id: UUID, status: 'BLOCKED', role: 'ADMIN' }],
  ])('status — từ chối: %s', async (_case, data) => {
    await rejects({ user, data }, UpdateUserStatusPayloadDto);
  });
});
