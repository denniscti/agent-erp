// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import {
  mockAccountsReceivable,
  mockCustomerReceipts,
  mockCustomerReceiptAllocations,
  formatMockAccountReceivable
} from '../accountsReceivable/mocks.js';

export { mockCustomerReceipts, mockCustomerReceiptAllocations };

export function formatMockCustomerReceipt(rcpt) {
  const targetTenantId = rcpt.tenant_id || 'tnt_mock_1';
  const allocations = (mockCustomerReceiptAllocations || [])
    .filter(a => a.receipt_id === rcpt.id && (a.tenant_id || 'tnt_mock_1') === targetTenantId)
    .map(a => {
      const ar = (mockAccountsReceivable || []).find(ar => ar.id === a.account_receivable_id && (ar.tenant_id || 'tnt_mock_1') === targetTenantId) || {};
      return {
        id: a.id,
        receipt_id: a.receipt_id,
        account_receivable_id: a.account_receivable_id,
        amount: Math.round(Number(a.amount) * 100) / 100,
        created_at: a.created_at,
        source_type: ar.source_type || '',
        source_id: ar.source_id || '',
        source_number: ar.source_number || '',
        external_reference: ar.external_reference || null,
        document_date: ar.document_date || '',
        due_date: ar.due_date || '',
        ar_amount: Math.round(Number(ar.amount || 0) * 100) / 100,
      };
    });

  let total_amount = 0;
  for (const a of allocations) {
    total_amount += a.amount;
  }
  total_amount = Math.round(total_amount * 100) / 100;

  const detail = {
    ...rcpt,
    total_amount,
    allocations,
  };

  const item = {
    ...rcpt,
    total_amount,
    allocation_count: allocations.length,
  };

  return { detail, item };
}

