import { createRpcValidationPipe, SERVICE_TCP_PORTS } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong AuthServiceModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cổng ở đây.
  const port = Number(process.env.AUTH_SERVICE_PORT ?? SERVICE_TCP_PORTS.AUTH);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AuthServiceModule,
    {
      transport: Transport.TCP,
      options: { host: '0.0.0.0', port },
    },
  );

  // Validate payload của mọi message theo DTO (dữ liệu sai bị từ chối trước khi vào handler).
  app.useGlobalPipes(createRpcValidationPipe());

  await app.listen();
  Logger.log(`Auth Service (TCP) đang lắng nghe tại cổng ${port}`, 'Bootstrap');
}
bootstrap();
