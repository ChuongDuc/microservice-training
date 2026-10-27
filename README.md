# Task Management — Microservices với NestJS

Dự án học tập: hệ thống quản lý công việc viết theo kiến trúc microservices, dùng **NestJS monorepo**.

- **4 app** trong `apps/`: `gateway` (HTTP public), `auth-service`, `user-service`, `task-service`
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

Giá trị mặc định trong `.env.example` đã khớp với `docker-compose.yml`, nên chạy local không cần sửa gì. Chỉ cần đổi `JWT_*_SECRET` khi dùng thật.

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
npm run start:dev task-service
npm run start:dev gateway         # HTTP, cổng GATEWAY_PORT (mặc định 3000), cần auth-service + user-service
```

> `gateway` là cửa vào HTTP duy nhất (cổng `GATEWAY_PORT`), có các route `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` và forward xuống Auth Service qua TCP. `task-service` vẫn là app HTTP mẫu nghe cổng 3000, nên đừng chạy cùng lúc với `gateway` cho tới Giai đoạn 3.

Build một app: `npx nest build <app>` (output nằm trong `dist/apps/<app>`).

## Test

```bash
# Unit test (mọi file *.spec.ts trong apps/ và libs/)
npm test

# E2E User Service: bật User Service thật qua TCP (cổng 4102) và gọi bằng ClientProxy.
# Cần Postgres đang chạy và đã chạy npm run prisma:user:migrate.
npm run test:e2e:user

# E2E Gateway: bật User + Auth Service thật (TCP, cổng 4202/4201) và Gateway, gọi REST /auth/*.
# Cần Postgres (đã migrate user_db + auth_db) và Redis đang chạy.
npm run test:e2e:gateway
```

## Cấu trúc thư mục

```
apps/
  gateway/         # API Gateway (HTTP)
  auth-service/    # Đăng ký, đăng nhập, JWT, refresh token
  user-service/    # Quản lý user (Prisma + TCP)
  task-service/    # Quản lý task
libs/
  common/          # @app/common: constants, message patterns, pipe dùng chung
docker/            # Script khởi tạo Postgres
docker-compose.yml # Postgres + Redis + RabbitMQ
```
