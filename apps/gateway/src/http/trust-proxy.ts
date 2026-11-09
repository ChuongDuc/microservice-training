import { NestExpressApplication } from '@nestjs/platform-express';

/** Giá trị hợp lệ cho `app.set('trust proxy', ...)` của Express. */
export type TrustProxySetting = boolean | number | string;

/**
 * Đọc TRUST_PROXY: Gateway đứng sau reverse proxy / load balancer thì `req.ip` (dùng để
 * giới hạn đăng nhập) phải lấy từ X-Forwarded-For, nếu không mọi client có chung IP
 * của proxy và chung một bộ đếm.
 * - trống / "false": không tin header (Gateway nhận kết nối trực tiếp) — mặc định.
 * - số nguyên >= 0: số proxy phía trước (vd "1").
 * - chuỗi khác: danh sách IP/subnet proxy tin cậy (vd "loopback, 10.0.0.0/8").
 * Không nhận "true" (tin mọi hop): client gọi thẳng Gateway sẽ giả được IP qua header
 * và né giới hạn đăng nhập.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'false') return false;
  if (value === 'true') {
    throw new Error(
      'TRUST_PROXY=true tin mọi X-Forwarded-For (client giả được IP). Đặt số proxy (vd 1) hoặc IP/subnet proxy tin cậy',
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/** Áp TRUST_PROXY cho app Express (main.ts và e2e dùng chung). */
export function applyTrustProxy(
  app: NestExpressApplication,
  raw: string | undefined,
): void {
  app.set('trust proxy', parseTrustProxy(raw));
}
