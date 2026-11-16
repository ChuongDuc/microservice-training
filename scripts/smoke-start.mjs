// Smoke test bản build: chạy `node dist/apps/<app>/main.js` cho từng app và chờ app nghe
// được cổng (Notification Service: chờ cả queue RabbitMQ của nó có consumer lẫn cổng TCP
// cho Gateway — hai transport khởi động song song, có cái này chưa chắc có cái kia). Bắt các lỗi chỉ xảy ra khi chạy bản build thật (vd: thiếu
// `import 'reflect-metadata'` ở main.ts) mà jest không thấy vì đã nạp sẵn qua setupFiles.
// Chạy sau `nest build` cho cả 5 app: `npm run smoke:start` (cần RabbitMQ đang chạy).
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import amqp from 'amqplib';

const APPS = [
  { name: 'user-service', port: process.env.USER_SERVICE_PORT ?? 4002 },
  { name: 'auth-service', port: process.env.AUTH_SERVICE_PORT ?? 4001 },
  { name: 'task-service', port: process.env.TASK_SERVICE_PORT ?? 4003 },
  { name: 'gateway', port: process.env.GATEWAY_PORT ?? 3000 },
  {
    name: 'notification-service',
    port: process.env.NOTIFICATION_SERVICE_PORT ?? 4004,
    queue: process.env.RABBITMQ_QUEUE || 'notifications_queue',
  },
];
const TIMEOUT_MS = 30_000;

// Cùng quy ước với rabbitmqUrl() trong libs/common/src/config/rabbitmq.ts
const RABBITMQ_URL = `amqp://${encodeURIComponent(
  process.env.RABBITMQ_USER || 'guest',
)}:${encodeURIComponent(process.env.RABBITMQ_PASSWORD || 'guest')}@${
  process.env.RABBITMQ_HOST || 'localhost'
}:${process.env.RABBITMQ_PORT || '5672'}`;

/** Số consumer đang gắn vào queue; 0 nếu queue chưa tồn tại hoặc không kết nối được. */
async function consumerCount(queue) {
  let connection;
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    // checkQueue lỗi (queue chưa có) sẽ đóng channel; dùng channel riêng mỗi lần
    const channel = await connection.createChannel();
    channel.on('error', () => {});
    return (await channel.checkQueue(queue)).consumerCount;
  } catch {
    return 0;
  } finally {
    await connection?.close().catch(() => {});
  }
}

const hasConsumer = (queue) => consumerCount(queue).then((n) => n > 0);

/** App đã sẵn sàng: nghe được cổng VÀ (app có queue) queue đã có consumer. */
const isReady = async (app) =>
  (await isListening(app.port)) &&
  (!app.queue || (await hasConsumer(app.queue)));

/**
 * Đã có tiến trình khác chiếm chỗ: cổng đang nghe HOẶC queue đã có consumer — một trong
 * hai thì kết quả "sẵn sàng" không chứng minh được app vừa chạy.
 */
const isTaken = async (app) =>
  (await isListening(app.port)) ||
  (!!app.queue && (await hasConsumer(app.queue)));

const isListening = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

/**
 * Khởi động một app, resolve khi app sẵn sàng (nghe được cổng / queue có consumer);
 * reject nếu app thoát hoặc quá hạn.
 */
function start(app) {
  const { name } = app;
  const target = describe(app);
  const child = spawn(process.execPath, [`dist/apps/${name}/main.js`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));

  const ready = new Promise((resolve, reject) => {
    const deadline = Date.now() + TIMEOUT_MS;
    child.once('exit', (code) =>
      reject(
        new Error(`${name} thoát (mã ${code}) trước khi sẵn sàng (${target})`),
      ),
    );
    const poll = async () => {
      if (child.exitCode !== null) return;
      if (await isReady(app)) return resolve();
      if (Date.now() > deadline)
        return reject(
          new Error(`${name} chưa sẵn sàng (${target}) sau ${TIMEOUT_MS}ms`),
        );
      setTimeout(poll, 300);
    };
    poll();
  });
  return { name, child, ready, output: () => output };
}

function describe(app) {
  return app.queue
    ? `cổng ${app.port} + consumer trên queue ${app.queue}`
    : `cổng ${app.port}`;
}

const running = [];
let failed = false;
for (const app of APPS) {
  // Cổng đã có tiến trình khác nghe thì kết quả "nghe được cổng" không chứng minh gì
  if (await isTaken(app)) {
    failed = true;
    console.error(
      `FAIL ${describe(app)} của ${app.name} đã bị tiến trình khác dùng`,
    );
    break;
  }
  const proc = start(app);
  running.push(proc);
  try {
    await proc.ready;
    console.log(`OK   ${app.name} sẵn sàng (${describe(app)})`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${error.message}\n${proc.output()}`);
    break;
  }
}
for (const { child } of running) child.kill();
process.exit(failed ? 1 : 0);
