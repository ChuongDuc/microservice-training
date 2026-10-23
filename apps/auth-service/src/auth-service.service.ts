import { RegisterDto, USER_PATTERNS, USER_SERVICE } from '@app/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import * as argon2 from 'argon2';
import { firstValueFrom, timeout } from 'rxjs';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma/prisma.service';

/**
 * Hồ sơ user do USER SERVICE trả về (khai báo các field chính, payload thực tế còn
 * avatar/createdAt/...). Auth không import kiểu Prisma của User Service để giữ ranh giới.
 */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
}

/** Thời gian tối đa chờ USER SERVICE phản hồi. */
const USER_SERVICE_TIMEOUT_MS = 5000;

/**
 * Nghiệp vụ xác thực. Lỗi nghiệp vụ ném RpcException({ statusCode, message })
 * giống User Service để phía gọi (Gateway) nhận được đúng statusCode.
 */
@Injectable()
export class AuthServiceService {
  private readonly logger = new Logger(AuthServiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_SERVICE) private readonly userClient: ClientProxy,
  ) {}

  /**
   * Đăng ký: hash password → USER SERVICE tạo hồ sơ (user.create) → lưu Credential.
   * Trả về hồ sơ user (không bao giờ trả password/hash).
   */
  async register({
    email,
    password,
    displayName,
  }: RegisterDto): Promise<UserProfile> {
    // Kiểm tra trước ở auth_db để không tạo user "mồ côi" bên user_db
    const existing = await this.prisma.credential.findUnique({
      where: { email },
    });
    if (existing) throw this.emailConflict(email);

    // argon2id (mặc định của thư viện) — salt ngẫu nhiên được nhúng sẵn trong chuỗi hash
    const passwordHash = await argon2.hash(password);

    const user = await this.createUserProfile(email, displayName);

    try {
      await this.prisma.credential.create({
        data: { userId: user.id, email, passwordHash },
      });
    } catch (error) {
      // Hai service không chung transaction: user đã tạo bên user_db nhưng credential
      // lưu thất bại -> user "mồ côi", email đó sẽ không đăng ký lại được (User Service
      // báo 409). Ghi log để xử lý tay; chưa có message user.delete để tự bù trừ.
      this.logger.error(
        `Đã tạo user ${user.id} nhưng lưu credential thất bại`,
        error instanceof Error ? error.stack : String(error),
      );
      if (this.isPrismaError(error, 'P2002')) throw this.emailConflict(email);
      throw error;
    }

    return user;
  }

  /** Gọi USER SERVICE qua TCP, chuyển lỗi về dạng RpcException có statusCode. */
  private async createUserProfile(
    email: string,
    displayName: string,
  ): Promise<UserProfile> {
    try {
      return await firstValueFrom(
        this.userClient
          .send<UserProfile>(USER_PATTERNS.CREATE, { email, displayName })
          .pipe(timeout(USER_SERVICE_TIMEOUT_MS)),
      );
    } catch (error) {
      // Lỗi nghiệp vụ từ USER SERVICE (vd: 409 trùng email) — chuyển tiếp nguyên trạng
      if (this.hasStatusCode(error)) throw new RpcException(error);
      // Timeout, không kết nối được, hoặc lỗi không có statusCode (User Service lỗi nội bộ)
      this.logger.error(
        'Không gọi được User Service',
        error instanceof Error ? error.stack : String(error),
      );
      throw new RpcException({
        statusCode: 503,
        message: 'User Service không khả dụng',
      });
    }
  }

  private emailConflict(email: string): RpcException {
    return new RpcException({
      statusCode: 409,
      message: `Email ${email} đã được đăng ký`,
    });
  }

  private hasStatusCode(error: unknown): error is { statusCode: number } {
    return (
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
    );
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
