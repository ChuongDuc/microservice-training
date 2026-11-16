// Docker healthcheck cho service TCP phía trong (không có HTTP): gửi message
// `health.check` (HEALTH_PATTERNS.CHECK) tới service trong cùng container, thoát 0 khi
// service trả `status: up` (mọi phụ thuộc đều sống), 1 nếu không.
//   node scripts/tcp-healthcheck.js <cổng> [host, mặc định 127.0.0.1]
// CommonJS + chỉ dùng dependencies chạy thật: image runtime không có ts-node/devDependencies.
require('reflect-metadata');
const { ClientProxyFactory, Transport } = require('@nestjs/microservices');
const { firstValueFrom, timeout } = require('rxjs');

const port = Number(process.argv[2]);
const host = process.argv[3] || '127.0.0.1';
// Lớn hơn thời gian service tự kiểm tra phụ thuộc (3s), nhỏ hơn timeout healthcheck
const TIMEOUT_MS = 5000;

async function main() {
  if (!Number.isInteger(port))
    throw new Error('Thiếu cổng: tcp-healthcheck.js <cổng>');
  const client = ClientProxyFactory.create({
    transport: Transport.TCP,
    options: { host, port },
  });
  try {
    const health = await firstValueFrom(
      client.send('health.check', {}).pipe(timeout(TIMEOUT_MS)),
    );
    console.log(JSON.stringify(health));
    return health && health.status === 'up';
  } finally {
    client.close();
  }
}

main().then(
  (up) => process.exit(up ? 0 : 1),
  (error) => {
    console.error(
      error instanceof Error ? error.message : JSON.stringify(error),
    );
    process.exit(1);
  },
);
