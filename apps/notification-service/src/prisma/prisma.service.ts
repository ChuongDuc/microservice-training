import { withPrismaLifecycle } from '@app/common';
import { Injectable } from '@nestjs/common';
// Client được generate riêng cho NOTIFICATION SERVICE (xem prisma/schema.prisma -> output).
import { PrismaClient } from '../../generated/prisma';

/**
 * Kết nối tới notification_db của NOTIFICATION SERVICE: toàn bộ query API của PrismaClient + lifecycle
 * mở/đóng kết nối dùng chung (withPrismaLifecycle trong @app/common).
 *
 * Inject vào provider khác bằng constructor: `constructor(private prisma: PrismaService) {}`.
 */
@Injectable()
export class PrismaService extends withPrismaLifecycle(
  PrismaClient,
  'notification_db',
) {}
