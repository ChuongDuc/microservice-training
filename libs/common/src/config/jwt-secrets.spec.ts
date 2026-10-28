import {
  assertJwtSecrets,
  JWT_SECRET_PLACEHOLDERS,
  MIN_JWT_SECRET_LENGTH,
} from './jwt-secrets';

describe('assertJwtSecrets', () => {
  const strong = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
  const other = 'b'.repeat(MIN_JWT_SECRET_LENGTH);
  const KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

  it('chấp nhận secret đủ dài, khác mẫu, khác nhau', () => {
    expect(() =>
      assertJwtSecrets(
        { JWT_ACCESS_SECRET: strong, JWT_REFRESH_SECRET: other },
        KEYS,
      ),
    ).not.toThrow();
  });

  it.each([
    ['thiếu', {}, 'chưa được đặt'],
    ['chuỗi rỗng', { JWT_ACCESS_SECRET: '' }, 'chưa được đặt'],
    [
      'giá trị mẫu',
      { JWT_ACCESS_SECRET: JWT_SECRET_PLACEHOLDERS[0] },
      'giá trị mẫu',
    ],
    [
      'quá ngắn',
      { JWT_ACCESS_SECRET: 'a'.repeat(MIN_JWT_SECRET_LENGTH - 1) },
      'ít nhất',
    ],
  ])('từ chối secret %s', (_case, env, message) => {
    expect(() => assertJwtSecrets(env, ['JWT_ACCESS_SECRET'])).toThrow(message);
  });

  it('từ chối access và refresh trùng nhau', () => {
    expect(() =>
      assertJwtSecrets(
        { JWT_ACCESS_SECRET: strong, JWT_REFRESH_SECRET: strong },
        KEYS,
      ),
    ).toThrow('không được trùng nhau');
  });

  it('báo đủ mọi vấn đề trong một lần', () => {
    expect(() =>
      assertJwtSecrets(
        {
          JWT_ACCESS_SECRET: JWT_SECRET_PLACEHOLDERS[0],
          JWT_REFRESH_SECRET: 'ngan',
        },
        KEYS,
      ),
    ).toThrow(/giá trị mẫu[\s\S]*ít nhất/);
  });
});
