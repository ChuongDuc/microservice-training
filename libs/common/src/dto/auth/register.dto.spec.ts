import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import { RegisterDto } from './register.dto';

const pipe = createRpcValidationPipe();
const meta: ArgumentMetadata = { type: 'body', metatype: RegisterDto };
const valid = { email: 'a@b.com', password: '12345678', displayName: 'An' };

describe('RegisterDto', () => {
  it('chấp nhận dữ liệu hợp lệ', async () => {
    await expect(pipe.transform(valid, meta)).resolves.toBeInstanceOf(
      RegisterDto,
    );
  });

  it('chuẩn hoá email (trim + chữ thường)', async () => {
    const result = await pipe.transform(
      { ...valid, email: '  An.Nguyen@B.COM ' },
      meta,
    );
    expect(result.email).toBe('an.nguyen@b.com');
  });

  it('giữ nguyên password (không trim)', async () => {
    const result = await pipe.transform(
      { ...valid, password: ' matkhau 123 ' },
      meta,
    );
    expect(result.password).toBe(' matkhau 123 ');
  });

  it.each([
    ['email sai định dạng', { ...valid, email: 'abc' }],
    ['thiếu password', { email: 'a@b.com', displayName: 'An' }],
    ['password dưới 8 ký tự', { ...valid, password: '1234567' }],
    ['password quá 128 ký tự', { ...valid, password: 'a'.repeat(129) }],
    ['displayName rỗng', { ...valid, displayName: '' }],
    ['field lạ (role)', { ...valid, role: 'ADMIN' }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(pipe.transform(payload, meta)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});
