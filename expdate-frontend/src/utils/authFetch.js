// src/utils/authFetch.js
import config from '../config.json';

const API_URL = config.server;

let refreshingPromise = null;

export async function authFetch(url, options = {}) {
  let accessToken = localStorage.getItem('access_token');
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  options.headers = {
    ...(options.headers || {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(isFormData ? {} : { 'Content-Type': options.headers?.['Content-Type'] || 'application/json' }),
  };

  options.credentials = 'include';

  let response = await fetch(url, options);

  // Xử lý lỗi 401 token expired
    if (
    response.status === 401 &&
    response.headers.get('content-type')?.includes('application/json')
  ) {
    let errorJson;
    try {
      errorJson = await response.clone().json();  // clone để đọc JSON lỗi
    } catch {
      errorJson = {};
    }
    const isTokenExpired =
      errorJson?.code === 'token_not_valid' ||
      (errorJson?.messages && errorJson.messages.some(m => m.message?.toLowerCase().includes('expired')));
    if (isTokenExpired) {
        if (!refreshingPromise) {
        refreshingPromise = fetch(`${API_URL}/api/accounts/token/refresh/`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(res => res.json())
          .then(refreshData => {
            if (refreshData.access) {
              localStorage.setItem('access_token', refreshData.access);
              return refreshData.access;
            } else {
              localStorage.removeItem('access_token');
              localStorage.removeItem('refresh_token');
              window.location.href = '/login';
              throw new Error('Session expired. Please login again.');
            }
          })
          .finally(() => {
            refreshingPromise = null;
          });
      }
      try {
        const newAccessToken = await refreshingPromise;
        const newHeaders = {
          ...(options.headers || {}),
          Authorization: `Bearer ${newAccessToken}`,
        };
        response = await fetch(url, { ...options, headers: newHeaders });
        if (response.status === 401) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
          throw new Error('Session expired. Please login again.');
        }
      } catch (err) {
        throw err;
      }
    }
  }

  return response;  // Trả về nguyên bản, chưa gọi .json()
}
