import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import config from './config.json';
import { authFetch } from './utils/authFetch';
import { getServerErrorMessage } from './utils/errorMessages';

const API_URL = config.server;

function Login({ onLogin }) {   // <-- nhận prop onLogin từ App
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });

  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null); // Thêm state cho message thành công
  const [loading, setLoading] = useState(false); // Add loading state
  const [showPassword, setShowPassword] = useState(false);
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
    setLoading(true); // Start loading

    try {
const response = await fetch(`${API_URL}/api/accounts/login/`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify(formData),
});


      const data = await response.json();

      if (!response.ok) {
        setError(getServerErrorMessage(data, 'Đăng nhập thất bại. Vui lòng kiểm tra lại tên đăng nhập/mật khẩu.'));
        setLoading(false); // Stop loading on error
        return;
      }

      // Hiển thị message thành công nếu có
      if (data.message) {
        setSuccessMsg(data.message);
        setTimeout(() => setSuccessMsg(null), 2000);
      }

      // Lưu token và username vào localStorage (refresh stored in HttpOnly cookie)
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('username', formData.username); // Lưu username

      // ✅ Lưu fullname nếu có
      if (data.full_name) {
        localStorage.setItem('full_name', data.full_name);
      }
      // Lưu quyền nếu có
      if (typeof data.is_staff !== 'undefined') {
        localStorage.setItem('is_staff', data.is_staff ? 'true' : 'false');
      }
      if (typeof data.is_superuser !== 'undefined') {
        localStorage.setItem('is_superuser', data.is_superuser ? 'true' : 'false');
      }
      if (typeof data.is_active !== 'undefined') {
        localStorage.setItem('is_active', data.is_active ? 'true' : 'false');
      }

      // Gọi callback onLogin báo App cập nhật trạng thái đăng nhập
      if (onLogin) {
        onLogin();
      }

      // Chuyển trang sang home
      navigate('/home');
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error('Login error:', err);
    } finally {
      setLoading(false); // Stop loading
    }
  };

  return (
    <div className="container d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
      
      <div className="card p-4 shadow" style={{ width: '100%', maxWidth: '400px' }}>
        <h2 className="text-center mb-4">Đăng nhập</h2>

        {error && <div className="alert alert-danger">{error}</div>}
        {successMsg && <div className="alert alert-success">{successMsg}</div>}

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

          <div className="form-group mb-4">
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

          <button type="submit" className="btn btn-primary w-100" disabled={loading}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>

        <p className="mt-3 text-center">
          Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;