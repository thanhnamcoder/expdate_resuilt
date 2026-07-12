import React from 'react';
import { FixedSizeList as List } from 'react-window';
import Barcode from 'react-barcode';

function Data({ allProducts, isLoading, wishlist, toggleWishlist, isLoadingWishlist, selectedCards = [], toggleSelectedCard }) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [modalProduct, setModalProduct] = React.useState(null);
  const [showWishlist, setShowWishlist] = React.useState(false);
  const [vendorNameFilter, setVendorNameFilter] = React.useState("");

  // Tìm kiếm giống ProductTab: tách từ, tìm theo tên, barcode, code
    const filteredProducts = React.useMemo(() => {
      if (!searchTerm.trim()) return allProducts;
      const normalized = searchTerm.trim().toLowerCase();
      const searchWords = normalized.split(" ");
      return allProducts.filter(product => {
        const name = (product.item_name || "").toLowerCase();
        const barcode = (product.item_barcode || "").toLowerCase();
        const code = (product.item_code || "").toLowerCase();
        return (
          searchWords.every(word => name.includes(word)) ||
          barcode.includes(normalized) ||
          code.includes(normalized)
        );
      });
    }, [searchTerm, allProducts]);

  // Nếu đang xem wishlist thì chỉ lọc sản phẩm trong wishlist, và lọc thêm theo vendor_name nếu có nhập
  const displayProducts = React.useMemo(() => {
    let products = showWishlist
      ? filteredProducts.filter(p => wishlist.includes(p.item_code))
      : filteredProducts;
    if (showWishlist && vendorNameFilter.trim()) {
      const normalizedVendor = vendorNameFilter.trim().toLowerCase();
      products = products.filter(
        p => (p.vendor_name || "").toLowerCase().includes(normalizedVendor)
      );
    }
    return products;
  }, [showWishlist, filteredProducts, wishlist, vendorNameFilter]);

  // Lấy danh sách vendor_name duy nhất trong wishlist
  const wishlistVendors = React.useMemo(() => {
    return [
      ...new Set(
        filteredProducts
          .filter(p => wishlist.includes(p.item_code))
          .map(p => p.vendor_name || "")
          .filter(Boolean)
      ),
    ];
  }, [filteredProducts, wishlist]);

