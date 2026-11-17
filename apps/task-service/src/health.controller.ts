import { checkDependencies, HEALTH_PATTERNS } from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { PrismaService } from './prisma/prisma.service';

/** Health check qua TCP (Gateway gọi cho `GET /health`): kiểm tra kết nối DB. */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @MessagePattern(HEALTH_PATTERNS.CHECK)
  check() {
    return checkDependencies({
      database: () => this.prisma.$queryRaw`SELECT 1`,
    });
  }
}
