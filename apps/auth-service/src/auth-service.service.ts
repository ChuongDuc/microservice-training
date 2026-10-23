import {
  AuthTokens,
  JwtPayload,
  LoginDto,
  RegisterDto,
  USER_PATTERNS,
  USER_SERVICE,
} from '@app/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
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

  /**
   * Hash giả để verify khi email không tồn tại: thời gian phản hồi giống trường hợp
   * sai mật khẩu, kẻ tấn công không đo thời gian để dò email nào đã đăng ký.
   */
  private readonly dummyHash = argon2.hash(randomUUID());

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_SERVICE) private readonly userClient: ClientProxy,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

    const user = await this.callUserService(USER_PATTERNS.CREATE, {
      email,
      displayName,
    });

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

  /**
   * Đăng nhập: kiểm tra password → lấy role mới nhất từ USER SERVICE → cấp
   * access token (JWT ngắn hạn) + refresh token (lưu hash vào auth_db).
   * Sai email hay sai mật khẩu đều trả cùng một lỗi 401 để không lộ email nào tồn tại.
   */
  async login({ email, password }: LoginDto): Promise<AuthTokens> {
    const credential = await this.prisma.credential.findUnique({
      where: { email },
    });
    const valid = await argon2.verify(
      credential?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!credential || !valid) throw this.invalidCredentials();

    const user = await this.findUserProfile(credential.userId);
    if (user.status !== 'ACTIVE') {
      throw new RpcException({
        statusCode: 403,
        message: 'Tài khoản đã bị khoá',
      });
    }

    return this.issueTokens({ sub: user.id, role: user.role });
  }

  /** Ký cặp token và lưu hash của refresh token. */
  private async issueTokens(payload: JwtPayload): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
    });
    // Refresh token chỉ cần userId; `jti` ngẫu nhiên để mỗi token là duy nhất
    // (2 lần login trong cùng 1 giây không sinh ra token trùng nhau).
    const refreshToken = await this.jwt.signAsync(
      { sub: payload.sub },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
        jwtid: randomUUID(),
      },
    );

    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * SHA-256 (không dùng argon2): token đã đủ ngẫu nhiên nên không brute-force được,
   * và hash cố định mới tra cứu được theo cột unique `tokenHash`.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Lấy hồ sơ user; user không còn bên USER SERVICE thì coi như đăng nhập sai. */
  private async findUserProfile(id: string): Promise<UserProfile> {
    try {
      return await this.callUserService(USER_PATTERNS.FIND_BY_ID, { id });
    } catch (error) {
      if (
        error instanceof RpcException &&
        (error.getError() as { statusCode?: number }).statusCode === 404
      ) {
        this.logger.warn(
          `Credential của user ${id} không có hồ sơ bên User Service`,
        );
        throw this.invalidCredentials();
      }
      throw error;
    }
  }

  /** Gọi USER SERVICE qua TCP, chuyển lỗi về dạng RpcException có statusCode. */
  private async callUserService(
    pattern: string,
    payload: unknown,
  ): Promise<UserProfile> {
    try {
      return await firstValueFrom(
        this.userClient
          .send<UserProfile>(pattern, payload)
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

  private invalidCredentials(): RpcException {
    return new RpcException({
      statusCode: 401,
      message: 'Email hoặc mật khẩu không đúng',
    });
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
