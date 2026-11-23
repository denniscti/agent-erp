// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId
} from '../mockStorage.js';
import { customerInvoiceMocks } from '../customerInvoices/mocks.js';

export let mockAccountsReceivable = loadStorage('agent_erp_mock_accounts_receivable', []);
if (!mockAccountsReceivable || !Array.isArray(mockAccountsReceivable)) {
  mockAccountsReceivable = [];
  saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);
}

export let mockCustomerReceiptAllocations = loadStorage('agent_erp_mock_customer_receipt_allocations', []);
if (!mockCustomerReceiptAllocations || !Array.isArray(mockCustomerReceiptAllocations)) {
  mockCustomerReceiptAllocations = [];
  saveStorage('agent_erp_mock_customer_receipt_allocations', mockCustomerReceiptAllocations);
}

export let mockCustomerReceipts = loadStorage('agent_erp_mock_customer_receipts', []);
if (!mockCustomerReceipts || !Array.isArray(mockCustomerReceipts)) {
  mockCustomerReceipts = [];
  saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
}

export function formatMockAccountReceivable(ar) {
  const targetTenantId = ar.tenant_id || 'tnt_mock_1';
  const allocations = (mockCustomerReceiptAllocations || [])
    .filter(ra => ra.account_receivable_id === ar.id && (ra.tenant_id || 'tnt_mock_1') === targetTenantId)
    .map(ra => {
      const receipt = (mockCustomerReceipts || []).find(r => r.id === ra.receipt_id) || {};
      return {
        id: ra.id,
        receipt_id: ra.receipt_id,
        receipt_number: receipt.receipt_number || '',
        amount: Math.round(Number(ra.amount) * 100) / 100,
        receipt_date: receipt.receipt_date || '',
        receipt_status: receipt.status || 'posted',
        created_at: ra.created_at || ar.created_at
      };
    });

  let rawReceived = 0;
  for (const a of allocations) {
    if (a.receipt_status === 'posted') {
      rawReceived += a.amount;
    }
  }

  const activeAllowances = loadStorage('agent_erp_mock_sales_allowances', []);
  const rawAllowance = (activeAllowances || [])
    .filter(sa => sa.account_receivable_id === ar.id && (sa.tenant_id || 'tnt_mock_1') === targetTenantId && sa.status === 'posted')
    .reduce((sum, sa) => sum + (Number(sa.untaxed_amount) || 0) + (Number(sa.tax_amount) || 0), 0);

  const roundedTotal = Math.round(Number(ar.amount) * 100) / 100;
  const roundedReceived = Math.round(rawReceived * 100) / 100;
  const roundedAllowance = Math.round(rawAllowance * 100) / 100;

  let received_amount = 0;
  let allowance_amount = 0;
  let outstanding_amount = 0;
  let settlement_status = 'unpaid';

  if (ar.status === 'voided') {
    received_amount = 0;
    allowance_amount = 0;
    outstanding_amount = 0;
    settlement_status = 'unpaid';
  } else {
    const settled = Math.round((roundedReceived + roundedAllowance) * 100) / 100;
    const outstanding = Math.round((roundedTotal - settled) * 100) / 100;
    if (outstanding <= 0) {
      received_amount = roundedReceived;
      allowance_amount = roundedAllowance;
      outstanding_amount = 0;
      settlement_status = 'paid';
    } else if (settled <= 0) {
      received_amount = 0;
      allowance_amount = 0;
      outstanding_amount = roundedTotal;
      settlement_status = 'unpaid';
    } else {
      received_amount = roundedReceived;
      allowance_amount = roundedAllowance;
      outstanding_amount = outstanding;
      settlement_status = 'partially_paid';
    }
  }

  return {
    detail: {
      ...ar,
      received_amount,
      allowance_amount,
      outstanding_amount,
      settlement_status,
      allocations
    },
    item: {
      ...ar,
      received_amount,
      allowance_amount,
      outstanding_amount,
      settlement_status
    }
  };
}

