export function normalizeWoItemKey(item = {}) {
  const barcode = String(item.barcode || '').trim().toLowerCase();
  const itemname = String(item.itemname || '').trim().toLowerCase();
  return `${barcode}::${itemname}`;
}

export function mergeWoPendingItems(items = [], incomingItem = {}) {
  const nextItems = [...items];
  const itemKey = normalizeWoItemKey(incomingItem);
  const existingIndex = nextItems.findIndex((item) => normalizeWoItemKey(item) === itemKey);

  if (existingIndex === -1) {
    return [...nextItems, { ...incomingItem, id: `${Date.now()}-${Math.random()}` }];
  }

  const existing = nextItems[existingIndex];
  const existingQty = Number(existing.quantity) || 0;
  const incomingQty = Number(incomingItem.quantity) || 0;

  nextItems[existingIndex] = {
    ...existing,
    ...incomingItem,
    quantity: String(existingQty + incomingQty),
    item_code: existing.item_code || incomingItem.item_code || '',
    unit_cost: existing.unit_cost !== undefined ? existing.unit_cost : incomingItem.unit_cost,
  };

  return nextItems;
}

export function aggregateWoPayload(pendingItems = [], fallbackGroupName = 'WO') {
  const payload = {};

  pendingItems.forEach((item) => {
    const groupName = String(item.groupName || fallbackGroupName || 'WO').trim();
    const itemKey = normalizeWoItemKey(item);

    if (!payload[groupName]) {
      payload[groupName] = [];
    }

    const existingIndex = payload[groupName].findIndex((entry) => normalizeWoItemKey(entry) === itemKey);

    if (existingIndex === -1) {
      payload[groupName].push({
        barcode: item.barcode,
        itemname: item.itemname,
        quantity: item.quantity,
        item_code: item.item_code || '',
        unit_cost: item.unit_cost !== undefined ? item.unit_cost : null,
      });
      return;
    }

    const existing = payload[groupName][existingIndex];
    const existingQty = Number(existing.quantity) || 0;
    const incomingQty = Number(item.quantity) || 0;
    payload[groupName][existingIndex] = {
      ...existing,
      quantity: String(existingQty + incomingQty),
      item_code: existing.item_code || item.item_code || '',
      unit_cost: existing.unit_cost !== undefined ? existing.unit_cost : item.unit_cost,
    };
  });

  return payload;
}
