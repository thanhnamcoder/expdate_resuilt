// src/Home.js
import React, { useRef, useState, useEffect, useCallback } from 'react';
import ProductSuggestions from './components/ProductSuggestions';
import { FixedSizeList as List } from 'react-window';
import './Home.css';

import QrScanner from './QrScanner';
import MessageBox from './components/MessageBox';
import { getMissingFieldsMessage, getServerErrorMessage } from './utils/errorMessages';
import debounce from 'lodash.debounce';
import { authFetch } from './utils/authFetch';
import { mergeWoPendingItems, aggregateWoPayload } from './utils/woHelpers';
import { getFieldErrorMap } from './utils/formValidation';
import config from './config.json';

const API_URL = config.server;
// Utility: convert date to DD/MM/YYYY
function toDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  if (dateStr instanceof Date) {
    const d = dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d)) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return dateStr;
}

function Home({ groupData, setGroupData, updateUserCounts, allProducts = [], isLoadingAllProducts = false, productCostMap = {}, isLoadingProductCosts = false }) {
  const qrScannerRef = useRef(null);
  const cancelImagesInputRef = useRef(null);
  const [scanResult, setScanResult] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('success');
  const [loading, setLoading] = useState(false);
  const [itemOptions, setItemOptions] = useState([]);
  // Mode selector: date / stocktake / cancel. Persisted in localStorage so it survives reloads.
  const [stocktakeMode, setStocktakeMode] = useState(() => {
    try {
      const saved = localStorage.getItem('stocktakeMode');
      if (saved === 'stocktake' || saved === 'cancel') return saved;
      if (saved === 'true') return 'stocktake';
      if (saved === 'false' || saved === null || saved === '') return 'date';
      return 'date';
    } catch (e) {
      return 'date';
    }
  });
  const [cancelImages, setCancelImages] = useState([]);
  const isStocktakeLikeMode = stocktakeMode !== 'date';
  const isWoMode = stocktakeMode === 'cancel';
  useEffect(() => {
    try {
      localStorage.setItem('stocktakeMode', stocktakeMode);
    } catch (e) {
      // ignore localStorage errors (e.g., in some privacy modes)
    }
  }, [stocktakeMode]);

  // When entering a non-date mode, close duration modal and reset expiry method.
  useEffect(() => {
    if (stocktakeMode !== 'date') {
      setShowDurationModal(false);
      setExpiryMethod('direct');
      try {
        const el = document.getElementById('expDateInput');
        if (el) el.value = '';
      } catch (e) {
        // ignore DOM access errors
      }
    }
  }, [stocktakeMode]);
  const [currentPage, setCurrentPage] = useState(1);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [expiryMethod, setExpiryMethod] = useState('direct');
  const [durationType, setDurationType] = useState('months');
  const [calculatedExpiry, setCalculatedExpiry] = useState('');
  const [mfgDate, setMfgDate] = useState({ day: '', month: '', year: '' });
  const [selectedItemCode, setSelectedItemCode] = useState('');
  const abortControllerRef = useRef(null);
  const [userItems, setUserItems] = useState([]);
  const [userItemLoading, setUserItemLoading] = useState(false);
  const [userItemError, setUserItemError] = useState(null);
  const userItemAbortRef = useRef(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ itemname: '', barcode: '', quantity: '', expdate: '', item_code: '', unit_cost: null, stocktake: false });
  const [editSaving, setEditSaving] = useState(false);
  const [woName, setWoName] = useState('');
  const [showWoNameModal, setShowWoNameModal] = useState(false);
