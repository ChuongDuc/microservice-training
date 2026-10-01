import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

const pipe = createRpcValidationPipe();
const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateUserDto };
const updateMeta: ArgumentMetadata = { type: 'body', metatype: UpdateUserDto };

describe('CreateUserDto', () => {
  it('chấp nhận dữ liệu hợp lệ', async () => {
    const result = await pipe.transform(
      { email: 'a@b.com', displayName: 'An', avatar: 'https://x.com/a.png' },
      createMeta,
    );
    expect(result).toBeInstanceOf(CreateUserDto);
  });

  it('chấp nhận khi không có avatar', async () => {
    await expect(
      pipe.transform({ email: 'a@b.com', displayName: 'An' }, createMeta),
    ).resolves.toBeInstanceOf(CreateUserDto);
  });

  it.each([
    ['email sai định dạng', { email: 'abc', displayName: 'An' }],
    ['thiếu email', { displayName: 'An' }],
    ['thiếu displayName', { email: 'a@b.com' }],
    ['displayName rỗng', { email: 'a@b.com', displayName: '' }],
    [
      'displayName quá 100 ký tự',
      { email: 'a@b.com', displayName: 'a'.repeat(101) },
    ],
    [
      'avatar không phải URL',
      { email: 'a@b.com', displayName: 'An', avatar: 'abc' },
    ],
    ['field lạ (role)', { email: 'a@b.com', displayName: 'An', role: 'ADMIN' }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(pipe.transform(payload, createMeta)).rejects.toBeInstanceOf(
      RpcException,
    );
  });

  it('lỗi trả về statusCode 400 và chỉ ra field sai', async () => {
    expect.assertions(2);
    try {
      await pipe.transform({ email: 'abc', displayName: 'An' }, createMeta);
    } catch (e) {
      const error = (e as RpcException).getError() as {
        statusCode: number;
        errors: { field: string }[];
      };
      expect(error.statusCode).toBe(400);
      expect(error.errors.map((x) => x.field)).toEqual(['email']);
    }
  });
});

describe('UpdateUserDto', () => {
  it('chấp nhận body rỗng (mọi field tuỳ chọn)', async () => {
    await expect(pipe.transform({}, updateMeta)).resolves.toBeInstanceOf(
      UpdateUserDto,
    );
  });

  it('chấp nhận cập nhật displayName', async () => {
    await expect(
      pipe.transform({ displayName: 'Bình' }, updateMeta),
    ).resolves.toBeInstanceOf(UpdateUserDto);
  });

  it.each([
    ['đổi email', { email: 'new@b.com' }],
    ['displayName rỗng', { displayName: '' }],
    ['avatar không phải URL', { avatar: 'abc' }],
    ['field lạ (status)', { status: 'BLOCKED' }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(pipe.transform(payload, updateMeta)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});
