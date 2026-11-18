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
  mockInventoryMovements,
  validateMockWarehouseActive,
  resolveMockDefaultWarehouse,
  resolveMockUnitSnapshot,
  formatMockQty
} from '../tauri.js';

export let mockSalesOrders = loadStorage('agent_erp_mock_sales_orders', []);
if (!mockSalesOrders || !Array.isArray(mockSalesOrders)) {
  mockSalesOrders = [];
  saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
}

export let mockSalesOrderLines = loadStorage('agent_erp_mock_sales_order_lines', []);
if (!mockSalesOrderLines || !Array.isArray(mockSalesOrderLines)) {
  mockSalesOrderLines = [];
  saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
}

export let mockSalesShipments = loadStorage('agent_erp_mock_sales_shipments', []);
if (!mockSalesShipments || !Array.isArray(mockSalesShipments)) {
  mockSalesShipments = [];
  saveStorage('agent_erp_mock_sales_shipments', mockSalesShipments);
}

export let mockSalesShipmentLines = loadStorage('agent_erp_mock_sales_shipment_lines', []);
if (!mockSalesShipmentLines || !Array.isArray(mockSalesShipmentLines)) {
  mockSalesShipmentLines = [];
  saveStorage('agent_erp_mock_sales_shipment_lines', mockSalesShipmentLines);
}

