import { SERVICE_TCP_PORTS, USER_SERVICE } from '@app/common';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AuthServiceController } from './auth-service.controller';
import { AuthServiceService } from './auth-service.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    RedisModule, // lưu refresh token (hash) có TTL
    // Secret/thời hạn truyền khi ký từng loại token (access/refresh dùng secret khác nhau)
    JwtModule.register({}),
    // TCP client tới USER SERVICE (dùng khi đăng ký để tạo hồ sơ user)
    ClientsModule.registerAsync([
      {
        name: USER_SERVICE,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get('USER_SERVICE_HOST', 'localhost'),
            port: Number(
              config.get('USER_SERVICE_PORT', SERVICE_TCP_PORTS.USER),
            ),
          },
        }),
      },
    ]),
  ],
  controllers: [AuthServiceController],
  providers: [AuthServiceService],
})
export class AuthServiceModule {}
