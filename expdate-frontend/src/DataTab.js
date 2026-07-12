// DataTab.js
import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from './utils/authFetch';
import config from './config.json';
import MessageBox from './components/MessageBox';
import * as XLSX from 'xlsx';

const API_URL = config.server;

// Utility to convert date to DD-MM-YYYY for display
function toDDMMYYYYDisplay(dateStr) {
  if (!dateStr) return '';
  // Accepts YYYY-MM-DD or DD/MM/YYYY, returns DD-MM-YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/');
    return `${d}-${m}-${y}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Utility to convert date to YYYY-MM-DD for input type="date"
function toYYYYMMDD(dateStr) {
  if (!dateStr) return '';
  // Accepts DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD, returns YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  let d, m, y;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    [d, m, y] = dateStr.split('/');
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    [d, m, y] = dateStr.split('-');
  } else {
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    d = String(date.getDate()).padStart(2, '0');
    m = String(date.getMonth() + 1).padStart(2, '0');
    y = date.getFullYear();
  }
  return `${y}-${m}-${d}`;
}

// Utility to convert date to DD/MM/YYYY for backend
function toDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  // Accepts YYYY-MM-DD or DD-MM-YYYY or DD/MM/YYYY, returns DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  let d, m, y;
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    [d, m, y] = dateStr.split('-');
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [y, m, d] = dateStr.split('-');
  } else {
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    d = String(date.getDate()).padStart(2, '0');
    m = String(date.getMonth() + 1).padStart(2, '0');
    y = date.getFullYear();
  }
  return `${d}/${m}/${y}`;
}

// Parse date strings from possible formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD)
function parseDateFlexible(dateStr) {
  if (!dateStr) return null;
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Fallback to Date constructor
  const dt = new Date(dateStr);
  return isNaN(dt) ? null : dt;
}

// Parse created_at timestamps like 'DD/MM/YYYY HH:MM:SS' or ISO; returns epoch ms or null
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
function normalizeServerItem(it, source = 'generic') {
  if (!it || typeof it !== 'object') return it;
  const id = it.id || it.iid || it.pk || it.PK || it.IID;
  if (id) return { ...it, id };
  const created = it.created_at || it.createdAt || '';
  if (created) return { ...it, id: created };
  const name = (it.itemname || it.item_name || '').trim();
  const qty = String(it.quantity || '');
  const exp = String(it.expdate || it.expire || '');
  const barcode = String(it.barcode || it.item_barcode || '');
  const stockFlag = it.stocktake ? '1' : '0';
  const composite = `composite:${created}|${name}|${qty}|${exp}|${barcode}|${stockFlag}`;
  return { ...it, id: composite };
}

// Tính số ngày đến hạn hoặc đã hết hạn
function getExpireDays(expdate) {
  if (!expdate) return '';
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = parseDateFlexible(expdate);
  if (isNaN(d)) return '';
  d.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `Đã hết hạn ${-diff} ngày`;
  if (diff === 0) return 'Hết hạn hôm nay';
  return `Còn ${diff} ngày`;
}

function getExpireDaysText(expdate) {
  if (!expdate) return '';
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = parseDateFlexible(expdate);
  if (isNaN(d)) return '';
  d.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (1000 * 60 * 60 * 24));
  const dateStr = toDDMMYYYYDisplay(expdate);
  if (diff < 0) return `Đã hết hạn ngày ${dateStr} (${Math.abs(diff)} ngày trước)`;
  if (diff === 0) return `Hết hạn hôm nay (${dateStr})`;
  return `Hết hạn ngày ${dateStr} (còn ${diff} ngày)`;
}

function getExpireStatus(expdate) {
  if (!expdate) return { text: '', color: '' };
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = parseDateFlexible(expdate);
  if (isNaN(d)) return { text: '', color: '' };
  d.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: `ĐÃ HẾT HẠN: ${Math.abs(diff)} NGÀY`, color: 'text-danger' };
  if (diff === 0) return { text: 'HẾT HẠN HÔM NAY', color: 'text-danger' };
  return { text: `HẾT HẠN SAU: ${diff} NGÀY`, color: 'text-success' };
}

const DataTab = ({ groupData, setGroupData, updateUserCounts }) => {
  const [modalUser, setModalUser] = useState(null);
  const [modalItems, setModalItems] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [filterMonthYear, setFilterMonthYear] = useState('');
  const [filterStocktake, setFilterStocktake] = useState('all'); // 'all' | 'yes' | 'no'
  const [exporting, setExporting] = useState(false); // Thêm state exporting
  // State cho modal chọn user xuất file
  const [showExportModal, setShowExportModal] = useState(false);
  const [showWriteoffModal, setShowWriteoffModal] = useState(false);
  const [writeoffBatches, setWriteoffBatches] = useState([]);
  const [selectedWriteoffBatch, setSelectedWriteoffBatch] = useState(null);
  const [writeoffBatchItems, setWriteoffBatchItems] = useState([]);
  const [writeoffLoading, setWriteoffLoading] = useState(false);
  const [writeoffDetailLoading, setWriteoffDetailLoading] = useState(false);
  const [writeoffError, setWriteoffError] = useState(null);
  const [writeoffHeaderVisible, setWriteoffHeaderVisible] = useState(false);
  const [exportingWriteoff, setExportingWriteoff] = useState(false); // Đang xuất Excel/ảnh của WriteOff
  const [exportingBatchId, setExportingBatchId] = useState(null); // id batch đang export ngay từ danh sách
  const [sharingBatchId, setSharingBatchId] = useState(null); // id batch đang share (gửi email)
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalBatch, setShareModalBatch] = useState(null);
  const [shareEmailInput, setShareEmailInput] = useState('');
  const [savedEmails, setSavedEmails] = useState([]);
  const [deletingWriteoffBatchId, setDeletingWriteoffBatchId] = useState(null);
  const [deletingWriteoffItemId, setDeletingWriteoffItemId] = useState(null);
  const [previewImages, setPreviewImages] = useState(null); // array of image URLs, or null when closed
  const [previewIndex, setPreviewIndex] = useState(0);

  const openImagePreview = (images, index = 0) => {
    if (!images || images.length === 0) return;
    setPreviewImages(images);
    setPreviewIndex(index);
  };
  const closeImagePreview = () => {
    setPreviewImages(null);
    setPreviewIndex(0);
  };
  const showPrevImage = () => {
    setPreviewIndex((i) => (previewImages ? (i - 1 + previewImages.length) % previewImages.length : 0));
  };
  const showNextImage = () => {
    setPreviewIndex((i) => (previewImages ? (i + 1) % previewImages.length : 0));
  };


  // Xuất Excel + ảnh của batch bằng cách gọi thẳng endpoint export phía server
  // (server đọc file ảnh trực tiếp từ ổ đĩa và đóng gói zip), thay vì tự fetch
  // từng ảnh qua URL public ở client — cách cũ hay bị lỗi ảnh rỗng trên điện
  // thoại do mixed-content (https trang web / http URL ảnh) hoặc CORS/Cloudflare.
  const handleExportWriteoffBatchWithImages = async (batch) => {
    if (!batch) return;
    setExportingWriteoff(true);
    try {
      const safeName = (batch.name || 'writeoff_batch').replace(/[\\/:*?"<>|]/g, '_');
      const res = await authFetch(`${API_URL}/api/accounts/items/writeoff_batches/${batch.id}/export/`, { method: 'GET' });
      if (!res.ok) {
        let errMsg = 'Xuất file thất bại.';
        try {
          const data = await res.json();
          errMsg = data.error || errMsg;
        } catch {
          // response không phải JSON (vd: đã là file lỗi), bỏ qua
        }
        alert(errMsg);
        return;
      }
      const blob = await res.blob();
      const zipUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `${safeName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(zipUrl);
    } catch (e) {
      console.error(e);
      alert('Lỗi khi xuất Excel/ảnh của batch.');
    } finally {
      setExportingWriteoff(false);
    }
  };

  // Export nhanh ngay từ 1 row trong danh sách batch, không cần mở batch ra xem trước.
  // Server tự đọc items + ảnh của batch đó nên không cần gọi API lấy chi tiết trước nữa.
  const handleExportBatchRow = async (batch, e) => {
    if (e) e.stopPropagation();
    if (!batch || exportingBatchId) return;
    setExportingBatchId(batch.id);
    try {
      await handleExportWriteoffBatchWithImages(batch);
    } finally {
      setExportingBatchId(null);
    }
  };
  // Open share modal for a batch
  const handleShareBatch = (batch, e) => {
    if (e) e.stopPropagation();
    if (!batch) return;
    setShareModalBatch(batch);
    setShareEmailInput('');
    setShowShareModal(true);
  };

  // Load saved emails on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sent_emails');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setSavedEmails(arr);
    } catch (e) {
      // ignore
    }
  }, []);

  const handleRemoveSavedEmail = (emailToRemove) => {
    const next = savedEmails.filter(email => email !== emailToRemove);
    setSavedEmails(next);
    try {
      localStorage.setItem('sent_emails', JSON.stringify(next));
    } catch (e) {}
  };

  const closeShareModal = () => {
    setShowShareModal(false);
    setShareModalBatch(null);
    setShareEmailInput('');
  };

  const sendShareEmail = async () => {
    const batch = shareModalBatch;
    const toEmail = (shareEmailInput || '').trim();
    if (!batch) return;
    if (!toEmail) {
      alert('Vui lòng nhập email người nhận.');
      return;
    }
    // basic email validation
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRe.test(toEmail)) {
      alert('Email không hợp lệ.');
      return;
    }
    setSharingBatchId(batch.id);
    try {
      const payload = {
        to_email: toEmail,
        subject: `Hủy BM - ${batch.name || `Batch ${batch.id}`}`,
        body_html: `<p>Đính kèm file dữ liệu chi tiết cho batch <strong>${batch.name || batch.id}</strong></p>`,
        batch_id: batch.id,
      };
      const res = await authFetch(`${API_URL}/api/accounts/send-email/`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        alert((data && data.error) || 'Lỗi khi gửi email.');
      } else {
        alert((data && data.message) || 'Gửi email thành công');
        // save email for later
        try {
          const next = [toEmail, ...savedEmails.filter(e => e !== toEmail)].slice(0, 50);
          setSavedEmails(next);
          localStorage.setItem('sent_emails', JSON.stringify(next));
        } catch (e) {}
        closeShareModal();
      }
    } catch (err) {
      alert('Lỗi khi gửi email.');
    } finally {
      setSharingBatchId(null);
    }
  };
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [splitQuantityColumn, setSplitQuantityColumn] = useState(false); // State for split quantity column option
  const [exportOnlyStocktake, setExportOnlyStocktake] = useState(false);
  const [searchQuery, setSearchQuery] = useState(''); // search input for modal items
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(''); // debounced value for smoother typing
  const [deleteModalMessage, setDeleteModalMessage] = useState(null);
  const [deleteModalType, setDeleteModalType] = useState('info'); // 'success' | 'error' | 'info'
  const [deleteModalLoading, setDeleteModalLoading] = useState(null); // 'stocktake' | 'date' | null
  const [deleteModalSelectedMode, setDeleteModalSelectedMode] = useState(null); // 'stocktake' | 'date' | null
  
  // Khởi tạo cache toàn cục nếu chưa có
  if (!window._userItemsCache) window._userItemsCache = {};

  // (stocktake card removed) -- keep modalItems unchanged

  const handleCardClick = (user) => {
    setModalUser(user);
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setModalError(null);
    // Nếu đã có cache đầy đủ thì hiển thị ngay, nếu chỉ là cache tạm thời (isPartial) thì vẫn phải gọi API
    const cache = window._userItemsCache[user.id];
    if (cache && !cache.isPartial) {
      setModalItems(cache.items);
      setModalLoading(false);
    } else {
      setModalLoading(true);
      authFetch(`${API_URL}/api/accounts/items/user/${user.id}/`, { method: 'GET' })
        .then(res => res.json())
          .then(data => {
            const items = data.items || [];
            const normalized = items.map(it => normalizeServerItem(it, 'accounts'));
            setModalItems(normalized);
            window._userItemsCache[user.id] = { items: normalized, isPartial: false }; // Lưu cache đầy đủ (normalized)
        })
        .catch(() => setModalError('Không thể tải dữ liệu sản phẩm của user này.'))
        .finally(() => setModalLoading(false));
    }
  };

  const handleCloseModal = () => {
    setModalUser(null);
    setModalItems([]);
    setModalError(null);
    setSearchQuery('');
    setDebouncedSearchQuery('');
  };

  // Debounce searchQuery to avoid expensive filtering on every keystroke
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // Expose setModalItems và modalUser ra window để Home.js có thể cập nhật UI modal ngay khi thêm item mới
  window._setModalItems = setModalItems;
  window._lastModalUserId = modalUser ? modalUser.id : null;

  // Xử lý xóa item
  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) return;
    setDeletingItemId(itemId); // Bắt đầu loading
    try {
      const res = await authFetch(`${API_URL}/api/accounts/items/${itemId}/delete/`, { method: 'DELETE' });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        if (data && data.error === 'Permission denied') {
          alert('Bạn không có quyền thao tác với sản phẩm này!');
          setDeletingItemId(null); // Kết thúc loading
          return;
        }
        throw new Error('Xóa thất bại');
      }
      // Xóa khỏi cache và UI
      if (modalUser && window._userItemsCache[modalUser.id]) {
        const cache = window._userItemsCache[modalUser.id];
        if (cache.items) {
          cache.items = cache.items.filter(i => i.id !== itemId);
          setModalItems([...cache.items]);
        }
      }
      // Cập nhật các giá trị expired_count, soon_expire_count, valid_count của user ngoài cart body
      if (groupData && groupData.users) {
        const updatedUsers = groupData.users.map(u =>
          u.id === modalUser.id
            ? {
                ...u,
                expired_count: data.expired_count,
                soon_expire_count: data.soon_expire_count,
                valid_count: data.valid_count,
              }
            : u
        );
        setGroupData({ ...groupData, users: updatedUsers });
      }
    } catch (e) {
      alert('Lỗi khi xóa sản phẩm!');
    }
    setDeletingItemId(null); // Kết thúc loading
  };

  // Sửa inline: lưu trạng thái editing
  const [editingItemId, setEditingItemId] = useState(null);
  const [editForm, setEditForm] = useState({ itemname: '', barcode: '', quantity: '', expdate: '' });
  const [deletingItemId, setDeletingItemId] = useState(null); // Thêm state cho loading nút xóa
  const [editLoadingId, setEditLoadingId] = useState(null); // loading cho nút lưu

  const handleEditClick = (item) => {
    setEditingItemId(item.id);
    setEditForm({
      itemname: item.itemname,
      barcode: item.barcode,
      quantity: item.quantity,
      expdate: item.expdate,
    });
  };

  const handleEditChange = (e) => {
    if (e.target.name === 'expdate') {
      setEditForm({ ...editForm, expdate: e.target.value }); // always YYYY-MM-DD
    } else {
      setEditForm({ ...editForm, [e.target.name]: e.target.value });
    }
  };

  const handleEditSave = async (itemId) => {
    setEditLoadingId(itemId);
    try {
      // Always send expdate in DD/MM/YYYY
      const payload = { ...editForm, expdate: toDDMMYYYY(editForm.expdate) };
      const res = await authFetch(`${API_URL}/api/accounts/items/${itemId}/update/`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },        body: JSON.stringify(payload),
      });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        if (data && data.error === 'Permission denied') {
          alert('Bạn không có quyền thao tác với sản phẩm này!');
          setEditLoadingId(null);
          return;
        }
        throw new Error('Cập nhật thất bại');
      }
      // Cập nhật cache và UI với dữ liệu mới từ API
      if (modalUser && window._userItemsCache[modalUser.id]) {
        const cache = window._userItemsCache[modalUser.id];
        if (cache.items) {
          // Preserve server-provided fields like `created_at` which may not be
          // included in the PUT response payload. Merge existing item into the
          // new data before writing to cache and normalize the result.
          const existingIndex = cache.items.findIndex(i => i.id === itemId);
          const existingItem = existingIndex !== -1 ? cache.items[existingIndex] : null;

          if (data.id && data.id !== itemId) {
            // Merge into any pre-existing item with data.id, and remove old itemId
            const newItems = cache.items
              .filter(i => i.id !== itemId)
              .map(i => {
                if (i.id === data.id) {
                  const merged = { ...(i || {}), ...(data.item || {}), id: data.id };
                  return normalizeServerItem(merged, 'accounts');
                }
                return normalizeServerItem(i, 'accounts');
              });
            // If new item not present yet, add merged item (merge with existingItem to keep created_at)
            if (!newItems.find(i => i.id === String(data.id))) {
              const merged = { ...(existingItem || {}), ...(data.item || {}), id: data.id };
              newItems.push(normalizeServerItem(merged, 'accounts'));
            }
            setModalItems([...newItems]);
            cache.items = [...newItems];
          } else {
            // Simple update: merge existingItem and data.item so fields like created_at persist
            cache.items = cache.items.map(i => {
              if (i.id === itemId) {
                const merged = { ...(i || {}), ...(data.item || {}), id: itemId };
                return normalizeServerItem(merged, 'accounts');
              }
              return normalizeServerItem(i, 'accounts');
            });
            setModalItems([...cache.items]);
          }
        }
      }
      // Cập nhật các giá trị expired_count, soon_expire_count, valid_count của user ngoài cart body
      if (groupData && groupData.users) {
        const updatedUsers = groupData.users.map(u =>
          u.id === modalUser.id
            ? {
                ...u,
                expired_count: data.expired_count,
                soon_expire_count: data.soon_expire_count,
                valid_count: data.valid_count,
              }
            : u
        );
        setGroupData({ ...groupData, users: updatedUsers });
      }
      setEditingItemId(null);
    } catch (e) {
      alert('Lỗi khi cập nhật sản phẩm!');
    }
    setEditLoadingId(null);
  };

  const handleEditCancel = () => {
    setEditingItemId(null);
  };

  // Lấy danh sách tháng/năm duy nhất từ modalItems
  const getMonthYearOptions = () => {
    const set = new Set();
    modalItems.forEach(item => {
      if (item.expdate) {
          const d = parseDateFlexible(item.expdate);
        if (!isNaN(d)) {
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const y = d.getFullYear();
          set.add(`${m}/${y}`);
        }
      }
    });
    return Array.from(set).sort((a, b) => {
      // sort by year then month tăng dần
      const [ma, ya] = a.split('/').map(Number);
      const [mb, yb] = b.split('/').map(Number);
      if (ya !== yb) return ya - yb;
      return ma - mb;
    });
  };

  // Lọc sản phẩm theo tháng/năm và theo stocktake filter
  let baseItems = filterMonthYear
    ? modalItems.filter(item => {
        if (!item.expdate) return false;
        const d = parseDateFlexible(item.expdate);
        if (isNaN(d)) return false;
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const y = d.getFullYear();
        return `${m}/${y}` === filterMonthYear;
      })
    : modalItems;

  const filteredItems = baseItems.filter(item => {
    if (filterStocktake === 'all') return true;
    if (filterStocktake === 'yes') return Boolean(item.stocktake);
    if (filterStocktake === 'no') return !Boolean(item.stocktake);
    return true;
  });

  // Apply search filter (name, barcode, item_code) using debounced query and memoize
  const searchedItems = useMemo(() => {
    if (!debouncedSearchQuery) return filteredItems;
    const q = debouncedSearchQuery;
    return filteredItems.filter(item => {
      return (item.itemname && String(item.itemname).toLowerCase().includes(q))
        || (item.barcode && String(item.barcode).toLowerCase().includes(q))
        || (item.item_code && String(item.item_code).toLowerCase().includes(q));
    });
  }, [filteredItems, debouncedSearchQuery]);

  // Sắp xếp filteredItems theo hạn sử dụng: date mới hơn ở trên (giảm dần)
  const sortedItems = [...searchedItems].sort((a, b) => {
    const da = parseDateFlexible(a.expdate);
    const db = parseDateFlexible(b.expdate);
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  // Khi bấm nút xuất file, mở modal chọn user
  const handleOpenExportModal = () => {
    if (!groupData || !groupData.users) return;
    setSelectedUserIds([]); // KHÔNG chọn user nào mặc định
    setSplitQuantityColumn(false); // Reset split quantity column option
    setShowExportModal(true);
  };
  // Đóng modal chọn user
  const handleCloseExportModal = () => {
    setShowExportModal(false);
  };

  const handleDeleteWriteoffItem = async (item, e) => {
    if (e) e.stopPropagation();
    if (!item) return;
    if (!window.confirm('Bạn có chắc chắn muốn xóa mục này khỏi WriteOff?')) return;

    setDeletingWriteoffItemId(item.id);
    try {
      const res = await authFetch(`${API_URL}/api/accounts/items/writeoff_items/${item.id}/delete/`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Không thể xóa mục WriteOff.');
      }

      setWriteoffBatchItems(prev => prev.filter(it => it.id !== item.id));
      setWriteoffBatches(prev => prev.map(batch => batch.id === data.batch_id ? { ...batch, item_count: data.remaining_items } : batch));
      setSelectedWriteoffBatch(prev => prev && prev.id === data.batch_id ? { ...prev, item_count: data.remaining_items } : prev);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Lỗi khi xóa mục WriteOff.');
    } finally {
      setDeletingWriteoffItemId(null);
    }
  };

  const handleDeleteWriteoffBatch = async (batch, e) => {
    if (e) e.stopPropagation();
    if (!batch) return;
    if (!window.confirm('Bạn có chắc chắn muốn xóa toàn bộ batch WriteOff này? Tất cả item và ảnh liên quan sẽ bị xóa.')) return;

    setDeletingWriteoffBatchId(batch.id);
    try {
      const res = await authFetch(`${API_URL}/api/accounts/items/writeoff_batches/${batch.id}/delete/`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Không thể xóa batch WriteOff.');
      }

      setWriteoffBatches(prev => prev.filter(item => item.id !== batch.id));
      if (selectedWriteoffBatch && selectedWriteoffBatch.id === batch.id) {
        setSelectedWriteoffBatch(null);
        setWriteoffBatchItems([]);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Lỗi khi xóa batch WriteOff.');
    } finally {
      setDeletingWriteoffBatchId(null);
    }
  };

  const handleOpenWriteoffModal = async () => {
    setWriteoffError(null);
    setSelectedWriteoffBatch(null);
    setWriteoffBatchItems([]);
    setWriteoffLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/accounts/items/writeoff_batches/`, { method: 'GET' });
      const data = await res.json();
      if (!res.ok) {
        setWriteoffError(data.error || 'Không thể tải thông tin WriteOff.');
        return;
      }
      setWriteoffBatches(data.batches || []);
      setShowWriteoffModal(true);
    } catch (e) {
      setWriteoffError('Lỗi khi tải WriteOff batch.');
    } finally {
      setWriteoffLoading(false);
    }
  };
  const handleCloseWriteoffModal = () => {
    setShowWriteoffModal(false);
    setSelectedWriteoffBatch(null);
    setWriteoffBatchItems([]);
  };

  const handleSelectWriteoffBatch = async (batch) => {
    setWriteoffError(null);
    setWriteoffDetailLoading(true);
    setSelectedWriteoffBatch(batch);
    setWriteoffHeaderVisible(false);
    setWriteoffBatchItems([]);
    try {
      const res = await authFetch(`${API_URL}/api/accounts/items/writeoff_batches/${batch.id}/items/`, { method: 'GET' });
      const data = await res.json();
      if (!res.ok) {
        setWriteoffError(data.error || 'Không thể tải items của batch.');
        return;
      }
      // data.batch chứa đầy đủ thông tin (kèm images) trả về từ backend, dùng để
      // thay thế batch tóm tắt ban đầu (lấy từ danh sách) cho chắc chắn có ảnh.
      if (data.batch) {
        setSelectedWriteoffBatch(data.batch);
      }
      setWriteoffBatchItems(data.items || []);
    } catch (e) {
      setWriteoffError('Lỗi khi tải items của batch.');
    } finally {
      setWriteoffDetailLoading(false);
    }
  };

  useEffect(() => {
    requestAnimationFrame(() => setWriteoffHeaderVisible(true));
  }, [selectedWriteoffBatch]);
  // Chọn/bỏ chọn 1 user
  const handleToggleUser = (userId) => {
    setSelectedUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };
  // Chọn/bỏ chọn tất cả
  const handleToggleAllUsers = () => {
    if (!groupData || !groupData.users) return;
    if (selectedUserIds.length === groupData.users.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(groupData.users.map(u => u.id));
    }
  };

  const parseNumericValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = String(value).trim().replace(/,/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // Hàm xử lý xuất file Excel cho quản lý (chỉ xuất cho các user đã chọn)
  async function handleExportFile() {
    if (!groupData || !groupData.users) return;
    if (!selectedUserIds || selectedUserIds.length === 0) {
      alert('Vui lòng chọn ít nhất 1 user để xuất file!');
      return;
    }
    setExporting(true);
    setShowExportModal(false);
    const allData = {};
    const allMonths = new Set();
    const accessToken = localStorage.getItem('access_token');
    let singleUser = null;
    if (selectedUserIds.length === 1) {
      singleUser = groupData.users.find(u => u.id === selectedUserIds[0]);
    }
    for (const user of groupData.users) {
      if (!selectedUserIds.includes(user.id)) continue;
      try {
        const res = await fetch(`${API_URL}/api/accounts/items/user/${user.id}/`, {
          method: 'GET',
          headers: {
            ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
          }
        });
        const data = await res.json();
        if (res.status === 401 || data.detail === 'Authentication credentials were not provided.') {
          alert('Bạn cần đăng nhập lại để xuất file.');
          setExporting(false);
          return;
        }
        const items = data.items || [];
        for (const item of items) {
          if (!item.expdate) continue;
          const d = parseDateFlexible(item.expdate);
          if (isNaN(d)) continue;
          // Behavior:
          // - if exportOnlyStocktake === true: export only stocktake items
          // - if exportOnlyStocktake === false: export only non-stocktake (date) items
          if (exportOnlyStocktake) {
            if (!item.stocktake) continue;
          } else {
            if (item.stocktake) continue;
          }
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          const keyMonth = `${mm}/${yyyy}`;
          allMonths.add(keyMonth);
          const key = `${item.itemname}|${item.barcode}|${item.item_code || ''}`;
          const parsedUnitCost = parseNumericValue(item.unit_cost);
          if (!allData[key]) allData[key] = {
            itemname: item.itemname,
            barcode: item.barcode,
            item_code: item.item_code || '',
            unit_cost: parsedUnitCost != null ? parsedUnitCost : '',
            stocktake: false
          };
          if (parsedUnitCost != null && allData[key].unit_cost === '') {
            allData[key].unit_cost = parsedUnitCost;
          }
          // accumulate stocktake flag for this product key
          allData[key].stocktake = allData[key].stocktake || Boolean(item.stocktake);
          // Use a map day->quantity so aggregated API (which already sums per group) still merges correctly
          if (!allData[key][keyMonth]) allData[key][keyMonth] = {}; // day -> total quantity
          const day = String(d.getDate()).padStart(2, '0');
          const qty = Number(item.quantity) || 0;
          allData[key][keyMonth][day] = (allData[key][keyMonth][day] || 0) + qty;
        }
      } catch (e) {
        // Nếu lỗi vẫn tiếp tục user khác
      }
    }
    if (Object.keys(allData).length === 0) {
      alert('Không có dữ liệu để xuất file!');
      setExporting(false);
      return;
    }
    // Chuẩn bị dữ liệu cho Excel
    const months = Array.from(allMonths).sort((a, b) => {
      const [ma, ya] = a.split('/').map(Number);
      const [mb, yb] = b.split('/').map(Number);
      if (ya !== yb) return ya - yb;
      return ma - mb;
    });
  const header = ['Item name', 'Barcode', 'Item code', 'Cost', 'Total'];
  header.push(...months);
  if (splitQuantityColumn) header.push('Quantity');
  header.push('Stocktake');
    const rows = [];
    Object.values(allData).forEach(rowData => {
      // Determine max number of day-entries across months for this product
      let maxRows = 0;
      const monthDayLists = {};
      months.forEach(month => {
        const dayMap = rowData[month] || {};
        const dayEntries = Object.keys(dayMap).sort(); // sorted days
        monthDayLists[month] = dayEntries.map(day => ({ day, quantity: dayMap[day] }));
        if (dayEntries.length > maxRows) maxRows = dayEntries.length;
      });

      for (let i = 0; i < maxRows; i++) {
        const unitCost = parseNumericValue(rowData.unit_cost);
        let rowQuantity = 0;
        const row = {
          'Item name': rowData.itemname,
          'Barcode': rowData.barcode,
          'Item code': rowData.item_code,
          'Stocktake': rowData.stocktake ? 'Có' : 'Không',
          'Cost': unitCost != null ? unitCost : null,
          'Total': null,
        };
        if (splitQuantityColumn) {
          row['Quantity'] = '';
        }
        months.forEach(month => {
          const entry = monthDayLists[month] && monthDayLists[month][i];
          if (splitQuantityColumn) {
            row[month] = entry ? entry.day : '';
            if (entry) {
              row['Quantity'] = entry.quantity;
              rowQuantity = entry.quantity;
            }
          } else {
            row[month] = entry ? `${entry.quantity}(${entry.day})` : '';
            if (entry) {
              rowQuantity += entry.quantity;
            }
          }
        });
        const total = unitCost != null ? unitCost * rowQuantity : null;
        row['Total'] = total != null ? total : null;
        rows.push(row);
      }
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tổng hợp');

    // Prompt user for file name (default: current date_time)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const defaultName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    // Ask user with default prefilled as timestamp
    let fileName = prompt('Nhập tên file (không cần phần mở rộng):', defaultName);
    if (!fileName) {
      alert('Xuất file bị hủy do không có tên file.');
      setExporting(false);
      return;
    }
    fileName = fileName.replace(/[\\/:*?"<>|]/g, '').trim(); // Remove invalid characters
    fileName = `${fileName}.xlsx`;

    XLSX.writeFile(wb, fileName);
    setExporting(false);
  }

  return (
    <div className="container mt-4">

      {/* Nút xuất file cho quản lý */}
      {/* {groupData && groupData.is_manage && ( */}
        <div className="mb-3 text-start">
          <button className="btn btn-success" onClick={handleOpenExportModal} disabled={exporting}>
            {exporting ? (
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
            ) : null}
            Xuất file
          </button>
          <button className="btn btn-primary ms-2" onClick={handleOpenWriteoffModal} disabled={writeoffLoading || exporting}>
            {writeoffLoading ? (
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
            ) : null}
            WriteOff Data
          </button>
        </div>
      {/* )} */}
      {/* Modal chọn user để xuất file */}
      {showExportModal && groupData && groupData.users && (
        <>
          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
          <div className="modal fade show" style={{ display: 'block', background: 'rgba(0,0,0,0.5)', zIndex: 1060 }} tabIndex="-1">
            <div className="modal-dialog" style={{ maxWidth: 500 }}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Chọn user để xuất file</h5>
                  <button type="button" className="btn-close" onClick={handleCloseExportModal}></button>
                </div>
                <div className="modal-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
                  <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="selectAllUsers" checked={selectedUserIds.length === groupData.users.length} onChange={handleToggleAllUsers} />
                    <label className="form-check-label" htmlFor="selectAllUsers">Chọn tất cả</label>
                  </div>
                  <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="exportOnlyStocktake" checked={exportOnlyStocktake} onChange={e => setExportOnlyStocktake(e.target.checked)} />
                    <label className="form-check-label" htmlFor="exportOnlyStocktake">Chỉ xuất Stocktake</label>
                  </div>
                  <hr className="my-2" />
                  {groupData.users.map(user => (
                    <div className="d-flex align-items-center mb-2" key={user.id}>
                      <div className="form-check" style={{ flex: 1 }}>
                        <input className="form-check-input" type="checkbox" id={`user_${user.id}`} checked={selectedUserIds.includes(user.id)} onChange={() => handleToggleUser(user.id)} />
                        <label className="form-check-label" htmlFor={`user_${user.id}`}>{user.full_name}</label>
                      </div>
                      {selectedUserIds.length === 1 && selectedUserIds.includes(user.id) && (
                        <div style={{ marginLeft: '1rem' }}>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="splitQuantityColumn"
                              checked={splitQuantityColumn}
                              onChange={(e) => setSplitQuantityColumn(e.target.checked)}
                            />
                            <label className="form-check-label" htmlFor="splitQuantityColumn">
                              Tách cột SL
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={handleCloseExportModal}>Hủy</button>
                  <button className="btn btn-success" onClick={handleExportFile} disabled={exporting || selectedUserIds.length === 0}>
                    {exporting ? <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> : null}
                    Xuất file
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      {showWriteoffModal && (
        <>
          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
          <div className="modal fade show" style={{ display: 'block', background: 'rgba(0,0,0,0.5)', zIndex: 1060 }} tabIndex="-1">
            <div className="modal-dialog modal-fullscreen m-0" style={{ maxWidth: '100vw' }}>
              <div className="modal-content" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <div className="modal-header">
                  <h5 className="modal-title">WO-Data</h5>
                  <div
                    className="d-flex align-items-center gap-2 ms-auto"
                    style={{
                      opacity: writeoffHeaderVisible ? 1 : 0,
                      transform: writeoffHeaderVisible ? 'translateY(0)' : 'translateY(-8px)',
                      transition: 'opacity .22s ease, transform .22s ease',
                      pointerEvents: writeoffHeaderVisible ? 'auto' : 'none',
                    }}
                  >
                    {selectedWriteoffBatch && selectedWriteoffBatch.images && selectedWriteoffBatch.images.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        title="Xem ảnh"
                        onClick={(e) => { e.stopPropagation(); openImagePreview(selectedWriteoffBatch.images, 0); }}
                      >
                        📷 {selectedWriteoffBatch.images.length}
                      </button>
                    ) : null}
                    {selectedWriteoffBatch ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          title="Share batch (gửi email)"
                          onClick={(e) => { e.stopPropagation(); handleShareBatch(selectedWriteoffBatch, e); }}
                          disabled={sharingBatchId === selectedWriteoffBatch?.id}
                        >
                          {sharingBatchId === selectedWriteoffBatch?.id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                          ) : (
                            '📤'
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          title="Xóa batch"
                          onClick={(e) => handleDeleteWriteoffBatch(selectedWriteoffBatch, e)}
                          disabled={deletingWriteoffBatchId === selectedWriteoffBatch?.id}
                        >
                          {deletingWriteoffBatchId === selectedWriteoffBatch?.id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                          ) : (
                            '🗑️'
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          title="Xuất Excel + ảnh (.zip)"
                          onClick={(e) => handleExportBatchRow(selectedWriteoffBatch, e)}
                          disabled={exportingBatchId === selectedWriteoffBatch?.id}
                        >
                          {exportingBatchId === selectedWriteoffBatch?.id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                          ) : (
                            '⬇️'
                          )}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      title="Quay lại"
                      onClick={(e) => { e.stopPropagation(); selectedWriteoffBatch ? setSelectedWriteoffBatch(null) : handleCloseWriteoffModal(); }}
                    >
                      <span aria-hidden="true">←</span>
                    </button>
                  </div>
                </div>
                <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                  {writeoffError ? (
                    <div className="alert alert-danger">{writeoffError}</div>
                  ) : writeoffLoading ? (
                    <div className="text-center py-4"><div className="spinner-border" role="status"></div></div>
                  ) : selectedWriteoffBatch ? (
                    <>
                      {writeoffDetailLoading ? (
                        <div className="text-center py-4"><div className="spinner-border" role="status"></div></div>
                      ) : writeoffBatchItems.length === 0 ? (
                        <div>Không có items trong batch này.</div>
                      ) : (
                        <div className="list-group">
                          {writeoffBatchItems.map(item => (
                            <div key={item.id} className="list-group-item">
                              <div className="d-flex justify-content-between align-items-start">
                                <div>
                                  <h6 className="mb-1">{item.itemname}</h6>
                                  <div className="small text-muted">Item code: {item.item_code || '(không có)'}</div>
                                  <div className="small text-muted">Barcode: {item.barcode}</div>
                                  <div className="small text-muted">Số lượng: {item.quantity} cái</div>
                                  {item.unit_cost !== undefined && item.unit_cost !== null ? (
                                    <div className="small text-muted">
                                      Giá cost: {typeof item.unit_cost === 'number' ? `${Math.round(item.unit_cost).toLocaleString('vi-VN')} ₫` : item.unit_cost}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="text-end d-flex flex-column align-items-end gap-1">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-danger"
                                    title="Xóa mục này"
                                    onClick={(e) => handleDeleteWriteoffItem(item, e)}
                                    disabled={deletingWriteoffItemId === item.id}
                                  >
                                    {deletingWriteoffItemId === item.id ? (
                                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                                    ) : (
                                      '🗑️'
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : writeoffBatches.length === 0 ? (
                    <div>Không có batch writeoff nào.</div>
                  ) : (
                    <div className="list-group">
                      {writeoffBatches.map(batch => (
                        <div
                          key={batch.id}
                          role="button"
                          tabIndex={0}
                          className="list-group-item list-group-item-action"
                          onClick={() => handleSelectWriteoffBatch(batch)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectWriteoffBatch(batch); }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <h6 className="mb-1">{batch.name}</h6>
                              <div className="small text-muted">{batch.full_name || batch.username}</div>
                              <div className="small text-muted">
                                Total cost:{' '}
                                {typeof batch.total_cost === 'number'
                                  ? `${Math.round(batch.total_cost).toLocaleString('vi-VN')} ₫`
                                  : `${batch.total_cost || 0} ₫`}
                              </div>
                                  <div className="small text-muted">Total item: <span className="fw-bold">{batch.item_count}</span></div>
                                                                <div className="small text-muted">Created: {batch.created_at ? new Date(batch.created_at).toLocaleString('vi-VN') : ''}</div>

                            </div>
                            <div className="text-end d-flex flex-column align-items-end gap-1">
                              <div className="d-flex align-items-center gap-2">
                                {batch.images && batch.images.length > 0 ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-secondary"
                                    title="Xem ảnh"
                                    onClick={(e) => { e.stopPropagation(); openImagePreview(batch.images, 0); }}
                                  >
                                    📷 {batch.images.length}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  title="Share batch (gửi email)"
                                  onClick={(e) => { e.stopPropagation(); handleShareBatch(batch, e); }}
                                  disabled={sharingBatchId === batch.id}
                                >
                                  {sharingBatchId === batch.id ? (
                                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                                  ) : (
                                    '📤'
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  title="Xóa batch"
                                  onClick={(e) => { e.stopPropagation(); handleDeleteWriteoffBatch(batch, e); }}
                                  disabled={deletingWriteoffBatchId === batch.id}
                                >
                                  {deletingWriteoffBatchId === batch.id ? (
                                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                                  ) : (
                                    '🗑️'
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-success"
                                  title="Xuất Excel + ảnh (.zip)"
                                  onClick={(e) => { e.stopPropagation(); handleExportBatchRow(batch, e); }}
                                  disabled={exportingBatchId === batch.id}
                                >
                                  {exportingBatchId === batch.id ? (
                                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                                  ) : (
                                    '⬇️'
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
        
      )}
      {previewImages && (
        <>
          <div className="modal-backdrop fade show" style={{ zIndex: 1070 }} onClick={closeImagePreview}></div>
          <div className="modal fade show" style={{ display: 'block', zIndex: 1080 }} tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 800 }}>
              <div className="modal-content bg-dark">
                <div className="modal-header border-0">
                  <span className="text-white small">Ảnh {previewIndex + 1}/{previewImages.length}</span>
                  <button type="button" className="btn-close btn-close-white ms-auto" onClick={closeImagePreview}></button>
                </div>
                <div className="modal-body text-center position-relative d-flex align-items-center justify-content-center" style={{ minHeight: 300 }}>
                  {previewImages.length > 1 ? (
                    <button
                      type="button"
                      className="btn btn-light position-absolute top-50 start-0 translate-middle-y ms-2"
                      onClick={showPrevImage}
                      aria-label="Ảnh trước"
                    >
                      ‹
                    </button>
                  ) : null}
                  <img
                    src={previewImages[previewIndex]}
                    alt={`writeoff-${previewIndex + 1}`}
                    style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                  />
                  {previewImages.length > 1 ? (
                    <button
                      type="button"
                      className="btn btn-light position-absolute top-50 end-0 translate-middle-y me-2"
                      onClick={showNextImage}
                      aria-label="Ảnh tiếp theo"
                    >
                      ›
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>

      )}
      {showShareModal && (
        <>
          <div className="modal-backdrop fade show" style={{ zIndex: 1070 }} onClick={closeShareModal}></div>
          <div className="modal fade show" style={{ display: 'block', zIndex: 1080 }} tabIndex="-1">
            <div className="modal-dialog" style={{ maxWidth: 520 }}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Gửi batch</h5>
                  <button type="button" className="btn-close" onClick={closeShareModal}></button>
                </div>
                <div className="modal-body">
                  <label className="form-label">Nhập email người nhận:</label>
                  <div className="position-relative mb-2">
                    <input
                      type="email"
                      className="form-control pe-4"
                      value={shareEmailInput}
                      onChange={e => setShareEmailInput(e.target.value)}
                      placeholder="Nhập email"
                    />
                    {shareEmailInput ? (
                      <i
                        className="bi bi-x-circle-fill text-secondary position-absolute"
                        style={{ top: '8px', right: '10px', cursor: 'pointer' }}
                        onClick={() => setShareEmailInput('')}
                        aria-label="Xóa email"
                      ></i>
                    ) : null}
                  </div>
                  {savedEmails && savedEmails.length > 0 ? (
                    <div>
                      <div className="small text-muted mb-2">Email đã lưu (chọn để dùng):</div>
                      <div className="d-flex flex-wrap gap-2">
                        {savedEmails.map(email => (
                          <div key={email} className="position-relative">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary pe-4"
                              onClick={() => setShareEmailInput(email)}
                            >
                              {email}
                            </button>
                            <i
                              className="bi bi-x-circle-fill text-secondary position-absolute"
                              style={{ top: '-8px', right: '-8px', cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveSavedEmail(email);
                              }}
                              aria-label={`Xóa ${email}`}
                            ></i>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={closeShareModal}>Hủy</button>
                  <button className="btn btn-primary" onClick={sendShareEmail} disabled={sharingBatchId === shareModalBatch?.id}>
                    {sharingBatchId === shareModalBatch?.id ? (
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    ) : 'Gửi'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      {groupData && groupData.users && groupData.users.length > 0 ? (
        <div className="row g-3">
          {groupData.users.map(user => (
            <div className="col-12 col-md-6 col-lg-4" key={user.id}>
              <div className="card h-100 shadow-sm" style={{ cursor: 'pointer' }} onClick={() => handleCardClick(user)}>
                <div className="card-body text-start">
                  <h5 className="card-title mb-2">{user.full_name}</h5>
                  <div className="mb-2"><span className="text-danger fw-bold">Đã hết hạn: {user.expired_count}</span></div>
                  <div className="mb-2"><span className="text-warning fw-bold">Sắp hết hạn(15 ngày): {user.soon_expire_count}</span></div>
                  <div><span className="text-success fw-bold">Còn hạn: {user.valid_count}</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>Không có dữ liệu nhóm.</div>
      )}

      {/* Modal hiển thị sản phẩm của user */}
      {modalUser && (
        <>
          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
          <div className="modal fade show" style={{ display: 'block', background: 'rgba(0,0,0,0.5)', zIndex: 1060 }} tabIndex="-1">
            <div className="modal-dialog modal-fullscreen m-0" style={{ width: '100vw', height: '100vh', maxWidth: '100vw' }}>
              <div className="modal-content" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <div className="modal-header flex-column align-items-start">
                  <h5 className="modal-title">{modalUser.full_name}</h5>
                  <div className="w-100 mt-2 d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2">
                    <div className="d-flex flex-column flex-md-row gap-2 align-items-start align-items-md-center" style={{ minWidth: 0 }}>
                      <select className="form-select" value={filterMonthYear} onChange={e => setFilterMonthYear(e.target.value)} style={{ minWidth: 0 }}>
                        <option value="">Tất cả tháng/năm</option>
                        {getMonthYearOptions().map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <select className="form-select" value={filterStocktake} onChange={e => setFilterStocktake(e.target.value)} style={{ minWidth: 0 }}>
                        <option value="all">Tất cả (Kiểm kho / Không)</option>
                        <option value="yes">Chỉ Kiểm kho</option>
                        <option value="no">Không Kiểm kho</option>
                      </select>
                      <input
                        type="search"
                        className="form-control"
                        placeholder="Tìm kiếm tên / Barcode / Item code"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{ minWidth: 0, maxWidth: 320 }}
                      />
                    </div>
                          {(() => {
                            try {
                              const currentUserId = localStorage.getItem('user_id');
                              const currentUsername = localStorage.getItem('username');
                              const isManager = groupData && groupData.is_manage;
                              const isSameUserId = currentUserId && String(modalUser.id) === String(currentUserId);
                              const isSameUsername = currentUsername && modalUser.username && modalUser.username === currentUsername;
                              if (isManager || isSameUserId || isSameUsername) {
                                return (
                                  <>
                                    <button className="btn btn-danger" onClick={() => setShowDeleteAllModal(true)}>
                                      Xóa tất cả sản phẩm
                                    </button>
                                      {showDeleteAllModal && (
                                        <>
                                          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
                                          <div className="modal fade show" style={{ display: 'block', background: 'rgba(0,0,0,0.5)', zIndex: 1060 }} tabIndex="-1">
                                            <div className="modal-dialog" style={{ maxWidth: 520 }}>
                                              <div className="modal-content">
                                                <div className="modal-header">
                                                  <h5 className="modal-title">Xóa sản phẩm</h5>
                                                  <button type="button" className="btn-close" onClick={() => setShowDeleteAllModal(false)}></button>
                                                </div>
                                                <div className="modal-body">
                                                  <p>Bạn muốn xóa những mục nào? Chọn 1 trong các tuỳ chọn bên dưới:</p>
                                                  {deleteModalMessage && (
                                                    <div className={`alert ${deleteModalType === 'success' ? 'alert-success' : deleteModalType === 'error' ? 'alert-danger' : 'alert-info'}`} role="alert">
                                                      {deleteModalMessage}
                                                    </div>
                                                  )}
                                                  </div>
                                                <div className="modal-footer d-flex justify-content-between align-items-center">
                                                  <div className="d-flex gap-2">
                                                    <button
                                                      className={deleteModalSelectedMode === 'stocktake' ? 'btn btn-danger' : 'btn btn-outline-danger'}
                                                      disabled={!!deleteModalLoading}
                                                      onClick={() => { setDeleteModalSelectedMode('stocktake'); setDeleteModalMessage(null); setDeleteModalType('info'); }}
                                                    >
                                                      Xóa Kiểm kho
                                                    </button>

                                                    <button
                                                      className={deleteModalSelectedMode === 'date' ? 'btn btn-warning' : 'btn btn-outline-warning'}
                                                      disabled={!!deleteModalLoading}
                                                      onClick={() => { setDeleteModalSelectedMode('date'); setDeleteModalMessage(null); setDeleteModalType('info'); }}
                                                    >
                                                      Xóa Kiểm date
                                                    </button>
                                                  </div>
                                                  <div className="d-flex gap-2">
                                                    <button className="btn btn-secondary" onClick={() => { setShowDeleteAllModal(false); setDeleteModalMessage(null); setDeleteModalType('info'); setDeleteModalLoading(null); setDeleteModalSelectedMode(null); }}>Hủy</button>
                                                    <button
                                                      className="btn btn-primary"
                                                      disabled={!deleteModalSelectedMode || !!deleteModalLoading}
                                                      onClick={async () => {
                                                        if (!deleteModalSelectedMode) return;
                                                        setDeleteModalMessage(null); setDeleteModalType('info'); setDeleteModalLoading(deleteModalSelectedMode);
                                                        try {
                                                          const res = await authFetch(`${API_URL}/api/accounts/items/user/${modalUser.id}/delete_all/?mode=${deleteModalSelectedMode}`, { method: 'DELETE' });
                                                          let data = {};
                                                          try { data = await res.json(); } catch {}
                                                          if (!res.ok) {
                                                            setDeleteModalType('error');
                                                            setDeleteModalMessage((data && data.error) || 'Lỗi khi xóa!');
                                                            setDeleteModalLoading(null);
                                                            return;
                                                          }
                                                          if (window._userItemsCache[modalUser.id]) {
                                                            if (deleteModalSelectedMode === 'stocktake') {
                                                              window._userItemsCache[modalUser.id].items = (window._userItemsCache[modalUser.id].items || []).filter(i => !i.stocktake);
                                                            } else {
                                                              window._userItemsCache[modalUser.id].items = (window._userItemsCache[modalUser.id].items || []).filter(i => Boolean(i.stocktake));
                                                            }
                                                          }
                                                          setModalItems((window._userItemsCache[modalUser.id] && window._userItemsCache[modalUser.id].items) || []);
                                                          if (groupData && groupData.users) {
                                                            const updatedUsers = groupData.users.map(u => u.id === modalUser.id ? { ...u, expired_count: data.expired_count, soon_expire_count: data.soon_expire_count, valid_count: data.valid_count } : u);
                                                            setGroupData({ ...groupData, users: updatedUsers });
                                                          }
                                                          setDeleteModalType('success');
                                                          setDeleteModalMessage(`Đã xóa ${data.deleted_count || 0} mục ${deleteModalSelectedMode === 'stocktake' ? 'Kiểm kho' : 'Kiểm date'}.`);
                                                        } catch (e) {
                                                          setDeleteModalType('error');
                                                          setDeleteModalMessage('Lỗi khi xóa!');
                                                        }
                                                        setDeleteModalLoading(null);
                                                      }}
                                                    >
                                                      {deleteModalLoading ? (<span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>) : null}
                                                      Xác nhận
                                                    </button>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </>
                                      )}
                                  </>
                                );
                              }
                            } catch (e) {
                              // ignore localStorage errors
                            }
                            return null;
                          })()}
                  </div>
                  <button type="button" className="btn-close position-absolute end-0 top-0 m-3" onClick={handleCloseModal}></button>
                </div>
                <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                  {modalLoading ? (
                    <div className="text-start py-4"><div className="spinner-border" role="status"></div></div>
                  ) : modalError ? (
                    <div className="alert alert-danger">{modalError}</div>
                  ) : sortedItems.length === 0 ? (
                    <div>Không có sản phẩm nào.</div>
                  ) : (
                    <div className="row g-3">
                      {sortedItems.map(item => (
                        <div className="col-12 col-md-6 col-lg-4" key={item.id}>
                          <div className="card h-100 shadow-sm position-relative">
                            <div className="card-body text-start">
                              {editingItemId === item.id ? (
                                        <>
                                          <input className="form-control mb-1" name="itemname" value={editForm.itemname} onChange={handleEditChange} />
                                          <input className="form-control mb-1" name="barcode" value={editForm.barcode} onChange={handleEditChange} />
                                          <input className="form-control mb-1" name="quantity" value={editForm.quantity} onChange={handleEditChange} type="number" />
                                          <input className="form-control mb-2" name="expdate" type="date" value={toYYYYMMDD(editForm.expdate)} onChange={handleEditChange} />
                                          <div className="d-flex justify-content-start gap-2 mt-2">
                                            <button className="btn btn-sm btn-success" onClick={() => handleEditSave(item.id)} disabled={editLoadingId === item.id}>
                                              {editLoadingId === item.id ? (
                                                <span   className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                                              ) : null}
                                              Lưu
                                            </button>
                                            <button className="btn btn-sm btn-secondary" onClick={handleEditCancel} disabled={editLoadingId === item.id}>Hủy</button>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                  <h6 className="card-title mb-2">{item.itemname}</h6>
                                  <div className="mb-1"><span className="fw-bold">Barcode:</span> {item.barcode}</div>
                                  <div className="mb-1"><span className="fw-bold">Item Code:</span> {item.item_code || <span className="text-muted">(không có)</span>}</div>
                                  <div className="mb-1"><span className="fw-bold">Quantity:</span> {item.quantity}</div>
                                  <div className="mb-2"><span className="fw-bold">Hạn sử dụng:</span> {toDDMMYYYYDisplay(item.expdate)}</div>
                                  {/* New row under expiration to show stocktake flag */}
                                  <div className="mb-1">
                                    <span className="fw-bold">Kiểm kho:</span>
                                    {' '}
                                    {(() => {
                                      // When in stocktake display mode or when exporting only stocktake,
                                      // show the Stocktake value in muted style (similar to "off")
                                      const showMuted = filterStocktake === 'yes' || exportOnlyStocktake === true;
                                      if (item.stocktake) {
                                        return showMuted ? (
                                          <span className="text-muted ms-2">Có</span>
                                        ) : (
                                          <span className="badge bg-warning text-dark ms-2">Có</span>
                                        );
                                      }
                                      return <span className="text-muted ms-2">Không</span>;
                                    })()}
                                  </div>
                                  {!item.stocktake ? (() => { const status = getExpireStatus(item.expdate); return (
                                    <div className={`mb-2 fw-bold ${status.color}`}>{status.text}</div>
                                  )})() : null}
                                  <div className="d-flex justify-content-start gap-2 mt-2">
                                    <button className="btn btn-sm btn-outline-primary" onClick={() => handleEditClick(item)}>Sửa</button>
                                    <button
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => handleDeleteItem(item.id)}
                                      disabled={deletingItemId === item.id}
                                    >
                                      {deletingItemId === item.id ? (
                                        <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                                      ) : null}
                                      Xóa
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* modal-footer removed */}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DataTab;