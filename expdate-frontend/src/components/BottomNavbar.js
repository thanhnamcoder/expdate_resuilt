import React, { useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

function BottomNavbar({ activeTab, setActiveTab }) {
  const handleTabClick = (tabName) => {
    setActiveTab(tabName);
  };

  return (
    <nav
      className="nav justify-content-around bg-light border-top py-2 fixed-bottom"
      style={{
        zIndex: 1030,
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        overflow: 'hidden',
        height: '56px',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)'
      }}
    >
      <a
        className={`nav-link d-flex flex-column align-items-center ${activeTab === 'homeTab' ? 'active text-primary' : 'text-muted'}`}
        href="#"
        onClick={() => handleTabClick('homeTab')}
      >
        <i className="bi bi-house-door" style={{ fontSize: '1rem' }}></i>
        <span style={{ fontSize: '0.75rem' }}>Trang chủ</span>
      </a>

      <a
        className={`nav-link d-flex flex-column align-items-center ${activeTab === 'dataTab' ? 'active text-primary' : 'text-muted'}`}
        href="#"
        onClick={() => handleTabClick('dataTab')}
      >
        <i className="bi bi-bar-chart-line" style={{ fontSize: '1rem' }}></i>
        <span style={{ fontSize: '0.75rem' }}>Dữ liệu</span>
      </a>

      <a
        className={`nav-link d-flex flex-column align-items-center ${activeTab === 'allDataTab' ? 'active text-primary' : 'text-muted'}`}
        href="#"
        onClick={() => handleTabClick('allDataTab')}
      >
        <i className="bi bi-box-seam" style={{ fontSize: '1rem' }}></i>
        <span style={{ fontSize: '0.75rem' }}>Product</span>
      </a>

      <a
        className={`nav-link d-flex flex-column align-items-center ${activeTab === 'printTab' ? 'active text-primary' : 'text-muted'}`}
        href="#"
        onClick={() => handleTabClick('printTab')}
      >
        <i className="bi bi-printer" style={{ fontSize: '1rem' }}></i>
        <span style={{ fontSize: '0.75rem' }}>Print</span>
      </a>
    </nav>
  );
}

export default BottomNavbar;
