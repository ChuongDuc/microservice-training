// Demo tự động: chạy kịch bản trong docs/demo.md qua REST API của Gateway, in từng bước
// (request -> mã HTTP + phần đáng chú ý của response). Dùng khi trình bày, hoặc làm
// phương án dự phòng khi demo tay trên Swagger UI gặp sự cố.
//
//   npm run demo          (hệ thống đang chạy: Docker hoặc npm run start:dev)
//
// Bước "nâng Alice lên ADMIN" sửa trực tiếp user_db bằng `docker compose exec postgres
// psql` (chưa có API tạo admin đầu tiên), nên cần Postgres chạy bằng docker compose.
// Mỗi lần chạy tạo user mới `demo-<mã>-alice/bob@demo.local` (không xoá sau demo).
// Giới hạn đăng nhập/đăng ký đếm theo IP trong 60 giây: chạy lại ngay có thể nhận 429,
// chờ một phút rồi chạy lại.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { BASE_URL, call, sleep, waitFor } from './lib/gateway-client.mjs';

const RUN = randomBytes(3).toString('hex');
const PASSWORD = 'matkhau-demo-123';
/** Giữ nhịp cho người xem theo kịp (DEMO_PAUSE_MS=0 để chạy liền). */
const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS ?? 600);

const color = (code) => (text) =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = color('1');
const dim = color('2');
const green = color('32');
const red = color('31');

let stepNo = 0;
async function step(title) {
  stepNo += 1;
  console.log(`\n${bold(`${stepNo}. ${title}`)}`);
  await sleep(PAUSE_MS);
}

