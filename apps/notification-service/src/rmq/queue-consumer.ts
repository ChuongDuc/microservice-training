import { DEPENDENCY_CHECK_TIMEOUT_MS } from '@app/common';
import * as amqp from 'amqplib';

/**
 * Kiểm tra queue có ít nhất một consumer (Notification Service đang nhận event). Mở kết
 * nối riêng rồi đóng ngay: Nest không công khai trạng thái kết nối của server RMQ.
 *
 * Lưu ý: chạy nhiều instance thì consumer của instance khác cũng được tính.
 */
export async function assertQueueHasConsumer(
  url: string,
  queue: string,
  connectTimeoutMs = DEPENDENCY_CHECK_TIMEOUT_MS,
): Promise<void> {
  // timeout của socket: broker không trả lời thì không treo kết nối mãi
  const connection = await amqp.connect(url, { timeout: connectTimeoutMs });
  try {
    const channel = await connection.createChannel();
    // checkQueue lỗi (queue chưa có) đóng channel kèm sự kiện error: đã reject ở dưới
    channel.on('error', () => {});
    const { consumerCount } = await channel.checkQueue(queue);
    if (consumerCount < 1) {
      throw new Error(`queue ${queue} không có consumer`);
    }
  } finally {
    await connection.close().catch(() => {});
  }
}
