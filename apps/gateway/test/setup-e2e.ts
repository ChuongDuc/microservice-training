/**
 * Chạy trước mỗi file e2e của Gateway. Test đăng nhập/đăng ký nhiều lần từ cùng IP
 * (127.0.0.1), nên nới giới hạn /auth/login + /auth/register để không dính 429 ngoài ý
 * muốn. login-throttle.e2e-spec tự đặt lại ngưỡng thấp để kiểm tra giới hạn.
 */
process.env.LOGIN_THROTTLE_LIMIT = '10000';
process.env.LOGIN_THROTTLE_IP_LIMIT = '10000';
