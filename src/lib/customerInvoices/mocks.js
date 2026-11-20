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

export let mockSalesAllowances = loadStorage('agent_erp_mock_sales_allowances', []);
if (!mockSalesAllowances || !Array.isArray(mockSalesAllowances)) {
  mockSalesAllowances = [];
  saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
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
    let postedAllowancesUntaxed = 0;
    const activeAllowances = loadStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    if (Array.isArray(activeAllowances)) {
      postedAllowancesUntaxed = activeAllowances
        .filter(sa => sa.customer_invoice_id === cinv.id && sa.status === 'posted')
        .reduce((sum, sa) => sum + (Number(sa.untaxed_amount) || 0), 0);
    }
    const shortfall = Math.round((basis - shippedSum - postedAllowancesUntaxed) * 100) / 100;
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

function syncAllowanceStorage() {
  mockCustomerInvoices = loadStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
  mockCustomerInvoiceOrders = loadStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);
  mockSalesAllowances = loadStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
}

export const customerInvoiceMocks = {
  reset_mock_customer_invoices: async (args) => {
    const targetTenantId = (args && args.tenant_id) || resolveMockActiveTenantId();
    mockCustomerInvoices = mockCustomerInvoices.filter(b => (b.tenant_id || 'tnt_mock_1') !== targetTenantId);
    mockCustomerInvoiceOrders = mockCustomerInvoiceOrders.filter(o => (o.tenant_id || 'tnt_mock_1') !== targetTenantId);
    mockSalesAllowances = mockSalesAllowances.filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTenantId);
    saveStorage('agent_erp_mock_customer_invoices', mockCustomerInvoices);
    saveStorage('agent_erp_mock_customer_invoice_orders', mockCustomerInvoiceOrders);
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
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
    const params = args?.input || args || {};
    const { invoice_id, invoiceId, void_reason, voidReason } = params;
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

      // Check posted allowances (CI-08)
      const postedAllowance = (mockSalesAllowances || []).find(
        sa => (sa.customer_invoice_id === invId || sa.account_receivable_id === ar.id) &&
              sa.status === 'posted' && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (postedAllowance) {
        throw new Error(`此發票已有過帳之折讓單：${postedAllowance.allowance_number}，請先作廢折讓單`);
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
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentYm = today.slice(0, 7);

    const result = [];
    for (const so of mockSalesOrders) {
      if ((so.tenant_id || 'tnt_mock_1') !== targetTenantId) continue;
      if (so.status !== 'confirmed' && so.status !== 'shipped') continue;
      if (cid && so.customer_partner_id !== cid) continue;

      // Must not be covered by draft/posted invoice
      const isCovered = mockCustomerInvoiceOrders.some(cio => {
        if (cio.sales_order_id !== so.id || (cio.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
        const parent = mockCustomerInvoices.find(ci => ci.id === cio.customer_invoice_id);
        return parent && (parent.status === 'draft' || parent.status === 'posted');
      });
      if (isCovered) continue;

      const partner = mockPartners.find(p => p.id === so.customer_partner_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      const issuanceMode = partner?.invoice_issuance_mode || 'per_order';
      const amounts = getMockSalesOrderAmounts(so);

      if (issuanceMode === 'monthly_consolidated') {
        // (c) 月結客戶本月待彙開。出貨金額為 0 的銷售單不列入
        if (so.status !== 'shipped' || amounts.shipped_amount <= 0) continue;
        const sYm = (so.ship_date || '').slice(0, 7);
        if (currentYm && sYm !== currentYm) continue;
        result.push({
          sales_order_id: so.id,
          so_number: so.so_number || '',
          customer_partner_id: so.customer_partner_id,
          customer_name_snapshot: so.customer_name_snapshot || partner?.name || '',
          status: so.status,
          confirmed_at: so.confirmed_at || so.created_at,
          shipped_at: so.shipped_at || null,
          ship_date: so.ship_date || null,
          total_amount: amounts.total_amount,
          shipped_amount: amounts.shipped_amount,
          group: 'monthly_consolidated',
          is_overdue_risk: false,
          uninvoiced_amount: amounts.shipped_amount
        });
      } else {
        // 逐單客戶
        if (so.status === 'confirmed') {
          // (a) 逐單客戶、已確認未開票
          result.push({
            sales_order_id: so.id,
            so_number: so.so_number || '',
            customer_partner_id: so.customer_partner_id,
            customer_name_snapshot: so.customer_name_snapshot || partner?.name || '',
            status: so.status,
            confirmed_at: so.confirmed_at || so.created_at,
            shipped_at: so.shipped_at || null,
            ship_date: so.ship_date || null,
            total_amount: amounts.total_amount,
            shipped_amount: amounts.shipped_amount,
            group: 'per_order_confirmed',
            is_overdue_risk: false,
            uninvoiced_amount: amounts.total_amount
          });
        } else if (so.status === 'shipped') {
          // (b) 逐單客戶、已出貨未開票（標示逾時風險）。出貨金額為 0 的銷售單不列入
          if (amounts.shipped_amount <= 0) continue;
          const isOverdueRisk = Boolean(so.ship_date && so.ship_date < today);
          result.push({
            sales_order_id: so.id,
            so_number: so.so_number || '',
            customer_partner_id: so.customer_partner_id,
            customer_name_snapshot: so.customer_name_snapshot || partner?.name || '',
            status: so.status,
            confirmed_at: so.confirmed_at || so.created_at,
            shipped_at: so.shipped_at || null,
            ship_date: so.ship_date || null,
            total_amount: amounts.total_amount,
            shipped_amount: amounts.shipped_amount,
            group: 'per_order_shipped',
            is_overdue_risk: isOverdueRisk,
            uninvoiced_amount: amounts.shipped_amount
          });
        }
      }
    }
    return result.sort((a, b) => b.confirmed_at - a.confirmed_at);
  },

  list_pending_allowance_invoices: async (args) => {
    const { customer_partner_id, customerPartnerId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const cid = String(customer_partner_id || customerPartnerId || '').trim();

    return mockCustomerInvoices
      .filter(cinv => {
        if ((cinv.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
        if (cinv.status !== 'posted') return false;
        if (cid && cinv.customer_partner_id !== cid) return false;
        const formatted = formatMockCustomerInvoice(cinv);
        return (formatted.item.shipment_shortfall || 0) >= 1.0;
      })
      .map(cinv => formatMockCustomerInvoice(cinv).item);
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
  },

  create_sales_allowance: async (args) => {
    syncAllowanceStorage();
    const input = args.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();
    const invId = String(input.customer_invoice_id || input.customerInvoiceId || '').trim();
    if (!invId) throw new Error('找不到對應的銷項發票');

    if (input.reason_type && input.reason_type.trim() !== 'shipment_shortfall') {
      throw new Error('折讓原因類型僅支援出貨短少 (shipment_shortfall)');
    }

    const cinv = mockCustomerInvoices.find(
      ci => ci.id === invId && (ci.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!cinv) throw new Error('找不到對應的銷項發票');

    const formatted = formatMockCustomerInvoice(cinv);
    const orders = mockCustomerInvoiceOrders
      .filter(cio => cio.customer_invoice_id === cinv.id && (cio.tenant_id || 'tnt_mock_1') === targetTenantId)
      .map(cio => mockSalesOrders.find(so => so.id === cio.sales_order_id))
      .filter(Boolean);

    if (cinv.status !== 'posted' || orders.length === 0 || !orders.every(o => o.status === 'shipped') || (formatted.item.shipment_shortfall || 0) < 1.0) {
      throw new Error('僅能對已過帳、已出貨且有出貨短少的發票開立折讓單');
    }

    const existingDraft = (mockSalesAllowances || []).find(
      sa => sa.customer_invoice_id === cinv.id && sa.status === 'draft' && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (existingDraft) {
      throw new Error(`發票 ${cinv.invoice_number} 已有草稿折讓單 ${existingDraft.allowance_number}`);
    }

    const today = new Date().toISOString().split('T')[0];
    const allowanceDate = String(input.allowance_date || input.allowanceDate || today).trim();
    if (allowanceDate > today) {
      throw new Error('折讓日期不可晚於今天');
    }
    if (allowanceDate < cinv.invoice_date) {
      throw new Error('折讓日期不可早於發票日或出貨日');
    }
    const shipDates = orders.map(o => o.ship_date).filter(Boolean).sort();
    if (shipDates.length > 0 && allowanceDate < shipDates[shipDates.length - 1]) {
      throw new Error('折讓日期不可早於發票日或出貨日');
    }

    const remainingShortfall = formatted.item.shipment_shortfall;
    const untaxedAmount = input.untaxed_amount !== undefined && input.untaxed_amount !== null
      ? Math.round(Number(input.untaxed_amount) * 100) / 100
      : remainingShortfall;

    if (untaxedAmount <= 0) {
      throw new Error('折讓未稅金額需大於 0');
    }
    if (untaxedAmount > remainingShortfall + 0.001) {
      throw new Error(`折讓未稅金額不可超過出貨短少剩餘 ${remainingShortfall}`);
    }

    const defaultTax = Number(cinv.untaxed_amount) > 0
      ? Math.round(untaxedAmount * Number(cinv.tax_amount || 0) / Number(cinv.untaxed_amount) * 100) / 100
      : 0;
    const taxAmount = input.tax_amount !== undefined && input.tax_amount !== null
      ? Math.round(Number(input.tax_amount) * 100) / 100
      : defaultTax;

    if (taxAmount < 0) {
      throw new Error('折讓稅額需大於或等於 0');
    }

    const postedTaxSum = (mockSalesAllowances || [])
      .filter(sa => sa.customer_invoice_id === cinv.id && sa.status === 'posted' && (sa.tenant_id || 'tnt_mock_1') === targetTenantId)
      .reduce((s, sa) => s + (Number(sa.tax_amount) || 0), 0);
    if (taxAmount + postedTaxSum > Number(cinv.tax_amount || 0) + 0.001) {
      throw new Error(`折讓稅額累計不可超過原發票稅額 ${cinv.tax_amount}`);
    }

    const ar = mockAccountsReceivable.find(
      a => a.source_type === 'customer_invoice' && a.source_id === cinv.id && (a.tenant_id || 'tnt_mock_1') === targetTenantId && a.status !== 'voided'
    );
    if (!ar) throw new Error('找不到對應的應收帳款');

    const tenantAllowances = (mockSalesAllowances || []).filter(sa => (sa.tenant_id || 'tnt_mock_1') === targetTenantId);
    let maxSeq = 0;
    for (const sa of tenantAllowances) {
      if (sa.allowance_number && sa.allowance_number.startsWith('SALW-')) {
        const num = parseInt(sa.allowance_number.replace('SALW-', ''), 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    }
    const allowanceNumber = `SALW-${String(maxSeq + 1).padStart(5, '0')}`;
    const newAllowance = {
      id: `salw_${Date.now()}_${nextMockUid()}`,
      tenant_id: targetTenantId,
      allowance_number: allowanceNumber,
      customer_invoice_id: cinv.id,
      invoice_number_snapshot: cinv.invoice_number,
      tax_invoice_number_snapshot: cinv.tax_invoice_number || null,
      account_receivable_id: ar.id,
      customer_partner_id: cinv.customer_partner_id,
      customer_name_snapshot: cinv.customer_name_snapshot,
      reason_type: 'shipment_shortfall',
      allowance_date: allowanceDate,
      shortfall_snapshot: null,
      untaxed_amount: untaxedAmount,
      tax_amount: taxAmount,
      total_amount: Math.round((untaxedAmount + taxAmount) * 100) / 100,
      external_reference: input.external_reference || null,
      currency: 'TWD',
      status: 'draft',
      note: input.note || null,
      created_by: activeUid,
      created_at: Math.floor(Date.now() / 1000),
      posted_by: null,
      posted_at: null,
      cancelled_at: null,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      task_id: null
    };

    mockSalesAllowances.push(newAllowance);
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    return newAllowance;
  },

  update_sales_allowance: async (args) => {
    syncAllowanceStorage();
    const input = args.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const id = String(input.id || '').trim();
    const allowance = (mockSalesAllowances || []).find(
      sa => sa.id === id && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!allowance) throw new Error('找不到指定的折讓單');
    if (allowance.status !== 'draft') throw new Error('僅草稿狀態可修改');

    const cinv = mockCustomerInvoices.find(ci => ci.id === allowance.customer_invoice_id);
    const formatted = cinv ? formatMockCustomerInvoice(cinv) : null;
    const remainingShortfall = formatted ? formatted.item.shipment_shortfall : 0;

    const today = new Date().toISOString().split('T')[0];
    const allowanceDate = input.allowance_date !== undefined ? String(input.allowance_date).trim() : allowance.allowance_date;
    if (allowanceDate > today) throw new Error('折讓日期不可晚於今天');
    if (cinv && allowanceDate < cinv.invoice_date) throw new Error('折讓日期不可早於發票日或出貨日');

    if (input.untaxed_amount !== undefined) {
      const u = Math.round(Number(input.untaxed_amount) * 100) / 100;
      if (u <= 0) throw new Error('折讓未稅金額需大於 0');
      if (u > remainingShortfall + 0.001) throw new Error(`折讓未稅金額不可超過出貨短少剩餘 ${remainingShortfall}`);
      allowance.untaxed_amount = u;
    }

    if (input.tax_amount !== undefined) {
      const t = Math.round(Number(input.tax_amount) * 100) / 100;
      if (t < 0) throw new Error('折讓稅額需大於或等於 0');
      allowance.tax_amount = t;
    }

    allowance.total_amount = Math.round((allowance.untaxed_amount + allowance.tax_amount) * 100) / 100;
    allowance.allowance_date = allowanceDate;
    if (input.external_reference !== undefined) allowance.external_reference = input.external_reference || null;
    if (input.note !== undefined) allowance.note = input.note || null;

    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    return allowance;
  },

  post_sales_allowance: async (args) => {
    syncAllowanceStorage();
    const { allowance_id, allowanceId } = args || {};
    const id = String(allowance_id || allowanceId || '').trim();
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();

    const allowance = (mockSalesAllowances || []).find(
      sa => sa.id === id && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!allowance) throw new Error('找不到指定的折讓單');
    if (allowance.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${allowance.status} 轉換至 posted`);
    }

    const ar = mockAccountsReceivable.find(a => a.id === allowance.account_receivable_id);
    if (!ar) throw new Error('找不到對應的應收帳款');
    if (ar.status !== 'open') throw new Error('原應收非 open 狀態');

    const formattedAr = formatMockAccountReceivable(ar);
    const outstanding = formattedAr.detail.outstanding_amount;
    const allowanceTotal = Math.round((allowance.untaxed_amount + allowance.tax_amount) * 100) / 100;

    if (allowanceTotal > outstanding + 0.001) {
      throw new Error(`折讓金額 ${allowanceTotal} 超過應收未收餘額 ${outstanding}；客戶已付款需退款的情境不在本輪範圍`);
    }

    const cinv = mockCustomerInvoices.find(ci => ci.id === allowance.customer_invoice_id);
    const formattedCinv = cinv ? formatMockCustomerInvoice(cinv) : null;
    const currentShortfall = formattedCinv ? formattedCinv.item.shipment_shortfall : allowance.untaxed_amount;

    allowance.status = 'posted';
    allowance.posted_by = activeUid;
    allowance.posted_at = Math.floor(Date.now() / 1000);
    allowance.shortfall_snapshot = currentShortfall;

    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    return allowance;
  },

  cancel_sales_allowance: async (args) => {
    syncAllowanceStorage();
    const { allowance_id, allowanceId } = args || {};
    const id = String(allowance_id || allowanceId || '').trim();
    const targetTenantId = resolveMockActiveTenantId();

    const allowance = (mockSalesAllowances || []).find(
      sa => sa.id === id && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!allowance) throw new Error('找不到指定的折讓單');
    if (allowance.status !== 'draft') throw new Error('僅草稿狀態可取消');

    allowance.status = 'cancelled';
    allowance.cancelled_at = Math.floor(Date.now() / 1000);

    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    return allowance;
  },

  void_sales_allowance: async (args) => {
    syncAllowanceStorage();
    const { allowance_id, allowanceId, void_reason, voidReason } = args || {};
    const id = String(allowance_id || allowanceId || '').trim();
    const reason = String(void_reason || voidReason || '').trim();
    const targetTenantId = resolveMockActiveTenantId();
    const activeUid = resolveMockActiveUserId();

    if (!reason) throw new Error('作廢原因必填');

    const allowance = (mockSalesAllowances || []).find(
      sa => sa.id === id && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!allowance) throw new Error('找不到指定的折讓單');
    if (allowance.status !== 'posted') throw new Error('僅已過帳狀態可作廢');

    allowance.status = 'voided';
    allowance.voided_by = activeUid;
    allowance.voided_at = Math.floor(Date.now() / 1000);
    allowance.void_reason = reason;

    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    return allowance;
  },

  get_sales_allowance: async (args) => {
    syncAllowanceStorage();
    const { allowance_id, allowanceId } = args || {};
    const id = String(allowance_id || allowanceId || '').trim();
    const targetTenantId = resolveMockActiveTenantId();

    const allowance = (mockSalesAllowances || []).find(
      sa => sa.id === id && (sa.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!allowance) throw new Error('找不到指定的折讓單');
    return allowance;
  },

  list_sales_allowances: async (args) => {
    syncAllowanceStorage();
    const { filter } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const st = filter?.status?.trim();
    const cid = filter?.customer_partner_id || filter?.customerPartnerId;
    const invId = filter?.customer_invoice_id || filter?.customerInvoiceId;
    const q = filter?.query?.trim().toLowerCase();

    return (mockSalesAllowances || [])
      .filter(sa => {
        if ((sa.tenant_id || 'tnt_mock_1') !== targetTenantId) return false;
        if (st && sa.status !== st) return false;
        if (cid && sa.customer_partner_id !== cid) return false;
        if (invId && sa.customer_invoice_id !== invId) return false;
        if (q) {
          const matchNum = (sa.allowance_number || '').toLowerCase().includes(q);
          const matchInv = (sa.invoice_number_snapshot || '').toLowerCase().includes(q);
          const matchCust = (sa.customer_name_snapshot || '').toLowerCase().includes(q);
          if (!matchNum && !matchInv && !matchCust) return false;
        }
        return true;
      })
      .sort((a, b) => b.created_at - a.created_at);
  }
};

