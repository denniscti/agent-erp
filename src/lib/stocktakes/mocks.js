// @ts-check
import {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import {
  mockProducts,
  mockProductVariants,
  mockProductUnits
} from '../products/mocks.js';
import { validateMockWarehouseActive } from '../warehouses/mocks.js';
import { mockInventoryMovements } from '../tauri.js';

export let mockStocktakes = loadStorage('agent_erp_mock_stocktakes', []);
if (!mockStocktakes || !Array.isArray(mockStocktakes)) {
  mockStocktakes = [];
  saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
}

export let mockStocktakeLines = loadStorage('agent_erp_mock_stocktake_lines', []);
if (!mockStocktakeLines || !Array.isArray(mockStocktakeLines)) {
  mockStocktakeLines = [];
  saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
}

export function isStocktakeLineCounted(val) {
  if (val !== null && typeof val === 'object') {
    return val.counted_quantity !== null && val.counted_quantity !== undefined && val.counted_quantity !== '';
  }
  return val !== null && val !== undefined && val !== '';
}

export function nextMockStkNumber(tenantId) {
  let maxSeq = 0;
  for (const stk of mockStocktakes) {
    if ((stk.tenant_id || 'tnt_mock_1') === tenantId && stk.stocktake_number && stk.stocktake_number.startsWith('STK-')) {
      const num = parseInt(stk.stocktake_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `STK-${String(maxSeq + 1).padStart(5, '0')}`;
}

export function formatMockStocktakeDetail(stocktake) {
  const lines = mockStocktakeLines
    .filter(l => l.stocktake_id === stocktake.id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    stocktake: { ...stocktake },
    lines: lines.map(l => ({ ...l }))
  };
}

export function resolveMockUnitSnapshot(tenantId, unitId) {
  const targetUid = String(unitId || '').trim();
  const unit = mockProductUnits.find(u => u.id === targetUid);
  if (!unit) {
    throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
  }
  const variant = mockProductVariants.find(v => v.id === unit.variant_id);
  if (!variant) {
    throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
  }
  const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === tenantId);
  if (!product) {
    throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
  }
  return { unit, variant, product };
}

export const stocktakeMocks = {
  create_stocktake: async (args) => {
    const {
      warehouse_id, warehouseId,
      note,
      task_id, taskId,
      initial_unit_ids, initialUnitIds
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const targetWhId = String(warehouse_id || warehouseId || '').trim();
    validateMockWarehouseActive(targetTenantId, targetWhId);

    const now = Math.floor(Date.now() / 1000);
    const stkId = nextMockUid('stk');
    const stkNumber = nextMockStkNumber(targetTenantId);

    const unitList = initial_unit_ids || initialUnitIds || [];
    const seenUnits = new Set();
    const createdLines = [];

    for (let idx = 0; idx < unitList.length; idx++) {
      const uId = String(unitList[idx] || '').trim();
      if (!uId) {
        throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
      }
      if (seenUnits.has(uId)) {
        throw new Error('此品項已在盤點單中');
      }
      seenUnits.add(uId);

      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
      const lineId = nextMockUid('stkl');
      const newLine = {
        id: lineId,
        stocktake_id: stkId,
        line_no: idx + 1,
        unit_id: uId,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || null,
        unit_name_snapshot: unit.name,
        system_quantity: null,
        system_quantity_at: null,
        counted_quantity: null,
        created_at: now
      };
      createdLines.push(newLine);
    }

    const newStk = {
      id: stkId,
      tenant_id: targetTenantId,
      stocktake_number: stkNumber,
      warehouse_id: targetWhId,
      status: 'draft',
      note: note ? String(note).trim() : null,
      created_by: activeUid,
      created_at: now,
      counting_started_at: null,
      posted_at: null,
      cancelled_at: null,
      task_id: task_id || taskId || null
    };

    mockStocktakes.push(newStk);
    for (const line of createdLines) {
      mockStocktakeLines.push(line);
    }

    saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);

    return formatMockStocktakeDetail(newStk);
  },

  update_stocktake_header: async (args) => {
    const effectiveArgs = (args && args.payload) ? args.payload : (args || {});
    const {
      stocktake_id, stocktakeId,
      warehouse_id, warehouseId,
      note
    } = effectiveArgs;
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'draft') {
      throw new Error(`盤點單狀態為 ${stk.status}，僅草稿狀態可修改表頭`);
    }

    const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    if (targetWhId !== undefined && targetWhId !== null) {
      const trimmedWh = String(targetWhId).trim();
      validateMockWarehouseActive(targetTenantId, trimmedWh);
      stk.warehouse_id = trimmedWh;
    }
    if (note !== undefined) {
      stk.note = note ? String(note).trim() : null;
    }

    saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
    return formatMockStocktakeDetail(stk);
  },

  add_stocktake_lines: async (args) => {
    const {
      stocktake_id, stocktakeId,
      unit_ids, unitIds
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'draft') {
      throw new Error(`盤點單狀態為 ${stk.status}，僅草稿狀態可新增品項`);
    }

    const existingUnits = new Set(
      mockStocktakeLines.filter(l => l.stocktake_id === targetStkId).map(l => l.unit_id)
    );
    let maxLineNo = mockStocktakeLines
      .filter(l => l.stocktake_id === targetStkId)
      .reduce((max, l) => Math.max(max, l.line_no || 0), 0);

    const unitList = unit_ids || unitIds || [];
    const now = Math.floor(Date.now() / 1000);

    for (const rawUid of unitList) {
      const uId = String(rawUid || '').trim();
      if (!uId) {
        throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
      }
      if (existingUnits.has(uId)) {
        throw new Error('此品項已在盤點單中');
      }
      existingUnits.add(uId);

      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
      maxLineNo++;
      const lineId = nextMockUid('stkl');
      mockStocktakeLines.push({
        id: lineId,
        stocktake_id: targetStkId,
        line_no: maxLineNo,
        unit_id: uId,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || null,
        unit_name_snapshot: unit.name,
        system_quantity: null,
        system_quantity_at: null,
        counted_quantity: null,
        created_at: now
      });
    }

    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return formatMockStocktakeDetail(stk);
  },

  add_stocktake_lines_from_stock: async (args) => {
    const { stocktake_id, stocktakeId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'draft') {
      throw new Error(`盤點單狀態為 ${stk.status}，僅草稿狀態可新增品項`);
    }

    const balances = {};
    for (const m of (mockInventoryMovements || [])) {
      if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === stk.warehouse_id) {
        balances[m.unit_id] = (balances[m.unit_id] || 0) + m.quantity_delta;
      }
    }

    const existingUnits = new Set(
      mockStocktakeLines.filter(l => l.stocktake_id === targetStkId).map(l => l.unit_id)
    );
    let maxLineNo = mockStocktakeLines
      .filter(l => l.stocktake_id === targetStkId)
      .reduce((max, l) => Math.max(max, l.line_no || 0), 0);

    const now = Math.floor(Date.now() / 1000);
    for (const [uId, bal] of Object.entries(balances)) {
      if (Math.abs(bal) > 1e-6 && !existingUnits.has(uId)) {
        existingUnits.add(uId);
        const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
        maxLineNo++;
        const lineId = nextMockUid('stkl');
        mockStocktakeLines.push({
          id: lineId,
          stocktake_id: targetStkId,
          line_no: maxLineNo,
          unit_id: uId,
          product_name_snapshot: product.name,
          variant_name_snapshot: variant.name,
          sku_snapshot: variant.sku || null,
          unit_name_snapshot: unit.name,
          system_quantity: null,
          system_quantity_at: null,
          counted_quantity: null,
          created_at: now
        });
      }
    }

    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return formatMockStocktakeDetail(stk);
  },

  remove_stocktake_line: async (args) => {
    const { line_id, lineId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetLineId = String(line_id || lineId || '').trim();
    const line = mockStocktakeLines.find(l => l.id === targetLineId);
    if (!line) {
      throw new Error('找不到指定的盤點單明細行');
    }
    const stk = mockStocktakes.find(s => s.id === line.stocktake_id && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到指定的盤點單明細行');
    }
    if (stk.status !== 'draft' && stk.status !== 'counting') {
      throw new Error(`盤點單狀態為 ${stk.status}，不可刪除明細`);
    }

    mockStocktakeLines = mockStocktakeLines.filter(l => l.id !== targetLineId);
    const remaining = mockStocktakeLines
      .filter(l => l.stocktake_id === stk.id)
      .sort((a, b) => a.line_no - b.line_no);
    for (let i = 0; i < remaining.length; i++) {
      remaining[i].line_no = i + 1;
    }

    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return formatMockStocktakeDetail(stk);
  },

  start_stocktake_counting: async (args) => {
    const { stocktake_id, stocktakeId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${stk.status} 轉換至 counting`);
    }

    validateMockWarehouseActive(targetTenantId, stk.warehouse_id);

    const lines = mockStocktakeLines.filter(l => l.stocktake_id === targetStkId);
    if (lines.length === 0) {
      throw new Error('盤點單沒有任何品項');
    }

    // S-05: Check mutual exclusion in the same warehouse
    for (const line of lines) {
      const conflictStk = mockStocktakes.find(s =>
        (s.tenant_id || 'tnt_mock_1') === targetTenantId &&
        s.warehouse_id === stk.warehouse_id &&
        s.status === 'counting' &&
        s.id !== stk.id &&
        mockStocktakeLines.some(otherL => otherL.stocktake_id === s.id && otherL.unit_id === line.unit_id)
      );

      if (conflictStk) {
        throw new Error(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕已在盤點單 ${conflictStk.stocktake_number} 盤點中`);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    stk.status = 'counting';
    stk.counting_started_at = now;

    for (const line of lines) {
      let bal = 0;
      let count = 0;
      for (const m of (mockInventoryMovements || [])) {
        if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === stk.warehouse_id && m.unit_id === line.unit_id) {
          bal += m.quantity_delta;
          count += 1;
        }
      }
      line.system_quantity = bal;
      line.system_quantity_at = now;
      line.system_movements_count = count;
      line.counted_quantity = null;
    }

    saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return formatMockStocktakeDetail(stk);
  },

  set_stocktake_counted_quantity: async (args) => {
    const effectiveArgs = (args && args.payload) ? args.payload : (args || {});
    const { line_id, lineId, counted_quantity, countedQuantity } = effectiveArgs;
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetLineId = String(line_id || lineId || '').trim();
    const line = mockStocktakeLines.find(l => l.id === targetLineId);
    if (!line) {
      throw new Error('找不到指定的盤點單明細行');
    }
    const stk = mockStocktakes.find(s => s.id === line.stocktake_id && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到指定的盤點單明細行');
    }
    if (stk.status !== 'counting') {
      throw new Error('只有盤點中 (counting) 狀態可輸入實盤量');
    }

    const hasQty = counted_quantity !== undefined || countedQuantity !== undefined;
    if (hasQty) {
      const rawQty = counted_quantity !== undefined ? counted_quantity : countedQuantity;
      if (rawQty === '' || rawQty === null) {
        line.counted_quantity = null;
      } else {
        const qty = Number(rawQty);
        if (isNaN(qty) || qty < 0) {
          throw new Error('實盤量不可為負');
        }
        line.counted_quantity = qty;
      }
      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    }
    return {
      ...line
    };
  },

  refresh_stocktake_system_quantity: async (args) => {
    const { stocktake_id, stocktakeId, line_ids, lineIds } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'counting') {
      throw new Error('只有 counting 狀態可以重新取得系統量');
    }

    const targetLineIds = line_ids || lineIds || [];
    const now = Math.floor(Date.now() / 1000);

    for (const lid of targetLineIds) {
      const line = mockStocktakeLines.find(l => l.id === lid && l.stocktake_id === targetStkId);
      if (!line) {
        throw new Error('找不到指定的盤點單明細行');
      }

      let bal = 0;
      let count = 0;
      for (const m of (mockInventoryMovements || [])) {
        if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === stk.warehouse_id && m.unit_id === line.unit_id) {
          bal += m.quantity_delta;
          count += 1;
        }
      }
      line.system_quantity = bal;
      line.system_quantity_at = now;
      line.system_movements_count = count;
      line.counted_quantity = null; // S-08: clear counted quantity
    }

    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return formatMockStocktakeDetail(stk);
  },

  post_stocktake: async (args) => {
    const { stocktake_id, stocktakeId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'counting') {
      throw new Error(`無效的狀態轉換：不可從 ${stk.status} 轉換至 posted`);
    }

    validateMockWarehouseActive(targetTenantId, stk.warehouse_id);

    const lines = mockStocktakeLines.filter(l => l.stocktake_id === targetStkId);
    if (lines.length === 0) {
      throw new Error('盤點單沒有任何品項');
    }

    const missingCount = lines.filter(l => !isStocktakeLineCounted(l.counted_quantity)).length;
    if (missingCount > 0) {
      throw new Error(`尚有 ${missingCount} 項未輸入實盤量`);
    }

    // S-07: check movement count mismatch
    const affectedItems = [];
    const affectedLineIds = [];
    for (const line of lines) {
      const snapCount = line.system_movements_count ?? 0;
      let currentCount = 0;
      for (const m of (mockInventoryMovements || [])) {
        if ((m.tenant_id || 'tnt_mock_1') === targetTenantId &&
            m.warehouse_id === stk.warehouse_id &&
            m.unit_id === line.unit_id) {
          currentCount += 1;
        }
      }
      if (currentCount !== snapCount) {
        affectedItems.push(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕`);
        affectedLineIds.push(line.id);
      }
    }

    if (affectedItems.length > 0) {
      const err = /** @type {any} */ (new Error(`以下品項在盤點期間有異動：${affectedItems.join('、')}，請重新取得系統量並重新確認實盤`));
      err.code = 'MOVEMENTS_DETECTED_DURING_COUNTING';
      err.affected_line_ids = affectedLineIds;
      err.affectedLineIds = affectedLineIds;
      throw err;
    }

    const now = Math.floor(Date.now() / 1000);
    stk.status = 'posted';
    stk.posted_at = now;

    for (const line of lines) {
      const delta = (line.counted_quantity || 0) - (line.system_quantity || 0);
      if (Math.abs(delta) > 1e-6) {
        const imId = nextMockUid('im');
        mockInventoryMovements.push({
          id: imId,
          tenant_id: targetTenantId,
          unit_id: line.unit_id,
          warehouse_id: stk.warehouse_id,
          quantity_delta: delta,
          unit_cost: null,
          reason: 'stocktake',
          reference_type: 'stocktake',
          reference_id: stk.id,
          created_by: activeUid,
          created_at: now
        });
      }
    }

    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
    return formatMockStocktakeDetail(stk);
  },

  cancel_stocktake: async (args) => {
    const { stocktake_id, stocktakeId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    if (stk.status !== 'draft' && stk.status !== 'counting') {
      throw new Error(`無效的狀態轉換：不可從 ${stk.status} 轉換至 cancelled`);
    }

    const now = Math.floor(Date.now() / 1000);
    stk.status = 'cancelled';
    stk.cancelled_at = now;

    saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
    return formatMockStocktakeDetail(stk);
  },

  get_stocktake: async (args) => {
    const { stocktake_id, stocktakeId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetStkId = String(stocktake_id || stocktakeId || '').trim();
    const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!stk) {
      throw new Error('找不到盤點單或不屬於目前租戶');
    }
    return formatMockStocktakeDetail(stk);
  },

  list_stocktakes: async (args) => {
    const { status, warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    let list = mockStocktakes.filter(s => (s.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (status && String(status).trim()) {
      list = list.filter(s => s.status === String(status).trim());
    }
    if (targetWhId && String(targetWhId).trim()) {
      list = list.filter(s => s.warehouse_id === String(targetWhId).trim());
    }
    return list.map(s => {
      const lines = mockStocktakeLines.filter(l => l.stocktake_id === s.id);
      const counted = lines.filter(l => isStocktakeLineCounted(l.counted_quantity)).length;
      return {
        ...s,
        lines_count: lines.length,
        counted_count: counted
      };
    }).sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
  },

  reset_mock_stocktakes: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      const removedStkIds = new Set(
        mockStocktakes.filter(s => (s.tenant_id || 'tnt_mock_1') === targetTid).map(s => s.id)
      );
      mockStocktakes = mockStocktakes.filter(s => (s.tenant_id || 'tnt_mock_1') !== targetTid);
      mockStocktakeLines = mockStocktakeLines.filter(l => !removedStkIds.has(l.stocktake_id));
    } else {
      mockStocktakes = [];
      mockStocktakeLines = [];
    }
    saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return true;
  },

  set_mock_stocktake_line_snap_at: async (args) => {
    const { line_id, lineId, system_quantity_at, systemQuantityAt } = args || {};
    const targetLid = line_id || lineId;
    const targetSnap = system_quantity_at !== undefined ? system_quantity_at : systemQuantityAt;
    const l = mockStocktakeLines.find(x => x.id === targetLid);
    if (l) {
      l.system_quantity_at = targetSnap;
    }
    saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
    return true;
  }
};

