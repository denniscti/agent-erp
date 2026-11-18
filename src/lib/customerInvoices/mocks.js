// @ts-check
import {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import { mockSalesOrders, formatMockSalesOrder } from '../salesOrders/mocks.js';
import {
  mockAccountsReceivable,
  formatMockAccountReceivable,
  mockCustomerReceiptAllocations
} from '../accountsReceivable/mocks.js';
import { calculateDueDate } from '../paymentTerms.js';

export function getMockSalesOrderAmounts(so) {
  if (!so) return { total_amount: 0, shipped_amount: 0 };
  const formatted = formatMockSalesOrder(so);
  const formattedOrder = formatted?.order || {};
  const hasLines = (formatted?.lines || []).length > 0;
  const total_amount = hasLines
    ? formattedOrder.total_amount
    : (so.total_amount !== undefined ? Number(so.total_amount) : (formattedOrder.total_amount || 0));
  const shipped_amount = hasLines
    ? formattedOrder.shipped_amount
    : (so.shipped_amount !== undefined ? Number(so.shipped_amount) : (formattedOrder.shipped_amount || 0));
  return {
    total_amount: Math.round(Number(total_amount || 0) * 100) / 100,
    shipped_amount: Math.round(Number(shipped_amount || 0) * 100) / 100
  };
}

export let mockCustomerInvoices = loadStorage('agent_erp_mock_customer_invoices', []);
if (!mockCustomerInvoices || !Array.isArray(mockCustomerInvoices)) {
  mockCustomerInvoices = [];
  saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
}

export let mockCustomerInvoiceOrders = loadStorage('agent_erp_mock_customer_invoice_orders', []);
if (!mockCustomerInvoiceOrders || !Array.isArray(mockCustomerInvoiceOrders)) {
  mockCustomerInvoiceOrders = [];
  saveStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);
}

