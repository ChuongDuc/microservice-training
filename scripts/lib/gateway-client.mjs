// Gọi REST API của Gateway từ script Node (smoke:docker, demo). Không dùng thư viện
// ngoài: chỉ fetch có sẵn của Node. Cần Node 22.9+ vì các script chạy bằng
// `node --env-file-if-exists`.
//
// Gateway ở GATEWAY_URL, hoặc http://localhost:<GATEWAY_PORT, mặc định 3000>. Script chạy
// qua `node --env-file-if-exists=.env` nên đọc được GATEWAY_PORT trong `.env`.

export const BASE_URL =
  process.env.GATEWAY_URL ??
  `http://localhost:${process.env.GATEWAY_PORT || 3000}`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gọi một route, trả `{ status, headers, body }` (body đã parse JSON nếu được). */
export async function call(method, path, { body, token } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body && JSON.stringify(body),
    });
  } catch (error) {
    // fetch chỉ báo "fetch failed", lý do thật (ECONNREFUSED...) nằm trong cause
    const reason = error.cause?.code ?? error.cause?.message ?? error.message;
    throw new Error(
      `Không kết nối được Gateway tại ${BASE_URL} (${reason}). Hệ thống đã chạy chưa? ` +
        '`docker compose --profile app up -d --build` hoặc `npm run start:dev gateway`',
    );
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, body: json };
}

/** Gọi tới khi `check` trả về giá trị khác undefined, hoặc hết thời gian. */
export async function waitFor(label, check, timeoutMs) {
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
