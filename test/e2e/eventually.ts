/**
 * Chờ tới khi `check` (đồng bộ hoặc async) không ném lỗi nữa, trả về kết quả của lần
 * chạy thành công. Dùng cho việc xảy ra bất đồng bộ (event đi qua RabbitMQ): hết
 * `timeoutMs` mà vẫn lỗi thì ném lỗi của lần chạy cuối.
 */
export async function eventually<T>(
  check: () => T | Promise<T>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
