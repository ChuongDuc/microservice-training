import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { IsString } from 'class-validator';
import { createRpcValidationPipe } from '../../pipes';
import {
  AuthenticatedPayloadDto,
  AuthUserDto,
  isUserRole,
  WithAuthUser,
} from './authenticated-payload.dto';

const pipe = createRpcValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});
const UUID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';
const user = { userId: UUID, role: 'USER' };

describe('AuthenticatedPayloadDto', () => {
  it('chấp nhận { user } hợp lệ, user thành instance AuthUserDto', async () => {
    const result = await pipe.transform(
      { user },
      meta(AuthenticatedPayloadDto),
    );
    expect(result).toEqual({ user });
    expect(result.user).toBeInstanceOf(AuthUserDto);
  });

  it.each([
    ['thiếu user', {}],
    ['user null', { user: null }],
    ['userId không phải UUID', { user: { ...user, userId: '123' } }],
    ['role không hợp lệ', { user: { ...user, role: 'SUPERADMIN' } }],
    ['thiếu role', { user: { userId: UUID } }],
    ['field lạ trong user', { user: { ...user, email: 'a@b.com' } }],
    ['field lạ ngoài user', { user, id: UUID }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(
      pipe.transform(payload, meta(AuthenticatedPayloadDto)),
    ).rejects.toBeInstanceOf(RpcException);
  });
});

describe('WithAuthUser', () => {
  class TitleDto {
    @IsString()
    title: string;
  }
  class TitlePayloadDto extends WithAuthUser(TitleDto) {}

  it('chấp nhận { user, data } hợp lệ, validate cả data', async () => {
    const result = await pipe.transform(
      { user, data: { title: 'Viết test' } },
      meta(TitlePayloadDto),
    );
    expect(result.data).toBeInstanceOf(TitleDto);
    expect(result.user).toBeInstanceOf(AuthUserDto);
  });

  it.each([
    ['thiếu data', { user }],
    ['thiếu user', { data: { title: 'x' } }],
    ['data sai kiểu', { user, data: { title: 1 } }],
    [
      'field lạ trong data (ownerId)',
      { user, data: { title: 'x', ownerId: UUID } },
    ],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(
      pipe.transform(payload, meta(TitlePayloadDto)),
    ).rejects.toBeInstanceOf(RpcException);
  });
});

describe('isUserRole', () => {
  it.each([
    ['USER', true],
    ['ADMIN', true],
    ['admin', false],
    ['SUPERADMIN', false],
    [undefined, false],
    [1, false],
  ])('%p -> %p', (value, expected) => {
    expect(isUserRole(value)).toBe(expected);
  });
});
