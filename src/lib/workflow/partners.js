/**
 * @file partners.js
 * @description ToolHandler declarations and AgentProfile for Partner / Customer setup and management.
 * Conforms to docs/standards/authoring/agent-skill-authoring.md.
 */

import { invoke } from '../tauri.js';

/** @type {import('./types.js').ToolHandler} */
export const createPartnerToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'create_partner',
      description: '建立或新增客戶／合作夥伴基本資料（名稱、統編）',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '欲建立的客戶或合作夥伴名稱，例如：台積電、聯發科技、鴻海精密'
          },
          tax_id: {
            type: 'string',
            description: '客戶統一編號或稅號（可選），例如：22099131'
          }
        },
        required: ['name']
      }
    }
  },
  requiresConfirmation: true,
  completesTask: true,
  confirmLabel: '確認建立',
  cancelLabel: '取消',

  describeConfirmation(args, context = {}) {
    const name = args?.name ? String(args.name).trim() : '新客戶';
    const rawTaxId = args?.tax_id || args?.taxId;
    const taxInfo = rawTaxId && String(rawTaxId).trim() ? `（統編：${String(rawTaxId).trim()}）` : '';
    const isDone = context?.activeTask?.status === 'done';
    return isDone
      ? `偵測到您想額外建立客戶「${name}」${taxInfo}，確認要建立嗎？`
      : `偵測到您想建立客戶「${name}」${taxInfo}，確認要建立嗎？`;
  },

  describeTaskSummary(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新客戶';
    return `✅「新增客戶」已完成，建立了『${name}』`;
  },

  describeToast(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新客戶';
    return `已成功建立客戶「${name}」！`;
  },

  async execute(args) {
    const name = args?.name ? String(args.name).trim() : '';
    if (!name) {
      throw new Error('客戶名稱不能為空');
    }
    const rawTaxId = args?.tax_id || args?.taxId;
    const tax_id = rawTaxId && typeof rawTaxId === 'string' && rawTaxId.trim() ? rawTaxId.trim() : null;

    return await invoke('create_partner', {
      name,
      isCustomer: true,
      isVendor: false,
      taxId: tax_id,
      is_customer: true,
      is_vendor: false,
      tax_id
    });
  },

  formatResult(_result, args) {
    const name = args?.name ? String(args.name).trim() : '';
    const rawTaxId = args?.tax_id || args?.taxId;
    const taxInfo = rawTaxId && String(rawTaxId).trim() ? `（統一編號：${String(rawTaxId).trim()}）` : '';
    return `已為您成功建立客戶「${name}」${taxInfo}！`;
  },

  describeCancel() {
    return '好的，已取消建立客戶。請告訴我正確的客戶名稱或資訊';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();

    // Check optional tax ID in text
    let tax_id = null;
    const taxMatch = trimmed.match(/(?:統編|統一編號|稅號)[:：\s]*([0-9]{8})/);
    if (taxMatch) {
      tax_id = taxMatch[1];
    }

    // 1. Quoted customer name: 「台積電」, "聯發科"
    const quoteMatch = trimmed.match(/[「『"']([\u4e00-\u9fa5A-Za-z0-9\s（）()_-]{2,50})[」』"']/);
    if (quoteMatch) {
      return { tool: 'create_partner', name: quoteMatch[1].trim(), ...(tax_id ? { tax_id } : {}) };
    }

    // 2. Action verb prefix: 幫我新增/建立客戶 台積電
    const actionMatch = trimmed.match(/(?:新增|建立|成立|登記|設立|加)\s*(?:一個|一家)?\s*(?:新)?\s*(?:客戶|夥伴|廠商)?\s*[:：\s]*([A-Za-z0-9\u4e00-\u9fa5（）()_\s-]{2,50})/);
    if (actionMatch) {
      const extractedName = actionMatch[1].replace(/(?:統編|統一編號|稅號).*/, '').trim();
      if (extractedName && extractedName !== '客戶' && extractedName !== '夥伴') {
        return { tool: 'create_partner', name: extractedName, ...(tax_id ? { tax_id } : {}) };
      }
    }

    return null;
  }
};

/** @type {import('./types.js').ToolHandler} */
export const listPartnersToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'list_partners',
      description: '列出或查詢目前系統中已登記的所有客戶／合作夥伴清單',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  requiresConfirmation: true,
  confirmLabel: '確認查詢',
  cancelLabel: '取消',

  describeConfirmation() {
    return '偵測到您想查詢目前已登記的客戶清單，確認要查詢嗎？';
  },

  describeToast() {
    return '已完成客戶清單查詢！';
  },

  async execute() {
    const list = await invoke('list_partners', {
      filterCustomer: true,
      filter_customer: true
    });
    return list || [];
  },

  formatResult(partners) {
    if (Array.isArray(partners) && partners.length > 0) {
      const partnerLines = partners
        .map((p, i) => `${i + 1}. ${p.name}${p.tax_id ? ` (統編: ${p.tax_id})` : ''}`)
        .join('\n');
      return `目前系統中已登記的客戶清單（共 ${partners.length} 家）：\n${partnerLines}`;
    }
    return '目前系統中尚未建立任何客戶。您可以告訴我想建立的客戶名稱（例如「台積電 統編 22099131」）。';
  },

  describeCancel() {
    return '好的，已取消客戶清單查詢。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (
      trimmed.includes('客戶列表') ||
      trimmed.includes('客戶清單') ||
      trimmed.includes('查詢客戶') ||
      trimmed.includes('列出客戶') ||
      trimmed.includes('有哪些客戶') ||
      trimmed.includes('所有客戶') ||
      trimmed.includes('既有客戶')
    ) {
      return { tool: 'list_partners' };
    }
    return null;
  }
};

