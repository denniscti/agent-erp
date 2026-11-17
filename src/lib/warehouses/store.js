// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Fetch warehouses list
 * @param {boolean} [includeInactive]
 * @returns {Promise<any[]>}
 */
export async function fetchWarehouses(includeInactive = true) {
  try {
    const payload = {};
    if (includeInactive !== null && includeInactive !== undefined) {
      payload.include_inactive = Boolean(includeInactive);
      payload.includeInactive = Boolean(includeInactive);
    }
    const list = await invoke('list_warehouses', payload);
    appState.warehouses = list || [];
    return appState.warehouses;
  } catch (err) {
    console.error("Failed to fetch warehouses:", err);
    return [];
  }
}

/**
 * Create a warehouse
 * @param {string | object} codeOrObj
 * @param {string} [maybeName]
 * @returns {Promise<any>}
 */
export async function createWarehouseAction(codeOrObj, maybeName) {
  let rawCode = codeOrObj;
  let rawName = maybeName;
  if (codeOrObj && typeof codeOrObj === 'object') {
    rawCode = codeOrObj.code;
    rawName = codeOrObj.name;
  }
  const trimmedCode = (rawCode || '').trim();
  const trimmedName = (rawName || '').trim();
  if (!trimmedCode) throw new Error('倉庫代碼為必填項目');
  if (!trimmedName) throw new Error('倉庫名稱為必填項目');
  try {
    const wh = await invoke('create_warehouse', {
      code: trimmedCode,
      name: trimmedName
    });
    await fetchWarehouses();
    showToast(`倉庫「${wh.name} (${wh.code})」建立成功！`);
    if (typeof appState.createWarehouseSuccessCallback === 'function') {
      /** @type {any} */
      const cb = appState.createWarehouseSuccessCallback;
      appState.createWarehouseSuccessCallback = null;
      try {
        await cb(wh);
      } catch (cbErr) {
        console.error("Callback error after warehouse creation:", cbErr);
      }
    }
    return wh;
  } catch (err) {
    console.error("Failed to create warehouse:", err);
    throw err;
  }
}

/**
 * Update warehouse
 * @param {string} id
 * @param {string} code
 * @param {string} name
 * @returns {Promise<any>}
 */
export async function updateWarehouseAction(id, code, name) {
  const trimmedCode = (code || '').trim();
  const trimmedName = (name || '').trim();
  if (!trimmedCode) throw new Error('倉庫代碼為必填項目');
  if (!trimmedName) throw new Error('倉庫名稱為必填項目');
  try {
    const wh = await invoke('update_warehouse', {
      id,
      code: trimmedCode,
      name: trimmedName
    });
    await fetchWarehouses();
    showToast(`倉庫「${wh.name}」已更新！`);
    return wh;
  } catch (err) {
    console.error("Failed to update warehouse:", err);
    throw err;
  }
}

/**
 * Set default warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function setDefaultWarehouseAction(id) {
  try {
    const wh = await invoke('set_default_warehouse', { id });
    await fetchWarehouses();
    showToast(`已將「${wh.name}」設為預設倉！`);
    return wh;
  } catch (err) {
    console.error("Failed to set default warehouse:", err);
    throw err;
  }
}

/**
 * Deactivate warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deactivateWarehouseAction(id) {
  try {
    const wh = await invoke('deactivate_warehouse', { id });
    await fetchWarehouses();
    showToast(`已停用倉庫「${wh.name}」！`);
    return wh;
  } catch (err) {
    console.error("Failed to deactivate warehouse:", err);
    throw err;
  }
}

/**
 * Reactivate warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function reactivateWarehouseAction(id) {
  try {
    const wh = await invoke('reactivate_warehouse', { id });
    await fetchWarehouses();
    showToast(`已重新啟用倉庫「${wh.name}」！`);
    return wh;
  } catch (err) {
    console.error("Failed to reactivate warehouse:", err);
    throw err;
  }
}

/**
 * Open create warehouse modal with optional success callback
 * @param {((wh?: any) => (Promise<any> | void)) | null} [onSuccess=null]
 */
export function openCreateWarehouseModal(onSuccess = null) {
  appState.isCreateWarehouseModalOpen = true;
  appState.createWarehouseSuccessCallback = typeof onSuccess === 'function' ? onSuccess : null;
}

export function closeCreateWarehouseModal() {
  appState.isCreateWarehouseModalOpen = false;
  appState.createWarehouseSuccessCallback = null;
}

/**
 * Check if an error corresponds to W-00 (Zero Warehouse Defense)
 * @param {any} err
 * @returns {boolean}
 */
