import { checkDependencies, HEALTH_PATTERNS } from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

/**
 * Health check qua TCP (Gateway gọi cho `GET /health`): kiểm tra DB và Redis (refresh
 * token). User Service được Gateway kiểm tra riêng nên không tính ở đây.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @MessagePattern(HEALTH_PATTERNS.CHECK)
  check() {
    return checkDependencies({
      database: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
    });
  }
}
