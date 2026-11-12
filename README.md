# Task Management — Microservices với NestJS

Dự án học tập: hệ thống quản lý công việc viết theo kiến trúc microservices, dùng **NestJS monorepo**.

- **5 app** trong `apps/`: `gateway` (HTTP public), `auth-service`, `user-service`, `task-service`, `notification-service` (nhận event qua RabbitMQ)
- **Thư viện dùng chung** `@app/common` trong `libs/common` (constants, message patterns, pipe...)
- **Giao tiếp**: TCP (đồng bộ, giữa Gateway và các service) + RabbitMQ (bất đồng bộ, event)
- **Hạ tầng** (Docker): PostgreSQL (mỗi service một DB: `auth_db`, `user_db`, `task_db`), Redis, RabbitMQ
- **ORM**: Prisma, mỗi service có schema và client riêng (`apps/<service>/prisma`)

> Lộ trình và trạng thái từng phần: xem [TODO.md](TODO.md).

## Yêu cầu

- Node.js LTS (kèm npm)
- Docker + Docker Compose

## Cài đặt và chạy

### 1. Cài dependencies

```bash
npm install
```

### 2. Tạo file môi trường

```bash
cp .env.example .env
```

Giá trị mặc định trong `.env.example` đã khớp với `docker-compose.yml`. **Bắt buộc đổi `JWT_ACCESS_SECRET` và `JWT_REFRESH_SECRET`**: Gateway/Auth không khởi động nếu secret còn là giá trị mẫu, ngắn hơn 32 ký tự hoặc hai secret trùng nhau. Tạo mỗi secret bằng:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Bật hạ tầng (Postgres, Redis, RabbitMQ)

```bash
docker compose up -d
docker compose ps        # đợi cả 3 container ở trạng thái healthy
```

Lần chạy đầu, script `docker/postgres/init-multiple-dbs.sh` tự tạo 3 database `auth_db`, `user_db`, `task_db`.
Giao diện quản trị RabbitMQ: http://localhost:15672 (guest/guest).

Tắt hạ tầng: `docker compose down` (thêm `-v` nếu muốn xoá luôn dữ liệu).

### 4. Prisma: generate client + migrate DB

Mỗi service có Prisma schema riêng, nên chạy cho từng service:

```bash
# User Service (user_db)
npm run prisma:user:generate
npm run prisma:user:migrate

# Auth Service (auth_db)
npm run prisma:auth:generate
npm run prisma:auth:migrate

# Task Service (task_db)
npm run prisma:task:generate
npm run prisma:task:migrate
```

Client được sinh vào `apps/<service>/generated/prisma`. `migrate` chạy `prisma migrate dev`: áp dụng migration có sẵn và tự gọi lại `generate`.

Lệnh Prisma khác (studio, reset...) thì gọi trực tiếp và đặt `--schema` **sau** tên lệnh:

```bash
npx prisma studio --schema=apps/user-service/prisma/schema.prisma
npx prisma migrate reset --schema=apps/user-service/prisma/schema.prisma
```

### 5. Chạy service (chế độ watch)

Mỗi service là một process riêng, mở mỗi service một terminal:

```bash
npm run start:dev user-service    # TCP, cổng USER_SERVICE_PORT (mặc định 4002)
npm run start:dev auth-service    # TCP, cổng AUTH_SERVICE_PORT (mặc định 4001)
npm run start:dev task-service    # TCP, cổng TASK_SERVICE_PORT (mặc định 4003)
npm run start:dev gateway         # HTTP, cổng GATEWAY_PORT (mặc định 3000), cần auth-service + user-service (+ task-service cho /tasks)
npm run start:dev notification-service  # RabbitMQ, queue RABBITMQ_QUEUE (mặc định notifications_queue)
```

> `gateway` là cửa vào HTTP duy nhất (cổng `GATEWAY_PORT`), có các route `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` và forward xuống Auth Service qua TCP. Mọi route khác cần header `Authorization: Bearer <accessToken>` (Gateway tự verify bằng `JWT_ACCESS_SECRET`, thiếu/sai token -> 401); `GET /auth/me` trả `userId` + `role` của token; `GET /users/me` trả hồ sơ từ User Service (Gateway truyền danh tính `{ user: { userId, role } }` xuống trong payload). `auth-service`/`user-service`/`task-service` mặc định chỉ nghe `127.0.0.1` (`*_SERVICE_BIND_HOST`) vì tin danh tính trong payload — chỉ Gateway được gọi tới. `task-service` nhận `task.create/find_all/find_one/update/delete` qua TCP.