/** In một request và kết quả; ném lỗi nếu mã HTTP khác mong đợi. */
function show(method, path, res, expected, summary) {
  const ok = res.status === expected;
  const mark = ok ? green(`${res.status}`) : red(`${res.status}`);
  console.log(
    `   ${method} ${path} -> ${mark}${summary ? `  ${summary}` : ''}`,
  );
  if (!ok) {
    throw new Error(
      `${method} ${path}: mong đợi ${expected}, nhận ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res;
}

async function request(method, path, expected, options, summarize) {
  const res = await call(method, path, options);
  return show(
    method,
    path,
    res,
    expected,
    res.status === expected && summarize
      ? summarize(res.body, res)
      : dim(json(res.body)),
  );
}

const json = (value) => {
  const text = JSON.stringify(value) ?? '';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const emailOf = (name) => `demo-${RUN}-${name}@demo.local`;

const login = (name) =>
  request(
    'POST',
    '/auth/login',
    200,
    { body: { email: emailOf(name), password: PASSWORD } },
    () => 'accessToken (15 phút) + refreshToken (7 ngày)',
  ).then((res) => res.body);

/**
 * Đổi role trong user_db (chưa có API tạo ADMIN đầu tiên). Không có dòng nào được
 * cập nhật (app dùng Postgres khác với Postgres của docker compose...) thì dừng ngay,
 * thay vì đi tiếp và nhận 403 khó hiểu ở bước sau.
 */
function promoteToAdmin(email) {
  const user = process.env.POSTGRES_USER || 'postgres';
  const output = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      user,
      '-d',
      'user_db',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE "User" SET role = 'ADMIN' WHERE email = '${email}'`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  );
  if (output.trim() !== 'UPDATE 1') {
    throw new Error(
      `Không nâng được ${email} lên ADMIN (psql: ${output.trim()}): user_db của docker compose không có user này — app có đang dùng Postgres khác không?`,
    );
  }
}

async function main() {
  console.log(bold(`Demo Task Management — Gateway ${BASE_URL}`));

  await step(
    'Hệ thống sống không? GET /health gọi cả 4 service, mỗi service tự kiểm tra DB/Redis/RabbitMQ',
  );
  await request('GET', '/health', 200, {}, (body) =>
    Object.entries(body.services)
      .map(([name, { status }]) => `${name}=${status}`)
      .join(' '),
  );

  await step(
    'Đăng ký Alice và Bob: Gateway -> Auth Service -> User Service (TCP), mỗi service một DB',
  );
  for (const name of ['alice', 'bob']) {
    await request(
      'POST',
      '/auth/register',
      201,
      {
        body: {
          email: emailOf(name),
          password: PASSWORD,
          displayName: name === 'alice' ? 'Alice' : 'Bob',
        },
      },
      (body) => `${body.email} role=${body.role}`,
    );
  }

  await step('Validation ở Gateway: dữ liệu sai -> 400 kèm lỗi từng field');
  await request(
    'POST',
    '/auth/register',
    400,
    { body: { email: 'khong-phai-email', password: '123' } },
    (body) => body.errors.map((e) => e.field).join(', '),
  );

  await step('Đăng nhập: JWT access token + refresh token (lưu hash ở Redis)');
  let alice = await login('alice');
  const bob = await login('bob');
  await request('GET', '/users/me', 401, {}, () => 'không có token -> 401');
  const bobProfile = await request(
    'GET',
    '/users/me',
    200,
    { token: bob.accessToken },
    (body) => `${body.displayName} <${body.email}>`,
  );

  await step(
    'Event bất đồng bộ: user.registered -> RabbitMQ -> Notification Service lưu thông báo',
  );
  const welcome = await waitFor(
    'Chưa có thông báo chào mừng',
    async () => {
      const res = await call('GET', '/notifications', {
        token: alice.accessToken,
      });
      return res.status === 200 && res.body.total >= 1 ? res : undefined;
    },
    30_000,
  );
  show(
    'GET',
    '/notifications',
    welcome,
    200,
    `"${welcome.body.items[0].message}"`,
  );

  await step('Alice quản lý task của mình');
  const task = await request(
    'POST',
    '/tasks',
    201,
    {
      token: alice.accessToken,
      body: {
        title: 'Chuẩn bị slide demo',
        priority: 'HIGH',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      },
    },
    (body) => `"${body.title}" status=${body.status} priority=${body.priority}`,
  ).then((res) => res.body);
  await request(
    'PATCH',
    `/tasks/${task.id}`,
    200,
    { token: alice.accessToken, body: { status: 'IN_PROGRESS' } },
    (body) => `status=${body.status}`,
  );
  await request(
    'GET',
    '/tasks?status=IN_PROGRESS',
    200,
    { token: alice.accessToken },
    (body) => `total=${body.total}`,
  );

  await step(
    'Resource ownership: Bob không xem/sửa được task của Alice (404, không lộ task tồn tại)',
  );
  await request(
    'GET',
    `/tasks/${task.id}`,
    404,
    { token: bob.accessToken },
    () => 'Bob -> 404',
  );
  await request(
    'DELETE',
    `/tasks/${task.id}`,
    404,
    { token: bob.accessToken },
    () => 'Bob xoá -> 404',
  );

  await step('Event task.created -> thông báo cho Alice');
  const created = await waitFor(
    'Chưa có thông báo task.created',
    async () => {
      const res = await call('GET', '/notifications', {
        token: alice.accessToken,
      });
      return res.status === 200 && res.body.total >= 2 ? res : undefined;
    },
    30_000,
  );
  show(
    'GET',
    '/notifications',
    created,
    200,
    `"${created.body.items[0].message}"`,
  );

  await step('RBAC: /admin/users chỉ dành cho ADMIN');
  await request(
    'GET',
    '/admin/users',
    403,
    { token: bob.accessToken },
    () => 'Bob (USER) -> 403',
  );
  promoteToAdmin(emailOf('alice'));
  console.log(
    dim('   (đổi role của Alice thành ADMIN trực tiếp trong user_db)'),
  );
  await request(
    'GET',
    '/admin/users',
    403,
    { token: alice.accessToken },
    () => 'token cũ vẫn ghi role USER -> 403',
  );
  alice = await login('alice');
  await request(
    'GET',
    `/admin/users?search=demo-${RUN}`,
    200,
    { token: alice.accessToken },
    (body) => body.items.map((u) => `${u.email}(${u.role})`).join(' '),
  );

  await step('Admin khoá Bob: Bob không đăng nhập được nữa');
  await request(
    'PATCH',
    `/admin/users/${bobProfile.body.id}/status`,
    200,
    { token: alice.accessToken, body: { status: 'BLOCKED' } },
    (body) => `${body.email} status=${body.status}`,
  );
  await request(
    'POST',
    '/auth/login',
    403,
    { body: { email: emailOf('bob'), password: PASSWORD } },
    (body) => body.message,
  );

  await step('Refresh token rotation: mỗi refresh token chỉ dùng một lần');
  const rotated = await request(
    'POST',
    '/auth/refresh',
    200,
    { body: { refreshToken: alice.refreshToken } },
    () => 'cặp token mới',
  ).then((res) => res.body);
  await request(
    'POST',
    '/auth/refresh',
    401,
    { body: { refreshToken: alice.refreshToken } },
    () => 'dùng lại token cũ -> 401',
  );
  await request(
    'POST',
    '/auth/logout',
    200,
    { body: { refreshToken: rotated.refreshToken } },
    () => 'thu hồi refresh token',
  );
  await request(
    'POST',
    '/auth/refresh',
    401,
    { body: { refreshToken: rotated.refreshToken } },
    () => 'sau logout -> 401',
  );

  await step(
    'Chống dò mật khẩu: quá 5 lần đăng nhập vào một email từ một IP trong 60 giây -> 429',
  );
  // Email chưa đăng nhập lần nào trong demo: bộ đếm tính MỌI lần đăng nhập vào email
  // (kể cả thành công), dùng Alice thì bị 429 sớm hơn. Email không tồn tại vẫn trả 401
  // như sai mật khẩu: không dò được email nào đã đăng ký.
  const wrong = {
    body: { email: emailOf('mallory'), password: 'sai-mat-khau' },
  };
  for (let i = 1; i <= 5; i++) {
    const res = await call('POST', '/auth/login', wrong);
    show('POST', '/auth/login', res, 401, dim(`lần ${i}: sai thông tin`));
  }
  await request(
    'POST',
    '/auth/login',
    429,
    wrong,
    (_body, res) => `lần 6: Retry-After ${res.headers.get('retry-after')}s`,
  );

  console.log(`\n${green(bold('Demo hoàn tất.'))}`);
}

main().catch((error) => {
  console.error(`\n${red('FAIL')} ${error.message}`);
  process.exit(1);
});
