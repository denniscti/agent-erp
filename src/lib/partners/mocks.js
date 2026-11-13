// @ts-check
import { loadStorage, saveStorage, resolveMockActiveTenantId, nextMockUid } from '../mockStorage.js';

export const defaultMockPartners = [
  { id: "part_mock_1", tenant_id: "tnt_mock_1", name: "A 公司 (Customer A)", is_customer: true, is_vendor: false, tax_id: null, payment_terms_type: null, payment_terms_days: null, created_at: Math.floor(Date.now() / 1000) - 86400 * 5 },
  { id: "part_mock_2", tenant_id: "tnt_mock_1", name: "台積電 (TSMC)", is_customer: true, is_vendor: false, tax_id: "22099131", payment_terms_type: null, payment_terms_days: null, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 }
];

export let mockPartners = loadStorage('agent_erp_mock_partners', defaultMockPartners);
if (!mockPartners || !Array.isArray(mockPartners)) {
  mockPartners = defaultMockPartners;
  saveStorage('agent_erp_mock_partners', mockPartners);
} else {
  let migrated = false;
  mockPartners.forEach(p => {
    if (!p.tenant_id) {
      p.tenant_id = 'tnt_mock_1';
      migrated = true;
    }
  });
  if (migrated) saveStorage('agent_erp_mock_partners', mockPartners);
}

