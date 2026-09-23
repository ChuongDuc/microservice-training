import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
// Client được generate riêng cho USER SERVICE (xem prisma/schema.prisma -> output).
import { PrismaClient } from '../../generated/prisma';

/**
 * PrismaService quản lý kết nối tới database của USER SERVICE.
 *
 * - extends PrismaClient: kế thừa toàn bộ query API (this.user, this.$transaction, ...).
 * - OnModuleInit: mở kết nối khi module khởi động (fail-fast nếu DB không sẵn sàng).
 * - OnModuleDestroy: đóng kết nối khi ứng dụng tắt để tránh rò rỉ connection.
 *
 * Inject vào provider khác bằng constructor: `constructor(private prisma: PrismaService) {}`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Đã kết nối tới user_db');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Đã đóng kết nối tới user_db');
  }

  /**
   * Đóng ứng dụng Nest một cách an toàn (graceful shutdown) khi tiến trình nhận
   * tín hiệu tắt từ Prisma. Gọi trong bootstrap khi cần: `prisma.enableShutdownHooks(app)`.
   */
  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
