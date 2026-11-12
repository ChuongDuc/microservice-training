import {
  deadLetterQueue,
  notificationsQueueOptions,
  rabbitmqUrl,
} from '@app/common';
import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';

/** Một event đọc ra từ queue: `{ pattern, data }` như ClientProxy.emit gửi. */
export interface QueuedEvent<T = Record<string, unknown>> {
  pattern: string;
  data: T;
}

/**
 * Queue thông báo riêng cho một file e2e: service phát event vào queue này thay vì
 * `notifications_queue` thật (không để lại message rác, không đụng service đang chạy).
 *
 * Tạo ở top-level của file test, TRƯỚC khi compile module: service đọc tên queue từ
 * RABBITMQ_QUEUE lúc khởi tạo. Gọi `delete()` trong afterAll.
 */
export class NotificationsTestQueue {
  readonly name = `notifications_queue_e2e_${randomUUID()}`;
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  /** Event đã đọc khỏi queue nhưng chưa được `waitFor` nào nhận. */
  private readonly received: QueuedEvent[] = [];

  constructor() {
    process.env.RABBITMQ_QUEUE = this.name;
  }

  /**
   * Chờ tới khi có event `pattern` thoả `match`, trả về event đó (lấy khỏi queue).
   * Event khác đọc ra trong lúc chờ được giữ lại cho lần gọi sau.
   */
  async waitFor<T = Record<string, unknown>>(
    pattern: string,
    match: (data: T) => boolean = () => true,
    timeoutMs = 5000,
  ): Promise<QueuedEvent<T>> {
    const channel = await this.open();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.received.findIndex(
        (event) => event.pattern === pattern && match(event.data as T),
      );
      if (index >= 0)
        return this.received.splice(index, 1)[0] as QueuedEvent<T>;

      const message = await channel.get(this.name, { noAck: true });
      if (message) {
        this.received.push(JSON.parse(message.content.toString()));
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Không thấy event ${pattern} trong queue ${this.name} sau ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Xoá queue (và DLQ nếu có), đóng kết nối. */
  async delete(): Promise<void> {
    const channel = await this.open();
    await channel.deleteQueue(this.name);
    await channel.deleteQueue(deadLetterQueue(this.name));
    await this.connection?.close();
  }

  private async open(): Promise<amqp.Channel> {
    if (!this.channel) {
      this.connection = await amqp.connect(rabbitmqUrl(process.env));
      this.channel = await this.connection.createChannel();
      // Khai báo giống phía phát: đọc được ngay cả khi service chưa phát event nào
      await this.channel.assertQueue(
        this.name,
        notificationsQueueOptions(this.name),
      );
    }
    return this.channel;
  }
}
