import {
  AuthUserDto,
  isPrismaErrorCode,
  ListNotificationsDto,
  PaginatedResult,
  TaskCreatedEvent,
  UserRegisteredEvent,
} from '@app/common';
import { Injectable, Logger } from '@nestjs/common';
import { Notification, Prisma } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';

/**
 * Tạo thông báo từ event (RabbitMQ) và trả danh sách thông báo của user (TCP, qua
 * Gateway).
 *
 * Chống trùng: RabbitMQ giao "ít nhất một lần" — service tắt sau khi lưu mà trước khi
 * ack thì event được giao lại. `eventId` là UNIQUE trong bảng Notification, nên lần lưu
 * thứ hai vi phạm unique và bị bỏ qua (event vẫn được ack, không vào DLQ).
 */
@Injectable()
export class NotificationServiceService {
  private readonly logger = new Logger(NotificationServiceService.name);

  /**
   * Khoảng chờ giữa các lần thử lại khi lỗi DB tạm thời (tổng ~3,5 giây). Trong lúc chờ
   * message chưa ack vẫn chiếm một chỗ trong prefetch (NOTIFICATIONS_PREFETCH).
   */
  retryDelaysMs: readonly number[] = [500, 1000, 2000];

  constructor(private readonly prisma: PrismaService) {}

  handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    return this.store({
      eventId: event.eventId,
      userId: event.userId,
      type: 'USER_REGISTERED',
      title: 'Chào mừng bạn',
      message: `Chào ${event.displayName}, tài khoản của bạn đã được tạo.`,
    });
  }

  handleTaskCreated(event: TaskCreatedEvent): Promise<void> {
    return this.store({
      eventId: event.eventId,
      userId: event.ownerId,
      type: 'TASK_CREATED',
      title: 'Task mới',
      message: `Bạn vừa tạo task "${event.title}".`,
      data: { taskId: event.taskId },
    });
  }

  /** Thông báo của người gọi, mới nhất trước, có phân trang. */
  async findAll(
    user: AuthUserDto,
    { page, limit }: ListNotificationsDto,
  ): Promise<PaginatedResult<Notification>> {
    const where: Prisma.NotificationWhereInput = { userId: user.userId };
    // Chạy 2 query trong cùng transaction để total khớp với items
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        // id làm tiêu chí phụ: thông báo trùng createdAt vẫn có thứ tự cố định
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Lưu thông báo. Lỗi kết nối DB tạm thời (Postgres restart, mất kết nối, hết
   * connection trong pool) được thử lại theo `retryDelaysMs` trước khi ném lỗi: ném lỗi
   * thì event bị nack và chuyển thẳng vào dead-letter queue, phải đưa lại bằng tay. DB
   * tắt lâu hơn tổng thời gian thử lại thì event vẫn vào DLQ (không mất).
   */
  private async store(data: Prisma.NotificationCreateInput): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.notification.create({ data });
        return;
      } catch (error) {
        // P2002: eventId đã có -> event giao lại, thông báo đã lưu từ lần trước
        if (isPrismaErrorCode(error, 'P2002')) {
          this.logger.log(`Bỏ qua event trùng ${data.eventId}`);
          return;
        }
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined || !isTransientDbError(error)) throw error;
        this.logger.warn(
          `Lưu thông báo cho event ${data.eventId} lỗi (${(error as Error).message}), thử lại sau ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

/** Mã lỗi Prisma do mất kết nối / DB quá tải — thử lại có thể thành công. */
const TRANSIENT_PRISMA_CODES = new Set([
  'P1001', // không kết nối được DB
  'P1002', // kết nối timeout
  'P1008', // thao tác timeout
  'P1017', // server đóng kết nối
  'P2024', // hết thời gian chờ connection trong pool
]);

/** Lỗi DB tạm thời: chưa kết nối được (khởi tạo) hoặc mã lỗi kết nối ở trên. */
export function isTransientDbError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code, errorCode } = error as {
    name?: unknown;
    code?: unknown;
    errorCode?: unknown;
  };
  if (name === 'PrismaClientInitializationError') return true;
  const prismaCode =
    name === 'PrismaClientKnownRequestError' ? code : errorCode;
  return (
    typeof prismaCode === 'string' && TRANSIENT_PRISMA_CODES.has(prismaCode)
  );
}
