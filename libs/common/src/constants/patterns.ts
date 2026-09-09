/**
 * Các "message pattern" dùng khi service giao tiếp với nhau (request-response qua TCP).
 * Đặt tập trung ở đây để Gateway và service dùng chung một "hợp đồng", tránh gõ sai chuỗi.
 */
export const AUTH_PATTERNS = {
  REGISTER: 'auth.register',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  VALIDATE_TOKEN: 'auth.validate_token',
} as const;

export const USER_PATTERNS = {
  CREATE: 'user.create',
  FIND_BY_ID: 'user.find_by_id',
  FIND_BY_EMAIL: 'user.find_by_email',
  UPDATE: 'user.update',
  LIST: 'user.list',
} as const;

export const TASK_PATTERNS = {
  CREATE: 'task.create',
  FIND_ALL: 'task.find_all',
  FIND_ONE: 'task.find_one',
  UPDATE: 'task.update',
  DELETE: 'task.delete',
} as const;
