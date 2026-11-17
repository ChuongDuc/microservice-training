// Tạo `.env` cho người mới: copy `.env.example` và thay hai JWT secret mẫu bằng chuỗi
// ngẫu nhiên (Gateway/Auth không khởi động với secret mẫu). Không ghi đè `.env` đã có,
// không in secret ra màn hình.
//   npm run env:init
import { randomBytes } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

const EXAMPLE = '.env.example';
const TARGET = '.env';
const SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

if (existsSync(TARGET)) {
  console.log(
    `${TARGET} đã có, giữ nguyên. Muốn tạo lại thì xoá/đổi tên ${TARGET} rồi chạy lại.`,
  );
  process.exit(0);
}

// COPYFILE_EXCL: .env xuất hiện sau bước kiểm tra trên thì báo lỗi, không ghi đè
copyFileSync(EXAMPLE, TARGET, constants.COPYFILE_EXCL);
let content = readFileSync(TARGET, 'utf8');
for (const key of SECRETS) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (!line.test(content)) {
    console.error(`${EXAMPLE} thiếu dòng ${key}=`);
    process.exit(1);
  }
  // 32 byte ngẫu nhiên = 64 ký tự hex: đủ dài, mỗi secret một giá trị khác nhau
  content = content.replace(line, `${key}=${randomBytes(32).toString('hex')}`);
}
writeFileSync(TARGET, content);
console.log(
  `Đã tạo ${TARGET} từ ${EXAMPLE} với ${SECRETS.join(', ')} ngẫu nhiên. Các giá trị khác giữ mặc định (khớp docker-compose.yml).`,
);
