import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UserServiceController } from './user-service.controller';
import { UserServiceService } from './user-service.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [UserServiceController],
  providers: [UserServiceService],
})
export class UserServiceModule {}
