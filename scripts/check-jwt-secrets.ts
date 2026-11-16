// Kiểm tra JWT secret trước khi chạy cả hệ thống trong Docker (service `migrate` của
// docker-compose chạy script này đầu tiên). Cùng quy tắc với lúc Gateway/Auth khởi động
// (assertJwtSecrets), nhưng báo lỗi một lần rồi dừng `docker compose up`, thay vì để
// Gateway/Auth lỗi khi khởi động và bị `restart: unless-stopped` bật lại mãi.
// Chạy: npx ts-node -T scripts/check-jwt-secrets.ts
import { assertJwtSecrets } from '../libs/common/src/config/jwt-secrets';

try {
  assertJwtSecrets(process.env, ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']);
  console.log('OK   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET hợp lệ');
} catch (error) {
  console.error(
    `${(error as Error).message}\nĐặt hai biến này trong file .env (cạnh docker-compose.yml) rồi chạy lại.`,
  );
  process.exit(1);
}
