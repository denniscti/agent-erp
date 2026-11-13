// @ts-check
import { invoke } from '../tauri.js';
import {
  appState,
  navigate,
  showToast,
  handleZeroWarehouseError,
  fetchInventoryLevels
} from '../store.svelte.js';

/**
 * Fetch purchase orders list
 * @param {any} [filters]
 * @returns {Promise<any[]>}
 */
export async function fetchPurchaseOrders(filters = {}) {
  try {
    const payload = {};
    if (filters.filter_status !== undefined || filters.filterStatus !== undefined) {
      const st = filters.filter_status !== undefined ? filters.filter_status : filters.filterStatus;
      if (st && st !== 'all') {
        payload.filter_status = st;
        payload.filterStatus = st;
      }
    }
    if (filters.filter_vendor_partner_id !== undefined || filters.filterVendorPartnerId !== undefined) {
      payload.filter_vendor_partner_id = filters.filter_vendor_partner_id !== undefined ? filters.filter_vendor_partner_id : filters.filterVendorPartnerId;
      payload.filterVendorPartnerId = payload.filter_vendor_partner_id;
    }
    const list = await invoke('list_purchase_orders', payload);
    appState.purchaseOrders = list || [];
    return appState.purchaseOrders;
  } catch (err) {
    console.error("Failed to fetch purchase orders:", err);
    return [];
  }
}

/**
 * Get purchase order detail
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function fetchPurchaseOrderDetail(orderId) {
  const trimmedId = (orderId || '').trim();
  if (!trimmedId) {
    throw new Error('採購單 ID 為必填項目');
  }
  try {
    const detail = await invoke('get_purchase_order', {
      order_id: trimmedId,
      orderId: trimmedId
    });
    appState.currentPurchaseOrderDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch purchase order detail:", err);
    throw err;
  }
}

/**
 * Navigate to and select a purchase order in PurchaseOrdersWorkspace
 * @param {string} orderId
 */
export async function selectPurchaseOrder(orderId) {
  if (!orderId) return;
  appState.selectedPurchaseOrderId = orderId;
  navigate('/app/purchase-orders');
  try {
    await fetchPurchaseOrderDetail(orderId);
  } catch (e) {
    console.error("Failed to fetch purchase order detail upon selection:", e);
  }
}

/**
 * Create a new purchase order
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createPurchaseOrderAction({
  vendor_partner_id,
  vendorPartnerId,
  currency = 'TWD',
  expected_date,
  expectedDate,
  note,
  warehouse_id,
  warehouseId,
  task_id = null,
  taskId = null,
  initial_lines,
  initialLines
} = {}) {
  const vendorId = String(vendor_partner_id !== undefined ? vendor_partner_id : (vendorPartnerId !== undefined ? vendorPartnerId : '')).trim();
  if (!vendorId) {
    throw new Error('供應商為必填項目');
  }
  const expDate = expected_date !== undefined ? expected_date : expectedDate;
  const lines = initial_lines !== undefined ? initial_lines : initialLines;
  const whId = warehouse_id !== undefined ? warehouse_id : warehouseId;

  const payload = {
    vendor_partner_id: vendorId,
    vendorPartnerId: vendorId,
    currency: currency || 'TWD',
    expected_date: expDate !== undefined && expDate !== null && expDate !== '' ? Number(expDate) : null,
    expectedDate: expDate !== undefined && expDate !== null && expDate !== '' ? Number(expDate) : null,
    note: note ? String(note).trim() : null,
    task_id: task_id || taskId || null,
    taskId: task_id || taskId || null
  };
  if (whId && String(whId).trim()) {
    payload.warehouse_id = String(whId).trim();
    payload.warehouseId = String(whId).trim();
  }
  if (lines && Array.isArray(lines)) {
    payload.initial_lines = lines;
    payload.initialLines = lines;
  }

  try {
    const detail = await invoke('create_purchase_order', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast(`已成功建立採購單「${detail.order.po_number}」！`);
    return detail;
  } catch (err) {
    console.error("Failed to create purchase order:", err);
    handleZeroWarehouseError(err);
    throw err;
  }
}

/**
 * Update purchase order header
 * @param {string} orderId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updatePurchaseOrderHeaderAction(orderId, {
  vendor_partner_id,
  vendorPartnerId,
  expected_date,
  expectedDate,
  note,
  warehouse_id,
  warehouseId
} = {}) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  const payload = {
    order_id: oId,
    orderId: oId
  };
  const vp = vendor_partner_id !== undefined ? vendor_partner_id : vendorPartnerId;
  if (vp !== undefined) {
    payload.vendor_partner_id = vp ? String(vp).trim() : null;
    payload.vendorPartnerId = payload.vendor_partner_id;
  }
  const expDate = expected_date !== undefined ? expected_date : expectedDate;
  if (expDate !== undefined) {
    payload.expected_date = expDate ? Number(expDate) : null;
    payload.expectedDate = payload.expected_date;
  }
  if (note !== undefined) {
    payload.note = note ? String(note).trim() : null;
  }
  const whId = warehouse_id !== undefined ? warehouse_id : warehouseId;
  if (whId !== undefined) {
    payload.warehouse_id = whId ? String(whId).trim() : null;
    payload.warehouseId = payload.warehouse_id;
  }

  try {
    const detail = await invoke('update_purchase_order_header', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('採購單表頭已成功更新！');
    return detail;
  } catch (err) {
    console.error("Failed to update purchase order header:", err);
    throw err;
  }
}

/**
 * Add a line item to a purchase order
 * @param {string} orderId
 * @param {object} lineInput
 * @returns {Promise<any>}
 */
