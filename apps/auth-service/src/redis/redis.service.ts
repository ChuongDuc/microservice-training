import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * RedisService quản lý kết nối Redis của AUTH SERVICE (lưu refresh token).
 *
 * - extends Redis (ioredis): dùng trực tiếp các lệnh như this.redis.set / getdel / del.
 * - OnModuleDestroy: đóng kết nối khi ứng dụng tắt để tránh rò rỉ connection.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    super({
      host: config.get('REDIS_HOST', 'localhost'),
      port: Number(config.get('REDIS_PORT', 6379)),
    });
    this.on('error', (error) =>
      this.logger.error(`Lỗi kết nối Redis: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
    this.logger.log('Đã đóng kết nối tới Redis');
  }
}
