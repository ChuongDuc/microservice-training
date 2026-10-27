import { JWT_ALGORITHM, JwtPayload } from '@app/common';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { AuthenticatedRequest } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Giá trị header `WWW-Authenticate` theo RFC 6750: thiếu token thì chỉ báo scheme,
 * header sai định dạng -> `invalid_request`, token sai/hết hạn -> `invalid_token`
 * (client biết nên refresh token).
 */
const WWW_AUTHENTICATE = {
  missing: 'Bearer',
  malformed: 'Bearer error="invalid_request"',
  invalid: 'Bearer error="invalid_token"',
} as const;

/**
 * Guard toàn cục: verify access token (`Authorization: Bearer <token>`) ngay tại
 * Gateway bằng JWT_ACCESS_SECRET, không gọi Auth Service. Hợp lệ thì gắn payload vào
 * `request.user`; thiếu/sai/hết hạn -> 401. Route có @Public() được bỏ qua.
 *
 * Đánh đổi: không hỏi Auth/User nên tài khoản bị khoá/xoá hoặc đã logout vẫn dùng
 * được access token tới khi hết hạn (JWT_ACCESS_EXPIRES_IN, mặc định 15 phút).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** Đọc lúc khởi tạo: thiếu secret thì Gateway không khởi động được. */
  private readonly secret: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const header = request.headers.authorization;

    if (!header) {
      throw this.unauthorized(response, 'missing', 'Thiếu access token');
    }
    const token = this.extractBearerToken(header);
    if (!token) {
      throw this.unauthorized(
        response,
        'malformed',
        'Header Authorization phải có dạng "Bearer <token>"',
      );
    }

    const payload = await this.verify(token);
    if (!payload) {
      throw this.unauthorized(
        response,
        'invalid',
        'Access token không hợp lệ hoặc đã hết hạn',
      );
    }

    request.user = payload;
    return true;
  }

  /**
   * Verify chữ ký + hạn và kiểm tra nội dung token; không hợp lệ -> undefined.
   * Bắt buộc có `exp`: jsonwebtoken chỉ kiểm tra hạn khi token có claim này, token
   * thiếu `exp` (dù ký đúng secret) sẽ không bao giờ hết hạn.
   */
  private async verify(token: string): Promise<JwtPayload | undefined> {
    let payload: Partial<JwtPayload> & { exp?: unknown };
    try {
      // Chỉ chấp nhận thuật toán Auth dùng để ký, chặn token tự đổi `alg` (vd: none)
      payload = await this.jwt.verifyAsync(token, {
        secret: this.secret,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      return undefined;
    }
    const { sub, role, exp } = payload;
    if (
      typeof sub !== 'string' ||
      typeof role !== 'string' ||
      typeof exp !== 'number'
    ) {
      return undefined;
    }
    return { sub, role };
  }

  /** `Bearer <token>` -> token; sai định dạng -> undefined. */
  private extractBearerToken(header: string): string | undefined {
    const [scheme, token, ...rest] = header.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length) {
      return undefined;
    }
    return token;
  }

  private unauthorized(
    response: Response,
    reason: keyof typeof WWW_AUTHENTICATE,
    message: string,
  ): UnauthorizedException {
    response.setHeader('WWW-Authenticate', WWW_AUTHENTICATE[reason]);
    return new UnauthorizedException({ statusCode: 401, message });
  }
}
