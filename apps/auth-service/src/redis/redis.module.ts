import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Giống PrismaModule: @Global để inject RedisService ở mọi provider. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
