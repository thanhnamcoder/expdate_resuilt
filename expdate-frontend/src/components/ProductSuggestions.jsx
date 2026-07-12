import React, { useState, useRef } from 'react';

const ITEMS_PER_PAGE = 5;

const ProductSuggestionItem = ({ item, onSelectItem, isFullVisible, setFullVisible }) => {
  return (
    <div
      className="p-2 border-bottom hover-bg-light"
      style={{
        cursor: 'pointer',
        backgroundColor: 'white',
        display: 'flex',
        flexDirection: 'column', // Đổi sang column để barcode xuống dưới
        alignItems: 'flex-start',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
      onTouchStart={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
      onTouchEnd={(e) => (e.currentTarget.style.backgroundColor = 'white')}
      onClick={() => onSelectItem(item)}
      title={item.item_name}
    >
      <div
        style={{
          whiteSpace: 'nowrap',
          overflowX: 'auto',
          flex: 1,
          WebkitOverflowScrolling: 'touch',
          textOverflow: isFullVisible ? 'unset' : 'ellipsis',
          scrollbarWidth: 'none',
        }}
        onScroll={(e) => {
          e.currentTarget.style.scrollbarWidth = 'auto';
          setFullVisible(item.item_name, true);
        }}
      >
        {item.item_name}
      </div>
      <div style={{ fontSize: '0.9em', color: '#888', marginTop: 2 }}>
        Barcode: {item.item_barcode}
      </div>
    </div>
  );
};

const ProductSuggestions = ({ itemOptions, currentPage, setCurrentPage, onSelectItem, onCloseSuggestions }) => {
  const totalPages = Math.ceil(itemOptions.length / ITEMS_PER_PAGE);
  const visibleItems = itemOptions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const [fullVisibleItems, setFullVisibleItems] = useState({});

  const setFullVisible = (itemName, value) => {
    setFullVisibleItems((prev) => ({
      ...prev,
      [itemName]: value,
    }));
  };

  return (
    <div
      className="border rounded mt-1 shadow-sm bg-white position-absolute w-100 z-3"
      style={{
        maxHeight: 'auto',
        overflow: 'hidden',
      }}
    >
      {visibleItems.map((item, index) => (
        <ProductSuggestionItem
          key={index}
          item={item}
          onSelectItem={onSelectItem}
          isFullVisible={!!fullVisibleItems[item.item_name]}
          setFullVisible={setFullVisible}
        />
      ))}

      {itemOptions.length > ITEMS_PER_PAGE && (
        <div className="d-flex align-items-center p-2 border-top bg-light gap-2" style={{ justifyContent: 'flex-start' }}>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={(e) => {
              e.preventDefault();
              setCurrentPage((prev) => Math.max(prev - 1, 1));
            }}
            disabled={currentPage === 1}
          >
            Trước
          </button>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={(e) => {
              e.preventDefault();
              setCurrentPage((prev) => Math.min(prev + 1, totalPages));
            }}
            disabled={currentPage === totalPages}
          >
            Sau
          </button>
          <span className="text-muted small" style={{ minWidth: 100, textAlign: 'center' }}>
            Trang {currentPage} / {totalPages}
          </span>

          {/* Nút đóng được đẩy sang phải */}
          <button
            onClick={onCloseSuggestions}
            className="btn btn-sm btn-outline-danger"
            style={{ marginLeft: 'auto' }}
          >
            Đóng
          </button>
        </div>
      )}
    </div>
  );
};

ProductSuggestions.defaultProps = {
  onCloseSuggestions: () => {},
};

export default ProductSuggestions;