const [woNameDraft, setWoNameDraft] = useState('');
  const [showOptionalSaveButton, setShowOptionalSaveButton] = useState(false);
  const [pendingWoItems, setPendingWoItems] = useState([]);
  const [selectedItemCost, setSelectedItemCost] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Helper: normalize text for search (remove diacritics, lowercase, collapse punctuation)
  const normalizeForSearch = (s) => {
    if (!s && s !== 0) return '';
    try {
      // remove diacritics, to lower, and replace non-word/digit with space
      return String(s)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\w\d]+/gu, ' ')
        .toLowerCase()
        .trim();
    } catch (e) {
      // Fallback for environments without Unicode property escapes
      return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\d]+/g, ' ')
        .toLowerCase()
        .trim();
    }
  };

  const tokenize = (s) => (normalizeForSearch(s) || '').split(/\s+/).filter(Boolean);

  // Tạo các options cho dropdown
  const generateYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear - 1; i <= currentYear + 5; i++) {
      years.push(i);
    }
    return years;
  };

  const generateMonthOptions = () => {
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: `Tháng ${i + 1}`,
      displayValue: String(i + 1).padStart(2, '0')
    }));
  };

  const generateDayOptions = (month, year) => {
    if (!month || !year) return Array.from({ length: 31 }, (_, i) => i + 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  };

  // Tính toán ngày hết hạn
  const calculateExpiryDate = (newMfgDate = mfgDate, newDuration = null, newDurationType = durationType) => {
    const duration = newDuration ?? parseInt(document.getElementById('durationInput')?.value);
    
    if (!newMfgDate.day || !newMfgDate.month || !newMfgDate.year || !duration) {
      setCalculatedExpiry('');
      return;
    }

    const date = new Date(newMfgDate.year, newMfgDate.month - 1, newMfgDate.day);
    
    if (newDurationType === 'months') {
      date.setMonth(date.getMonth() + duration);
    } else {
      date.setDate(date.getDate() + duration);
    }
    
    setCalculatedExpiry(toDDMMYYYY(date));
  };

  // Xử lý thay đổi ngày sản xuất
  const handleMfgDateChange = (field, value) => {
    const newMfgDate = { ...mfgDate, [field]: value };
    setMfgDate(newMfgDate);
    calculateExpiryDate(newMfgDate);
  };

  // Xử lý thay đổi thời hạn
  const handleDurationChange = (e) => {
    const duration = parseInt(e.target.value);
    calculateExpiryDate(mfgDate, duration);
  };

  // Xử lý thay đổi loại thời hạn
  const handleDurationTypeChange = (e) => {
    const newDurationType = e.target.value;
    setDurationType(newDurationType);
    calculateExpiryDate(mfgDate, null, newDurationType);
  };

  const fetchItemCost = async (itemCode) => {
    if (!itemCode) {
      setSelectedItemCost(null);
      return;
    }

    const normalizedCode = String(itemCode);
    const cachedMeta = productCostMap?.[normalizedCode];
    if (cachedMeta) {
      setSelectedItemCost(cachedMeta.unit_cost ?? null);
      return;
    }

    setSelectedItemCost(null);
    try {
      const response = await fetch(`${API_URL}/api/accounts/product-cost/${itemCode}/`);
      if (response.ok) {
        const data = await response.json();
        setSelectedItemCost(data.unit_cost ?? null);
      } else {
        setSelectedItemCost(null);
      }
    } catch (error) {
      console.error('Error fetching cost:', error);
      setSelectedItemCost(null);
    }
  };

const handleSelectItem = async (item) => {
  const itemCode = item.item_code || '';
  const cachedMeta = productCostMap?.[String(itemCode)] || null;
  document.getElementById('itemNameInput').value = cachedMeta?.item_name || item.item_name || '';
  document.getElementById('itemBarcodeInput').value = item.item_barcode; // dùng item_barcode
  setScanResult(item.item_barcode);
  setSelectedItemCode(itemCode);
  setItemOptions([]);

  await fetchItemCost(itemCode);
  
  // Focus quantity input so user can type amount immediately
  setTimeout(() => {
    try {
      const q = document.getElementById('quantityInput');
      if (q) {
        q.focus();
        if (typeof q.select === 'function') q.select();
      }
    } catch (e) {
      // ignore
    }
  }, 0);
};
  // Open edit modal and populate form
  const handleEditUserItem = (it) => {
    try {
      const expdateIso = (() => {
        if (!it.expdate) return '';
        // if it's dd/mm/yyyy -> convert to yyyy-mm-dd
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(it.expdate)) {
          const [d, m, y] = String(it.expdate).split('/');
          return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(it.expdate)) return it.expdate;
        // fallback parse
        const dt = new Date(it.expdate);
        if (!isNaN(dt)) {
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const d = String(dt.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        return '';
      })();

      setEditForm({
        itemname: it.itemname || it.item_name || '',
        barcode: it.barcode || it.item_barcode || '',
        quantity: it.quantity || '',
        expdate: expdateIso,
        item_code: it.item_code || '',
        unit_cost: it.unit_cost !== undefined ? it.unit_cost : (it.unit_cost === null ? null : null),
        stocktake: !!it.stocktake,
      });
      setEditingItemId(it.id);
      setShowEditModal(true);
      setTimeout(() => {
        try { const q = document.getElementById('editQuantityInput'); if (q) { q.focus(); q.select(); } } catch(e){}
      }, 0);
    } catch (e) {
      // ignore
    }
  };

  const handleDeleteUserItem = async (itemId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) return;
    try {
      const res = await authFetch(`${API_URL}/api/accounts/items/${itemId}/delete/`, { method: 'DELETE' });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        showMessage(getServerErrorMessage(data, 'Xóa thất bại.'), 'error');
        return;
      }
      setUserItems(prev => prev.filter(i => i.id !== itemId));
      showMessage('Xóa sản phẩm thành công');
    } catch (e) {
      console.error(e);
      showMessage('Lỗi khi xóa sản phẩm. Vui lòng kiểm tra kết nối mạng và thử lại.', 'error');
    }
  };

  const handleEditChange = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    if (!editingItemId) return;
    setEditSaving(true);
    try {
      const accessToken = localStorage.getItem('access_token');
      const payload = {
        itemname: editForm.itemname,
        barcode: editForm.barcode,
        quantity: editForm.quantity,
        expdate: toDDMMYYYY(editForm.expdate),
        item_code: editForm.item_code,
        unit_cost: editForm.unit_cost,
        stocktake: !!editForm.stocktake,
      };

      const res = await authFetch(`${API_URL}/api/accounts/items/${editingItemId}/update/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to update item');
      // Prefer server-provided item (includes created_at). Fall back to payload+existing.
      const serverItem = (data && (data.item || data.data)) ? (data.item || data.data) : null;
      const existing = userItems.find(i => String(i.id) === String(editingItemId)) || {};
      let updatedItem = serverItem ? { ...existing, ...serverItem } : { ...existing, ...payload, id: editingItemId };
      // Ensure id is present for normalization
      if (!updatedItem.id) updatedItem.id = updatedItem.iid || editingItemId;
      updatedItem = normalizeServerItem(updatedItem, 'accounts');
      setUserItems(prev => prev.map(i => i.id === editingItemId ? updatedItem : i));

      // Update global cache using the server item when available
      if (window._userItemsCache) {
        for (const key of Object.keys(window._userItemsCache)) {
          const cache = window._userItemsCache[key];
          if (cache && cache.items) {
            window._userItemsCache[key] = {
              ...cache,
              items: cache.items.map(it => it.id === editingItemId ? updatedItem : normalizeServerItem(it, 'accounts')),
            };
          }
        }
      }

      showMessage('Cập nhật sản phẩm thành công!');
      setShowEditModal(false);
      setEditingItemId(null);
    } catch (err) {
      console.error('Edit save error:', err);
      showMessage(err.message || 'Lỗi khi cập nhật sản phẩm', 'error');
    } finally {
      setEditSaving(false);
    }
  };
  // Việc tự tắt (chỉ áp dụng cho type khác 'error') và việc tắt khi bấm nút
  // đều do component MessageBox tự quản lý, showMessage chỉ cần set nội dung.
  const showMessage = (msg, type = 'success') => {
    setMessage(msg);
    setMessageType(type);
  };

  const handleScanSuccess = (decodedText) => {
    console.log('[scan debug] handleScanSuccess', { decodedText });
    setScanResult(decodedText);
    debouncedFetchItem(decodedText, true); // isScan = true for scan
    setShowModal(false); // Close modal
    // After closing modal, move focus to quantity input so user can type quantity immediately
    // Use a small timeout to ensure modal DOM has been removed
    setTimeout(() => {
      try {
        const el = document.getElementById('quantityInput');
        if (el) {
          el.focus();
          if (typeof el.select === 'function') el.select();
        }
      } catch (e) {
        // ignore DOM access errors
      }
    }, 100);
  };
const debouncedFetchItem = useCallback(
  debounce(async (barcode, isScan = false) => {
    console.log('[scan debug] debouncedFetchItem start', { barcode, isScan, allProductsCount: allProducts?.length || 0 });
    if (!barcode) {
      try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
      setItemOptions([]);
      return;
    }

    // If we have allProducts loaded, use it for lookup and skip network calls
    if (allProducts && allProducts.length > 0) {
      setLoading(true);
      try {
        // Exact barcode/code matches first (exact string equality)
        const exactMatches = allProducts.filter(p => String(p.item_barcode) === String(barcode) || String(p.item_code) === String(barcode));

        if (exactMatches.length === 1) {
          const item = exactMatches[0];
          console.log('[scan debug] exact match from allProducts', item);
          if (isScan) {
            const itemCode = item.item_code || '';
            const cachedMeta = productCostMap?.[String(itemCode)] || null;
            try { document.getElementById('itemNameInput').value = cachedMeta?.item_name || item.item_name || ''; } catch (e) {}
            try { document.getElementById('itemBarcodeInput').value = item.item_barcode; } catch (e) {}
            setSelectedItemCode(itemCode);
            setItemOptions([]);
            await fetchItemCost(itemCode);
          } else {
            try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
            setItemOptions([item]);
            setCurrentPage(1);
          }
        } else if (exactMatches.length > 1) {
          try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
          setItemOptions(exactMatches);
          setCurrentPage(1);
        } else {
          // Tokenized, diacritic-insensitive fuzzy search across name, barcode, and code
          const tokens = tokenize(barcode);
          const fuzzy = allProducts.filter(p => {
            const nameNorm = normalizeForSearch(p.item_name || '');
            const barcodeNorm = normalizeForSearch(p.item_barcode || '');
            const codeNorm = normalizeForSearch(p.item_code || '');
            // For each token, require it to appear in at least one field
            return tokens.every(t => (
              nameNorm.includes(t) || barcodeNorm.includes(t) || codeNorm.includes(t)
            ));
          });

          if (fuzzy.length === 1 && isScan) {
            const item = fuzzy[0];
            console.log('[scan debug] fuzzy match from allProducts', item);
            const itemCode = item.item_code || '';
            const cachedMeta = productCostMap?.[String(itemCode)] || null;
            try { document.getElementById('itemNameInput').value = cachedMeta?.item_name || item.item_name || ''; } catch (e) {}
            try { document.getElementById('itemBarcodeInput').value = item.item_barcode; } catch (e) {}
            setSelectedItemCode(itemCode);
            setItemOptions([]);
            await fetchItemCost(itemCode);
          } else {
            try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
            setItemOptions(fuzzy);
            setCurrentPage(1);
          }
        }
      } catch (error) {
        console.error(error);
        showMessage('Lỗi khi tìm trong bộ nhớ sản phẩm.', 'error');
      } finally {
        setLoading(false);
      }

      return; // skip network call
    }

    // Hủy request trước đó nếu có
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setItemOptions([]); // clear options trước

    try {
      const accessToken = localStorage.getItem('access_token');
      const response = await authFetch(`${API_URL}/api/product/${barcode}/`, {
        signal: controller.signal,
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(getServerErrorMessage(errBody, 'Không lấy được dữ liệu sản phẩm từ server.'));
      }

      const { data } = await response.json();

      if (data.length === 1) {
        const item = data[0];
        console.log('[scan debug] fetched product from API', item);
        if (isScan) {
          const itemCode = item.item_code || '';
          const cachedMeta = productCostMap?.[String(itemCode)] || null;
          try { document.getElementById('itemNameInput').value = cachedMeta?.item_name || item.item_name || ''; } catch (e) {}
          try { document.getElementById('itemBarcodeInput').value = item.item_barcode; } catch (e) {}
          setSelectedItemCode(itemCode);
          setItemOptions([]);
          await fetchItemCost(itemCode);
        } else {
          try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
          setItemOptions(data);
          setCurrentPage(1);
        }
      } else if (data.length > 1) {
        try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
        setItemOptions(data);
        setCurrentPage(1);
      } else {
        try { if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = ''; } catch (e) {}
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Fetch aborted');
      } else {
        console.error(error);
        showMessage(error.message || 'Lỗi khi lấy dữ liệu sản phẩm. Vui lòng thử lại.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, 50),
  [allProducts, productCostMap]
);

// Fetch the user's item for today (by barcode). Triggered when barcode (scanResult) is present.
  const debouncedFetchUserItem = useCallback(
  debounce(async (barcode) => {
    setUserItems([]);
    setUserItemError(null);
    if (!barcode) return;

    // Cancel previous
    if (userItemAbortRef.current) userItemAbortRef.current.abort();
    const controller = new AbortController();
    userItemAbortRef.current = controller;

    setUserItemLoading(true);
    try {
      const username = localStorage.getItem('username') || '';
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`; // server friendly

      const accessToken = localStorage.getItem('access_token');
      // Attempt to fetch user's item for today. Backend query params may vary; using common pattern.
      const url = `${API_URL}/api/items/?barcode=${encodeURIComponent(barcode)}&username=${encodeURIComponent(username)}&date=${encodeURIComponent(dateStr)}`;
      const resp = await authFetch(url, {
        signal: controller.signal,
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: 'include',
      });

      if (!resp.ok) {
        // If 404 or empty, just set null
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.message || 'Không thể lấy item người dùng');
      }

      const result = await resp.json();
      // Expect result.data or result.items or array directly
      const items = result.data || result.items || result;
      // Normalize to array and ensure stable ids
      if (Array.isArray(items)) {
        setUserItems(items.map(it => normalizeServerItem(it, 'items')));
      } else if (items && typeof items === 'object' && Object.keys(items).length > 0) {
        setUserItems([normalizeServerItem(items, 'items')]);
      } else {
        setUserItems([]);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // aborted
      } else {
        console.error('Fetch user item error:', err);
        setUserItemError(err.message || 'Lỗi khi lấy item');
        setUserItems([]);
      }
    } finally {
      setUserItemLoading(false);
    }
  }, 200),
  []
);

