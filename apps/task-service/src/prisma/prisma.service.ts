import { withPrismaLifecycle } from '@app/common';
import { Injectable } from '@nestjs/common';
// Client được generate riêng cho TASK SERVICE (xem prisma/schema.prisma -> output).
import { PrismaClient } from '../../generated/prisma';

/**
 * Kết nối tới task_db của TASK SERVICE: toàn bộ query API của PrismaClient + lifecycle
 * mở/đóng kết nối dùng chung (withPrismaLifecycle trong @app/common).
 *
 * Inject vào provider khác bằng constructor: `constructor(private prisma: PrismaService) {}`.
 */
@Injectable()
export class PrismaService extends withPrismaLifecycle(
  PrismaClient,
  'task_db',
) {}
