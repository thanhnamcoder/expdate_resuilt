import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import config from './config.json';

import Login from './Login';
import Register from './Register';
import Home from './Home';
import TopNavbar from './components/TopNavbar';
import BottomNavbar from './components/BottomNavbar';
import DataTab from './DataTab';
import ProductTab from './ProductTab';
import PrintTab from './PrintTab';
import Data from './Data';

import { authFetch } from './utils/authFetch';
const API_URL = config.server;

// IndexedDB helpers (match Data.js)
const DB_NAME = 'expdate_products_db';
const DB_VERSION = 1;
const STORE_NAME = 'products';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllProductsFromDB() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

function putProductsToDB(products) {
  if (!products || products.length === 0) return Promise.resolve();
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    products.forEach(p => store.put(p));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function getMaxIdFromDB() {
  return getAllProductsFromDB().then(arr => {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((m, it) => (it.id > m ? it.id : m), 0);
  });
}

function ExternalRedirect({ url }) {
  useEffect(() => {
    window.location.href = url;
  }, [url]);

  return null;
}

function isJwtExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('homeTab');
  const [groupData, setGroupData] = useState(null);
  const [productTabState, setProductTabState] = useState({});
  const [printTabState, setPrintTabState] = useState({});
  const [allProducts, setAllProducts] = useState([]);
  const [wishlist, setWishlist] = useState([]); // Thêm state wishlist toàn cục
  const [isLoadingGroupData, setIsLoadingGroupData] = useState(false);
  const [isLoadingAllProducts, setIsLoadingAllProducts] = useState(false);
  const [isLoadingWishlist, setIsLoadingWishlist] = useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [isLoadingProductCosts, setIsLoadingProductCosts] = useState(false);
  const [productCostMap, setProductCostMap] = useState({});
  const [selectedCards, setSelectedCards] = useState([]); // Lưu các item_code đã bấm

  // Theo dõi các tab đã từng được mở ít nhất 1 lần. Một khi tab đã "visited",
  // component của tab đó sẽ được giữ mount vĩnh viễn (chỉ ẩn/hiện bằng CSS)
  // thay vì unmount khi chuyển sang tab khác — nhờ vậy toàn bộ state nội bộ
  // của tab đó (input đang gõ dở, dropdown gợi ý, danh sách tạm...) không bị
  // mất khi bấm qua lại giữa các tab trong lúc dùng app. Nếu load lại trang
  // (F5) thì mất như bình thường, vì đây chỉ là state trong bộ nhớ.
  const [visitedTabs, setVisitedTabs] = useState({ homeTab: true });

  useEffect(() => {
    setVisitedTabs(prev => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
  }, [activeTab]);

  const updateUserCounts = (userId, expired, soon, valid) => {
    if (!groupData || !groupData.users) return;
    const updatedUsers = groupData.users.map(u =>
      u.id === userId
        ? { ...u, expired_count: expired, soon_expire_count: soon, valid_count: valid }
        : u
    );
    setGroupData({ ...groupData, users: updatedUsers });
  };

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token && isJwtExpired(token)) {
      setIsRefreshingToken(true);
      // Nếu access token hết hạn, gọi endpoint refresh (refresh token nằm trong HttpOnly cookie)
      fetch(`${API_URL}/api/accounts/token/refresh/`, {
        method: 'POST',
        credentials: 'include',
      })
        .then(res => res.json())
        .then(data => {
          if (data.access) {
            localStorage.setItem('access_token', data.access);
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
            localStorage.removeItem('access_token');
          }
        })
        .catch(() => {
          setIsAuthenticated(false);
          localStorage.removeItem('access_token');
        })
        .finally(() => {
          setIsRefreshingToken(false);
        });
    } else {
      setIsAuthenticated(!!token);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setIsLoadingGroupData(true);
      authFetch(`${API_URL}/api/accounts/items/group/`, {
        method: 'POST',
      })
        .then(res => res.json())
        .then(data => {
          setGroupData(data);
          console.log('Group data (App):', data);
        })
        .catch(err => {
          console.error('Failed to fetch group data (App):', err);
        })
        .finally(() => {
          setIsLoadingGroupData(false);
        });

      // product costs are now included in ProductData; we'll build the map
      // when `allProducts` is fetched below instead of calling product-cost API.
    }
  }, [isAuthenticated]);

  // Incremental product sync on app mount: read local DB then ask backend for new rows
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingAllProducts(true);
      setIsLoadingWishlist(true);
      try {
        // Load wishlist in parallel
        const wishlistPromise = authFetch(`${API_URL}/api/wishlist/`, { credentials: 'include' })
          .then(async res => res.ok ? (await res.json()).map(item => item.product_code) : [] )
          .catch(() => []);

        // Incremental products fetch
        const maxId = await getMaxIdFromDB();
        const prodRes = await authFetch(`${API_URL}/api/product-search/?since=${maxId}`);
        if (prodRes.ok) {
          const json = await prodRes.json();
          const newRows = json.data || [];
          if (newRows && newRows.length) {
            await putProductsToDB(newRows);
              try { window.dispatchEvent(new CustomEvent('products-updated', { detail: { rows: newRows } })); } catch(e) {}
          }
          // Now read the full cached set to populate UI
          const cached = await getAllProductsFromDB();
          if (!cancelled) {
            cached.sort((a,b)=>a.id-b.id);
            setAllProducts(cached);
            // Build productCostMap
            const nextMap = {};
            cached.forEach(entry => {
              const code = entry?.item_code || entry?.item_code === 0 ? String(entry.item_code) : null;
              if (code) {
                nextMap[String(code)] = {
                  item_code: entry.item_code,
                  item_name: entry.item_name || entry.itemname || '',
                  unit_cost: entry.unit_cost != null ? Number(entry.unit_cost) : null,
                };
              }
            });
            setProductCostMap(nextMap);
          }
        } else {
          // Fallback: try full fetch if incremental fails (non-auth errors)
          if (prodRes.status !== 401) {
            const fullRes = await authFetch(`${API_URL}/api/product-search/?text=all`);
            if (fullRes.ok) {
              const data = await fullRes.json();
              const products = Array.isArray(data.data) ? data.data : [];
              await putProductsToDB(products);
              try { window.dispatchEvent(new CustomEvent('products-updated', { detail: { rows: products } })); } catch(e) {}
              if (!cancelled) setAllProducts(products);
              const nextMap = {};
              products.forEach(entry => {
                const code = entry?.item_code || entry?.item_code === 0 ? String(entry.item_code) : null;
                if (code) {
                  nextMap[String(code)] = {
                    item_code: entry.item_code,
                    item_name: entry.item_name || entry.itemname || '',
                    unit_cost: entry.unit_cost != null ? Number(entry.unit_cost) : null,
                  };
                }
              });
              setProductCostMap(nextMap);
            }
          }
        }

        const wl = await wishlistPromise;
        if (!cancelled) setWishlist(wl || []);
      } catch (err) {
        console.error('Product sync error (App):', err);
        setAllProducts([]);
        setWishlist([]);
      } finally {
        if (!cancelled) {
          setIsLoadingAllProducts(false);
          setIsLoadingWishlist(false);
          setIsLoadingProductCosts(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hàm toggleWishlist toàn cục
  const toggleWishlist = async (product_code) => {
    if (wishlist.includes(product_code)) {
      setWishlist(wishlist.filter(code => code !== product_code));
      await authFetch(`${API_URL}/api/wishlist/remove/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ product_code })
      });
    } else {
      setWishlist([...wishlist, product_code]);
      await authFetch(`${API_URL}/api/wishlist/add/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ product_code })
      });
    }
  };

  // Hàm toggle chọn card (chỉ thêm, không bỏ chọn)
  const toggleSelectedCard = (item_code) => {
    setSelectedCards(prev => prev.includes(item_code) ? prev : [...prev, item_code]);
  };

  // Render tất cả các tab đã từng được mở (visitedTabs), chỉ tab đang active
  // mới hiển thị (display: block), các tab còn lại vẫn nằm trong DOM nhưng
  // display: none — nhờ vậy component không unmount, giữ nguyên state.
  const renderTabs = () => (
    <>
      {visitedTabs.homeTab && (
        <div style={{ display: activeTab === 'homeTab' ? 'block' : 'none' }}>
          <Home
            setActiveTab={setActiveTab}
            onLogout={() => setIsAuthenticated(false)}
            groupData={groupData}
            setGroupData={setGroupData}
            updateUserCounts={updateUserCounts}
            allProducts={allProducts}
            isLoadingAllProducts={isLoadingAllProducts}
            productCostMap={productCostMap}
            isLoadingProductCosts={isLoadingProductCosts}
          />
        </div>
      )}
      {visitedTabs.dataTab && (
        <div style={{ display: activeTab === 'dataTab' ? 'block' : 'none' }}>
          <DataTab groupData={groupData} setGroupData={setGroupData} updateUserCounts={updateUserCounts} />
        </div>
      )}
      {visitedTabs.productTab && (
        <div style={{ display: activeTab === 'productTab' ? 'block' : 'none' }}>
          <ProductTab
            savedState={productTabState}
            saveState={(state) => setProductTabState(state)}
            allProducts={allProducts}
            isLoadingAllProducts={isLoadingAllProducts}
          />
        </div>
      )}
      {visitedTabs.printTab && (
        <div style={{ display: activeTab === 'printTab' ? 'block' : 'none' }}>
          <PrintTab
            allProducts={allProducts}
            savedState={printTabState}
            saveState={state => setPrintTabState(state)}
          />
        </div>
      )}
      {visitedTabs.allDataTab && (
        <div style={{ display: activeTab === 'allDataTab' ? 'block' : 'none' }}>
          <Data allProducts={allProducts} isLoading={isLoadingAllProducts} wishlist={wishlist} toggleWishlist={toggleWishlist} isLoadingWishlist={isLoadingWishlist} selectedCards={selectedCards} toggleSelectedCard={toggleSelectedCard} />
        </div>
      )}
    </>
  );

  return (
    <Router>
      {/* Ẩn TopNavbar khi ở productTab */}
{!(
  (activeTab === 'productTab' || activeTab === 'allDataTab') &&
  window.location.pathname === '/home'
) && (
  <TopNavbar isAuthenticated={isAuthenticated} onLogout={() => setIsAuthenticated(false)} />
)}

      {(isRefreshingToken || isLoadingGroupData) && (
        <div className="loading-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999
        }}>
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated
              ? <Navigate to="/home" replace />
              : <Login onLogin={() => setIsAuthenticated(true)} />
          }
        />
        <Route
          path="/login"
          element={
            isAuthenticated
              ? <Navigate to="/home" replace />
              : <Login onLogin={() => setIsAuthenticated(true)} />
          }
        />
        <Route path="/register" element={<Register />} />
        <Route
          path="/home"
          element={
            isAuthenticated
              ? (
                <div style={{ paddingBottom: '60px' }}>
                  {renderTabs()}
                  <BottomNavbar activeTab={activeTab} setActiveTab={setActiveTab} />
                  {/* Add button to switch to allDataTab */}
                  {/* <button
                    className="btn btn-info mt-2"
                    style={{ position: 'fixed', bottom: 70, right: 20, zIndex: 10000 }}
                    onClick={() => setActiveTab('allDataTab')}
                  >
                    Xem tất cả sản phẩm
                  </button> */}
                </div>
              )
              : <Navigate to="/" replace />
          }
        />
        <Route
  path="/admin"
  element={<ExternalRedirect url={`${API_URL}/admin`} />}
/>

        <Route
          path="*"
          element={<Navigate to="/login" replace />}
        />
      </Routes>
    </Router>
  );
}

export default App;