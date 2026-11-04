// Smoke test bản build: chạy `node dist/apps/<app>/main.js` cho từng app và chờ app nghe
// được cổng. Bắt các lỗi chỉ xảy ra khi chạy bản build thật (vd: thiếu
// `import 'reflect-metadata'` ở main.ts) mà jest không thấy vì đã nạp sẵn qua setupFiles.
// Chạy sau `nest build` cho cả 4 app: `npm run smoke:start`.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const APPS = [
  { name: 'user-service', port: process.env.USER_SERVICE_PORT ?? 4002 },
  { name: 'auth-service', port: process.env.AUTH_SERVICE_PORT ?? 4001 },
  { name: 'task-service', port: process.env.TASK_SERVICE_PORT ?? 4003 },
  { name: 'gateway', port: process.env.GATEWAY_PORT ?? 3000 },
];
const TIMEOUT_MS = 30_000;

const isListening = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

/** Khởi động một app, resolve khi app nghe được cổng; reject nếu app thoát hoặc quá hạn. */
function start({ name, port }) {
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
        new Error(`${name} thoát (mã ${code}) trước khi nghe cổng ${port}`),
      ),
    );
    const poll = async () => {
      if (child.exitCode !== null) return;
      if (await isListening(port)) return resolve();
      if (Date.now() > deadline)
        return reject(
          new Error(`${name} không nghe cổng ${port} sau ${TIMEOUT_MS}ms`),
        );
      setTimeout(poll, 300);
    };
    poll();
  });
  return { name, port, child, ready, output: () => output };
}

const running = [];
let failed = false;
for (const app of APPS) {
  // Cổng đã có tiến trình khác nghe thì kết quả "nghe được cổng" không chứng minh gì
  if (await isListening(app.port)) {
    failed = true;
    console.error(
      `FAIL cổng ${app.port} của ${app.name} đã bị tiến trình khác dùng`,
    );
    break;
  }
  const proc = start(app);
  running.push(proc);
  try {
    await proc.ready;
    console.log(`OK   ${app.name} nghe cổng ${app.port}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${error.message}\n${proc.output()}`);
    break;
  }
}
for (const { child } of running) child.kill();
process.exit(failed ? 1 : 0);
