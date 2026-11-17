// @ts-check
import {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPurchaseOrders } from '../purchaseOrders/mocks.js';
import {
  mockProducts,
  mockProductVariants,
  mockProductUnits
} from '../products/mocks.js';
import { mockInventoryAdjustments } from '../inventoryAdjustments/mocks.js';
import { mockStocktakes } from '../stocktakes/mocks.js';
import { mockStockTransfers } from '../stockTransfers/mocks.js';

export const defaultMockWarehouses = [
  {
    id: "wh_mock_1",
    tenant_id: "tnt_mock_1",
    code: "MAIN",
    name: "主倉",
    is_default: true,
    is_active: true,
    created_at: Math.floor(Date.now() / 1000) - 86400,
  }
];

export let mockWarehouses = loadStorage('agent_erp_mock_warehouses', defaultMockWarehouses);
if (!mockWarehouses || !Array.isArray(mockWarehouses)) {
  mockWarehouses = JSON.parse(JSON.stringify(defaultMockWarehouses));
  saveStorage('agent_erp_mock_warehouses', mockWarehouses);
}

export let mockInventoryMovements = loadStorage('agent_erp_mock_inventory_movements', []);
if (!mockInventoryMovements || !Array.isArray(mockInventoryMovements)) {
  mockInventoryMovements = [];
  saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
}

export let mockUnitConversions = loadStorage('agent_erp_mock_unit_conversions', []);
if (!mockUnitConversions || !Array.isArray(mockUnitConversions)) {
  mockUnitConversions = [];
  saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
}

