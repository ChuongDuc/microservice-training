import { Logger } from '@nestjs/common';

export type HealthStatus = 'up' | 'down';

/**
 * Kết quả health check của một service: `status` là `up` khi mọi phụ thuộc (DB, Redis,
 * RabbitMQ...) đều `up`. Chỉ có trạng thái, không kèm thông báo lỗi: Gateway trả nguyên
 * kết quả ra `GET /health` công khai, lỗi chi tiết (host, cổng...) chỉ ghi vào log.
 */
export interface ServiceHealth {
  status: HealthStatus;
  dependencies: Record<string, HealthStatus>;
}

/**
 * Thời gian tối đa cho mỗi phụ thuộc. Phụ thuộc chết thường không báo lỗi ngay (Prisma
 * chờ pool, ioredis xếp lệnh chờ kết nối lại) nên phải cắt bằng timeout.
 */
export const DEPENDENCY_CHECK_TIMEOUT_MS = 3000;

/** Một phụ thuộc cần kiểm tra: resolve = sống, reject/quá hạn = chết. */
export type DependencyCheck = () => Promise<unknown>;

const logger = new Logger('HealthCheck');

/**
 * Chạy song song các kiểm tra phụ thuộc, mỗi cái giới hạn `timeoutMs`. Không bao giờ
 * reject: phụ thuộc lỗi được ghi log và báo `down`.
 */
export async function checkDependencies(
  checks: Record<string, DependencyCheck>,
  timeoutMs = DEPENDENCY_CHECK_TIMEOUT_MS,
): Promise<ServiceHealth> {
  const entries = await Promise.all(
    Object.entries(checks).map(
      async ([name, check]): Promise<[string, HealthStatus]> => {
        try {
          await withTimeout(check(), timeoutMs);
          return [name, 'up'];
        } catch (error) {
          logger.warn(
            `${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [name, 'down'];
        }
      },
    ),
  );
  const dependencies = Object.fromEntries(entries);
  return {
    status: overallStatus(Object.values(dependencies)),
    dependencies,
  };
}

/** `up` khi mọi thành phần đều `up` (danh sách rỗng -> `up`). */
export function overallStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.every((status) => status === 'up') ? 'up' : 'down';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`không phản hồi sau ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
