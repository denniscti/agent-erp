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
  mockProductUnits
} from '../products/mocks.js';
import {
  validateMockWarehouseActive,
  resolveMockDefaultWarehouse,
  resolveMockUnitSnapshot,
  mockAuditLogs
} from '../tauri.js';
import {
  mockSalesOrders,
  mockSalesOrderLines,
  nextMockSoNumber,
  formatMockSalesOrder,
  validateMockCalendarDate
} from '../salesOrders/mocks.js';

export let mockQuotes = loadStorage('agent_erp_mock_quotes', []);
if (!mockQuotes || !Array.isArray(mockQuotes)) {
  mockQuotes = [];
  saveStorage('agent_erp_mock_quotes', mockQuotes);
}

export let mockQuoteLines = loadStorage('agent_erp_mock_quote_lines', []);
if (!mockQuoteLines || !Array.isArray(mockQuoteLines)) {
  mockQuoteLines = [];
  saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
}

export function nextMockQuoteNumber(tenantId) {
  const existing = mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const q of existing) {
    if (q.quote_number && q.quote_number.startsWith('QUO-')) {
      const num = parseInt(q.quote_number.substring(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `QUO-${String(nextSeq).padStart(5, '0')}`;
}

export function expireMockQuotes(tenantId, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);
  for (const q of mockQuotes) {
    if ((q.tenant_id || 'tnt_mock_1') === tenantId && ['pending_approval', 'sent'].includes(q.status)) {
      if (q.valid_until < t) {
        q.status = 'expired';
        q.expired_at = now;
      }
    }
  }
  saveStorage('agent_erp_mock_quotes', mockQuotes);
}

export function formatMockQuote(quote) {
  const lines = mockQuoteLines
    .filter(l => l.quote_id === quote.id)
    .sort((a, b) => a.line_no - b.line_no);
  const total_amount = Math.round(lines.reduce((sum, l) => sum + (Number(l.line_amount) || 0), 0) * 100) / 100;
  return {
    quote: {
      ...quote,
      total_amount
    },
    lines,
    total_amount
  };
}

export function getMockBelowStandardLines(lines) {
  return lines
    .filter(l => {
      const unitPrice = Math.round(Number(l.unit_price) * 100) / 100;
      const stdPrice = Math.round(Number(l.standard_price_snapshot) * 100) / 100;
      return l.requires_approval === 1 || unitPrice < stdPrice || stdPrice <= 0;
    })
    .map(l => {
      const unitPrice = Math.round(Number(l.unit_price) * 100) / 100;
      const stdPrice = Math.round(Number(l.standard_price_snapshot) * 100) / 100;
      const diff = Math.round((stdPrice - unitPrice) * 100) / 100;
      return {
        line_id: l.id,
        unit_id: l.unit_id,
        product_name: l.product_name_snapshot,
        quantity: Number(l.quantity),
        unit_price: unitPrice,
        standard_price: stdPrice,
        difference: diff
      };
    });
}

export function resetMockQuotes(tenantId) {
  if (tenantId) {
    const removedQuoteIds = new Set(
      mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') === tenantId).map(q => q.id)
    );
    mockQuotes = mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') !== tenantId);
    mockQuoteLines = mockQuoteLines.filter(l => !removedQuoteIds.has(l.quote_id));
  } else {
    mockQuotes = [];
    mockQuoteLines = [];
  }
  saveStorage('agent_erp_mock_quotes', mockQuotes);
  saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
  return true;
}

export const quoteMocks = {
  create_quote: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const customerId = (payload.customer_partner_id || payload.customerPartnerId || '').trim();
    if (!customerId) {
      throw new Error('找不到此客戶，或該往來對象未設定為客戶');
    }
    const customer = mockPartners.find(p => p.id === customerId && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!customer || !customer.is_customer || customer.is_active === false) {
      throw new Error('找不到此客戶，或該往來對象未設定為客戶');
    }
    const validUntil = (payload.valid_until || payload.validUntil || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
      throw new Error('日期格式需為 YYYY-MM-DD');
    }
    const today = payload.today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const now = Math.floor(Date.now() / 1000);
    const quoteNumber = nextMockQuoteNumber(targetTenantId);
    const quoteId = `quo_${targetTenantId}_${now}_${Math.floor(Math.random() * 9000 + 1000)}`;

    const newQuote = {
      id: quoteId,
      tenant_id: targetTenantId,
      quote_number: quoteNumber,
      customer_partner_id: customer.id,
      customer_name_snapshot: customer.name,
      currency: 'TWD',
      status: 'draft',
      valid_until: validUntil,
      note: payload.note ? String(payload.note).trim() : null,
      customer_po_number: payload.customer_po_number || payload.customerPoNumber ? String(payload.customer_po_number || payload.customerPoNumber).trim() : null,
      requires_approval: 0,
      approval_rejection_reason: null,
      created_by: targetUserId,
      created_at: now,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      sent_at: null,
      declined_at: null,
      decline_reason: null,
      expired_at: null,
      cancelled_at: null,
      converted_at: null,
      accepted_by: null,
      converted_sales_order_id: null
    };

    mockQuotes.push(newQuote);
    saveStorage('agent_erp_mock_quotes', mockQuotes);
    return formatMockQuote(newQuote);
  },

  update_quote_header: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const quoteId = (payload.quote_id || payload.quoteId || '').trim();
    const today = payload.today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === quoteId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'draft') {
      throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
    }

    if (payload.customer_partner_id || payload.customerPartnerId) {
      const cid = (payload.customer_partner_id || payload.customerPartnerId).trim();
      const customer = mockPartners.find(p => p.id === cid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!customer || !customer.is_customer || customer.is_active === false) {
        throw new Error('找不到此客戶，或該往來對象未設定為客戶');
      }
      quote.customer_partner_id = customer.id;
      quote.customer_name_snapshot = customer.name;
    }

    if (payload.valid_until || payload.validUntil) {
      const vu = (payload.valid_until || payload.validUntil).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vu)) {
        throw new Error('日期格式需為 YYYY-MM-DD');
      }
      quote.valid_until = vu;
    }

    if (payload.note !== undefined) {
      quote.note = payload.note ? String(payload.note).trim() : null;
    }
    if (payload.customer_po_number !== undefined || payload.customerPoNumber !== undefined) {
      const po = payload.customer_po_number !== undefined ? payload.customer_po_number : payload.customerPoNumber;
      quote.customer_po_number = po ? String(po).trim() : null;
    }

    saveStorage('agent_erp_mock_quotes', mockQuotes);
    return formatMockQuote(quote);
  },

  add_quote_line: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const quoteId = (payload.quote_id || payload.quoteId || '').trim();
    const today = payload.today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === quoteId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'draft') {
      throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
    }

    const qty = Number(payload.quantity);
    const unitPrice = Number(payload.unit_price !== undefined ? payload.unit_price : payload.unitPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(unitPrice) || unitPrice < 0) {
      throw new Error('數量必須大於 0，單價不可為負數');
    }

    const unitId = (payload.unit_id || payload.unitId || '').trim();
    const existingLines = mockQuoteLines.filter(l => l.quote_id === quote.id);
    if (existingLines.some(l => l.unit_id === unitId)) {
      throw new Error('同一報價單內商品單位不可重複');
    }

    const foundUnit = (mockProductUnits || []).find(u => u.id === unitId);
    if (!foundUnit) {
      throw new Error('找不到指定的商品單位');
    }
    const foundVariant = (mockProductVariants || []).find(v => v.id === foundUnit.variant_id);
    const foundProduct = (mockProducts || []).find(p => p.id === foundVariant?.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!foundProduct) {
      throw new Error('找不到指定的商品單位');
    }
    if (!foundProduct.is_sellable) {
      throw new Error('此商品不可銷售');
    }

    const nextLineNo = existingLines.reduce((max, l) => Math.max(max, l.line_no || 0), 0) + 1;
    const now = Math.floor(Date.now() / 1000);
    const lineId = `qline_${targetTenantId}_${now}_${Math.floor(Math.random() * 9000 + 1000)}`;
    const roundedPrice = Math.round(unitPrice * 100) / 100;
    const lineAmount = Math.round(qty * roundedPrice * 100) / 100;
    const stdPrice = Number(foundUnit.selling_price) || 0;

    const newLine = {
      id: lineId,
      quote_id: quote.id,
      line_no: nextLineNo,
      unit_id: unitId,
      product_name_snapshot: foundProduct.name,
      variant_name_snapshot: foundVariant?.name || '標準',
      unit_name_snapshot: foundUnit.unit_name || '個',
      sku_snapshot: foundVariant?.sku || null,
      quantity: qty,
      unit_price: roundedPrice,
      standard_price_snapshot: stdPrice,
      requires_approval: 0,
      line_amount: lineAmount,
      note: payload.note ? String(payload.note).trim() : null
    };

    mockQuoteLines.push(newLine);
    saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
    return formatMockQuote(quote);
  },

  update_quote_line: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const quoteId = (payload.quote_id || payload.quoteId || '').trim();
    const lineId = (payload.line_id || payload.lineId || '').trim();
    const today = payload.today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === quoteId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'draft') {
      throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
    }

    const qty = Number(payload.quantity);
    const unitPrice = Number(payload.unit_price !== undefined ? payload.unit_price : payload.unitPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(unitPrice) || unitPrice < 0) {
      throw new Error('數量必須大於 0，單價不可為負數');
    }

    const line = mockQuoteLines.find(l => l.id === lineId && l.quote_id === quote.id);
    if (!line) throw new Error('找不到指定的報價明細');

    line.quantity = qty;
    line.unit_price = Math.round(unitPrice * 100) / 100;
    line.line_amount = Math.round(qty * line.unit_price * 100) / 100;
    if (payload.note !== undefined) {
      line.note = payload.note ? String(payload.note).trim() : null;
    }

    saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
    return formatMockQuote(quote);
  },

  delete_quote_line: async (args) => {
    const { quote_id, quoteId, line_id, lineId, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const qId = (quote_id || quoteId || '').trim();
    const lId = (line_id || lineId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'draft') {
      throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
    }

    const idx = mockQuoteLines.findIndex(l => l.id === lId && l.quote_id === quote.id);
    if (idx === -1) throw new Error('找不到指定的報價明細');
    mockQuoteLines.splice(idx, 1);

    saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
    return formatMockQuote(quote);
  },

  submit_quote: async (args) => {
    const { quote_id, quoteId, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const qId = (quote_id || quoteId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'draft') {
      throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
    }

    if (quote.valid_until < today) {
      throw new Error('報價有效期已過，請先修改有效期');
    }

    const lines = mockQuoteLines.filter(l => l.quote_id === quote.id);
    if (lines.length === 0) {
      throw new Error('報價單沒有任何品項，無法送出');
    }

    const now = Math.floor(Date.now() / 1000);
    let lowPriceCount = 0;

    for (const line of lines) {
      const foundUnit = (mockProductUnits || []).find(u => u.id === line.unit_id);
      const currentStdPrice = foundUnit ? (Number(foundUnit.selling_price) || 0) : 0;

      line.standard_price_snapshot = currentStdPrice;
      const roundedUnit = Math.round(Number(line.unit_price) * 100) / 100;
      const roundedStd = Math.round(currentStdPrice * 100) / 100;
      const needsAppr = roundedUnit < roundedStd || roundedStd <= 0;
      line.requires_approval = needsAppr ? 1 : 0;
      if (needsAppr) {
        lowPriceCount++;
      }
    }
    saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);

    let message = '';
    if (lowPriceCount > 0) {
      quote.status = 'pending_approval';
      quote.requires_approval = 1;
      quote.submitted_at = now;
      message = `已送交核准（${lowPriceCount} 項低於標準售價）`;
    } else {
      quote.status = 'sent';
      quote.requires_approval = 0;
      quote.submitted_at = now;
      quote.sent_at = now;
      message = '報價已送出';
    }

    saveStorage('agent_erp_mock_quotes', mockQuotes);
    return {
      quote: formatMockQuote(quote).quote,
      message
    };
  },

  withdraw_quote_approval: async (args) => {
    const { quote_id, quoteId, reason, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const qId = (quote_id || quoteId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'pending_approval') {
      throw new Error('目前狀態不允許此操作');
    }

    quote.status = 'draft';
    quote.approval_rejection_reason = reason ? String(reason).trim() : null;
    saveStorage('agent_erp_mock_quotes', mockQuotes);
    return formatMockQuote(quote);
  },

  decline_quote: async (args) => {
    const { quote_id, quoteId, reason, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const qId = (quote_id || quoteId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'sent') {
      throw new Error('目前狀態不允許此操作');
    }

    const now = Math.floor(Date.now() / 1000);
    quote.status = 'declined';
    quote.declined_at = now;
    quote.decline_reason = reason ? String(reason).trim() : null;
    saveStorage('agent_erp_mock_quotes', mockQuotes);
    return formatMockQuote(quote);
  },

  convert_quote: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !targetTenantId.trim()) {
      throw new Error('Tenant ID cannot be empty');
    }
    const activeUid = resolveMockActiveUserId();
    if (!activeUid || !activeUid.trim()) {
      throw new Error('無法解析有效使用者 session，操作被拒絕');
    }

    const qId = String(payload.quote_id || payload.quoteId || '').trim();
    const rawToday = args?.today_override !== undefined
      ? args.today_override
      : (args?.todayOverride !== undefined
        ? args.todayOverride
        : (payload.today_override !== undefined ? payload.today_override : payload.todayOverride));
    const today = (rawToday !== undefined && rawToday !== null && String(rawToday).trim() !== '')
      ? String(rawToday).trim()
      : new Date().toISOString().slice(0, 10);

    // In-transaction lazy expiration check before conversion
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (quote.status === 'expired') {
      throw new Error('報價單已過期，無法轉為銷售單');
    }
    if (['converted', 'declined', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'sent') {
      throw new Error('目前狀態不允許此操作');
    }

    const quoteLines = mockQuoteLines
      .filter(l => l.quote_id === quote.id)
      .sort((a, b) => a.line_no - b.line_no);
    if (quoteLines.length === 0) {
      throw new Error('銷售單至少需有 1 筆明細');
    }

    // Validate all #220 sales order preconditions atomically before mutating anything
    if (mockSalesOrders.some(o => o.source_quote_id === quote.id)) {
      throw new Error('此報價單已轉換過銷售單，不可重複轉單');
    }

    const customer = mockPartners.find(
      p => p.id === quote.customer_partner_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!customer || !customer.is_customer || customer.is_active === false) {
      throw new Error('找不到此客戶，或該往來對象未設定為客戶');
    }

    const rawWhId = payload.warehouse_id !== undefined ? payload.warehouse_id : payload.warehouseId;
    const wh = (rawWhId && String(rawWhId).trim())
      ? validateMockWarehouseActive(targetTenantId, rawWhId)
      : resolveMockDefaultWarehouse(targetTenantId);

    const currency = (quote.currency && String(quote.currency).trim()) || 'TWD';
    if (currency !== 'TWD') {
      throw new Error('幣別僅支援 TWD');
    }

    const rawExpected = payload.expected_ship_date !== undefined ? payload.expected_ship_date : payload.expectedShipDate;
    const expectedShipDate = (rawExpected && String(rawExpected).trim())
      ? validateMockCalendarDate(rawExpected)
      : null;

    const seenUnits = new Set();
    for (const l of quoteLines) {
      resolveMockUnitSnapshot(targetTenantId, l.unit_id);
      if (seenUnits.has(l.unit_id)) {
        throw new Error('同一銷售單內商品單位不可重複');
      }
      seenUnits.add(l.unit_id);
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('數量必須大於 0');
      }
      const price = Number(l.unit_price);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error('單價不可為負數');
      }
    }

    const rawPo = payload.customer_po_number !== undefined
      ? payload.customer_po_number
      : (payload.customerPoNumber !== undefined
        ? payload.customerPoNumber
        : (payload.customer_reference !== undefined ? payload.customer_reference : payload.customerReference));
    const customerReference = (rawPo !== undefined && rawPo !== null)
      ? (String(rawPo).trim() !== '' ? String(rawPo).trim() : null)
      : (quote.customer_po_number || null);

    const rawNote = payload.note;
    const soNote = (rawNote !== undefined && rawNote !== null)
      ? (String(rawNote).trim() !== '' ? String(rawNote).trim() : null)
      : (quote.note || null);

    const now = Math.floor(Date.now() / 1000);
    const soId = nextMockUid('so');
    const soNumber = nextMockSoNumber(targetTenantId);
    const order = {
      id: soId,
      tenant_id: targetTenantId,
      so_number: soNumber,
      customer_partner_id: quote.customer_partner_id,
      customer_name_snapshot: quote.customer_name_snapshot || customer.name,
      customer_reference: customerReference,
      source_quote_id: quote.id,
      warehouse_id: wh.id,
      currency,
      status: 'confirmed',
      expected_ship_date: expectedShipDate,
      ship_date: null,
      note: soNote,
      created_by: activeUid,
      created_at: now,
      confirmed_at: now,
      shipped_by: null,
      shipped_at: null,
      cancelled_at: null,
      task_id: null
    };
    mockSalesOrders.push(order);

    quoteLines.forEach((l, idx) => {
      mockSalesOrderLines.push({
        id: nextMockUid('sol'),
        sales_order_id: soId,
        line_no: idx + 1,
        unit_id: l.unit_id,
        product_name_snapshot: l.product_name_snapshot,
        variant_name_snapshot: l.variant_name_snapshot,
        sku_snapshot: l.sku_snapshot || null,
        unit_name_snapshot: l.unit_name_snapshot,
        quantity: Number(l.quantity),
        shipped_quantity: null,
        unit_price: Number(l.unit_price),
        standard_price_snapshot: Number(l.standard_price_snapshot),
        created_at: now
      });
    });

    quote.status = 'converted';
    quote.converted_at = now;
    quote.accepted_by = activeUid;
    quote.converted_sales_order_id = soId;

    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
    saveStorage('agent_erp_mock_quotes', mockQuotes);

    const formattedQuote = formatMockQuote(quote);
    return {
      ...formattedQuote,
      sales_order: formatMockSalesOrder(order)
    };
  },

  cancel_quote: async (args) => {
    const { quote_id, quoteId, reason, today_override, todayOverride } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const qId = (quote_id || quoteId || '').trim();
    const r = (reason || '').trim();
    if (!r) throw new Error('取消理由為必填');
    const today = today_override || todayOverride || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }

    const now = Math.floor(Date.now() / 1000);
    quote.status = 'cancelled';
    quote.cancelled_at = now;
    quote.cancel_reason = r;
    saveStorage('agent_erp_mock_quotes', mockQuotes);
    return formatMockQuote(quote);
  },

  get_quote: async (args) => {
    const { id, quote_id, quoteId, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const qId = (id || quote_id || quoteId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    return formatMockQuote(quote);
  },

  list_quotes: async (args) => {
    const {
      filter_status,
      filterStatus,
      status,
      filter_customer_id,
      filterCustomerId,
      customer_partner_id,
      customerPartnerId,
      today_override
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    let list = mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    const st = filter_status || filterStatus || status;
    if (st && String(st).trim()) {
      const normSt = String(st).trim();
      list = list.filter(q => q.status === normSt);
    }
    const cid = filter_customer_id || filterCustomerId || customer_partner_id || customerPartnerId;
    if (cid && String(cid).trim()) {
      const normCid = String(cid).trim();
      list = list.filter(q => q.customer_partner_id === normCid);
    }
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return list.map(q => formatMockQuote(q).quote);
  },

  approve_quote: async (args) => {
    const { quote_id, quoteId, reason, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const qId = (quote_id || quoteId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'pending_approval') {
      throw new Error('目前狀態不允許此操作');
    }

    const now = Math.floor(Date.now() / 1000);
    quote.status = 'sent';
    quote.approved_by = activeUid;
    quote.approved_at = now;
    quote.sent_at = now;
    quote.approval_rejection_reason = null;

    const formatted = formatMockQuote(quote);
    const belowStandardLines = getMockBelowStandardLines(formatted.lines);
    const trimmedReason = reason && String(reason).trim() ? String(reason).trim() : null;

    const logId = `LOG-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditLog = {
      id: logId,
      action_type: 'quote_approval',
      arguments: JSON.stringify({
        quote_id: quote.id,
        quote_number: quote.quote_number,
        total_amount: formatted.total_amount,
        below_standard_lines: belowStandardLines,
        reason: trimmedReason
      }),
      decision: 'approved',
      operator: activeUid,
      timestamp: now
    };
    mockAuditLogs.unshift(auditLog);
    saveStorage('agent_erp_mock_audit_logs', mockAuditLogs);
    saveStorage('agent_erp_mock_quotes', mockQuotes);

    return formatted;
  },

  reject_quote: async (args) => {
    const { quote_id, quoteId, reason, today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const qId = (quote_id || quoteId || '').trim();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const trimmedReason = reason !== undefined && reason !== null ? String(reason).trim() : '';
    if (!trimmedReason) {
      throw new Error('駁回理由為必填');
    }

    const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
    if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
      throw new Error('此報價單已結案，無法修改');
    }
    if (quote.status !== 'pending_approval') {
      throw new Error('目前狀態不允許此操作');
    }

    const now = Math.floor(Date.now() / 1000);
    quote.status = 'draft';
    quote.approval_rejection_reason = trimmedReason;

    const formatted = formatMockQuote(quote);
    const belowStandardLines = getMockBelowStandardLines(formatted.lines);

    const logId = `LOG-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditLog = {
      id: logId,
      action_type: 'quote_approval',
      arguments: JSON.stringify({
        quote_id: quote.id,
        quote_number: quote.quote_number,
        total_amount: formatted.total_amount,
        below_standard_lines: belowStandardLines,
        reason: trimmedReason
      }),
      decision: 'rejected',
      operator: activeUid,
      timestamp: now
    };
    mockAuditLogs.unshift(auditLog);
    saveStorage('agent_erp_mock_audit_logs', mockAuditLogs);
    saveStorage('agent_erp_mock_quotes', mockQuotes);

    return formatted;
  },

  list_pending_approval_quotes: async (args) => {
    const { today_override } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const today = today_override || new Date().toISOString().slice(0, 10);
    expireMockQuotes(targetTenantId, today);

    const pendingQuotes = mockQuotes.filter(
      q => (q.tenant_id || 'tnt_mock_1') === targetTenantId && q.status === 'pending_approval'
    );
    pendingQuotes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    return pendingQuotes.map(q => {
      const formatted = formatMockQuote(q);
      const belowStandardLines = getMockBelowStandardLines(formatted.lines);
      return {
        quote: formatted.quote,
        below_standard_lines: belowStandardLines,
        total_amount: formatted.total_amount
      };
    });
  },

  reset_mock_quotes: async (args) => {
    const { tenant_id, tenantId } = args || {};
    return resetMockQuotes(tenant_id || tenantId);
  }
};
