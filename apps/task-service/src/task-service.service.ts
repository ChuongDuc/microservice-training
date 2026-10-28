import {
  AuthUserDto,
  CreateTaskDto,
  isPrismaErrorCode,
  ListTasksDto,
  PaginatedResult,
  rpcError,
  UpdateTaskDataDto,
} from '@app/common';
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Prisma, Task } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';

/**
 * Nghiệp vụ task. Lỗi nghiệp vụ ném RpcException({ statusCode, message }) giống
 * User/Auth Service để Gateway nhận đúng statusCode.
 *
 * Chủ task (`ownerId`) lấy từ danh tính người gọi khi tạo.
 * CHƯA lọc theo chủ task ở find/update/delete — làm ở issue #19. #19 PHẢI merge trước
 * #20 (REST /tasks ở Gateway), nếu không user đọc/sửa/xoá được task của người khác.
 */
@Injectable()
export class TaskServiceService {
  constructor(private readonly prisma: PrismaService) {}

  create(user: AuthUserDto, dto: CreateTaskDto): Promise<Task> {
    return this.prisma.task.create({ data: { ...dto, ownerId: user.userId } });
  }

  async findAll({
    page,
    limit,
    status,
  }: ListTasksDto): Promise<PaginatedResult<Task>> {
    const where: Prisma.TaskWhereInput = { status };
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

  async findOne(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw this.notFound(id);
    return task;
  }

  async update({ id, ...data }: UpdateTaskDataDto): Promise<Task> {
    // Không có field nào để đổi: báo lỗi thay vì trả 200 với task y nguyên (client
    // tưởng đã cập nhật)
    if (Object.keys(data).length === 0) {
      throw rpcError(400, 'Không có field nào để cập nhật');
    }
    try {
      return await this.prisma.task.update({ where: { id }, data });
    } catch (error) {
      // P2025: không tìm thấy bản ghi cần update
      if (isPrismaErrorCode(error, 'P2025')) throw this.notFound(id);
      throw error;
    }
  }

  /** Xoá task, trả về task vừa xoá. */
  async remove(id: string): Promise<Task> {
    try {
      return await this.prisma.task.delete({ where: { id } });
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2025')) throw this.notFound(id);
      throw error;
    }
  }

  private notFound(id: string): RpcException {
    return rpcError(404, `Không tìm thấy task với id ${id}`);
  }
}