`notification-service` không mở cổng: nó nhận event bất đồng bộ (`@EventPattern`) từ queue `RABBITMQ_QUEUE` (kết nối theo `RABBITMQ_USER/PASSWORD/HOST/PORT`). Event hiện có: `user.registered`, `task.created` (tên + payload ở `NOTIFICATION_EVENTS` và `libs/common/src/dto/events`). Queue `durable` + message `persistent`, ack thủ công: message chỉ bị xoá khỏi queue khi xử lý xong, service tắt thì event nằm chờ trong queue. Payload sai, handler lỗi hoặc event không có handler -> message chuyển vào dead-letter queue `<queue>.dlq` (không giao lại ngay, tránh lặp vô hạn) và ghi log một lần; xem/đưa lại message trong DLQ qua giao diện quản trị RabbitMQ (shovel hoặc Move messages). Giao "ít nhất một lần": mỗi event có `eventId` (UUID) để phía nhận chống xử lý trùng.

Phía phát: Auth Service phát `user.registered` khi đăng ký xong (đã lưu credential), Task Service phát `task.created` sau khi tạo task — qua `NotificationPublisher` (import `NotificationsPublisherModule` từ `@app/common`, tự gắn `eventId`). Phát kiểu "bắn rồi quên": request không chờ RabbitMQ, RabbitMQ tắt thì đăng ký/tạo task vẫn thành công, event đó chỉ được ghi log lỗi (chưa có outbox để phát lại).

> Đã từng chạy `notification-service` trước khi có DLQ: queue `notifications_queue` cũ khai báo khác (thiếu dead-letter) nên RabbitMQ từ chối (`PRECONDITION_FAILED`). Xoá queue cũ một lần: `docker compose exec rabbitmq rabbitmqctl delete_queue notifications_queue`.

Chống dò mật khẩu (`@nestjs/throttler`), vượt ngưỡng -> 429 kèm header `Retry-After` (giây):

- `POST /auth/login`: tối đa 5 lần vào một email từ một IP (`LOGIN_THROTTLE_LIMIT`) và 20 lần mỗi IP cho mọi email (`LOGIN_THROTTLE_IP_LIMIT`), mỗi 60 giây (`LOGIN_THROTTLE_TTL_MS`). Người khác dùng chung IP (văn phòng, NAT) không bị chặn theo khi một tài khoản bị khoá tạm.
- `POST /auth/register`: tối đa 20 lần mỗi IP (chặn dò email đã đăng ký, tạo tài khoản rác).
- Bộ đếm nằm trong bộ nhớ Gateway (nhiều instance thì mỗi instance đếm riêng). Gateway đứng sau reverse proxy phải đặt `TRUST_PROXY` (số proxy phía trước hoặc IP/subnet proxy), nếu không mọi client có chung IP của proxy và chung bộ đếm.

Phân quyền theo role: gắn `@Roles('ADMIN')` ở controller hoặc route (gắn ở cả hai thì route thắng), `RolesGuard` toàn cục chạy sau `JwtAuthGuard` và trả 403 khi role trong access token không nằm trong danh sách. Route có `@Roles()` luôn cần token, kể cả khi gắn thêm `@Public()`. Role đọc từ token (không hỏi User Service), nên đổi role chỉ có hiệu lực khi người đó lấy access token mới — tối đa `JWT_ACCESS_EXPIRES_IN` (15 phút).

Route `/tasks` ở Gateway (cần access token, chỉ thao tác trên task của người gọi — task của người khác trả 404):