/** @type {import('./types.js').AgentProfile} */
export const customerCreateBasicProfileAgentProfile = {
  id: 'customer.create_basic_profile',
  domain: 'customer',
  systemPrompt: '你是一個客戶資料管理助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。',
  tools: [
    listPartnersToolHandler.definition,
    createPartnerToolHandler.definition
  ],
  toolHandlers: [
    listPartnersToolHandler,
    createPartnerToolHandler
  ],
  getFallbackMessage(activeTask) {
    return activeTask?.status !== 'done'
      ? '請告訴我想建立的客戶名稱（與統編，例如「台積電 統編 22099131」），或詢問目前有哪些已建立的客戶。'
      : '「新增客戶」任務已於稍早完成。若您想繼續新增其他客戶或查詢列表，請直接告訴我。';
  },
  quickAction: {
    title: '🏢 快速建立客戶引導',
    desc: '點擊下方按鈕可快速觸發建立「台積電」客戶資料的確認流程：',
    buttonText: '✨ 建立客戶「台積電」',
    defaultTool: 'create_partner',
    defaultArgs: { name: '台灣積體電路製造股份有限公司', tax_id: '22099131' }
  }
};

/** @type {import('./types.js').ToolHandler} */
export const createVendorToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'create_vendor',
      description: '建立或登記供應商基本資料（名稱、統編）',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '欲登記的供應商名稱，例如：欣興電子、日月光半導體、穩懋半導體'
          },
          tax_id: {
            type: 'string',
            description: '供應商統一編號或稅號（可選），例如：11223344'
          }
        },
        required: ['name']
      }
    }
  },
  requiresConfirmation: true,
  completesTask: true,
  confirmLabel: '確認建立',
  cancelLabel: '取消',

  describeConfirmation(args, context = {}) {
    const name = args?.name ? String(args.name).trim() : '新供應商';
    const rawTaxId = args?.tax_id || args?.taxId;
    const taxInfo = rawTaxId && String(rawTaxId).trim() ? `（統編：${String(rawTaxId).trim()}）` : '';
    const isDone = context?.activeTask?.status === 'done';
    return isDone
      ? `偵測到您想額外建立供應商「${name}」${taxInfo}，確認要建立嗎？`
      : `偵測到您想建立供應商「${name}」${taxInfo}，確認要建立嗎？`;
  },

  describeTaskSummary(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新供應商';
    return `✅「新增供應商」已完成，建立了『${name}』`;
  },

  describeToast(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新供應商';
    return `已成功建立供應商「${name}」！`;
  },

  async execute(args) {
    const name = args?.name ? String(args.name).trim() : '';
    if (!name) {
      throw new Error('供應商名稱不能為空');
    }
    const rawTaxId = args?.tax_id || args?.taxId;
    const tax_id = rawTaxId && typeof rawTaxId === 'string' && rawTaxId.trim() ? rawTaxId.trim() : null;

    return await invoke('create_partner', {
      name,
      isCustomer: false,
      isVendor: true,
      taxId: tax_id,
      is_customer: false,
      is_vendor: true,
      tax_id
    });
  },

  formatResult(_result, args) {
    const name = args?.name ? String(args.name).trim() : '';
    const rawTaxId = args?.tax_id || args?.taxId;
    const taxInfo = rawTaxId && String(rawTaxId).trim() ? `（統一編號：${String(rawTaxId).trim()}）` : '';
    return `已為您成功建立供應商「${name}」${taxInfo}！`;
  },

  describeCancel() {
    return '好的，已取消建立供應商。請告訴我正確的供應商名稱或資訊';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();

    // Check optional tax ID in text
    let tax_id = null;
    const taxMatch = trimmed.match(/(?:統編|統一編號|稅號)[:：\s]*([0-9]{8})/);
    if (taxMatch) {
      tax_id = taxMatch[1];
    }

    // 1. Quoted vendor name: 「欣興電子」, "日月光"
    const quoteMatch = trimmed.match(/[「『"']([\u4e00-\u9fa5A-Za-z0-9\s（）()_-]{2,50})[」』"']/);
    if (quoteMatch && (trimmed.includes('供應商') || trimmed.includes('廠商'))) {
      return { tool: 'create_vendor', name: quoteMatch[1].trim(), ...(tax_id ? { tax_id } : {}) };
    }

    // 2. Action verb prefix: 幫我新增/建立供應商 欣興電子
    const actionMatch = trimmed.match(/(?:新增|建立|成立|登記|設立|加)\s*(?:一個|一家)?\s*(?:新)?\s*(?:供應商|廠商|廠商夥伴)\s*[:：\s]*([A-Za-z0-9\u4e00-\u9fa5（）()_\s-]{2,50})/);
    if (actionMatch) {
      const extractedName = actionMatch[1].replace(/(?:統編|統一編號|稅號).*/, '').trim();
      if (extractedName && extractedName !== '供應商' && extractedName !== '廠商' && extractedName !== '廠商夥伴') {
        return { tool: 'create_vendor', name: extractedName, ...(tax_id ? { tax_id } : {}) };
      }
    }

    return null;
  }
};

/** @type {import('./types.js').ToolHandler} */
export const listVendorsToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'list_vendors',
      description: '列出或查詢目前系統中已登記的所有供應商／廠商清單',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  requiresConfirmation: true,
  confirmLabel: '確認查詢',
  cancelLabel: '取消',

  describeConfirmation() {
    return '偵測到您想查詢目前已登記的供應商清單，確認要查詢嗎？';
  },

  describeToast() {
    return '已完成供應商清單查詢！';
  },

  async execute() {
    const list = await invoke('list_partners', {
      filterVendor: true,
      filter_vendor: true
    });
    return list || [];
  },

  formatResult(partners) {
    if (Array.isArray(partners) && partners.length > 0) {
      const vendorLines = partners
        .map((p, i) => `${i + 1}. ${p.name}${p.tax_id ? ` (統編: ${p.tax_id})` : ''}`)
        .join('\n');
      return `目前系統中已登記的供應商清單（共 ${partners.length} 家）：\n${vendorLines}`;
    }
    return '目前系統中尚未建立任何供應商。您可以告訴我想建立的供應商名稱（例如「欣興電子 統編 11223344」）。';
  },

  describeCancel() {
    return '好的，已取消供應商清單查詢。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (
      trimmed.includes('供應商列表') ||
      trimmed.includes('供應商清單') ||
      trimmed.includes('廠商清單') ||
      trimmed.includes('廠商列表') ||
      trimmed.includes('查詢供應商') ||
      trimmed.includes('列出供應商') ||
      trimmed.includes('有哪些供應商') ||
      trimmed.includes('所有供應商') ||
      trimmed.includes('既有供應商') ||
      trimmed.includes('查詢廠商') ||
      trimmed.includes('列出廠商') ||
      trimmed.includes('有哪些廠商') ||
      trimmed.includes('所有廠商')
    ) {
      return { tool: 'list_vendors' };
    }
    return null;
  }
};

/** @type {import('./types.js').AgentProfile} */
export const vendorCreateBasicProfileAgentProfile = {
  id: 'vendor.create_basic_profile',
  domain: 'vendor',
  systemPrompt: '你是一個供應商資料管理助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。',
  tools: [
    listVendorsToolHandler.definition,
    createVendorToolHandler.definition
  ],
  toolHandlers: [
    listVendorsToolHandler,
    createVendorToolHandler
  ],
  getFallbackMessage(activeTask) {
    return activeTask?.status !== 'done'
      ? '請告訴我想建立的供應商名稱（與統編，例如「欣興電子 統編 11223344」），或詢問目前有哪些已建立的供應商。'
      : '「新增供應商」任務已於稍早完成。若您想繼續新增其他供應商或查詢列表，請直接告訴我。';
  },
  quickAction: {
    title: '🏭 快速建立供應商引導',
    desc: '點擊下方按鈕可快速觸發建立「欣興電子」供應商資料的確認流程：',
    buttonText: '✨ 建立供應商「欣興電子」',
    defaultTool: 'create_vendor',
    defaultArgs: { name: '欣興電子股份有限公司', tax_id: '11223344' }
  }
};