export function isZeroWarehouseError(err) {
  const errMsg = err instanceof Error ? err.message : String(err || '');
  return errMsg.includes('尚未建立任何倉別') || errMsg.includes('W-00');
}

/**
 * Handle W-00 error by opening the Create Warehouse Modal
 * @param {any} err
 * @param {((wh?: any) => (Promise<any> | void)) | null} [onSuccess=null]
 * @returns {boolean}
 */
export function handleZeroWarehouseError(err, onSuccess = null) {
  if (isZeroWarehouseError(err)) {
    openCreateWarehouseModal(onSuccess);
    return true;
  }
  return false;
}

/**
 * Format inventory movement reason into unified Traditional Chinese badge label
 * @param {string} reason
 * @returns {string}
 */
export function formatMovementReason(reason) {
  switch (reason) {
    case 'opening_balance':
      return '期初開帳';
    case 'purchase_receipt':
      return '採購單入庫';
    case 'adjustment':
    case 'inventory_adjustment':
      return '庫存調整';
    case 'stocktake':
    case 'stocktake_discrepancy':
      return '盤點盈虧';
    case 'transfer_out':
      return '調撥出庫';
    case 'transfer_in':
      return '調撥入庫';
    case 'unit_conversion_out':
      return '單位轉換出庫';
    case 'unit_conversion_in':
      return '單位轉換入庫';
    default:
      return reason || '-';
  }
}

/**
 * Get warehouse display name
 * @param {string | null | undefined} whId
 * @param {string} [defaultLabel='未指定倉庫']
 * @returns {string}
 */
export function getWarehouseName(whId, defaultLabel = '未指定倉庫') {
  if (!whId) return defaultLabel;
  const wh = (appState.warehouses || []).find(w => w.id === whId);
  return wh ? `${wh.name} (${wh.code})` : whId;
}

// ==========================================
// Inventory Management (Shared / Warehouse)
// ==========================================

/**
 * Fetch inventory levels
 * @param {string | null} [warehouseId]
 * @returns {Promise<any[]>}
 */
