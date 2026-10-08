import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import { FindUserByEmailDto, FindUserByIdDto } from './find-user.dto';
import { ListUsersDto } from './list-users.dto';
import { UpdateUserPayloadDto } from './update-user-payload.dto';

const pipe = createRpcValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});
const UUID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';

describe('FindUserByIdDto / FindUserByEmailDto', () => {
  it('chấp nhận dữ liệu hợp lệ', async () => {
    await expect(
      pipe.transform({ id: UUID }, meta(FindUserByIdDto)),
    ).resolves.toEqual({ id: UUID });
    await expect(
      pipe.transform({ email: 'a@b.com' }, meta(FindUserByEmailDto)),
    ).resolves.toEqual({ email: 'a@b.com' });
  });

  it('từ chối id không phải UUID và email sai', async () => {
    await expect(
      pipe.transform({ id: '123' }, meta(FindUserByIdDto)),
    ).rejects.toBeInstanceOf(RpcException);
    await expect(
      pipe.transform({ email: 'abc' }, meta(FindUserByEmailDto)),
    ).rejects.toBeInstanceOf(RpcException);
  });
});

describe('UpdateUserPayloadDto', () => {
  it('chấp nhận dữ liệu hợp lệ', async () => {
    await expect(
      pipe.transform(
        { id: UUID, data: { displayName: 'Bình' } },
        meta(UpdateUserPayloadDto),
      ),
    ).resolves.toBeInstanceOf(UpdateUserPayloadDto);
  });

  it.each([
    ['thiếu data', { id: UUID }],
    ['id sai', { id: 'x', data: {} }],
    ['field lạ trong data (role)', { id: UUID, data: { role: 'ADMIN' } }],
    ['đổi email trong data', { id: UUID, data: { email: 'c@d.com' } }],
    ['displayName rỗng trong data', { id: UUID, data: { displayName: '' } }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(
      pipe.transform(payload, meta(UpdateUserPayloadDto)),
    ).rejects.toBeInstanceOf(RpcException);
  });
});

describe('ListUsersDto', () => {
  it('dùng mặc định page=1, limit=10', async () => {
    await expect(pipe.transform({}, meta(ListUsersDto))).resolves.toEqual({
      page: 1,
      limit: 10,
    });
  });

  it('chuyển chuỗi sang số', async () => {
    await expect(
      pipe.transform({ page: '2', limit: '20' }, meta(ListUsersDto)),
    ).resolves.toEqual({ page: 2, limit: 20 });
  });

  it.each([
    ['page = 0', { page: 0 }],
    ['limit > 100', { limit: 101 }],
    ['page không phải số nguyên', { page: 1.5 }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(
      pipe.transform(payload, meta(ListUsersDto)),
    ).rejects.toBeInstanceOf(RpcException);
  });
});
