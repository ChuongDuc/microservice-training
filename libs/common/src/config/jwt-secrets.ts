/** Độ dài tối thiểu của secret ký JWT (HS256 dùng khoá 256 bit). */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Giá trị mẫu trong `.env.example`. Đã công khai trên repo nên ai cũng ký được token
 * (kể cả role ADMIN) nếu service chạy với secret này.
 */
export const JWT_SECRET_PLACEHOLDERS = [
  'doi_secret_nay_thanh_chuoi_ngau_nhien_dai',
  'doi_secret_refresh_nay_thanh_chuoi_khac',
] as const;

/**
 * Kiểm tra secret JWT trước khi khởi động service; sai thì ném lỗi để service không
 * chạy được: thiếu, ngắn hơn MIN_JWT_SECRET_LENGTH, trùng giá trị mẫu, hoặc hai secret
 * trùng nhau (access token và refresh token phải ký bằng khoá khác nhau).
 */
export function assertJwtSecrets(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): void {
  const problems: string[] = [];
  for (const key of keys) {
    const value = env[key];
    if (!value) problems.push(`${key} chưa được đặt`);
    else if ((JWT_SECRET_PLACEHOLDERS as readonly string[]).includes(value)) {
      problems.push(`${key} đang dùng giá trị mẫu trong .env.example`);
    } else if (value.length < MIN_JWT_SECRET_LENGTH) {
      problems.push(
        `${key} phải dài ít nhất ${MIN_JWT_SECRET_LENGTH} ký tự (hiện ${value.length})`,
      );
    }
  }
  const values = keys.map((key) => env[key]).filter(Boolean);
  if (new Set(values).size < values.length) {
    problems.push(`${keys.join(' và ')} không được trùng nhau`);
  }

  if (problems.length) {
    throw new Error(
      `Cấu hình JWT không an toàn:\n- ${problems.join('\n- ')}\n` +
        `Tạo secret ngẫu nhiên: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
}
