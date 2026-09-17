import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';

@Module({
  imports: [
    // Nạp biến môi trường từ .env, dùng chung toàn app (isGlobal)
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
})
export class GatewayModule {}
