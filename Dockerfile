# syntax=docker/dockerfile:1
#
# Một Dockerfile cho cả 5 app của monorepo, chọn app bằng build arg APP:
#   docker build --build-arg APP=task-service -t tm-task-service .
# Các app dùng chung dependencies, thư viện @app/common và bước build, nên một file
# nhiều stage gọn hơn 5 file gần giống hệt nhau; stage `build` (build cả 5 app) được
# cache và dùng lại khi docker compose build từng app.
#
# Stage:
#   deps      -> node_modules đầy đủ (cả devDependencies: nest CLI, prisma CLI)
#   build     -> generate Prisma client + build cả 5 app; cũng là image chạy migration
#   prod-deps -> node_modules chỉ dependencies chạy thật
#   runtime   -> image chạy một app (mặc định, stage cuối)

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
# Prisma query engine cần OpenSSL
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
# Chỉ copy những gì build/migrate cần (test, tài liệu đã bị .dockerignore loại): sửa
# README hay test không làm mất cache của bước generate + build bên dưới
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY libs ./libs
COPY apps ./apps
# Service `migrate` của docker-compose kiểm tra JWT secret bằng script này
COPY scripts/check-jwt-secrets.ts ./scripts/
# Generate trong container: query engine đúng nền tảng Linux (musl) thay vì bản của máy
# build (Windows/macOS)
RUN for service in user auth task notification; do \
      npm run "prisma:${service}:generate"; \
    done
RUN for app in gateway auth-service user-service task-service notification-service; do \
      npx nest build "$app"; \
    done

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM build AS bundle
ARG APP
# Gom những gì app cần lúc chạy vào /out, giữ đúng đường dẫn như trong repo: Prisma
# client tìm query engine theo `<cwd>/apps/<service>/generated/prisma`
RUN test -n "$APP" || (echo "Thiếu --build-arg APP=<tên app>" && exit 1) \
 && mkdir -p "/out/dist/apps" "/out/apps/$APP" \
 && cp -r "dist/apps/$APP" "/out/dist/apps/$APP" \
 && if [ -d "apps/$APP/generated" ]; then \
      cp -r "apps/$APP/generated" "/out/apps/$APP/generated"; \
    fi

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=bundle /out ./
# Docker healthcheck của các service TCP (xem docker-compose.yml)
COPY scripts/tcp-healthcheck.js ./scripts/
ARG APP
ENV APP_NAME=${APP}
# Không chạy bằng root
USER node
CMD ["sh", "-c", "exec node dist/apps/${APP_NAME}/main.js"]