export async function fetchInventoryLevels(warehouseId = null) {
  try {
    const payload = {};
    if (warehouseId && String(warehouseId).trim()) {
      payload.warehouse_id = String(warehouseId).trim();
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_inventory_levels', payload);
    appState.inventoryLevels = list || [];
    return appState.inventoryLevels;
  } catch (err) {
    console.error("Failed to fetch inventory levels:", err);
    return [];
  }
}

/**
 * Fetch inventory level for a specific warehouse and unit
 * @param {string} warehouseId
 * @param {string} unitId
 * @returns {Promise<any>}
 */
export async function fetchUnitInventoryLevel(warehouseId, unitId) {
  if (!warehouseId || !unitId) return null;
  try {
    const level = await invoke('get_inventory_level', {
      warehouse_id: String(warehouseId).trim(),
      warehouseId: String(warehouseId).trim(),
      unit_id: String(unitId).trim(),
      unitId: String(unitId).trim()
    });
    return level;
  } catch (err) {
    console.error("Failed to fetch unit inventory level:", err);
    throw err;
  }
}

/**
 * Fetch inventory movements for a unit (or all)
 * @param {string} [unitId]
 * @param {string | null} [warehouseId]
 * @returns {Promise<any[]>}
 */
export async function fetchInventoryMovements(unitId, warehouseId = null) {
  try {
    const payload = {};
    if (unitId && String(unitId).trim()) {
      payload.unit_id = String(unitId).trim();
      payload.unitId = String(unitId).trim();
    }
    if (warehouseId && String(warehouseId).trim()) {
      payload.warehouse_id = String(warehouseId).trim();
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_inventory_movements', payload);
    appState.inventoryMovements = list || [];
    return appState.inventoryMovements;
  } catch (err) {
    console.error("Failed to fetch inventory movements:", err);
    return [];
  }
}

/**
 * Record opening inventory balance (R-17)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function recordOpeningInventoryBalanceAction({
  unit_id,
  unitId,
  quantity,
  quantity_delta,
  quantityDelta,
  unit_cost,
  unitCost,
  warehouse_id,
  warehouseId
} = {}) {
  const uId = String(unit_id || unitId || '').trim();
  if (!uId) throw new Error('商品單位 ID 為必填項目');

  const rawQty = quantity !== undefined ? quantity : (quantity_delta !== undefined ? quantity_delta : quantityDelta);
  const rawCost = unit_cost !== undefined ? unit_cost : unitCost;
  const whId = warehouse_id !== undefined ? warehouse_id : warehouseId;

  const payload = {
    unit_id: uId,
    unitId: uId,
    quantity_delta: Number(rawQty),
    quantityDelta: Number(rawQty),
    unit_cost: Number(rawCost),
    unitCost: Number(rawCost)
  };
  if (whId && String(whId).trim()) {
    payload.warehouse_id = String(whId).trim();
    payload.warehouseId = String(whId).trim();
  }

  try {
    const movement = await invoke('record_opening_inventory_balance', payload);
    await fetchInventoryLevels();
    showToast('已成功建立期初庫存底帳！');
    return movement;
  } catch (err) {
    console.error("Failed to record opening inventory balance:", err);
    handleZeroWarehouseError(err);
    throw err;
  }
}

// ==========================================
// Unit Conversions Actions (Issue #230)
// ==========================================

/**
 * Fetch unit conversions list with optional filters
 * @param {string | null} [status]
 * @param {string | null} [warehouseId]
 * @returns {Promise<any[]>}
 */
export async function fetchUnitConversions(status = null, warehouseId = null) {
  try {
    const payload = {};
    if (status && status !== 'all') {
      payload.status = status;
    }
    if (warehouseId && String(warehouseId).trim() !== '') {
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_unit_conversions', payload);
    appState.unitConversions = list || [];
    return appState.unitConversions;
  } catch (err) {
    console.error("Failed to fetch unit conversions:", err);
    return [];
  }
}

/**
 * Fetch unit conversion detail by ID
 * @param {string} conversionId
 * @returns {Promise<any>}
 */
export async function fetchUnitConversionDetail(conversionId) {
  if (!conversionId) return null;
  try {
    const detail = await invoke('get_unit_conversion', { conversionId });
    appState.currentUnitConversion = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch unit conversion detail:", err);
    throw err;
  }
}

/**
 * Select active unit conversion and load detail
 * @param {string | null} conversionId
 */
export async function selectUnitConversion(conversionId) {
  appState.selectedUnitConversionId = conversionId;
  if (conversionId) {
    return await fetchUnitConversionDetail(conversionId);
  } else {
    appState.currentUnitConversion = null;
    return null;
  }
}

/**
 * Create a new unit conversion (draft)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createUnitConversionAction({
  warehouse_id,
  warehouseId,
  from_unit_id,
  fromUnitId,
  from_quantity,
  fromQuantity,
  to_unit_id,
  toUnitId,
  to_quantity,
  toQuantity,
  note = null,
  task_id = null,
  taskId = null
}) {
  try {
    const targetWh = warehouse_id !== undefined ? warehouse_id : warehouseId;
    const targetFromUnit = from_unit_id !== undefined ? from_unit_id : fromUnitId;
    const targetFromQty = from_quantity !== undefined ? from_quantity : fromQuantity;
    const targetToUnit = to_unit_id !== undefined ? to_unit_id : toUnitId;
    const targetToQty = to_quantity !== undefined ? to_quantity : toQuantity;
    const targetTask = task_id !== undefined ? task_id : taskId;

    const ucv = await invoke('create_unit_conversion', {
      warehouseId: targetWh,
      fromUnitId: targetFromUnit,
      fromQuantity: Number(targetFromQty),
      toUnitId: targetToUnit,
      toQuantity: Number(targetToQty),
      note: note || null,
      taskId: targetTask || null
    });
    appState.currentUnitConversion = ucv;
    appState.selectedUnitConversionId = ucv.id;
    await fetchUnitConversions();
    showToast(`已建立單位轉換單「${ucv.conversion_number}」！`);
    return ucv;
  } catch (err) {
    console.error("Failed to create unit conversion:", err);
    throw err;
  }
}

/**
 * Post a draft unit conversion (deducts from_unit, adds to_unit)
 * @param {string} conversionId
 * @returns {Promise<any>}
 */
export async function postUnitConversionAction(conversionId) {
  try {
    const ucv = await invoke('post_unit_conversion', { conversionId });
    appState.currentUnitConversion = ucv;
    await fetchUnitConversions();
    showToast(`已過帳單位轉換單「${ucv.conversion_number}」！`);
    return ucv;
  } catch (err) {
    console.error("Failed to post unit conversion:", err);
    throw err;
  }
}

/**
 * Cancel a draft unit conversion
 * @param {string} conversionId
 * @returns {Promise<any>}
 */
export async function cancelUnitConversionAction(conversionId) {
  try {
    const ucv = await invoke('cancel_unit_conversion', { conversionId });
    appState.currentUnitConversion = ucv;
    await fetchUnitConversions();
    showToast(`已取消單位轉換單「${ucv.conversion_number}」！`);
    return ucv;
  } catch (err) {
    console.error("Failed to cancel unit conversion:", err);
    throw err;
  }
}

