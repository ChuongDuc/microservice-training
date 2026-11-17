// Smoke test cả hệ thống chạy trong Docker (`docker compose --profile app up -d --build`):
// gọi API thật qua Gateway để chắc các container nói chuyện được với nhau:
//   1. Gateway lên (chờ tới khi trả lời HTTP), GET /health: mọi service + phụ thuộc up
//   2. POST /auth/register  -> Gateway -> Auth -> User Service, auth_db + user_db
//   3. POST /auth/login     -> JWT, Redis (refresh token)
//   4. GET  /users/me       -> Gateway -> User Service
//   5. GET  /notifications  -> user.registered qua RabbitMQ -> Notification Service lưu
//                              -> Gateway đọc qua TCP
// Chạy: `npm run smoke:docker` — nạp `.env` (nếu có) giống docker compose, nên Gateway ở
// http://localhost:<GATEWAY_PORT, mặc định 3000>; ghi đè cả URL bằng GATEWAY_URL.
import { randomUUID } from 'node:crypto';

const BASE_URL =
  process.env.GATEWAY_URL ??
  `http://localhost:${process.env.GATEWAY_PORT || 3000}`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** Gọi tới khi `check` trả về giá trị khác undefined, hoặc hết thời gian. */
async function waitFor(label, check, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${label}: quá ${timeoutMs}ms${last ? ` (${last.message})` : ''}`,
      );
    }
    await sleep(1000);
  }
}

function expectStatus(step, res, status) {
  if (res.status !== status) {
    throw new Error(
      `${step}: mong đợi ${status}, nhận ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  console.log(`OK   ${step} (${status})`);
}

async function main() {
  // Gateway lên: route cần token trả 401 thay vì lỗi kết nối
  await waitFor('Gateway chưa trả lời', async () =>
    (await call('GET', '/auth/me')).status === 401 ? true : undefined,
  );
  console.log(`OK   Gateway trả lời tại ${BASE_URL}`);

  // Mọi service + phụ thuộc (DB, Redis, RabbitMQ) đều up: GET /health trả 200
  const health = await waitFor('GET /health chưa up hết', async () => {
    const res = await call('GET', '/health');
    return res.status === 200 ? res : undefined;
  });
  expectStatus('GET /health', health, 200);
  console.log(
    `OK   Health: ${Object.entries(health.body.services)
      .map(([name, { status }]) => `${name}=${status}`)
      .join(', ')}`,
  );

  const password = 'matkhau123';
  let email;

  // Auth/User Service có thể chưa sẵn sàng ngay khi Gateway lên (503): thử lại. Mỗi lần
  // thử dùng email MỚI: 503 cũng có thể là Gateway hết thời gian chờ trong khi Auth vẫn
  // tạo user xong — gửi lại cùng email sẽ nhận 409 dù hệ thống chạy đúng.
  const register = await waitFor('POST /auth/register', async () => {
    email = `smoke-${randomUUID()}@test.com`;
    const res = await call('POST', '/auth/register', {
      body: { email, password, displayName: 'Smoke' },
    });
    return res.status === 503 ? undefined : res;
  });
  expectStatus('POST /auth/register', register, 201);

  const login = await call('POST', '/auth/login', {
    body: { email, password },
  });
  expectStatus('POST /auth/login', login, 200);
  const token = login.body.accessToken;

  const me = await call('GET', '/users/me', { token });
  expectStatus('GET /users/me', me, 200);
  if (me.body.email !== email)
    throw new Error(`GET /users/me: sai email ${me.body.email}`);

  // Event đi qua RabbitMQ bất đồng bộ: chờ thông báo chào mừng xuất hiện
  const notifications = await waitFor(
    'GET /notifications chưa có thông báo chào mừng',
    async () => {
      const res = await call('GET', '/notifications', { token });
      return res.status === 200 && res.body.total >= 1 ? res : undefined;
    },
    30_000,
  );
  expectStatus('GET /notifications', notifications, 200);
  console.log(`OK   Thông báo: "${notifications.body.items[0].message}"`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
