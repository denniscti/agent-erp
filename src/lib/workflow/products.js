/**
 * @file products.js
 * @description ToolHandler declarations and AgentProfile for Product setup and management (Issue #137).
 * Conforms to docs/standards/authoring/agent-skill-authoring.md.
 */

import { invoke } from '../tauri.js';

/** @type {import('./types.js').ToolHandler} */
export const createProductToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'create_product',
      description: '建立或新增商品基本資料（名稱、分類：轉售商品／自製成品／原物料、單位、售價）',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '欲建立的商品名稱，例如：智能核心晶片、AI 伺服器機櫃、散熱鋁片'
          },
          category: {
            type: 'string',
            description: '商品分類，可選值：轉售商品、自製成品、原物料（或 resale, manufactured, raw_material）'
          },
          sku: {
            type: 'string',
            description: '規格編號或 SKU（可選），例如：CHIP-001'
          },
          unit_name: {
            type: 'string',
            description: '預設基準單位（可選，預設為「個」），例如：個、台、片、顆'
          },
          selling_price: {
            type: 'number',
            description: '標準銷售單價（可選，預設為 0）'
          }
        },
        required: ['name', 'category']
      }
    }
  },
  requiresConfirmation: true,
  completesTask: true,
  confirmLabel: '確認建立',
  cancelLabel: '取消',

  describeConfirmation(args, context = {}) {
    const name = args?.name ? String(args.name).trim() : '新商品';
    const cat = args?.category ? String(args.category).trim() : '轉售商品';
    const priceStr = args?.selling_price !== undefined ? `，售價 ${args.selling_price} 元` : '';
    const isDone = context?.activeTask?.status === 'done';
    return isDone
      ? `偵測到您想額外建立商品「${name}」（分類：${cat}${priceStr}），確認要建立嗎？`
      : `偵測到您想建立商品「${name}」（分類：${cat}${priceStr}），確認要建立嗎？`;
  },

  describeTaskSummary(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新商品';
    return `✅「新增商品」已完成，建立了『${name}』`;
  },

  describeToast(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新商品';
    return `已成功建立商品「${name}」！`;
  },

  async execute(args) {
    const name = args?.name ? String(args.name).trim() : '';
    if (!name) {
      throw new Error('商品名稱不能為空');
    }
    const category = args?.category ? String(args.category).trim() : '轉售商品';
    const sku = args?.sku ? String(args.sku).trim() : undefined;
    const unit_name = args?.unit_name ? String(args.unit_name).trim() : undefined;
    const selling_price = args?.selling_price !== undefined ? Number(args.selling_price) : undefined;

    return await invoke('create_product', {
      name,
      category,
      sku,
      unit_name,
      unitName: unit_name,
      selling_price,
      sellingPrice: selling_price
    });
  },

  formatResult(result, args) {
    const name = args?.name ? String(args.name).trim() : '';
    const cat = args?.category ? String(args.category).trim() : '商品';
    const price = args?.selling_price !== undefined ? `，售價：${args.selling_price} 元` : '';
    return `已為您成功建立${cat}「${name}」${price}！預設規格變體已自動建立為「標準」。`;
  },

  describeCancel() {
    return '好的，已取消建立商品。請告訴我正確的商品名稱與規格分類。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();

    // Determine category from keywords
    let category = '轉售商品';
    if (trimmed.includes('自製成品') || trimmed.includes('自製') || trimmed.includes('成品')) {
      category = '自製成品';
    } else if (trimmed.includes('原物料') || trimmed.includes('原料') || trimmed.includes('物料')) {
      category = '原物料';
    } else if (trimmed.includes('轉售商品') || trimmed.includes('轉售')) {
      category = '轉售商品';
    }

    // Extract price if available
    let selling_price = undefined;
    const priceMatch = trimmed.match(/(?:售價|單價|價格|價格為|定價)[:：\s]*([0-9]+(?:\.[0-9]+)?)/);
    if (priceMatch) {
      selling_price = parseFloat(priceMatch[1]);
    }

    // Extract unit if available
    let unit_name = undefined;
    const unitMatch = trimmed.match(/(?:單位|計量單位)[:：\s]*([^\s,，。]+)/);
    if (unitMatch) {
      unit_name = unitMatch[1].trim();
    }

    // 1. Quoted product name: 「智能核心晶片」, "伺服器"
    const quoteMatch = trimmed.match(/[「『"']([\u4e00-\u9fa5A-Za-z0-9\s（）()_-]{2,50})[」』"']/);
    if (quoteMatch) {
      return {
        tool: 'create_product',
        name: quoteMatch[1].trim(),
        category,
        ...(selling_price !== undefined ? { selling_price } : {}),
        ...(unit_name ? { unit_name } : {})
      };
    }

    // 2. Unquoted pattern: 新增[商品|轉售商品|自製成品|原物料] <名稱>
    const match = trimmed.match(/(?:新增|建立|登記)(?:轉售商品|自製成品|原物料|商品)[:：\s]+([^\s,，。]+)/);
    if (match) {
      const extractedName = match[1].trim();
      if (extractedName && !['資料', '基本資料', '規格'].includes(extractedName)) {
        return {
          tool: 'create_product',
          name: extractedName,
          category,
          ...(selling_price !== undefined ? { selling_price } : {}),
          ...(unit_name ? { unit_name } : {})
        };
      }
    }

    return null;
  }
};

/** @type {import('./types.js').ToolHandler} */
export const listProductsToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'list_products',
      description: '查詢或列出已建立的商品清單（可選按類別或販售狀態過濾）',
      parameters: {
        type: 'object',
        properties: {
          filter_category: {
            type: 'string',
            description: '類別過濾（可選，如 resale, manufactured, raw_material）'
          },
          filter_sellable: {
            type: 'boolean',
            description: '是否僅列出可販售商品（可選）'
          },
          filter_purchasable: {
            type: 'boolean',
            description: '是否僅列出可採購商品（可選）'
          }
        }
      }
    }
  },
  requiresConfirmation: false,
  completesTask: false,

  async execute(args) {
    return await invoke('list_products', args || {});
  },

  formatResult(result) {
    const list = Array.isArray(result) ? result : [];
    if (list.length === 0) {
      return '目前尚未建立任何商品資料。您可以直接告訴我想建立的商品名稱與分類（例如：「建立轉售商品 智能核心晶片 售價 120」）。';
    }

    const catName = (c) => {
      if (c === 'resale') return '轉售商品';
      if (c === 'manufactured') return '自製成品';
      if (c === 'raw_material') return '原物料';
      return c;
    };

    let reply = `已為您查詢到 ${list.length} 筆商品：\n\n`;
    reply += '| 商品名稱 | 分類 | 可販售 | 可採購 |\n';
    reply += '|---|---|---|---|\n';
    for (const p of list) {
      const sell = p.is_sellable ? '✅' : '❌';
      const purch = p.is_purchasable ? '✅' : '❌';
      reply += `| ${p.name} | ${catName(p.category)} | ${sell} | ${purch} |\n`;
    }
    return reply;
  },

  describeCancel() {
    return '好的，已取消商品清單查詢。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (
      trimmed.includes('商品列表') ||
      trimmed.includes('商品清單') ||
      trimmed.includes('產品清單') ||
      trimmed.includes('產品列表') ||
      trimmed.includes('查詢商品') ||
      trimmed.includes('列出商品') ||
      trimmed.includes('有哪些商品') ||
      trimmed.includes('所有商品') ||
      trimmed.includes('既有商品') ||
      trimmed.includes('查詢產品') ||
      trimmed.includes('列出產品')
    ) {
      return { tool: 'list_products' };
    }
    return null;
  }
};

/** @type {import('./types.js').AgentProfile} */
export const productManagementAgentProfile = {
  id: 'product.create_basic_profile',
  domain: 'product',
  systemPrompt: '你是一個商品資料管理助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。',
  tools: [
    listProductsToolHandler.definition,
    createProductToolHandler.definition
  ],
  toolHandlers: [
    listProductsToolHandler,
    createProductToolHandler
  ],
  getFallbackMessage(activeTask) {
    return activeTask?.status !== 'done'
      ? '請告訴我想建立的商品名稱、分類（轉售商品／自製成品／原物料）及標準售價，或詢問目前已建立的商品清單。'
      : '「新增商品」任務已於稍早完成。若您想繼續新增其他商品或查詢列表，請直接告訴我。';
  },
  quickAction: {
    title: '📦 快速建立商品引導',
    desc: '點擊下方按鈕可快速觸發建立「智能核心晶片」轉售商品的確認流程：',
    buttonText: '✨ 建立商品「智能核心晶片」',
    defaultTool: 'create_product',
    defaultArgs: { name: '智能核心晶片 (AI Core Chip)', category: '轉售商品', selling_price: 120 }
  }
};
