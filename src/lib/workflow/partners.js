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

/**
 * Match a partner by name with strict precedence:
 * 1. Exact match (case-insensitive & trimmed)
 * 2. If 0 exact match, fallback to substring match
 * At any tier, if > 1 matches are found, throws ambiguous error instead of silently taking first.
 * If 0 match found at all, throws not found error.
 * @param {string} targetName
 * @param {any[]} partners
 * @returns {any}
 */
export function matchPartnerTarget(targetName, partners = []) {
  const query = (targetName || '').trim();
  if (!query) {
    throw new Error('請提供欲修改的合作夥伴名稱或 ID');
  }
  const queryLower = query.toLowerCase();

  // Tier 1: Exact match (case-insensitive & trimmed)
  const exactMatches = (partners || []).filter(p =>
    (p.name || '').trim().toLowerCase() === queryLower
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    throw new Error(`找到多筆符合「${query}」的夥伴，請提供更明確的名稱`);
  }

  // Tier 2: Substring / fuzzy match (only if 0 exact match)
  const fuzzyMatches = (partners || []).filter(p => {
    const pNameLower = (p.name || '').trim().toLowerCase();
    return pNameLower.includes(queryLower) || queryLower.includes(pNameLower);
  });

  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }
  if (fuzzyMatches.length > 1) {
    throw new Error(`找到多筆符合「${query}」的夥伴，請提供更明確的名稱`);
  }

  throw new Error(`找不到合作夥伴「${query}」`);
}

