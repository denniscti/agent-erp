// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId
} from '../mockStorage.js';

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

  const rawAllowance = 0; // #235 sales allowances default to 0 before completed

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
  }
};

