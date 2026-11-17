// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Fetch partners list
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function fetchPartners(filter = {}) {
  try {
    const filterCustomer = filter?.filterCustomer !== undefined ? filter.filterCustomer : filter?.filter_customer;
    const filterVendor = filter?.filterVendor !== undefined ? filter.filterVendor : filter?.filter_vendor;
    const payload = {};
    if (filterCustomer !== undefined) {
      payload.filterCustomer = filterCustomer;
      payload.filter_customer = filterCustomer;
    }
    if (filterVendor !== undefined) {
      payload.filterVendor = filterVendor;
      payload.filter_vendor = filterVendor;
    }
    const list = await invoke('list_partners', payload);
    appState.partners = list || [];
    return appState.partners;
  } catch (err) {
    console.error("Failed to fetch partners:", err);
    return [];
  }
}

/**
 * Create a partner / customer
 * @param {string | { name: string, tax_id?: string, taxId?: string, is_customer?: boolean, isCustomer?: boolean, is_vendor?: boolean, isVendor?: boolean, payment_terms_type?: string | null, paymentTermsType?: string | null, payment_terms_days?: number | string | null, paymentTermsDays?: number | string | null, collection_terms_type?: string | null, collectionTermsType?: string | null, collection_terms_days?: number | string | null, collectionTermsDays?: number | string | null, requested_collection_terms_note?: string | null, requestedCollectionTermsNote?: string | null, invoice_issuance_mode?: string | null, invoiceIssuanceMode?: string | null }} input
 * @param {string | null} [taxId]
 * @returns {Promise<any>}
 */
export async function createPartnerAction(input, taxId = null) {
  let name = '';
  let targetTaxId = null;
  let is_customer = true;
  let is_vendor = false;
  let hasExplicitCustomer = false;
  let hasExplicitVendor = false;

  if (typeof input === 'object' && input !== null) {
    name = (input.name || '').trim();
    targetTaxId = input.tax_id !== undefined ? input.tax_id : input.taxId;
    if (input.is_customer !== undefined) {
      is_customer = input.is_customer;
      hasExplicitCustomer = true;
    } else if (input.isCustomer !== undefined) {
      is_customer = input.isCustomer;
      hasExplicitCustomer = true;
    }
    if (input.is_vendor !== undefined) {
      is_vendor = input.is_vendor;
      hasExplicitVendor = true;
    } else if (input.isVendor !== undefined) {
      is_vendor = input.isVendor;
      hasExplicitVendor = true;
    }

    if (hasExplicitVendor && !hasExplicitCustomer) {
      is_customer = !is_vendor;
    }
  } else if (typeof input === 'string') {
    name = input.trim();
    targetTaxId = taxId;
  }

  if (!name) {
    if (is_vendor && !is_customer) {
      throw new Error('供應商名稱為必填項目');
    }
    throw new Error('客戶名稱為必填項目');
  }
  const normalizedTaxId = targetTaxId && typeof targetTaxId === 'string' && targetTaxId.trim() ? targetTaxId.trim() : null;
  const rawTermsType = typeof input === 'object' && input !== null
    ? (input.payment_terms_type !== undefined ? input.payment_terms_type : input.paymentTermsType)
    : undefined;
  const rawTermsDays = typeof input === 'object' && input !== null
    ? (input.payment_terms_days !== undefined ? input.payment_terms_days : input.paymentTermsDays)
    : undefined;

  const rawColType = typeof input === 'object' && input !== null
    ? (input.collection_terms_type !== undefined ? input.collection_terms_type : input.collectionTermsType)
    : undefined;
  const rawColDays = typeof input === 'object' && input !== null
    ? (input.collection_terms_days !== undefined ? input.collection_terms_days : input.collectionTermsDays)
    : undefined;

  const rawNote = typeof input === 'object' && input !== null
    ? (input.requested_collection_terms_note !== undefined ? input.requested_collection_terms_note : input.requestedCollectionTermsNote)
    : undefined;
  const rawInvoiceMode = typeof input === 'object' && input !== null
    ? (input.invoice_issuance_mode !== undefined ? input.invoice_issuance_mode : input.invoiceIssuanceMode)
    : undefined;

  try {
    const partner = await invoke('create_partner', {
      name,
      isCustomer: is_customer,
      isVendor: is_vendor,
      taxId: normalizedTaxId,
      is_customer,
      is_vendor,
      tax_id: normalizedTaxId,
      payment_terms_type: rawTermsType,
      paymentTermsType: rawTermsType,
      payment_terms_days: rawTermsDays !== undefined && rawTermsDays !== null && rawTermsDays !== '' ? Number(rawTermsDays) : undefined,
      paymentTermsDays: rawTermsDays !== undefined && rawTermsDays !== null && rawTermsDays !== '' ? Number(rawTermsDays) : undefined,
      collection_terms_type: rawColType,
      collectionTermsType: rawColType,
      collection_terms_days: rawColDays !== undefined && rawColDays !== null && rawColDays !== '' ? Number(rawColDays) : undefined,
      collectionTermsDays: rawColDays !== undefined && rawColDays !== null && rawColDays !== '' ? Number(rawColDays) : undefined,
      requested_collection_terms_note: rawNote,
      requestedCollectionTermsNote: rawNote,
      invoice_issuance_mode: rawInvoiceMode,
      invoiceIssuanceMode: rawInvoiceMode
    });
    await fetchPartners();
    if (is_vendor && !is_customer) {
      showToast(`已成功建立供應商「${name}」！`);
    } else if (is_vendor && is_customer) {
      showToast(`已成功建立合作夥伴「${name}」！`);
    } else {
      showToast(`已成功建立客戶「${name}」！`);
    }
    return partner;
  } catch (err) {
    console.error("Failed to create partner:", err);
    throw err;
  }
}

