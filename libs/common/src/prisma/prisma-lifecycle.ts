import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

/** Phần PrismaClient mà lifecycle cần (mỗi service có PrismaClient generate riêng). */
interface PrismaConnection {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

/**
 * Thêm lifecycle kết nối cho PrismaClient của một service:
 * - onModuleInit: mở kết nối khi khởi động (fail-fast nếu DB không sẵn sàng).
 * - onModuleDestroy: đóng kết nối khi tắt. Cần `app.enableShutdownHooks()` trong
 *   main.ts thì SIGTERM/SIGINT (vd: docker stop) mới kích hoạt hook này.
 *
 * Dùng: `@Injectable() export class PrismaService extends withPrismaLifecycle(PrismaClient, 'user_db') {}`
 */
export function withPrismaLifecycle<
  TBase extends Constructor<PrismaConnection>,
>(Base: TBase, databaseName: string) {
  const logger = new Logger('PrismaService');

  return class extends Base implements OnModuleInit, OnModuleDestroy {
    async onModuleInit(): Promise<void> {
      await this.$connect();
      logger.log(`Đã kết nối tới ${databaseName}`);
    }

    async onModuleDestroy(): Promise<void> {
      await this.$disconnect();
      logger.log(`Đã đóng kết nối tới ${databaseName}`);
    }
  };
}
