import { AUTH_SERVICE, SERVICE_TCP_PORTS, USER_SERVICE } from '@app/common';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AuthController } from './auth/auth.controller';

/** Cấu hình TCP client tới một service, đọc host/port từ .env. */
const tcpClient = (name: string, envPrefix: string, defaultPort: number) => ({
  name,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    transport: Transport.TCP as const,
    options: {
      host: config.get(`${envPrefix}_HOST`, 'localhost'),
      port: Number(config.get(`${envPrefix}_PORT`, defaultPort)),
    },
  }),
});

@Module({
  imports: [
    // Nạp biến môi trường từ .env, dùng chung toàn app (isGlobal)
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // Gateway là cửa vào HTTP duy nhất, gọi các service bên trong qua TCP
    ClientsModule.registerAsync([
      tcpClient(AUTH_SERVICE, 'AUTH_SERVICE', SERVICE_TCP_PORTS.AUTH),
      tcpClient(USER_SERVICE, 'USER_SERVICE', SERVICE_TCP_PORTS.USER),
    ]),
  ],
  controllers: [AuthController],
})
export class GatewayModule {}
