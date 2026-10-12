import {
  CreateUserDto,
  ListUsersDto,
  PaginatedResult,
  UpdateUserDto,
} from '@app/common';
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Prisma, User } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';

/**
 * Nghiệp vụ hồ sơ người dùng.
 * Lỗi nghiệp vụ ném RpcException({ statusCode, message }) — KHÔNG dùng HttpException,
 * vì qua TCP phía gọi chỉ nhận được "Internal server error" và mất statusCode.
 */
@Injectable()
export class UserServiceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<User> {
    try {
      return await this.prisma.user.create({ data: dto });
    } catch (error) {
      // P2002: vi phạm ràng buộc unique (email đã tồn tại)
      if (this.isPrismaError(error, 'P2002')) {
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
      if (this.isPrismaError(error, 'P2025')) throw this.notFound(`id ${id}`);
      throw error;
    }
  }

  async list({ page, limit }: ListUsersDto): Promise<PaginatedResult<User>> {
    // Chạy 2 query trong cùng transaction để total khớp với items
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private notFound(by: string): RpcException {
    return new RpcException({
      statusCode: 404,
      message: `Không tìm thấy user với ${by}`,
    });
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
