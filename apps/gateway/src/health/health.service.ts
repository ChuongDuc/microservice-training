import {
  AUTH_SERVICE,
  HEALTH_PATTERNS,
  HealthStatus,
  NOTIFICATION_SERVICE,
  overallStatus,
  ServiceHealth,
  TASK_SERVICE,
  USER_SERVICE,
} from '@app/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * Thời gian chờ mỗi service trả lời health check: lớn hơn thời gian service tự kiểm tra
 * phụ thuộc (DEPENDENCY_CHECK_TIMEOUT_MS = 3s) để service chậm vì phụ thuộc chết vẫn kịp
 * báo `down` cho từng phụ thuộc, thay vì Gateway coi cả service là chết.
 */
export const SERVICE_HEALTH_TIMEOUT_MS = 5000;

/** Một service trong báo cáo: không gọi được thì không có `dependencies`. */
export type ServiceHealthEntry = {
  status: HealthStatus;
  dependencies?: Record<string, HealthStatus>;
};

export interface SystemHealth {
  status: HealthStatus;
  services: Record<string, ServiceHealthEntry>;
}

/** Tổng hợp health của Gateway và mọi service phía trong (gọi song song qua TCP). */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly services: Record<string, ClientProxy>;

  constructor(
    @Inject(AUTH_SERVICE) auth: ClientProxy,
    @Inject(USER_SERVICE) user: ClientProxy,
    @Inject(TASK_SERVICE) task: ClientProxy,
    @Inject(NOTIFICATION_SERVICE) notification: ClientProxy,
  ) {
    this.services = {
      'auth-service': auth,
      'user-service': user,
      'task-service': task,
      'notification-service': notification,
    };
  }

  async check(): Promise<SystemHealth> {
    const entries = await Promise.all(
      Object.entries(this.services).map(
        async ([name, client]): Promise<[string, ServiceHealthEntry]> => [
          name,
          await this.checkService(name, client),
        ],
      ),
    );
    const services: Record<string, ServiceHealthEntry> = {
      // Đang trả lời request này thì Gateway sống
      gateway: { status: 'up' },
      ...Object.fromEntries(entries),
    };
    return {
      status: overallStatus(Object.values(services).map((s) => s.status)),
      services,
    };
  }

  private async checkService(
    name: string,
    client: ClientProxy,
  ): Promise<ServiceHealthEntry> {
    try {
      const health = await firstValueFrom(
        client
          .send<ServiceHealth>(HEALTH_PATTERNS.CHECK, {})
          .pipe(timeout(SERVICE_HEALTH_TIMEOUT_MS)),
      );
      return sanitize(health);
    } catch (error) {
      this.logger.warn(
        `${name} không trả lời health check: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      );
      return { status: 'down' };
    }
  }
}

/**
 * Chỉ giữ trạng thái `up`/`down` từ phản hồi của service (kết quả trả thẳng ra API công
 * khai); giá trị lạ coi như `down`.
 */
function sanitize(health: ServiceHealth): ServiceHealthEntry {
  const dependencies = Object.fromEntries(
    Object.entries(health?.dependencies ?? {}).map(([name, status]) => [
      name,
      toStatus(status),
    ]),
  );
  return {
    status: overallStatus([
      toStatus(health?.status),
      ...Object.values(dependencies),
    ]),
    dependencies,
  };
}

const toStatus = (value: unknown): HealthStatus =>
  value === 'up' ? 'up' : 'down';
