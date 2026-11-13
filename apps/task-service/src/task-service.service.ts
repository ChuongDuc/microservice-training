import {
  AuthUserDto,
  CreateTaskDto,
  isPrismaErrorCode,
  ListTasksDto,
  NOTIFICATION_EVENTS,
  NotificationPublisher,
  PaginatedResult,
  rpcError,
  UpdateTaskDataDto,
} from '@app/common';
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Prisma, Task } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';

/**
 * Điều kiện `where` giới hạn trong task của người gọi. `ownerId` ghi SAU `extra` nên
 * điều kiện truyền vào không ghi đè được chủ task.
 */
export function ownedBy(user: AuthUserDto) {
  const owner = { ownerId: user.userId };
  return {
    /** Lọc danh sách: task của người gọi + điều kiện thêm (vd: status). */
    where: (extra: Prisma.TaskWhereInput = {}): Prisma.TaskWhereInput => ({
      ...extra,
      ...owner,
    }),
    /** Một task theo id, chỉ khớp khi người gọi là chủ (where unique mở rộng). */
    byId: (id: string): Prisma.TaskWhereUniqueInput => ({ id, ...owner }),
  };
}

/**
 * Nghiệp vụ task. Lỗi nghiệp vụ ném RpcException({ statusCode, message }) giống
 * User/Auth Service để Gateway nhận đúng statusCode.
 *
 * Resource ownership: chủ task (`ownerId`) lấy từ danh tính người gọi khi tạo, và MỌI
 * truy vấn đọc/sửa/xoá dựng `where` qua `ownedBy(user)` — không tự viết where cho
 * bảng Task. Task của người khác trả 404 giống task không tồn tại (không lộ id nào
 * đang có thật). Điều kiện chủ task nằm ngay trong câu update/delete (không tìm trước
 * rồi mới ghi) nên không có khoảng hở giữa lúc kiểm tra và lúc ghi.
 */
@Injectable()
export class TaskServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationPublisher,
  ) {}

  /** Tạo task rồi phát `task.created` (không chờ, lỗi phát event không làm hỏng request). */
  async create(user: AuthUserDto, dto: CreateTaskDto): Promise<Task> {
    const task = await this.prisma.task.create({
      data: { ...dto, ownerId: user.userId },
    });
    this.notifications.publish(NOTIFICATION_EVENTS.TASK_CREATED, {
      taskId: task.id,
      ownerId: task.ownerId,
      title: task.title,
    });
    return task;
  }

  async findAll(
    user: AuthUserDto,
    { page, limit, status }: ListTasksDto,
  ): Promise<PaginatedResult<Task>> {
    const where = ownedBy(user).where({ status });
    // Chạy 2 query trong cùng transaction để total khớp với items
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        // id làm tiêu chí phụ: task trùng createdAt vẫn có thứ tự cố định, phân trang
        // không lặp/sót task giữa các trang
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(user: AuthUserDto, id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({
      where: ownedBy(user).byId(id),
    });
    if (!task) throw this.notFound(id);
    return task;
  }

  async update(
    user: AuthUserDto,
    { id, ...data }: UpdateTaskDataDto,
  ): Promise<Task> {
    // Không có field nào để đổi: báo lỗi thay vì trả 200 với task y nguyên (client
    // tưởng đã cập nhật)
    if (Object.keys(data).length === 0) {
      throw rpcError(400, 'Không có field nào để cập nhật');
    }
    try {
      return await this.prisma.task.update({
        where: ownedBy(user).byId(id),
        data,
      });
    } catch (error) {
      // P2025: không có task nào khớp id + ownerId (không tồn tại hoặc của người khác)
      if (isPrismaErrorCode(error, 'P2025')) throw this.notFound(id);
      throw error;
    }
  }

  /** Xoá task, trả về task vừa xoá. */
  async remove(user: AuthUserDto, id: string): Promise<Task> {
    try {
      return await this.prisma.task.delete({
        where: ownedBy(user).byId(id),
      });
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2025')) throw this.notFound(id);
      throw error;
    }
  }

  private notFound(id: string): RpcException {
    return rpcError(404, `Không tìm thấy task với id ${id}`);
  }
}
