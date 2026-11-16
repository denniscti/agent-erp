// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import {
  mockPayments,
  mockPaymentAllocations,
  mockVendorPayments,
  mockVendorPaymentAllocations
} from '../vendorPayments/mocks.js';
import {
  mockPurchaseOrders,
  mockPurchaseOrderLines
} from '../purchaseOrders/mocks.js';
import {
  mockVendorBills,
  mockVendorBillOrders
} from '../vendorBills/mocks.js';

export let mockAccountsPayable = loadStorage('agent_erp_mock_accounts_payable', []);
if (!mockAccountsPayable || !Array.isArray(mockAccountsPayable)) {
  mockAccountsPayable = [];
  saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
}

export function formatMockAccountPayable(ap) {
  const targetTenantId = ap.tenant_id || 'tnt_mock_1';
  const allAllocations = [
    ...(mockPaymentAllocations || []),
    ...(mockVendorPaymentAllocations || []),
  ];
  const allocations = allAllocations
    .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId)
    .map(pa => {
      const payment = (mockPayments || []).find(p => p.id === pa.payment_id) ||
                      (mockVendorPayments || []).find(p => p.id === pa.payment_id) || {};
      return {
        id: pa.id,
        payment_id: pa.payment_id,
        payment_number: payment.payment_number || '',
        amount: Math.round(Number(pa.amount) * 100) / 100,
        payment_date: payment.payment_date || '',
        payment_status: payment.status || 'posted',
        created_at: pa.created_at || ap.created_at
      };
    });

  let rawPaid = 0;
  for (const a of allocations) {
    if (a.payment_status === 'posted') {
      rawPaid += a.amount;
    }
  }

  const roundedTotal = Math.round(Number(ap.amount) * 100) / 100;
  const roundedPaid = Math.round(rawPaid * 100) / 100;

  let paid_amount = 0;
  let outstanding_amount = 0;
  let settlement_status = 'unpaid';

  if (ap.status === 'voided') {
    paid_amount = 0;
    outstanding_amount = 0;
    settlement_status = 'unpaid';
  } else {
    const outstanding = Math.round((roundedTotal - roundedPaid) * 100) / 100;
    if (outstanding <= 0) {
      paid_amount = roundedPaid;
      outstanding_amount = 0;
      settlement_status = 'paid';
    } else if (outstanding >= roundedTotal) {
      paid_amount = 0;
      outstanding_amount = roundedTotal;
      settlement_status = 'unpaid';
    } else {
      paid_amount = roundedPaid;
      outstanding_amount = outstanding;
      settlement_status = 'partially_paid';
    }
  }

  return {
    detail: {
      ...ap,
      paid_amount,
      outstanding_amount,
      settlement_status,
      allocations
    },
    item: {
      ...ap,
      paid_amount,
      outstanding_amount,
      settlement_status
    }
  };
}

