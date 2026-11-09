import {
  ipAndEmailTracker,
  IP_THROTTLER,
  LOGIN_THROTTLE_DEFAULTS,
  LOGIN_THROTTLE_MESSAGE,
  loginThrottleOptions,
} from './login-throttle';

describe('loginThrottleOptions', () => {
  it('mặc định: 5 lần / IP + email, 20 lần / IP, mỗi 60 giây', () => {
    expect(loginThrottleOptions({})).toEqual({
      throttlers: [
        {
          name: 'default',
          limit: LOGIN_THROTTLE_DEFAULTS.accountLimit,
          ttl: LOGIN_THROTTLE_DEFAULTS.ttlMs,
          getTracker: ipAndEmailTracker,
        },
        {
          name: IP_THROTTLER,
          limit: LOGIN_THROTTLE_DEFAULTS.ipLimit,
          ttl: LOGIN_THROTTLE_DEFAULTS.ttlMs,
        },
      ],
      errorMessage: LOGIN_THROTTLE_MESSAGE,
    });
  });

  it('đọc LOGIN_THROTTLE_LIMIT / LOGIN_THROTTLE_IP_LIMIT / LOGIN_THROTTLE_TTL_MS', () => {
    expect(
      loginThrottleOptions({
        LOGIN_THROTTLE_LIMIT: '3',
        LOGIN_THROTTLE_IP_LIMIT: '50',
        LOGIN_THROTTLE_TTL_MS: '30000',
      }),
    ).toMatchObject({
      throttlers: [
        { limit: 3, ttl: 30_000 },
        { limit: 50, ttl: 30_000 },
      ],
    });
  });

  it.each(['0', '-1', '1.5', 'abc', '5 lần'])(
    'giá trị sai (%p) -> lỗi lúc khởi động, không lặng lẽ tắt giới hạn',
    (raw) => {
      for (const key of [
        'LOGIN_THROTTLE_LIMIT',
        'LOGIN_THROTTLE_IP_LIMIT',
        'LOGIN_THROTTLE_TTL_MS',
      ]) {
        expect(() => loginThrottleOptions({ [key]: raw })).toThrow(
          `${key} phải là số nguyên dương`,
        );
      }
    },
  );
});

describe('ipAndEmailTracker', () => {
  it('IP + email chuẩn hoá (trim, chữ thường)', () => {
    expect(
      ipAndEmailTracker({ ip: '1.2.3.4', body: { email: '  An@Test.COM ' } }),
    ).toBe('1.2.3.4|an@test.com');
  });

  it('cùng IP khác email -> khác khoá; cùng email khác IP -> khác khoá', () => {
    const a = ipAndEmailTracker({ ip: '1.1.1.1', body: { email: 'a@x.com' } });
    expect(
      ipAndEmailTracker({ ip: '1.1.1.1', body: { email: 'b@x.com' } }),
    ).not.toBe(a);
    expect(
      ipAndEmailTracker({ ip: '2.2.2.2', body: { email: 'a@x.com' } }),
    ).not.toBe(a);
  });

  it.each([undefined, {}, { email: 123 }, { email: ['a@x.com'] }, 'chuoi'])(
    'body thiếu/sai email (%p) -> chỉ còn IP, vẫn bị đếm',
    (body) => {
      expect(ipAndEmailTracker({ ip: '1.2.3.4', body })).toBe('1.2.3.4|');
    },
  );
});