// Helper to parse created_at timestamps like 'DD/MM/YYYY HH:MM:SS' or ISO; returns epoch ms or null
function parseCreatedAt(ts) {
  if (!ts) return null;
  // Try DD/MM/YYYY HH:MM:SS
  const m = ts.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, d, mo, y, hh, mm, ss] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
  }
  // Try ISO/compatible
  const iso = new Date(ts);
  if (!isNaN(iso)) return iso.getTime();
  return null;
}

// Ensure each server item has a stable `id` field for client-side deduplication.
// Some API responses use `iid` or `pk` instead of `id`. If none exist, fall
// back to a composite key that is stable across reloads for the same record.
function normalizeServerItem(it, source = 'generic') {
  if (!it || typeof it !== 'object') return it;
  const id = it.id || it.iid || it.pk || it.PK || it.IID;
  if (id) return { ...it, id };
  // If server provides a created timestamp, use it as a stable id so
  // distinct records (different created_at) remain separate on the client.
  const created = it.created_at || it.createdAt || '';
  if (created) {
    return { ...it, id: created };
  }
  // Fallback: build a composite key. Include `stocktake` flag to reduce
  // accidental merging of stocktake records that otherwise share identical
  // fields.
  const name = (it.itemname || it.item_name || '').trim();
  const qty = String(it.quantity || '');
  const exp = String(it.expdate || it.expire || '');
  const barcode = String(it.barcode || it.item_barcode || '');
  const stockFlag = it.stocktake ? '1' : '0';
  const composite = `composite:${created}|${name}|${qty}|${exp}|${barcode}|${stockFlag}`;
  return { ...it, id: composite };
}



const handleBarcodeChange = (e) => {
  const barcode = e.target.value;
  setScanResult(barcode);
  setFieldErrors((prev) => ({ ...prev, barcode: false }));
  debouncedFetchItem(barcode, false); // isScan = false for manual input
};
const handleEditWoName = () => {
  setWoNameDraft(woName);
  setShowWoNameModal(true);
};

const handleSaveWoNameModal = () => {
  const trimmed = woNameDraft.trim();
  if (!trimmed) {
    setWoName('');
    setShowOptionalSaveButton(false);
  } else {
    setWoName(trimmed);
  }
  setShowWoNameModal(false);
};

