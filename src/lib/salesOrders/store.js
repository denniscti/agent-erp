// @ts-check
import { invoke } from '../tauri.js';
import { appState, navigate, fetchInventoryLevels } from '../store.svelte.js';

/**
 * Navigate to Sales Orders workspace and open a specific sales order detail
 * @param {string} orderId
 */
export function selectSalesOrder(orderId) {
  if (!orderId) return;
  appState.selectedSalesOrderId = orderId;
  navigate('/app/sales-orders');
}

/**
 * Fetch sales orders list with optional filters
 * @param {Object} [filter]
 * @returns {Promise<any[]>}
 */
export async function fetchSalesOrders(filter = {}) {
  try {
    const payload = {};
    if (filter.status && filter.status !== 'all') {
      payload.status = String(filter.status).trim();
    }
    const cid = filter.customer_partner_id !== undefined ? filter.customer_partner_id : filter.customerPartnerId;
    if (cid && String(cid).trim()) {
      const trimmedCid = String(cid).trim();
      payload.customer_partner_id = trimmedCid;
      payload.customerPartnerId = trimmedCid;
    }
    const wid = filter.warehouse_id !== undefined ? filter.warehouse_id : filter.warehouseId;
    if (wid && String(wid).trim()) {
      const trimmedWid = String(wid).trim();
      payload.warehouse_id = trimmedWid;
      payload.warehouseId = trimmedWid;
    }
    const list = await invoke('list_sales_orders', payload);
    appState.salesOrders = list || [];
    return appState.salesOrders;
  } catch (err) {
    console.error("Failed to fetch sales orders:", err);
    throw err;
  }
}

/**
 * Fetch sales order detail by order ID
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function fetchSalesOrderDetail(orderId) {
  const trimmedId = String(orderId || '').trim();
  if (!trimmedId) {
    throw new Error('銷售單 ID 為必填項目');
  }
  try {
    const detail = await invoke('get_sales_order', {
      order_id: trimmedId,
      orderId: trimmedId
    });
    appState.currentSalesOrderDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch sales order detail:", err);
    throw err;
  }
}

/**
 * Ship a confirmed sales order (warehouse shipment form)
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function shipSalesOrderAction(input) {
  try {
    const raw = input || {};
    const orderId = String(raw.order_id || raw.orderId || '').trim();
    if (!orderId) {
      throw new Error('銷售單 ID 為必填項目');
    }
    const shipDate = raw.ship_date !== undefined ? raw.ship_date : raw.shipDate;
    const lineQtys = raw.line_shipped_quantities !== undefined ? raw.line_shipped_quantities : raw.lineShippedQuantities;
    const note = raw.note !== undefined ? raw.note : raw.shipNote;
    const today = raw.today_override !== undefined ? raw.today_override : raw.todayOverride;

    const payload = {
      order_id: orderId,
      orderId: orderId
    };
    if (shipDate !== undefined && shipDate !== null && String(shipDate).trim() !== '') {
      const d = String(shipDate).trim();
      payload.ship_date = d;
      payload.shipDate = d;
    }
    if (lineQtys !== undefined && lineQtys !== null) {
      payload.line_shipped_quantities = lineQtys;
      payload.lineShippedQuantities = lineQtys;
    }
    if (note !== undefined && note !== null && String(note).trim() !== '') {
      payload.note = String(note).trim();
    }
    if (today !== undefined && today !== null && String(today).trim() !== '') {
      const t = String(today).trim();
      payload.today_override = t;
      payload.todayOverride = t;
    }

    const detail = await invoke('ship_sales_order', payload);
    appState.currentSalesOrderDetail = detail;
    await fetchSalesOrders(raw.listFilter || {});
    await fetchInventoryLevels();
    return detail;
  } catch (err) {
    console.error("Failed to ship sales order:", err);
    throw err;
  }
}

/**
 * Cancel a confirmed sales order (warehouse or sales)
 * @param {string | Object} input
 * @returns {Promise<any>}
 */
export async function cancelSalesOrderAction(input) {
  try {
    const raw = typeof input === 'string' ? { order_id: input } : (input || {});
    const orderId = String(raw.order_id || raw.orderId || '').trim();
    if (!orderId) {
      throw new Error('銷售單 ID 為必填項目');
    }
    const detail = await invoke('cancel_sales_order', {
      order_id: orderId,
      orderId: orderId
    });
    appState.currentSalesOrderDetail = detail;
    await fetchSalesOrders(raw.listFilter || {});
    return detail;
  } catch (err) {
    console.error("Failed to cancel sales order:", err);
    throw err;
  }
}

