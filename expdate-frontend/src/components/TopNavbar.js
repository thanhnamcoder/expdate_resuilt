import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';

function TopNavbar({ isAuthenticated, onLogout }) {
  const [showProfile, setShowProfile] = useState(false);
  const [fullName, setFullName] = useState('ExpDate');
  const [navHeight, setNavHeight] = useState(56);
  const navbarRef = useRef(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  useEffect(() => {
    const storedFullName = localStorage.getItem('full_name');
    setFullName(storedFullName || 'ExpDate');
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      // Lấy thông tin quyền từ localStorage (nếu đã lưu khi login)
      const isSuper = localStorage.getItem('is_superuser');
      setIsSuperuser(isSuper === 'true');
    } else {
      setIsSuperuser(false);
    }
  }, [isAuthenticated]);

  const handleProfileClick = () => setShowProfile(true);
  const handleCloseProfile = () => setShowProfile(false);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('full_name');
    if (onLogout) onLogout();
  };

  useEffect(() => {
    const updateNavHeight = () => {
      if (navbarRef.current) {
        setNavHeight(navbarRef.current.offsetHeight);
      }
    };

    updateNavHeight();
    window.addEventListener('resize', updateNavHeight);

    const observer = new MutationObserver(updateNavHeight);
    if (navbarRef.current) {
      observer.observe(navbarRef.current, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      window.removeEventListener('resize', updateNavHeight);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (isExpanded && navbarRef.current && !navbarRef.current.contains(event.target)) {
        setIsExpanded(false);
      }
    }
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isExpanded]);

  const toggleNavbar = () => setIsExpanded((prev) => !prev);

  return (
    <>
      <div className="container-fluid" style={{ padding: 0 }}>
        <nav
          ref={navbarRef}
          className="navbar navbar-light bg-light"
          style={{
            position: 'fixed',
            top: 0,
            width: '100%',
            zIndex: 1000,
            backdropFilter: 'blur(10px)',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            transition: 'all 0.4s ease',
          }}
        >
          <div className="container-fluid">
            <Link className="navbar-brand" to="/">{fullName}</Link>
            <button
              className="navbar-toggler"
              type="button"
              aria-controls="navbarNav"
              aria-expanded={isExpanded}
              aria-label="Toggle navigation"
              onClick={toggleNavbar}
            >
              <span className="navbar-toggler-icon"></span>
            </button>
            <div
              className={`collapse navbar-collapse ${isExpanded ? 'show' : ''}`}
              id="navbarNav"
              style={{
                maxHeight: isExpanded ? '300px' : '0',
                overflow: 'hidden',
                transition: 'max-height 0.4s ease',
              }}
            >
              <ul className="navbar-nav">
                <li className="nav-item w-100">
                  <button
                    className="nav-link w-100 text-start"
                    style={{ background: 'none', border: 'none' }}
                    onClick={handleProfileClick}
                  >
                    Hồ sơ
                  </button>
                </li>
                {isSuperuser && (
                  <li className="nav-item w-100">
                    <a
                      className="nav-link w-100 text-start"
                      style={{ background: 'none', border: 'none', color: '#d35400', fontWeight: 'bold' }}
                      href={`${process.env.REACT_APP_API_URL || (window.API_URL || window.location.origin)}/admin`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Panel
                    </a>
                  </li>
                )}
                {isAuthenticated && (
                  <li className="nav-item w-100">
                    <button
                      className="nav-link w-100 text-start"
                      style={{ background: 'none', border: 'none' }}
                      onClick={handleLogout}
                    >
                      Đăng xuất
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </nav>
      </div>

      <div style={{ height: `${navHeight}px`, transition: 'height 0.3s ease' }}></div>

      {showProfile && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Hồ sơ</h5>
                <button type="button" className="btn-close" onClick={handleCloseProfile}></button>
              </div>
              <div className="modal-body">
                <p>Thông tin hồ sơ của bạn.</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseProfile}>Đóng</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default TopNavbar;