const handleCloseWoNameModal = () => {
  setShowWoNameModal(false);
};
const handleAddOptionalName = () => {
  if (!woName) {
    setWoNameDraft('');
    setShowWoNameModal(true);
    return;
  }
  setShowOptionalSaveButton((prev) => !prev);
};

  const handleWoDoneToggle = () => {
    if (!isWoMode) return;
    setShowOptionalSaveButton((prev) => !prev);
  };

  const resetWoForm = () => {
    if (document.getElementById('itemBarcodeInput')) document.getElementById('itemBarcodeInput').value = '';
    if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = '';
    if (document.getElementById('quantityInput')) document.getElementById('quantityInput').value = '';
    if (document.getElementById('expDateInput')) document.getElementById('expDateInput').value = '';
    setScanResult('');
    setSelectedItemCode('');
    setSelectedItemCost(null);
    setItemOptions([]);
    setCalculatedExpiry('');
    setMfgDate({ day: '', month: '', year: '' });
    setShowDurationModal(false);
    setExpiryMethod('direct');
    setFieldErrors({});
  };

  const buildWoItemData = () => {
    const barcode = (document.getElementById('itemBarcodeInput')?.value || '').trim();
    const itemname = (document.getElementById('itemNameInput')?.value || '').trim();
    const quantity = (document.getElementById('quantityInput')?.value || '').trim();
    const groupName = woName.trim();

    const missingMsg = getMissingFieldsMessage({
      Barcode: barcode,
      'Tên sản phẩm': itemname,
      'Số lượng': quantity,
    });
    if (missingMsg) {
      throw new Error(missingMsg);
    }

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const expdateRaw = `${yyyy}-${mm}-${dd}`;

    return {
      barcode,
      itemname,
      groupName,
      quantity,
      username: localStorage.getItem('username'),
      item_code: selectedItemCode,
      unit_cost: selectedItemCost,
      stocktake: false,
      writeoff: true,
    };
  };

  const handleAddWoPendingItem = () => {
    if (!isWoMode) return;
    try {
      const itemData = buildWoItemData();
      setPendingWoItems(prev => mergeWoPendingItems(prev, itemData));
      resetWoForm();
      // keep cancelImages (shared for the batch) — do not clear here
      showMessage('Đã cộng dồn số lượng vào danh sách WO');
    } catch (error) {
      const nextErrors = getFieldErrorMap({
        barcode: (document.getElementById('itemBarcodeInput')?.value || '').trim(),
        itemname: (document.getElementById('itemNameInput')?.value || '').trim(),
        quantity: (document.getElementById('quantityInput')?.value || '').trim(),
        expdate: (document.getElementById('expDateInput')?.value || '').trim(),
      }, { isWoMode: true });
      setFieldErrors(nextErrors);
      showMessage(error.message || 'Vui lòng điền đầy đủ thông tin.', 'error');
    }
  };

  const handleSubmitWoBatch = async () => {
    if (!isWoMode) return;
    if (pendingWoItems.length === 0) {
      showMessage('Chưa có mục nào để gửi.', 'error');
      return;
    }
    // Build grouped payload keyed by group name, merging duplicate barcode/name entries by quantity.
    const payload = aggregateWoPayload(pendingWoItems, woName || 'WO');

    // Require at least one shared image when submitting the batch
    if (!cancelImages || cancelImages.length === 0) {
      showMessage('WO cần có ít nhất 1 file đính kèm.', 'error');
      return;
    }

    setSubmitLoading(true);
    try {
      const accessToken = localStorage.getItem('access_token');
      const formData = new FormData();
      formData.append('payload', JSON.stringify(payload));
      cancelImages.forEach((file) => formData.append('files', file));

      const response = await authFetch(`${API_URL}/api/items/batch/`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: 'include',
        body: formData,
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getServerErrorMessage(result, 'Lưu danh sách WO thất bại.'));
      }

      // success
      const count = result.created || pendingWoItems.length;
      setPendingWoItems([]);
      setWoName('');
      setShowOptionalSaveButton(false);
      resetWoForm();
      setCancelImages([]);
      if (cancelImagesInputRef.current) {
        cancelImagesInputRef.current.value = '';
      }
      showMessage(`Đã lưu ${count} mục WO thành công!`);
    } catch (error) {
      console.error('WO batch submit error:', error);
      showMessage(error.message || 'Lỗi khi lưu danh sách WO.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitLoading(true);

    const isWriteoffMode = stocktakeMode === 'cancel';

    const barcode = (document.getElementById('itemBarcodeInput')?.value || '').trim();
    const itemname = ((document.getElementById('itemNameInput')?.value || '').trim() || (isWoMode ? woName : '')).trim();
    const quantity = (document.getElementById('quantityInput')?.value || '').trim();
    let expdateRaw = '';

    // Nếu đang ở chế độ kiểm kho hoặc hủy hàng, lấy ngày hết hạn là ngày hôm nay
    if (isStocktakeLikeMode) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      expdateRaw = `${yyyy}-${mm}-${dd}`;
    } else {
      if (expiryMethod === 'direct') {
        expdateRaw = (document.getElementById('expDateInput')?.value || '').trim();
      } else {
        if (!calculatedExpiry) {
          const durationValue = (document.getElementById('durationInput')?.value || '').trim();
          const missingMsg = getMissingFieldsMessage({
            'Ngày (sản xuất)': mfgDate.day,
            'Tháng (sản xuất)': mfgDate.month,
            'Năm (sản xuất)': mfgDate.year,
            'Thời hạn sử dụng': durationValue,
          });
          showMessage(missingMsg || 'Vui lòng điền đầy đủ thông tin ngày sản xuất và thời hạn.', 'error');
          setSubmitLoading(false);
          return;
        }
        // Chuyển đổi từ DD/MM/YYYY sang YYYY-MM-DD
        const [day, month, year] = calculatedExpiry.split('/');
        expdateRaw = `${year}-${month}-${day}`;
      }
    }

    const nextFieldErrors = getFieldErrorMap({
      barcode,
      itemname,
      quantity,
      expdate: expdateRaw,
    }, { isWoMode: isWriteoffMode });
    setFieldErrors(nextFieldErrors);

    const missingMsg = getMissingFieldsMessage({
      Barcode: barcode,
      'Tên sản phẩm': itemname,
      'Số lượng': quantity,
      ...(isWriteoffMode ? {} : { 'Hạn sử dụng': expdateRaw }),
    });
    if (missingMsg) {
      showMessage(missingMsg, 'error');
      setSubmitLoading(false);
      return;
    }

    const itemData = {
      barcode,
      itemname,
      quantity,
      username: localStorage.getItem('username'),
      item_code: selectedItemCode,
      unit_cost: selectedItemCost,
      stocktake: stocktakeMode === 'stocktake',
      writeoff: stocktakeMode === 'cancel',
      ...(isWriteoffMode ? {} : { expdate: expdateRaw.split('-').reverse().join('/') }), // include expdate only when not writeoff
    };

    if (isWriteoffMode && cancelImages.length === 0) {
      showMessage('WO cần có ít nhất 1 file đính kèm.', 'error');
      setSubmitLoading(false);
      return;
    }

    const formData = new FormData();
    Object.entries(itemData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });
    cancelImages.forEach((file) => formData.append('files', file));

    console.log('Submitting item data:', itemData);
    try {
      const accessToken = localStorage.getItem('access_token');

      if (editingItemId) {
        const response = await authFetch(`${API_URL}/api/accounts/items/${editingItemId}/update/`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify(itemData),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(getServerErrorMessage(result, 'Cập nhật sản phẩm thất bại.'));
        }

        // Prefer server-provided item (includes created_at). Fallback to payload+existing.
        const serverItem = (result && (result.item || result.data)) ? (result.item || result.data) : null;
        const existing = userItems.find(i => String(i.id) === String(editingItemId)) || {};
        let updatedItem = serverItem ? { ...existing, ...serverItem } : { ...existing, ...itemData, id: editingItemId };
        if (!updatedItem.id) updatedItem.id = updatedItem.iid || editingItemId;
        updatedItem = normalizeServerItem(updatedItem, 'accounts');
        setUserItems(prev => prev.map(i => i.id === editingItemId ? updatedItem : i));

        // Update cache if present (use server item when available)
        if (window._userItemsCache) {
          for (const key of Object.keys(window._userItemsCache)) {
            const cache = window._userItemsCache[key];
            if (cache && cache.items) {
              window._userItemsCache[key] = {
                ...cache,
                items: cache.items.map(it => it.id === editingItemId ? updatedItem : normalizeServerItem(it, 'accounts')),
              };
            }
          }
        }

        showMessage('Cập nhật sản phẩm thành công!');
        setEditingItemId(null);
      } else {
        const response = await authFetch(`${API_URL}/api/items/`, {
          method: 'POST',
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          credentials: 'include',
          body: isWriteoffMode ? formData : JSON.stringify(itemData),
          ...(isWriteoffMode ? {} : { headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})} }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(getServerErrorMessage(result, 'Lưu sản phẩm thất bại.'));
        }

        let savedItem = {
          ...result.data,
          id: result.iid,
          can_edit: true,
          can_delete: true,
        };
        savedItem = normalizeServerItem(savedItem, 'items');

        showMessage('Lưu sản phẩm thành công!');
        // Update user counts immediately after item creation
        if (updateUserCounts && result.user_id !== undefined && result.expired_count !== undefined && result.soon_expire_count !== undefined && result.valid_count !== undefined) {
          updateUserCounts(result.user_id, result.expired_count, result.soon_expire_count, result.valid_count);
        }
        // Cập nhật cache sản phẩm cho user
        if (window._userItemsCache) {
          const userId = result.user_id;
          let newItem = {
            ...result.data,
            id: result.iid,
          };
          newItem = normalizeServerItem(newItem, 'items');
          // Lưu cache dạng object để tương thích với DataTab
          if (window._userItemsCache[userId]) {
            if (window._userItemsCache[userId].items) {
              window._userItemsCache[userId] = {
                items: [newItem, ...window._userItemsCache[userId].items.map(it => normalizeServerItem(it, 'items'))],
                isPartial: true
              };
            } else {
              window._userItemsCache[userId] = {
                items: [newItem],
                isPartial: true
              };
            }
          } else {
            window._userItemsCache[userId] = {
              items: [newItem],
              isPartial: true
            };
          }
        }

        // Reset form
        if (document.getElementById('itemBarcodeInput')) document.getElementById('itemBarcodeInput').value = '';
        if (document.getElementById('itemNameInput')) document.getElementById('itemNameInput').value = '';
        if (document.getElementById('quantityInput')) document.getElementById('quantityInput').value = '';
        if (stocktakeMode === 'date') {
          if (expiryMethod === 'direct') {
            if (document.getElementById('expDateInput')) document.getElementById('expDateInput').value = '';
          } else {
            // Reset duration form
            if (document.getElementById('durationInput')) document.getElementById('durationInput').value = '';
            setMfgDate({ day: '', month: '', year: '' });
            setCalculatedExpiry('');
          }
        }
        setScanResult('');
        setItemOptions([]);
        setSelectedItemCode('');
        if (stocktakeMode === 'cancel') {
          setCancelImages([]);
        }
      }
    } catch (error) {
      console.error('Error details:', error);
      showMessage(error.message || 'Lỗi khi lưu sản phẩm. Vui lòng thử lại.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  };

  // When pressing Enter in quantity input: move focus to date input (or open duration modal)
  const handleQuantityKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    try {
      if (isWoMode && !showOptionalSaveButton) {
        const addBtn = document.getElementById('addWoItemBtn');
        if (addBtn) {
          addBtn.focus();
          return;
        }
      }

      // If stocktake mode, move to submit button so user can quickly save
      if (isStocktakeLikeMode) {
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
          submitBtn.focus();
          return;
        }
      }

      if (expiryMethod === 'direct') {
        const el = document.getElementById('expDateInput');
        if (el) {
          // ensure it's date type and focus
          try { el.type = 'date'; } catch (e) {}
          el.focus();
          // Try to open native picker when available
          try { if (typeof el.showPicker === 'function') el.showPicker(); } catch (e) {}
          return;
        }
      } else {
        // open duration modal and focus duration input
        setShowDurationModal(true);
        setTimeout(() => {
          try {
            const d = document.getElementById('durationInput');
            if (d) {
              d.focus();
              if (typeof d.select === 'function') d.select();
            }
          } catch (e) {}
        }, 150);
      }
    } catch (err) {
      // silently ignore
    }
  };

  const handleOpenModal = () => setShowModal(true);
  const handleCloseModal = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stopScan();
    }
    setShowModal(false);
    setShowDurationModal(false);
    setExpiryMethod('direct');
    // Reset các giá trị
    setMfgDate({ day: '', month: '', year: '' });
    setCalculatedExpiry('');
    if (document.getElementById('durationInput')) {
      document.getElementById('durationInput').value = '';
    }
  };
  const handleCloseSuggestions = () => {
    setItemOptions([]);
  };

  const switchModeStyles = {
    date: {
      backgroundColor: '#f3f4f6',
      borderColor: '#d1d5db',
      activeTextColor: '#111827',
      inactiveTextColor: '#6b7280',
      pageBackground: '#ffffff',
    },
    stocktake: {
      backgroundColor: '#f3f4f6',
      borderColor: '#0f7631',
      activeTextColor: '#0f7631',
      inactiveTextColor: '#6b7280',
      pageBackground: '#f2fdf8',
    },
    cancel: {
      backgroundColor: '#f3f4f6',
      borderColor: '#c20f0f',
      activeTextColor: '#c20f0f',
      inactiveTextColor: '#6b7280',
      pageBackground: '#fff6f6',
    },
  };
  const activeSwitchStyle = switchModeStyles[stocktakeMode] || switchModeStyles.date;

  // Automatically start/stop scanner on modal toggle
  useEffect(() => {
    if (showModal && qrScannerRef.current) {
      const startScanning = async () => {
        try {
          await qrScannerRef.current.startScan();
        } catch (error) {
          console.error('Failed to start scanner:', error);
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

  // When barcode (scanResult) changes, fetch the user's item for today
  useEffect(() => {
    debouncedFetchUserItem(scanResult);
    return () => {
      if (userItemAbortRef.current) userItemAbortRef.current.abort();
    };
  }, [scanResult, debouncedFetchUserItem]);

  // Xử lý khi chọn phương thức tính HSD
  const handleExpiryMethodChange = (method) => {
    setExpiryMethod(method);
    if (method === 'duration') {
      setShowDurationModal(true);
    }
  };

  // Xử lý khi đóng modal và cập nhật HSD
  const handleDurationModalClose = () => {
    if (calculatedExpiry) {
      const [day, month, year] = calculatedExpiry.split('/');
      document.getElementById('expDateInput').value = `${year}-${month}-${day}`;
    }
    handleCloseModal();
  };

  // JSX dropdown gợi ý tên sản phẩm, dùng chung cho cả 2 vị trí (thường / WO)
  const itemSuggestionsDropdown = itemOptions.length > 0 ? (
    <div style={{ position: 'absolute', left: 0, right: 0, width: '100%', zIndex: 3 }}>
      <div className="suggestions-dropdown">
        <List
          height={Math.min(360, itemOptions.length * 72)}
          itemCount={itemOptions.length}
          itemSize={72}
          width="100%"
        >
          {({ index, style }) => {
            const item = itemOptions[index];
            return (
              <button
                type="button"
                key={(item && (item.item_barcode || item.item_code || index))}
                style={{ ...style }}
                className="suggestion-item"
                onClick={() => handleSelectItem(item)}
              >
                <div className="suggestion-name fw-bold">{item.item_name}</div>
                <div className="suggestion-meta">
                  <div className="suggestion-barcode text-muted small">{item.item_barcode}</div>
                  {item.item_code ? (
                    <div className="suggestion-badge"><span className="badge bg-secondary">{item.item_code}</span></div>
                  ) : null}
                </div>
              </button>
            );
          }}
        </List>
      </div>
    </div>
  ) : null;
const totalPendingWoCost = pendingWoItems.reduce((sum, item) => {
  if (item.unit_cost === null || item.unit_cost === undefined) return sum;
  return sum + (Number(item.unit_cost) * (Number(item.quantity) || 0));
}, 0);
  return (
    <div
      className="container-fluid mt-3"
      style={{
        background: activeSwitchStyle.pageBackground,
        borderRadius: '16px',
        padding: '16px 18px',
        width: '100%',
        minHeight: 'calc(100vh - 116px)',
        transition: 'background-color 0.2s ease',
        boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.06)',
      }}
    >
      <MessageBox message={message} type={messageType} onClose={() => setMessage(null)} />

      <form className="mb-3" onSubmit={handleSubmit}>

        {/* Stocktake switch moved to the right of the Save button */}

<div className="mb-3 position-relative">
  <div className="d-flex align-items-center mb-2">
    <label htmlFor="itemBarcodeInput" className={`form-label mb-0 ${fieldErrors.barcode ? 'field-error-label' : ''}`}>
      <strong>Barcode:</strong>
    </label>
    {isWoMode ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem', flexWrap: 'wrap' }}>
        {!woName ? (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={handleAddOptionalName}
            style={{ whiteSpace: 'nowrap' }}
          >
            <i className="bi bi-plus-circle me-1"></i>
            Thêm tên
          </button>
        ) : null}
{woName ? (
  <div className="d-flex align-items-center gap-2">
    <div className="d-flex align-items-center px-2 py-1 border rounded bg-light">
      <span
        className="small fw-semibold text-dark"
        role="button"
        tabIndex={0}
        onClick={handleEditWoName}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleEditWoName();
          }
        }}
        style={{ cursor: 'pointer' }}
        title="Bấm để sửa tên"
      >
        {woName}
      </span>
    </div>
    <button
      type="button"
      className="btn btn-link p-0 border-0"
      onClick={handleWoDoneToggle}
      title={showOptionalSaveButton ? 'Ẩn nút lưu' : 'Hiện nút lưu'}
      aria-label={showOptionalSaveButton ? 'Ẩn nút lưu' : 'Hiện nút lưu'}
    >
      <i className={`bi ${showOptionalSaveButton ? 'bi-plus-circle' : 'bi-check-circle-fill'} text-success`}></i>
    </button>
  </div>
) : null}
      </div>
    ) : null}
    <div className="d-flex align-items-center gap-2 ms-auto">
      <div
        id="stocktakeSwitch"
        role="button"
        tabIndex={0}
        onClick={() => {
          const nextMode = stocktakeMode === 'date' ? 'stocktake' : stocktakeMode === 'stocktake' ? 'cancel' : 'date';
          setStocktakeMode(nextMode);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const nextMode = stocktakeMode === 'date' ? 'stocktake' : stocktakeMode === 'stocktake' ? 'cancel' : 'date';
            setStocktakeMode(nextMode);
          }
        }}
        title="Bấm vào vùng switch để chuyển tiếp, bấm vào từng mục để chọn trực tiếp"
        style={{
          width: '110px',
          height: '34px',
          borderRadius: '999px',
          backgroundColor: activeSwitchStyle.backgroundColor,
          border: `1px solid ${activeSwitchStyle.borderColor}`,
          position: 'relative',
          cursor: 'pointer',
          userSelect: 'none',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          transition: 'background-color 0.18s ease, border-color 0.18s ease',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '2px',
            left: stocktakeMode === 'date' ? '2px' : stocktakeMode === 'stocktake' ? '40px' : '78px',
            width: '42px',
            height: '30px',
            borderRadius: '999px',
            backgroundColor: 'transparent',
            boxShadow: 'none',
            transition: 'left 0.18s ease',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '0 8px', position: 'relative', zIndex: 1, fontSize: '0.72rem', fontWeight: 600 }}>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setStocktakeMode('date');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setStocktakeMode('date');
              }
            }}
            style={{ opacity: stocktakeMode === 'date' ? 1 : 0.7, color: stocktakeMode === 'date' ? activeSwitchStyle.activeTextColor : activeSwitchStyle.inactiveTextColor, cursor: 'pointer' }}
          >
            Date
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setStocktakeMode('stocktake');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setStocktakeMode('stocktake');
              }
            }}
            style={{ opacity: stocktakeMode === 'stocktake' ? 1 : 0.7, color: stocktakeMode === 'stocktake' ? activeSwitchStyle.activeTextColor : activeSwitchStyle.inactiveTextColor, cursor: 'pointer' }}
          >
            STT
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setStocktakeMode('cancel');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setStocktakeMode('cancel');
              }
            }}
            style={{ opacity: stocktakeMode === 'cancel' ? 1 : 0.7, color: stocktakeMode === 'cancel' ? activeSwitchStyle.activeTextColor : activeSwitchStyle.inactiveTextColor, cursor: 'pointer' }}
          >
            WO
          </span>
        </div>
      </div>
    </div>
  </div>
  <div className="position-relative">
    <input
      type="text"
      id="itemBarcodeInput"
      className={`form-control pe-5 ${fieldErrors.barcode ? 'field-error-input' : ''}`}
      value={scanResult}
      onChange={handleBarcodeChange}
      placeholder="Nhập mã barcode tại đây"
    />
    {scanResult && (
      <i
        className="bi bi-x-circle-fill text-secondary position-absolute"
        style={{ top: '50%', right: '10px', transform: 'translateY(-50%)', cursor: 'pointer' }}
        onClick={() => {
          setScanResult('');
          document.getElementById('itemBarcodeInput').value = '';
          document.getElementById('itemNameInput').value = '';
          setItemOptions([]);
        }}
      ></i>
    )}
    {itemSuggestionsDropdown}
  </div>

