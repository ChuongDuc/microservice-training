# Kịch bản demo

Kịch bản trình bày khoảng 15 phút, đi qua các tính năng chính và cho thấy hệ thống microservices chịu lỗi thế nào. Các bước dùng Swagger UI để người xem thấy rõ request/response. Phần API cũng chạy được tự động bằng `npm run demo`, dùng làm phương án dự phòng khi demo tay gặp sự cố.

## Chuẩn bị (trước buổi demo)

1. Chạy cả hệ thống bằng Docker (xem [README → Chạy nhanh bằng Docker](../README.md#chạy-nhanh-bằng-docker)):

   ```bash
   docker compose --profile app up -d --build
   docker compose --profile app ps      # các app ở trạng thái (healthy)
   ```

2. Mở sẵn các tab:
   - Swagger UI: http://localhost:3000/api
   - Health: http://localhost:3000/health
   - RabbitMQ: http://localhost:15672 (guest/guest), tab **Queues**
   - Sơ đồ kiến trúc: [docs/architecture.md](architecture.md)
3. Chạy thử `npm run demo` một lần để chắc mọi thứ chạy. Script tạo user mới mỗi lần chạy. Chờ một phút trước khi demo thật, vì giới hạn đăng nhập đếm theo IP trong 60 giây.

## 1. Giới thiệu kiến trúc (2 phút)

Mở sơ đồ trong [architecture.md](architecture.md):

- Client chỉ nói chuyện với Gateway.
- Gateway gọi 4 service qua TCP.
- Mỗi service có database riêng.
- Event đi qua RabbitMQ.

## 2. Hệ thống sống không? (1 phút)

Mở http://localhost:3000/health: 5 thành phần đều `up`, kèm phụ thuộc của từng service.

- Auth kiểm tra DB và Redis.
- Notification kiểm tra DB và RabbitMQ.

## 3. Đăng ký, đăng nhập, event bất đồng bộ (3 phút)

Trên Swagger UI:

1. `POST /auth/register` với body:

   ```json
   {
     "email": "alice@demo.local",
     "password": "matkhau-demo-123",
     "displayName": "Alice"
   }
   ```

   Kết quả 201, role `USER`. Đăng ký thêm `bob@demo.local` (tên `Bob`) theo cách tương tự.

2. Gửi lại với `"email": "khong-phai-email"` → 400. Lỗi có chi tiết từng field: Gateway validate trước khi gọi service.
3. `POST /auth/login` (Alice) → 200, nhận `accessToken` và `refreshToken`.
4. Bấm **Authorize**, dán `accessToken` của Alice, rồi gọi `GET /users/me`.
5. `GET /notifications`: thông báo "Chào Alice..." đã có.
   - Đường đi: Auth phát `user.registered` lên RabbitMQ, Notification Service nhận và lưu.
   - Đăng ký không chờ bước này.

## 4. Task và quyền sở hữu (3 phút)

1. `POST /tasks` (Alice):

   ```json
   { "title": "Chuẩn bị slide demo", "priority": "HIGH" }
   ```

   Kết quả 201. Copy `id` của task.

2. `PATCH /tasks/{id}` với `{ "status": "IN_PROGRESS" }`, sau đó `GET /tasks?status=IN_PROGRESS`.
3. `GET /notifications`: có thêm thông báo `task.created`.
4. Đăng nhập Bob, **Authorize** bằng token của Bob, gọi `GET /tasks/{id}` của Alice → 404.
   - Task Service luôn lọc theo `ownerId` lấy từ token.
   - Bob không biết được task đó có tồn tại hay không.

## 5. Phân quyền ADMIN (2 phút)

1. Bob gọi `GET /admin/users` → 403.
2. Nâng Alice lên ADMIN. Chưa có API tạo admin đầu tiên, nên sửa trực tiếp trong `user_db`:

   ```bash
   docker compose exec postgres psql -U postgres -d user_db -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'alice@demo.local'"
   ```

   Kết quả phải là `UPDATE 1`. Nếu `.env` đặt `POSTGRES_USER` khác `postgres`, thay `-U postgres` bằng giá trị đó.

3. Gọi `GET /admin/users` bằng token cũ của Alice → vẫn 403.
   - Role nằm trong access token, Gateway không hỏi lại DB.
   - Đăng nhập lại thì token mới có role `ADMIN` → 200.
4. `PATCH /admin/users/{id}/status` với `{ "status": "BLOCKED" }`, dùng `id` của Bob.
5. Bob đăng nhập lại → 403.

## 6. Bảo mật token (2 phút)

1. `POST /auth/refresh` với `refreshToken` của Alice → 200, nhận cặp token mới.
2. Gửi lại đúng `refreshToken` cũ → 401.
   - Mỗi refresh token chỉ dùng được một lần (rotation).
   - Token bị đánh cắp và đã dùng thì không dùng lại được.
3. `POST /auth/logout` với refresh token mới, sau đó refresh bằng token đó → 401.
4. `POST /auth/login` 6 lần liên tiếp với `"email": "mallory@demo.local"` (email chưa dùng) và mật khẩu bất kỳ:
   - 5 lần đầu nhận 401, giống hệt sai mật khẩu, nên không dò được email nào đã đăng ký.
   - Lần thứ 6 nhận 429 kèm header `Retry-After` (giây). Đây là cơ chế chống dò mật khẩu.
   - Giới hạn đếm **mọi** lần đăng nhập vào một email từ một IP trong 60 giây, kể cả lần thành công. Thử với Alice thì sẽ bị 429 sớm hơn, vì Alice đã đăng nhập ở các bước trước.

## 7. Chịu lỗi: một service chết (2 phút)

Phần này làm bằng terminal, vì `npm run demo` không dừng container.

1. Tắt Notification Service, rồi tạo task:

   ```bash
   docker compose stop notification-service
   ```

   - `POST /tasks` vẫn trả 201: tạo task không phụ thuộc Notification Service.
   - Tab **Queues** của RabbitMQ: `notifications_queue` có message đang chờ (Ready = 1).
   - http://localhost:3000/health trả 503 với `notification-service: down`; các service khác vẫn `up`.

2. Bật lại:

   ```bash
   docker compose start notification-service
   ```

   - Message trong queue được xử lý (Ready về 0).
   - `GET /notifications` có thông báo của task vừa tạo: event không mất.
   - `/health` về 200 sau vài giây.

3. Tắt Task Service:

   ```bash
   docker compose stop task-service
   ```

   - `GET /tasks` → 503 "Task Service không khả dụng".
   - `/auth/*` và `/users/me` vẫn chạy.
   - Bật lại: `docker compose start task-service`.

## Demo tự động

```bash
npm run demo
```

Script chạy các bước 2–6 với user mới (`demo-<mã>-alice@demo.local`, `demo-<mã>-bob@demo.local`). Nó in từng request kèm mã HTTP và dừng ngay khi có bước sai kỳ vọng.

| Biến              | Tác dụng                            |
| ----------------- | ----------------------------------- |
| `DEMO_PAUSE_MS=0` | Chạy liền, không nghỉ giữa các bước |
| `GATEWAY_URL`     | Trỏ tới Gateway khác                |

Script cần Postgres chạy bằng `docker compose`, vì bước nâng ADMIN dùng `docker compose exec postgres psql`. Chạy được cả khi app chạy bằng `npm run start:dev`.

Nếu demo nhận 429 ở bước đăng ký hoặc đăng nhập, chờ 60 giây rồi chạy lại: giới hạn theo IP vẫn đang tính các lần chạy trước.

## Câu hỏi thường gặp khi trình bày

- **Sao không dùng một database cho đơn giản?** Mỗi service sở hữu dữ liệu của mình, nên đổi schema hay scale một service không ảnh hưởng service khác. Đánh đổi: không JOIN được giữa các service, phải gọi qua TCP hoặc nhận event.
- **Gateway không hỏi Auth Service mỗi request thì sao biết token còn hợp lệ?** Gateway verify chữ ký JWT bằng secret dùng chung, và access token chỉ sống 15 phút. Phiên dài hạn được kiểm soát bằng refresh token (Redis, rotation).
- **RabbitMQ chết thì sao?** Đăng ký và tạo task vẫn thành công, nhưng event phát lúc đó bị mất. Chỗ cần cải thiện: transactional outbox (xem "Giới hạn đã biết" trong [architecture.md](architecture.md)).