| Method   | Route                         | Mô tả                                                                                                |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST`   | `/tasks`                      | Tạo task (`title` bắt buộc; `description`, `status`, `priority`, `dueDate` ISO 8601 tuỳ chọn) -> 201 |
| `GET`    | `/tasks?page=&limit=&status=` | Danh sách task của người gọi, mới nhất trước (`limit` tối đa 100)                                    |
| `GET`    | `/tasks/:id`                  | Một task                                                                                             |
| `PATCH`  | `/tasks/:id`                  | Sửa một phần (`description`/`dueDate: null` để xoá giá trị)                                          |
| `DELETE` | `/tasks/:id`                  | Xoá, trả về task vừa xoá                                                                             |

Route `/admin/users` (chỉ ADMIN — `@Roles('ADMIN')`, user thường -> 403; User Service cũng kiểm tra lại role):

| Method  | Route                                             | Mô tả                                                                                  |
| ------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`   | `/admin/users?page=&limit=&search=&role=&status=` | Danh sách user, `search` tìm theo email hoặc tên hiển thị (không phân biệt hoa thường) |
| `PATCH` | `/admin/users/:id/role`                           | Đổi role: `{ "role": ... }`, giá trị `USER` hoặc `ADMIN`                               |
| `PATCH` | `/admin/users/:id/status`                         | Khoá / mở khoá: `{ "status": ... }`, giá trị `ACTIVE` hoặc `BLOCKED`                   |

Admin không tự đổi role hay tự khoá chính mình được (400). User bị khoá không đăng nhập hay refresh được nữa (403); role mới và trạng thái khoá áp dụng cho access token cấp sau đó, token đang dùng giữ nguyên tới khi hết hạn. ADMIN đầu tiên cần đặt trực tiếp trong DB: `UPDATE "User" SET role = 'ADMIN' WHERE email = '...';` (user_db).

**Dạng lỗi thống nhất.** Mọi lỗi (từ Gateway hay từ service phía trong) trả về cùng một dạng:

```json
{ "statusCode": 400, "message": "Validation failed", "errors": [{ "field": "title", "constraints": { "isNotEmpty": "title should not be empty" } }] }
```

`errors` chỉ có với lỗi validate. Body/query được validate ngay ở Gateway (`ValidationPipe` toàn cục: bỏ qua field không khai báo trong DTO, gửi field lạ -> 400), service phía trong validate lại payload. Lỗi không lường trước trả `500 Internal server error` và chỉ ghi chi tiết vào log.

Build một app: `npx nest build <app>` (output nằm trong `dist/apps/<app>`). Sau khi build cả 5 app, `npm run smoke:start` chạy thử từng bản build (`node dist/apps/<app>/main.js`) tới khi nghe được cổng — riêng `notification-service` chờ log đã kết nối RabbitMQ, nên cần RabbitMQ đang chạy (CI cũng chạy bước này).

## Test

```bash
# Unit test (mọi file *.spec.ts trong apps/ và libs/)
npm test

# E2E User Service: bật User Service thật qua TCP (cổng 4102) và gọi bằng ClientProxy.
# Cần Postgres đang chạy và đã chạy npm run prisma:user:migrate.
npm run test:e2e:user

# E2E Auth Service (cổng 4101/4102) và Task Service (cổng 4103): service thật qua TCP.
# Cần Postgres đã migrate (auth_db, user_db, task_db) và Redis cho Auth.
npm run test:e2e:auth
npm run test:e2e:task

# E2E Gateway: bật User + Auth Service thật (TCP, cổng 4202/4201) và Gateway, gọi REST /auth/*;
# bật Task Service thật (TCP, cổng 4213) và gọi REST /tasks.
# Cần Postgres (đã migrate user_db + auth_db + task_db) và Redis đang chạy.
npm run test:e2e:gateway

# Các e2e Auth/Task/Gateway phát event vào queue RabbitMQ riêng của từng file test (xoá khi
# xong), nên cũng cần RabbitMQ đang chạy.

# E2E Notification Service: bật service thật, phát event qua RabbitMQ (queue riêng cho
# mỗi lần chạy, xoá khi xong). Cần RabbitMQ đang chạy.
npm run test:e2e:notification
```

## Cấu trúc thư mục

```
apps/
  gateway/         # API Gateway (HTTP)
  auth-service/    # Đăng ký, đăng nhập, JWT, refresh token
  user-service/    # Quản lý user (Prisma + TCP)
  task-service/    # Quản lý task
  notification-service/ # Nhận event qua RabbitMQ (user.registered, task.created)
libs/
  common/          # @app/common: constants, message patterns, pipe dùng chung
docker/            # Script khởi tạo Postgres
docker-compose.yml # Postgres + Redis + RabbitMQ
```
