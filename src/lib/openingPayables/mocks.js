// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import { mockPurchaseOrders } from '../purchaseOrders/mocks.js';
import { mockAccountsPayable } from '../accountsPayable/mocks.js';
import {
  mockPaymentAllocations,
  mockVendorPaymentAllocations,
  mockPayments,
  mockVendorPayments
} from '../vendorPayments/mocks.js';

export let mockOpeningPayables = loadStorage('agent_erp_mock_opening_payables', []);
if (!mockOpeningPayables || !Array.isArray(mockOpeningPayables)) {
  mockOpeningPayables = [];
  saveStorage('agent_erp_mock_opening_payables', mockOpeningPayables);
}

export const openingPayableMocks = {
  create_opening_payable: async (args) => {
    const input = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();

    // OB-01: active tenant
    const tenants = loadStorage('agent_erp_mock_tenants', []);
    const activeTenant = (tenants || []).find(t => t.id === targetTenantId);
    if (activeTenant && activeTenant.status && activeTenant.status !== 'active') {
      throw new Error('租戶未啟用或已停用');
    }

    const origRef = String(input.original_reference || input.originalReference || '').trim();
    if (!origRef) {
      throw new Error('原單號或發票號不可為空');
    }

    const docDate = String(input.document_date || input.documentDate || '').trim();
    const dueDate = String(input.due_date || input.dueDate || '').trim();
    if (!docDate || !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
      throw new Error('日期格式需為 YYYY-MM-DD');
    }
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error('日期格式需為 YYYY-MM-DD');
    }

    const amount = Number(input.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('未付金額必須大於 0');
    }

    // OB-02: doc_date <= today
    const today = new Date().toISOString().slice(0, 10);
    if (docDate > today) {
      throw new Error('單據日不可晚於今天');
    }

    // OB-02: due_date >= doc_date
    if (dueDate < docDate) {
      throw new Error('到期日不可早於單據日');
    }

    // OB-02: vendor check
    const vId = String(input.vendor_partner_id || input.vendorPartnerId || '').trim();
    const vendor = (mockPartners || []).find(p => p.id === vId && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!vendor) {
      throw new Error('找不到指定的供應商');
    }
    if (!vendor.is_vendor) {
      throw new Error('指定夥伴不是供應商');
    }
    if (vendor.is_active === false) {
      throw new Error('指定供應商已停用');
    }

    // OB-03: First PO date boundary
    const vendorPos = (mockPurchaseOrders || [])
      .filter(po => (po.tenant_id || 'tnt_mock_1') === targetTenantId && po.vendor_partner_id === vId)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || (a.po_number || '').localeCompare(b.po_number || ''));

    if (vendorPos.length > 0) {
      const firstPo = vendorPos[0];
      const d = new Date((firstPo.created_at || 0) * 1000);
      const poDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (docDate >= poDate) {
        throw new Error(`期初應付的單據日須早於此供應商在系統中的第一張採購單（${firstPo.po_number || firstPo.id}，${poDate}）；導入後的欠款請走請款單`);
      }
    }

    // OB-04: Duplicate reference check
    const existing = (mockOpeningPayables || []).find(
      o => (o.tenant_id || 'tnt_mock_1') === targetTenantId &&
           o.vendor_partner_id === vId &&
           o.status !== 'voided' &&
           String(o.original_reference || '').trim().toLowerCase() === origRef.toLowerCase()
    );
    if (existing) {
      throw new Error(`此供應商的期初單號 ${origRef} 已登錄於 ${existing.opening_number}`);
    }

    const tenantOaps = (mockOpeningPayables || []).filter(o => (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    const maxSeq = tenantOaps.reduce((max, o) => {
      const match = (o.opening_number || '').match(/OAP-(\d+)/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const openingNumber = `OAP-${String(maxSeq + 1).padStart(5, '0')}`;
    const now = Math.floor(Date.now() / 1000);
    const oapId = `oap_${now}_${Math.floor(Math.random() * 1000)}`;

    const oap = {
      id: oapId,
      tenant_id: targetTenantId,
      opening_number: openingNumber,
      vendor_partner_id: vId,
      vendor_name_snapshot: vendor.name,
      original_reference: origRef,
      document_date: docDate,
      due_date: dueDate,
      amount: Math.round(amount * 100) / 100,
      note: input.note ? String(input.note).trim() : null,
      status: 'open',
      created_by: targetUserId,
      created_at: now,
      voided_by: null,
      voided_at: null,
      void_reason: null
    };

    const apId = `ap_oap_${now}_${Math.floor(Math.random() * 1000)}`;
    const ap = {
      id: apId,
      tenant_id: targetTenantId,
      vendor_partner_id: vId,
      vendor_name_snapshot: vendor.name,
      source_type: 'opening_balance',
      source_id: oapId,
      source_number: openingNumber,
      external_reference: origRef,
      document_date: docDate,
      due_date: dueDate,
      amount: oap.amount,
      currency: 'TWD',
      status: 'open',
      created_by: targetUserId,
      created_at: now,
      voided_by: null,
      voided_at: null,
      void_reason: null
    };

    mockOpeningPayables.push(oap);
    mockAccountsPayable.push(ap);
    saveStorage('agent_erp_mock_opening_payables', mockOpeningPayables);
    saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);

    return {
      opening_payable: oap,
      account_payable_id: apId
    };
  },

  void_opening_payable: async (args) => {
    const { id, opening_payable_id, openingPayableId, void_reason, voidReason } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();

    const oId = id || opening_payable_id || openingPayableId;
    if (!oId || !String(oId).trim()) throw new Error('缺少期初應付帳款 ID');

    const oap = (mockOpeningPayables || []).find(o => o.id === String(oId).trim() && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!oap) throw new Error('找不到指定的期初應付帳款');
    if (oap.status !== 'open') {
      throw new Error(`無效的狀態轉換：不可從 ${oap.status} 轉換至 voided`);
    }

    const reason = void_reason || voidReason;
    if (!reason || !String(reason).trim()) {
      throw new Error('原因必填');
    }

    const ap = (mockAccountsPayable || []).find(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId && a.source_type === 'opening_balance' && a.source_id === oap.id && a.status === 'open');
    if (ap) {
      const allAllocations = [...(mockPaymentAllocations || []), ...(mockVendorPaymentAllocations || [])];
      const allPayments = [...(mockPayments || []), ...(mockVendorPayments || [])];
      const apAllocations = allAllocations
        .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      for (const pa of apAllocations) {
        const p = allPayments.find(pay => pay.id === pa.payment_id && (pay.tenant_id || 'tnt_mock_1') === targetTenantId && pay.status === 'posted');
        if (p) {
          throw new Error(`此期初應付已有付款核銷：${p.payment_number}，請先作廢付款單`);
        }
      }
      ap.status = 'voided';
      ap.voided_by = targetUserId;
      ap.voided_at = Math.floor(Date.now() / 1000);
      ap.void_reason = String(reason).trim();
      saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
    }

    oap.status = 'voided';
    oap.voided_by = targetUserId;
    oap.voided_at = Math.floor(Date.now() / 1000);
    oap.void_reason = String(reason).trim();
    saveStorage('agent_erp_mock_opening_payables', mockOpeningPayables);

    return {
      opening_payable: oap,
      account_payable_id: ap ? ap.id : null
    };
  },

  list_opening_payables: async (args) => {
    const { vendor_partner_id, vendorPartnerId, status } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = (mockOpeningPayables || []).filter(o => (o.tenant_id || 'tnt_mock_1') === targetTenantId);
    const vp = vendor_partner_id || vendorPartnerId;
    if (vp && String(vp).trim()) {
      list = list.filter(o => o.vendor_partner_id === String(vp).trim());
    }
    if (status && String(status).trim()) {
      list = list.filter(o => o.status === String(status).trim());
    }
    return list
      .sort((a, b) => (b.opening_number || '').localeCompare(a.opening_number || '') || b.created_at - a.created_at)
      .map(o => ({
        id: o.id,
        opening_number: o.opening_number,
        vendor_partner_id: o.vendor_partner_id,
        vendor_name_snapshot: o.vendor_name_snapshot,
        original_reference: o.original_reference,
        document_date: o.document_date,
        due_date: o.due_date,
        amount: o.amount,
        status: o.status,
        note: o.note,
        created_at: o.created_at,
        voided_at: o.voided_at,
        void_reason: o.void_reason
      }));
  },

  reset_mock_opening_payables: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockOpeningPayables = (mockOpeningPayables || []).filter(o => (o.tenant_id || 'tnt_mock_1') !== targetTid);
    } else {
      mockOpeningPayables = [];
    }
    saveStorage('agent_erp_mock_opening_payables', mockOpeningPayables);
    return true;
  }
};
