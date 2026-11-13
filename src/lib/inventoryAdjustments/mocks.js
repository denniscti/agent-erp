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

export let mockInventoryAdjustments = loadStorage('agent_erp_mock_inventory_adjustments', []);
if (!mockInventoryAdjustments || !Array.isArray(mockInventoryAdjustments)) {
  mockInventoryAdjustments = [];
  saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
}

export let mockInventoryAdjustmentLines = loadStorage('agent_erp_mock_inventory_adjustment_lines', []);
if (!mockInventoryAdjustmentLines || !Array.isArray(mockInventoryAdjustmentLines)) {
  mockInventoryAdjustmentLines = [];
  saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
}

export function nextMockAdjNumber(tenantId) {
  let maxSeq = 0;
  for (const adj of mockInventoryAdjustments) {
    if ((adj.tenant_id || 'tnt_mock_1') === tenantId && adj.adjustment_number && adj.adjustment_number.startsWith('ADJ-')) {
      const num = parseInt(adj.adjustment_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `ADJ-${String(maxSeq + 1).padStart(5, '0')}`;
}

export function formatMockQty(q) {
  const rounded = Math.round(q * 1e6) / 1e6;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

export function formatMockInventoryAdjustmentDetail(adjustment) {
  const lines = mockInventoryAdjustmentLines
    .filter(l => l.adjustment_id === adjustment.id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    adjustment: {
      ...adjustment,
      lines_count: lines.length
    },
    lines: lines.map(l => ({ ...l }))
  };
}

export function validateMockAdjReasonAndNote(reasonCode, note) {
  const trimmedReason = String(reasonCode || '').trim();
  const allowed = ['damage', 'loss', 'found', 'opening_correction', 'other'];
  if (!allowed.includes(trimmedReason)) {
    throw new Error('請選擇調整原因');
  }
  if (trimmedReason === 'other') {
    const trimmedNote = note ? String(note).trim() : '';
    if (!trimmedNote) {
      throw new Error('原因為其他時須填寫說明');
    }
  }
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

export const inventoryAdjustmentMocks = {
  create_inventory_adjustment: async (args) => {
    const {
      warehouse_id, warehouseId,
      reason_code, reasonCode,
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

    const targetWhId = String(warehouse_id || warehouseId || '').trim();
    const wh = validateMockWarehouseActive(targetTenantId, targetWhId);

    const rCode = String(reason_code || reasonCode || '').trim();
    validateMockAdjReasonAndNote(rCode, note);

    const now = Math.floor(Date.now() / 1000);
    const adjId = nextMockUid('adj');
    const adjNumber = nextMockAdjNumber(targetTenantId);

    const items = initial_lines || initialLines || [];
    const seenUnits = new Set();
    const createdLines = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const uId = String(item.unit_id || item.unitId || '').trim();
      if (!uId) {
        throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
      }
      const delta = Number(item.quantity_delta !== undefined ? item.quantity_delta : item.quantityDelta);
      if (isNaN(delta) || Math.abs(delta) < 1e-9) {
        throw new Error('調整數量不可為 0');
      }
      if (seenUnits.has(uId)) {
        throw new Error('同一調整單內商品單位不可重複，請修改既有明細');
      }
      seenUnits.add(uId);

      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
      const lineId = nextMockUid('adjl');
      const newLine = {
        id: lineId,
        adjustment_id: adjId,
        line_no: idx + 1,
        unit_id: uId,
        quantity_delta: delta,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || null,
        unit_name_snapshot: unit.unit_name,
        created_at: now
      };
      createdLines.push(newLine);
    }

    const newAdj = {
      id: adjId,
      tenant_id: targetTenantId,
      adjustment_number: adjNumber,
      warehouse_id: wh.id,
      reason_code: rCode,
      status: 'draft',
      note: note ? String(note).trim() : null,
      created_by: activeUid,
      created_at: now,
      posted_at: null,
      cancelled_at: null,
      task_id: task_id || taskId || null
    };

    mockInventoryAdjustments.push(newAdj);
    if (createdLines.length > 0) {
      mockInventoryAdjustmentLines.push(...createdLines);
    }
    saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
    saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
    return formatMockInventoryAdjustmentDetail(newAdj);
  },

  update_inventory_adjustment_header: async (args) => {
    const {
      adjustment_id, adjustmentId,
      warehouse_id, warehouseId,
      reason_code, reasonCode,
      note
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
    const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到調整單或不屬於目前租戶');
    }
    if (adj.status !== 'draft') {
      throw new Error(`調整單狀態為 ${adj.status}，不允許修改表頭`);
    }

    const rawWh = warehouse_id !== undefined ? warehouse_id : warehouseId;
    const targetWhId = rawWh !== undefined ? String(rawWh || '').trim() : adj.warehouse_id;
    validateMockWarehouseActive(targetTenantId, targetWhId);

    const rawReason = reason_code !== undefined ? reason_code : reasonCode;
    const targetReason = rawReason !== undefined ? String(rawReason || '').trim() : adj.reason_code;
    const targetNote = note !== undefined ? (note ? String(note).trim() : null) : adj.note;

    validateMockAdjReasonAndNote(targetReason, targetNote);

    if (rawWh !== undefined) {
      adj.warehouse_id = targetWhId;
    }
    if (rawReason !== undefined) {
      adj.reason_code = targetReason;
    }
    if (note !== undefined) {
      adj.note = targetNote;
    }

    saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
    return formatMockInventoryAdjustmentDetail(adj);
  },

  add_inventory_adjustment_line: async (args) => {
    const {
      adjustment_id, adjustmentId,
      unit_id, unitId,
      quantity_delta, quantityDelta
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
    const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到調整單或不屬於目前租戶');
    }
    if (adj.status !== 'draft') {
      throw new Error(`調整單狀態為 ${adj.status}，僅草稿狀態可新增明細`);
    }

    const uId = String(unit_id || unitId || '').trim();
    if (!uId) {
      throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
    }
    const delta = Number(quantity_delta !== undefined ? quantity_delta : quantityDelta);
    if (isNaN(delta) || Math.abs(delta) < 1e-9) {
      throw new Error('調整數量不可為 0');
    }

    const dup = mockInventoryAdjustmentLines.find(l => l.adjustment_id === adj.id && l.unit_id === uId);
    if (dup) {
      throw new Error('同一調整單內商品單位不可重複，請修改既有明細');
    }

    const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);

    const maxLineNo = mockInventoryAdjustmentLines
      .filter(l => l.adjustment_id === adj.id)
      .reduce((max, l) => Math.max(max, l.line_no || 0), 0);

    const now = Math.floor(Date.now() / 1000);
    const newLine = {
      id: nextMockUid('adjl'),
      adjustment_id: adj.id,
      line_no: maxLineNo + 1,
      unit_id: uId,
      quantity_delta: delta,
      product_name_snapshot: product.name,
      variant_name_snapshot: variant.name,
      sku_snapshot: variant.sku || null,
      unit_name_snapshot: unit.unit_name,
      created_at: now
    };

    mockInventoryAdjustmentLines.push(newLine);
    saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
    return formatMockInventoryAdjustmentDetail(adj);
  },

  update_inventory_adjustment_line: async (args) => {
    const {
      line_id, lineId,
      quantity_delta, quantityDelta
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetLineId = String(line_id || lineId || '').trim();
    const line = mockInventoryAdjustmentLines.find(l => l.id === targetLineId);
    if (!line) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    const adj = mockInventoryAdjustments.find(a => a.id === line.adjustment_id && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    if (adj.status !== 'draft') {
      throw new Error(`調整單狀態為 ${adj.status}，僅草稿狀態可修改明細`);
    }

    const delta = Number(quantity_delta !== undefined ? quantity_delta : quantityDelta);
    if (isNaN(delta) || Math.abs(delta) < 1e-9) {
      throw new Error('調整數量不可為 0');
    }

    line.quantity_delta = delta;
    saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
    return formatMockInventoryAdjustmentDetail(adj);
  },

  remove_inventory_adjustment_line: async (args) => {
    const { line_id, lineId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetLineId = String(line_id || lineId || '').trim();
    const lineIndex = mockInventoryAdjustmentLines.findIndex(l => l.id === targetLineId);
    if (lineIndex === -1) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    const line = mockInventoryAdjustmentLines[lineIndex];
    const adj = mockInventoryAdjustments.find(a => a.id === line.adjustment_id && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    if (adj.status !== 'draft') {
      throw new Error(`調整單狀態為 ${adj.status}，僅草稿狀態可刪除明細`);
    }

    mockInventoryAdjustmentLines.splice(lineIndex, 1);
    const remaining = mockInventoryAdjustmentLines
      .filter(l => l.adjustment_id === adj.id)
      .sort((a, b) => a.line_no - b.line_no);
    remaining.forEach((l, idx) => {
      l.line_no = idx + 1;
    });
    saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
    return formatMockInventoryAdjustmentDetail(adj);
  },

  post_inventory_adjustment: async (args) => {
    const { adjustment_id, adjustmentId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
    const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到調整單或不屬於目前租戶');
    }
    if (adj.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${adj.status} 轉換至 posted`);
    }

    const wh = validateMockWarehouseActive(targetTenantId, adj.warehouse_id);

    const lines = mockInventoryAdjustmentLines.filter(l => l.adjustment_id === adj.id);
    if (lines.length === 0) {
      throw new Error('調整單沒有任何明細');
    }

    for (const line of lines) {
      resolveMockUnitSnapshot(targetTenantId, line.unit_id);
      if (Math.abs(line.quantity_delta) < 1e-9) {
        throw new Error('調整數量不可為 0');
      }
    }

    // Check current quantity and A-09 negative check
    for (const line of lines) {
      const movements = (mockInventoryMovements || []).filter(
        m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === adj.warehouse_id && m.unit_id === line.unit_id
      );
      const currentQty = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
      const newQty = currentQty + line.quantity_delta;
      if (newQty < -1e-6) {
        const curStr = formatMockQty(currentQty);
        const newStr = formatMockQty(newQty);
        throw new Error(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${wh.name}〕現有 ${curStr}，調整後將為 ${newStr}（負數），無法過帳`);
      }
    }

    const now = args?.created_at !== undefined ? args.created_at : Math.floor(Date.now() / 1000);
    adj.status = 'posted';
    adj.posted_at = now;

    for (const line of lines) {
      const imId = nextMockUid('im');
      mockInventoryMovements.push({
        id: imId,
        tenant_id: targetTenantId,
        warehouse_id: adj.warehouse_id,
        unit_id: line.unit_id,
        quantity_delta: line.quantity_delta,
        unit_cost: null,
        reason: 'adjustment',
        reference_type: 'inventory_adjustment',
        reference_id: adj.id,
        created_by: activeUid,
        created_at: now
      });
    }

    saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    return formatMockInventoryAdjustmentDetail(adj);
  },

  cancel_inventory_adjustment: async (args) => {
    const { adjustment_id, adjustmentId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
    const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到調整單或不屬於目前租戶');
    }
    if (adj.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${adj.status} 轉換至 cancelled`);
    }

    const now = Math.floor(Date.now() / 1000);
    adj.status = 'cancelled';
    adj.cancelled_at = now;

    saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
    return formatMockInventoryAdjustmentDetail(adj);
  },

  get_inventory_adjustment: async (args) => {
    const { adjustment_id, adjustmentId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
    const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!adj) {
      throw new Error('找不到調整單或不屬於目前租戶');
    }
    return formatMockInventoryAdjustmentDetail(adj);
  },

  list_inventory_adjustments: async (args) => {
    const { status, warehouse_id, warehouseId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    let list = mockInventoryAdjustments.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (status && String(status).trim()) {
      list = list.filter(a => a.status === String(status).trim());
    }
    if (targetWhId && String(targetWhId).trim()) {
      list = list.filter(a => a.warehouse_id === String(targetWhId).trim());
    }
    return list
      .map(a => {
        const lines = mockInventoryAdjustmentLines.filter(l => l.adjustment_id === a.id);
        return {
          ...a,
          lines_count: lines.length
        };
      })
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
  },

  reset_mock_inventory_adjustments: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      const removedAdjIds = new Set(
        mockInventoryAdjustments.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTid).map(a => a.id)
      );
      mockInventoryAdjustments = mockInventoryAdjustments.filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTid);
      mockInventoryAdjustmentLines = mockInventoryAdjustmentLines.filter(l => !removedAdjIds.has(l.adjustment_id));
    } else {
      mockInventoryAdjustments = [];
      mockInventoryAdjustmentLines = [];
    }
    saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
    saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
    return true;
  }
};