</div>

<div className="row mb-3" style={{ position: 'relative' }}>
  <div className="col-9 position-relative">
    <label htmlFor="itemNameInput" className={`form-label d-flex align-items-center ${fieldErrors.itemname ? 'field-error-label' : ''}`}>
      <strong>Tên sản phẩm:</strong>
      <span
        className={`ms-2 ${loading ? 'spinner-border spinner-border-sm text-primary' : 'invisible'}`}
        role="status"
        aria-hidden="true"
        style={{ width: '1rem', height: '1rem' }}
      />
    </label>

    <div className="position-relative">
      <input
        type="text"
        id="itemNameInput"
        className={`form-control pe-5 ${fieldErrors.itemname ? 'field-error-input' : ''}`}
        placeholder="Nhập tên sản phẩm"
        disabled={loading}
        onChange={() => {
          setItemOptions([]);
          setFieldErrors((prev) => ({ ...prev, itemname: false }));
        }}
      />
      {document.getElementById('itemNameInput')?.value && (
        <i
          className="bi bi-x-circle-fill text-secondary position-absolute"
          style={{ top: '50%', right: '10px', transform: 'translateY(-50%)', cursor: 'pointer' }}
          onClick={() => {
            document.getElementById('itemNameInput').value = '';
            setItemOptions([]);
          }}
        ></i>
      )}
      
    </div>


    {/* dropdown moved to be a child of the row so it can span both columns */}
  </div>

  <div className="col-3">
    <label htmlFor="quantityInput" className={`form-label ${fieldErrors.quantity ? 'field-error-label' : ''}`}><strong>SL:</strong></label>
    <input
      type="number"
      id="quantityInput"
      className={`form-control ${fieldErrors.quantity ? 'field-error-input' : ''}`}
      placeholder="SL"
      min="1"
      onKeyDown={handleQuantityKeyDown}
      onChange={() => setFieldErrors((prev) => ({ ...prev, quantity: false }))}
    />
    
  </div>
    {stocktakeMode === 'cancel' && (
    <div className="mt-2">
      <label className="form-label small mb-1"><strong>Ảnh hủy hàng:</strong></label>
      <input
        ref={cancelImagesInputRef}
        type="file"
        className="form-control form-control-sm"
        accept="image/*"
        multiple
        onChange={(e) => setCancelImages(Array.from(e.target.files || []))}
      />
      {cancelImages.length > 0 && <div className="small text-muted mt-1">Đã chọn {cancelImages.length} ảnh</div>}
    </div>
  )}
