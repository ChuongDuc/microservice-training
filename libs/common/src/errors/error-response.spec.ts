import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  isErrorStatusCode,
  normalizeErrorBody,
  toKnownErrorResponse,
} from './error-response';

describe('isErrorStatusCode', () => {
  it.each([400, 404, 500, 599])('%p -> true', (code) => {
    expect(isErrorStatusCode(code)).toBe(true);
  });

  it.each([200, 399, 600, 400.5, '400', null, undefined])(
    '%p -> false',
    (v) => {
      expect(isErrorStatusCode(v)).toBe(false);
    },
  );
});

describe('normalizeErrorBody', () => {
  it('bỏ field thừa (`error`), giữ message + errors', () => {
    const errors = [{ field: 'email', constraints: { isEmail: 'x' } }];
    expect(
      normalizeErrorBody(
        400,
        { statusCode: 400, error: 'Bad Request', message: 'Sai', errors },
        'fallback',
      ),
    ).toEqual({ statusCode: 400, message: 'Sai', errors });
  });

  it('message dạng mảng -> nối thành một chuỗi', () => {
    expect(normalizeErrorBody(400, { message: ['a', 'b'] }, 'f')).toEqual({
      statusCode: 400,
      message: 'a; b',
    });
  });

  it('body là chuỗi -> làm message', () => {
    expect(normalizeErrorBody(429, 'Chậm lại', 'f')).toEqual({
      statusCode: 429,
      message: 'Chậm lại',
    });
  });

  it.each([null, {}, { message: '' }, { message: [] }, 42])(
    'không có message dùng được (%p) -> fallback',
    (body) => {
      expect(normalizeErrorBody(500, body, 'fallback')).toEqual({
        statusCode: 500,
        message: 'fallback',
      });
    },
  );

  it('statusCode lấy theo tham số, không theo body', () => {
    expect(
      normalizeErrorBody(404, { statusCode: 500, message: 'x' }, 'f'),
    ).toEqual({ statusCode: 404, message: 'x' });
  });
});

describe('toKnownErrorResponse', () => {
  it('HttpException mặc định của Nest -> bỏ `error`', () => {
    expect(toKnownErrorResponse(new NotFoundException('Không thấy'))).toEqual({
      statusCode: 404,
      message: 'Không thấy',
    });
  });

  it('HttpException body tuỳ chỉnh -> giữ errors', () => {
    const body = { statusCode: 400, message: 'Validation failed', errors: [] };
    expect(toKnownErrorResponse(new BadRequestException(body))).toEqual(body);
  });

  it('HttpException body chuỗi', () => {
    expect(toKnownErrorResponse(new HttpException('Chậm lại', 429))).toEqual({
      statusCode: 429,
      message: 'Chậm lại',
    });
  });

  it('lỗi http-errors có expose (vd: body-parser JSON sai) -> giữ status 4xx', () => {
    const error = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    expect(toKnownErrorResponse(error)).toEqual({
      statusCode: 400,
      message: 'Unexpected token',
    });
  });

  it.each([
    ['Error thường', new Error('db password=...')],
    [
      'có status nhưng không expose',
      Object.assign(new Error('x'), { status: 400 }),
    ],
    [
      'expose nhưng status không hợp lệ',
      Object.assign(new Error('x'), { status: 200, expose: true }),
    ],
    ['chuỗi', 'boom'],
    ['null', null],
  ])('lỗi lạ (%s) -> undefined', (_name, error) => {
    expect(toKnownErrorResponse(error)).toBeUndefined();
  });
});
