import React, { useEffect, useRef, useState } from 'react';
import './MessageBox.css';

const DEFAULT_DURATION = 3000; // ms - thời gian tự tắt, chỉ áp dụng khi KHÔNG phải lỗi
const CLOSE_ANIM_DURATION = 250; // ms - phải khớp với animation trong MessageBox.css

/**
 * MessageBox tự quản lý vòng đời hiển thị của nó:
 * - type = 'error'  -> hiển thị như một hộp thoại ở GIỮA màn hình, có lớp nền mờ
 *   phía sau, KHÔNG tự tắt, bấm ra ngoài cũng KHÔNG tắt -> bắt buộc phải bấm nút
 *   "Đóng" to, dễ bấm mới tắt được.
 * - type khác (success, info, ...) -> vẫn hiển thị dạng toast nhỏ góc trên bên
 *   phải, tự tắt sau `duration` ms, hoặc bấm nút "×" để tắt sớm.
 */
const MessageBox = ({ message, type = 'success', onClose, duration = DEFAULT_DURATION }) => {
  const [isClosing, setIsClosing] = useState(false);
  const autoCloseTimerRef = useRef(null);
  const closeAnimTimerRef = useRef(null);

  const isError = type === 'error';

  const clearTimers = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    if (closeAnimTimerRef.current) {
      clearTimeout(closeAnimTimerRef.current);
      closeAnimTimerRef.current = null;
    }
  };

  // Chạy animation fade-out trước, xong mới thực sự gọi onClose (bỏ message ở component cha)
  const requestClose = () => {
    clearTimers();
    setIsClosing(true);
    closeAnimTimerRef.current = setTimeout(() => {
      onClose && onClose();
    }, CLOSE_ANIM_DURATION);
  };

  const startAutoCloseTimer = () => {
    if (isError) return; // lỗi thì không tự tắt, phải bấm nút
    autoCloseTimerRef.current = setTimeout(requestClose, duration);
  };

  // Mỗi khi có message/type mới thì reset lại toàn bộ trạng thái
  useEffect(() => {
    clearTimers();
    setIsClosing(false);

    if (message) {
      startAutoCloseTimer();
    }

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, type, duration]);

  if (!message) return null;

  const handleMouseEnter = () => {
    if (isError) return;
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    if (isError || isClosing) return;
    startAutoCloseTimer();
  };

  // ----- Hiển thị dạng hộp thoại giữa màn hình cho lỗi -----
  if (isError) {
    return (
      <div className={`message-overlay${isClosing ? ' closing' : ''}`}>
        <div className="message-box error" role="alertdialog" aria-modal="true">
          <div className="message-box-icon" aria-hidden="true">!</div>
          <span className="message-box-text">{message}</span>
          <button
            type="button"
            className="message-box-confirm-button"
            onClick={requestClose}
            autoFocus
          >
            Đóng
          </button>
        </div>
      </div>
    );
  }

  // ----- Hiển thị dạng toast nhỏ góc trên cho các loại còn lại -----
  // Lưu ý: không dùng class tên "toast" trần vì Bootstrap có sẵn .toast { display: none; }
  // sẽ đè lên và làm ẩn mất khung thông báo (Bootstrap CSS được import sau cùng trong index.js).
  return (
    <div
      className={`message-box message-box--toast ${type}${isClosing ? ' closing' : ''}`}
      role="status"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="message-box-text">{message}</span>
      <button
        type="button"
        className="close-button"
        onClick={requestClose}
        aria-label="Đóng thông báo"
      >
        ×
      </button>
    </div>
  );
};

export default MessageBox;