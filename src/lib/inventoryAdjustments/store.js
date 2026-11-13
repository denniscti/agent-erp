// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast, fetchInventoryLevels } from '../store.svelte.js';

/**
 * Format inventory adjustment reason code to Traditional Chinese
 * @param {string} reason
 * @returns {string}
 */
export function formatAdjustmentReason(reason) {
  switch (reason) {
    case 'damage':
      return '報廢／損壞';
    case 'loss':
      return '盤虧／遺失';
    case 'found':
      return '盤盈／尋獲';
    case 'opening_correction':
      return '期初更正';
    case 'other':
      return '其他';
    default:
      return reason || '-';
  }
}

/**
 * Format inventory adjustment status to badge label
 * @param {string} status
 * @returns {string}
 */
export function formatAdjustmentStatus(status) {
  switch (status) {
    case 'draft':
      return '草稿 (draft)';
    case 'posted':
      return '已過帳 (posted)';
    case 'cancelled':
      return '已取消 (cancelled)';
    default:
      return status || '-';
  }
}

/**
 * Fetch inventory adjustments list from SQLite / Mock
 * @param {any} [arg1=null]
 * @param {any} [arg2=null]
 * @returns {Promise<any[]>}
 */
export async function fetchInventoryAdjustments(arg1 = null, arg2 = null) {
  let status = null;
  let warehouseId = null;

  if (typeof arg1 === 'object' && arg1 !== null) {
    status = arg1.status || null;
    warehouseId = arg1.warehouse_id || arg1.warehouseId || null;
  } else if (arg1 === 'draft' || arg1 === 'posted' || arg1 === 'cancelled') {
    status = arg1;
    warehouseId = arg2;
  } else if (arg2 === 'draft' || arg2 === 'posted' || arg2 === 'cancelled') {
    warehouseId = arg1;
    status = arg2;
  } else if (arg1 && typeof arg1 === 'string' && (arg1.startsWith('wh_') || !arg2)) {
    warehouseId = arg1;
    status = arg2;
  } else {
    status = arg1;
    warehouseId = arg2;
  }

  try {
    const payload = {};
    if (status && status !== 'all') {
      payload.status = status;
    }
    if (warehouseId && String(warehouseId).trim() !== '') {
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_inventory_adjustments', payload);
    appState.inventoryAdjustments = list || [];
    return appState.inventoryAdjustments;
  } catch (err) {
    console.error("Failed to fetch inventory adjustments:", err);
    return [];
  }
}

/**
 * Fetch inventory adjustment detail by ID
 * @param {string} adjustmentId
 * @returns {Promise<any>}
 */
export async function fetchInventoryAdjustmentDetail(adjustmentId) {
  if (!adjustmentId) return null;
  try {
    const detail = await invoke('get_inventory_adjustment', {
      adjustmentId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch inventory adjustment detail:", err);
    throw err;
  }
}

/**
 * Select active inventory adjustment and load detail
 * @param {string | null} adjustmentId
 */
export async function selectInventoryAdjustment(adjustmentId) {
  appState.selectedInventoryAdjustmentId = adjustmentId;
  if (adjustmentId) {
    const detail = await fetchInventoryAdjustmentDetail(adjustmentId);
    return detail;
  } else {
    appState.currentInventoryAdjustmentDetail = null;
    return null;
  }
}

/**
 * Create a new inventory adjustment (draft)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createInventoryAdjustmentAction({
  warehouse_id,
  warehouseId,
  reason_code,
  reasonCode,
  note = null,
  task_id = null,
  taskId = null,
  initial_lines,
  initialLines
} = {}) {
  const targetWhId = String(warehouse_id !== undefined ? warehouse_id : (warehouseId !== undefined ? warehouseId : '')).trim();
  const targetReason = String(reason_code !== undefined ? reason_code : (reasonCode !== undefined ? reasonCode : '')).trim();
  const lines = initial_lines !== undefined ? initial_lines : initialLines;

  const payload = {
    warehouseId: targetWhId,
    reasonCode: targetReason,
    note: note ? String(note).trim() : null,
    taskId: task_id || taskId || null
  };
  if (lines && Array.isArray(lines)) {
    payload.initialLines = lines;
  }

  try {
    const detail = await invoke('create_inventory_adjustment', payload);
    appState.currentInventoryAdjustmentDetail = detail;
    appState.selectedInventoryAdjustmentId = detail.adjustment.id;
    await fetchInventoryAdjustments();
    showToast(`已建立調整單「${detail.adjustment.adjustment_number}」！`);
    return detail.adjustment;
  } catch (err) {
    console.error("Failed to create inventory adjustment:", err);
    throw err;
  }
}

/**
 * Update inventory adjustment header
 * @param {string} adjustmentId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updateInventoryAdjustmentHeaderAction(adjustmentId, {
  warehouse_id,
  warehouseId,
  reason_code,
  reasonCode,
  note
} = {}) {
  const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
  const targetReason = reason_code !== undefined ? reason_code : reasonCode;

  try {
    const detail = await invoke('update_inventory_adjustment_header', {
      adjustmentId,
      warehouseId: targetWhId || null,
      reasonCode: targetReason || null,
      note: note !== undefined ? note : null
    });
    appState.currentInventoryAdjustmentDetail = detail;
    await fetchInventoryAdjustments();
    showToast(`已更新調整單表頭！`);
    return detail;
  } catch (err) {
    console.error("Failed to update inventory adjustment header:", err);
    throw err;
  }
}

/**
 * Add a line to inventory adjustment
 * @param {string} adjustmentId
 * @param {string} unitId
 * @param {number} quantityDelta
 * @returns {Promise<any>}
 */
export async function addInventoryAdjustmentLineAction(adjustmentId, unitId, quantityDelta) {
  try {
    const detail = await invoke('add_inventory_adjustment_line', {
      adjustmentId,
      unitId,
      quantityDelta: Number(quantityDelta)
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to add inventory adjustment line:", err);
    throw err;
  }
}

/**
 * Update quantity delta of an adjustment line
 * @param {string} lineId
 * @param {number} quantityDelta
 * @returns {Promise<any>}
 */
export async function updateInventoryAdjustmentLineAction(lineId, quantityDelta) {
  try {
    const detail = await invoke('update_inventory_adjustment_line', {
      lineId,
      quantityDelta: Number(quantityDelta)
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to update inventory adjustment line:", err);
    throw err;
  }
}

/**
 * Remove an adjustment line
 * @param {string} arg1
 * @param {string | null} [arg2=null]
 * @returns {Promise<any>}
 */
export async function removeInventoryAdjustmentLineAction(arg1, arg2 = null) {
  const targetLineId = arg2 ? String(arg2).trim() : String(arg1).trim();
  try {
    const detail = await invoke('remove_inventory_adjustment_line', {
      lineId: targetLineId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to remove inventory adjustment line:", err);
    throw err;
  }
}

/**
 * Post inventory adjustment to ledger
 * @param {string} adjustmentId
 * @returns {Promise<any>}
 */
export async function postInventoryAdjustmentAction(adjustmentId) {
  try {
    const detail = await invoke('post_inventory_adjustment', {
      adjustmentId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    await Promise.all([
      fetchInventoryAdjustments(),
      fetchInventoryLevels()
    ]);
    showToast(`調整單「${detail.adjustment.adjustment_number}」已過帳，庫存已同步更新！`);
    return detail.adjustment;
  } catch (err) {
    console.error("Failed to post inventory adjustment:", err);
    throw err;
  }
}

/**
 * Cancel a draft inventory adjustment
 * @param {string} adjustmentId
 * @returns {Promise<any>}
 */
export async function cancelInventoryAdjustmentAction(adjustmentId) {
  try {
    const detail = await invoke('cancel_inventory_adjustment', {
      adjustmentId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    await fetchInventoryAdjustments();
    showToast(`已取消調整單「${detail.adjustment.adjustment_number}」！`);
    return detail.adjustment;
  } catch (err) {
    console.error("Failed to cancel inventory adjustment:", err);
    throw err;
  }
}

