import { NotificationsTestQueue } from '../../../test/e2e/notifications-test-queue';

/**
 * Chạy trước mỗi file e2e của Gateway (setupFilesAfterEnv): Auth/Task Service trong
 * test phát event (user.registered, task.created) vào queue riêng của file đó thay vì
 * `notifications_queue` thật, xoá queue khi file chạy xong.
 */
const events = new NotificationsTestQueue();
afterAll(() => events.delete());
