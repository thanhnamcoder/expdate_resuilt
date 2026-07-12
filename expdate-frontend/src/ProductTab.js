import React, { useState, useEffect } from "react";
import config from './config.json';
import Barcode from 'react-barcode';
import { FixedSizeList as List } from 'react-window';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';

const API_URL = config.server;

export default function ProductTab({ savedState, saveState, allProducts: allProductsProp = [], isLoadingAllProducts = false, wishlistProductIds = [], onWishlistProductAdded, onWishlistProductsRemoved }) {
  const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm || "");
  const [results, setResults] = useState(savedState?.results || []);
  const [loading, setLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [currentBarcode, setCurrentBarcode] = useState(""); // barcode hiện tại
  // Lưu cache chi tiết sản phẩm theo id
  const [productCache, setProductCache] = useState(savedState?.productCache || {});
  // Track which product card is open
  const [openedProductId, setOpenedProductId] = useState(null);
  // allProducts lấy từ props, không fetch lại
  const [allProducts, setAllProducts] = useState(allProductsProp);
  // Wishlist modal state
  const [showWishlistModal, setShowWishlistModal] = useState(false);
  const [wishlistProductId, setWishlistProductId] = useState(null);
  const [wishlistName, setWishlistName] = useState("");
  const [wishlistLoading, setWishlistLoading] = useState(false);
  // Wishlist group modal state
  const [showWishlistGroupModal, setShowWishlistGroupModal] = useState(false);
  const [groupWishlists, setGroupWishlists] = useState([]); // [{wishlistname, product_ids}]
  const [selectedWishlist, setSelectedWishlist] = useState(null); // {wishlistname, product_ids}
  const [wishlistProducts, setWishlistProducts] = useState([]); // sản phẩm của wishlist được chọn
  const [wishlistProductsLoading, setWishlistProductsLoading] = useState(false);
  const [wishlistGroupLoading, setWishlistGroupLoading] = useState(false); // <--- thêm state loading cho group
  // State cho tạo mới wishlist
  const [showNewWishlistInput, setShowNewWishlistInput] = useState(false);
  const [newWishlistName, setNewWishlistName] = useState("");
  // State cho xóa wishlist
  const [deletingWishlistName, setDeletingWishlistName] = useState("");
  const [deletingProductId, setDeletingProductId] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
const handleCardClick = (productId) => {
  setSelectedProductIds(prevSelected => {
    if (prevSelected.includes(productId)) {
      return prevSelected; // Không làm gì nếu đã chọn
    } else {
      return [...prevSelected, productId]; // Thêm nếu chưa chọn
    }
  });
  fetchProductDetails(productId);
  setShowWishlistGroupModal(false);
};


  useEffect(() => {
    if (
      savedState?.searchTerm !== searchTerm ||
      JSON.stringify(savedState?.results) !== JSON.stringify(results) ||
      JSON.stringify(savedState?.productCache) !== JSON.stringify(productCache) ||
      JSON.stringify(savedState?.allProducts) !== JSON.stringify(allProducts)
    ) {
      saveState({ searchTerm, results, productCache, allProducts });
    }
  }, [searchTerm, results, productCache, allProducts]);

  // Update handleSearch to check both `message` and `error` keys in the API response
  const handleSearch = () => {
    setLoading(true);
fetch(`${API_URL}/api/product-search/?text=${encodeURIComponent(searchTerm)}`, {
  method: 'GET',
  headers: {
  }
})
  .then((res) => res.json())
  .then((data) => {
    if (data.data) {
      setResults(data.data);
    } else if (data.message || data.error) {
      if (navigator.vibrate) navigator.vibrate(200);
      window.alert(data.message || data.error);
      setResults([]);
    } else {
      setResults([]);
    }
  })
      .catch((err) => {
        console.error("Error fetching search results:", err);
        if (navigator.vibrate) navigator.vibrate(200);
        window.alert("An unexpected error occurred.");
        setResults([]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const fetchProductDetails = (id) => {
    // Nếu đã có cache thì dùng luôn
    if (productCache[id]) {
      setSelectedProduct(productCache[id]);
      setCurrentBarcode(productCache[id].item_barcode || "");
      setOpenedProductId((prev) => {
        if (prev && Array.isArray(prev)) {
          return prev.includes(id) ? prev : [...prev, id];
        } else if (prev) {
          return prev === id ? [id] : [prev, id];
        } else {
          return [id];
        }
      }); // Mark as opened (multi)
      return;
    }
    setLoading(true);
    setSelectedProduct({});
    setOpenedProductId((prev) => {
      if (prev && Array.isArray(prev)) {
        return prev.includes(id) ? prev : [...prev, id];
      } else if (prev) {
        return prev === id ? [id] : [prev, id];
      } else {
        return [id];
      }
    }); // Mark as opened (multi)
    fetch(`${API_URL}/api/product-detail/${id}/`, {
      method: 'GET',
      headers: {
      }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          setSelectedProduct(data.data);
          setCurrentBarcode(data.data.item_barcode || "");
          setProductCache(prev => ({ ...prev, [id]: data.data })); // Lưu cache
        } else {
          console.error("No product data found in response");
          setSelectedProduct(null);
        }
      })
      .catch((err) => {
        console.error("Error fetching product details:", err);
        setSelectedProduct(null);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Khi allProductsProp thay đổi (từ App.js), cập nhật local state
  useEffect(() => {
    setAllProducts(allProductsProp);
    if (searchTerm.trim() === "") {
      setResults(allProductsProp);
    }
  }, [allProductsProp]);

  // Khi searchTerm thay đổi, lọc local
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setResults(allProducts);
      return;
    }
    // Lọc local ngay lập tức thay vì gọi API
    const normalized = searchTerm.trim().toLowerCase();
    const searchWords = normalized.split(" ");
    const filtered = allProducts.filter(product => {
      const name = (product.item_name || "").toLowerCase();
      const barcode = (product.item_barcode || "").toLowerCase();
      const code = (product.item_code || "").toLowerCase();
      // Tìm theo tên (tất cả từ phải có trong tên), hoặc barcode/code chứa toàn bộ chuỗi search
      return (
        searchWords.every(word => name.includes(word)) ||
        barcode.includes(normalized) ||
        code.includes(normalized)
      );
    });
    setResults(filtered);
  }, [searchTerm, allProducts]);

  // Sửa handleCreateWishlist để chỉ gửi wishlistName đã chọn, không tạo mới
  const handleCreateWishlist = () => {
    if (!wishlistName) {
      if (navigator.vibrate) navigator.vibrate(200);
      window.alert("Vui lòng chọn wishlist");
      return;
    }
    setWishlistLoading(true);
    fetch(`${API_URL}/api/accounts/wishlist/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
      },
      body: JSON.stringify({
        wishlistname: wishlistName,
        product_id: wishlistProductId
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.message) {
          setShowWishlistModal(false);
          if (data.id_product && onWishlistProductAdded) {
            onWishlistProductAdded(data.id_product);
          }
        } else {
          if (navigator.vibrate) navigator.vibrate(200);
          window.alert(data.error || "Có lỗi khi thêm vào wishlist");
        }
      })
      .catch(() => {
        if (navigator.vibrate) navigator.vibrate(200);
        window.alert("Có lỗi khi thêm vào wishlist");
      })
      .finally(() => setWishlistLoading(false));
  };

  // Hàm tạo mới wishlist và thêm sản phẩm vào đó
  const handleCreateNewWishlist = () => {
    if (!newWishlistName.trim()) {
      if (navigator.vibrate) navigator.vibrate(200);
      window.alert("Vui lòng nhập tên wishlist mới");
      return;
    }
    setWishlistLoading(true);
    fetch(`${API_URL}/api/accounts/wishlist/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
      },
      body: JSON.stringify({
        wishlistname: newWishlistName.trim(),
        product_id: wishlistProductId
      })
    })
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 201 && data.message) {
          setShowWishlistModal(false);
          setShowNewWishlistInput(false);
          setNewWishlistName("");
          if (data.id_product && onWishlistProductAdded) {
            onWishlistProductAdded(data.id_product);
          }
        } else {
          if (navigator.vibrate) navigator.vibrate(200);
          window.alert(data.error || "Có lỗi khi tạo wishlist");
        }
      })
      .catch(() => {
        if (navigator.vibrate) navigator.vibrate(200);
        window.alert("Có lỗi khi tạo wishlist");
      })
      .finally(() => setWishlistLoading(false));
  };


  // Lấy danh sách wishlist group khi mở modal
  const handleOpenWishlistGroup = () => {
    setShowWishlistGroupModal(true);
    setSelectedWishlist(null);
    setWishlistProducts([]);
    setWishlistProductsLoading(false);
    setWishlistGroupLoading(true); // <--- bật loading
    fetch(`${API_URL}/api/accounts/group-wishlist/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
      }
    })
      .then(res => res.json())
      .then(data => {
        if (data.wishlist) setGroupWishlists(data.wishlist);
        else setGroupWishlists([]);
      })
      .catch(() => setGroupWishlists([]))
      .finally(() => setWishlistGroupLoading(false)); // <--- tắt loading
  };

  // Khi chọn wishlistname, lấy danh sách sản phẩm
  const handleSelectWishlist = (wishlist) => {
    setSelectedWishlist(wishlist);
    setWishlistProductsLoading(true);
    // Gọi API mới để lấy product_ids
    fetch(`${API_URL}/api/accounts/wishlist-products/?wishlistname=${encodeURIComponent(wishlist.wishlistname)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
      }
    })
      .then(res => res.json())
      .then(data => {
        const ids = data.product_ids || [];
        // Lấy chi tiết sản phẩm theo id_product
        return Promise.all(
          ids.map(id =>
            fetch(`${API_URL}/api/product-detail/${id}/`, {
              method: 'GET',
            })
              .then(res => res.json())
              .then(data => data.data)
          )
        );
      })
      .then(products => {
        setWishlistProducts(products.filter(Boolean));
      })
      .finally(() => setWishlistProductsLoading(false));
  };

  // Khi mở modal wishlist, luôn fetch lại groupWishlists nếu chưa có
  const handleOpenWishlistModal = (productId) => {
    setWishlistProductId(productId);
    setShowWishlistModal(true);
    setWishlistName("");
    setShowNewWishlistInput(false);
    setNewWishlistName("");
    if (groupWishlists.length === 0) {
      fetch(`${API_URL}/api/accounts/group-wishlist/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
        }
      })
        .then(res => res.json())
        .then(data => {
          if (data.wishlist) setGroupWishlists(data.wishlist);
          else setGroupWishlists([]);
        })
        .catch(() => setGroupWishlists([]));
    }
  };

  // Thêm hàm xóa toàn bộ wishlist theo tên
  const handleDeleteWishlist = (wishlistname) => {
    // Cho phép xóa wishlist kể cả khi không có sản phẩm nào
    if (!window.confirm(`Bạn có chắc chắn muốn xóa wishlist "${wishlistname}"?`)) return;
    setDeletingWishlistName(wishlistname);
    fetch(`${API_URL}/api/accounts/wishlist/`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
      },
      body: JSON.stringify({ wishlistname })
    })
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200 && data.message) {
          if (Array.isArray(data.product_ids) && onWishlistProductsRemoved) {
            onWishlistProductsRemoved(data.product_ids);
          }
          // Xóa wishlist khỏi groupWishlists bằng id nếu trả về
          if (data.id) {
            setGroupWishlists(prev => prev.filter(w => w.id !== data.id));
          }
          setDeletingWishlistName("");
        } else {
          if (navigator.vibrate) navigator.vibrate(200);
          window.alert(data.error || 'Có lỗi khi xóa wishlist');
          setDeletingWishlistName("");
        }
      })
      .catch(() => {
        if (navigator.vibrate) navigator.vibrate(200);
        window.alert('Có lỗi khi xóa wishlist');
        setDeletingWishlistName("");
      });
  };

  // Xóa 1 sản phẩm khỏi wishlist nhóm
  const handleDeleteProductFromWishlist = (wishlistname, productId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa sản phẩm này khỏi wishlist?')) return;
    setDeletingProductId(productId);
    fetch(`${API_URL}/api/accounts/wishlist/`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
      },
      body: JSON.stringify({ wishlistname, product_id: productId })
    })
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status === 200 && data.message) {
          setWishlistProducts(prev => prev.filter(p => p.id !== productId));
          if (Array.isArray(data.product_ids) && onWishlistProductsRemoved) {
            onWishlistProductsRemoved(data.product_ids);
          } else if (onWishlistProductsRemoved) {
            onWishlistProductsRemoved([productId]);
          }
          setDeletingProductId(null);
        } else {
          if (navigator.vibrate) navigator.vibrate(200);
          window.alert(data.error || 'Có lỗi khi xóa sản phẩm khỏi wishlist');
          setDeletingProductId(null);
        }
      })
      .catch(() => {
        if (navigator.vibrate) navigator.vibrate(200);
        window.alert('Có lỗi khi xóa sản phẩm khỏi wishlist');
        setDeletingProductId(null);
      });
  };

  // Loading overlay khi đang load allProducts từ App.js
  if (isLoadingAllProducts) {
    return (
      <div className="text-center mt-5">
        <span className="spinner-border" role="status" aria-hidden="true"></span>
        <div>Đang tải danh sách sản phẩm...</div>
      </div>
    );
  }

  return (
    <div className="container my-4" style={{ maxWidth: 1200, overflowY: 'auto', height: 'calc(100dvh - 100px)' }}>
      <div className="input-group mb-3" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'white', padding: '10px 0', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            className="form-control"
            placeholder="Enter product name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch();
              }
            }}
            style={{ paddingRight: '2.5rem' }}
          />
          {searchTerm && (
            <i
              className="bi bi-x-circle-fill text-secondary position-absolute"
              style={{
                top: '50%',
                right: '0.75rem',
                transform: 'translateY(-50%)',
                cursor: 'pointer',
              }}
              onClick={() => {
                setSearchTerm('');
                setResults([]);
              }}
            ></i>
          )}
        </div>
        <Button
          variant="outline-info"
          size="sm"
          style={{ marginLeft: 8, minWidth: 120 }}
          onClick={handleOpenWishlistGroup}
        >
          Xem Wishlist
        </Button>
      </div>

      {loading ? (
        <div className="text-center mt-5">
          <span className="spinner-border" role="status" aria-hidden="true"></span>
        </div>
      ) : results.length > 0 ? (
        <div className="mt-4" style={{ paddingLeft: 8, paddingRight: 8 }}>
          <List
            height={600}
            itemCount={results.length}
            itemSize={80}
            width={"100%"}
          >
            {({ index, style }) => {
              const item = results[index];
              const isOpened = Array.isArray(openedProductId) ? openedProductId.includes(item.id) : openedProductId === item.id;
              return (
                <li
                  key={item.id}
                  style={{
                    ...style,
                    cursor: 'pointer',
                    background: isOpened ? '#e3f2fd' : '#fff',
                    color: isOpened ? '#1976d2' : '#222',
                    borderLeft: isOpened ? '6px solid #90caf9' : '6px solid transparent',
                    fontWeight: isOpened ? 500 : 400,
                    transition: 'all 0.2s',
                    listStyle: 'none',
                    marginBottom: 16,
                    borderRadius: 12,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
                    border: '1px solid #e0e0e0',
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  className={`list-group-item ${loading ? 'disabled' : ''}`}
                  onClick={() => !loading && fetchProductDetails(item.id)}
                  onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(25, 118, 210, 0.12)'}
                  onMouseOut={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong
                      style={{
                        fontSize: 15,
                        wordBreak: 'break-word',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.3,
                        maxWidth: '100%',
                        whiteSpace: 'normal'
                      }}
                      title={item.item_name}
                    >
                      {item.item_name}
                    </strong>
                    <div style={{ fontSize: 13, color: '#555', wordBreak: 'break-all', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Barcode: {item.item_barcode}
                    </div>
                    <div style={{ fontSize: 13, color: '#555', wordBreak: 'break-all', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Code: {item.item_code}
                    </div>
                    {isOpened && (
                      <span style={{color: '#1976d2' }}>
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    style={{ marginLeft: 12, display: wishlistProductIds.includes(item.id) ? 'none' : undefined }}
                    onClick={e => {
                      e.stopPropagation();
                      handleOpenWishlistModal(item.id);
                    }}
                  >
                    Wishlist
                  </Button>
                </li>
              );
            }}
          </List>
        </div>
      ) : (
        <p className="mt-4">No results found.</p>
      )}

      {selectedProduct && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-fullscreen m-0" style={{ width: '100vw', height: '100vh', maxWidth: '100vw' }}>
            <div className="modal-content" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {selectedProduct.item_name || "Loading..."}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setSelectedProduct(null);
                    // Nếu vừa mở từ wishlist group thì mở lại modal wishlist group
                    if (!showWishlistGroupModal && selectedWishlist) {
                      setShowWishlistGroupModal(true);
                    }
                  }}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                {loading ? null : currentBarcode && (
                  <div className="text-center mb-3">
                    <Barcode value={currentBarcode} />
                  </div>
                )}
                {loading ? (
                  <div className="text-center">
                    <span className="spinner-border" role="status" aria-hidden="true"></span>
                  </div>
                ) : selectedProduct ? (
                  <>
                    <p
                      style={{ cursor: 'pointer' }}
                      onClick={() => setCurrentBarcode(selectedProduct.item_barcode)}
                    >
                      <strong>Barcode:</strong> {selectedProduct.item_barcode}
                    </p>
                    <p
                      style={{ cursor: 'pointer' }}
                      onClick={() => setCurrentBarcode(selectedProduct.item_code)}
                    >
                      <strong>Code:</strong> {selectedProduct.item_code}
                    </p>
                    <p><strong>Department:</strong> {selectedProduct.department}</p>
                    <p><strong>Category:</strong> {selectedProduct.category}</p>
                    <p><strong>Sub Category:</strong> {selectedProduct.sub_category}</p>
                    <p><strong>Vendor Code:</strong> {selectedProduct.vendor_code}</p>
                    <p><strong>Vendor Name:</strong> {selectedProduct.vendor_name}</p>
                  </>
                ) : (
                  <p>No product details available.</p>
                )}
              </div>
              {/* modal-footer removed, chỉ giữ nút X trên header */}
            </div>
          </div>
        </div>
      )}


      {/* Wishlist Modal */}
      <Modal show={showWishlistModal} onHide={() => setShowWishlistModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Thêm vào Wishlist</Modal.Title>
          {!showNewWishlistInput && (
            <Button
              variant="link"
              className="ms-3"
              style={{ fontWeight: 600, fontSize: 16, textDecoration: 'none' }}
              onClick={() => { setShowNewWishlistInput(true); setNewWishlistName(""); }}
              disabled={wishlistLoading}
            >
              + Tạo wishlist mới
            </Button>
          )}
        </Modal.Header>
        <Modal.Body>
          {showNewWishlistInput ? (
            <>
              <div>Nhập tên wishlist mới:</div>
              <input
                type="text"
                className="form-control mt-2"
                placeholder="Tên wishlist mới..."
                value={newWishlistName}
                onChange={e => setNewWishlistName(e.target.value)}
                disabled={wishlistLoading}
              />
              <div className="mt-3 d-flex justify-content-between">
                <Button variant="secondary" onClick={() => setShowNewWishlistInput(false)} disabled={wishlistLoading}>Quay lại</Button>
                <Button variant="primary" onClick={handleCreateNewWishlist} disabled={wishlistLoading || !newWishlistName.trim()}>{wishlistLoading ? 'Đang tạo...' : 'Tạo & Thêm'}</Button>
              </div>
            </>
          ) : groupWishlists.length === 0 ? (
            <div>Không có wishlist nào. Hãy tạo wishlist nhóm trước.</div>
          ) : (
            <>
              <div>Chọn wishlist để thêm sản phẩm:</div>
              <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, marginTop: 8, padding: 4 }}>
                <ul className="list-group mt-2" style={{ marginBottom: 0 }}>
                  {groupWishlists.map((w, idx) => (
                    <li
                      key={w.wishlistname + idx}
                      className={`list-group-item list-group-item-action${wishlistName === w.wishlistname ? ' active' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setWishlistName(w.wishlistname)}
                    >
                      {w.wishlistname}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          {!showNewWishlistInput && (
            <>
              <Button variant="secondary" onClick={() => setShowWishlistModal(false)} disabled={wishlistLoading}>
                Đóng
              </Button>
              <Button variant="primary" onClick={handleCreateWishlist} disabled={wishlistLoading || !wishlistName || showNewWishlistInput}>
                {wishlistLoading ? 'Đang thêm...' : 'Thêm vào Wishlist'}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>

      {/* Wishlist Group Modal */}
      <Modal show={showWishlistGroupModal} onHide={() => {
        if (selectedWishlist) {
          setSelectedWishlist(null);
        } else {
          setShowWishlistGroupModal(false);
        }
      }} size="lg" animation={false} backdrop="static" keyboard={true}>
        <Modal.Header closeButton>
          <Modal.Title>Wishlist</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!selectedWishlist ? (
            <>
              {wishlistGroupLoading && (
                <div className="text-center my-3">
                  <span className="spinner-border" role="status" aria-hidden="true"></span>
                </div>
              )}
              {!wishlistGroupLoading && (groupWishlists.length === 0 ? (
                <div>Không có wishlist nào.</div>
              ) : (
                <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, marginTop: 8, padding: 4 }}>
                  <ul className="list-group">
                    {groupWishlists.map((w, idx) => (
                      <li
                        key={w.wishlistname + idx}
                        className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                        style={{ cursor: 'pointer', fontWeight: 500, fontSize: 16 }}
                        onClick={e => {
                          // Chỉ trigger chọn khi không bấm nút xóa
                          if (e.target.tagName !== 'BUTTON') handleSelectWishlist(w);
                        }}
                      >
                        <span>
                          {w.wishlistname} <span className="badge bg-primary ms-2">{selectedWishlist && selectedWishlist.wishlistname === w.wishlistname ? wishlistProducts.length : ''}</span>
                        </span>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          style={{ marginLeft: 8, minWidth: 70 }}
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteWishlist(w.wishlistname);
                          }}
                          disabled={!!deletingWishlistName}
                        >
                          {deletingWishlistName === w.wishlistname ? (
                            <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                          ) : null}
                          Xóa
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <>
              <h5>{selectedWishlist.wishlistname}</h5>
              {wishlistProductsLoading ? (
                <div className="text-center my-4"><span className="spinner-border"></span></div>
              ) : wishlistProducts.length === 0 ? (
                <div>Không có sản phẩm nào trong wishlist này.</div>
              ) : (
                    <div className="row">
      {wishlistProducts.map(product => (
        <div className="col-md-4 mb-3" key={product.id}>
          <div
  className="card h-100"
  style={{
    cursor: 'pointer',
    border: selectedProductIds.includes(product.id) ? '2px solid #007bff' : '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: selectedProductIds.includes(product.id) ? '#e6f0ff' : 'white',
    transition: 'all 0.3s'
  }}
            onClick={() => {
              setSelectedProductId(product.id);
              fetchProductDetails(product.id);
              setShowWishlistGroupModal(false);
              handleCardClick(product.id);
            }}
          >
            <div className="card-body">
              <h6 className="card-title" style={{ fontWeight: 600 }}>{product.item_name}</h6>
              <div style={{ fontSize: 13, color: '#555' }}>Barcode: {product.item_barcode}</div>
              <div style={{ fontSize: 13, color: '#555' }}>Code: {product.item_code}</div>
              <div style={{ fontSize: 13, color: '#555' }}>Vendor: {product.vendor_name}</div>
              <Button
                variant="outline-danger"
                size="sm"
                className="mt-2"
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteProductFromWishlist(selectedWishlist.wishlistname, product.id);
                }}
                disabled={deletingProductId === product.id}
              >
                {deletingProductId === product.id ? (
                  <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                ) : null}
                Xóa khỏi wishlist
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => {
            if (selectedWishlist) {
              setSelectedWishlist(null);
            } else {
              setShowWishlistGroupModal(false);
            }
          }}>
            Đóng
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
