import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { Response } from 'express';

/**
 * Hai bộ đếm cho route xác thực công khai (mặc định mỗi 60 giây):
 * - `default` (theo IP + email): 5 lần đăng nhập vào MỘT tài khoản từ một IP — chặn
 *   dò mật khẩu mà không chặn nhầm người khác dùng chung IP (văn phòng, NAT).
 * - `ip` (theo IP): 20 lần — chặn một IP dò lần lượt nhiều tài khoản, và giới hạn
 *   /auth/register (dò email đã đăng ký, tạo tài khoản rác).
 */
export const LOGIN_THROTTLE_DEFAULTS = {
  accountLimit: 5,
  ipLimit: 20,
  ttlMs: 60_000,
} as const;

/** Tên bộ đếm theo IP (dùng với @SkipThrottle / header `X-RateLimit-*-ip`). */
export const IP_THROTTLER = 'ip';

export const LOGIN_THROTTLE_MESSAGE =
  'Bạn thao tác quá nhiều lần, vui lòng thử lại sau';

/** Đọc số nguyên dương từ env; sai định dạng thì báo lỗi lúc khởi động thay vì lặng lẽ tắt giới hạn. */
function positiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương, nhận được "${raw}"`);
  }
  return value;
}

type ThrottledRequest = { ip?: string; body?: unknown };

/**
 * Khoá đếm theo IP + email (chuẩn hoá trim + chữ thường để "A@x.com " và "a@x.com"
 * chung một bộ đếm). Body chưa qua validate nên email có thể thiếu/sai kiểu: khi đó
 * chỉ còn IP, vẫn bị giới hạn.
 */
export function ipAndEmailTracker(req: ThrottledRequest): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  const normalized =
    typeof email === 'string' ? email.trim().toLowerCase() : '';
  return `${req.ip ?? ''}|${normalized}`;
}

/**
 * Cấu hình ThrottlerModule. Chỉnh bằng LOGIN_THROTTLE_LIMIT (IP + email),
 * LOGIN_THROTTLE_IP_LIMIT (IP) và LOGIN_THROTTLE_TTL_MS.
 *
 * Bộ đếm nằm trong bộ nhớ Gateway: nhiều instance thì mỗi instance đếm riêng. IP lấy từ
 * `req.ip` — đứng sau reverse proxy thì phải đặt TRUST_PROXY (xem trust-proxy.ts),
 * nếu không mọi client có chung IP của proxy và chung bộ đếm.
 */
export function loginThrottleOptions(
  env: Record<string, string | undefined>,
): ThrottlerModuleOptions {
  const ttl = positiveInt(
    env,
    'LOGIN_THROTTLE_TTL_MS',
    LOGIN_THROTTLE_DEFAULTS.ttlMs,
  );
  return {
    throttlers: [
      {
        name: 'default',
        limit: positiveInt(
          env,
          'LOGIN_THROTTLE_LIMIT',
          LOGIN_THROTTLE_DEFAULTS.accountLimit,
        ),
        ttl,
        getTracker: ipAndEmailTracker,
      },
      {
        name: IP_THROTTLER,
        limit: positiveInt(
          env,
          'LOGIN_THROTTLE_IP_LIMIT',
          LOGIN_THROTTLE_DEFAULTS.ipLimit,
        ),
        ttl,
      },
    ],
    errorMessage: LOGIN_THROTTLE_MESSAGE,
  };
}

/**
 * ThrottlerGuard + header `Retry-After` chuẩn cho mọi bộ đếm: thư viện chỉ đặt
 * `Retry-After` cho bộ đếm tên `default`, bộ đếm `ip` thành `Retry-After-ip` mà client
 * thường không đọc.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', detail.timeToBlockExpire);
    return super.throwThrottlingException(context, detail);
  }
}