/**
 * Create a vendor action helper
 * @param {string | { name: string, tax_id?: string, taxId?: string }} input
 * @param {string | null} [taxId]
 * @returns {Promise<any>}
 */
export async function createVendorAction(input, taxId = null) {
  if (typeof input === 'object' && input !== null) {
    return createPartnerAction({
      isCustomer: false,
      isVendor: true,
      ...input
    });
  }
  return createPartnerAction({
    name: input,
    taxId: (taxId && typeof taxId === 'string') ? taxId : undefined,
    isCustomer: false,
    isVendor: true
  });
}

/**
 * Fetch vendors list only
 * @returns {Promise<any[]>}
 */
export async function fetchVendors() {
  return fetchPartners({ filterVendor: true, filter_vendor: true });
}

/**
 * Update an existing partner's name, tax_id, and/or payment terms
 * @param {{ id: string, name?: string, taxId?: string, tax_id?: string, payment_terms_type?: string | null, paymentTermsType?: string | null, payment_terms_days?: number | string | null, paymentTermsDays?: number | string | null, clear_payment_terms?: boolean, clearPaymentTerms?: boolean, collection_terms_type?: string | null, collectionTermsType?: string | null, collection_terms_days?: number | string | null, collectionTermsDays?: number | string | null, clear_collection_terms?: boolean, clearCollectionTerms?: boolean, requested_collection_terms_note?: string | null, requestedCollectionTermsNote?: string | null, clear_requested_collection_terms_note?: boolean, clearRequestedCollectionTermsNote?: boolean, invoice_issuance_mode?: string | null, invoiceIssuanceMode?: string | null }} input
 * @returns {Promise<any>}
 */
