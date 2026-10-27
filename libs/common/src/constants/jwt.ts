/**
 * Thuật toán ký JWT dùng chung: Auth Service ký, Gateway verify. Khai báo ở một chỗ
 * để hai bên không lệch nhau (đổi thuật toán ở Auth mà quên Gateway -> mọi token 401).
 */
export const JWT_ALGORITHM = 'HS256' as const;
