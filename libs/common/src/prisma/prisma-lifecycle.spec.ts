import { Logger } from '@nestjs/common';
import { withPrismaLifecycle } from './prisma-lifecycle';

describe('withPrismaLifecycle', () => {
  class FakeClient {
    connected = false;
    async $connect() {
      this.connected = true;
    }
    async $disconnect() {
      this.connected = false;
    }
    query() {
      return 'kết quả';
    }
  }
  class FakePrismaService extends withPrismaLifecycle(FakeClient, 'demo_db') {}

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  it('onModuleInit kết nối, onModuleDestroy đóng kết nối, log tên DB', async () => {
    const service = new FakePrismaService();

    await service.onModuleInit();
    expect(service.connected).toBe(true);
    expect(Logger.prototype.log).toHaveBeenCalledWith('Đã kết nối tới demo_db');

    await service.onModuleDestroy();
    expect(service.connected).toBe(false);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'Đã đóng kết nối tới demo_db',
    );
  });

  it('giữ nguyên API của client gốc', () => {
    expect(new FakePrismaService().query()).toBe('kết quả');
  });

  it('kết nối lỗi -> onModuleInit ném lỗi (service không khởi động)', async () => {
    class BrokenClient extends FakeClient {
      async $connect() {
        throw new Error('DB không sẵn sàng');
      }
    }
    const service = new (withPrismaLifecycle(BrokenClient, 'demo_db'))();
    await expect(service.onModuleInit()).rejects.toThrow('DB không sẵn sàng');
  });
});
