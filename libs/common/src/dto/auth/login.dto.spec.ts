import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import { LoginDto } from './login.dto';

const pipe = createRpcValidationPipe();
const meta: ArgumentMetadata = { type: 'body', metatype: LoginDto };
const valid = { email: 'a@b.com', password: 'matkhau123' };

describe('LoginDto', () => {
  it('chấp nhận dữ liệu hợp lệ', async () => {
    await expect(pipe.transform(valid, meta)).resolves.toBeInstanceOf(LoginDto);
  });

  it('chuẩn hoá email (trim + chữ thường)', async () => {
    const result = await pipe.transform(
      { ...valid, email: '  An.Nguyen@B.COM ' },
      meta,
    );
    expect(result.email).toBe('an.nguyen@b.com');
  });

  it.each([
    ['email sai định dạng', { ...valid, email: 'abc' }],
    ['thiếu password', { email: 'a@b.com' }],
    ['password rỗng', { ...valid, password: '' }],
    ['password quá 128 ký tự', { ...valid, password: 'a'.repeat(129) }],
    ['field lạ (role)', { ...valid, role: 'ADMIN' }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(pipe.transform(payload, meta)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});
