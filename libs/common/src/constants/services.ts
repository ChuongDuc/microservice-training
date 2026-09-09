/**
 * Tên định danh (injection token) cho các microservice client.
 * Gateway dùng các token này để inject ClientProxy tương ứng.
 */
export const AUTH_SERVICE = 'AUTH_SERVICE';
export const USER_SERVICE = 'USER_SERVICE';
export const TASK_SERVICE = 'TASK_SERVICE';

/**
 * Cổng TCP mặc định cho từng service (đồng bộ với docker-compose & .env).
 */
export const SERVICE_TCP_PORTS = {
  AUTH: 4001,
  USER: 4002,
  TASK: 4003,
} as const;