export const customerReceiptMocks = {
  create_customer_receipt: async (args) => {
    const input = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();

    const tenants = loadStorage('agent_erp_mock_tenants', []);
    const activeTenant = (tenants || []).find(t => t.id === targetTenantId);
    if (activeTenant && activeTenant.status && activeTenant.status !== 'active') {
      throw new Error('租戶未啟用或已停用');
    }

    const method = String(input.receipt_method || input.receiptMethod || '').trim();
    if (!['bank_transfer', 'cash', 'check', 'other'].includes(method)) {
      throw new Error('收款方式無效，僅支援 bank_transfer、cash、check、other');
    }

    const customerId = String(input.customer_partner_id || input.customerPartnerId || '').trim();
    if (!customerId) {
      throw new Error('找不到指定的客戶');
    }
    const customer = (mockPartners || []).find(p => p.id === customerId && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!customer) {
      throw new Error('找不到指定的客戶');
    }
    if (customer.is_customer !== 1 && customer.is_customer !== true) {
      throw new Error('指定夥伴不是客戶');
    }
    if (customer.is_active === 0 || customer.is_active === false) {
      throw new Error('指定客戶已停用');
    }

    const rcptDate = String(input.receipt_date || input.receiptDate || '').trim();
    const today = new Date().toISOString().slice(0, 10);
    if (rcptDate > today) {
      throw new Error('收款日不可晚於今天');
    }

    const now = Math.floor(Date.now() / 1000);
    const tenantReceipts = (mockCustomerReceipts || []).filter(r => (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    let maxSeq = 0;
    for (const r of tenantReceipts) {
      const m = (r.receipt_number || '').match(/^RCPT-(\d+)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
    const nextNum = `RCPT-${String(maxSeq + 1).padStart(5, '0')}`;
    const newReceipt = {
      id: `rcpt_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
      tenant_id: targetTenantId,
      receipt_number: nextNum,
      customer_partner_id: customerId,
      customer_name_snapshot: customer.name,
      receipt_date: rcptDate,
      receipt_method: method,
      receipt_reference: (input.receipt_reference || input.receiptReference || '').trim() || null,
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
      task_id: null,
    };

    mockCustomerReceipts.push(newReceipt);
    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    return formatMockCustomerReceipt(newReceipt).detail;
  },

  update_customer_receipt_header: async (args) => {
    const input = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const rid = String(input.id || input.receipt_id || input.receiptId || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status !== 'draft') {
      throw new Error(`收款單狀態為 ${rcpt.status}，不可修改`);
    }

    const method = String(input.receipt_method || input.receiptMethod || '').trim();
    if (!['bank_transfer', 'cash', 'check', 'other'].includes(method)) {
      throw new Error('收款方式無效，僅支援 bank_transfer、cash、check、other');
    }

    const rcptDate = String(input.receipt_date || input.receiptDate || '').trim();
    const today = new Date().toISOString().slice(0, 10);
    if (rcptDate > today) {
      throw new Error('收款日不可晚於今天');
    }

    rcpt.receipt_date = rcptDate;
    rcpt.receipt_method = method;
    rcpt.receipt_reference = (input.receipt_reference || input.receiptReference || '').trim() || null;
    rcpt.note = (input.note || '').trim() || null;

    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  add_customer_receipt_allocation: async (args) => {
    const { receipt_id, receiptId, account_receivable_id, accountReceivableId, amount } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const rid = String(receipt_id || receiptId || '').trim();
    const arId = String(account_receivable_id || accountReceivableId || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status !== 'draft') {
      throw new Error(`收款單狀態為 ${rcpt.status}，不可修改`);
    }

    const exists = (mockCustomerReceiptAllocations || []).some(
      a => a.receipt_id === rid && a.account_receivable_id === arId && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (exists) {
      throw new Error('同一張收款單內同一筆應收只能出現一次');
    }

    const ar = (mockAccountsReceivable || []).find(a => a.id === arId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ar) {
      throw new Error('找不到指定的應收帳款');
    }
    if (ar.status !== 'open' || ar.customer_partner_id !== rcpt.customer_partner_id) {
      throw new Error('僅能核銷同一客戶的未作廢應收');
    }

    const arDetail = formatMockAccountReceivable(ar).detail;
    const outstanding = arDetail.outstanding_amount;
    const roundedAmount = Math.round(Number(amount) * 100) / 100;

    if (roundedAmount <= 0) {
      throw new Error('核銷金額必須大於 0');
    }
    if (roundedAmount > Math.round((outstanding + 1e-6) * 100) / 100) {
      const fmtAmt = roundedAmount % 1 === 0 ? String(Math.round(roundedAmount)) : roundedAmount.toFixed(2);
      const fmtOut = outstanding % 1 === 0 ? String(Math.round(outstanding)) : outstanding.toFixed(2);
      throw new Error(`核銷金額 ${fmtAmt} 超過〔${ar.source_number || ar.id}〕未收餘額 ${fmtOut}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const newAlloc = {
      id: `rcpta_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
      tenant_id: targetTenantId,
      receipt_id: rid,
      account_receivable_id: arId,
      amount: roundedAmount,
      created_at: now,
    };

    mockCustomerReceiptAllocations.push(newAlloc);
    saveStorage('agent_erp_mock_customer_receipt_allocations', mockCustomerReceiptAllocations);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  update_customer_receipt_allocation: async (args) => {
    const { receipt_id, receiptId, allocation_id, allocationId, amount } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const rid = String(receipt_id || receiptId || '').trim();
    const allocId = String(allocation_id || allocationId || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status !== 'draft') {
      throw new Error(`收款單狀態為 ${rcpt.status}，不可修改`);
    }

    const alloc = (mockCustomerReceiptAllocations || []).find(
      a => a.id === allocId && a.receipt_id === rid && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!alloc) {
      throw new Error('找不到指定的核銷記錄');
    }

    const ar = (mockAccountsReceivable || []).find(a => a.id === alloc.account_receivable_id && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!ar) {
      throw new Error('找不到指定的應收帳款');
    }

    const arDetail = formatMockAccountReceivable(ar).detail;
    const outstanding = arDetail.outstanding_amount;
    const roundedAmount = Math.round(Number(amount) * 100) / 100;

    if (roundedAmount <= 0) {
      throw new Error('核銷金額必須大於 0');
    }
    if (roundedAmount > Math.round((outstanding + 1e-6) * 100) / 100) {
      const fmtAmt = roundedAmount % 1 === 0 ? String(Math.round(roundedAmount)) : roundedAmount.toFixed(2);
      const fmtOut = outstanding % 1 === 0 ? String(Math.round(outstanding)) : outstanding.toFixed(2);
      throw new Error(`核銷金額 ${fmtAmt} 超過〔${ar.source_number || ar.id}〕未收餘額 ${fmtOut}`);
    }

    alloc.amount = roundedAmount;
    saveStorage('agent_erp_mock_customer_receipt_allocations', mockCustomerReceiptAllocations);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  remove_customer_receipt_allocation: async (args) => {
    const { receipt_id, receiptId, allocation_id, allocationId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const rid = String(receipt_id || receiptId || '').trim();
    const allocId = String(allocation_id || allocationId || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status !== 'draft') {
      throw new Error(`收款單狀態為 ${rcpt.status}，不可修改`);
    }

    const idx = (mockCustomerReceiptAllocations || []).findIndex(
      a => a.id === allocId && a.receipt_id === rid && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (idx === -1) {
      throw new Error('找不到指定的核銷記錄');
    }

    mockCustomerReceiptAllocations.splice(idx, 1);
    saveStorage('agent_erp_mock_customer_receipt_allocations', mockCustomerReceiptAllocations);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  post_customer_receipt: async (args) => {
    const { receipt_id, receiptId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const rid = String(receipt_id || receiptId || id || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status === 'posted') {
      throw new Error('無效的狀態轉換：不可從 posted 轉換至 posted');
    }
    if (rcpt.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${rcpt.status} 轉換至 posted`);
    }

    const today = new Date().toISOString().slice(0, 10);
    if (rcpt.receipt_date > today) {
      throw new Error('收款日不可晚於今天');
    }

    const allocs = (mockCustomerReceiptAllocations || []).filter(
      a => a.receipt_id === rid && (a.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (allocs.length === 0) {
      throw new Error('收款單至少需有 1 筆核銷方可過帳');
    }

    for (const a of allocs) {
      const ar = (mockAccountsReceivable || []).find(ar => ar.id === a.account_receivable_id && (ar.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!ar || ar.status !== 'open' || ar.customer_partner_id !== rcpt.customer_partner_id) {
        throw new Error('僅能核銷同一客戶的未作廢應收');
      }
      if (rcpt.receipt_date < (ar.document_date || '')) {
        throw new Error(`收款日不可早於〔${ar.source_number || ar.id}〕的單據日`);
      }
      const arDetail = formatMockAccountReceivable(ar).detail;
      const outstanding = arDetail.outstanding_amount;
      const allocAmt = Math.round(Number(a.amount) * 100) / 100;
      if (allocAmt > Math.round((outstanding + 1e-6) * 100) / 100) {
        const fmtOut = outstanding % 1 === 0 ? String(Math.round(outstanding)) : outstanding.toFixed(2);
        const fmtAlloc = allocAmt % 1 === 0 ? String(Math.round(allocAmt)) : allocAmt.toFixed(2);
        throw new Error(`〔${ar.source_number || ar.id}〕未收餘額已變為 ${fmtOut}，不足核銷 ${fmtAlloc}`);
      }
    }

    rcpt.status = 'posted';
    rcpt.posted_by = targetUserId;
    rcpt.posted_at = Math.floor(Date.now() / 1000);

    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  cancel_customer_receipt: async (args) => {
    const { receipt_id, receiptId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const rid = String(receipt_id || receiptId || id || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status === 'cancelled') {
      throw new Error('無效的狀態轉換：不可從 cancelled 轉換至 cancelled');
    }
    if (rcpt.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${rcpt.status} 轉換至 cancelled`);
    }

    rcpt.status = 'cancelled';
    rcpt.cancelled_by = targetUserId;
    rcpt.cancelled_at = Math.floor(Date.now() / 1000);

    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  void_customer_receipt: async (args) => {
    const { receipt_id, receiptId, id, void_reason, voidReason } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const rid = String(receipt_id || receiptId || id || '').trim();
    const reason = String(void_reason || voidReason || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    if (rcpt.status === 'voided') {
      throw new Error('無效的狀態轉換：不可從 voided 轉換至 voided');
    }
    if (rcpt.status !== 'posted') {
      throw new Error(`無效的狀態轉換：不可從 ${rcpt.status} 轉換至 voided`);
    }
    if (!reason) {
      throw new Error('作廢需填寫原因');
    }

    rcpt.status = 'voided';
    rcpt.voided_by = targetUserId;
    rcpt.voided_at = Math.floor(Date.now() / 1000);
    rcpt.void_reason = reason;

    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    return formatMockCustomerReceipt(rcpt).detail;
  },

  get_customer_receipt: async (args) => {
    const { receipt_id, receiptId, id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const rid = String(receipt_id || receiptId || id || '').trim();

    const rcpt = (mockCustomerReceipts || []).find(r => r.id === rid && (r.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!rcpt) {
      throw new Error('找不到指定的收款單');
    }
    return formatMockCustomerReceipt(rcpt).detail;
  },

  list_customer_receipts: async (args) => {
    const filter = args?.filter || args || {};
    const { customer_partner_id, customerPartnerId, status, receipt_method, receiptMethod, start_date, startDate, end_date, endDate } = filter;
    const targetTenantId = resolveMockActiveTenantId();
    let list = (mockCustomerReceipts || []).filter(r => (r.tenant_id || 'tnt_mock_1') === targetTenantId);

    const cid = customer_partner_id || customerPartnerId;
    if (cid && String(cid).trim()) {
      list = list.filter(r => r.customer_partner_id === String(cid).trim());
    }
    if (status && String(status).trim()) {
      list = list.filter(r => r.status === String(status).trim());
    }
    const rm = receipt_method || receiptMethod;
    if (rm && String(rm).trim()) {
      list = list.filter(r => r.receipt_method === String(rm).trim());
    }
    const df = start_date || startDate;
    if (df && String(df).trim()) {
      list = list.filter(r => r.receipt_date >= String(df).trim());
    }
    const dt = end_date || endDate;
    if (dt && String(dt).trim()) {
      list = list.filter(r => r.receipt_date <= String(dt).trim());
    }

    return list
      .sort((a, b) => (b.receipt_date || '').localeCompare(a.receipt_date || '') || b.created_at - a.created_at)
      .map(r => formatMockCustomerReceipt(r).item);
  },

  reset_mock_customer_receipts: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      const remainingRcpts = (mockCustomerReceipts || []).filter(r => (r.tenant_id || 'tnt_mock_1') !== targetTid);
      mockCustomerReceipts.length = 0;
      mockCustomerReceipts.push(...remainingRcpts);

      const remainingAllocs = (mockCustomerReceiptAllocations || []).filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTid);
      mockCustomerReceiptAllocations.length = 0;
      mockCustomerReceiptAllocations.push(...remainingAllocs);
    } else {
      mockCustomerReceipts.length = 0;
      mockCustomerReceiptAllocations.length = 0;
    }
    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    saveStorage('agent_erp_mock_customer_receipt_allocations', mockCustomerReceiptAllocations);
    return true;
  }
};