export const accountPayableMocks = {
  get_account_payable: async (args) => {
    const { id, ap_id, apId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetId = id || ap_id || apId;
    if (!targetId || !String(targetId).trim()) {
      throw new Error('缺少應付帳款 ID (id 或 ap_id)');
    }
    const ap = mockAccountsPayable.find(a => a.id === String(targetId).trim() && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ap) {
      throw new Error('找不到指定的應付帳款或不屬於目前租戶');
    }
    return formatMockAccountPayable(ap).detail;
  },

  list_accounts_payable: async (args) => {
    const { vendor_partner_id, vendorPartnerId, settlement_status, settlementStatus, status, due_date_from, dueDateFrom, due_date_to, dueDateTo } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = mockAccountsPayable.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    const vp = vendor_partner_id || vendorPartnerId;
    if (vp && String(vp).trim()) {
      list = list.filter(a => a.vendor_partner_id === String(vp).trim());
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
      .map(a => formatMockAccountPayable(a).item);

    const ss = settlement_status || settlementStatus;
    if (ss && String(ss).trim()) {
      const norm = String(ss).trim().toLowerCase();
      let targetNorm = norm;
      if (norm === '未付') targetNorm = 'unpaid';
      else if (norm === '部分付款' || norm === 'partial') targetNorm = 'partially_paid';
      else if (norm === '已付清') targetNorm = 'paid';
      return items.filter(item => item.settlement_status === targetNorm);
    }
    return items;
  },

  get_payables_aging: async (args) => {
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

    // Unbilled received orders
    const activeCoveredPoIds = new Set();
    for (const order of mockVendorBillOrders) {
      const bill = mockVendorBills.find(b => b.id === order.bill_id && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (bill && ['draft', 'disputed', 'posted'].includes(bill.status)) {
        activeCoveredPoIds.add(order.purchase_order_id);
      }
    }

    const unbilledOrders = mockPurchaseOrders
      .filter(po => (po.tenant_id || 'tnt_mock_1') === targetTenantId && po.status === 'received' && !activeCoveredPoIds.has(po.id));

    const unbilledMap = new Map();
    for (const po of unbilledOrders) {
      const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === po.id);
      const recTotal = lines.reduce((sum, l) => sum + (l.received_quantity || 0) * (l.purchase_cost || 0), 0);
      const current = unbilledMap.get(po.vendor_partner_id) || { vendor_name: po.vendor_name_snapshot, amount: 0 };
      current.amount += recTotal;
      unbilledMap.set(po.vendor_partner_id, current);
    }

    // Open accounts payable with outstanding_amount > 0
    const openAps = mockAccountsPayable
      .filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId && a.status === 'open')
      .map(a => formatMockAccountPayable(a).item)
      .filter(a => a.outstanding_amount > 0);

    const vendorMap = new Map();

    for (const ap of openAps) {
      let vData = vendorMap.get(ap.vendor_partner_id);
      if (!vData) {
        vData = {
          vendor_partner_id: ap.vendor_partner_id,
          vendor_name: ap.vendor_name_snapshot,
          current: 0,
          overdue_1_30: 0,
          overdue_31_60: 0,
          overdue_61_90: 0,
          overdue_90_plus: 0,
          total_outstanding: 0,
          unbilled_received_amount: 0,
          items: []
        };
        vendorMap.set(ap.vendor_partner_id, vData);
      }

      const overdueDays = calendarDayDiff(ap.due_date, asOf);
      let bucket = 'current';
      if (overdueDays <= 0) {
        bucket = 'current';
        vData.current += ap.outstanding_amount;
      } else if (overdueDays <= 30) {
        bucket = '1-30';
        vData.overdue_1_30 += ap.outstanding_amount;
      } else if (overdueDays <= 60) {
        bucket = '31-60';
        vData.overdue_31_60 += ap.outstanding_amount;
      } else if (overdueDays <= 90) {
        bucket = '61-90';
        vData.overdue_61_90 += ap.outstanding_amount;
      } else {
        bucket = '90+';
        vData.overdue_90_plus += ap.outstanding_amount;
      }
      vData.total_outstanding += ap.outstanding_amount;

      vData.items.push({
        account_payable_id: ap.id,
        source_id: ap.source_id,
        source_type: ap.source_type,
        source_number: ap.source_number,
        vendor_partner_id: ap.vendor_partner_id,
        vendor_name_snapshot: ap.vendor_name_snapshot,
        external_reference: ap.external_reference || null,
        document_date: ap.document_date,
        due_date: ap.due_date,
        overdue_days: overdueDays,
        bucket: bucket,
        amount: round2(ap.amount),
        paid_amount: round2(ap.paid_amount),
        outstanding_amount: round2(ap.outstanding_amount),
        settlement_status: ap.settlement_status
      });
    }

    // Merge unbilled
    for (const [vendorId, uData] of unbilledMap.entries()) {
      let vData = vendorMap.get(vendorId);
      if (!vData) {
        vData = {
          vendor_partner_id: vendorId,
          vendor_name: uData.vendor_name,
          current: 0,
          overdue_1_30: 0,
          overdue_31_60: 0,
          overdue_61_90: 0,
          overdue_90_plus: 0,
          total_outstanding: 0,
          unbilled_received_amount: 0,
          items: []
        };
        vendorMap.set(vendorId, vData);
      }
      vData.unbilled_received_amount = round2(uData.amount);
    }

    // Round all
    for (const vData of vendorMap.values()) {
      vData.current = round2(vData.current);
      vData.overdue_1_30 = round2(vData.overdue_1_30);
      vData.overdue_31_60 = round2(vData.overdue_31_60);
      vData.overdue_61_90 = round2(vData.overdue_61_90);
      vData.overdue_90_plus = round2(vData.overdue_90_plus);
      vData.total_outstanding = round2(vData.total_outstanding);
      vData.unbilled_received_amount = round2(vData.unbilled_received_amount);
    }

    const vendors = Array.from(vendorMap.values())
      .filter(v => v.total_outstanding > 0 || v.unbilled_received_amount > 0)
      .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));

    const totals = {
      current: 0,
      overdue_1_30: 0,
      overdue_31_60: 0,
      overdue_61_90: 0,
      overdue_90_plus: 0,
      total_outstanding: 0,
      unbilled_received_amount: 0
    };

    for (const v of vendors) {
      totals.current += v.current;
      totals.overdue_1_30 += v.overdue_1_30;
      totals.overdue_31_60 += v.overdue_31_60;
      totals.overdue_61_90 += v.overdue_61_90;
      totals.overdue_90_plus += v.overdue_90_plus;
      totals.total_outstanding += v.total_outstanding;
      totals.unbilled_received_amount += v.unbilled_received_amount;
    }

    totals.current = round2(totals.current);
    totals.overdue_1_30 = round2(totals.overdue_1_30);
    totals.overdue_31_60 = round2(totals.overdue_31_60);
    totals.overdue_61_90 = round2(totals.overdue_61_90);
    totals.overdue_90_plus = round2(totals.overdue_90_plus);
    totals.total_outstanding = round2(totals.total_outstanding);
    totals.unbilled_received_amount = round2(totals.unbilled_received_amount);

    return {
      as_of_date: asOf,
      vendors,
      totals
    };
  },

  get_vendor_statement: async (args) => {
    const { vendor_partner_id, vendorPartnerId, start_date, startDate, end_date, endDate } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    if (!targetTenantId || !String(targetTenantId).trim()) {
      throw new Error('Tenant ID cannot be empty');
    }

    const vid = String(vendor_partner_id || vendorPartnerId || '').trim();
    if (!vid) {
      throw new Error('找不到指定的供應商或不屬於目前租戶');
    }

    const partner = (mockPartners || []).find(p => p.id === vid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!partner) {
      throw new Error('找不到指定的供應商或不屬於目前租戶');
    }
    if (!partner.is_vendor) {
      throw new Error('指定的合作夥伴不是供應商 (is_vendor != 1)');
    }

    const sDate = String(start_date || startDate || '').trim();
    const eDate = String(end_date || endDate || '').trim();

    function round2(v) {
      return Math.round((v || 0) * 100) / 100;
    }

    function isValidYmd(s) {
      if (!s || typeof s !== 'string' || s.length !== 10) return false;
      const parts = s.split('-');
      if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return false;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return false;
      return true;
    }

    if (!isValidYmd(sDate) || !isValidYmd(eDate)) {
      throw new Error('無效的日期格式，需為 YYYY-MM-DD');
    }
    if (sDate > eDate) {
      throw new Error('起日不可晚於迄日');
    }

    // Gather APs
    const allAps = (mockAccountsPayable || []).filter(
      ap => (ap.tenant_id || 'tnt_mock_1') === targetTenantId && ap.vendor_partner_id === vid && ap.status !== 'voided'
    );

    // Gather posted payments
    const allPayments = [
      ...(mockVendorPayments || []),
      ...(mockPayments || []).filter(p => !(mockVendorPayments || []).some(vp => vp.id === p.id))
    ].filter(
      p => (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.vendor_partner_id === vid && p.status === 'posted'
    );

    const allAllocations = [
      ...(mockVendorPaymentAllocations || []),
      ...(mockPaymentAllocations || []).filter(pa => !(mockVendorPaymentAllocations || []).some(vpa => vpa.id === pa.id))
    ].filter(
      pa => (pa.tenant_id || 'tnt_mock_1') === targetTenantId
    );

    // 1. Opening balance
    const openingAps = allAps.filter(ap => ap.document_date < sDate);
    const openingApTotal = openingAps.reduce((sum, ap) => sum + Number(ap.amount || 0), 0);

    // Opening posted payments (payment_date < sDate)
    const openingPayments = allPayments.filter(p => p.payment_date < sDate);
    const openingPaymentIds = new Set(openingPayments.map(p => p.id));
    const apIdSet = new Set(allAps.map(a => a.id));

    const openingPaidTotal = allAllocations
      .filter(pa => openingPaymentIds.has(pa.payment_id) && apIdSet.has(pa.account_payable_id))
      .reduce((sum, pa) => sum + Number(pa.amount || 0), 0);

    const opening_balance = round2(openingApTotal - openingPaidTotal);

    // 2. Current period payables
    const currentAps = allAps
      .filter(ap => ap.document_date >= sDate && ap.document_date <= eDate)
      .sort((a, b) => (a.document_date || '').localeCompare(b.document_date || '') || (a.created_at || 0) - (b.created_at || 0) || (a.id || '').localeCompare(b.id || ''));

    const payables = currentAps.map(ap => ({
      account_payable_id: ap.id,
      source_type: ap.source_type,
      source_id: ap.source_id,
      source_number: ap.source_number,
      external_reference: ap.external_reference || null,
      document_date: ap.document_date,
      due_date: ap.due_date,
      amount: round2(ap.amount),
      status: ap.status
    }));

    const current_payables_total = round2(payables.reduce((sum, p) => sum + p.amount, 0));

    // 3. Current period payments
    const currentPayments = allPayments
      .filter(p => p.payment_date >= sDate && p.payment_date <= eDate)
      .sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || '') || (a.created_at || 0) - (b.created_at || 0) || (a.id || '').localeCompare(b.id || ''));

    const apMap = new Map(allAps.map(a => [a.id, a]));

    const payments = currentPayments.map(p => {
      const allocs = allAllocations
        .filter(pa => pa.payment_id === p.id && apMap.has(pa.account_payable_id))
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || (a.id || '').localeCompare(b.id || ''));

      const allocDetails = allocs.map(pa => {
        const matchedAp = apMap.get(pa.account_payable_id);
        return {
          account_payable_id: pa.account_payable_id,
          source_type: matchedAp?.source_type || '',
          source_id: matchedAp?.source_id || '',
          source_number: matchedAp?.source_number || '',
          amount: round2(pa.amount)
        };
      });

      const paymentAmount = round2(allocDetails.reduce((sum, a) => sum + a.amount, 0));

      return {
        payment_id: p.id,
        payment_number: p.payment_number,
        payment_date: p.payment_date,
        payment_method: p.payment_method || 'bank_transfer',
        payment_reference: p.payment_reference || null,
        amount: paymentAmount,
        note: p.note || null,
        allocations: allocDetails
      };
    });

    const current_payments_total = round2(payments.reduce((sum, p) => sum + p.amount, 0));

    // 4. Closing balance
    const closing_balance = round2(opening_balance + current_payables_total - current_payments_total);

    return {
      tenant_id: targetTenantId,
      vendor_partner_id: vid,
      vendor_name: partner.name,
      start_date: sDate,
      end_date: eDate,
      opening_balance,
      current_payables_total,
      current_payments_total,
      closing_balance,
      payables,
      payments
    };
  },

  reset_mock_accounts_payable: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockAccountsPayable = (mockAccountsPayable || []).filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTid);
    } else {
      mockAccountsPayable = [];
    }
    saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
    return true;
  }
};
