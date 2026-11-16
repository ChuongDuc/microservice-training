import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Đường dẫn Swagger UI; JSON OpenAPI ở `${SWAGGER_PATH}-json`. */
export const SWAGGER_PATH = 'api';

/** Tên security scheme Bearer JWT, dùng với `@ApiBearerAuth(BEARER_AUTH)`. */
export const BEARER_AUTH = 'access-token';

/**
 * Bật Swagger UI ở `/api` (tắt bằng SWAGGER_ENABLED=false). Schema body/query lấy từ DTO
 * nhờ CLI plugin `@nestjs/swagger` (nest-cli.json): đọc kiểu TypeScript, rule
 * class-validator và comment JSDoc — không phải gắn @ApiProperty vào từng field.
 *
 * Route Swagger đăng ký thẳng vào HTTP server, không qua guard toàn cục (JwtAuthGuard),
 * nên xem tài liệu không cần token. Gọi thử route cần token: bấm "Authorize", dán
 * `accessToken` lấy từ POST /auth/login.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Task Management API')
    .setDescription(
      [
        'REST API của Gateway — cửa vào HTTP duy nhất, forward xuống các microservice qua TCP.',
        '',
        'Lỗi luôn có dạng `{ statusCode, message, errors? }` (`errors` chỉ có với lỗi validate).',
        'Route có ổ khoá cần header `Authorization: Bearer <accessToken>`.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '`accessToken` trả về từ POST /auth/login (hạn 15 phút)',
      },
      BEARER_AUTH,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    // Giữ token đã nhập khi tải lại trang
    swaggerOptions: { persistAuthorization: true },
  });
}

/** Swagger bật mặc định; chỉ tắt khi SWAGGER_ENABLED là `false`. */
export function isSwaggerEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false';
}
