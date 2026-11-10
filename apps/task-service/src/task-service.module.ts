import { AllRpcExceptionsFilter } from '@app/common';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TaskServiceController } from './task-service.controller';
import { TaskServiceService } from './task-service.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
  ],
  controllers: [TaskServiceController],
  providers: [
    TaskServiceService,
    // Mọi lỗi trả về phía gọi theo dạng thống nhất { statusCode, message, errors? }
    { provide: APP_FILTER, useClass: AllRpcExceptionsFilter },
  ],
})
export class TaskServiceModule {}
