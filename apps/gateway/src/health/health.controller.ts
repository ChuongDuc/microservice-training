import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { HealthService, SystemHealth } from './health.service';

/**
 * Health check (công khai, không cần token):
 * - `GET /health/live`: Gateway còn sống — không gọi service nào (Docker healthcheck
 *   của Gateway dùng route này, để service phía trong chết không làm Gateway bị coi là chết).
 * - `GET /health`: trạng thái từng service + phụ thuộc của nó (DB, Redis, RabbitMQ).
 *   200 khi tất cả `up`, 503 khi có thành phần `down` (load balancer/monitor đọc mã HTTP).
 */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @ApiOperation({ summary: 'Gateway còn sống (liveness)' })
  @Get('live')
  live() {
    return { status: 'up' };
  }

  @ApiOperation({ summary: 'Trạng thái mọi service và phụ thuộc (readiness)' })
  @ApiResponse({ status: 200, description: 'Mọi thành phần đều up' })
  @ApiResponse({ status: 503, description: 'Có thành phần down' })
  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<SystemHealth> {
    const health = await this.health.check();
    // Đặt mã trực tiếp (không ném lỗi) để giữ nguyên body chi tiết: exception filter
    // chuẩn hoá lỗi thành { statusCode, message }
    res.status(
      health.status === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return health;
  }
}
