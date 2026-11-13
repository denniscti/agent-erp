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

export let mockStockTransfers = loadStorage('agent_erp_mock_stock_transfers', []);
if (!mockStockTransfers || !Array.isArray(mockStockTransfers)) {
  mockStockTransfers = [];
  saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
}

export let mockStockTransferLines = loadStorage('agent_erp_mock_stock_transfer_lines', []);
if (!mockStockTransferLines || !Array.isArray(mockStockTransferLines)) {
  mockStockTransferLines = [];
  saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
}

export function nextMockTrfNumber(tenantId) {
  let maxSeq = 0;
  for (const trf of mockStockTransfers) {
    if ((trf.tenant_id || 'tnt_mock_1') === tenantId && trf.transfer_number && trf.transfer_number.startsWith('TRF-')) {
      const num = parseInt(trf.transfer_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `TRF-${String(maxSeq + 1).padStart(5, '0')}`;
}

export function formatMockStockTransferDetail(transfer) {
  const lines = mockStockTransferLines
    .filter(l => l.transfer_id === transfer.id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    transfer: { ...transfer },
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
  return {
    unit,
    variant,
    product,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku || null,
    unit_name: unit.name || unit.unit_name
  };
}

export const stockTransferMocks = {
  create_stock_transfer: async (args) => {
    const {
      from_warehouse_id, fromWarehouseId,
      to_warehouse_id, toWarehouseId,
      note,
      task_id, taskId,
      initial_lines, initialLines
    } = args || {};

    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const rawFromWh = String(from_warehouse_id !== undefined ? from_warehouse_id : (fromWarehouseId || '')).trim();
    const rawToWh = String(to_warehouse_id !== undefined ? to_warehouse_id : (toWarehouseId || '')).trim();

    if (!rawFromWh || !rawToWh) {
      throw new Error('找不到倉別或倉別已停用');
    }
    if (rawFromWh === rawToWh) {
      throw new Error('來源倉與目的倉不可相同');
    }

    const fromWh = validateMockWarehouseActive(targetTenantId, rawFromWh);
    const toWh = validateMockWarehouseActive(targetTenantId, rawToWh);

    const rawLines = initial_lines !== undefined ? initial_lines : initialLines;
    const createdLines = [];
    const now = Math.floor(Date.now() / 1000);
    const trfId = nextMockUid('trf');
    const trfNumber = nextMockTrfNumber(targetTenantId);

    if (rawLines && Array.isArray(rawLines)) {
      const seenUnits = new Set();
      for (let i = 0; i < rawLines.length; i++) {
        const l = rawLines[i];
        const uid = String(l.unit_id || l.unitId || '').trim();
        if (!uid) {
          throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
        }
        if (seenUnits.has(uid)) {
          throw new Error('同一調撥單內商品單位不可重複');
        }
        seenUnits.add(uid);

        const qty = Number(l.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error('調撥數量必須大於 0');
        }

        const snap = resolveMockUnitSnapshot(targetTenantId, uid);
        createdLines.push({
          id: nextMockUid('trfl'),
          transfer_id: trfId,
          line_no: i + 1,
          unit_id: uid,
          quantity: qty,
          product_name_snapshot: snap.product_name,
          variant_name_snapshot: snap.variant_name,
          sku_snapshot: snap.sku,
          unit_name_snapshot: snap.unit_name,
          created_at: now
        });
      }
    }

    const newTrf = {
      id: trfId,
      tenant_id: targetTenantId,
      transfer_number: trfNumber,
      from_warehouse_id: fromWh.id,
      to_warehouse_id: toWh.id,
      status: 'draft',
      note: note ? String(note).trim() : null,
      created_by: activeUid,
      created_at: now,
      posted_at: null,
      cancelled_at: null,
      task_id: task_id || taskId || null
    };

    mockStockTransfers.push(newTrf);
    if (createdLines.length > 0) {
      mockStockTransferLines.push(...createdLines);
    }
    saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
    saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
    return formatMockStockTransferDetail(newTrf);
  },

  update_stock_transfer_header: async (args) => {
    const {
      transfer_id, transferId,
      from_warehouse_id, fromWarehouseId,
      to_warehouse_id, toWarehouseId,
      note
    } = args || {};

    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetTrfId = String(transfer_id || transferId || '').trim();
    const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    if (trf.status !== 'draft') {
      throw new Error(`調撥單狀態為 ${trf.status}，不允許修改表頭`);
    }

    const rawFromWh = from_warehouse_id !== undefined ? from_warehouse_id : fromWarehouseId;
    const targetFromWhId = rawFromWh !== undefined && rawFromWh !== null ? String(rawFromWh).trim() : trf.from_warehouse_id;

    const rawToWh = to_warehouse_id !== undefined ? to_warehouse_id : toWarehouseId;
    const targetToWhId = rawToWh !== undefined && rawToWh !== null ? String(rawToWh).trim() : trf.to_warehouse_id;

    if (!targetFromWhId || !targetToWhId) {
      throw new Error('找不到倉別或倉別已停用');
    }
    if (targetFromWhId === targetToWhId) {
      throw new Error('來源倉與目的倉不可相同');
    }

    const fromWh = validateMockWarehouseActive(targetTenantId, targetFromWhId);
    const toWh = validateMockWarehouseActive(targetTenantId, targetToWhId);

    trf.from_warehouse_id = fromWh.id;
    trf.to_warehouse_id = toWh.id;

    if (note !== undefined) {
      trf.note = note ? String(note).trim() : null;
    }

    saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
    return formatMockStockTransferDetail(trf);
  },

  add_stock_transfer_line: async (args) => {
    const {
      transfer_id, transferId,
      unit_id, unitId,
      quantity
    } = args || {};

    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetTrfId = String(transfer_id || transferId || '').trim();
    const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    if (trf.status !== 'draft') {
      throw new Error(`調撥單狀態為 ${trf.status}，僅草稿狀態可新增明細`);
    }

    const targetUnitId = String(unit_id || unitId || '').trim();
    if (!targetUnitId) {
      throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('調撥數量必須大於 0');
    }

    const isDup = mockStockTransferLines.some(l => l.transfer_id === targetTrfId && l.unit_id === targetUnitId);
    if (isDup) {
      throw new Error('同一調撥單內商品單位不可重複');
    }

    const snap = resolveMockUnitSnapshot(targetTenantId, targetUnitId);
    const existingLines = mockStockTransferLines.filter(l => l.transfer_id === targetTrfId);
    const maxLineNo = existingLines.reduce((max, l) => Math.max(max, l.line_no || 0), 0);

    const now = Math.floor(Date.now() / 1000);
    const newLine = {
      id: nextMockUid('trfl'),
      transfer_id: targetTrfId,
      line_no: maxLineNo + 1,
      unit_id: targetUnitId,
      quantity: qty,
      product_name_snapshot: snap.product_name,
      variant_name_snapshot: snap.variant_name,
      sku_snapshot: snap.sku,
      unit_name_snapshot: snap.unit_name,
      created_at: now
    };

    mockStockTransferLines.push(newLine);
    saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
    return formatMockStockTransferDetail(trf);
  },

  update_stock_transfer_line: async (args) => {
    const { line_id, lineId, quantity } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetLid = String(line_id || lineId || '').trim();
    const line = mockStockTransferLines.find(l => l.id === targetLid);
    if (!line) {
      throw new Error('找不到指定的調撥單明細行');
    }
    const trf = mockStockTransfers.find(t => t.id === line.transfer_id && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    if (trf.status !== 'draft') {
      throw new Error(`調撥單狀態為 ${trf.status}，僅草稿狀態可修改明細`);
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('調撥數量必須大於 0');
    }

    line.quantity = qty;
    saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
    return formatMockStockTransferDetail(trf);
  },

  remove_stock_transfer_line: async (args) => {
    const { line_id, lineId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetLid = String(line_id || lineId || '').trim();
    const line = mockStockTransferLines.find(l => l.id === targetLid);
    if (!line) {
      throw new Error('找不到指定的調撥單明細行');
    }
    const trf = mockStockTransfers.find(t => t.id === line.transfer_id && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    if (trf.status !== 'draft') {
      throw new Error(`調撥單狀態為 ${trf.status}，僅草稿狀態可刪除明細`);
    }

    mockStockTransferLines = mockStockTransferLines.filter(l => l.id !== targetLid);
    const remaining = mockStockTransferLines.filter(l => l.transfer_id === trf.id).sort((a, b) => a.line_no - b.line_no);
    remaining.forEach((l, idx) => {
      l.line_no = idx + 1;
    });

    saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
    return formatMockStockTransferDetail(trf);
  },

  post_stock_transfer: async (args) => {
    const { transfer_id, transferId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const targetTrfId = String(transfer_id || transferId || '').trim();
    const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    if (trf.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${trf.status} 轉換至 posted`);
    }

    if (trf.from_warehouse_id === trf.to_warehouse_id) {
      throw new Error('來源倉與目的倉不可相同');
    }

    const fromWh = validateMockWarehouseActive(targetTenantId, trf.from_warehouse_id);
    validateMockWarehouseActive(targetTenantId, trf.to_warehouse_id);

    const lines = mockStockTransferLines.filter(l => l.transfer_id === trf.id);
    if (lines.length === 0) {
      throw new Error('調撥單沒有任何明細');
    }

    // Verify stock availability in from_warehouse
    for (const line of lines) {
      let currentStock = 0;
      for (const m of (mockInventoryMovements || [])) {
        if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === line.unit_id && m.warehouse_id === trf.from_warehouse_id) {
          currentStock += Number(m.quantity_delta || 0);
        }
      }
      if (currentStock + 1e-9 < line.quantity) {
        throw new Error(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${fromWh.name}〕現有 ${currentStock}，不足調撥 ${line.quantity}`);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    trf.status = 'posted';
    trf.posted_at = now;

    // Write two inventory movements per line
    for (const line of lines) {
      mockInventoryMovements.push({
        id: nextMockUid('mov'),
        tenant_id: targetTenantId,
        unit_id: line.unit_id,
        warehouse_id: trf.from_warehouse_id,
        quantity_delta: -line.quantity,
        unit_cost: null,
        reason: 'transfer_out',
        reference_type: 'stock_transfer',
        reference_id: trf.id,
        created_by: activeUid,
        created_at: now
      });
      mockInventoryMovements.push({
        id: nextMockUid('mov'),
        tenant_id: targetTenantId,
        unit_id: line.unit_id,
        warehouse_id: trf.to_warehouse_id,
        quantity_delta: line.quantity,
        unit_cost: null,
        reason: 'transfer_in',
        reference_type: 'stock_transfer',
        reference_id: trf.id,
        created_by: activeUid,
        created_at: now
      });
    }

    saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    return formatMockStockTransferDetail(trf);
  },

  cancel_stock_transfer: async (args) => {
    const { transfer_id, transferId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const targetTrfId = String(transfer_id || transferId || '').trim();
    const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    if (trf.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${trf.status} 轉換至 cancelled`);
    }

    const now = Math.floor(Date.now() / 1000);
    trf.status = 'cancelled';
    trf.cancelled_at = now;

    saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
    return formatMockStockTransferDetail(trf);
  },

  get_stock_transfer: async (args) => {
    const { transfer_id, transferId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetTrfId = String(transfer_id || transferId || '').trim();
    const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!trf) {
      throw new Error('找不到調撥單或不屬於目前租戶');
    }
    return formatMockStockTransferDetail(trf);
  },

  list_stock_transfers: async (args) => {
    const { status, from_warehouse_id, fromWarehouseId, to_warehouse_id, toWarehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetFromWhId = from_warehouse_id !== undefined ? from_warehouse_id : fromWarehouseId;
    const targetToWhId = to_warehouse_id !== undefined ? to_warehouse_id : toWarehouseId;

    let list = mockStockTransfers.filter(t => (t.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (status && String(status).trim()) {
      list = list.filter(t => t.status === String(status).trim());
    }
    if (targetFromWhId && String(targetFromWhId).trim()) {
      list = list.filter(t => t.from_warehouse_id === String(targetFromWhId).trim());
    }
    if (targetToWhId && String(targetToWhId).trim()) {
      list = list.filter(t => t.to_warehouse_id === String(targetToWhId).trim());
    }

    return list
      .map(t => {
        const lines = mockStockTransferLines.filter(l => l.transfer_id === t.id);
        return {
          ...t,
          lines_count: lines.length
        };
      })
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
  },

  reset_mock_stock_transfers: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      const removedTrfIds = new Set(
        mockStockTransfers.filter(t => (t.tenant_id || 'tnt_mock_1') === targetTid).map(t => t.id)
      );
      mockStockTransfers = mockStockTransfers.filter(t => (t.tenant_id || 'tnt_mock_1') !== targetTid);
      mockStockTransferLines = mockStockTransferLines.filter(l => !removedTrfIds.has(l.transfer_id));
    } else {
      mockStockTransfers = [];
      mockStockTransferLines = [];
    }
    saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
    saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
    return true;
  }
};

