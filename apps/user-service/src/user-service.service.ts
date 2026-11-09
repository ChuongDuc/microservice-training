import {
  AdminListUsersDto,
  AuthUserDto,
  CreateUserDto,
  isPrismaErrorCode,
  ListUsersDto,
  PaginatedResult,
  rpcError,
  UpdateUserDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from '@app/common';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Prisma, User } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';

/**
 * Escape ký tự đặc biệt của LIKE: Prisma `contains` đưa chuỗi thẳng vào ILIKE '%…%' mà
 * không escape, nên tìm "%" hay "_" sẽ khớp mọi user. Postgres dùng `\` làm ký tự
 * escape mặc định của LIKE.
 */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/**
 * Nghiệp vụ hồ sơ người dùng.
 * Lỗi nghiệp vụ ném RpcException({ statusCode, message }) — KHÔNG dùng HttpException,
 * vì qua TCP phía gọi chỉ nhận được "Internal server error" và mất statusCode.
 */
@Injectable()
export class UserServiceService {
  private readonly logger = new Logger(UserServiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<User> {
    try {
      return await this.prisma.user.create({ data: dto });
    } catch (error) {
      // P2002: vi phạm ràng buộc unique (email đã tồn tại)
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new RpcException({
          statusCode: 409,
          message: `Email ${dto.email} đã tồn tại`,
        });
      }
      throw error;
    }
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw this.notFound(`id ${id}`);
    return user;
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw this.notFound(`email ${email}`);
    return user;
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    try {
      return await this.prisma.user.update({ where: { id }, data });
    } catch (error) {
      // P2025: không tìm thấy bản ghi cần update
      if (isPrismaErrorCode(error, 'P2025')) throw this.notFound(`id ${id}`);
      throw error;
    }
  }

  async list({ page, limit }: ListUsersDto): Promise<PaginatedResult<User>> {
    // Chạy 2 query trong cùng transaction để total khớp với items
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
        // id làm tiêu chí phụ: user trùng createdAt vẫn có thứ tự cố định, phân trang
        // không lặp/sót user giữa các trang
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.user.count(),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Danh sách user cho admin: phân trang, tìm theo email/tên hiển thị (không phân biệt
   * hoa thường), lọc theo role/status.
   */
  async adminList(
    caller: AuthUserDto,
    { page, limit, search, role, status }: AdminListUsersDto,
  ): Promise<PaginatedResult<User>> {
    await this.assertAdmin(this.prisma, caller);
    const where: Prisma.UserWhereInput = { role, status };
    if (search) {
      const contains = escapeLike(search);
      where.OR = [
        { email: { contains, mode: 'insensitive' } },
        { displayName: { contains, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Admin đổi role một user. Có hiệu lực khi người đó lấy access token mới (đăng
   * nhập/refresh), token đang dùng giữ role cũ tới khi hết hạn.
   */
  updateRole(caller: AuthUserDto, { id, role }: UpdateUserRoleDto) {
    return this.adminUpdate(
      caller,
      id,
      { role },
      'Không thể tự đổi role của chính mình',
    );
  }

  /**
   * Admin khoá / mở khoá một user. User bị khoá không đăng nhập hay refresh được nữa
   * (Auth Service kiểm tra status); access token đang có vẫn dùng được tới khi hết hạn.
   */
  updateStatus(caller: AuthUserDto, { id, status }: UpdateUserStatusDto) {
    return this.adminUpdate(
      caller,
      id,
      { status },
      'Không thể tự khoá hoặc mở khoá tài khoản của chính mình',
    );
  }

  /**
   * Đổi role/status của user khác, luôn còn ít nhất một ADMIN đang hoạt động:
   * - Người gọi phải là ADMIN + ACTIVE theo DB (không tin role trong token: admin vừa
   *   bị hạ quyền/khoá vẫn còn token ADMIN tới 15 phút).
   * - Không được thao tác trên chính mình.
   * Hai điều kiện trên nghĩa là sau thao tác người gọi vẫn là admin. Kiểm tra và ghi
   * nằm trong cùng transaction Serializable: hai admin hạ quyền lẫn nhau cùng lúc thì
   * Postgres huỷ một bên (P2034) thay vì để cả hai thành công và mất hết admin.
   */
  private async adminUpdate(
    caller: AuthUserDto,
    id: string,
    data: Pick<Prisma.UserUpdateInput, 'role' | 'status'>,
    selfMessage: string,
  ): Promise<User> {
    try {
      const user = await this.prisma.$transaction(
        async (tx) => {
          await this.assertAdmin(tx, caller);
          if (id === caller.userId) throw rpcError(400, selfMessage);
          return tx.user.update({ where: { id }, data });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      this.logger.log(
        `Admin ${caller.userId} cập nhật user ${id}: ${JSON.stringify(data)}`,
      );
      return user;
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2025')) throw this.notFound(`id ${id}`);
      // P2034: xung đột ghi đồng thời (transaction Serializable bị huỷ)
      if (isPrismaErrorCode(error, 'P2034')) {
        throw rpcError(
          409,
          'Thao tác xung đột với thay đổi khác, vui lòng thử lại',
        );
      }
      throw error;
    }
  }

  /**
   * Người gọi phải là ADMIN đang hoạt động theo DB. Không tin `caller.role` (lấy từ
   * access token, có thể cũ tới 15 phút); Gateway đã chặn bằng @Roles('ADMIN') nhưng
   * kiểm tra lại ở đây để route quên gắn @Roles() cũng không lọt.
   */
  private async assertAdmin(
    db: Pick<Prisma.TransactionClient, 'user'>,
    caller: AuthUserDto,
  ): Promise<void> {
    const current = await db.user.findUnique({
      where: { id: caller.userId },
      select: { role: true, status: true },
    });
    if (current?.role !== 'ADMIN' || current.status !== 'ACTIVE') {
      throw rpcError(403, 'Chỉ ADMIN được thực hiện thao tác này');
    }
  }

  private notFound(by: string): RpcException {
    return rpcError(404, `Không tìm thấy user với ${by}`);
  }
}
