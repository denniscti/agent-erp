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
  mockPurchaseOrders,
  calculateMockPoOrderedTotal,
  calculateMockPoReceivedTotal
} from '../purchaseOrders/mocks.js';
import {
  mockAccountsPayable,
  formatMockAccountPayable
} from '../accountsPayable/mocks.js';
import {
  mockVendorPaymentAllocations,
  mockVendorPayments
} from '../vendorPayments/mocks.js';
import { calculateDueDate } from '../paymentTerms.js';

export let mockVendorBills = loadStorage('agent_erp_mock_vendor_bills', []);
if (!mockVendorBills || !Array.isArray(mockVendorBills)) {
  mockVendorBills = [];
  saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
}

export let mockVendorBillOrders = loadStorage('agent_erp_mock_vendor_bill_orders', []);
if (!mockVendorBillOrders || !Array.isArray(mockVendorBillOrders)) {
  mockVendorBillOrders = [];
  saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
}

export function nextMockBillNumber(tenantId) {
  const existing = mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const b of existing) {
    if (b.bill_number && b.bill_number.startsWith('BILL-')) {
      const num = parseInt(b.bill_number.substring(5), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `BILL-${String(nextSeq).padStart(5, '0')}`;
}

export function formatMockVendorBill(vb) {
  const untaxed = Math.round(Number(vb.untaxed_amount) * 100) / 100;
  const tax = Math.round(Number(vb.tax_amount) * 100) / 100;
  const total = Math.round((untaxed + tax) * 100) / 100;
  const orders = mockVendorBillOrders.filter(o => o.bill_id === vb.id);

  const bill = {
    id: vb.id,
    tenant_id: vb.tenant_id,
    bill_number: vb.bill_number,
    vendor_partner_id: vb.vendor_partner_id,
    vendor_name_snapshot: vb.vendor_name_snapshot,
    vendor_invoice_number: vb.vendor_invoice_number,
    bill_date: vb.bill_date,
    due_date: vb.due_date,
    untaxed_amount: untaxed,
    tax_amount: tax,
    total_amount: total,
    currency: vb.currency || 'TWD',
    status: vb.status,
    basis_amount: vb.basis_amount !== undefined && vb.basis_amount !== null ? Math.round(Number(vb.basis_amount) * 100) / 100 : null,
    difference_amount: vb.difference_amount !== undefined && vb.difference_amount !== null ? Math.round(Number(vb.difference_amount) * 100) / 100 : null,
    difference_note: vb.difference_note || null,
    difference_accepted_by: vb.difference_accepted_by || null,
    difference_accepted_at: vb.difference_accepted_at || null,
    note: vb.note || null,
    created_by: vb.created_by,
    created_at: vb.created_at,
    posted_at: vb.posted_at || null,
    cancelled_at: vb.cancelled_at || null,
    voided_by: vb.voided_by || null,
    voided_at: vb.voided_at || null,
    void_reason: vb.void_reason || null,
    task_id: vb.task_id || null
  };

  const item = {
    ...bill,
    order_count: orders.length
  };

  const orderInfos = orders.map(o => ({
    id: o.id,
    bill_id: o.bill_id,
    purchase_order_id: o.purchase_order_id,
    po_number_snapshot: o.po_number_snapshot,
    created_at: o.created_at,
    total_amount: calculateMockPoOrderedTotal(o.purchase_order_id),
    received_total_amount: calculateMockPoReceivedTotal(o.purchase_order_id)
  }));

  let payable = null;
  if (vb.status === 'posted' || vb.status === 'voided') {
    const ap = mockAccountsPayable.find(a => (a.tenant_id || 'tnt_mock_1') === (vb.tenant_id || 'tnt_mock_1') && a.source_type === 'vendor_bill' && a.source_id === vb.id);
    if (ap) {
      payable = formatMockAccountPayable(ap).detail;
    }
  }

  return {
    item,
    detail: {
      bill,
      orders: orderInfos,
      payable
    }
  };
}

export const vendorBillMocks = {
  create_vendor_bill: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    if (!targetTenantId || !String(targetTenantId).trim()) {
      throw new Error('租戶 ID 不可為空');
    }
    const vendorId = payload.vendor_partner_id || payload.vendorPartnerId;
    if (!vendorId || !String(vendorId).trim()) {
      throw new Error('供應商 ID 不可為空');
    }
    const invoiceNo = payload.vendor_invoice_number || payload.vendorInvoiceNumber;
    if (!invoiceNo || !String(invoiceNo).trim()) {
      throw new Error('供應商發票號碼不可為空');
    }
    const trimmedInvoice = String(invoiceNo).trim();
    const untaxed = Number(payload.untaxed_amount !== undefined ? payload.untaxed_amount : payload.untaxedAmount);
    if (isNaN(untaxed) || untaxed <= 0) {
      throw new Error('未稅金額必須大於 0');
    }
    const tax = Number(payload.tax_amount !== undefined ? payload.tax_amount : payload.taxAmount);
    if (isNaN(tax) || tax < 0) {
      throw new Error('進項稅額不可小於 0');
    }
    const billDate = String(payload.bill_date || payload.billDate || '').trim();
    if (!billDate) {
      throw new Error('無效的日期格式');
    }
    const today = new Date().toISOString().split('T')[0];
    if (billDate > today) {
      throw new Error('請款日不可晚於今天');
    }

    const vendor = mockPartners.find(p => p.id === String(vendorId).trim() && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!vendor) {
      throw new Error('找不到指定的供應商');
    }
    if (!vendor.is_vendor) {
      throw new Error('指定的合作夥伴不是供應商');
    }

    let dueDate = payload.due_date || payload.dueDate;
    if (dueDate && String(dueDate).trim()) {
      dueDate = String(dueDate).trim();
    } else {
      dueDate = calculateDueDate(billDate, vendor.payment_terms_type, vendor.payment_terms_days);
    }
    if (dueDate < billDate) {
      throw new Error('到期日不可早於請款日');
    }

    const dup = mockVendorBills.find(b =>
      (b.tenant_id || 'tnt_mock_1') === targetTenantId &&
      b.vendor_partner_id === vendor.id &&
      b.vendor_invoice_number.trim().toLowerCase() === trimmedInvoice.toLowerCase() &&
      b.status !== 'cancelled' && b.status !== 'voided'
    );
    if (dup) {
      throw new Error(`此供應商的發票號碼 ${trimmedInvoice} 已登錄於 ${dup.bill_number}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const newBill = {
      id: nextMockUid('bill'),
      tenant_id: targetTenantId,
      bill_number: nextMockBillNumber(targetTenantId),
      vendor_partner_id: vendor.id,
      vendor_name_snapshot: vendor.name,
      vendor_invoice_number: trimmedInvoice,
      bill_date: billDate,
      due_date: dueDate,
      untaxed_amount: untaxed,
      tax_amount: tax,
      currency: 'TWD',
      status: 'draft',
      basis_amount: null,
      difference_amount: null,
      difference_note: null,
      difference_accepted_by: null,
      difference_accepted_at: null,
      note: payload.note ? String(payload.note).trim() : null,
      created_by: targetUserId,
      created_at: now,
      posted_at: null,
      cancelled_at: null,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      task_id: null
    };

    mockVendorBills.push(newBill);
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(newBill).detail;
  },

  update_vendor_bill_header: async (args) => {
    const payload = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const billId = payload.bill_id || payload.billId;
    if (!billId || !String(billId).trim()) {
      throw new Error('請款單 ID 不可為空');
    }
    const bill = mockVendorBills.find(b => b.id === String(billId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) {
      throw new Error('找不到指定的請款單');
    }
    if (bill.status !== 'draft') {
      throw new Error(`請款單狀態為 ${bill.status}，不可修改`);
    }
    const invoiceNo = payload.vendor_invoice_number || payload.vendorInvoiceNumber;
    if (!invoiceNo || !String(invoiceNo).trim()) {
      throw new Error('供應商發票號碼不可為空');
    }
    const trimmedInvoice = String(invoiceNo).trim();
    const untaxed = Number(payload.untaxed_amount !== undefined ? payload.untaxed_amount : payload.untaxedAmount);
    if (isNaN(untaxed) || untaxed <= 0) {
      throw new Error('未稅金額必須大於 0');
    }
    const tax = Number(payload.tax_amount !== undefined ? payload.tax_amount : payload.taxAmount);
    if (isNaN(tax) || tax < 0) {
      throw new Error('進項稅額不可小於 0');
    }
    const billDate = String(payload.bill_date || payload.billDate || '').trim();
    const dueDate = String(payload.due_date || payload.dueDate || '').trim();
    const today = new Date().toISOString().split('T')[0];
    if (billDate > today) {
      throw new Error('請款日不可晚於今天');
    }
    if (dueDate < billDate) {
      throw new Error('到期日不可早於請款日');
    }
    const dup = mockVendorBills.find(b =>
      b.id !== bill.id &&
      (b.tenant_id || 'tnt_mock_1') === targetTenantId &&
      b.vendor_partner_id === bill.vendor_partner_id &&
      b.vendor_invoice_number.trim().toLowerCase() === trimmedInvoice.toLowerCase() &&
      b.status !== 'cancelled' && b.status !== 'voided'
    );
    if (dup) {
      throw new Error(`此供應商的發票號碼 ${trimmedInvoice} 已登錄於 ${dup.bill_number}`);
    }

    bill.vendor_invoice_number = trimmedInvoice;
    bill.bill_date = billDate;
    bill.due_date = dueDate;
    bill.untaxed_amount = untaxed;
    bill.tax_amount = tax;
    bill.note = payload.note ? String(payload.note).trim() : null;
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(bill).detail;
  },

  add_vendor_bill_order: async (args) => {
    const { bill_id, billId, purchase_order_id, purchaseOrderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const bId = bill_id || billId;
    const poId = purchase_order_id || purchaseOrderId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');
    if (!poId || !String(poId).trim()) throw new Error('採購單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'draft') throw new Error(`請款單狀態為 ${bill.status}，不可修改`);

    const po = mockPurchaseOrders.find(p => p.id === String(poId).trim() && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!po || po.status !== 'received' || po.vendor_partner_id !== bill.vendor_partner_id) {
      throw new Error('僅能加入同一供應商且已到貨的採購單');
    }

    const activeCovered = mockVendorBillOrders.find(o => {
      if (o.purchase_order_id !== po.id) return false;
      const coveringBill = mockVendorBills.find(b => b.id === o.bill_id && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      return coveringBill && ['draft', 'disputed', 'posted'].includes(coveringBill.status);
    });
    if (activeCovered) {
      const coveringBill = mockVendorBills.find(b => b.id === activeCovered.bill_id);
      throw new Error(`採購單 ${po.po_number} 已在請款單 ${coveringBill.bill_number} 中`);
    }

    const alreadyInBill = mockVendorBillOrders.some(o => o.bill_id === bill.id && o.purchase_order_id === po.id);
    if (alreadyInBill) {
      throw new Error(`採購單 ${po.po_number} 已在請款單 ${bill.bill_number} 中`);
    }

    const newOrder = {
      id: nextMockUid('billpo'),
      bill_id: bill.id,
      purchase_order_id: po.id,
      po_number_snapshot: po.po_number,
      created_at: Math.floor(Date.now() / 1000)
    };
    mockVendorBillOrders.push(newOrder);
    saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
    return formatMockVendorBill(bill).detail;
  },

  remove_vendor_bill_order: async (args) => {
    const { bill_id, billId, purchase_order_id, purchaseOrderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const bId = bill_id || billId;
    const poId = purchase_order_id || purchaseOrderId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');
    if (!poId || !String(poId).trim()) throw new Error('採購單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'draft') throw new Error(`請款單狀態為 ${bill.status}，不可修改`);

    mockVendorBillOrders = mockVendorBillOrders.filter(o => !(o.bill_id === bill.id && (o.purchase_order_id === poId || o.id === poId)));
    saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
    return formatMockVendorBill(bill).detail;
  },

  post_vendor_bill: async (args) => {
    const { bill_id, billId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const bId = bill_id || billId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'draft') {
      throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 posted`);
    }

    const coveredOrders = mockVendorBillOrders.filter(o => o.bill_id === bill.id);
    if (coveredOrders.length === 0) {
      throw new Error('請款單需至少涵蓋一張採購單');
    }

    let basisAmount = 0;
    for (const o of coveredOrders) {
      basisAmount += calculateMockPoReceivedTotal(o.purchase_order_id);
    }
    basisAmount = Math.round(basisAmount * 100) / 100;
    const diff = Math.round((bill.untaxed_amount - basisAmount) * 100) / 100;
    const isMatched = Math.abs(diff) < 1.0;
    const now = Math.floor(Date.now() / 1000);

    bill.basis_amount = basisAmount;
    bill.difference_amount = diff;

    if (isMatched) {
      bill.status = 'posted';
      bill.posted_at = now;

      const totalAmount = Math.round((bill.untaxed_amount + bill.tax_amount) * 100) / 100;
      const ap = {
        id: nextMockUid('ap'),
        tenant_id: targetTenantId,
        vendor_partner_id: bill.vendor_partner_id,
        vendor_name_snapshot: bill.vendor_name_snapshot,
        source_type: 'vendor_bill',
        source_id: bill.id,
        source_number: bill.bill_number,
        external_reference: bill.vendor_invoice_number,
        document_date: bill.bill_date,
        due_date: bill.due_date,
        amount: totalAmount,
        currency: 'TWD',
        status: 'open',
        created_by: targetUserId,
        created_at: now
      };
      mockAccountsPayable.push(ap);
      saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
    } else {
      bill.status = 'disputed';
    }

    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(bill).detail;
  },

  accept_vendor_bill_difference: async (args) => {
    const { bill_id, billId, difference_note, differenceNote } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const bId = bill_id || billId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'disputed') {
      throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 posted`);
    }

    const note = difference_note || differenceNote;
    if (!note || !String(note).trim()) {
      throw new Error('接受差異需填寫說明');
    }

    const now = Math.floor(Date.now() / 1000);
    bill.status = 'posted';
    bill.difference_note = String(note).trim();
    bill.difference_accepted_by = targetUserId;
    bill.difference_accepted_at = now;
    bill.posted_at = now;

    const totalAmount = Math.round((bill.untaxed_amount + bill.tax_amount) * 100) / 100;
    const ap = {
      id: nextMockUid('ap'),
      tenant_id: targetTenantId,
      vendor_partner_id: bill.vendor_partner_id,
      vendor_name_snapshot: bill.vendor_name_snapshot,
      source_type: 'vendor_bill',
      source_id: bill.id,
      source_number: bill.bill_number,
      external_reference: bill.vendor_invoice_number,
      document_date: bill.bill_date,
      due_date: bill.due_date,
      amount: totalAmount,
      currency: 'TWD',
      status: 'open',
      created_by: targetUserId,
      created_at: now
    };
    mockAccountsPayable.push(ap);
    saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(bill).detail;
  },

  return_vendor_bill_to_draft: async (args) => {
    const { bill_id, billId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const bId = bill_id || billId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'disputed') {
      throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 draft`);
    }

    bill.status = 'draft';
    bill.basis_amount = null;
    bill.difference_amount = null;
    bill.difference_note = null;
    bill.difference_accepted_by = null;
    bill.difference_accepted_at = null;
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(bill).detail;
  },

  cancel_vendor_bill: async (args) => {
    const { bill_id, billId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const bId = bill_id || billId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'draft' && bill.status !== 'disputed') {
      throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 cancelled`);
    }

    bill.status = 'cancelled';
    bill.cancelled_at = Math.floor(Date.now() / 1000);
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(bill).detail;
  },

  void_vendor_bill: async (args) => {
    const { bill_id, billId, void_reason, voidReason } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();
    const bId = bill_id || billId;
    if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

    const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) throw new Error('找不到指定的請款單');
    if (bill.status !== 'posted') {
      throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 voided`);
    }

    const reason = void_reason || voidReason;
    if (!reason || !String(reason).trim()) {
      throw new Error('作廢原因為必填');
    }

    const ap = mockAccountsPayable.find(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId && a.source_type === 'vendor_bill' && a.source_id === bill.id && a.status === 'open');
    if (ap) {
      const apAllocations = (mockVendorPaymentAllocations || [])
        .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      for (const pa of apAllocations) {
        const p = (mockVendorPayments || []).find(pay => pay.id === pa.payment_id && (pay.tenant_id || 'tnt_mock_1') === targetTenantId && pay.status === 'posted');
        if (p) {
          throw new Error(`此請款單已有付款核銷：${p.payment_number}，請先作廢付款單`);
        }
      }
      ap.status = 'voided';
      ap.voided_by = targetUserId;
      ap.voided_at = Math.floor(Date.now() / 1000);
      ap.void_reason = String(reason).trim();
      saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
    }

    bill.status = 'voided';
    bill.voided_by = targetUserId;
    bill.voided_at = Math.floor(Date.now() / 1000);
    bill.void_reason = String(reason).trim();
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    return formatMockVendorBill(bill).detail;
  },

  get_vendor_bill: async (args) => {
    const { id, bill_id, billId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetId = id || bill_id || billId;
    if (!targetId || !String(targetId).trim()) {
      throw new Error('缺少請款單 ID (id 或 bill_id)');
    }
    const bill = mockVendorBills.find(b => b.id === String(targetId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!bill) {
      throw new Error('找不到指定的請款單');
    }
    return formatMockVendorBill(bill).detail;
  },

  list_vendor_bills: async (args) => {
    const { vendor_partner_id, vendorPartnerId, status } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') === targetTenantId);
    const vp = vendor_partner_id || vendorPartnerId;
    if (vp && String(vp).trim()) {
      list = list.filter(b => b.vendor_partner_id === String(vp).trim());
    }
    if (status && String(status).trim()) {
      list = list.filter(b => b.status === String(status).trim());
    }
    return list
      .sort((a, b) => (b.bill_date || '').localeCompare(a.bill_date || '') || b.created_at - a.created_at || (b.bill_number || '').localeCompare(a.bill_number || ''))
      .map(b => formatMockVendorBill(b).item);
  },

  list_unbilled_received_orders: async (args) => {
    const { vendor_partner_id, vendorPartnerId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const vp = vendor_partner_id || vendorPartnerId;

    const activeCoveredPoIds = new Set();
    for (const order of mockVendorBillOrders) {
      const bill = mockVendorBills.find(b => b.id === order.bill_id && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (bill && ['draft', 'disputed', 'posted'].includes(bill.status)) {
        activeCoveredPoIds.add(order.purchase_order_id);
      }
    }

    let list = mockPurchaseOrders.filter(po => (po.tenant_id || 'tnt_mock_1') === targetTenantId && po.status === 'received' && !activeCoveredPoIds.has(po.id));
    if (vp && String(vp).trim()) {
      list = list.filter(po => po.vendor_partner_id === String(vp).trim());
    }

    return list
      .sort((a, b) => (b.received_at || 0) - (a.received_at || 0) || (b.po_number || '').localeCompare(a.po_number || ''))
      .map(po => ({
        purchase_order_id: po.id,
        po_number: po.po_number,
        vendor_partner_id: po.vendor_partner_id,
        vendor_name_snapshot: po.vendor_name_snapshot,
        ordered_at: po.ordered_at || null,
        received_at: po.received_at || null,
        total_amount: calculateMockPoOrderedTotal(po.id),
        received_total_amount: calculateMockPoReceivedTotal(po.id)
      }));
  },

  get_purchase_order_billing_info: async (args) => {
    const { purchase_order_id, purchaseOrderId } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const poid = (purchase_order_id || purchaseOrderId || '').trim();
    if (!poid) return null;

    for (const order of mockVendorBillOrders) {
      if (order.purchase_order_id === poid) {
        const bill = mockVendorBills.find(b => b.id === order.bill_id && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
        if (bill && ['draft', 'disputed', 'posted'].includes(bill.status)) {
          const formatted = formatMockVendorBill(bill);
          return {
            bill_id: bill.id,
            bill_number: bill.bill_number,
            bill_status: bill.status,
            bill_total_amount: formatted.item.total_amount,
            bill_order_count: formatted.item.order_count,
          };
        }
      }
    }
    return null;
  },

  reset_mock_vendor_bills: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      const removedBillIds = new Set(
        mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') === targetTid).map(b => b.id)
      );
      mockVendorBills = mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') !== targetTid);
      mockVendorBillOrders = mockVendorBillOrders.filter(o => !removedBillIds.has(o.bill_id));
    } else {
      mockVendorBills = [];
      mockVendorBillOrders = [];
    }
    saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
    saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
    return true;
  }
};

