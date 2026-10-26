import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import { RefreshTokenDto } from './refresh-token.dto';

const pipe = createRpcValidationPipe();
const meta: ArgumentMetadata = { type: 'body', metatype: RefreshTokenDto };
// Chỉ cần đúng dạng header.payload.signature (base64url), không cần chữ ký thật
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

describe('RefreshTokenDto', () => {
  it('chấp nhận chuỗi dạng JWT', async () => {
    await expect(
      pipe.transform({ refreshToken: jwt }, meta),
    ).resolves.toBeInstanceOf(RefreshTokenDto);
  });

  it.each([
    ['thiếu refreshToken', {}],
    ['không phải JWT', { refreshToken: 'abc' }],
    ['không phải chuỗi', { refreshToken: 123 }],
    ['field lạ (userId)', { refreshToken: jwt, userId: 'x' }],
  ])('từ chối: %s', async (_case, payload) => {
    await expect(pipe.transform(payload, meta)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});
