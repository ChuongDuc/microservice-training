import { createRpcValidationPipe } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { UserServiceModule } from './user-service.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong UserServiceModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cổng ở đây.
  const port = Number(process.env.USER_SERVICE_PORT ?? 4002);
  // Mặc định chỉ nghe localhost: service trong tin danh tính `{ user }` trong payload,
  // nên chỉ Gateway được gọi tới. Trong Docker đặt 0.0.0.0 và KHÔNG publish cổng ra ngoài.
  const host = process.env.USER_SERVICE_BIND_HOST ?? '127.0.0.1';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UserServiceModule,
    {
      transport: Transport.TCP,
      options: { host, port },
    },
  );

  // Validate payload của mọi message theo DTO (dữ liệu sai bị từ chối trước khi vào handler).
  app.useGlobalPipes(createRpcValidationPipe());

  await app.listen();
  Logger.log(
    `User Service (TCP) đang lắng nghe tại ${host}:${port}`,
    'Bootstrap',
  );
}
bootstrap();
