import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule là @Global: chỉ cần import một lần ở module gốc, PrismaService
 * sẽ có thể inject được vào mọi provider khác mà không cần import lại.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