export function nextMockSoNumber(tenantId) {
  const existing = mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const o of existing) {
    if (o.so_number && o.so_number.startsWith('SO-')) {
      const num = parseInt(o.so_number.substring(3), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `SO-${String(maxSeq + 1).padStart(5, '0')}`;
}

export function nextMockShipmentNumber(tenantId) {
  const existing = mockSalesShipments.filter(s => (s.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const s of existing) {
    if (s.shipment_number && s.shipment_number.startsWith('SHP-')) {
      const num = parseInt(s.shipment_number.substring(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `SHP-${String(maxSeq + 1).padStart(5, '0')}`;
}

export function validateMockCalendarDate(dateStr) {
  const trimmed = String(dateStr || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error('日期格式需為 YYYY-MM-DD');
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('無效的日期數值');
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const dim = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > dim) {
    throw new Error('日期超出該月份天數');
  }
  return trimmed;
}

export function formatMockSalesOrder(order) {
  const lines = mockSalesOrderLines
    .filter(l => l.sales_order_id === order.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map(l => {
      const subtotal = Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100;
      const shipped_subtotal = l.shipped_quantity !== null && l.shipped_quantity !== undefined
        ? Math.round(Number(l.shipped_quantity) * Number(l.unit_price) * 100) / 100
        : null;
      return {
        ...l,
        subtotal,
        shipped_subtotal
      };
    });
  const total_amount = Math.round(lines.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100;
  const shipped_amount = Math.round(lines.reduce((sum, l) => sum + (l.shipped_subtotal || 0), 0) * 100) / 100;
  const shipments = mockSalesShipments
    .filter(s => s.sales_order_id === order.id)
    .sort((a, b) => (a.shipped_at - b.shipped_at) || (a.created_at - b.created_at) || String(a.shipment_number).localeCompare(String(b.shipment_number)))
    .map(s => {
      const shpLines = mockSalesShipmentLines
        .filter(sl => sl.shipment_id === s.id)
        .sort((a, b) => a.line_no - b.line_no)
        .map(sl => ({
          ...sl,
          subtotal: Math.round(Number(sl.shipped_quantity) * Number(sl.unit_price) * 100) / 100
        }));
      const shpTotal = Math.round(shpLines.reduce((sum, sl) => sum + sl.subtotal, 0) * 100) / 100;
      return {
        ...s,
        total_amount: shpTotal,
        lines: shpLines
      };
    });
  return {
    order: {
      ...order,
      total_amount,
      shipped_amount,
      lines_count: lines.length
    },
    lines,
    shipments
  };
}

export function resetMockSalesOrders(tenantId) {
  if (tenantId) {
    const removedIds = new Set(
      mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === tenantId).map(o => o.id)
    );
    const removedShipmentIds = new Set(
      mockSalesShipments.filter(s => removedIds.has(s.sales_order_id)).map(s => s.id)
    );
    mockSalesOrders = mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') !== tenantId);
    mockSalesOrderLines = mockSalesOrderLines.filter(l => !removedIds.has(l.sales_order_id));
    mockSalesShipments = mockSalesShipments.filter(s => !removedIds.has(s.sales_order_id));
    mockSalesShipmentLines = mockSalesShipmentLines.filter(sl => !removedShipmentIds.has(sl.shipment_id));
  } else {
    mockSalesOrders = [];
    mockSalesOrderLines = [];
    mockSalesShipments = [];
    mockSalesShipmentLines = [];
  }
  saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
  saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
  saveStorage('agent_erp_mock_sales_shipments', mockSalesShipments);
  saveStorage('agent_erp_mock_sales_shipment_lines', mockSalesShipmentLines);
  return true;
}

export const salesOrderMocks = {
  ship_sales_order: async (args) => {
    const {
      order_id,
      orderId,
      ship_date,
      shipDate,
      line_shipped_quantities,
      lineShippedQuantities,
      note,
      today_override,
      todayOverride
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const rawToday = today_override !== undefined ? today_override : todayOverride;
    const today = (rawToday !== undefined && rawToday !== null && String(rawToday).trim() !== '')
      ? validateMockCalendarDate(rawToday)
      : new Date().toISOString().slice(0, 10);

    const rawShipDate = ship_date !== undefined ? ship_date : shipDate;
    let resolvedShipDate = today;
    if (rawShipDate !== undefined && rawShipDate !== null && String(rawShipDate).trim() !== '') {
      resolvedShipDate = validateMockCalendarDate(rawShipDate);
      if (resolvedShipDate > today) {
        throw new Error('出貨日不可晚於今天');
      }
    }
    const cleanNote = note !== undefined && note !== null && String(note).trim() !== ''
      ? String(note).trim()
      : null;

    const targetOrderId = String(order_id || orderId || '').trim();
    const order = mockSalesOrders.find(
      o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!order) {
      throw new Error('找不到銷售單或不屬於目前租戶');
    }
    if (order.status !== 'confirmed' && order.status !== 'partially_shipped') {
      throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 shipped`);
    }

    const wh = validateMockWarehouseActive(targetTenantId, order.warehouse_id);

    const lines = mockSalesOrderLines
      .filter(l => l.sales_order_id === order.id)
      .sort((a, b) => a.line_no - b.line_no);
    if (lines.length === 0) {
      throw new Error('銷售單至少需有 1 筆明細');
    }

    const knownLineIds = new Set(lines.map(l => l.id));
    const overrideMap = new Map();
    const rawInputs = line_shipped_quantities !== undefined ? line_shipped_quantities : lineShippedQuantities;
    if (Array.isArray(rawInputs)) {
      for (const item of rawInputs) {
        const lid = String(item?.line_id || item?.lineId || '').trim();
        if (!knownLineIds.has(lid)) {
          throw new Error('找不到指定的銷售單明細行');
        }
        if (overrideMap.has(lid)) {
          throw new Error('出貨明細重複指定同一行');
        }
        const qtyVal = item.shipped_quantity !== undefined ? item.shipped_quantity : item.shippedQuantity;
        overrideMap.set(lid, Number(qtyVal));
      }
    } else if (rawInputs && typeof rawInputs === 'object') {
      for (const [k, v] of Object.entries(rawInputs)) {
        const lid = String(k).trim();
        if (!knownLineIds.has(lid)) {
          throw new Error('找不到指定的銷售單明細行');
        }
        overrideMap.set(lid, Number(v));
      }
    }

    const resolvedLines = [];
    let totalShipped = 0;
    let allFullyShipped = true;
    for (const line of lines) {
      const orderedQty = Number(line.quantity);
      const alreadyShipped = Number(line.shipped_quantity || 0);
      const remainingQty = Math.max(0, orderedQty - alreadyShipped);
      const actualQty = overrideMap.has(line.id) ? overrideMap.get(line.id) : remainingQty;
      if (!Number.isFinite(actualQty) || actualQty < 0) {
        throw new Error('出貨數量不可小於 0');
      }
      if (actualQty > remainingQty + 1e-9) {
        throw new Error(alreadyShipped <= 1e-9 ? '出貨數量不可超過訂購數量' : '出貨數量不可超過剩餘可出貨數量');
      }
      let newCumShipped = alreadyShipped + actualQty;
      if (newCumShipped + 1e-9 >= orderedQty) {
        if (newCumShipped > orderedQty) newCumShipped = orderedQty;
      } else {
        allFullyShipped = false;
      }
      totalShipped += actualQty;
      resolvedLines.push({ line, actualQty, newCumShipped });
    }
    if (totalShipped <= 0) {
      throw new Error('出貨數量合計需大於 0');
    }

    // Check stock atomically before mutating anything
    for (const { line, actualQty } of resolvedLines) {
      if (actualQty <= 0) continue;
      let currentStock = 0;
      for (const m of (mockInventoryMovements || [])) {
        if (
          (m.tenant_id || 'tnt_mock_1') === targetTenantId &&
          m.unit_id === line.unit_id &&
          m.warehouse_id === wh.id
        ) {
          currentStock += Number(m.quantity_delta || 0);
        }
      }
      if (currentStock + 1e-9 < actualQty) {
        throw new Error(
          `〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${wh.name}〕現有 ${formatMockQty(currentStock)}，不足出貨 ${formatMockQty(actualQty)}`
        );
      }
    }

    const now = Math.floor(Date.now() / 1000);
    order.status = allFullyShipped ? 'shipped' : 'partially_shipped';
    order.ship_date = resolvedShipDate;
    order.shipped_by = activeUid;
    order.shipped_at = now;

    const shipmentId = nextMockUid('shp');
    const shipmentNumber = nextMockShipmentNumber(targetTenantId);
    mockSalesShipments.push({
      id: shipmentId,
      tenant_id: targetTenantId,
      sales_order_id: order.id,
      shipment_number: shipmentNumber,
      warehouse_id: wh.id,
      ship_date: resolvedShipDate,
      note: cleanNote,
      shipped_by: activeUid,
      shipped_at: now,
      created_at: now
    });

    for (const { line, actualQty, newCumShipped } of resolvedLines) {
      line.shipped_quantity = newCumShipped;
      if (actualQty <= 0) continue;
      mockSalesShipmentLines.push({
        id: nextMockUid('shpl'),
        shipment_id: shipmentId,
        sales_order_line_id: line.id,
        line_no: line.line_no,
        unit_id: line.unit_id,
        product_name_snapshot: line.product_name_snapshot,
        variant_name_snapshot: line.variant_name_snapshot,
        sku_snapshot: line.sku_snapshot || null,
        unit_name_snapshot: line.unit_name_snapshot,
        shipped_quantity: actualQty,
        unit_price: Number(line.unit_price),
        created_at: now
      });
      mockInventoryMovements.push({
        id: nextMockUid('mov_so'),
        tenant_id: targetTenantId,
        unit_id: line.unit_id,
        warehouse_id: wh.id,
        quantity_delta: -actualQty,
        unit_cost: null,
        reason: 'sales_shipment',
        reference_type: 'sales_order',
        reference_id: order.id,
        created_by: activeUid,
        created_at: now
      });
    }

    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
    saveStorage('agent_erp_mock_sales_shipments', mockSalesShipments);
    saveStorage('agent_erp_mock_sales_shipment_lines', mockSalesShipmentLines);
    saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
    return formatMockSalesOrder(order);
  },

  cancel_sales_order: async (args) => {
    const { order_id, orderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const targetOrderId = String(order_id || orderId || '').trim();
    const order = mockSalesOrders.find(
      o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!order) {
      throw new Error('找不到銷售單或不屬於目前租戶');
    }
    if (order.status !== 'confirmed') {
      throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 cancelled`);
    }

    // SO-14: Active customer invoice check
    const storedInvoices = loadStorage('agent_erp_mock_customer_invoices', []);
    const storedInvoiceOrders = loadStorage('agent_erp_mock_customer_invoice_orders', []);
    const activeCovered = (storedInvoiceOrders || []).find(cio => {
      if (cio.sales_order_id !== targetOrderId || (cio.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
      const parent = (storedInvoices || []).find(ci => ci.id === cio.customer_invoice_id);
      return parent && (parent.status === 'draft' || parent.status === 'posted');
    });
    if (activeCovered) {
      const parent = (storedInvoices || []).find(ci => ci.id === activeCovered.customer_invoice_id);
      throw new Error(`銷售單 ${order.so_number} 已開立發票 ${parent?.invoice_number || ''}，請先作廢或取消發票`);
    }

    const now = Math.floor(Date.now() / 1000);
    order.status = 'cancelled';
    order.cancelled_at = now;

    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    return formatMockSalesOrder(order);
  },

  get_sales_order: async (args) => {
    const { order_id, orderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const targetOrderId = String(order_id || orderId || '').trim();
    const order = mockSalesOrders.find(
      o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!order) {
      throw new Error('找不到銷售單或不屬於目前租戶');
    }
    return formatMockSalesOrder(order);
  },

  list_sales_orders: async (args) => {
    const {
      status,
      customer_partner_id,
      customerPartnerId,
      warehouse_id,
      warehouseId
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    let list = mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (status && String(status).trim()) {
      const st = String(status).trim();
      list = list.filter(o => o.status === st);
    }
    const cid = customer_partner_id !== undefined ? customer_partner_id : customerPartnerId;
    if (cid && String(cid).trim()) {
      const c = String(cid).trim();
      list = list.filter(o => o.customer_partner_id === c);
    }
    const wid = warehouse_id !== undefined ? warehouse_id : warehouseId;
    if (wid && String(wid).trim()) {
      const w = String(wid).trim();
      list = list.filter(o => o.warehouse_id === w);
    }
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return list.map(o => formatMockSalesOrder(o).order);
  },

  seed_mock_sales_order: async (args) => {
    // Test-only helper for mocking confirmed sales orders (since #220 has no create_sales_order command)
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const sourceQuoteId = String(payload.source_quote_id || payload.sourceQuoteId || '').trim();
    if (!sourceQuoteId) {
      throw new Error('來源報價單 ID 不可為空');
    }
    if (mockSalesOrders.some(o => o.source_quote_id === sourceQuoteId)) {
      throw new Error('此報價單已轉換過銷售單，不可重複轉單');
    }
    const customerId = String(payload.customer_partner_id || payload.customerPartnerId || '').trim();
    const customer = mockPartners.find(
      p => p.id === customerId && (p.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!customer || !customer.is_customer || customer.is_active === false) {
      throw new Error('找不到此客戶，或該往來對象未設定為客戶');
    }
    const rawWhId = payload.warehouse_id !== undefined ? payload.warehouse_id : payload.warehouseId;
    const wh = (rawWhId && String(rawWhId).trim())
      ? validateMockWarehouseActive(targetTenantId, rawWhId)
      : resolveMockDefaultWarehouse(targetTenantId);

    const rawCurrency = payload.currency ? String(payload.currency).trim() : 'TWD';
    if (rawCurrency !== 'TWD') {
      throw new Error('幣別僅支援 TWD');
    }
    const rawExpected = payload.expected_ship_date !== undefined ? payload.expected_ship_date : payload.expectedShipDate;
    const expectedShipDate = (rawExpected && String(rawExpected).trim())
      ? validateMockCalendarDate(rawExpected)
      : null;

    const inputLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (inputLines.length === 0) {
      throw new Error('銷售單至少需有 1 筆明細');
    }
    const seenUnits = new Set();
    for (const l of inputLines) {
      const uid = String(l.unit_id || l.unitId || '').trim();
      resolveMockUnitSnapshot(targetTenantId, uid);
      if (seenUnits.has(uid)) {
        throw new Error('同一銷售單內商品單位不可重複');
      }
      seenUnits.add(uid);
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('數量必須大於 0');
      }
      const price = Number(l.unit_price);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error('單價不可為負數');
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const soId = nextMockUid('so');
    const soNumber = nextMockSoNumber(targetTenantId);
    const order = {
      id: soId,
      tenant_id: targetTenantId,
      so_number: soNumber,
      customer_partner_id: customer.id,
      customer_name_snapshot: payload.customer_name_snapshot ? String(payload.customer_name_snapshot).trim() : customer.name,
      customer_reference: payload.customer_reference ? String(payload.customer_reference).trim() : null,
      source_quote_id: sourceQuoteId,
      warehouse_id: wh.id,
      currency: 'TWD',
      status: 'confirmed',
      expected_ship_date: expectedShipDate,
      ship_date: null,
      note: payload.note ? String(payload.note).trim() : null,
      created_by: activeUid,
      created_at: now,
      confirmed_at: now,
      shipped_by: null,
      shipped_at: null,
      cancelled_at: null,
      task_id: payload.task_id || null
    };
    mockSalesOrders.push(order);

    inputLines.forEach((l, idx) => {
      mockSalesOrderLines.push({
        id: nextMockUid('sol'),
        sales_order_id: soId,
        line_no: idx + 1,
        unit_id: String(l.unit_id || l.unitId).trim(),
        product_name_snapshot: String(l.product_name_snapshot).trim(),
        variant_name_snapshot: String(l.variant_name_snapshot).trim(),
        sku_snapshot: l.sku_snapshot ? String(l.sku_snapshot).trim() : null,
        unit_name_snapshot: String(l.unit_name_snapshot).trim(),
        quantity: Number(l.quantity),
        shipped_quantity: null,
        unit_price: Number(l.unit_price),
        standard_price_snapshot: Number(l.standard_price_snapshot ?? l.unit_price),
        created_at: now
      });
    });

    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
    return formatMockSalesOrder(order);
  },

  reset_mock_sales_orders: async (args) => {
    const { tenant_id, tenantId } = args || {};
    return resetMockSalesOrders(tenant_id || tenantId);
  }
};

