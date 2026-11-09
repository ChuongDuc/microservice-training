import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['  ', false],
    ['false', false],
    ['0', 0],
    ['1', 1],
    ['2', 2],
    ['loopback', 'loopback'],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('%p -> %p', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });

  it('"true" -> lỗi (client giả được IP qua X-Forwarded-For)', () => {
    expect(() => parseTrustProxy('true')).toThrow('TRUST_PROXY=true');
  });
});