const Card = ({ index, style, allProducts: products = displayProducts }) => {
  const product = products[index];
  const isWish = wishlist.includes(product.item_code);
  const isSelected = selectedCards.includes(product.item_code); // Kiểm tra card này có được chọn không

  return (
    <div
      className="col-12 col-sm-6 col-lg-4 mb-4"
      style={{ ...style, display: 'flex', justifyContent: 'center' }}
      onClick={() => { setModalProduct(product); toggleSelectedCard(product.item_code); }} // Đánh dấu đã bấm card
    >
      <div
        className="card shadow-sm h-100 w-100"
        style={{
          maxWidth: 400,
          borderRadius: 12,
          cursor: 'pointer',
          backgroundColor: isSelected ? '#e3f2fd' : '',
          border: isSelected ? '2px solid #2196f3' : '',
          boxShadow: isSelected ? '0 0 8px #90caf9' : ''
        }}
      >
        <div className="card-body">
          <div className="mb-2" style={{ wordBreak: 'break-word' }}>
            <strong>Tên:</strong> <span>{product.item_name}</span>
          </div>
          <div className="mb-2" style={{ wordBreak: 'break-word' }}>
            <strong>Barcode:</strong> <span>{product.item_barcode}</span>
          </div>
          <div
            className="mb-2 d-flex justify-content-between align-items-center"
            style={{ wordBreak: 'break-word' }}
          >
            <div>
              <strong>Code:</strong> <span>{product.item_code}</span>
            </div>
            <button
              className="btn btn-link p-0"
              onClick={e => {
                e.stopPropagation();
                toggleWishlist(product.item_code);
              }}
              aria-label={isWish ? 'Bỏ khỏi wishlist' : 'Thêm vào wishlist'}
            >
              <i
                className={
                  isWish ? 'bi bi-heart-fill text-danger' : 'bi bi-heart'
                }
                style={{ fontSize: 22 }}
              ></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


  // Responsive: card width 100% on mobile, 48% on tablet, 32% on desktop
  function getCardWidth() {
    if (window.innerWidth < 600) return '100%';
    if (window.innerWidth < 900) return '48%';
    return '32%';
  }

  // Responsive: update list width on resize
  const [listWidth, setListWidth] = React.useState(() => Math.min(window.innerWidth - 32, 900));
  const [listHeight, setListHeight] = React.useState(() => Math.max(Math.min(window.innerHeight - 180, 600), 300));
  React.useEffect(() => {
    const handleResize = () => {
      setListWidth(Math.min(window.innerWidth - 32, 900));
      setListHeight(Math.max(Math.min(window.innerHeight - 180, 600), 300));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="container mt-4">
      <div className="row justify-content-center mb-3">
        <div className="col-12 col-md-8 col-lg-6">
          <div className="d-flex align-items-center mb-2">
            <div className="flex-grow-1 position-relative">
              <input
                type="text"
                className="form-control"
                placeholder="Nhập tên, barcode hoặc code sản phẩm..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearchTerm(''); }}
              />
              {searchTerm && (
                <button
                  className="btn btn-outline-secondary position-absolute end-0 top-50 translate-middle-y"
                  type="button"
                  onClick={() => setSearchTerm("")}
                  tabIndex={-1}
                  style={{ right: 8 }}
                >
                  <i className="bi bi-x-circle"></i>
                </button>
              )}
            </div>
            <div className="d-flex align-items-center ms-2">
              <button
                className={showWishlist ? 'btn btn-danger btn-sm' : 'btn btn-outline-danger btn-sm'}
                onClick={() => setShowWishlist(v => !v)}
                disabled={isLoadingWishlist}
              >
                <i className="bi bi-heart-fill me-1"></i>
                {showWishlist ? 'Hiện tất cả' : 'Xem wishlist'}
              </button>
              {isLoadingWishlist && <span className="ms-2 spinner-border spinner-border-sm"></span>}
            </div>
          </div>
          {showWishlist && (
          <div className="w-100 mt-2">
            <select
              className="form-select w-100"
              value={vendorNameFilter}
              onChange={e => setVendorNameFilter(e.target.value)}
            >
              <option value="">Tất cả vendor</option>
              {wishlistVendors.map(vendor => (
                <option key={vendor} value={vendor} title={vendor}>{vendor}</option>
              ))}
            </select>
          </div>
        )}
        </div>
      </div>
      {isLoading ? (
        <div className="text-center my-4">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : (
        <div className="row justify-content-center" style={{ width: '100%', maxWidth: 900, margin: '0 auto', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          {displayProducts.length > 0 ? (
            <List
              height={listHeight}
              itemCount={displayProducts.length}
              itemSize={window.innerWidth < 600 ? 140 : 130}
              width={listWidth}
              style={{ overflowX: 'hidden' }}
            >
              {({ index, style }) => <Card index={index} style={style} allProducts={displayProducts} />}
            </List>
          ) : (
            <div className="text-center mt-4">Không có sản phẩm nào.</div>
          )}
        </div>
      )}
      {/* Modal hiển thị chi tiết sản phẩm */}
      {modalProduct && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 500 }}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Thông tin sản phẩm</h5>
                <button type="button" className="btn-close" onClick={() => setModalProduct(null)}></button>
              </div>
              <div className="modal-body">
                {/* Hiển thị hình barcode nếu có item_barcode ở trên đầu */}
{modalProduct.item_barcode && (
  <div className="mb-3 text-center">
    <Barcode
      value={modalProduct.item_barcode}
      height={80}
      width={2}
      displayValue={false} // ẩn giá trị mặc định
      background="#fff"
    />
    <div style={{ marginTop: 6, fontSize: 14 }}>{modalProduct.item_barcode}</div>
  </div>
)}

                <div className="d-flex justify-content-end mb-2">
                  <button
                    className="btn btn-link p-0"
                    style={{ top: 0, right: 0, zIndex: 2 }}
                    onClick={e => { e.stopPropagation(); toggleWishlist(modalProduct.item_code); }}
                    aria-label={wishlist.includes(modalProduct.item_code) ? 'Bỏ khỏi wishlist' : 'Thêm vào wishlist'}
                  >
                    <i className={wishlist.includes(modalProduct.item_code) ? 'bi bi-heart-fill text-danger' : 'bi bi-heart'} style={{ fontSize: 28 }}></i>
                  </button>
                </div>
                {Object.entries(modalProduct).map(([key, value]) => (
                  <div key={key} className="mb-2">
                    <strong>{key}:</strong> <span>{String(value)}</span>
                  </div>
                ))}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setModalProduct(null)}>Đóng</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Data;