/** @type {import('./types.js').ToolHandler} */
export const updatePartnerToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'update_partner',
      description: '更新或補登客戶／合作夥伴基本資料（變更名稱、補登／更新統編）',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '欲修改的合作夥伴 ID（若已知）'
          },
          target_name: {
            type: 'string',
            description: '欲修改的原合作夥伴名稱，例如：台積電、聯發科'
          },
          name: {
            type: 'string',
            description: '變更後的新名稱（若欲更名），例如：聯發科技'
          },
          tax_id: {
            type: 'string',
            description: '補登或更新的統一編號，例如：22099131'
          }
        }
      }
    }
  },
  requiresConfirmation: true,
  completesTask: true,
  confirmLabel: '確認修改',
  cancelLabel: '取消',

  async prepareConfirmation(args) {
    if (!args) return;
    const targetName = (args.target_name || args.name || '').trim();
    const partnerId = args.id ? String(args.id).trim() : '';

    const partners = await invoke('list_partners', {});
    let target = null;
    if (partnerId) {
      target = (partners || []).find(p => p.id === partnerId);
      if (!target) {
        throw new Error(`找不到合作夥伴（ID: ${partnerId}）`);
      }
    } else {
      target = matchPartnerTarget(targetName, partners || []);
    }

    args.id = target.id;
    args._targetPartner = target;
  },

  describeConfirmation(args) {
    const resolved = args?._targetPartner;
    const target = resolved ? resolved.name : (args?.target_name || args?.name || '指定夥伴').trim();
    const beforeName = resolved ? resolved.name : target;
    const beforeTax = resolved?.tax_id ? resolved.tax_id : '未填寫';

    const newName = args?.name && args?.name.trim() !== target ? args.name.trim() : null;
    const rawTaxId = args?.tax_id !== undefined ? args.tax_id : args?.taxId;
    const newTax = rawTaxId && String(rawTaxId).trim() ? String(rawTaxId).trim() : null;

    if (resolved) {
      if (newName && newTax) {
        return `偵測到您想將客戶「${target}」更名為「${newName}」並設定統編為 ${newTax}（原名稱：${beforeName} ➔ 變更後：${newName}；原統編：${beforeTax} ➔ 變更後：${newTax}），確認要修改嗎？`;
      } else if (newName) {
        return `偵測到您想將客戶「${target}」更名為「${newName}」（原名稱：${beforeName} ➔ 變更後：${newName}），確認要修改嗎？`;
      } else if (newTax) {
        return `偵測到您想為客戶「${target}」設定統編為 ${newTax}（目前統編：${beforeTax} ➔ 變更後：${newTax}），確認要修改嗎？`;
      }
      return `偵測到您想修改客戶「${target}」的資料，確認要修改嗎？`;
    }

    if (newName && newTax) {
      return `偵測到您想將客戶「${target}」更名為「${newName}」並設定統編為 ${newTax}，確認要修改嗎？`;
    } else if (newName) {
      return `偵測到您想將客戶「${target}」更名為「${newName}」，確認要修改嗎？`;
    } else if (newTax) {
      return `偵測到您想為客戶「${target}」設定統編為 ${newTax}，確認要修改嗎？`;
    }
    return `偵測到您想修改客戶「${target}」的資料，確認要修改嗎？`;
  },

  describeTaskSummary(_result, args) {
    const target = args?._targetPartner?.name || (args?.target_name || args?.name || '夥伴').trim();
    return `✅「修改客戶資料」已完成，更新了『${target}』`;
  },

  describeToast(_result, args) {
    const target = args?._targetPartner?.name || (args?.target_name || args?.name || '夥伴').trim();
    return `已成功更新「${target}」資料！`;
  },

  async execute(args) {
    let partnerId = args?.id ? String(args.id).trim() : '';
    let targetPartner = args?._targetPartner;
    const targetName = (args?.target_name || args?.name || '').trim();

    if (!partnerId) {
      if (!targetName) {
        throw new Error('請提供欲修改的合作夥伴名稱或 ID');
      }
      const partners = await invoke('list_partners', {});
      targetPartner = matchPartnerTarget(targetName, partners || []);
      partnerId = targetPartner.id;
    }

    const payload = { id: partnerId };
    const currentName = targetPartner ? targetPartner.name : targetName;
    if (args?.name && args.name.trim() && args.name.trim() !== currentName) {
      payload.name = args.name.trim();
    }
    const rawTaxId = args?.tax_id !== undefined ? args.tax_id : args?.taxId;
    if (rawTaxId !== undefined) {
      payload.tax_id = String(rawTaxId).trim();
      payload.taxId = String(rawTaxId).trim();
    }

    return await invoke('update_partner', payload);
  },

  formatResult(result) {
    const name = result?.name || '';
    const taxInfo = result?.tax_id ? `（統一編號：${result.tax_id}）` : '';
    return `已為您成功更新客戶「${name}」資料${taxInfo}！`;
  },

  describeCancel() {
    return '好的，已取消合作夥伴資料修改。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();

    // Check 8-digit tax ID in text
    let tax_id = null;
    const taxMatch = trimmed.match(/(?:統編|統一編號|稅號)[:：\s]*([0-9]{8})/);
    if (taxMatch) {
      tax_id = taxMatch[1];
    }

    // 1. Rename intent: 把 [客戶] 聯發科 (改名|更名) 為 聯發科技
    const renameMatch = trimmed.match(/(?:把|將)\s*(?:客戶|夥伴|廠商)?\s*[「『"']?([A-Za-z0-9\u4e00-\u9fa5（）()_\s-]{2,50})[」』"']?\s*(?:改名|更名|變更名稱)\s*(?:為|成|做)\s*[「『"']?([A-Za-z0-9\u4e00-\u9fa5（）()_\s-]{2,50})[」』"']?/);
    if (renameMatch) {
      const target_name = renameMatch[1].trim();
      const new_name = renameMatch[2].trim();
      return {
        tool: 'update_partner',
        target_name,
        name: new_name,
        ...(tax_id ? { tax_id } : {})
      };
    }

    // 2. Tax ID update/supplement: 幫 台積電 (補上|補填|設定|更新|修改) 統編 22099131
    const taxActionMatch = trimmed.match(/(?:幫|替|為|給)?\s*(?:客戶|夥伴|廠商)?\s*[「『"']?([A-Za-z0-9\u4e00-\u9fa5（）()_\s-]{2,50})[」』"']?\s*(?:補上|補填|補登|設定|更新|修改|加)\s*(?:統編|統一編號|稅號)[:：\s]*([0-9]{8})/);
    if (taxActionMatch) {
      const target_name = taxActionMatch[1].trim();
      const extractedTaxId = taxActionMatch[2].trim();
      return {
        tool: 'update_partner',
        target_name,
        tax_id: extractedTaxId
      };
    }

    // 3. Tax ID update reversed phrasing: 幫 台積電 統編 (改為|更新為|設定為) 22099131
    const taxActionMatch2 = trimmed.match(/(?:幫|替|為|給)?\s*(?:客戶|夥伴|廠商)?\s*[「『"']?([A-Za-z0-9\u4e00-\u9fa5（）()_\s-]{2,50})[」』"']?\s*(?:的)?\s*(?:統編|統一編號|稅號)\s*(?:改為|更新為|設定為|補為)[:：\s]*([0-9]{8})/);
    if (taxActionMatch2) {
      const target_name = taxActionMatch2[1].trim();
      const extractedTaxId = taxActionMatch2[2].trim();
      return {
        tool: 'update_partner',
        target_name,
        tax_id: extractedTaxId
      };
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
    createPartnerToolHandler.definition,
    updatePartnerToolHandler.definition
  ],
  toolHandlers: [
    listPartnersToolHandler,
    createPartnerToolHandler,
    updatePartnerToolHandler
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
