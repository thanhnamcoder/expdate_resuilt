// Tiện ích dùng chung để tạo thông báo lỗi rõ ràng, cụ thể:
// - Nếu là lỗi do người dùng chưa điền/chọn đủ dữ liệu -> liệt kê đúng
//   những trường còn thiếu.
// - Nếu không phải lỗi thiếu trường (vd: lỗi từ server, lỗi mạng...) ->
//   lấy đúng nội dung lỗi mà server trả về thay vì hiện một câu chung chung.

// Nhãn hiển thị mặc định cho một số field hay dùng trong app. Nếu field
// không có trong danh sách này, tên field/key truyền vào sẽ được dùng
// trực tiếp làm nhãn (nên có thể truyền thẳng nhãn tiếng Việt làm key).
const FIELD_LABELS = {
  barcode: 'Barcode',
  itemname: 'Tên sản phẩm',
  itemName: 'Tên sản phẩm',
  quantity: 'Số lượng',
  expdate: 'Hạn sử dụng',
  images: 'Ảnh đính kèm',
  username: 'Tên đăng nhập',
  password: 'Mật khẩu',
  confirmPassword: 'Xác nhận mật khẩu',
  fullName: 'Họ và tên',
  email: 'Email',
  group: 'Mã cửa hàng',
};

const isEmptyValue = (value) => {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return value === undefined || value === null || Number.isNaN(value);
};

/**
 * Trả về câu thông báo liệt kê CỤ THỂ các trường còn thiếu, dựa trên object
 * { tenTruong: giaTri }. Field nào giá trị rỗng/falsy sẽ được liệt kê ra
 * theo đúng tên (hoặc nhãn) của nó.
 * Trả về null nếu không thiếu trường nào (đủ dữ liệu).
 *
 * Ví dụ:
 *   getMissingFieldsMessage({ barcode, itemname, quantity })
 *   -> "Vui lòng điền: Barcode, Số lượng." (nếu itemname có giá trị, còn lại thì không)
 */
export function getMissingFieldsMessage(fields, labels = {}) {
  const mergedLabels = { ...FIELD_LABELS, ...labels };
  const missing = Object.entries(fields)
    .filter(([, value]) => isEmptyValue(value))
    .map(([key]) => mergedLabels[key] || key);

  if (missing.length === 0) return null;
  return `Vui lòng điền/chọn: ${missing.join(', ')}.`;
}

/**
 * Trích xuất thông báo lỗi CỤ THỂ từ response server (đã .json() xong),
 * hỗ trợ các format phổ biến:
 *  - { message: "..." }
 *  - { error: "..." }
 *  - { detail: "..." }
 *  - { errors: ["...", "..."] }
 *  - { errors: { field: ["...", ...] } }
 *  - Django REST Framework field errors: { field: ["...", ...], ... }
 * Nếu không tìm được nội dung lỗi cụ thể nào thì trả về `fallback`.
 */
export function getServerErrorMessage(result, fallback = 'Đã xảy ra lỗi. Vui lòng thử lại.') {
  if (!result) return fallback;
  if (typeof result === 'string' && result.trim()) return result;

  if (typeof result.message === 'string' && result.message.trim()) return result.message;
  if (typeof result.error === 'string' && result.error.trim()) return result.error;
  if (typeof result.detail === 'string' && result.detail.trim()) return result.detail;

  if (Array.isArray(result.errors) && result.errors.length) {
    return result.errors
      .map((e) => (typeof e === 'string' ? e : e.message || JSON.stringify(e)))
      .join(' ');
  }

  if (result.errors && typeof result.errors === 'object') {
    const parts = Object.entries(result.errors).map(([field, msgs]) => {
      const label = FIELD_LABELS[field] || field;
      const text = Array.isArray(msgs) ? msgs.join(', ') : msgs;
      return `${label}: ${text}`;
    });
    if (parts.length) return parts.join(' | ');
  }

  // Kiểu lỗi field-by-field của Django REST Framework: { field: ["msg1", ...], ... }
  const fieldErrorParts = Object.entries(result)
    .filter(([, value]) => Array.isArray(value) && value.every((v) => typeof v === 'string'))
    .map(([field, msgs]) => `${FIELD_LABELS[field] || field}: ${msgs.join(', ')}`);
  if (fieldErrorParts.length) return fieldErrorParts.join(' | ');

  return fallback;
}