</div>

      {/* Frame to display the user's item for TODAY when barcode has value */}
      {scanResult && !isWoMode ? (
        <div className="card mb-3">
          <div className="card-body">
            {userItemLoading ? (
              <div className="d-flex align-items-center">
                <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
                <div>Đang tải...</div>
              </div>
            ) : userItemError ? (
              <div className="text-danger">{userItemError}</div>
              ) : userItems && userItems.length > 0 ? (
              <div>
                {isStocktakeLikeMode ? (
                  <div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', paddingTop: '0.5rem' }}>
                      {(() => {
                        const list = userItems.filter(i => i.stocktake);
                        // sort by created_at desc (newest first). fallback to other timestamp/id
                        const getItemTimestamp = (it) => {
                          const t1 = parseCreatedAt(it.created_at);
                          if (t1) return t1;
                          const t2 = parseCreatedAt(it.id);
                          if (t2) return t2;
                          const n = Number(it.id);
                          if (!isNaN(n) && n > 0) return n;
                          return 0;
                        };
                        list.sort((a, b) => getItemTimestamp(b) - getItemTimestamp(a));
                        if (list.length === 0) return <div className="text-muted">Không có mục nào</div>;
                        const seen = new Set();
                        const uniq = [];
                        for (const it of list) {
                          // Prefer `created_at` as the dedupe key when present so distinct
                          // records with different timestamps are not collapsed even if
                          // the generated `id` collides.
                          // Combine created_at and id to form a stable dedupe key so items
                          // with different created_at remain distinct even if one field is lost
                          const key = `${it.created_at || ''}::${it.id || ''}`;
                          if (!seen.has(key)) {
                            seen.add(key);
                            uniq.push(it);
                          }
                        }
                        return uniq.map((it, idx) => (
                          <div key={(it.id || it.created_at || `u_${idx}`)} className="border rounded p-2 mb-2">
                            <div className="d-flex justify-content-between align-items-start">
                              <div>
                                <div><strong>{it.itemname}</strong> <small className="text-muted">({it.item_code || ''})</small></div>
                                <div className="small text-muted">SL: {it.quantity} • HSD: {it.expdate}</div>
                                {it.created_at ? <div className="small text-muted">Ghi nhận: {it.created_at}</div> : null}
                              </div>
                              <div className="ms-2 d-flex flex-column gap-2">
                                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => handleEditUserItem(it)}>Sửa</button>
                                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteUserItem(it.id)}>Xóa</button>
                              </div>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', paddingTop: '0.5rem' }}>
                      {(() => {
                        const list = userItems.filter(i => !i.stocktake);
                        // sort by created_at desc (newest first). fallback to other timestamp/id
                        const getItemTimestamp2 = (it) => {
                          const t1 = parseCreatedAt(it.created_at);
                          if (t1) return t1;
                          const t2 = parseCreatedAt(it.id);
                          if (t2) return t2;
                          const n = Number(it.id);
                          if (!isNaN(n) && n > 0) return n;
                          return 0;
                        };
                        list.sort((a, b) => getItemTimestamp2(b) - getItemTimestamp2(a));
                        if (list.length === 0) return <div className="text-muted">Không có mục nào</div>;
                        const seen = new Set();
                        const uniq = [];
                        for (const it of list) {
                          // Prefer `created_at` as the dedupe key when present so distinct
                          // records with different timestamps are not collapsed even if
                          // the generated `id` collides.
                          const key = `${it.created_at || ''}::${it.id || ''}`;
                          if (!seen.has(key)) {
                            seen.add(key);
                            uniq.push(it);
                          }
                        }
                        return uniq.map((it, idx) => (
                          <div key={(it.id || it.created_at || `u_${idx}`)} className="border rounded p-2 mb-2">
                            <div className="d-flex justify-content-between align-items-start">
                              <div>
                                <div><strong>{it.itemname}</strong> <small className="text-muted">({it.item_code || ''})</small></div>
                                <div className="small text-muted">SL: {it.quantity} • HSD: {it.expdate}</div>
                                {it.created_at ? <div className="small text-muted">Ghi nhận: {it.created_at}</div> : null}
                              </div>
                              <div className="ms-2 d-flex flex-column gap-2">
                                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => handleEditUserItem(it)}>Sửa</button>
                                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteUserItem(it.id)}>Xóa</button>
                              </div>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-muted">Không tìm thấy mục nào cho barcode này hôm nay.</div>
            )}
          </div>
        </div>
      ) : null}

        {isWoMode && pendingWoItems.length > 0 && (
          <div className="card mb-3">
            <div className="card-body">
<div className="d-flex justify-content-between align-items-center mb-2">
  <div className="d-flex align-items-center gap-3">
    <span className="fw-semibold text-success">
Total Cost: {totalPendingWoCost.toLocaleString('vi-VN', {
  maximumFractionDigits: 0,
})} ₫    </span>
  </div>

  <span className="badge bg-primary">
    {pendingWoItems.length} Item
  </span>
</div>
              <div className="d-flex flex-column gap-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                {pendingWoItems.map((item, index) => {
                  const totalCost = item.unit_cost !== null && item.unit_cost !== undefined 
                    ? item.unit_cost * (Number(item.quantity) || 0)
                    : null;
                  return (
                  <div key={item.id || index} className="border rounded p-2">
                    <div className="fw-semibold">{item.itemname}</div>
                    <div className="small text-muted">
                      {item.barcode} • SL: {item.quantity}
{item.unit_cost !== null && item.unit_cost !== undefined
  ? ` • Cost: ${totalCost.toLocaleString('vi-VN', {
      maximumFractionDigits: 0,
    })}₫`
  : ' • Cost: 0₫'}                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {stocktakeMode === 'date' && (
          <>
            <div className="mb-3">
              <label className="form-label"><strong>Cách nhập hạn sử dụng:</strong></label>
              <div className="d-flex gap-2">
                <div className="col-6">
                  <div className="form-check">
                    <input
                      type="radio"
                      id="directExpiry"
                      name="expiryMethod"
                      className="form-check-input"
                      checked={expiryMethod === 'direct'}
                      onChange={() => handleExpiryMethodChange('direct')}
                    />
                    <label className="form-check-label" htmlFor="directExpiry">
                      Date
                    </label>
                  </div>
                </div>
                <div className="col-6">
                  <div className="form-check">
                    <input
                      type="radio"
                      id="durationExpiry"
                      name="expiryMethod"
                      className="form-check-input"
                      checked={expiryMethod === 'duration'}
                      onChange={() => handleExpiryMethodChange('duration')}
                    />
                    <label className="form-check-label" htmlFor="durationExpiry">
                      Calculate days
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: expiryMethod === 'direct' ? 'block' : 'none' }}>
              <label htmlFor="expDateInput" className={`form-label ${fieldErrors.expdate ? 'field-error-label' : ''}`}><strong>Ngày hết hạn:</strong></label>
              <input
                type="date"
                id="expDateInput"
                className={`form-control mb-4 ${fieldErrors.expdate ? 'field-error-input' : ''}`}
                placeholder="dd/mm/yyyy"
                onChange={() => setFieldErrors((prev) => ({ ...prev, expdate: false }))}
                onFocus={(e) => {
                  if (!e.target.value) {
                    e.target.type = 'date';
                  }
                }}
                onBlur={(e) => {
                  if (!e.target.value) {
                    e.target.type = 'text';
                  }
                }}
              />
            </div>
          </>
        )}

        {/* Modal tính HSD */}
        {showDurationModal && (
          <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Tính hạn sử dụng</h5>
                  <button type="button" className="btn-close" onClick={handleCloseModal}></button>
                </div>
                <div className="modal-body">
                  {/* Ngày sản xuất */}
                  <div className="mb-3">
                    <label className="form-label mb-2"><strong>1. Chọn ngày sản xuất:</strong></label>
                    <div className="d-flex gap-2">
                      <select
                        className="form-select"
                        value={mfgDate.day}
                        onChange={(e) => handleMfgDateChange('day', e.target.value)}
                        style={{ maxWidth: '100px' }}
                      >
                        <option value="">Ngày</option>
                        {generateDayOptions(mfgDate.month, mfgDate.year).map(day => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>

                      <select
                        className="form-select"
                        value={mfgDate.month}
                        onChange={(e) => handleMfgDateChange('month', e.target.value)}
                        style={{ maxWidth: '140px' }}
                      >
                        <option value="">Tháng</option>
                        {generateMonthOptions().map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>

                      <select
                        className="form-select"
                        value={mfgDate.year}
                        onChange={(e) => handleMfgDateChange('year', e.target.value)}
                        style={{ maxWidth: '140px' }}
                      >
                        <option value="">Năm</option>
                        {generateYearOptions().map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label mb-2"><strong>2. Nhập thời hạn sử dụng:</strong></label>
                    <div className="input-group">
                      <input
                        type="number"
                        id="durationInput"
                        className="form-control"
                        min="1"
                        maxLength="3"
                        placeholder="Nhập số"
                        onChange={handleDurationChange}
                        style={{ maxWidth: '100px' }}
                      />
                      <select
                        id="durationType"
                        className="form-select"
                        value={durationType}
                        onChange={handleDurationTypeChange}
                        style={{ maxWidth: '100px' }}
                      >
                        <option value="months">Tháng</option>
                        <option value="days">Ngày</option>
                      </select>
                    </div>
                  </div>

                  {/* Kết quả tính toán */}
                  {calculatedExpiry && (
                    <div className="alert alert-info mb-0">
                      <div className="d-flex align-items-center">
                        <strong className="me-2">Hạn sử dụng:</strong>
                        <span className="fs-5">{calculatedExpiry}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Đóng</button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={handleDurationModalClose}
                    disabled={!calculatedExpiry}
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Edit item modal */}
        {showEditModal && (
          <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Sửa sản phẩm</h5>
                  <button type="button" className="btn-close" onClick={() => setShowEditModal(false)}></button>
                </div>
                <div className="modal-body">
                  <div className="mb-2">
                    <label className="form-label"><strong>Tên sản phẩm</strong></label>
                    <input className="form-control" value={editForm.itemname} onChange={(e) => handleEditChange('itemname', e.target.value)} />
                  </div>
                  <div className="mb-2">
                    <label className="form-label"><strong>Barcode</strong></label>
                    <input className="form-control" value={editForm.barcode} onChange={(e) => handleEditChange('barcode', e.target.value)} />
                  </div>
                  <div className="mb-2">
                    <label className="form-label"><strong>Số lượng</strong></label>
                    <input id="editQuantityInput" type="number" className="form-control" value={editForm.quantity} onChange={(e) => handleEditChange('quantity', e.target.value)} />
                  </div>
                  <div className="mb-2">
                    <label className="form-label"><strong>Giá cost</strong></label>
                    <input type="number" step="0.01" min="0" className="form-control" value={editForm.unit_cost ?? ''} onChange={(e) => handleEditChange('unit_cost', e.target.value)} placeholder="Nhập giá cost" />
                  </div>
                  <div className="mb-2">
                    <label className="form-label"><strong>Hạn sử dụng</strong></label>
                    <input type="date" className="form-control" value={editForm.expdate || ''} onChange={(e) => handleEditChange('expdate', e.target.value)} />
                  </div>
                  <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="editStocktake" checked={!!editForm.stocktake} onChange={(e) => handleEditChange('stocktake', e.target.checked)} />
                    <label className="form-check-label" htmlFor="editStocktake">Kiểm kho</label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={editSaving}>Hủy</button>
                  <button type="button" className="btn btn-primary" onClick={handleSaveEdit} disabled={editSaving}>
                    {editSaving ? (
                      <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                    ) : null}
                    Lưu
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showWoNameModal && (
  <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
    <div className="modal-dialog">
      <div className="modal-content">
        <div className="modal-header">
          <h5 className="modal-title">{woName ? 'Sửa tên' : 'Nhập tên (tùy chọn)'}</h5>
          <button type="button" className="btn-close" onClick={handleCloseWoNameModal}></button>
        </div>
        <div className="modal-body">
  <div className="position-relative">
    <input
      type="text"
      className="form-control pe-5"
      value={woNameDraft}
      onChange={(e) => setWoNameDraft(e.target.value)}
      placeholder="Nhập tên"
      autoFocus
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSaveWoNameModal();
        }
      }}
    />
    {woNameDraft && (
      <i
        className="bi bi-x-circle-fill text-secondary position-absolute"
        style={{ top: '50%', right: '10px', transform: 'translateY(-50%)', cursor: 'pointer' }}
        onClick={() => setWoNameDraft('')}
      ></i>
    )}
  </div>
</div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleCloseWoNameModal}>Hủy</button>
          <button type="button" className="btn btn-primary" onClick={handleSaveWoNameModal}>Lưu</button>
        </div>
      </div>
    </div>
  </div>
)}
      </form>

      <div className="mb-2 d-flex align-items-center gap-2">
        <button className="btn btn-primary" onClick={handleOpenModal}>
          Bắt đầu quét
        </button>
        {isWoMode ? (
          woName ? (
            showOptionalSaveButton ? (
              <button id="submitBtn" type="button" className="btn btn-success" disabled={submitLoading} onClick={handleSubmitWoBatch}>
                {submitLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Đang lưu...
                  </>
                ) : (
                  'Lưu'
                )}
              </button>
            ) : (
              <button id="addWoItemBtn" type="button" className="btn btn-outline-primary" onClick={handleAddWoPendingItem}>
                <i className="bi bi-plus-circle me-1"></i>
                Thêm sản phẩm
              </button>
            )
          ) : null
        ) : (
          <button id="submitBtn" type="button" className="btn btn-success" disabled={submitLoading} onClick={handleSubmit}>
            {submitLoading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                Đang lưu...
              </>
            ) : (
              'Lưu'
            )}
          </button>
        )}
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
                    onScanError={(err) => {
                      console.warn('Lỗi quét:', err);
                      // showMessage('Lỗi quét mã QR. Vui lòng thử lại.', 'error');
                    }}
                    qrbox={200}
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

export default Home;