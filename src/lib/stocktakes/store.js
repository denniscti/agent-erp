// @ts-check
import { invoke } from '../tauri.js';
import {
  appState,
  showToast,
  fetchInventoryLevels
} from '../store.svelte.js';
import { registerNavigationStalenessListener } from '../navigationStaleness.js';
import { isStocktakeLineCounted } from './mocks.js';

export { isStocktakeLineCounted };

export const STOCKTAKE_STATUS_META = {
  draft: { label: '草稿 (draft)', badgeClass: 'badge-gray', progressBadgeClass: null },
  counting: { label: '盤點中 (counting)', badgeClass: 'badge-sky', progressBadgeClass: 'badge-sky' },
  posted: { label: '已過帳 (posted)', badgeClass: 'badge-emerald', progressBadgeClass: 'badge-emerald' },
  cancelled: { label: '已取消 (cancelled)', badgeClass: 'badge-red', progressBadgeClass: null }
};

/**
 * Get CSS badge class for stocktake status
 * @param {string} status
 * @returns {string}
 */
export function getStocktakeStatusBadgeClass(status) {
  return STOCKTAKE_STATUS_META[status]?.badgeClass || 'badge-gray';
}

/**
 * Check if error is an S-07 concurrent inventory movement error
 * @param {any} err
 * @returns {boolean}
 */
export function isStocktakeMovementConflictError(err) {
  if (!err) return false;
  return err.code === 'MOVEMENTS_DETECTED_DURING_COUNTING';
}

/**
 * Format stocktake status to badge label
 * @param {string} status
 * @returns {string}
 */
export function formatStocktakeStatus(status) {
  return STOCKTAKE_STATUS_META[status]?.label || (status || '-');
}

/**
 * Format stocktake progress badge and label
 * @param {object} stk
 * @returns {{ type: 'badge' | 'text', badgeClass?: string, label: string }}
 */
export function formatStocktakeProgress(stk) {
  if (!stk) return { type: 'text', label: '-' };
  if (stk.status === 'draft') return { type: 'text', label: '-' };
  if (stk.status === 'counting') {
    return {
      type: 'badge',
      badgeClass: STOCKTAKE_STATUS_META.counting.progressBadgeClass || 'badge-sky',
      label: `${stk.counted_count ?? 0} / ${stk.lines_count ?? 0}`
    };
  }
  if (stk.status === 'posted') {
    return {
      type: 'badge',
      badgeClass: STOCKTAKE_STATUS_META.posted.progressBadgeClass || 'badge-emerald',
      label: `已完成 (${stk.counted_count ?? 0}/${stk.lines_count ?? 0})`
    };
  }
  return { type: 'text', label: '已取消' };
}

/**
 * Fetch stocktakes with optional filters
 * @param {object | string} [filters={}] - Filter object { status, warehouseId } or legacy status
 * @param {string | null} [legacyWhId=null] - warehouseId if filters is string status
 * @returns {Promise<any[]>}
 */
