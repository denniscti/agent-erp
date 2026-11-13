// @ts-check
import {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import {
  mockProducts,
  mockProductVariants,
  mockProductUnits,
  mockProductSupplySources
} from '../products/mocks.js';
import {
  mockInventoryMovements,
  validateMockWarehouseActive,
  resolveMockDefaultWarehouse
} from '../tauri.js';

export let mockPurchaseOrders = loadStorage('agent_erp_mock_purchase_orders', []);
if (!mockPurchaseOrders || !Array.isArray(mockPurchaseOrders)) {
  mockPurchaseOrders = [];
  saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
}

export let mockPurchaseOrderLines = loadStorage('agent_erp_mock_purchase_order_lines', []);
if (!mockPurchaseOrderLines || !Array.isArray(mockPurchaseOrderLines)) {
  mockPurchaseOrderLines = [];
  saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
}

export function nextMockPoNumber(tenantId) {
  let maxSeq = 0;
  for (const po of mockPurchaseOrders) {
    if ((po.tenant_id || 'tnt_mock_1') === tenantId && po.po_number && po.po_number.startsWith('PO-')) {
      const num = parseInt(po.po_number.slice(3), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `PO-${String(maxSeq + 1).padStart(5, '0')}`;
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

export function resolveMockVendorSnapshot(tenantId, vendorPartnerId) {
  const targetVid = String(vendorPartnerId || '').trim();
  const partner = mockPartners.find(p => p.id === targetVid && (p.tenant_id || 'tnt_mock_1') === tenantId);
  if (!partner) {
    throw new Error('找不到指定的供應商或不屬於目前租戶');
  }
  if (!partner.is_vendor) {
    throw new Error('指定的合作夥伴不是供應商 (is_vendor != 1)');
  }
  return partner.name;
}

export function formatMockPurchaseOrderDetail(order) {
  const lines = mockPurchaseOrderLines
    .filter(l => l.purchase_order_id === order.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map(l => ({
      ...l,
      subtotal: (l.quantity || 0) * (l.purchase_cost || 0)
    }));
  const total_amount = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return {
    order: {
      ...order,
      total_amount
    },
    lines
  };
}

export function calculateMockPoReceivedTotal(poId) {
  const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === poId);
  let total = 0;
  for (const l of lines) {
    const qty = l.received_quantity !== undefined && l.received_quantity !== null ? Number(l.received_quantity) : Number(l.quantity);
    total += qty * Number(l.purchase_cost);
  }
  return Math.round(total * 100) / 100;
}

export function calculateMockPoOrderedTotal(poId) {
  const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === poId);
  let total = 0;
  for (const l of lines) {
    total += Number(l.quantity) * Number(l.purchase_cost);
  }
  return Math.round(total * 100) / 100;
}

export const purchaseOrderMocks = {
  create_purchase_order: async (args) => {
    const {
      vendor_partner_id, vendorPartnerId,
      currency,
      expected_date, expectedDate,
      note,
      task_id, taskId,
      initial_lines, initialLines,
      warehouse_id, warehouseId,
      created_at, createdAt
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetVendorId = vendor_partner_id || vendorPartnerId;
    const targetUserId = resolveMockActiveUserId();
    if (!targetUserId || !targetUserId.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }
    const curr = currency || 'TWD';
    if (curr.trim().toUpperCase() !== 'TWD') {
      throw new Error("幣別僅支援 'TWD'");
    }
    const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    let targetWh;
    if (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') {
      targetWh = validateMockWarehouseActive(targetTenantId, rawWhId);
    } else {
      targetWh = resolveMockDefaultWarehouse(targetTenantId);
    }
    const vendorName = resolveMockVendorSnapshot(targetTenantId, targetVendorId);
    const now = Math.floor(Date.now() / 1000);
    const poId = nextMockUid('po');
    const poNumber = nextMockPoNumber(targetTenantId);

    const newOrder = {
      id: poId,
      tenant_id: targetTenantId,
      po_number: poNumber,
      warehouse_id: targetWh.id,
      vendor_partner_id: targetVendorId,
      vendor_name_snapshot: vendorName,
      currency: curr.trim().toUpperCase(),
      status: 'draft',
      expected_date: expected_date !== undefined ? expected_date : (expectedDate || null),
      note: note || null,
      created_by: targetUserId.trim(),
      created_at: (created_at !== undefined ? created_at : (createdAt !== undefined ? createdAt : now)),
      ordered_at: null,
      received_at: null,
      cancelled_at: null,
      task_id: task_id || taskId || null
    };
    mockPurchaseOrders.push(newOrder);

    const items = initial_lines || initialLines || [];
    const seenUnits = new Set();
    items.forEach((item, idx) => {
      const uId = String(item.unit_id || item.unitId || '').trim();
      if (seenUnits.has(uId)) {
        throw new Error('同一採購單內商品單位不可重複，若需調整數量請修改既有明細');
      }
      seenUnits.add(uId);

      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
      if (!product.is_purchasable) {
        throw new Error(`商品「${product.name}」設定為不可採購 (is_purchasable = 0)`);
      }
      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('採購數量必須大於 0');
      }

      let cost = item.purchase_cost !== undefined ? item.purchase_cost : item.purchaseCost;
      let supplySourceId = null;

      const src = mockProductSupplySources.find(s => s.unit_id === uId && s.vendor_partner_id === targetVendorId);
      if (src && (src.currency || 'TWD').toUpperCase() === 'TWD') {
        supplySourceId = src.id;
        if (cost === undefined || cost === null) {
          cost = src.purchase_cost !== undefined ? src.purchase_cost : src.cost;
        }
      }

      if (cost === undefined || cost === null) {
        throw new Error('查無此供應商的預設供應來源成本，請手動指定單價');
      }
      const numCost = Number(cost);
      if (isNaN(numCost) || numCost < 0) {
        throw new Error('採購單價不可為負數');
      }

      const polId = nextMockUid('pol');
      const newLine = {
        id: polId,
        purchase_order_id: poId,
        line_no: idx + 1,
        unit_id: uId,
        supply_source_id: supplySourceId,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || null,
        unit_name_snapshot: unit.unit_name,
        quantity: qty,
        received_quantity: null,
        purchase_cost: numCost,
        created_at: now
      };
      mockPurchaseOrderLines.push(newLine);
    });

    saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
    saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
    return formatMockPurchaseOrderDetail(newOrder);
  },

  update_purchase_order_header: async (args) => {
    const {
      order_id, orderId,
      vendor_partner_id, vendorPartnerId,
      expected_date, expectedDate,
      note,
      warehouse_id, warehouseId
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetOrderId = order_id || orderId;
    const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到採購單或不屬於目前租戶');
    }
    if (order.status === 'received' || order.status === 'cancelled') {
      throw new Error(`採購單狀態為 ${order.status}，不允許修改表頭`);
    }
    const newVendor = vendor_partner_id !== undefined ? vendor_partner_id : vendorPartnerId;
    if (newVendor !== undefined && newVendor !== order.vendor_partner_id) {
      if (order.status !== 'draft') {
        throw new Error('僅有草稿 (draft) 狀態的採購單可修改供應商');
      }
      const hasLines = mockPurchaseOrderLines.some(l => l.purchase_order_id === order.id);
      if (hasLines) {
        throw new Error('採購單已有明細，不可修改供應商');
      }
      const vendorName = resolveMockVendorSnapshot(targetTenantId, newVendor);
      order.vendor_partner_id = newVendor;
      order.vendor_name_snapshot = vendorName;
    }
    const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
    if (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') {
      const wh = validateMockWarehouseActive(targetTenantId, rawWhId);
      order.warehouse_id = wh.id;
    }
    if (expected_date !== undefined || expectedDate !== undefined) {
      order.expected_date = expected_date !== undefined ? expected_date : expectedDate;
    }
    if (note !== undefined) {
      order.note = note;
    }
    saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
    return formatMockPurchaseOrderDetail(order);
  },

  add_purchase_order_line: async (args) => {
    const { order_id, orderId, purchase_order_id, purchaseOrderId, unit_id, unitId, quantity, purchase_cost, purchaseCost } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetOrderId = order_id || orderId || purchase_order_id || purchaseOrderId;
    const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到採購單或不屬於目前租戶');
    }
    if (order.status !== 'draft') {
      throw new Error(`採購單狀態為 ${order.status}，僅草稿狀態可新增明細`);
    }
    const targetUnitId = String(unit_id || unitId || '').trim();
    const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, targetUnitId);
    if (!product.is_purchasable) {
      throw new Error(`商品「${product.name}」設定為不可採購 (is_purchasable = 0)`);
    }
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('採購數量必須大於 0');
    }
    const isDup = mockPurchaseOrderLines.some(l => l.purchase_order_id === order.id && l.unit_id === targetUnitId);
    if (isDup) {
      throw new Error('同一採購單內商品單位不可重複，若需調整數量請修改既有明細');
    }

    let cost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
    let supplySourceId = null;

    const src = mockProductSupplySources.find(s => s.unit_id === targetUnitId && s.vendor_partner_id === order.vendor_partner_id);
    if (src && (src.currency || 'TWD').toUpperCase() === (order.currency || 'TWD').toUpperCase()) {
      supplySourceId = src.id;
      if (cost === undefined || cost === null) {
        cost = src.purchase_cost !== undefined ? src.purchase_cost : src.cost;
      }
    }

    if (cost === undefined || cost === null) {
      throw new Error('查無此供應商的預設供應來源成本，請手動指定單價');
    }
    const numCost = Number(cost);
    if (isNaN(numCost) || numCost < 0) {
      throw new Error('採購單價不可為負數');
    }

    const maxLineNo = mockPurchaseOrderLines
      .filter(l => l.purchase_order_id === order.id)
      .reduce((max, l) => Math.max(max, l.line_no || 0), 0);
    const now = Math.floor(Date.now() / 1000);
    const polId = nextMockUid('pol');
    const newLine = {
      id: polId,
      purchase_order_id: order.id,
      line_no: maxLineNo + 1,
      unit_id: targetUnitId,
      supply_source_id: supplySourceId,
      product_name_snapshot: product.name,
      variant_name_snapshot: variant.name,
      sku_snapshot: variant.sku || null,
      unit_name_snapshot: unit.unit_name,
      quantity: qty,
      received_quantity: null,
      purchase_cost: numCost,
      created_at: now
    };
    mockPurchaseOrderLines.push(newLine);
    saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
    return formatMockPurchaseOrderDetail(order);
  },

  update_purchase_order_line: async (args) => {
    const { line_id, lineId, quantity, purchase_cost, purchaseCost } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetLineId = line_id || lineId;
    const line = mockPurchaseOrderLines.find(l => l.id === targetLineId);
    if (!line) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    const order = mockPurchaseOrders.find(o => o.id === line.purchase_order_id && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    if (order.status !== 'draft') {
      throw new Error(`採購單狀態為 ${order.status}，僅草稿狀態可修改明細`);
    }
    if (quantity !== undefined) {
      const qty = Number(quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('採購數量必須大於 0');
      }
      line.quantity = qty;
    }
    const rawCost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
    if (rawCost !== undefined) {
      const cost = Number(rawCost);
      if (isNaN(cost) || cost < 0) {
        throw new Error('採購單價不可為負數');
      }
      line.purchase_cost = cost;
    }
    saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
    return formatMockPurchaseOrderDetail(order);
  },

  remove_purchase_order_line: async (args) => {
    const { line_id, lineId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetLineId = line_id || lineId;
    const lineIndex = mockPurchaseOrderLines.findIndex(l => l.id === targetLineId);
    if (lineIndex === -1) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    const line = mockPurchaseOrderLines[lineIndex];
    const order = mockPurchaseOrders.find(o => o.id === line.purchase_order_id && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到明細項目或不屬於目前租戶');
    }
    if (order.status !== 'draft') {
      throw new Error(`採購單狀態為 ${order.status}，僅草稿狀態可刪除明細`);
    }
    mockPurchaseOrderLines.splice(lineIndex, 1);
    const remaining = mockPurchaseOrderLines
      .filter(l => l.purchase_order_id === order.id)
      .sort((a, b) => a.line_no - b.line_no);
    remaining.forEach((l, idx) => {
      l.line_no = idx + 1;
    });
    saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
    return formatMockPurchaseOrderDetail(order);
  },

  submit_purchase_order: async (args) => {
    const { order_id, orderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetOrderId = order_id || orderId;
    const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到採購單或不屬於目前租戶');
    }
    if (order.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 ordered`);
    }
    const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === order.id);
    if (lines.length === 0) {
      throw new Error('採購單至少需有 1 筆明細方可下單');
    }
    for (const l of lines) {
      const { product } = resolveMockUnitSnapshot(targetTenantId, l.unit_id);
      if (!product.is_purchasable) {
        throw new Error(`明細項目「${product.name}」設定為不可採購 (is_purchasable = 0)`);
      }
      if (l.quantity <= 0) {
        throw new Error('明細項目採購數量必須大於 0');
      }
      if (l.purchase_cost < 0) {
        throw new Error('明細項目採購單價不可為負數');
      }
    }
    const now = Math.floor(Date.now() / 1000);
    order.status = 'ordered';
    order.ordered_at = now;
    saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
    return formatMockPurchaseOrderDetail(order);
  },

  confirm_purchase_order_received: async (args) => {
    const { order_id, orderId, line_received_quantities, lineReceivedQuantities, received_lines, receivedLines } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetOrderId = order_id || orderId;
    const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到採購單或不屬於目前租戶');
    }
    if (order.status !== 'ordered') {
      throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 received`);
    }
    const rawMap = line_received_quantities || lineReceivedQuantities || received_lines || receivedLines || [];
    const recMap = new Map();
    if (Array.isArray(rawMap)) {
      rawMap.forEach(item => {
        recMap.set(item.line_id || item.lineId, item.received_quantity !== undefined ? item.received_quantity : item.receivedQuantity);
      });
    } else if (rawMap && typeof rawMap === 'object') {
      Object.entries(rawMap).forEach(([k, v]) => recMap.set(k, v));
    }

    const now = Math.floor(Date.now() / 1000);
    const targetUserId = resolveMockActiveUserId();
    const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === order.id);

    for (const l of lines) {
      const userQty = recMap.get(l.id);
      const actualQty = userQty !== undefined ? Number(userQty) : l.quantity;
      if (actualQty < 0) {
        throw new Error('實到數量不可為負數');
      }
    }

    if (!order.warehouse_id) {
      const defWh = resolveMockDefaultWarehouse(targetTenantId);
      order.warehouse_id = defWh.id;
    }
    validateMockWarehouseActive(targetTenantId, order.warehouse_id);

    order.status = 'received';
    order.received_at = now;

    for (const l of lines) {
      const userQty = recMap.get(l.id);
      const actualQty = userQty !== undefined ? Number(userQty) : l.quantity;
      l.received_quantity = actualQty;

      const imId = nextMockUid('im');
      mockInventoryMovements.push({
        id: imId,
        tenant_id: targetTenantId,
        warehouse_id: order.warehouse_id,
        unit_id: l.unit_id,
        quantity_delta: actualQty,
        unit_cost: l.purchase_cost,
        reason: 'purchase_receipt',
        reference_type: 'purchase_order',
        reference_id: order.id,
        created_by: targetUserId,
        created_at: now
      });
    }

    saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
    saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    return formatMockPurchaseOrderDetail(order);
  },

  cancel_purchase_order: async (args) => {
    const { order_id, orderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetOrderId = order_id || orderId;
    const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到採購單或不屬於目前租戶');
    }
    if (order.status !== 'draft' && order.status !== 'ordered') {
      throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 cancelled`);
    }
    const now = Math.floor(Date.now() / 1000);
    order.status = 'cancelled';
    order.cancelled_at = now;
    saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
    return formatMockPurchaseOrderDetail(order);
  },

  get_purchase_order: async (args) => {
    const { order_id, orderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetOrderId = order_id || orderId;
    const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!order) {
      throw new Error('找不到採購單或不屬於目前租戶');
    }
    return formatMockPurchaseOrderDetail(order);
  },

  list_purchase_orders: async (args) => {
    const { filter_status, filterStatus, filter_vendor_partner_id, filterVendorPartnerId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = mockPurchaseOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    const st = filter_status || filterStatus;
    if (st && String(st).trim()) {
      const norm = String(st).trim();
      list = list.filter(o => o.status === norm);
    }
    const vp = filter_vendor_partner_id || filterVendorPartnerId;
    if (vp && String(vp).trim()) {
      const normVp = String(vp).trim();
      list = list.filter(o => o.vendor_partner_id === normVp);
    }
    return list
      .sort((a, b) => b.created_at - a.created_at)
      .map(o => {
        const detail = formatMockPurchaseOrderDetail(o);
        return detail.order;
      });
  }
};