export function nextMockUcvNumber(tenantId) {
  let maxSeq = 0;
  for (const ucv of mockUnitConversions) {
    if ((ucv.tenant_id || 'tnt_mock_1') === tenantId && ucv.conversion_number && ucv.conversion_number.startsWith('UCV-')) {
      const num = parseInt(ucv.conversion_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `UCV-${String(maxSeq + 1).padStart(5, '0')}`;
}

export function formatMockQty(q) {
  const rounded = Math.round(q * 1e6) / 1e6;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded);
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

export function migrateAndBackfillMockWarehouses() {
  const movs = loadStorage('agent_erp_mock_inventory_movements', []);
  const pos = loadStorage('agent_erp_mock_purchase_orders', []);
  const tenantsWithData = new Set();
  if (Array.isArray(pos)) {
    for (const po of pos) {
      if (!po.warehouse_id) {
        tenantsWithData.add(po.tenant_id || 'tnt_mock_1');
      }
    }
  }
  if (Array.isArray(movs)) {
    for (const mov of movs) {
      if (!mov.warehouse_id) {
        tenantsWithData.add(mov.tenant_id || 'tnt_mock_1');
      }
    }
  }

  for (const tid of tenantsWithData) {
    let wh = mockWarehouses.find(w => (w.tenant_id || 'tnt_mock_1') === tid && w.is_default);
    if (!wh) {
      wh = mockWarehouses.find(w => (w.tenant_id || 'tnt_mock_1') === tid && w.is_active);
    }
    if (!wh) {
      wh = {
        id: nextMockUid('wh'),
        tenant_id: tid,
        code: 'MAIN',
        name: '主倉',
        is_default: true,
        is_active: true,
        created_at: Math.floor(Date.now() / 1000),
      };
      mockWarehouses.push(wh);
    }
    if (Array.isArray(pos)) {
      for (const po of pos) {
        if ((po.tenant_id || 'tnt_mock_1') === tid && !po.warehouse_id) {
          po.warehouse_id = wh.id;
        }
      }
    }
    if (Array.isArray(movs)) {
      for (const mov of movs) {
        if ((mov.tenant_id || 'tnt_mock_1') === tid && !mov.warehouse_id) {
          mov.warehouse_id = wh.id;
        }
      }
    }
  }
  saveStorage('agent_erp_mock_warehouses', mockWarehouses);
  if (Array.isArray(pos)) {
    saveStorage('agent_erp_mock_purchase_orders', pos);
  }
  if (Array.isArray(movs)) {
    saveStorage('agent_erp_mock_inventory_movements', movs);
  }
}
migrateAndBackfillMockWarehouses();

export function resolveMockDefaultWarehouse(tenantId) {
  const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === tenantId);
  if (tWhs.length === 0) {
    throw new Error('此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別');
  }
  let defWh = tWhs.find(w => w.is_default);
  if (!defWh) {
    defWh = tWhs.find(w => w.is_active);
  }
  if (!defWh || !defWh.is_active) {
    throw new Error('預設倉已停用，請先重新啟用或設定其他預設倉');
  }
  return defWh;
}

export function validateMockWarehouseActive(tenantId, warehouseId) {
  const targetId = String(warehouseId || '').trim();
  if (!targetId) {
    throw new Error('找不到倉別或倉別已停用');
  }
  const wh = mockWarehouses.find(w => w.id === targetId && (w.tenant_id || 'tnt_mock_1') === tenantId);
  if (!wh || !wh.is_active) {
    throw new Error('找不到倉別或倉別已停用');
  }
  return wh;
}

export const warehouseMocks = {
  create_warehouse: async (args) => {
    const { code, name } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const trimmedCode = String(code || '').trim();
    if (!trimmedCode) {
      throw new Error('倉別代碼不可空白');
    }
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('倉別名稱不可空白');
    }
    const dup = mockWarehouses.some(
      w => (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.code.toLowerCase() === trimmedCode.toLowerCase()
    );
    if (dup) {
      throw new Error('倉別代碼已存在');
    }
    const tenantWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    const is_default = tenantWhs.length === 0;
    const newWh = {
      id: nextMockUid('wh'),
      tenant_id: targetTenantId,
      code: trimmedCode,
      name: trimmedName,
      is_default,
      is_active: true,
      created_at: Math.floor(Date.now() / 1000)
    };
    mockWarehouses.push(newWh);
    saveStorage('agent_erp_mock_warehouses', mockWarehouses);
    return newWh;
  },

  update_warehouse: async (args) => {
    const { id, code, name } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const trimmedId = String(id || '').trim();
    const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!wh) {
      throw new Error('找不到倉別或不屬於目前租戶');
    }
    const trimmedCode = String(code || '').trim();
    if (!trimmedCode) {
      throw new Error('倉別代碼不可空白');
    }
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('倉別名稱不可空白');
    }
    const dup = mockWarehouses.some(
      w => (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.id !== trimmedId && w.code.toLowerCase() === trimmedCode.toLowerCase()
    );
    if (dup) {
      throw new Error('倉別代碼已存在');
    }
    wh.code = trimmedCode;
    wh.name = trimmedName;
    saveStorage('agent_erp_mock_warehouses', mockWarehouses);
    return wh;
  },

  set_default_warehouse: async (args) => {
    const { id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const trimmedId = String(id || '').trim();
    const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!wh) {
      throw new Error('找不到倉別或不屬於目前租戶');
    }
    if (!wh.is_active) {
      throw new Error('停用中的倉別不可設為預設');
    }
    for (const w of mockWarehouses) {
      if ((w.tenant_id || 'tnt_mock_1') === targetTenantId) {
        w.is_default = (w.id === trimmedId);
      }
    }
    saveStorage('agent_erp_mock_warehouses', mockWarehouses);
    return wh;
  },

  deactivate_warehouse: async (args) => {
    const { id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const trimmedId = String(id || '').trim();
    const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!wh) {
      throw new Error('找不到倉別或不屬於目前租戶');
    }
    if (wh.is_default) {
      throw new Error('預設倉不可停用');
    }
    // Check stock
    const stockByUnit = {};
    for (const m of (mockInventoryMovements || [])) {
      if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === trimmedId) {
        stockByUnit[m.unit_id] = (stockByUnit[m.unit_id] || 0) + m.quantity_delta;
      }
    }
    for (const qty of Object.values(stockByUnit)) {
      if (Math.abs(qty) > 1e-6) {
        throw new Error('此倉仍有庫存，請先調撥或調整歸零');
      }
    }
    // Check pending POs
    const pendingPo = (mockPurchaseOrders || []).find(
      po => (po.tenant_id || 'tnt_mock_1') === targetTenantId && po.warehouse_id === trimmedId && (po.status === 'draft' || po.status === 'ordered')
    );
    if (pendingPo) {
      throw new Error(`此倉仍被未結案單據引用：${pendingPo.po_number}`);
    }
    // Check pending ADJs (W-03 Extension)
    const pendingAdj = (mockInventoryAdjustments || []).find(
      adj => (adj.tenant_id || 'tnt_mock_1') === targetTenantId && adj.warehouse_id === trimmedId && adj.status === 'draft'
    );
    if (pendingAdj) {
      throw new Error(`此倉仍被未結案單據引用：${pendingAdj.adjustment_number}`);
    }
    // Check pending STKs (W-03 Extension)
    const pendingStk = (mockStocktakes || []).find(
      stk => (stk.tenant_id || 'tnt_mock_1') === targetTenantId && stk.warehouse_id === trimmedId && (stk.status === 'draft' || stk.status === 'counting')
    );
    if (pendingStk) {
      throw new Error(`此倉仍被未結案單據引用：${pendingStk.stocktake_number}`);
    }
    // Check pending TRFs (W-03 Extension)
    const pendingTrf = (mockStockTransfers || []).find(
      trf => (trf.tenant_id || 'tnt_mock_1') === targetTenantId && (trf.from_warehouse_id === trimmedId || trf.to_warehouse_id === trimmedId) && trf.status === 'draft'
    );
    if (pendingTrf) {
      throw new Error(`此倉仍被未結案單據引用：${pendingTrf.transfer_number}`);
    }
    wh.is_active = false;
    saveStorage('agent_erp_mock_warehouses', mockWarehouses);
    return wh;
  },

  reactivate_warehouse: async (args) => {
    const { id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const trimmedId = String(id || '').trim();
    const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!wh) {
      throw new Error('找不到倉別或不屬於目前租戶');
    }
    wh.is_active = true;
    saveStorage('agent_erp_mock_warehouses', mockWarehouses);
    return wh;
  },

  list_warehouses: async (args) => {
    const { include_inactive, includeInactive } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const incInactive = include_inactive !== undefined ? include_inactive : includeInactive;
    let list = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!incInactive) {
      list = list.filter(w => w.is_active);
    }
    return list.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || a.created_at - b.created_at);
  },

  reset_mock_warehouses: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockWarehouses = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') !== targetTid);
    } else {
      mockWarehouses = JSON.parse(JSON.stringify(defaultMockWarehouses));
    }
    saveStorage('agent_erp_mock_warehouses', mockWarehouses);
    return mockWarehouses;
  },

  record_opening_inventory_balance: async (args) => {
    const { unit_id, unitId, quantity, quantity_delta, quantityDelta, unit_cost, unitCost, warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetUserId = resolveMockActiveUserId();
    const targetUnitId = String(unit_id || unitId || '').trim();
    resolveMockUnitSnapshot(targetTenantId, targetUnitId);

    const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    let targetWh;
    if (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') {
      targetWh = validateMockWarehouseActive(targetTenantId, rawWhId);
    } else {
      targetWh = resolveMockDefaultWarehouse(targetTenantId);
    }

    const rawQty = quantity !== undefined ? quantity : (quantity_delta !== undefined ? quantity_delta : quantityDelta);
    const qty = Number(rawQty);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('期初開帳數量必須大於 0');
    }
    const cost = Number(unit_cost !== undefined ? unit_cost : unitCost);
    if (isNaN(cost) || cost < 0) {
      throw new Error('期初開帳成本不可為負數');
    }

    const dup = mockInventoryMovements.find(
      m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === targetUnitId && m.warehouse_id === targetWh.id && m.reason === 'opening_balance'
    );
    if (dup) {
      throw new Error(`此商品單位在〔${targetWh.name}〕已開帳，數量更正請用庫存調整（原因：期初更正）`);
    }

    const now = args?.created_at !== undefined ? args.created_at : Math.floor(Date.now() / 1000);
    const imId = nextMockUid('im');
    const newMovement = {
      id: imId,
      tenant_id: targetTenantId,
      warehouse_id: targetWh.id,
      unit_id: targetUnitId,
      quantity_delta: qty,
      unit_cost: cost,
      reason: 'opening_balance',
      reference_type: 'opening_balance',
      reference_id: null,
      created_by: targetUserId,
      created_at: now
    };
    mockInventoryMovements.push(newMovement);
    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    return newMovement;
  },

  get_inventory_level: async (args) => {
    const { unit_id, unitId, warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUnitId = String(unit_id || unitId || '').trim();
    const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, targetUnitId);
    const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    const targetWhId = (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') ? String(rawWhId).trim() : null;

    const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (tWhs.length === 0) {
      return {
        unit_id: targetUnitId,
        warehouse_id: targetWhId,
        current_quantity: 0,
        product_name: product.name,
        variant_name: variant.name,
        sku: variant.sku || null,
        unit_name: unit.unit_name
      };
    }

    let movements = mockInventoryMovements.filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === targetUnitId);
    if (targetWhId) {
      movements = movements.filter(m => m.warehouse_id === targetWhId);
    }
    const current_quantity = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
    return {
      unit_id: targetUnitId,
      warehouse_id: targetWhId,
      current_quantity,
      product_name: product.name,
      variant_name: variant.name,
      sku: variant.sku || null,
      unit_name: unit.unit_name
    };
  },

  list_inventory_levels: async (args) => {
    const { warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (tWhs.length === 0) {
      return [];
    }
    const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    const targetWhId = (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') ? String(rawWhId).trim() : null;

    const tenantProducts = mockProducts.filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    const prodIds = new Set(tenantProducts.map(p => p.id));
    const tenantVariants = mockProductVariants.filter(v => prodIds.has(v.product_id));
    const varIds = new Set(tenantVariants.map(v => v.id));
    const tenantUnits = mockProductUnits.filter(u => varIds.has(u.variant_id));

    const levels = tenantUnits.map(unit => {
      const variant = tenantVariants.find(v => v.id === unit.variant_id);
      const product = tenantProducts.find(p => p.id === variant.product_id);
      let movements = mockInventoryMovements.filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === unit.id);
      if (targetWhId) {
        movements = movements.filter(m => m.warehouse_id === targetWhId);
      }
      const current_quantity = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
      return {
        unit_id: unit.id,
        warehouse_id: targetWhId,
        current_quantity,
        product_name: product ? product.name : null,
        variant_name: variant ? variant.name : null,
        sku: variant ? variant.sku : null,
        unit_name: unit.unit_name
      };
    });
    return levels.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
  },

  list_inventory_movements: async (args) => {
    const { unit_id, unitId, warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (tWhs.length === 0) {
      return [];
    }
    const targetUnitId = String(unit_id || unitId || '').trim();
    const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    const targetWhId = (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') ? String(rawWhId).trim() : null;

    let list = mockInventoryMovements.filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (targetUnitId) {
      list = list.filter(m => m.unit_id === targetUnitId);
    }
    if (targetWhId) {
      list = list.filter(m => m.warehouse_id === targetWhId);
    }
    return list.sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || (a.id > b.id ? 1 : -1));
  },

  create_unit_conversion: async (args) => {
    const {
      warehouse_id, warehouseId,
      from_unit_id, fromUnitId,
      from_quantity, fromQuantity,
      to_unit_id, toUnitId,
      to_quantity, toQuantity,
      note,
      task_id, taskId
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('tenant_id 不可為空');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('user_id 不可為空');
    }
    const whId = String(warehouse_id !== undefined ? warehouse_id : warehouseId || '').trim();
    const wh = mockWarehouses.find(w => w.id === whId && (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.is_active);
    if (!wh) {
      throw new Error('找不到指定的倉別或倉別已停用');
    }
    const fUnitId = String(from_unit_id !== undefined ? from_unit_id : fromUnitId || '').trim();
    const tUnitId = String(to_unit_id !== undefined ? to_unit_id : toUnitId || '').trim();
    const fQty = Number(from_quantity !== undefined ? from_quantity : fromQuantity);
    const tQty = Number(to_quantity !== undefined ? to_quantity : toQuantity);
    if (!Number.isFinite(fQty) || fQty <= 1e-9) {
      throw new Error('來源數量 (from_quantity) 必須大於 0');
    }
    if (!Number.isFinite(tQty) || tQty <= 1e-9) {
      throw new Error('目標數量 (to_quantity) 必須大於 0');
    }
    let fromSnap;
    try {
      fromSnap = resolveMockUnitSnapshot(targetTenantId, fUnitId);
    } catch {
      throw new Error('找不到來源商品單位 (from_unit_id) 或不屬於目前租戶');
    }
    let toSnap;
    try {
      toSnap = resolveMockUnitSnapshot(targetTenantId, tUnitId);
    } catch {
      throw new Error('找不到目標商品單位 (to_unit_id) 或不屬於目前租戶');
    }
    if (fromSnap.variant.id !== toSnap.variant.id) {
      throw new Error('來源單位與目標單位必須屬於同一個商品規格 (variant)');
    }
    if (fUnitId === tUnitId) {
      throw new Error('來源單位與目標單位不可相同');
    }

    const now = Math.floor(Date.now() / 1000);
    const ucv = {
      id: `ucv_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      tenant_id: targetTenantId,
      conversion_number: nextMockUcvNumber(targetTenantId),
      warehouse_id: whId,
      variant_id: fromSnap.variant.id,
      from_unit_id: fUnitId,
      from_quantity: fQty,
      to_unit_id: tUnitId,
      to_quantity: tQty,
      status: 'draft',
      note: note && String(note).trim() ? String(note).trim() : null,
      product_name_snapshot: fromSnap.product.name,
      variant_name_snapshot: fromSnap.variant.name,
      sku_snapshot: fromSnap.variant.sku || null,
      from_unit_name_snapshot: fromSnap.unit.unit_name,
      to_unit_name_snapshot: toSnap.unit.unit_name,
      created_by: activeUid,
      created_at: now,
      posted_at: null,
      cancelled_at: null,
      task_id: task_id !== undefined ? task_id : (taskId !== undefined ? taskId : null)
    };
    mockUnitConversions.push(ucv);
    saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
    return { ...ucv };
  },

  post_unit_conversion: async (args) => {
    const { conversion_id, conversionId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const targetId = String(conversion_id !== undefined ? conversion_id : conversionId || '').trim();
    const ucv = mockUnitConversions.find(c => c.id === targetId && (c.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ucv) {
      throw new Error('找不到指定的單位轉換單或無權限存取');
    }
    if (ucv.status !== 'draft') {
      throw new Error(`單位轉換單狀態為「${ucv.status}」，無法變更為「posted」`);
    }
    const wh = mockWarehouses.find(w => w.id === ucv.warehouse_id && (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.is_active);
    if (!wh) {
      throw new Error('找不到指定的倉別或倉別已停用');
    }
    const fromSnap = resolveMockUnitSnapshot(targetTenantId, ucv.from_unit_id);
    const toSnap = resolveMockUnitSnapshot(targetTenantId, ucv.to_unit_id);
    if (fromSnap.variant.id !== toSnap.variant.id) {
      throw new Error('來源單位與目標單位必須屬於同一個商品規格 (variant)');
    }

    const currentStock = mockInventoryMovements
      .filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === ucv.warehouse_id && m.unit_id === ucv.from_unit_id)
      .reduce((sum, m) => sum + Number(m.quantity_delta || 0), 0);

    if (currentStock + 1e-9 < ucv.from_quantity) {
      throw new Error(
        `〔${ucv.product_name_snapshot}／${ucv.variant_name_snapshot}／${ucv.from_unit_name_snapshot}〕在〔${wh.name}〕現有庫存 ${formatMockQty(currentStock)} 不足，無法扣除轉換數量 ${formatMockQty(ucv.from_quantity)}`
      );
    }

    const now = Math.floor(Date.now() / 1000);
    ucv.status = 'posted';
    ucv.posted_at = now;

    mockInventoryMovements.push({
      id: `im_ucv_out_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      tenant_id: targetTenantId,
      unit_id: ucv.from_unit_id,
      warehouse_id: ucv.warehouse_id,
      quantity_delta: -ucv.from_quantity,
      unit_cost: null,
      reason: 'unit_conversion_out',
      reference_type: 'unit_conversion',
      reference_id: ucv.id,
      created_by: activeUid,
      created_at: now
    });
    mockInventoryMovements.push({
      id: `im_ucv_in_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      tenant_id: targetTenantId,
      unit_id: ucv.to_unit_id,
      warehouse_id: ucv.warehouse_id,
      quantity_delta: ucv.to_quantity,
      unit_cost: null,
      reason: 'unit_conversion_in',
      reference_type: 'unit_conversion',
      reference_id: ucv.id,
      created_by: activeUid,
      created_at: now
    });

    saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    return { ...ucv };
  },

  cancel_unit_conversion: async (args) => {
    const { conversion_id, conversionId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetId = String(conversion_id !== undefined ? conversion_id : conversionId || '').trim();
    const ucv = mockUnitConversions.find(c => c.id === targetId && (c.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ucv) {
      throw new Error('找不到指定的單位轉換單或無權限存取');
    }
    if (ucv.status !== 'draft') {
      throw new Error(`單位轉換單狀態為「${ucv.status}」，無法變更為「cancelled」`);
    }
    ucv.status = 'cancelled';
    ucv.cancelled_at = Math.floor(Date.now() / 1000);
    saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
    return { ...ucv };
  },

  get_unit_conversion: async (args) => {
    const { conversion_id, conversionId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetId = String(conversion_id !== undefined ? conversion_id : conversionId || '').trim();
    const ucv = mockUnitConversions.find(c => c.id === targetId && (c.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ucv) {
      throw new Error('找不到指定的單位轉換單或無權限存取');
    }
    return { ...ucv };
  },

  list_unit_conversions: async (args) => {
    const { status, warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    let list = mockUnitConversions.filter(c => (c.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (status && String(status).trim() && String(status).trim() !== 'all') {
      list = list.filter(c => c.status === String(status).trim());
    }
    if (targetWhId && String(targetWhId).trim()) {
      list = list.filter(c => c.warehouse_id === String(targetWhId).trim());
    }
    return list
      .map(c => ({ ...c }))
      .sort((a, b) => b.created_at - a.created_at || b.conversion_number.localeCompare(a.conversion_number));
  },

  reset_mock_unit_conversions: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockUnitConversions = mockUnitConversions.filter(c => (c.tenant_id || 'tnt_mock_1') !== targetTid);
    } else {
      mockUnitConversions = [];
    }
    saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
    return true;
  }
};
