// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import { mockAccountsPayable } from '../accountsPayable/mocks.js';

// Current M15 Vendor Payments
export let mockVendorPayments = loadStorage('agent_erp_mock_vendor_payments', []);
if (!mockVendorPayments || !Array.isArray(mockVendorPayments)) {
  mockVendorPayments = [];
  saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
}

export let mockVendorPaymentAllocations = loadStorage('agent_erp_mock_vendor_payment_allocations', []);
if (!mockVendorPaymentAllocations || !Array.isArray(mockVendorPaymentAllocations)) {
  mockVendorPaymentAllocations = [];
  saveStorage('agent_erp_mock_vendor_payment_allocations', mockVendorPaymentAllocations);
}

export function formatMockVendorPayment(vp) {
  const targetTenantId = vp.tenant_id || 'tnt_mock_1';
  const allocations = mockVendorPaymentAllocations
    .filter(a => a.payment_id === vp.id && (a.tenant_id || 'tnt_mock_1') === targetTenantId)
    .map(a => {
      const ap = mockAccountsPayable.find(ap => ap.id === a.account_payable_id && (ap.tenant_id || 'tnt_mock_1') === targetTenantId) || {};
      return {
        id: a.id,
        payment_id: a.payment_id,
        account_payable_id: a.account_payable_id,
        amount: Math.round(Number(a.amount) * 100) / 100,
        created_at: a.created_at,
        source_type: ap.source_type || '',
        source_id: ap.source_id || '',
        source_number: ap.source_number || '',
        external_reference: ap.external_reference || null,
        document_date: ap.document_date || '',
        due_date: ap.due_date || '',
        ap_amount: Math.round(Number(ap.amount || 0) * 100) / 100,
      };
    });

  let total_amount = 0;
  for (const a of allocations) {
    total_amount += a.amount;
  }
  total_amount = Math.round(total_amount * 100) / 100;

  const detail = {
    ...vp,
    total_amount,
    allocations,
  };

  const item = {
    ...vp,
    total_amount,
    allocation_count: allocations.length,
  };

  return { detail, item };
}

