import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TaskServiceController } from './task-service.controller';
import { TaskServiceService } from './task-service.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [TaskServiceController],
  providers: [TaskServiceService],
})
export class TaskServiceModule {}
