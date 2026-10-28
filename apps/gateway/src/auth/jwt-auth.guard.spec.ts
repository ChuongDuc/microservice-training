import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('JwtAuthGuard', () => {
  const SECRET = 'access-secret';
  const USER_ID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';
  const jwt = new JwtService();
  const reflector = new Reflector();
  const config = {
    getOrThrow: () => SECRET,
  } as unknown as ConfigService;
  const guard = new JwtAuthGuard(reflector, jwt, config);

  const sign = (payload: object, options: object = {}) =>
    jwt.signAsync(payload, { secret: SECRET, expiresIn: '15m', ...options });

  /** ExecutionContext giả với header Authorization + metadata @Public() tuỳ chọn. */
  const contextOf = (authorization?: string, isPublic = false) => {
    const request = { headers: { authorization } } as AuthenticatedRequest;
    const response = { setHeader: jest.fn() };
    const handler = () => undefined;
    if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    const context = {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, request, response };
  };

  /** Chạy guard với header cho trước, trả về body lỗi 401 + header WWW-Authenticate. */
  const reject = async (authorization?: string) => {
    const { context, response } = contextOf(authorization);
    try {
      await guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(response.setHeader).toHaveBeenCalledTimes(1);
      return {
        body: (error as UnauthorizedException).getResponse(),
        wwwAuthenticate: response.setHeader.mock.calls[0][1],
      };
    }
    throw new Error('Expected guard to reject');
  };

  it('route @Public() -> cho qua dù không có token', async () => {
    await expect(
      guard.canActivate(contextOf(undefined, true).context),
    ).resolves.toBe(true);
  });

  it('access token hợp lệ -> cho qua, gắn { userId, role } vào request.user', async () => {
    const token = await sign({ sub: USER_ID, role: 'ADMIN', extra: 'x' });
    const { context, request, response } = contextOf(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: USER_ID, role: 'ADMIN' });
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('chấp nhận "bearer" viết thường và khoảng trắng thừa', async () => {
    const token = await sign({ sub: USER_ID, role: 'USER' });

    await expect(
      guard.canActivate(contextOf(`  bearer   ${token} `).context),
    ).resolves.toBe(true);
  });

  it.each([undefined, ''])(
    'thiếu header Authorization (%p) -> 401 + WWW-Authenticate: Bearer',
    async (header) => {
      await expect(reject(header)).resolves.toEqual({
        body: { statusCode: 401, message: 'Thiếu access token' },
        wwwAuthenticate: 'Bearer',
      });
    },
  );

  it.each(['Bearer', 'Basic abc', 'Bearer a b', 'token-khong-co-scheme'])(
    'header sai định dạng (%p) -> 401 invalid_request',
    async (header) => {
      await expect(reject(header)).resolves.toEqual({
        body: {
          statusCode: 401,
          message: 'Header Authorization phải có dạng "Bearer <token>"',
        },
        wwwAuthenticate: 'Bearer error="invalid_request"',
      });
    },
  );

  const invalid = {
    body: {
      statusCode: 401,
      message: 'Access token không hợp lệ hoặc đã hết hạn',
    },
    wwwAuthenticate: 'Bearer error="invalid_token"',
  };

  it('token ký bằng secret khác (vd: refresh token) -> 401 invalid_token', async () => {
    const token = await sign(
      { sub: USER_ID, role: 'USER' },
      { secret: 'refresh-secret' },
    );
    await expect(reject(`Bearer ${token}`)).resolves.toEqual(invalid);
  });

  it('token hết hạn -> 401 invalid_token', async () => {
    // expiresIn âm: token đã hết hạn 10 giây trước
    const token = await sign(
      { sub: USER_ID, role: 'USER' },
      { expiresIn: -10 },
    );
    await expect(reject(`Bearer ${token}`)).resolves.toEqual(invalid);
  });

  it('token đúng secret nhưng không có exp (không bao giờ hết hạn) -> 401', async () => {
    const token = await jwt.signAsync(
      { sub: USER_ID, role: 'ADMIN' },
      { secret: SECRET },
    );
    expect(jwt.decode(token)).not.toHaveProperty('exp');

    await expect(reject(`Bearer ${token}`)).resolves.toEqual(invalid);
  });

  it('token không ký (alg: none) -> 401', async () => {
    const encode = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: USER_ID,
      role: 'ADMIN',
      exp: Math.floor(Date.now() / 1000) + 900,
    })}.`;
    await expect(reject(`Bearer ${token}`)).resolves.toEqual(invalid);
  });

  it('token đúng secret nhưng ký bằng HS512 -> 401', async () => {
    const token = await sign(
      { sub: USER_ID, role: 'USER' },
      { algorithm: 'HS512' },
    );
    await expect(reject(`Bearer ${token}`)).resolves.toEqual(invalid);
  });

  it.each([
    { sub: USER_ID },
    { role: 'USER' },
    { sub: 1, role: 'USER' },
    { sub: USER_ID, role: 'SUPERADMIN' },
    { sub: 'user-1', role: 'USER' },
  ])(
    'token đúng secret nhưng thiếu/sai sub (phải là UUID) hoặc role không hợp lệ (%p) -> 401',
    async (payload) => {
      const token = await sign(payload);
      await expect(reject(`Bearer ${token}`)).resolves.toEqual(invalid);
    },
  );

  it('chuỗi không phải JWT -> 401', async () => {
    await expect(reject('Bearer abc.def.ghi')).resolves.toEqual(invalid);
  });
});