export async function addPurchaseOrderLineAction(orderId, {
  unit_id,
  unitId,
  quantity,
  purchase_cost,
  purchaseCost
} = {}) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');
  const uId = String(unit_id || unitId || '').trim();
  if (!uId) throw new Error('商品單位為必填項目');

  const payload = {
    order_id: oId,
    orderId: oId,
    unit_id: uId,
    unitId: uId,
    quantity: Number(quantity)
  };
  const cost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
  if (cost !== undefined && cost !== null && cost !== '') {
    payload.purchase_cost = Number(cost);
    payload.purchaseCost = Number(cost);
  }

  try {
    const detail = await invoke('add_purchase_order_line', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('已新增採購單明細！');
    return detail;
  } catch (err) {
    console.error("Failed to add purchase order line:", err);
    throw err;
  }
}

/**
 * Update an existing line item in a purchase order
 * @param {string} lineId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updatePurchaseOrderLineAction(lineId, {
  quantity,
  purchase_cost,
  purchaseCost
} = {}) {
  const lId = String(lineId || '').trim();
  if (!lId) throw new Error('明細 ID 為必填項目');

  const payload = {
    line_id: lId,
    lineId: lId
  };
  if (quantity !== undefined) {
    payload.quantity = Number(quantity);
  }
  const cost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
  if (cost !== undefined && cost !== null && cost !== '') {
    payload.purchase_cost = Number(cost);
    payload.purchaseCost = Number(cost);
  }

  try {
    const detail = await invoke('update_purchase_order_line', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('已更新明細項目！');
    return detail;
  } catch (err) {
    console.error("Failed to update purchase order line:", err);
    throw err;
  }
}

/**
 * Remove a line item from a purchase order
 * @param {string} lineId
 * @returns {Promise<any>}
 */
export async function removePurchaseOrderLineAction(lineId) {
  const lId = String(lineId || '').trim();
  if (!lId) throw new Error('明細 ID 為必填項目');

  try {
    const detail = await invoke('remove_purchase_order_line', {
      line_id: lId,
      lineId: lId
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('已刪除明細項目！');
    return detail;
  } catch (err) {
    console.error("Failed to remove purchase order line:", err);
    throw err;
  }
}

/**
 * Submit purchase order (draft -> ordered)
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function submitPurchaseOrderAction(orderId) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  try {
    const detail = await invoke('submit_purchase_order', {
      order_id: oId,
      orderId: oId
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast(`採購單「${detail.order.po_number}」已成功送出下單！`);
    return detail;
  } catch (err) {
    console.error("Failed to submit purchase order:", err);
    throw err;
  }
}

/**
 * Confirm purchase order received (ordered -> received)
 * @param {string | { order_id?: string, orderId?: string }} orderId
 * @param {Array<{ line_id?: string, lineId?: string, received_quantity?: number, receivedQuantity?: number }>} lineReceivedQuantities
 * @returns {Promise<any>}
 */
export async function confirmPurchaseOrderReceivedAction(orderId, lineReceivedQuantities = []) {
  let rawId = orderId;
  if (orderId && typeof orderId === 'object') {
    const obj = /** @type {any} */ (orderId);
    rawId = obj.order_id || obj.orderId;
  }
  const oId = String(rawId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  try {
    const detail = await invoke('confirm_purchase_order_received', {
      order_id: oId,
      orderId: oId,
      line_received_quantities: lineReceivedQuantities,
      lineReceivedQuantities
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    await fetchInventoryLevels();
    showToast(`採購單「${detail.order.po_number}」已完成驗收到貨結案並入庫！`);
    return detail;
  } catch (err) {
    console.error("Failed to confirm purchase order received:", err);
    throw err;
  }
}

/**
 * Cancel purchase order (draft/ordered -> cancelled)
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function cancelPurchaseOrderAction(orderId) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  try {
    const detail = await invoke('cancel_purchase_order', {
      order_id: oId,
      orderId: oId
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast(`採購單「${detail.order.po_number}」已取消！`);
    return detail;
  } catch (err) {
    console.error("Failed to cancel purchase order:", err);
    throw err;
  }
}

