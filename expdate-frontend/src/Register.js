import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import config from './config.json';
import { getServerErrorMessage } from './utils/errorMessages';
const API_URL = config.server;

function Register() {
  const [formData, setFormData] = useState({
    username: '',
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    group: ''
  });

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match!');
      setLoading(false);
      return;
    }

    // Chuẩn bị data gửi đi (bạn chỉnh key phù hợp backend nếu cần)
    const payload = {
      username: formData.username,
      full_name: formData.fullName,  // backend có thể dùng full_name hay fullName
      email: formData.email,
      password: formData.password,
      group: formData.group
    };
console.log('Sending payload:', payload);

    try {
      const response = await fetch(`${API_URL}/api/accounts/register/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        // Nếu backend trả lỗi dạng { message }, { error }, hoặc lỗi theo từng field
        // (vd: { username: ["đã tồn tại"] }) thì đều được lấy ra đúng nội dung.
        setError(getServerErrorMessage(errData, 'Đăng ký thất bại. Vui lòng thử lại.'));
        return;
      }

      // Nếu đăng ký thành công
      alert('Register successfully! Please login.');

      // Chuyển về trang login
      navigate('/');

    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error('Register error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container d-flex justify-content-center align-items-center">
      <div className="card p-4 shadow" style={{ width: '100%', maxWidth: '450px' }}>
        <h2 className="text-center mb-4">Đăng ký</h2>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>

          <div className="form-group mb-3">
            <label>Tên đăng nhập</label>
            <input
              type="text"
              className="form-control"
              name="username"
              placeholder="Nhập tên đăng nhập"
              value={formData.username}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group mb-3">
            <label>Mật khẩu</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                name="password"
                placeholder="Nhập mật khẩu"
                value={formData.password}
                onChange={handleChange}
                required
                style={{ paddingRight: '40px' }}
              />
              <span
                onClick={() => setShowPassword((prev) => !prev)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  cursor: 'pointer',
                  color: '#888',
                  fontSize: '20px',
                  userSelect: 'none',
                }}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? '🙉' : '🙈'}
              </span>
            </div>
          </div>

          <div className="form-group mb-3">
            <label>Xác nhận mật khẩu</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className="form-control"
                name="confirmPassword"
                placeholder="Nhập lại mật khẩu"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                style={{ paddingRight: '40px' }}
              />
              <span
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  cursor: 'pointer',
                  color: '#888',
                  fontSize: '20px',
                  userSelect: 'none',
                }}
                title={showConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showConfirmPassword ? '🙉' : '🙈'}
              </span>
            </div>
          </div>

          <div className="form-group mb-3">
            <label>Họ và tên</label>
            <input
              type="text"
              className="form-control"
              name="fullName"
              placeholder="Nhập họ và tên"
              value={formData.fullName}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group mb-3">
            <label>Email</label>
            <input
              type="email"
              className="form-control"
              name="email"
              placeholder="Nhập email"
              value={formData.email}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group mb-4">
            <label>Mã cửa hàng</label>
            <input
              type="text"
              className="form-control"
              name="group"
              placeholder="Nhập mã cửa hàng"
              value={formData.group}
              onChange={handleChange}
              required
            />
          </div>

          <button type="submit" className="btn btn-success w-100" disabled={loading}>
            {loading ? 'Đang đăng ký...' : 'Đăng ký'}
          </button>

          <p className="mt-3 text-center">
            Đã có tài khoản? <Link to="/">Đăng nhập</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default Register;