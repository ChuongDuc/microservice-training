import {
  assertJwtSecrets,
  createRpcValidationPipe,
  SERVICE_TCP_PORTS,
} from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong AuthServiceModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cổng ở đây.
  const port = Number(process.env.AUTH_SERVICE_PORT ?? SERVICE_TCP_PORTS.AUTH);
  // Mặc định chỉ nghe localhost: service trong tin danh tính `{ user }` trong payload,
  // nên chỉ Gateway được gọi tới. Trong Docker đặt 0.0.0.0 và KHÔNG publish cổng ra ngoài.
  const host = process.env.AUTH_SERVICE_BIND_HOST ?? '127.0.0.1';
  // Auth ký cả access lẫn refresh token: secret yếu/mẫu/trùng nhau -> không chạy
  assertJwtSecrets(process.env, ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AuthServiceModule,
    {
      transport: Transport.TCP,
      options: { host, port },
    },
  );

  // Validate payload của mọi message theo DTO (dữ liệu sai bị từ chối trước khi vào handler).
  app.useGlobalPipes(createRpcValidationPipe());
  // SIGTERM/SIGINT (vd: docker stop) -> chạy onModuleDestroy, đóng kết nối DB/Redis/TCP
  app.enableShutdownHooks();

  await app.listen();
  Logger.log(
    `Auth Service (TCP) đang lắng nghe tại ${host}:${port}`,
    'Bootstrap',
  );
}
bootstrap();