export function nextMockCustomerInvoiceNumber(tenantId) {
  const existing = mockCustomerInvoices.filter(b => (b.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const b of existing) {
    if (b.invoice_number && b.invoice_number.startsWith('SINV-')) {
      const num = parseInt(b.invoice_number.substring(5), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `SINV-${String(nextSeq).padStart(5, '0')}`;
}

export function formatMockCustomerInvoice(cinv) {
  const targetTenantId = cinv.tenant_id || 'tnt_mock_1';
  const untaxed = Math.round(Number(cinv.untaxed_amount) * 100) / 100;
  const tax = Math.round(Number(cinv.tax_amount || 0) * 100) / 100;
  const total = Math.round((untaxed + tax) * 100) / 100;
  const rawOrders = mockCustomerInvoiceOrders.filter(o => o.customer_invoice_id === cinv.id);

  const orders = rawOrders.map(o => {
    const so = mockSalesOrders.find(s => s.id === o.sales_order_id) || {};
    const amounts = getMockSalesOrderAmounts(so);
    return {
      id: o.id,
      customer_invoice_id: o.customer_invoice_id,
      sales_order_id: o.sales_order_id,
      so_number_snapshot: o.so_number_snapshot || so.so_number || '',
      created_at: o.created_at,
      total_amount: amounts.total_amount,
      shipped_amount: amounts.shipped_amount,
      status: so.status || 'confirmed',
      ship_date: so.ship_date || null
    };
  });

  // 1. revenue_status & revenue_recognized_date
  let revenue_status = 'deferred';
  let revenue_recognized_date = null;
  if (orders.length > 0) {
    const hasConfirmed = orders.some(o => o.status === 'confirmed');
    const allShipped = orders.every(o => o.status === 'shipped');
    if (!hasConfirmed && allShipped) {
      revenue_status = 'recognized';
      const shipDates = orders.map(o => o.ship_date).filter(Boolean);
      if (shipDates.length > 0) {
        shipDates.sort();
        revenue_recognized_date = shipDates[shipDates.length - 1];
      }
    }
  }

  // 2. shipment_shortfall
  let shipment_shortfall = 0;
  if (cinv.status === 'posted' && orders.length > 0 && orders.every(o => o.status === 'shipped')) {
    const shippedSum = orders.reduce((sum, o) => sum + o.shipped_amount, 0);
    const basis = cinv.basis_amount !== null && cinv.basis_amount !== undefined ? Number(cinv.basis_amount) : 0;
    const shortfall = Math.round((basis - shippedSum) * 100) / 100;
    if (shortfall >= 1.0) {
      shipment_shortfall = shortfall;
    }
  }

  // 3. is_late_issued & late_issue_warning
  let is_late_issued = false;
  let late_issue_warning = null;
  if (cinv.issuance_mode === 'per_order') {
    for (const o of orders) {
      if (o.ship_date && cinv.invoice_date > o.ship_date) {
        is_late_issued = true;
        late_issue_warning = `發票開立日期晚於出貨日 ${o.ship_date}，可能不符銷售憑證開立時限`;
        break;
      }
    }
  } else if (cinv.issuance_mode === 'monthly_consolidated') {
    const invYm = (cinv.invoice_date || '').substring(0, 7);
    for (const o of orders) {
      const sYm = (o.ship_date || '').substring(0, 7);
      if (invYm && sYm && invYm !== sYm) {
        is_late_issued = true;
        late_issue_warning = `銷售單 ${o.so_number_snapshot} 於 ${o.ship_date} 出貨，已超過當月彙開期間`;
        break;
      }
    }
  }

  const invoice = {
    id: cinv.id,
    tenant_id: cinv.tenant_id,
    invoice_number: cinv.invoice_number,
    customer_partner_id: cinv.customer_partner_id,
    customer_name_snapshot: cinv.customer_name_snapshot,
    issuance_mode: cinv.issuance_mode,
    tax_invoice_number: cinv.tax_invoice_number || null,
    tax_invoice_exemption_reason: cinv.tax_invoice_exemption_reason || null,
    invoice_date: cinv.invoice_date,
    due_date: cinv.due_date,
    untaxed_amount: untaxed,
    tax_amount: tax,
    total_amount: total,
    currency: cinv.currency || 'TWD',
    status: cinv.status,
    basis_amount: cinv.basis_amount !== undefined && cinv.basis_amount !== null ? Math.round(Number(cinv.basis_amount) * 100) / 100 : null,
    difference_amount: cinv.difference_amount !== undefined && cinv.difference_amount !== null ? Math.round(Number(cinv.difference_amount) * 100) / 100 : null,
    difference_note: cinv.difference_note || null,
    note: cinv.note || null,
    created_by: cinv.created_by,
    created_at: cinv.created_at,
    posted_by: cinv.posted_by || null,
    posted_at: cinv.posted_at || null,
    cancelled_at: cinv.cancelled_at || null,
    voided_by: cinv.voided_by || null,
    voided_at: cinv.voided_at || null,
    void_reason: cinv.void_reason || null,
    task_id: cinv.task_id || null
  };

  // Find linked AR
  let receivable = null;
  if (cinv.status === 'posted' || cinv.status === 'voided') {
    const ar = mockAccountsReceivable.find(
      a => a.source_type === 'customer_invoice' && a.source_id === cinv.id && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (ar) {
      receivable = formatMockAccountReceivable(ar).detail;
    }
  }

  return {
    detail: {
      invoice,
      orders,
      receivable,
      revenue_status,
      revenue_recognized_date,
      shipment_shortfall,
      is_late_issued,
      late_issue_warning
    },
    item: {
      id: cinv.id,
      invoice_number: cinv.invoice_number,
      customer_partner_id: cinv.customer_partner_id,
      customer_name_snapshot: cinv.customer_name_snapshot,
      issuance_mode: cinv.issuance_mode,
      tax_invoice_number: cinv.tax_invoice_number || null,
      tax_invoice_exemption_reason: cinv.tax_invoice_exemption_reason || null,
      invoice_date: cinv.invoice_date,
      due_date: cinv.due_date,
      untaxed_amount: untaxed,
      tax_amount: tax,
      total_amount: total,
      currency: cinv.currency || 'TWD',
      status: cinv.status,
      basis_amount: invoice.basis_amount,
      difference_amount: invoice.difference_amount,
      created_at: cinv.created_at,
      posted_at: cinv.posted_at || null,
      cancelled_at: cinv.cancelled_at || null,
      voided_at: cinv.voided_at || null,
      order_count: orders.length,
      revenue_status,
      shipment_shortfall,
      is_late_issued
    }
  };
}

export const customerInvoiceMocks = {
  reset_mock_customer_invoices: async (args) => {
    const targetTenantId = (args && args.tenant_id) || resolveMockActiveTenantId();
    mockCustomerInvoices = mockCustomerInvoices.filter(b => (b.tenant_id || 'tnt_mock_1') !== targetTenantId);
    mockCustomerInvoiceOrders = mockCustomerInvoiceOrders.filter(o => (o.tenant_id || 'tnt_mock_1') !== targetTenantId);
    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    saveStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);
    return true;
  },

  create_customer_invoice: async (args) => {
    const { input } = args || {};
    if (!input) throw new Error('缺少輸入資料');
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();

    const {
      customer_partner_id,
      customerPartnerId,
      issuance_mode,
      issuanceMode,
      invoice_date,
      invoiceDate,
      due_date,
      dueDate,
      untaxed_amount,
      untaxedAmount,
      tax_amount,
      taxAmount,
      sales_order_ids,
      salesOrderIds,
      tax_invoice_number,
      taxInvoiceNumber,
      tax_invoice_exemption_reason,
      taxInvoiceExemptionReason,
      note,
      task_id,
      taskId
    } = input;

    const cId = String(customer_partner_id || customerPartnerId || '').trim();
    if (!cId) throw new Error('客戶 ID 不可為空');

    const customer = mockPartners.find(
      p => p.id === cId && (p.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!customer) throw new Error('找不到指定的客戶');
    if (!customer.isCustomer && !customer.is_customer) {
      throw new Error('指定的合作夥伴不是客戶');
    }

    const invDate = String(invoice_date || invoiceDate || '').trim();
    if (!invDate) throw new Error('無效的日期格式: 日期格式需為 YYYY-MM-DD');

    const nowIso = new Date().toISOString().substring(0, 10);
    if (invDate > nowIso) {
      throw new Error('發票日期不可晚於今天');
    }

    const mode = String(issuance_mode || issuanceMode || customer.invoice_issuance_mode || customer.invoiceIssuanceMode || 'per_order').trim();

    let resolvedDueDate = String(due_date || dueDate || '').trim();
    if (!resolvedDueDate) {
      const termsType = customer.collection_terms_type || customer.collectionTermsType || 'net';
      const termsDays = customer.collection_terms_days !== undefined ? customer.collection_terms_days : (customer.collectionTermsDays !== undefined ? customer.collectionTermsDays : 30);
      resolvedDueDate = calculateDueDate(invDate, termsType, termsDays);
    }

    if (resolvedDueDate < invDate) {
      throw new Error('到期日不可早於發票日期');
    }

    const taxAmt = Math.round(Number(tax_amount !== undefined ? tax_amount : (taxAmount !== undefined ? taxAmount : 0)) * 100) / 100;
    if (taxAmt < 0) {
      throw new Error('銷項稅額不可小於 0');
    }

    const orderIds = sales_order_ids || salesOrderIds || [];
    const attachedOrders = [];
    let initialBasis = 0;
    for (const oid of orderIds) {
      const so = mockSalesOrders.find(
        s => s.id === oid && (s.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (!so) throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
      if (so.customer_partner_id !== cId) throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
      if (so.status !== 'confirmed' && so.status !== 'shipped') {
        throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
      }
      if (mode === 'monthly_consolidated' && so.status !== 'shipped') {
        throw new Error('月結彙開僅能涵蓋已出貨的銷售單');
      }

      // Check covered
      const covered = mockCustomerInvoiceOrders.find(cio => {
        if (cio.sales_order_id !== oid || (cio.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
        const parent = mockCustomerInvoices.find(ci => ci.id === cio.customer_invoice_id);
        return parent && (parent.status === 'draft' || parent.status === 'posted');
      });
      if (covered) {
        const parent = mockCustomerInvoices.find(ci => ci.id === covered.customer_invoice_id);
        throw new Error(`銷售單 ${so.so_number} 已在發票 ${parent?.invoice_number || ''} 中`);
      }

      const amounts = getMockSalesOrderAmounts(so);
      const contrib = so.status === 'shipped' ? amounts.shipped_amount : amounts.total_amount;
      initialBasis += contrib;
      attachedOrders.push(so);
    }

    if (mode === 'per_order' && attachedOrders.length > 1) {
      throw new Error('逐單開立僅能涵蓋一張銷售單');
    }

    let untaxedAmt = untaxed_amount !== undefined ? untaxed_amount : untaxedAmount;
    if (untaxedAmt === undefined || untaxedAmt === null) {
      if (attachedOrders.length > 0 && initialBasis > 0) {
        untaxedAmt = initialBasis;
      } else {
        untaxedAmt = 0;
      }
    }
    untaxedAmt = Math.round(Number(untaxedAmt) * 100) / 100;
    if (untaxedAmt <= 0) {
      throw new Error('未稅金額必須大於 0');
    }

    const tin = String(tax_invoice_number || taxInvoiceNumber || '').trim();
    if (tin) {
      const dup = mockCustomerInvoices.find(
        ci => (ci.tenant_id || 'tnt_mock_1') === targetTenantId &&
              ci.tax_invoice_number === tin &&
              ci.status !== 'cancelled' &&
              ci.status !== 'voided'
      );
      if (dup) {
        throw new Error(`發票號碼 ${tin} 已登錄於 ${dup.invoice_number}`);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const invoiceId = nextMockUid('cinv');
    const invoiceNumber = nextMockCustomerInvoiceNumber(targetTenantId);

    const record = {
      id: invoiceId,
      tenant_id: targetTenantId,
      invoice_number: invoiceNumber,
      customer_partner_id: cId,
      customer_name_snapshot: customer.name || '',
      issuance_mode: mode,
      tax_invoice_number: tin || null,
      tax_invoice_exemption_reason: String(tax_invoice_exemption_reason || taxInvoiceExemptionReason || '').trim() || null,
      invoice_date: invDate,
      due_date: resolvedDueDate,
      untaxed_amount: untaxedAmt,
      tax_amount: taxAmt,
      currency: 'TWD',
      status: 'draft',
      basis_amount: null,
      difference_amount: null,
      difference_note: null,
      note: note || null,
      created_by: activeUid,
      created_at: now,
      posted_by: null,
      posted_at: null,
      cancelled_at: null,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      task_id: task_id || taskId || null
    };

    mockCustomerInvoices.push(record);

    for (const so of attachedOrders) {
      mockCustomerInvoiceOrders.push({
        id: nextMockUid('cio'),
        tenant_id: targetTenantId,
        customer_invoice_id: invoiceId,
        sales_order_id: so.id,
        so_number_snapshot: so.so_number || '',
        created_at: now
      });
    }

    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    saveStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);

    return formatMockCustomerInvoice(record).detail;
  },

  update_customer_invoice_header: async (args) => {
    const { input } = args || {};
    if (!input) throw new Error('缺少輸入資料');
    const targetTenantId = resolveMockActiveTenantId();
    const invId = String(input.invoice_id || input.invoiceId || '').trim();
    if (!invId) throw new Error('發票 ID 不可為空');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    if (inv.status !== 'draft') {
      throw new Error(`發票狀態為 ${inv.status}，不可修改`);
    }

    if (input.invoice_date || input.invoiceDate) {
      const d = String(input.invoice_date || input.invoiceDate).trim();
      const nowIso = new Date().toISOString().substring(0, 10);
      if (d > nowIso) throw new Error('發票日期不可晚於今天');
      inv.invoice_date = d;
    }
    if (input.due_date || input.dueDate) {
      inv.due_date = String(input.due_date || input.dueDate).trim();
    }
    if (inv.due_date < inv.invoice_date) {
      throw new Error('到期日不可早於發票日期');
    }

    if (input.untaxed_amount !== undefined || input.untaxedAmount !== undefined) {
      const u = Math.round(Number(input.untaxed_amount !== undefined ? input.untaxed_amount : input.untaxedAmount) * 100) / 100;
      if (u <= 0) throw new Error('未稅金額必須大於 0');
      inv.untaxed_amount = u;
    }

    if (input.tax_amount !== undefined || input.taxAmount !== undefined) {
      const t = Math.round(Number(input.tax_amount !== undefined ? input.tax_amount : input.taxAmount) * 100) / 100;
      if (t < 0) throw new Error('銷項稅額不可小於 0');
      inv.tax_amount = t;
    }

    if (input.tax_invoice_number !== undefined || input.taxInvoiceNumber !== undefined) {
      const tin = String(input.tax_invoice_number !== undefined ? input.tax_invoice_number : input.taxInvoiceNumber).trim();
      if (tin) {
        const dup = mockCustomerInvoices.find(
          ci => (ci.tenant_id || 'tnt_mock_1') === targetTenantId &&
                ci.tax_invoice_number === tin &&
                ci.id !== invId &&
                ci.status !== 'cancelled' &&
                ci.status !== 'voided'
        );
        if (dup) throw new Error(`發票號碼 ${tin} 已登錄於 ${dup.invoice_number}`);
        inv.tax_invoice_number = tin;
      } else {
        inv.tax_invoice_number = null;
      }
    }

    if (input.tax_invoice_exemption_reason !== undefined || input.taxInvoiceExemptionReason !== undefined) {
      const ex = String(input.tax_invoice_exemption_reason !== undefined ? input.tax_invoice_exemption_reason : input.taxInvoiceExemptionReason).trim();
      inv.tax_invoice_exemption_reason = ex || null;
    }

    if (input.note !== undefined) {
      inv.note = input.note || null;
    }

    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    return formatMockCustomerInvoice(inv).detail;
  },

  add_customer_invoice_order: async (args) => {
    const { invoice_id, invoiceId, sales_order_id, salesOrderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const invId = String(invoice_id || invoiceId || '').trim();
    const soId = String(sales_order_id || salesOrderId || '').trim();
    if (!invId) throw new Error('發票 ID 不可為空');
    if (!soId) throw new Error('銷售單 ID 不可為空');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    if (inv.status !== 'draft') {
      throw new Error(`發票狀態為 ${inv.status}，不可修改`);
    }

    const so = mockSalesOrders.find(
      s => s.id === soId && (s.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!so) throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
    if (so.customer_partner_id !== inv.customer_partner_id) {
      throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
    }
    if (so.status !== 'confirmed' && so.status !== 'shipped') {
      throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
    }
    if (inv.issuance_mode === 'monthly_consolidated' && so.status !== 'shipped') {
      throw new Error('月結彙開僅能涵蓋已出貨的銷售單');
    }

    // Check if already in this invoice
    const alreadyInThis = mockCustomerInvoiceOrders.some(
      cio => cio.customer_invoice_id === invId && cio.sales_order_id === soId
    );
    if (alreadyInThis) return formatMockCustomerInvoice(inv).detail;

    // Check per_order limit
    if (inv.issuance_mode === 'per_order') {
      const existingCount = mockCustomerInvoiceOrders.filter(
        cio => cio.customer_invoice_id === invId
      ).length;
      if (existingCount >= 1) throw new Error('逐單開立僅能涵蓋一張銷售單');
    }

    // Check covered by other active invoice
    const covered = mockCustomerInvoiceOrders.find(cio => {
      if (cio.sales_order_id !== soId || (cio.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
      if (cio.customer_invoice_id === invId) return false;
      const parent = mockCustomerInvoices.find(ci => ci.id === cio.customer_invoice_id);
      return parent && (parent.status === 'draft' || parent.status === 'posted');
    });
    if (covered) {
      const parent = mockCustomerInvoices.find(ci => ci.id === covered.customer_invoice_id);
      throw new Error(`銷售單 ${so.so_number} 已在發票 ${parent?.invoice_number || ''} 中`);
    }

    const now = Math.floor(Date.now() / 1000);
    mockCustomerInvoiceOrders.push({
      id: nextMockUid('cio'),
      tenant_id: targetTenantId,
      customer_invoice_id: invId,
      sales_order_id: soId,
      so_number_snapshot: so.so_number || '',
      created_at: now
    });

    saveStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);
    return formatMockCustomerInvoice(inv).detail;
  },

  remove_customer_invoice_order: async (args) => {
    const { invoice_id, invoiceId, sales_order_id, salesOrderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const invId = String(invoice_id || invoiceId || '').trim();
    const soId = String(sales_order_id || salesOrderId || '').trim();
    if (!invId) throw new Error('發票 ID 不可為空');
    if (!soId) throw new Error('銷售單 ID 不可為空');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    if (inv.status !== 'draft') {
      throw new Error(`發票狀態為 ${inv.status}，不可修改`);
    }

    mockCustomerInvoiceOrders = mockCustomerInvoiceOrders.filter(
      cio => !(cio.customer_invoice_id === invId && cio.sales_order_id === soId)
    );
    saveStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);
    return formatMockCustomerInvoice(inv).detail;
  },

  post_customer_invoice: async (args) => {
    const { input } = args || {};
    if (!input) throw new Error('缺少輸入資料');
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const invId = String(input.invoice_id || input.invoiceId || '').trim();
    if (!invId) throw new Error('發票 ID 不可為空');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    if (inv.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${inv.status} 轉換至 posted`);
    }

    const nowIso = new Date().toISOString().substring(0, 10);
    if (inv.invoice_date > nowIso) {
      throw new Error('發票日期不可晚於今天');
    }

    const orders = mockCustomerInvoiceOrders.filter(o => o.customer_invoice_id === invId);
    if (orders.length === 0) {
      throw new Error('發票需至少涵蓋一張銷售單');
    }

    if (inv.issuance_mode === 'per_order' && orders.length > 1) {
      throw new Error('逐單開立僅能涵蓋一張銷售單');
    }

    let basis = 0;
    for (const o of orders) {
      const so = mockSalesOrders.find(s => s.id === o.sales_order_id);
      if (!so) throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
      if (so.customer_partner_id !== inv.customer_partner_id) {
        throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
      }
      if (so.status !== 'confirmed' && so.status !== 'shipped') {
        throw new Error('僅能為同一客戶、已確認或已出貨的銷售單開立發票');
      }
      if (inv.issuance_mode === 'monthly_consolidated' && so.status !== 'shipped') {
        throw new Error('月結彙開僅能涵蓋已出貨的銷售單');
      }
      const amounts = getMockSalesOrderAmounts(so);
      const contrib = so.status === 'shipped' ? amounts.shipped_amount : amounts.total_amount;
      basis += contrib;
    }

    basis = Math.round(basis * 100) / 100;
    if (basis <= 0) {
      throw new Error('比對基準金額必須大於 0');
    }

    const diff = Math.round((inv.untaxed_amount - basis) * 100) / 100;
    const diffAbs = Math.round(Math.abs(diff) * 100) / 100;
    const diffNote = String(input.difference_note || input.differenceNote || inv.difference_note || '').trim();
    if (diffAbs >= 1.0 && !diffNote) {
      const diffStr = diffAbs % 1 === 0 ? String(diffAbs) : diffAbs.toFixed(2);
      throw new Error(`發票未稅金額與比對基準差 ${diffStr}，需填寫差異說明`);
    }

    const tin = String(input.tax_invoice_number || input.taxInvoiceNumber || inv.tax_invoice_number || '').trim();
    const ex = String(input.tax_invoice_exemption_reason || input.taxInvoiceExemptionReason || inv.tax_invoice_exemption_reason || '').trim();

    if ((tin && ex) || (!tin && !ex)) {
      throw new Error('請登錄統一發票號碼，或選擇免開立原因');
    }

    if (ex === 'other') {
      const noteVal = String(input.note !== undefined ? input.note : (inv.note || '')).trim();
      if (!noteVal) {
        throw new Error('選擇其他免開立原因時備註為必填');
      }
    }

    if (tin) {
      const dup = mockCustomerInvoices.find(
        ci => (ci.tenant_id || 'tnt_mock_1') === targetTenantId &&
              ci.tax_invoice_number === tin &&
              ci.id !== invId &&
              ci.status !== 'cancelled' &&
              ci.status !== 'voided'
      );
      if (dup) {
        throw new Error(`發票號碼 ${tin} 已登錄於 ${dup.invoice_number}`);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    inv.status = 'posted';
    inv.basis_amount = basis;
    inv.difference_amount = diff;
    inv.difference_note = diffNote || null;
    inv.tax_invoice_number = tin || null;
    inv.tax_invoice_exemption_reason = ex || null;
    if (input.note !== undefined) inv.note = input.note || null;
    inv.posted_by = activeUid;
    inv.posted_at = now;

    // CI-07: Create AR in mockAccountsReceivable
    const arTotal = Math.round((inv.untaxed_amount + inv.tax_amount) * 100) / 100;
    mockAccountsReceivable.push({
      id: nextMockUid('ar'),
      tenant_id: targetTenantId,
      customer_partner_id: inv.customer_partner_id,
      customer_name_snapshot: inv.customer_name_snapshot,
      source_type: 'customer_invoice',
      source_id: inv.id,
      source_number: inv.invoice_number,
      external_reference: tin || null,
      document_date: inv.invoice_date,
      due_date: inv.due_date,
      amount: arTotal,
      currency: 'TWD',
      status: 'open',
      created_by: activeUid,
      created_at: now,
      voided_by: null,
      voided_at: null,
      void_reason: null
    });

    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);

    return formatMockCustomerInvoice(inv).detail;
  },

  cancel_customer_invoice: async (args) => {
    const { invoice_id, invoiceId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const invId = String(invoice_id || invoiceId || '').trim();
    if (!invId) throw new Error('發票 ID 不可為空');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    if (inv.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${inv.status} 轉換至 cancelled`);
    }

    inv.status = 'cancelled';
    inv.cancelled_at = Math.floor(Date.now() / 1000);
    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    return formatMockCustomerInvoice(inv).detail;
  },

  void_customer_invoice: async (args) => {
    const { invoice_id, invoiceId, void_reason, voidReason } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const invId = String(invoice_id || invoiceId || '').trim();
    const reason = String(void_reason || voidReason || '').trim();
    if (!invId) throw new Error('發票 ID 不可為空');
    if (!reason) throw new Error('作廢原因為必填');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    if (inv.status !== 'posted') {
      throw new Error(`無效的狀態轉換：不可從 ${inv.status} 轉換至 voided`);
    }

    const ar = mockAccountsReceivable.find(
      a => a.source_type === 'customer_invoice' && a.source_id === invId && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );

    if (ar) {
      // Check receipts
      const postedAlloc = formatMockAccountReceivable(ar).detail.allocations
        .find(a => a.receipt_status === 'posted');
      if (postedAlloc) {
        throw new Error(`此發票已有收款核銷：${postedAlloc.receipt_number}，請先作廢收款單`);
      }

      ar.status = 'voided';
      ar.voided_by = activeUid;
      ar.voided_at = Math.floor(Date.now() / 1000);
      ar.void_reason = reason;
    }

    inv.status = 'voided';
    inv.voided_by = activeUid;
    inv.voided_at = Math.floor(Date.now() / 1000);
    inv.void_reason = reason;

    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);

    return formatMockCustomerInvoice(inv).detail;
  },

  get_customer_invoice: async (args) => {
    const { invoice_id, invoiceId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const invId = String(invoice_id || invoiceId || id || '').trim();
    if (!invId) throw new Error('缺少發票 ID (id 或 invoice_id)');

    const inv = mockCustomerInvoices.find(
      i => i.id === invId && (i.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!inv) throw new Error('找不到指定的發票');
    return formatMockCustomerInvoice(inv).detail;
  },

  list_customer_invoices: async (args) => {
    const {
      status_filter,
      statusFilter,
      customer_partner_id,
      customerPartnerId,
      search_query,
      searchQuery
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = mockCustomerInvoices.filter(i => (i.tenant_id || 'tnt_mock_1') === targetTenantId);

    const st = String(status_filter || statusFilter || '').trim();
    if (st) list = list.filter(i => i.status === st);

    const cid = String(customer_partner_id || customerPartnerId || '').trim();
    if (cid) list = list.filter(i => i.customer_partner_id === cid);

    const q = String(search_query || searchQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(i =>
        (i.invoice_number || '').toLowerCase().includes(q) ||
        (i.tax_invoice_number || '').toLowerCase().includes(q) ||
        (i.customer_name_snapshot || '').toLowerCase().includes(q)
      );
    }

    return list
      .sort((a, b) => b.created_at - a.created_at)
      .map(i => formatMockCustomerInvoice(i).item);
  },

  list_uninvoiced_sales_orders: async (args) => {
    const { customer_partner_id, customerPartnerId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const cid = String(customer_partner_id || customerPartnerId || '').trim();

    return mockSalesOrders
      .filter(so => {
        if ((so.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
        if (so.status !== 'confirmed' && so.status !== 'shipped') return false;
        if (cid && so.customer_partner_id !== cid) return false;

        // Must not be covered by draft/posted invoice
        const isCovered = mockCustomerInvoiceOrders.some(cio => {
          if (cio.sales_order_id !== so.id || (cio.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
          const parent = mockCustomerInvoices.find(ci => ci.id === cio.customer_invoice_id);
          return parent && (parent.status === 'draft' || parent.status === 'posted');
        });
        return !isCovered;
      })
      .map(so => {
        const amounts = getMockSalesOrderAmounts(so);
        return {
          sales_order_id: so.id,
          so_number: so.so_number || '',
          customer_partner_id: so.customer_partner_id,
          customer_name_snapshot: so.customer_name_snapshot || '',
          status: so.status,
          confirmed_at: so.confirmed_at || so.created_at,
          shipped_at: so.shipped_at || null,
          ship_date: so.ship_date || null,
          total_amount: amounts.total_amount,
          shipped_amount: amounts.shipped_amount
        };
      });
  },

  get_sales_order_invoicing_info: async (args) => {
    const { sales_order_id, salesOrderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const soId = String(sales_order_id || salesOrderId || '').trim();
    if (!soId) throw new Error('缺少銷售單 ID');

    const link = mockCustomerInvoiceOrders.find(cio => {
      if (cio.sales_order_id !== soId || (cio.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
      const parent = mockCustomerInvoices.find(ci => ci.id === cio.customer_invoice_id);
      return parent && (parent.status === 'draft' || parent.status === 'posted');
    });

    if (!link) return null;
    const inv = mockCustomerInvoices.find(ci => ci.id === link.customer_invoice_id);
    if (!inv) return null;

    const count = mockCustomerInvoiceOrders.filter(cio => cio.customer_invoice_id === inv.id).length;
    const total = Math.round((Number(inv.untaxed_amount) + Number(inv.tax_amount || 0)) * 100) / 100;

    return {
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_status: inv.status,
      invoice_total_amount: total,
      invoice_order_count: count
    };
  }
};