export const vendorPaymentMocks = {
  create_vendor_payment: async (args) => {
    const input = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();

    const tenants = loadStorage('agent_erp_mock_tenants', []);
    const activeTenant = (tenants || []).find(t => t.id === targetTenantId);
    if (activeTenant && activeTenant.status && activeTenant.status !== 'active') {
      throw new Error('租戶未啟用或已停用');
    }

    const method = String(input.payment_method || input.paymentMethod || '').trim();
    if (!['bank_transfer', 'cash', 'check', 'other'].includes(method)) {
      throw new Error('付款方式無效，僅支援 bank_transfer、cash、check、other');
    }

    const vendorId = String(input.vendor_partner_id || input.vendorPartnerId || '').trim();
    if (!vendorId) {
      throw new Error('找不到指定的供應商');
    }
    const vendor = (mockPartners || []).find(p => p.id === vendorId && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!vendor) {
      throw new Error('找不到指定的供應商');
    }
    if (vendor.is_vendor !== 1 && vendor.is_vendor !== true) {
      throw new Error('指定夥伴不是供應商');
    }
    if (vendor.is_active === 0 || vendor.is_active === false) {
      throw new Error('指定供應商已停用');
    }

    const payDate = String(input.payment_date || input.paymentDate || '').trim();
    const today = new Date().toISOString().slice(0, 10);
    if (payDate > today) {
      throw new Error('付款日不可晚於今天');
    }

    const now = Math.floor(Date.now() / 1000);
    const tenantPayments = (mockVendorPayments || []).filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    let maxSeq = 0;
    for (const p of tenantPayments) {
      const m = (p.payment_number || '').match(/^PAY-(\d+)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
    const nextNum = `PAY-${String(maxSeq + 1).padStart(5, '0')}`;
    const newPayment = {
      id: `pay_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
      tenant_id: targetTenantId,
      payment_number: nextNum,
      vendor_partner_id: vendorId,
      vendor_name_snapshot: vendor.name,
      payment_date: payDate,
      payment_method: method,
      payment_reference: (input.payment_reference || input.paymentReference || '').trim() || null,
      note: (input.note || '').trim() || null,
      currency: 'TWD',
      status: 'draft',
      created_by: targetUserId,
      created_at: now,
      posted_by: null,
      posted_at: null,
      cancelled_by: null,
      cancelled_at: null,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      task_id: null
    };

    mockVendorPayments.push(newPayment);
    saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    return formatMockVendorPayment(newPayment).detail;
  },

  update_vendor_payment_header: async (args) => {
    const input = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const pid = String(input.id || input.payment_id || input.paymentId || '').trim();
    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'draft') {
      throw new Error(`付款單狀態為 ${payment.status}，不可修改`);
    }

    const method = String(input.payment_method || input.paymentMethod || '').trim();
    if (!['bank_transfer', 'cash', 'check', 'other'].includes(method)) {
      throw new Error('付款方式無效，僅支援 bank_transfer、cash、check、other');
    }

    const payDate = String(input.payment_date || input.paymentDate || '').trim();
    const today = new Date().toISOString().slice(0, 10);
    if (payDate > today) {
      throw new Error('付款日不可晚於今天');
    }

    // Check date against all allocations
    const allocs = (mockVendorPaymentAllocations || []).filter(a => a.payment_id === pid && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    for (const a of allocs) {
      const ap = (mockAccountsPayable || []).find(ap => ap.id === a.account_payable_id && (ap.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (ap && payDate < ap.document_date) {
        throw new Error(`付款日不可早於〔${ap.source_number}〕的單據日`);
      }
    }

    payment.payment_date = payDate;
    payment.payment_method = method;
    payment.payment_reference = (input.payment_reference || input.paymentReference || '').trim() || null;
    payment.note = (input.note || '').trim() || null;

    saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    return formatMockVendorPayment(payment).detail;
  },

  add_vendor_payment_allocation: async (args) => {
    const input = args?.input || args || {};
    const { payment_id, paymentId, account_payable_id, accountPayableId, amount } = input;
    const targetTenantId = resolveMockActiveTenantId();
    const pid = String(payment_id || paymentId || '').trim();
    const apId = String(account_payable_id || accountPayableId || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'draft') {
      throw new Error(`付款單狀態為 ${payment.status}，不可修改`);
    }

    const existingAlloc = (mockVendorPaymentAllocations || []).find(a => a.payment_id === pid && a.account_payable_id === apId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (existingAlloc) {
      throw new Error('同一張付款單內同一筆應付只能出現一次');
    }

    const ap = (mockAccountsPayable || []).find(a => a.id === apId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ap || ap.status !== 'open' || ap.vendor_partner_id !== payment.vendor_partner_id) {
      throw new Error('僅能核銷同一供應商的未作廢應付');
    }

    if (payment.payment_date < ap.document_date) {
      throw new Error(`付款日不可早於〔${ap.source_number}〕的單據日`);
    }

    const rawAmount = Number(amount);
    const roundedAmount = Math.round(rawAmount * 100) / 100;
    if (isNaN(roundedAmount) || roundedAmount <= 0) {
      throw new Error('核銷金額必須大於 0');
    }

    // Compute outstanding from posted allocations only
    const allPostedAllocations = (mockVendorPaymentAllocations || [])
      .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId);

    let postedSum = 0;
    for (const pa of allPostedAllocations) {
      const isPosted = (mockVendorPayments || []).some(p => p.id === pa.payment_id && p.status === 'posted');
      if (isPosted) {
        postedSum += Number(pa.amount);
      }
    }
    const outstanding = Math.max(0, Math.round((Number(ap.amount) - postedSum) * 100) / 100);
    if (roundedAmount > Math.round((outstanding + 1e-6) * 100) / 100) {
      const outStr = (outstanding % 1 === 0) ? String(outstanding) : outstanding.toFixed(2);
      const amtStr = (roundedAmount % 1 === 0) ? String(roundedAmount) : roundedAmount.toFixed(2);
      throw new Error(`核銷金額 ${amtStr} 超過〔${ap.source_number}〕未付餘額 ${outStr}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const newAlloc = {
      id: `paya_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
      tenant_id: targetTenantId,
      payment_id: pid,
      account_payable_id: apId,
      amount: roundedAmount,
      created_at: now
    };

    mockVendorPaymentAllocations.push(newAlloc);
    saveStorage('agent_erp_mock_vendor_payment_allocations', mockVendorPaymentAllocations);
    return formatMockVendorPayment(payment).detail;
  },

  update_vendor_payment_allocation: async (args) => {
    const input = args?.input || args || {};
    const { payment_id, paymentId, allocation_id, allocationId, amount } = input;
    const targetTenantId = resolveMockActiveTenantId();
    const pid = String(payment_id || paymentId || '').trim();
    const allocId = String(allocation_id || allocationId || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'draft') {
      throw new Error(`付款單狀態為 ${payment.status}，不可修改`);
    }

    const alloc = (mockVendorPaymentAllocations || []).find(a => a.id === allocId && a.payment_id === pid && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!alloc) {
      throw new Error('找不到指定的核銷記錄');
    }

    const ap = (mockAccountsPayable || []).find(a => a.id === alloc.account_payable_id && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ap) {
      throw new Error('僅能核銷同一供應商的未作廢應付');
    }

    const rawAmount = Number(amount);
    const roundedAmount = Math.round(rawAmount * 100) / 100;
    if (isNaN(roundedAmount) || roundedAmount <= 0) {
      throw new Error('核銷金額必須大於 0');
    }

    const allPostedAllocations = (mockVendorPaymentAllocations || [])
      .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId);

    let postedSum = 0;
    for (const pa of allPostedAllocations) {
      const isPosted = (mockVendorPayments || []).some(p => p.id === pa.payment_id && p.status === 'posted');
      if (isPosted) {
        postedSum += Number(pa.amount);
      }
    }
    const outstanding = Math.max(0, Math.round((Number(ap.amount) - postedSum) * 100) / 100);
    if (roundedAmount > Math.round((outstanding + 1e-6) * 100) / 100) {
      const outStr = (outstanding % 1 === 0) ? String(outstanding) : outstanding.toFixed(2);
      const amtStr = (roundedAmount % 1 === 0) ? String(roundedAmount) : roundedAmount.toFixed(2);
      throw new Error(`核銷金額 ${amtStr} 超過〔${ap.source_number}〕未付餘額 ${outStr}`);
    }

    alloc.amount = roundedAmount;
    saveStorage('agent_erp_mock_vendor_payment_allocations', mockVendorPaymentAllocations);
    return formatMockVendorPayment(payment).detail;
  },

  remove_vendor_payment_allocation: async (args) => {
    const input = args?.input || args || {};
    const { payment_id, paymentId, allocation_id, allocationId } = input;
    const targetTenantId = resolveMockActiveTenantId();
    const pid = String(payment_id || paymentId || '').trim();
    const allocId = String(allocation_id || allocationId || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'draft') {
      throw new Error(`付款單狀態為 ${payment.status}，不可修改`);
    }

    const allocIndex = (mockVendorPaymentAllocations || []).findIndex(a => a.id === allocId && a.payment_id === pid && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (allocIndex === -1) {
      throw new Error('找不到指定的核銷記錄');
    }

    mockVendorPaymentAllocations.splice(allocIndex, 1);
    saveStorage('agent_erp_mock_vendor_payment_allocations', mockVendorPaymentAllocations);
    return formatMockVendorPayment(payment).detail;
  },

  post_vendor_payment: async (args) => {
    const { payment_id, paymentId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const pid = String(payment_id || paymentId || id || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${payment.status} 轉換至 posted`);
    }

    const allocs = (mockVendorPaymentAllocations || []).filter(a => a.payment_id === pid && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (allocs.length === 0) {
      throw new Error('付款單至少需有 1 筆核銷方可過帳');
    }

    const today = new Date().toISOString().slice(0, 10);
    if (payment.payment_date > today) {
      throw new Error('付款日不可晚於今天');
    }

    // Re-check each allocation atomically
    for (const a of allocs) {
      const ap = (mockAccountsPayable || []).find(ap => ap.id === a.account_payable_id && (ap.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!ap || ap.status !== 'open' || ap.vendor_partner_id !== payment.vendor_partner_id) {
        throw new Error('僅能核銷同一供應商的未作廢應付');
      }
      if (payment.payment_date < ap.document_date) {
        throw new Error(`付款日不可早於〔${ap.source_number}〕的單據日`);
      }

      const allPostedAllocations = (mockVendorPaymentAllocations || [])
        .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId);

      let postedSum = 0;
      for (const pa of allPostedAllocations) {
        const isPosted = (mockVendorPayments || []).some(p => p.id === pa.payment_id && p.status === 'posted');
        if (isPosted) {
          postedSum += Number(pa.amount);
        }
      }
      const outstanding = Math.max(0, Math.round((Number(ap.amount) - postedSum) * 100) / 100);
      if (Number(a.amount) > Math.round((outstanding + 1e-6) * 100) / 100) {
        const outStr = (outstanding % 1 === 0) ? String(outstanding) : outstanding.toFixed(2);
        const amtStr = (Number(a.amount) % 1 === 0) ? String(Number(a.amount)) : Number(a.amount).toFixed(2);
        throw new Error(`〔${ap.source_number}〕未付餘額已變為 ${outStr}，不足核銷 ${amtStr}`);
      }
    }

    payment.status = 'posted';
    payment.posted_by = targetUserId;
    payment.posted_at = Math.floor(Date.now() / 1000);

    saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    return formatMockVendorPayment(payment).detail;
  },

  cancel_vendor_payment: async (args) => {
    const { payment_id, paymentId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const pid = String(payment_id || paymentId || id || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${payment.status} 轉換至 cancelled`);
    }

    payment.status = 'cancelled';
    payment.cancelled_by = targetUserId;
    payment.cancelled_at = Math.floor(Date.now() / 1000);

    saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    return formatMockVendorPayment(payment).detail;
  },

  void_vendor_payment: async (args) => {
    const { payment_id, paymentId, id, void_reason, voidReason } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const pid = String(payment_id || paymentId || id || '').trim();
    const reason = String(void_reason || voidReason || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    if (payment.status !== 'posted') {
      throw new Error(`無效的狀態轉換：不可從 ${payment.status} 轉換至 voided`);
    }
    if (!reason) {
      throw new Error('作廢需填寫原因');
    }

    payment.status = 'voided';
    payment.voided_by = targetUserId;
    payment.voided_at = Math.floor(Date.now() / 1000);
    payment.void_reason = reason;

    saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    return formatMockVendorPayment(payment).detail;
  },

  get_vendor_payment: async (args) => {
    const { payment_id, paymentId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const pid = String(payment_id || paymentId || id || '').trim();

    const payment = (mockVendorPayments || []).find(p => p.id === pid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!payment) {
      throw new Error('找不到指定的付款單');
    }
    return formatMockVendorPayment(payment).detail;
  },

  list_vendor_payments: async (args) => {
    const filter = args?.filter || args || {};
    const { vendor_partner_id, vendorPartnerId, status, payment_date_from, paymentDateFrom, payment_date_to, paymentDateTo } = filter;
    const targetTenantId = resolveMockActiveTenantId();
    let list = (mockVendorPayments || []).filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);

    const vp = vendor_partner_id || vendorPartnerId;
    if (vp && String(vp).trim()) {
      list = list.filter(p => p.vendor_partner_id === String(vp).trim());
    }
    if (status && String(status).trim()) {
      list = list.filter(p => p.status === String(status).trim());
    }
    const df = payment_date_from || paymentDateFrom;
    if (df && String(df).trim()) {
      list = list.filter(p => p.payment_date >= String(df).trim());
    }
    const dt = payment_date_to || paymentDateTo;
    if (dt && String(dt).trim()) {
      list = list.filter(p => p.payment_date <= String(dt).trim());
    }

    return list
      .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '') || b.created_at - a.created_at)
      .map(p => formatMockVendorPayment(p).item);
  },

  reset_mock_vendor_payments: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockVendorPayments = (mockVendorPayments || []).filter(p => (p.tenant_id || 'tnt_mock_1') !== targetTid);
      mockVendorPaymentAllocations = (mockVendorPaymentAllocations || []).filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTid);
    } else {
      mockVendorPayments = [];
      mockVendorPaymentAllocations = [];
    }
    saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    saveStorage('agent_erp_mock_vendor_payment_allocations', mockVendorPaymentAllocations);
    return true;
  },

  inject_mock_payment_allocation: async (args) => {
    const { payment, allocation } = args || {};
    if (payment) {
      const normalizedPayment = {
        vendor_partner_id: 'vnd_mock_1',
        vendor_name_snapshot: 'Mock Vendor',
        payment_date: '2026-01-10',
        payment_method: 'bank_transfer',
        payment_reference: null,
        note: null,
        currency: 'TWD',
        created_by: 'usr_mock_1',
        created_at: Math.floor(Date.now() / 1000),
        ...payment
      };
      mockVendorPayments.push(normalizedPayment);
      saveStorage('agent_erp_mock_vendor_payments', mockVendorPayments);
    }
    if (allocation) {
      const normalizedAlloc = {
        created_at: Math.floor(Date.now() / 1000),
        ...allocation
      };
      mockVendorPaymentAllocations.push(normalizedAlloc);
      saveStorage('agent_erp_mock_vendor_payment_allocations', mockVendorPaymentAllocations);
    }
    return true;
  }
};