export const accountReceivableMocks = {
  get_account_receivable: async (args) => {
    const { id, ar_id, arId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetId = id || ar_id || arId;
    if (!targetId || !String(targetId).trim()) {
      throw new Error('缺少應收帳款 ID (id 或 ar_id)');
    }
    const ar = mockAccountsReceivable.find(
      a => a.id === String(targetId).trim() && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!ar) {
      throw new Error('找不到指定的應收帳款或不屬於目前租戶');
    }
    return formatMockAccountReceivable(ar).detail;
  },

  list_accounts_receivable: async (args) => {
    const {
      customer_partner_id,
      customerPartnerId,
      settlement_status,
      settlementStatus,
      status,
      due_date_from,
      dueDateFrom,
      due_date_to,
      dueDateTo
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = mockAccountsReceivable.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId);

    const cp = customer_partner_id || customerPartnerId;
    if (cp && String(cp).trim()) {
      list = list.filter(a => a.customer_partner_id === String(cp).trim());
    }
    const st = status;
    if (st && String(st).trim()) {
      list = list.filter(a => a.status === String(st).trim());
    }
    const from = due_date_from || dueDateFrom;
    if (from && String(from).trim()) {
      list = list.filter(a => a.due_date >= String(from).trim());
    }
    const to = due_date_to || dueDateTo;
    if (to && String(to).trim()) {
      list = list.filter(a => a.due_date <= String(to).trim());
    }

    const items = list
      .sort((a, b) => (b.document_date || '').localeCompare(a.document_date || '') || b.created_at - a.created_at)
      .map(a => formatMockAccountReceivable(a).item);

    const ss = settlement_status || settlementStatus;
    if (ss && String(ss).trim()) {
      const norm = String(ss).trim().toLowerCase();
      let targetNorm = norm;
      if (norm === '未收') targetNorm = 'unpaid';
      else if (norm === '部分收款' || norm === 'partial') targetNorm = 'partially_paid';
      else if (norm === '已收清') targetNorm = 'paid';
      return items.filter(item => item.settlement_status === targetNorm);
    }
    return items;
  },

  get_receivables_aging: async (args) => {
    const { as_of_date, asOfDate } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !String(targetTenantId).trim()) {
      throw new Error('Tenant ID cannot be empty');
    }

    function parseYmd(s) {
      if (!s || typeof s !== 'string') return null;
      const parts = s.trim().split('-');
      if (parts.length !== 3) return null;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
      return { y, m, d };
    }

    function ymdToJdn(y, m, d) {
      const yPrime = m <= 2 ? y - 1 : y;
      const mPrime = m <= 2 ? m + 12 : m;
      const a = Math.floor(yPrime / 100);
      const b = 2 - a + Math.floor(a / 4);
      return Math.floor((1461 * (yPrime + 4716)) / 4) + Math.floor((153 * (mPrime + 1)) / 5) + d + b - 1524;
    }

    function calendarDayDiff(fromDate, toDate) {
      const f = parseYmd(fromDate);
      const t = parseYmd(toDate);
      if (!f || !t) return 0;
      return ymdToJdn(t.y, t.m, t.d) - ymdToJdn(f.y, f.m, f.d);
    }

    function round2(v) {
      return Math.round((v || 0) * 100) / 100;
    }

    let asOf = as_of_date || asOfDate;
    if (!asOf || !String(asOf).trim()) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      asOf = `${year}-${month}-${day}`;
    } else {
      asOf = String(asOf).trim();
    }

    // 1. Uninvoiced sales orders (#226 reference column)
    let uninvoicedList = [];
    try {
      if (customerInvoiceMocks && typeof customerInvoiceMocks.list_uninvoiced_sales_orders === 'function') {
        uninvoicedList = await customerInvoiceMocks.list_uninvoiced_sales_orders();
      }
    } catch (_) {
      uninvoicedList = [];
    }

    const uninvoicedMap = new Map();
    for (const u of (uninvoicedList || [])) {
      let entry = uninvoicedMap.get(u.customer_partner_id);
      if (!entry) {
        entry = {
          customer_name: u.customer_name_snapshot,
          sumA: 0,
          sumB: 0,
          sumC: 0,
          total: 0
        };
        uninvoicedMap.set(u.customer_partner_id, entry);
      }
      const amt = u.uninvoiced_amount || 0;
      if (u.group === 'per_order_confirmed') entry.sumA += amt;
      else if (u.group === 'per_order_shipped') entry.sumB += amt;
      else if (u.group === 'monthly_consolidated') entry.sumC += amt;
      entry.total += amt;
    }

    // 2. Open accounts receivable with outstanding_amount > 0
    const openArs = mockAccountsReceivable
      .filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId && a.status === 'open')
      .map(a => formatMockAccountReceivable(a).item)
      .filter(a => a.outstanding_amount > 0);

    const customerMap = new Map();

    for (const ar of openArs) {
      let cData = customerMap.get(ar.customer_partner_id);
      if (!cData) {
        cData = {
          customer_partner_id: ar.customer_partner_id,
          customer_name: ar.customer_name_snapshot,
          current: 0,
          overdue_1_30: 0,
          overdue_31_60: 0,
          overdue_61_90: 0,
          overdue_90_plus: 0,
          total_outstanding: 0,
          uninvoiced_amount: 0,
          uninvoiced_group_a: 0,
          uninvoiced_group_b: 0,
          uninvoiced_group_c: 0,
          items: []
        };
        customerMap.set(ar.customer_partner_id, cData);
      }

      const overdueDays = calendarDayDiff(ar.due_date, asOf);
      let bucket = 'current';
      if (overdueDays <= 0) {
        bucket = 'current';
        cData.current += ar.outstanding_amount;
      } else if (overdueDays <= 30) {
        bucket = '1-30';
        cData.overdue_1_30 += ar.outstanding_amount;
      } else if (overdueDays <= 60) {
        bucket = '31-60';
        cData.overdue_31_60 += ar.outstanding_amount;
      } else if (overdueDays <= 90) {
        bucket = '61-90';
        cData.overdue_61_90 += ar.outstanding_amount;
      } else {
        bucket = '90+';
        cData.overdue_90_plus += ar.outstanding_amount;
      }
      cData.total_outstanding += ar.outstanding_amount;

      cData.items.push({
        account_receivable_id: ar.id,
        source_id: ar.source_id,
        source_type: ar.source_type,
        source_number: ar.source_number,
        customer_partner_id: ar.customer_partner_id,
        customer_name_snapshot: ar.customer_name_snapshot,
        external_reference: ar.external_reference || null,
        document_date: ar.document_date,
        due_date: ar.due_date,
        overdue_days: overdueDays,
        bucket: bucket,
        amount: round2(ar.amount),
        received_amount: round2(ar.received_amount),
        allowance_amount: round2(ar.allowance_amount),
        outstanding_amount: round2(ar.outstanding_amount),
        settlement_status: ar.settlement_status
      });
    }

    // Merge uninvoiced
    for (const [customerId, uData] of uninvoicedMap.entries()) {
      let cData = customerMap.get(customerId);
      if (!cData) {
        cData = {
          customer_partner_id: customerId,
          customer_name: uData.customer_name,
          current: 0,
          overdue_1_30: 0,
          overdue_31_60: 0,
          overdue_61_90: 0,
          overdue_90_plus: 0,
          total_outstanding: 0,
          uninvoiced_amount: 0,
          uninvoiced_group_a: 0,
          uninvoiced_group_b: 0,
          uninvoiced_group_c: 0,
          items: []
        };
        customerMap.set(customerId, cData);
      }
      cData.uninvoiced_amount = round2(uData.total);
      cData.uninvoiced_group_a = round2(uData.sumA);
      cData.uninvoiced_group_b = round2(uData.sumB);
      cData.uninvoiced_group_c = round2(uData.sumC);
    }

    // Filter customers: total_outstanding > 0 || uninvoiced_amount > 0
    const filteredCustomers = [];
    for (const cData of customerMap.values()) {
      cData.current = round2(cData.current);
      cData.overdue_1_30 = round2(cData.overdue_1_30);
      cData.overdue_31_60 = round2(cData.overdue_31_60);
      cData.overdue_61_90 = round2(cData.overdue_61_90);
      cData.overdue_90_plus = round2(cData.overdue_90_plus);
      cData.total_outstanding = round2(cData.total_outstanding);
      cData.uninvoiced_amount = round2(cData.uninvoiced_amount);
      cData.uninvoiced_group_a = round2(cData.uninvoiced_group_a);
      cData.uninvoiced_group_b = round2(cData.uninvoiced_group_b);
      cData.uninvoiced_group_c = round2(cData.uninvoiced_group_c);

      if (cData.total_outstanding > 0 || cData.uninvoiced_amount > 0) {
        filteredCustomers.push(cData);
      }
    }

    filteredCustomers.sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''));

    const totals = {
      current: 0,
      overdue_1_30: 0,
      overdue_31_60: 0,
      overdue_61_90: 0,
      overdue_90_plus: 0,
      total_outstanding: 0,
      uninvoiced_amount: 0,
      uninvoiced_group_a: 0,
      uninvoiced_group_b: 0,
      uninvoiced_group_c: 0
    };

    for (const c of filteredCustomers) {
      totals.current += c.current;
      totals.overdue_1_30 += c.overdue_1_30;
      totals.overdue_31_60 += c.overdue_31_60;
      totals.overdue_61_90 += c.overdue_61_90;
      totals.overdue_90_plus += c.overdue_90_plus;
      totals.total_outstanding += c.total_outstanding;
      totals.uninvoiced_amount += c.uninvoiced_amount;
      totals.uninvoiced_group_a += c.uninvoiced_group_a;
      totals.uninvoiced_group_b += c.uninvoiced_group_b;
      totals.uninvoiced_group_c += c.uninvoiced_group_c;
    }

    totals.current = round2(totals.current);
    totals.overdue_1_30 = round2(totals.overdue_1_30);
    totals.overdue_31_60 = round2(totals.overdue_31_60);
    totals.overdue_61_90 = round2(totals.overdue_61_90);
    totals.overdue_90_plus = round2(totals.overdue_90_plus);
    totals.total_outstanding = round2(totals.total_outstanding);
    totals.uninvoiced_amount = round2(totals.uninvoiced_amount);
    totals.uninvoiced_group_a = round2(totals.uninvoiced_group_a);
    totals.uninvoiced_group_b = round2(totals.uninvoiced_group_b);
    totals.uninvoiced_group_c = round2(totals.uninvoiced_group_c);

    return {
      as_of_date: asOf,
      customers: filteredCustomers,
      totals
    };
  },

  reset_mock_accounts_receivable: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockAccountsReceivable = (mockAccountsReceivable || []).filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTid);
    } else {
      mockAccountsReceivable = [];
    }
    saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);
    return true;
  }
};

export async function reset_mock_accounts_receivable(args) {
  return accountReceivableMocks.reset_mock_accounts_receivable(args);
}

