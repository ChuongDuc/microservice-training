import { createRpcValidationPipe, SERVICE_TCP_PORTS } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { TaskServiceModule } from './task-service.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong TaskServiceModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cổng ở đây.
  const port = Number(process.env.TASK_SERVICE_PORT ?? SERVICE_TCP_PORTS.TASK);
  // Mặc định chỉ nghe localhost: service trong tin danh tính `{ user }` trong payload,
  // nên chỉ Gateway được gọi tới. Trong Docker đặt 0.0.0.0 và KHÔNG publish cổng ra ngoài.
  const host = process.env.TASK_SERVICE_BIND_HOST ?? '127.0.0.1';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    TaskServiceModule,
    {
      transport: Transport.TCP,
      options: { host, port },
    },
  );

  // Validate payload của mọi message theo DTO (dữ liệu sai bị từ chối trước khi vào handler).
  app.useGlobalPipes(createRpcValidationPipe());
  // SIGTERM/SIGINT (vd: docker stop) -> chạy onModuleDestroy, đóng kết nối DB
  app.enableShutdownHooks();

  await app.listen();
  Logger.log(
    `Task Service (TCP) đang lắng nghe tại ${host}:${port}`,
    'Bootstrap',
  );
}
bootstrap();
