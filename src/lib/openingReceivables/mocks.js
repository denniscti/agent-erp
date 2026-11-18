// @ts-check
import {
  loadStorage,
  saveStorage,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';
import { mockSalesOrders } from '../salesOrders/mocks.js';
import {
  mockAccountsReceivable,
  mockCustomerReceiptAllocations,
  mockCustomerReceipts
} from '../accountsReceivable/mocks.js';

export let mockOpeningReceivables = loadStorage('agent_erp_mock_opening_receivables', []);
if (!mockOpeningReceivables || !Array.isArray(mockOpeningReceivables)) {
  mockOpeningReceivables = [];
  saveStorage('agent_erp_mock_opening_receivables', mockOpeningReceivables);
}

export const openingReceivableMocks = {
  create_opening_receivable: async (args) => {
    const input = args?.input || args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();

    // OR-02: active tenant
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

    // OR-02: doc_date <= today
    const today = new Date().toISOString().slice(0, 10);
    if (docDate > today) {
      throw new Error('單據日不可晚於今天');
    }

    // OR-02: due_date >= doc_date
    if (dueDate < docDate) {
      throw new Error('到期日不可早於單據日');
    }

    // OR-02: customer check
    const cId = String(input.customer_partner_id || input.customerPartnerId || '').trim();
    const customer = (mockPartners || []).find(
      p => p.id === cId && (p.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!customer) {
      throw new Error('找不到指定的客戶');
    }
    if (!customer.is_customer) {
      throw new Error('指定夥伴不是客戶');
    }
    if (customer.is_active === false) {
      throw new Error('指定客戶已停用');
    }

    // OR-01: First SO date boundary
    const customerSos = (mockSalesOrders || [])
      .filter(
        so =>
          (so.tenant_id || 'tnt_mock_1') === targetTenantId &&
          so.customer_partner_id === cId
      )
      .sort(
        (a, b) =>
          (a.created_at || 0) - (b.created_at || 0) ||
          (a.so_number || '').localeCompare(b.so_number || '')
      );

    if (customerSos.length > 0) {
      const firstSo = customerSos[0];
      const d = new Date((firstSo.created_at || 0) * 1000);
      const soDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (docDate >= soDate) {
        throw new Error(
          `期初應收的單據日須早於此客戶在系統中的第一張銷售單（${firstSo.so_number || firstSo.id}，${soDate}）；導入後的帳款請走客戶帳單`
        );
      }
    }

    // OR-03: Duplicate reference check
    const existing = (mockOpeningReceivables || []).find(
      o =>
        (o.tenant_id || 'tnt_mock_1') === targetTenantId &&
        o.customer_partner_id === cId &&
        o.status !== 'voided' &&
        String(o.original_reference || '').trim().toLowerCase() === origRef.toLowerCase()
    );
    if (existing) {
      throw new Error(
        `此客戶的期初單號 ${origRef} 已登錄於 ${existing.opening_number}`
      );
    }

    const tenantOars = (mockOpeningReceivables || []).filter(
      o => (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    const maxSeq = tenantOars.reduce((max, o) => {
      const match = (o.opening_number || '').match(/OAR-(\d+)/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const openingNumber = `OAR-${String(maxSeq + 1).padStart(5, '0')}`;
    const now = Math.floor(Date.now() / 1000);
    const oarId = `oar_${now}_${Math.floor(Math.random() * 1000)}`;

    const oar = {
      id: oarId,
      tenant_id: targetTenantId,
      opening_number: openingNumber,
      customer_partner_id: cId,
      customer_name_snapshot: customer.name,
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

    const arId = `ar_oar_${now}_${Math.floor(Math.random() * 1000)}`;
    const ar = {
      id: arId,
      tenant_id: targetTenantId,
      customer_partner_id: cId,
      customer_name_snapshot: customer.name,
      source_type: 'opening_balance',
      source_id: oarId,
      source_number: openingNumber,
      external_reference: origRef,
      document_date: docDate,
      due_date: dueDate,
      amount: oar.amount,
      currency: 'TWD',
      status: 'open',
      created_by: targetUserId,
      created_at: now,
      voided_by: null,
      voided_at: null,
      void_reason: null
    };

    mockOpeningReceivables.push(oar);
    mockAccountsReceivable.push(ar);
    saveStorage('agent_erp_mock_opening_receivables', mockOpeningReceivables);
    saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);

    return {
      opening_receivable: oar,
      account_receivable_id: arId
    };
  },

  void_opening_receivable: async (args) => {
    const { id, opening_receivable_id, openingReceivableId, void_reason, voidReason } =
      args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const targetUserId = resolveMockActiveUserId();

    const oId = id || opening_receivable_id || openingReceivableId;
    if (!oId || !String(oId).trim()) throw new Error('缺少期初應收帳款 ID');

    const oar = (mockOpeningReceivables || []).find(
      o => o.id === String(oId).trim() && (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!oar) throw new Error('找不到指定的期初應收帳款');
    if (oar.status !== 'open') {
      throw new Error(`無效的狀態轉換：不可從 ${oar.status} 轉換至 voided`);
    }

    const reason = void_reason || voidReason;
    if (!reason || !String(reason).trim()) {
      throw new Error('原因必填');
    }

    const ar = (mockAccountsReceivable || []).find(
      a =>
        (a.tenant_id || 'tnt_mock_1') === targetTenantId &&
        a.source_type === 'opening_balance' &&
        a.source_id === oar.id &&
        a.status === 'open'
    );

    if (ar) {
      const arAllocations = (mockCustomerReceiptAllocations || [])
        .filter(
          ra =>
            ra.account_receivable_id === ar.id &&
            (ra.tenant_id || 'tnt_mock_1') === targetTenantId
        )
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

      for (const ra of arAllocations) {
        const r = (mockCustomerReceipts || []).find(
          rc =>
            rc.id === ra.receipt_id &&
            (rc.tenant_id || 'tnt_mock_1') === targetTenantId &&
            rc.status === 'posted'
        );
        if (r) {
          throw new Error(`此期初應收已有收款核銷：${r.receipt_number}，請先作廢收款單`);
        }
      }

      ar.status = 'voided';
      ar.voided_by = targetUserId;
      ar.voided_at = Math.floor(Date.now() / 1000);
      ar.void_reason = String(reason).trim();
      saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);
    }

    oar.status = 'voided';
    oar.voided_by = targetUserId;
    oar.voided_at = Math.floor(Date.now() / 1000);
    oar.void_reason = String(reason).trim();
    saveStorage('agent_erp_mock_opening_receivables', mockOpeningReceivables);

    return {
      opening_receivable: oar,
      account_receivable_id: ar ? ar.id : null
    };
  },

  list_opening_receivables: async (args) => {
    const filterObj = args?.filter || args || {};
    const { customer_partner_id, customerPartnerId, status } = filterObj;
    const targetTenantId = resolveMockActiveTenantId();
    let list = (mockOpeningReceivables || []).filter(
      o => (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    const cp = customer_partner_id || customerPartnerId;
    if (cp && String(cp).trim()) {
      list = list.filter(o => o.customer_partner_id === String(cp).trim());
    }
    if (status && String(status).trim()) {
      list = list.filter(o => o.status === String(status).trim());
    }
    return list
      .sort(
        (a, b) =>
          (b.opening_number || '').localeCompare(a.opening_number || '') ||
          b.created_at - a.created_at
      )
      .map(o => ({
        id: o.id,
        opening_number: o.opening_number,
        customer_partner_id: o.customer_partner_id,
        customer_name_snapshot: o.customer_name_snapshot,
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

  get_opening_receivable: async (args) => {
    const { id } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const oar = (mockOpeningReceivables || []).find(
      o => o.id === id && (o.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (!oar) throw new Error('找不到指定的期初應收帳款');
    const ar = (mockAccountsReceivable || []).find(
      a =>
        (a.tenant_id || 'tnt_mock_1') === targetTenantId &&
        a.source_type === 'opening_balance' &&
        a.source_id === oar.id
    );
    return {
      opening_receivable: oar,
      account_receivable_id: ar ? ar.id : null
    };
  },

  reset_mock_opening_receivables: async (args) => {
    const { tenant_id, tenantId } = args || {};
    const targetTid = tenant_id || tenantId;
    if (targetTid) {
      mockOpeningReceivables = (mockOpeningReceivables || []).filter(
        o => (o.tenant_id || 'tnt_mock_1') !== targetTid
      );
    } else {
      mockOpeningReceivables = [];
    }
    saveStorage('agent_erp_mock_opening_receivables', mockOpeningReceivables);
    return true;
  }
};