export async function fetchStocktakes(filters = {}, legacyWhId = null) {
  let status = null;
  let warehouseId = null;

  if (typeof filters === 'object' && filters !== null) {
    status = filters.status || null;
    warehouseId = filters.warehouseId || filters.warehouse_id || null;
  } else if (typeof filters === 'string') {
    status = filters;
    warehouseId = legacyWhId;
  }

  try {
    const payload = {};
    if (status && status !== 'all') {
      payload.status = status;
    }
    if (warehouseId && String(warehouseId).trim() !== '' && warehouseId !== 'all') {
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_stocktakes', payload);
    appState.stocktakes = list || [];
    return appState.stocktakes;
  } catch (err) {
    console.error("Failed to fetch stocktakes:", err);
    throw err;
  }
}

/**
 * Fetch stocktake detail by ID
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function fetchStocktakeDetail(stocktakeId) {
  if (!stocktakeId) return null;
  try {
    const detail = await invoke('get_stocktake', { stocktakeId });
    appState.currentStocktakeDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch stocktake detail:", err);
    throw err;
  }
}

let stocktakeDetailSeq = 0;
const lineUpdateSeqs = new Map();

/**
 * Reset and invalidate stocktake in-flight detail requests and line updates.
 */
export function resetStocktakeDetailSequences() {
  ++stocktakeDetailSeq;
  lineUpdateSeqs.clear();
}

// Automatically subscribe stocktake detail flow to route navigation invalidation
registerNavigationStalenessListener(resetStocktakeDetailSequences);

/**
 * Select active stocktake and load detail
 * @param {string | null} stocktakeId
 */
export async function selectStocktake(stocktakeId) {
  resetStocktakeDetailSequences();
  appState.selectedStocktakeId = stocktakeId;
  if (stocktakeId) {
    const detail = await fetchStocktakeDetail(stocktakeId);
    return detail;
  } else {
    appState.currentStocktakeDetail = null;
    return null;
  }
}

/**
 * Normalize dual snake_case / camelCase fields for stocktake inputs.
 * @param {object} [input={}]
 * @returns {{ warehouseId?: string|null, note?: string|null, taskId?: string|null, initialUnitIds?: string[] }}
 */
export function normalizeStocktakeInput(input = {}) {
  if (!input || typeof input !== 'object') return {};
  const res = {};
  const wh = input.warehouse_id !== undefined ? input.warehouse_id : input.warehouseId;
  if (wh !== undefined) {
    res.warehouseId = wh !== null ? String(wh).trim() : null;
  }
  if (input.note !== undefined) {
    res.note = input.note !== null ? String(input.note).trim() : null;
  }
  const task = input.task_id !== undefined ? input.task_id : input.taskId;
  if (task !== undefined) {
    res.taskId = task ? String(task).trim() : null;
  }
  const units = input.initial_unit_ids !== undefined ? input.initial_unit_ids : input.initialUnitIds;
  if (units !== undefined) {
    res.initialUnitIds = Array.isArray(units) ? units : [units];
  }
  return res;
}

/**
 * Create a new stocktake (draft)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createStocktakeAction(input = {}) {
  const norm = normalizeStocktakeInput(input);

  const payload = {
    warehouseId: norm.warehouseId || '',
    note: norm.note || null,
    taskId: norm.taskId || null
  };
  if (norm.initialUnitIds) {
    payload.initialUnitIds = norm.initialUnitIds;
  }

  try {
    const detail = await invoke('create_stocktake', payload);
    appState.currentStocktakeDetail = detail;
    appState.selectedStocktakeId = detail.stocktake.id;
    await fetchStocktakes();
    showToast(`已建立盤點單「${detail.stocktake.stocktake_number}」！`);
    return detail.stocktake;
  } catch (err) {
    console.error("Failed to create stocktake:", err);
    throw err;
  }
}

/**
 * Update stocktake header
 * @param {string} stocktakeId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updateStocktakeHeaderAction(stocktakeId, updates = {}) {
  const norm = normalizeStocktakeInput(updates);

  try {
    const payload = { stocktakeId };
    if (norm.warehouseId !== undefined) {
      payload.warehouseId = norm.warehouseId || null;
    }
    if (norm.note !== undefined) {
      payload.note = norm.note;
    }
    const detail = await invoke('update_stocktake_header', { payload });
    appState.currentStocktakeDetail = detail;
    patchStocktakeInList(detail.stocktake);
    showToast(`已更新盤點單表頭！`);
    return detail;
  } catch (err) {
    console.error("Failed to update stocktake header:", err);
    throw err;
  }
}

/**
 * Add product units to a draft stocktake
 * @param {string} stocktakeId
 * @param {string[]} unitIds
 * @returns {Promise<any>}
 */
export async function addStocktakeLinesAction(stocktakeId, unitIds) {
  const list = Array.isArray(unitIds) ? unitIds : [unitIds];
  try {
    const detail = await invoke('add_stocktake_lines', {
      stocktakeId,
      unitIds: list
    });
    appState.currentStocktakeDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to add stocktake lines:", err);
    throw err;
  }
}

/**
 * Add all active inventory items from warehouse into draft stocktake (S-04)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function addStocktakeLinesFromStockAction(stocktakeId) {
  try {
    const detail = await invoke('add_stocktake_lines_from_stock', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    showToast(`已帶入此倉現有庫存品項！`);
    return detail;
  } catch (err) {
    console.error("Failed to add stocktake lines from stock:", err);
    throw err;
  }
}

/**
 * Remove a stocktake line
 * @param {string} lineId
 * @returns {Promise<any>}
 */
export async function removeStocktakeLineAction(lineId) {
  try {
    const detail = await invoke('remove_stocktake_line', {
      lineId
    });
    appState.currentStocktakeDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to remove stocktake line:", err);
    throw err;
  }
}

/**
 * Start counting for a draft stocktake (transitions to counting, snapshots balances)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function startStocktakeCountingAction(stocktakeId) {
  try {
    const detail = await invoke('start_stocktake_counting', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    patchStocktakeInList(detail.stocktake);
    showToast(`盤點單「${detail.stocktake.stocktake_number}」已開始盤點！`);
    return detail;
  } catch (err) {
    console.error("Failed to start stocktake counting:", err);
    throw err;
  }
}

/**
 * Update a single stocktake item in appState.stocktakes in-place
 * @param {any} updatedStocktake
 */
export function patchStocktakeInList(updatedStocktake) {
  if (!updatedStocktake || !Array.isArray(appState.stocktakes)) return;
  const idx = appState.stocktakes.findIndex(s => s.id === updatedStocktake.id);
  if (idx !== -1) {
    appState.stocktakes[idx] = { ...appState.stocktakes[idx], ...updatedStocktake };
  }
}

export const STOCKTAKE_VARIANCE_EPSILON = 1e-6;

/**
 * Classify variance delta for a single stocktake line
 * @param {number|null|undefined} countedQuantity
 * @param {number|null|undefined} systemQuantity
 * @returns {'missing' | 'surplus' | 'shortage' | 'matched'}
 */
export function classifyStocktakeLineVariance(countedQuantity, systemQuantity) {
  if (!isStocktakeLineCounted(countedQuantity)) {
    return 'missing';
  }
  const delta = Number(countedQuantity) - (Number(systemQuantity) || 0);
  if (delta > STOCKTAKE_VARIANCE_EPSILON) {
    return 'surplus';
  }
  if (delta < -STOCKTAKE_VARIANCE_EPSILON) {
    return 'shortage';
  }
  return 'matched';
}

/**
 * Calculate post summary metrics for a list of stocktake lines
 * @param {Array<any>} lines
 * @returns {{ surplus: number, shortage: number, matched: number, missing: number }}
 */
export function calculateStocktakePostSummary(lines = []) {
  const summary = { surplus: 0, shortage: 0, matched: 0, missing: 0 };
  for (const line of (lines || [])) {
    const status = classifyStocktakeLineVariance(line.counted_quantity, line.system_quantity);
    summary[status]++;
  }
  return summary;
}

/**
 * Format a bracketed conflict line snapshot label for S-07 conflict reporting and matching.
 * @param {any} line
 * @returns {string}
 */
export function formatStocktakeConflictLineLabel(line) {
  return `〔${line?.product_name_snapshot ?? ''}／${line?.variant_name_snapshot ?? ''}／${line?.unit_name_snapshot ?? ''}〕`;
}

/**
 * Extract affected line IDs from S-07 concurrency conflict error or message.
 * Prioritizes structured `affected_line_ids` / `affectedLineIds` from backend payload.
 * @param {any} errOrMsg
 * @param {Array<any>} lines
 * @returns {string[]} matchedLineIds
 */
export function parseStocktakeConflictLines(errOrMsg, lines = []) {
  if (!errOrMsg || !Array.isArray(lines) || lines.length === 0) {
    return [];
  }
  if (typeof errOrMsg === 'object') {
    const structuredIds = Array.isArray(errOrMsg.affected_line_ids)
      ? errOrMsg.affected_line_ids
      : (Array.isArray(errOrMsg.affectedLineIds) ? errOrMsg.affectedLineIds : null);
    if (structuredIds) {
      const idSet = new Set(structuredIds);
      return lines.filter(l => l && idSet.has(l.id)).map(l => l.id);
    }
  }
  return [];
}

/**
 * Return current number of tracked in-flight/active line sequence entries (for diagnostics/testing)
 * @returns {number}
 */
export function getLineUpdateSeqsSize() {
  return lineUpdateSeqs.size;
}

/**
 * Set counted quantity for a specific stocktake line
 * @param {string} lineId
 * @param {number | string | null} [countedQuantity=null]
 * @returns {Promise<any>}
 */
export async function setStocktakeCountedQuantityAction(lineId, countedQuantity) {
  const currentSeq = ++stocktakeDetailSeq;
  lineUpdateSeqs.set(lineId, currentSeq);
  try {
    const payload = { lineId };
    if (countedQuantity !== undefined) {
      payload.countedQuantity = (countedQuantity === null || countedQuantity === '')
        ? null
        : Number(countedQuantity);
    }
    const updatedLine = await invoke('set_stocktake_counted_quantity', { payload });

    const activeStocktake = appState.currentStocktakeDetail?.stocktake;
    const isMatchingStocktake = activeStocktake && (
      !updatedLine?.stocktake_id || updatedLine.stocktake_id === activeStocktake.id
    );

    if (isMatchingStocktake) {
      const isLatestForLine = lineUpdateSeqs.get(lineId) === currentSeq;
      if (isLatestForLine) {
        if (Array.isArray(appState.currentStocktakeDetail.lines)) {
          const line = appState.currentStocktakeDetail.lines.find(l => l.id === lineId);
          if (line) {
            line.counted_quantity = updatedLine?.counted_quantity !== undefined ? updatedLine.counted_quantity : (payload.countedQuantity ?? null);
          }
        }
      }
    }

    return updatedLine;
  } catch (err) {
    console.error("Failed to set stocktake counted quantity:", err);
    throw err;
  }
}

/**
 * Refresh system quantity snapshots for affected lines (S-08)
 * @param {string} stocktakeId
 * @param {string[]} lineIds
 * @returns {Promise<any>}
 */
export async function refreshStocktakeSystemQuantityAction(stocktakeId, lineIds) {
  const list = Array.isArray(lineIds) ? lineIds : [lineIds];
  try {
    const detail = await invoke('refresh_stocktake_system_quantity', {
      stocktakeId,
      lineIds: list
    });
    appState.currentStocktakeDetail = detail;
    showToast(`已重新取得系統量快照，相關品項實盤量已清空，請重新清點！`);
    return detail;
  } catch (err) {
    console.error("Failed to refresh stocktake system quantity:", err);
    throw err;
  }
}

/**
 * Post stocktake to ledger (transitions to posted, creates movement ledger rows)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function postStocktakeAction(stocktakeId) {
  try {
    const detail = await invoke('post_stocktake', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    await Promise.all([
      fetchStocktakes(),
      fetchInventoryLevels()
    ]);
    showToast(`盤點單「${detail.stocktake.stocktake_number}」已過帳，庫存已同步更新！`);
    return detail.stocktake;
  } catch (err) {
    console.error("Failed to post stocktake:", err);
    const rawErr = /** @type {any} */ (err);
    if (rawErr && typeof rawErr === 'object' && !(rawErr instanceof Error) && rawErr.message) {
      const wrapped = /** @type {any} */ (new Error(rawErr.message));
      if (rawErr.code) wrapped.code = rawErr.code;
      if (Array.isArray(rawErr.affected_line_ids)) wrapped.affected_line_ids = rawErr.affected_line_ids;
      if (Array.isArray(rawErr.affectedLineIds)) wrapped.affectedLineIds = rawErr.affectedLineIds;
      throw wrapped;
    }
    throw err;
  }
}

/**
 * Cancel a stocktake (from draft or counting)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function cancelStocktakeAction(stocktakeId) {
  try {
    const detail = await invoke('cancel_stocktake', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    patchStocktakeInList(detail.stocktake);
    showToast(`已取消盤點單「${detail.stocktake.stocktake_number}」！`);
    return detail.stocktake;
  } catch (err) {
    console.error("Failed to cancel stocktake:", err);
    throw err;
  }
}
