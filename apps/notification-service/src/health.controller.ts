import {
  AllRpcExceptionsFilter,
  checkDependencies,
  HEALTH_PATTERNS,
  notificationsQueue,
  rabbitmqEnv,
  rabbitmqUrl,
} from '@app/common';
import { Controller, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagePattern, Transport } from '@nestjs/microservices';
import { PrismaService } from './prisma/prisma.service';
import { assertQueueHasConsumer } from './rmq/queue-consumer';

/**
 * Health check qua TCP (Gateway gọi cho `GET /health`): kiểm tra DB và RabbitMQ — queue
 * thông báo phải có consumer, tức service đang thật sự nhận event chứ không chỉ còn
 * sống ở phía TCP.
 */
@Controller()
@UseFilters(AllRpcExceptionsFilter)
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @MessagePattern(HEALTH_PATTERNS.CHECK, Transport.TCP)
  check() {
    const env = rabbitmqEnv(this.config);
    return checkDependencies({
      database: () => this.prisma.$queryRaw`SELECT 1`,
      rabbitmq: () =>
        assertQueueHasConsumer(rabbitmqUrl(env), notificationsQueue(env)),
    });
  }
}
