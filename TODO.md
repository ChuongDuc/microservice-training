# ✅ Lộ trình — Task Management Microservices (NestJS)

Kiến trúc: **monorepo** (Cách A). Mỗi service là 1 app NestJS độc lập, chạy process riêng, DB riêng.
Giao tiếp: **TCP** (đồng bộ) + **RabbitMQ** (bất đồng bộ).

---

## Giai đoạn 0 — Chuẩn bị & khởi tạo ✅ HOÀN TẤT
- [x] Cài Node.js LTS, NestJS CLI (v10.4.9), Docker
- [x] Khởi tạo NestJS monorepo tại thư mục dự án
- [x] Tạo 4 app: `gateway`, `auth-service`, `user-service`, `task-service`
- [x] Tạo thư viện dùng chung `@app/common` (constants: service names, message patterns)
- [x] Tạo `docker-compose.yml`: PostgreSQL + Redis + RabbitMQ
- [x] Script tạo tự động 3 database: `auth_db`, `user_db`, `task_db`
- [x] Tạo `.env` / `.env.example` + `.gitignore`
- [x] Nạp `ConfigModule` (global) vào cả 4 app
- [x] Xác nhận: build sạch cả 4 app, hạ tầng Docker healthy, gateway trả HTTP 200

## Giai đoạn 1 — User Service (service đầu tiên)
- [ ] Chọn ORM (TypeORM hoặc Prisma) + kết nối `user_db`
- [ ] Entity `User` (id, email, displayName, avatar, role, status, createdAt)
- [ ] Chuyển User Service sang microservice mode (TCP transport)
- [ ] Message handler: `user.create`, `user.find_by_id`, `user.find_by_email`, `user.update`, `user.list`
- [ ] Validation DTO (`class-validator`)

## Giai đoạn 2 — Auth Service + Gateway (scope Bảo mật)
- [ ] Kết nối `auth_db`, entity `Credential`, `RefreshToken`
- [ ] Hash mật khẩu (`bcrypt`/`argon2`)
- [ ] Đăng ký: Auth → gọi User Service (TCP) tạo user
- [ ] Đăng nhập: cấp access token (JWT) + refresh token
- [ ] Refresh token + rotation; đăng xuất
- [ ] Gateway: REST routes `/auth/*`, kết nối TCP client tới Auth/User
- [ ] JWT Auth Guard ở Gateway
- [ ] Identity propagation (truyền userId/role xuống service trong)

## Giai đoạn 3 — Task Service + Phân quyền (nghiệp vụ + Authorization)
- [ ] Kết nối `task_db`, entity `Task`
- [ ] Message handler CRUD task; resource ownership (chỉ chủ task thao tác)
- [ ] Gateway REST `/tasks` qua JWT Guard
- [ ] RBAC: `@Roles()` + `RolesGuard`; endpoint admin `/admin/users`
- [ ] Rate limiting (`@nestjs/throttler`) cho `/auth/login`
- [ ] Global `ValidationPipe` + exception filter chuẩn hoá lỗi

## Giai đoạn 4 — Nâng cao (nếu còn thời gian)
- [ ] Notification Service + kết nối RabbitMQ (lắng nghe event)
- [ ] Task/User phát event async (`task.created`, `user.registered`)
- [ ] Xem danh sách thông báo theo user

## Giai đoạn 5 — Hoàn thiện & đóng gói
- [ ] Dockerfile cho từng service + hoàn thiện docker-compose (chạy cả app)
- [ ] Chạy toàn hệ thống bằng `docker compose up`
- [ ] Swagger ở Gateway
- [ ] Health check mỗi service
- [ ] README + sơ đồ kiến trúc + kịch bản demo

---

## Lệnh hay dùng
```bash
# Bật/tắt hạ tầng (Postgres, Redis, RabbitMQ)
docker compose up -d
docker compose down

# Chạy 1 service ở chế độ watch
npm run start:dev gateway
npm run start:dev auth-service
npm run start:dev user-service
npm run start:dev task-service

# Build 1 app
npx nest build gateway
```

Giao diện quản trị RabbitMQ: http://localhost:15672 (guest/guest)
