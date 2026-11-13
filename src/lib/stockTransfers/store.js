// @ts-check
import { invoke } from '../tauri.js';
import {
  appState,
  showToast,
  fetchInventoryLevels,
  fetchInventoryMovements
} from '../store.svelte.js';

/**
 * Update a single stock transfer in appState.stockTransfers in-place
 * @param {any} updatedTransfer
 */
export function patchStockTransferInList(updatedTransfer) {
  if (!updatedTransfer || !Array.isArray(appState.stockTransfers)) return;
  const idx = appState.stockTransfers.findIndex(t => t.id === updatedTransfer.id);
  if (idx !== -1) {
    appState.stockTransfers[idx] = { ...appState.stockTransfers[idx], ...updatedTransfer };
  }
}

/**
 * Fetch list of stock transfers with optional filters
 * @param {{ status?: string, fromWarehouseId?: string, toWarehouseId?: string }} [filters]
 * @returns {Promise<any[]>}
 */
export async function fetchStockTransfers(filters = {}) {
  try {
    const payload = {};
    if (filters.status && String(filters.status).trim()) {
      payload.status = String(filters.status).trim();
    }
    if (filters.fromWarehouseId && String(filters.fromWarehouseId).trim()) {
      payload.fromWarehouseId = String(filters.fromWarehouseId).trim();
    }
    if (filters.toWarehouseId && String(filters.toWarehouseId).trim()) {
      payload.toWarehouseId = String(filters.toWarehouseId).trim();
    }
    const list = await invoke('list_stock_transfers', payload);
    appState.stockTransfers = list || [];
    return appState.stockTransfers;
  } catch (err) {
    console.error("Failed to fetch stock transfers:", err);
    throw err;
  }
}

/**
 * Fetch detail of a single stock transfer
 * @param {string} transferId
 * @returns {Promise<any>}
 */
export async function fetchStockTransferDetail(transferId) {
  try {
    const detail = await invoke('get_stock_transfer', { transferId });
    appState.currentStockTransferDetail = detail;
    appState.selectedStockTransferId = detail.transfer.id;
    patchStockTransferInList(detail.transfer);
    return detail;
  } catch (err) {
    console.error("Failed to fetch stock transfer detail:", err);
    throw err;
  }
}

/**
 * Create a new stock transfer
 * @param {{ fromWarehouseId: string, toWarehouseId: string, note?: string | null, taskId?: string | null, initialLines?: any[] }} params
 * @returns {Promise<any>}
 */
export async function createStockTransferAction({
  fromWarehouseId,
  toWarehouseId,
  note = null,
  taskId = null,
  initialLines = []
}) {
  try {
    const payload = {
      fromWarehouseId,
      toWarehouseId,
      note: note || null,
      taskId: taskId || null,
      initialLines: Array.isArray(initialLines) && initialLines.length > 0 ? initialLines : null
    };
    const detail = await invoke('create_stock_transfer', payload);
    appState.currentStockTransferDetail = detail;
    appState.selectedStockTransferId = detail.transfer.id;
    appState.stockTransfers = [detail.transfer, ...appState.stockTransfers.filter(t => t.id !== detail.transfer.id)];
    showToast(`調撥單「${detail.transfer.transfer_number}」建立成功！`);
    return detail;
  } catch (err) {
    console.error("Failed to create stock transfer:", err);
    throw err;
  }
}

/**
 * Update stock transfer header
 * @param {{ transferId: string, fromWarehouseId?: string, toWarehouseId?: string, note?: string|null }} params
 * @returns {Promise<any>}
 */
export async function updateStockTransferHeaderAction({
  transferId,
  fromWarehouseId,
  toWarehouseId,
  note
}) {
  try {
    const payload = {
      transferId,
      fromWarehouseId: fromWarehouseId !== undefined ? fromWarehouseId : null,
      toWarehouseId: toWarehouseId !== undefined ? toWarehouseId : null,
      note: note !== undefined ? note : null
    };
    const detail = await invoke('update_stock_transfer_header', payload);
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("調撥單表頭更新成功！");
    return detail;
  } catch (err) {
    console.error("Failed to update stock transfer header:", err);
    throw err;
  }
}

/**
 * Add a line to a draft stock transfer
 * @param {string} transferId
 * @param {string} unitId
 * @param {number} quantity
 * @returns {Promise<any>}
 */
export async function addStockTransferLineAction(transferId, unitId, quantity) {
  try {
    const detail = await invoke('add_stock_transfer_line', {
      transferId,
      unitId,
      quantity: Number(quantity)
    });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("新增調撥明細成功！");
    return detail;
  } catch (err) {
    console.error("Failed to add stock transfer line:", err);
    throw err;
  }
}

/**
 * Update quantity of a line in a draft stock transfer
 * @param {string} lineId
 * @param {number} quantity
 * @returns {Promise<any>}
 */
export async function updateStockTransferLineAction(lineId, quantity) {
  try {
    const detail = await invoke('update_stock_transfer_line', {
      lineId,
      quantity: Number(quantity)
    });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("調撥數量更新成功！");
    return detail;
  } catch (err) {
    console.error("Failed to update stock transfer line:", err);
    throw err;
  }
}

/**
 * Remove a line from a draft stock transfer
 * @param {string} lineId
 * @returns {Promise<any>}
 */
export async function removeStockTransferLineAction(lineId) {
  try {
    const detail = await invoke('remove_stock_transfer_line', { lineId });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("已移除調撥明細！");
    return detail;
  } catch (err) {
    console.error("Failed to remove stock transfer line:", err);
    throw err;
  }
}

/**
 * Post a stock transfer
 * @param {string} transferId
 * @returns {Promise<any>}
 */
export async function postStockTransferAction(transferId) {
  try {
    const detail = await invoke('post_stock_transfer', { transferId });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast(`調撥單「${detail.transfer.transfer_number}」已成功過帳！`);
    // Refresh inventory levels and movements
    fetchInventoryLevels().catch(() => {});
    fetchInventoryMovements().catch(() => {});
    return detail;
  } catch (err) {
    console.error("Failed to post stock transfer:", err);
    throw err;
  }
}

/**
 * Cancel a stock transfer
 * @param {string} transferId
 * @returns {Promise<any>}
 */
export async function cancelStockTransferAction(transferId) {
  try {
    const detail = await invoke('cancel_stock_transfer', { transferId });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast(`已取消調撥單「${detail.transfer.transfer_number}」！`);
    return detail;
  } catch (err) {
    console.error("Failed to cancel stock transfer:", err);
    throw err;
  }
}