export const partnerMocks = {
  create_partner: async (args) => {
    const {
      name,
      is_customer,
      isCustomer,
      is_vendor,
      isVendor,
      tax_id,
      taxId,
      payment_terms_type,
      paymentTermsType,
      payment_terms_days,
      paymentTermsDays,
      is_active,
      isActive
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      throw new Error('Partner name cannot be empty');
    }
    const rawTaxId = tax_id !== undefined ? tax_id : taxId;
    let normalizedTaxId = null;
    if (rawTaxId !== undefined && rawTaxId !== null) {
      const s = String(rawTaxId).trim();
      if (s.length > 0) {
        if (!/^\d{8}$/.test(s)) {
          throw new Error('統一編號必須為 8 碼半形數字');
        }
        normalizedTaxId = s;
      }
    }
    const vendFlag = is_vendor !== undefined ? is_vendor : (isVendor !== undefined ? isVendor : false);
    const custFlag = is_customer !== undefined ? is_customer : (isCustomer !== undefined ? isCustomer : !vendFlag);

    // Validate payment terms (PT-01, PT-02, PT-03)
    const rawType = payment_terms_type !== undefined ? payment_terms_type : paymentTermsType;
    const rawDays = payment_terms_days !== undefined ? payment_terms_days : paymentTermsDays;
    const normType = rawType !== undefined && rawType !== null ? String(rawType).trim() : null;
    const hasType = normType !== null && normType.length > 0;
    const hasDays = rawDays !== undefined && rawDays !== null && rawDays !== '';

    if ((hasType && !hasDays) || (!hasType && hasDays)) {
      throw new Error('付款條件類型與天數需同時設定');
    }

    if (hasType) {
      if (!vendFlag) {
        throw new Error('僅供應商可設定付款條件');
      }
      if (normType !== 'net' && normType !== 'month_end') {
        throw new Error('付款條件類型需為 net 或 month_end');
      }
      const d = Number(rawDays);
      if (!Number.isInteger(d) || d < 0 || d > 365) {
        throw new Error('付款天數需為 0～365 的整數');
      }
    }

    const existingIndex = mockPartners.findIndex(p =>
      (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
      p.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (existingIndex >= 0) {
      const existing = mockPartners[existingIndex];
      const needAddVendor = !!vendFlag && !existing.is_vendor;
      const needAddCustomer = !!custFlag && !existing.is_customer;

      if (needAddVendor || needAddCustomer) {
        if (normalizedTaxId) {
          const taxDup = mockPartners.find(p =>
            (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
            p.id !== existing.id &&
            p.tax_id === normalizedTaxId
          );
          if (taxDup) {
            throw new Error(`統一編號「${normalizedTaxId}」已由其他合作夥伴登記`);
          }
        }
        existing.is_customer = existing.is_customer || !!custFlag;
        existing.is_vendor = existing.is_vendor || !!vendFlag;
        if (normalizedTaxId) {
          existing.tax_id = normalizedTaxId;
        }
        if (hasType) {
          existing.payment_terms_type = normType;
          existing.payment_terms_days = Number(rawDays);
        }
        saveStorage('agent_erp_mock_partners', mockPartners);
        return { ...existing };
      }

      const roleLabel = (vendFlag && !custFlag) ? '供應商' : '客戶';
      throw new Error(`合作夥伴／${roleLabel}「${trimmedName}」已存在，請使用不同名稱`);
    }

    if (normalizedTaxId) {
      const taxDup = mockPartners.find(p =>
        (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
        p.tax_id === normalizedTaxId
      );
      if (taxDup) {
        throw new Error(`統一編號「${normalizedTaxId}」已由其他合作夥伴登記`);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const newPartner = {
      id: nextMockUid('part'),
      tenant_id: targetTenantId,
      name: trimmedName,
      is_customer: !!custFlag,
      is_vendor: !!vendFlag,
      is_active: is_active !== undefined ? Boolean(is_active) : (isActive !== undefined ? Boolean(isActive) : true),
      tax_id: normalizedTaxId,
      payment_terms_type: hasType ? normType : null,
      payment_terms_days: hasType ? Number(rawDays) : null,
      created_at: now
    };
    mockPartners.push(newPartner);
    saveStorage('agent_erp_mock_partners', mockPartners);
    return newPartner;
  },

  update_partner: async (args) => {
    const {
      id,
      name,
      tax_id,
      taxId,
      payment_terms_type,
      paymentTermsType,
      payment_terms_days,
      paymentTermsDays,
      clear_payment_terms,
      clearPaymentTerms,
      is_active,
      isActive
    } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const trimmedId = (id || '').trim();
    if (!trimmedId) {
      throw new Error('Partner ID cannot be empty');
    }

    const targetIndex = mockPartners.findIndex(p =>
      p.id === trimmedId && (p.tenant_id || 'tnt_mock_1') === targetTenantId
    );
    if (targetIndex < 0) {
      throw new Error('Partner not found');
    }
    const partner = mockPartners[targetIndex];

    const rawIsActive = is_active !== undefined ? is_active : isActive;
    if (rawIsActive !== undefined) {
      partner.is_active = Boolean(rawIsActive);
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        throw new Error('合作夥伴名稱不能為空');
      }
      const nameDup = mockPartners.find(p =>
        (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
        p.id !== partner.id &&
        p.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (nameDup) {
        throw new Error(`合作夥伴名稱「${trimmedName}」已存在，請使用不同名稱`);
      }
      partner.name = trimmedName;
    }

    const rawTaxId = tax_id !== undefined ? tax_id : taxId;
    if (rawTaxId !== undefined) {
      if (rawTaxId === null) {
        partner.tax_id = null;
      } else {
        const s = String(rawTaxId).trim();
        if (s.length === 0) {
          partner.tax_id = null;
        } else {
          if (!/^\d{8}$/.test(s)) {
            throw new Error('統一編號必須為 8 碼半形數字');
          }
          const taxDup = mockPartners.find(p =>
            (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
            p.id !== partner.id &&
            p.tax_id === s
          );
          if (taxDup) {
            throw new Error(`統一編號「${s}」已由其他合作夥伴登記`);
          }
          partner.tax_id = s;
        }
      }
    }

    // Handle payment terms update and clearing (PT-01, PT-02, PT-03)
    const shouldClear = clear_payment_terms === true || clearPaymentTerms === true ||
      (payment_terms_type === '' && (payment_terms_days === null || payment_terms_days === undefined));

    if (shouldClear) {
      partner.payment_terms_type = null;
      partner.payment_terms_days = null;
    } else if (
      payment_terms_type !== undefined ||
      paymentTermsType !== undefined ||
      payment_terms_days !== undefined ||
      paymentTermsDays !== undefined
    ) {
      const rawType = payment_terms_type !== undefined ? payment_terms_type : paymentTermsType;
      const rawDays = payment_terms_days !== undefined ? payment_terms_days : paymentTermsDays;
      const normType = rawType !== undefined && rawType !== null ? String(rawType).trim() : null;
      const hasType = normType !== null && normType.length > 0;
      const hasDays = rawDays !== undefined && rawDays !== null && rawDays !== '';

      if ((hasType && !hasDays) || (!hasType && hasDays)) {
        throw new Error('付款條件類型與天數需同時設定');
      }

      if (hasType) {
        if (!partner.is_vendor) {
          throw new Error('僅供應商可設定付款條件');
        }
        if (normType !== 'net' && normType !== 'month_end') {
          throw new Error('付款條件類型需為 net 或 month_end');
        }
        const d = Number(rawDays);
        if (!Number.isInteger(d) || d < 0 || d > 365) {
          throw new Error('付款天數需為 0～365 的整數');
        }
        partner.payment_terms_type = normType;
        partner.payment_terms_days = d;
      }
    }

    saveStorage('agent_erp_mock_partners', mockPartners);
    return { ...partner };
  },

  list_partners: async (args) => {
    const { filter_customer, filterCustomer, filter_vendor, filterVendor } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const isCustFilter = filter_customer !== undefined ? filter_customer : filterCustomer;
    const isVendFilter = filter_vendor !== undefined ? filter_vendor : filterVendor;
    let list = mockPartners.filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (isCustFilter === true) {
      list = list.filter(p => p.is_customer);
    }
    if (isVendFilter === true) {
      list = list.filter(p => p.is_vendor);
    }
    return list;
  }
};

