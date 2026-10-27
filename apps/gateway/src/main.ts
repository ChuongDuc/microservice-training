import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GatewayModule } from './gateway.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong GatewayModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cổng ở đây.
  const port = Number(process.env.GATEWAY_PORT ?? 3000);

  const app = await NestFactory.create(GatewayModule);
  await app.listen(port);
  Logger.log(`Gateway (HTTP) đang lắng nghe tại cổng ${port}`, 'Bootstrap');
}
bootstrap();
