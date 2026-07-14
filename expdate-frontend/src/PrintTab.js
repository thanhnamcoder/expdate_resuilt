import React, { useRef, useState, useEffect } from 'react';
import QrScanner from './QrScanner';
import MessageBox from './components/MessageBox';
import Barcode from 'react-barcode';
import debounce from 'lodash.debounce';
import { QRCodeSVG } from 'qrcode.react';

const PRINT_TAB_STATE_KEY = 'printTabState';

function PrintTab({ allProducts = [], savedState, saveState }) {
  const qrScannerRef = useRef(null);
  const selectedListRef = useRef(null);
  // Restore state only once on mount
  const [restored, setRestored] = useState(false);
  const [scanResult, setScanResult] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('success');
  // Lưu riêng giá trị barcode cho từng size
  const [barcodeValues, setBarcodeValues] = useState({ small: '', medium: '', large: '' });
  const [selectedSize, setSelectedSize] = useState('small');
  const [productName, setProductName] = useState('');
  const [itemOptions, setItemOptions] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedBarcodes, setSelectedBarcodes] = useState({ small: [], medium: [], large: [] }); // Lưu sản phẩm đã chọn cho từng size
  const [qrPage, setQrPage] = useState(0);
  const [qrAnimDirection, setQrAnimDirection] = useState(null); // 'left' | 'right' | null
  const [qrAnimKey, setQrAnimKey] = useState(0);

  // Xóa state tạm thời khi reload app
  useEffect(() => {
    const clearOnReload = () => {
      setScanResult('');
      setShowModal(false);
      setMessage(null);
      setMessageType('success');
      localStorage.removeItem(PRINT_TAB_STATE_KEY);
    };
    window.addEventListener('beforeunload', clearOnReload);
    return () => {
      window.removeEventListener('beforeunload', clearOnReload);
    };
  }, []);

  // Restore state only once
  useEffect(() => {
    if (!restored) {
      const saved = localStorage.getItem(PRINT_TAB_STATE_KEY);
      if (saved) {
        try {
          const state = JSON.parse(saved);
          setScanResult(state.scanResult || '');
          setShowModal(false); // Always close modal on mount for safety
          // Only restore message if it is not a success notification
          if (state.messageType !== 'success') {
            setMessage(state.message || null);
            setMessageType(state.messageType || 'success');
          } else {
            setMessage(null);
            setMessageType('success');
          }
        } catch {}
      }
      setRestored(true);
    }
    // eslint-disable-next-line
  }, [restored]);

  // Save state to localStorage whenever it changes, but only after restore
  useEffect(() => {
    if (!restored) return;
    const state = {
      scanResult,
      showModal: false, // never persist modal open
      message,
      messageType
    };
    localStorage.setItem(PRINT_TAB_STATE_KEY, JSON.stringify(state));
  }, [scanResult, showModal, message, messageType, restored]);

  // Khôi phục state khi mount nếu có savedState
  useEffect(() => {
    if (savedState) {
      if (savedState.barcodeValues) setBarcodeValues(savedState.barcodeValues);
      if (savedState.selectedBarcodes) setSelectedBarcodes(savedState.selectedBarcodes);
      if (savedState.selectedSize) setSelectedSize(savedState.selectedSize);
      if (savedState.qrPage !== undefined) setQrPage(savedState.qrPage);
    }
    // eslint-disable-next-line
  }, []);

  // Lưu state mỗi khi thay đổi
  useEffect(() => {
    if (saveState) {
      saveState({
        barcodeValues,
        selectedBarcodes,
        selectedSize,
        qrPage
      });
    }
    // eslint-disable-next-line
  }, [barcodeValues, selectedBarcodes, selectedSize, qrPage]);

  // Khi đổi input barcode (tối ưu: lọc theo nhiều trường, nhiều từ, debounce, giới hạn 20 kết quả)
  const debouncedFilter = React.useCallback(
    debounce((value) => {
      if (value && allProducts.length > 0) {
        const normalized = value.trim().toLowerCase();
        const searchWords = normalized.split(' ');
        const filtered = allProducts.filter(product => {
          const name = (product.item_name || '').toLowerCase();
          const barcode = (product.item_barcode || '').toLowerCase();
          const code = (product.item_code || '').toLowerCase();
          // Tìm theo tên (tất cả từ phải có trong tên), hoặc barcode/code chứa toàn bộ chuỗi search
          return (
            searchWords.every(word => name.includes(word)) ||
            barcode.includes(normalized) ||
            code.includes(normalized)
          );
        }).slice(0, 200); // Giới hạn 200 kết quả
        setItemOptions(filtered);
        setCurrentPage(1);
        setProductName('');
      } else {
        setItemOptions([]);
        setProductName('');
      }
    }, 100),
    [allProducts]
  );

  // Khi đổi input barcode
  const handleBarcodeChange = (e) => {
    const value = e.target.value;
    setBarcodeValues(prev => ({ ...prev, [selectedSize]: value }));
    debouncedFilter(value);
  };

  // Khi chọn sản phẩm từ dropdown hoặc khi scan, tự động thêm vào danh sách đã chọn
  const handleSelectItem = (item) => {
    setBarcodeValues(prev => ({ ...prev, [selectedSize]: '' })); // Clear input sau khi chọn
    setProductName(item.item_name);
    setItemOptions([]);
    setSelectedBarcodes(prev => {
      const arr = prev[selectedSize] || [];
      if (arr.find(i => i.item_barcode === item.item_barcode)) return prev;
      return { ...prev, [selectedSize]: [...arr, item] };
    });
  };

  // Khi scan barcode, nếu chỉ có 1 sản phẩm khớp thì tự động chọn và thêm vào danh sách, nếu nhiều thì xổ dropdown
  const handleScanSuccess = (decodedText) => {
    setBarcodeValues(prev => ({ ...prev, [selectedSize]: decodedText }));
    setScanResult(decodedText);
    setShowModal(false);
    setMessage('Quét mã thành công!');
    setMessageType('success');
    // Lọc autocomplete như khi nhập input
    if (allProducts.length > 0) {
      const normalized = decodedText.trim().toLowerCase();
      const searchWords = normalized.split(' ');
      const filtered = allProducts.filter(product => {
        const name = (product.item_name || '').toLowerCase();
        const barcode = (product.item_barcode || '').toLowerCase();
        const code = (product.item_code || '').toLowerCase();
        return (
          searchWords.every(word => name.includes(word)) ||
          barcode.includes(normalized) ||
          code.includes(normalized)
        );
      }).slice(0, 20);
      setItemOptions(filtered);
      setCurrentPage(1);
      // Nếu chỉ có 1 sản phẩm khớp thì tự động chọn và thêm vào danh sách
      if (filtered.length === 1) {
        handleSelectItem(filtered[0]);
      }
      // Nếu nhiều hơn 1 thì xổ dropdown để chọn
    } else {
      setItemOptions([]);
    }
  };
  const handleScanError = (err) => {
    // Optionally handle scan errors
    // setMessage('Lỗi khi quét mã QR', 'error');
  };
  const handleOpenModal = () => setShowModal(true);
  const handleCloseModal = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stopScan();
    }
    setShowModal(false);
  };

  useEffect(() => {
    if (showModal && qrScannerRef.current) {
      const startScanning = async () => {
        try {
          await qrScannerRef.current.startScan();
        } catch (error) {
          setShowModal(false);
        }
      };
      startScanning();
    }
    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.stopScan();
      }
    };
  }, [showModal]);

  // Gom phần hiển thị barcode cho 3 size thành 1 đoạn duy nhất
  const sizeConfig = {
    small: { label: 'Kết quả (nhỏ):', color: '#198754', alertClass: 'alert-success', value: barcodeValues.small },
    medium: { label: 'Kết quả (vừa):', color: '#0dcaf0', alertClass: 'alert-info', value: barcodeValues.medium },
    large: { label: 'Kết quả (lớn):', color: '#ffc107', alertClass: 'alert-warning', value: barcodeValues.large },
  };
  const currentConfig = sizeConfig[selectedSize];

  // Hiển thị loading khi allProducts chưa load xong (style giống ProductTab)
  const isLoading = !allProducts || allProducts.length === 0;

  // Tự động cuộn tới sản phẩm mới nhất trong danh sách đã chọn
  useEffect(() => {
    if (selectedListRef.current) {
      selectedListRef.current.scrollTop = selectedListRef.current.scrollHeight;
    }
  }, [selectedBarcodes, selectedSize]);

  // Swipe gesture state for QR code
  const touchStartX = useRef(null);
  const touchEndX = useRef(null);

  // Handler for touch start
  const handleTouchStart = (e) => {
    if (e.touches && e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
    }
  };
  // Handler for touch end
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    touchEndX.current = e.changedTouches[0].clientX;
    const dx = touchEndX.current - touchStartX.current;
    // Only trigger if swipe is significant (e.g. > 40px)
    if (Math.abs(dx) > 40) {
      if (dx < 0) {
        // Swipe left: next page
        setQrPage(p => {
          const maxPage = Math.ceil((selectedBarcodes[selectedSize]?.length || 0) / 10) - 1;
          return Math.min(maxPage, p + 1);
        });
      } else {
        // Swipe right: previous page
        setQrPage(p => Math.max(0, p - 1));
      }
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  if (isLoading) {
    return (
      <div className="text-center mt-5">
        <span className="spinner-border" role="status" aria-hidden="true"></span>
        <div>Đang tải danh sách sản phẩm...</div>
      </div>
    );
  }

  // Animation helper
  const handleQrPageChange = (nextPage) => {
    if (nextPage > qrPage) setQrAnimDirection('left');
    else if (nextPage < qrPage) setQrAnimDirection('right');
    else setQrAnimDirection(null);
    setQrPage(nextPage);
    setQrAnimKey(prev => prev + 1); // force re-render for animation
  };

  return (
    <div style={{ padding: '1rem' }}>
  <MessageBox message={message} type={messageType} onClose={() => setMessage(null)} />
  
  {/* Bọc input vào một div flex để căn giữa */}
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 8
  }}>
    <div style={{
      position: 'relative',
      width: '100%',
      maxWidth: 400,
      minWidth: 200
    }}>
      <input
        type="text"
        className="form-control"
        style={{ paddingRight: '2.5rem', width: '100%' }}
        value={barcodeValues[selectedSize] || ''}
        onChange={handleBarcodeChange}
        placeholder="Nhập barcode hoặc quét..."
      />
      {barcodeValues[selectedSize] && (
        <i
          className="bi bi-x-circle-fill text-secondary position-absolute"
          style={{
            top: '50%',
            right: '0.75rem',
            transform: 'translateY(-50%)',
            cursor: 'pointer',
            fontSize: 20,
            zIndex: 2
          }}
          onClick={() => {
            setBarcodeValues(prev => ({ ...prev, [selectedSize]: '' }));
            setScanResult('');
            setItemOptions([]);
          }}
          title="Xóa barcode"
        ></i>
      )}

      {itemOptions.length > 0 && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: '100%',
          zIndex: 20,
          background: 'white',
          border: '1px solid #ccc',
          borderRadius: 4,
          maxHeight: 200,
          overflowY: 'auto',
          width: '100%'
        }}>
          {itemOptions.map((item, idx) => (
            <div
              key={item.id || idx}
              style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #eee' }}
              onClick={() => handleSelectItem(item)}
            >
              <div><b>{item.item_name}</b></div>
              <div style={{ fontSize: 12, color: '#555' }}>Barcode: {item.item_barcode}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>

      {/* QRCode hiển thị tất cả barcode đã chọn của size hiện tại, tối đa 10 barcode mỗi QR, có nút chuyển trang là icon mũi tên trái/phải */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <b>
            {selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 0 &&
              (() => {
                const barcodes = selectedBarcodes[selectedSize].map(item => item.item_barcode);
                const totalPages = Math.ceil(barcodes.length / 10);
                return totalPages > 1 ? ` (Trang ${qrPage + 1}/${totalPages})` : '';
              })()
            }
          </b>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 10 && (
            <button
              className="btn btn-link p-0"
              style={{ fontSize: 28, color: '#6366f1', minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => handleQrPageChange(Math.max(0, qrPage - 1))}
              disabled={qrPage === 0}
              title="Trang trước"
            >
              <i className="bi bi-arrow-left-circle-fill"></i>
            </button>
          )}
          <div 
            style={{ background: '#fff', padding: 8, borderRadius: 8, boxShadow: '0 2px 8px #eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', width: 196, height: 196, position: 'relative' }}
            onTouchStart={e => { e.currentTarget.swipeStartX = e.touches[0].clientX; }}
            onTouchEnd={e => {
              const startX = e.currentTarget.swipeStartX;
              const endX = e.changedTouches[0].clientX;
              if (startX !== undefined) {
                const dx = endX - startX;
                if (Math.abs(dx) > 40) {
                  if (dx < 0 && selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 10 && qrPage < Math.ceil(selectedBarcodes[selectedSize].length / 10) - 1) {
                    setQrAnimDirection('left');
                    handleQrPageChange(Math.min(Math.ceil(selectedBarcodes[selectedSize].length / 10) - 1, qrPage + 1));
                  } else if (dx > 0 && selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 10 && qrPage > 0) {
                    setQrAnimDirection('right');
                    handleQrPageChange(Math.max(0, qrPage - 1));
                  }
                }
              }
            }}
            onMouseDown={e => { e.currentTarget.swipeStartX = e.clientX; }}
            onMouseUp={e => {
              const startX = e.currentTarget.swipeStartX;
              const endX = e.clientX;
              if (startX !== undefined) {
                const dx = endX - startX;
                if (Math.abs(dx) > 40) {
                  if (dx < 0 && selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 10 && qrPage < Math.ceil(selectedBarcodes[selectedSize].length / 10) - 1) {
                    setQrAnimDirection('left');
                    handleQrPageChange(Math.min(Math.ceil(selectedBarcodes[selectedSize].length / 10) - 1, qrPage + 1));
                  } else if (dx > 0 && selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 10 && qrPage > 0) {
                    setQrAnimDirection('right');
                    handleQrPageChange(Math.max(0, qrPage - 1));
                  }
                }
              }
            }}
          >
            <div
              key={qrAnimKey}
              className={`qr-anim${qrAnimDirection ? ' qr-anim-' + qrAnimDirection : ''}`}
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'none' }}
            >
              <QRCodeSVG
                value={(() => {
                  if (!selectedBarcodes[selectedSize] || selectedBarcodes[selectedSize].length === 0) return '';
                  const barcodes = selectedBarcodes[selectedSize].map(item => item.item_barcode);
                  const currentBarcodes = barcodes.slice(qrPage * 10, (qrPage + 1) * 10);
                  return currentBarcodes.join(',');
                })()}
                size={180}
                bgColor="#fff"
                fgColor="#222"
                level="M"
                includeMargin={true}
              />
            </div>
            <style>{`
              .qr-anim {
                opacity: 1;
                transition: transform 0.35s cubic-bezier(.4,2,.6,1), opacity 0.25s;
              }
              .qr-anim-left {
                animation: qr-slide-left 0.35s cubic-bezier(.4,2,.6,1);
              }
              .qr-anim-right {
                animation: qr-slide-right 0.35s cubic-bezier(.4,2,.6,1);
              }
              @keyframes qr-slide-left {
                0% { opacity: 0; transform: translateX(60px) scale(0.95); }
                100% { opacity: 1; transform: translateX(0) scale(1); }
              }
              @keyframes qr-slide-right {
                0% { opacity: 0; transform: translateX(-60px) scale(0.95); }
                100% { opacity: 1; transform: translateX(0) scale(1); }
              }
            `}</style>
          </div>
          {selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 10 && (
            <button
              className="btn btn-link p-0"
              style={{ fontSize: 28, color: '#6366f1', minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => handleQrPageChange(Math.min(Math.ceil(selectedBarcodes[selectedSize].length / 10) - 1, qrPage + 1))}
              disabled={qrPage === Math.ceil(selectedBarcodes[selectedSize].length / 10) - 1}
              title="Trang tiếp"
            >
              <i className="bi bi-arrow-right-circle-fill"></i>
            </button>
          )}
        </div>
      </div>
            {/* Thêm 3 radio button size nhỏ vừa lớn và nút quét chung 1 thẻ div, nút nằm bên trái */}
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 24 }}>
        <button className="btn btn-primary mb-3" style={{ marginBottom: 0 }} onClick={handleOpenModal}>
          Bắt đầu quét
        </button>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-check form-check-inline">
            <input className="form-check-input" type="radio" id="sizeSmall" name="sizeGroup" value="small" checked={selectedSize === 'small'} onChange={e => setSelectedSize(e.target.value)} />
            <label className="form-check-label" htmlFor="sizeSmall">nhỏ</label>
          </div>
          <div className="form-check form-check-inline">
            <input className="form-check-input" type="radio" id="sizeMedium" name="sizeGroup" value="medium" checked={selectedSize === 'medium'} onChange={e => setSelectedSize(e.target.value)} />
            <label className="form-check-label" htmlFor="sizeMedium">vừa</label>
          </div>
          <div className="form-check form-check-inline">
            <input className="form-check-input" type="radio" id="sizeLarge" name="sizeGroup" value="large" checked={selectedSize === 'large'} onChange={e => setSelectedSize(e.target.value)} />
            <label className="form-check-label" htmlFor="sizeLarge">lớn</label>
          </div>
        </div>
      </div>
{/* Hiển thị danh sách sản phẩm đã chọn chỉ cho size đang chọn, luôn hiện frame kể cả khi chưa chọn sản phẩm */}
<div style={{ margin: '16px 0', display: 'flex', justifyContent: 'center' }}>
  <div
    className="selected-list-responsive"
    ref={selectedListRef}
    style={{
      maxWidth: 400,
      width: '100%',
      maxHeight: 180,
      overflowY: 'auto',
      border: '1px solid #e1e5e9',
      borderRadius: 12,
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
      padding: '12px 16px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      position: 'relative'
    }}
  >
    <ul style={{ paddingLeft: 0, marginBottom: 0, listStyle: 'none' }}>
      {selectedBarcodes[selectedSize] && selectedBarcodes[selectedSize].length > 0 ? (
        selectedBarcodes[selectedSize].map((item, idx) => (
          <li key={item.item_barcode || idx} style={{
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            background: 'rgba(255, 255, 255, 0.8)',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(226, 232, 240, 0.5)',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(4px)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Thanh màu bên trái */}
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: 'linear-gradient(45deg, #3b82f6, #6366f1)',
              borderRadius: '0 2px 2px 0'
            }}></div>
            <div style={{ flex: 1, paddingLeft: 8, minWidth: 0 }}>
              <div style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontWeight: 600,
                display: 'block',
                color: '#1e293b',
                fontSize: 14,
                marginBottom: 4,
                minWidth: 0
              }} title={item.item_name}>
                {item.item_name}
              </div>
              <div style={{
                color: '#64748b',
                fontSize: 12,
                fontFamily: 'monospace',
                background: 'rgba(241, 245, 249, 0.8)',
                padding: '2px 6px',
                borderRadius: 4,
                display: 'inline-block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%'
              }}>
                {item.item_barcode}
              </div>
            </div>
            <button
              style={{
                background: 'linear-gradient(45deg, #ef4444, #dc2626)',
                border: 'none',
                borderRadius: '50%',
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'white',
                fontSize: 16,
                fontWeight: 'bold',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(239, 68, 68, 0.3)',
                marginLeft: 'auto',
                marginRight: 5,
                position: 'relative',
                right: 0
              }}
              title="Xóa sản phẩm này"
              onClick={() => {
                setSelectedBarcodes(prev => {
                  return {
                    ...prev,
                    [selectedSize]: prev[selectedSize].filter((_, i) => i !== idx)
                  };
                });
              }}
              onMouseEnter={e => {
                e.target.style.transform = 'scale(1.1)';
                e.target.style.boxShadow = '0 4px 8px rgba(239, 68, 68, 0.4)';
              }}
              onMouseLeave={e => {
                e.target.style.transform = 'scale(1)';
                e.target.style.boxShadow = '0 2px 4px rgba(239, 68, 68, 0.3)';
              }}
            >
              ×
            </button>
          </li>
        ))
      ) : (
        <li style={{ 
          color: '#64748b', 
          fontStyle: 'italic',
          textAlign: 'center',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8
        }}>
          <div style={{ 
            fontSize: 32, 
            opacity: 0.6,
            background: 'linear-gradient(45deg, #3b82f6, #6366f1)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            📦
          </div>
          <div style={{ fontSize: 14 }}>
            Chưa có sản phẩm nào.
          </div>
        </li>
      )}
    </ul>
    {/* Thanh cuộn tùy chỉnh và responsive */}
    <style>{`
      @media (max-width: 600px) {
        .selected-list-responsive {
          max-width: 98vw !important;
          padding: 8px 2vw !important;
          border-radius: 8px !important;
        }
        .selected-list-responsive ul > li > div[style*='font-weight: 600'] {
          font-size: 13px !important;
        }
      }
      @media (max-width: 400px) {
        .selected-list-responsive {
          padding: 4px 1vw !important;
        }
        .selected-list-responsive ul > li > div[style*='font-weight: 600'] {
          font-size: 12px !important;
        }
      }
      .selected-list-responsive::-webkit-scrollbar {
        width: 6px;
      }
      .selected-list-responsive::-webkit-scrollbar-track {
        background: rgba(241, 245, 249, 0.5);
        border-radius: 3px;
      }
      .selected-list-responsive::-webkit-scrollbar-thumb {
        background: linear-gradient(45deg, #3b82f6, #6366f1);
        border-radius: 3px;
      }
      .selected-list-responsive::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(45deg, #2563eb, #4f46e5);
      }
    `}</style>
  </div>
</div>
      {showModal && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Quét mã QR</h5>
                <button type="button" className="btn-close" onClick={handleCloseModal}></button>
              </div>
              <div className="modal-body">
                <div id="qr-code-region">
                  <QrScanner
                    ref={qrScannerRef}
                    onScanSuccess={handleScanSuccess}
                    onScanError={handleScanError}
                    qrbox={250}
                    fps={10}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Đóng</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PrintTab;