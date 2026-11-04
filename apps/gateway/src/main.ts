import { assertJwtSecrets } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GatewayModule } from './gateway.module';

async function bootstrap() {
  // ConfigModule.forRoot() trong GatewayModule đã nạp .env vào process.env
  // ngay khi module được import, nên có thể đọc cổng ở đây.
  const port = Number(process.env.GATEWAY_PORT ?? 3000);
  // Gateway verify access token: secret yếu/mẫu thì ai cũng tự ký được token -> không chạy
  assertJwtSecrets(process.env, ['JWT_ACCESS_SECRET']);

  const app = await NestFactory.create(GatewayModule);
  // SIGTERM/SIGINT (vd: docker stop) -> chạy onModuleDestroy, đóng kết nối DB/Redis/TCP
  app.enableShutdownHooks();
  await app.listen(port);
  Logger.log(`Gateway (HTTP) đang lắng nghe tại cổng ${port}`, 'Bootstrap');
}
bootstrap();