export async function updatePartnerAction(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('更新合作夥伴參數錯誤');
  }
  const id = (input.id || '').trim();
  if (!id) {
    throw new Error('合作夥伴識別碼為必填項目');
  }

  const payload = { id };
  if (input.name !== undefined) {
    const trimmedName = String(input.name).trim();
    if (!trimmedName) {
      throw new Error('合作夥伴名稱不能為空');
    }
    payload.name = trimmedName;
  }

  const rawTaxId = input.tax_id !== undefined ? input.tax_id : input.taxId;
  if (rawTaxId !== undefined) {
    if (rawTaxId === null || (typeof rawTaxId === 'string' && !rawTaxId.trim())) {
      payload.tax_id = '';
      payload.taxId = '';
    } else {
      const trimmedTaxId = String(rawTaxId).trim();
      if (!/^\d{8}$/.test(trimmedTaxId)) {
        throw new Error('統一編號必須為 8 碼半形數字');
      }
      payload.tax_id = trimmedTaxId;
      payload.taxId = trimmedTaxId;
    }
  }

  const rawTermsType = input.payment_terms_type !== undefined ? input.payment_terms_type : input.paymentTermsType;
  if (rawTermsType !== undefined) {
    payload.payment_terms_type = rawTermsType;
    payload.paymentTermsType = rawTermsType;
  }
  const rawTermsDays = input.payment_terms_days !== undefined ? input.payment_terms_days : input.paymentTermsDays;
  if (rawTermsDays !== undefined) {
    payload.payment_terms_days = rawTermsDays !== null && rawTermsDays !== '' ? Number(rawTermsDays) : null;
    payload.paymentTermsDays = payload.payment_terms_days;
  }
  if (input.clear_payment_terms !== undefined || input.clearPaymentTerms !== undefined) {
    payload.clear_payment_terms = input.clear_payment_terms !== undefined ? input.clear_payment_terms : input.clearPaymentTerms;
    payload.clearPaymentTerms = payload.clear_payment_terms;
  }

  const rawColType = input.collection_terms_type !== undefined ? input.collection_terms_type : input.collectionTermsType;
  if (rawColType !== undefined) {
    payload.collection_terms_type = rawColType;
    payload.collectionTermsType = rawColType;
  }
  const rawColDays = input.collection_terms_days !== undefined ? input.collection_terms_days : input.collectionTermsDays;
  if (rawColDays !== undefined) {
    payload.collection_terms_days = rawColDays !== null && rawColDays !== '' ? Number(rawColDays) : null;
    payload.collectionTermsDays = payload.collection_terms_days;
  }
  if (input.clear_collection_terms !== undefined || input.clearCollectionTerms !== undefined) {
    payload.clear_collection_terms = input.clear_collection_terms !== undefined ? input.clear_collection_terms : input.clearCollectionTerms;
    payload.clearCollectionTerms = payload.clear_collection_terms;
  }

  const rawNote = input.requested_collection_terms_note !== undefined ? input.requested_collection_terms_note : input.requestedCollectionTermsNote;
  if (rawNote !== undefined) {
    payload.requested_collection_terms_note = rawNote !== null ? String(rawNote) : null;
    payload.requestedCollectionTermsNote = payload.requested_collection_terms_note;
  }
  if (input.clear_requested_collection_terms_note !== undefined || input.clearRequestedCollectionTermsNote !== undefined) {
    payload.clear_requested_collection_terms_note = input.clear_requested_collection_terms_note !== undefined ? input.clear_requested_collection_terms_note : input.clearRequestedCollectionTermsNote;
    payload.clearRequestedCollectionTermsNote = payload.clear_requested_collection_terms_note;
  }

  const rawInvMode = input.invoice_issuance_mode !== undefined ? input.invoice_issuance_mode : input.invoiceIssuanceMode;
  if (rawInvMode !== undefined) {
    payload.invoice_issuance_mode = rawInvMode;
    payload.invoiceIssuanceMode = rawInvMode;
  }

  try {
    const updated = await invoke('update_partner', payload);
    await fetchPartners();
    showToast(`已成功更新合作夥伴「${updated.name}」資料！`);
    return updated;
  } catch (err) {
    console.error("Failed to update partner:", err);
    throw err;
  }
}

