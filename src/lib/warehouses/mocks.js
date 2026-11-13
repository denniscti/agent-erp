// @ts-check
import {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId
} from '../mockStorage.js';
import { mockPurchaseOrders } from '../purchaseOrders/mocks.js';
import { mockInventoryMovements } from '../tauri.js';
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
  }
};
