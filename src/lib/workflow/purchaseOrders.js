/**
 * @file purchaseOrders.js
 * @description ToolHandler declarations and AgentProfile for Purchase Orders task-driven workflow (Issue #173).
 * Supports dynamic catalog context injection, multi-line draft creation, order submission, receipt confirmation with quantity discrepancies, and cancellation.
 * Conforms to docs/system_design/task_driven_workflow.md §3.3 and .agent/rules/test-strategy.md.
 */

import { invoke } from '../tauri.js';

/**
 * Builds or retrieves the catalog context for dynamic prompt injection.
 * @param {any} [context]
 * @returns {Promise<{ vendors: Array<any>, products: Array<any> }>}
 */
export async function buildCatalogContext(context = {}) {
  if (context?.catalog) {
    return context.catalog;
  }

  // 1. Fetch available vendors
  let vendors = [];
  try {
    const partners = await invoke('list_partners');
    vendors = (partners || [])
      .filter((p) => p.is_vendor)
      .map((p) => ({
        partner_id: p.id,
        name: p.name,
        tax_id: p.tax_id || null
      }));
  } catch (err) {
    console.warn('[purchaseOrders] Failed to load partners for context:', err);
  }

  // 2. Fetch purchasable products with variants, units, and default supply costs
  let products = [];
  try {
    const prods = await invoke('list_products');
    for (const prod of prods || []) {
      if (!prod.is_purchasable) continue;
      try {
        const detail = await invoke('get_product_detail', {
          product_id: prod.id,
          productId: prod.id
        });
        const variantMap = new Map((detail.variants || []).map((v) => [v.id, v.name]));
        const units = (detail.units || []).map((u) => {
          const variantName = variantMap.get(u.variant_id) || '標準';
          const sources = (detail.supply_sources || []).filter((s) => s.unit_id === u.id);
          const primary = sources.find((s) => s.is_primary) || sources[0];
          return {
            unit_id: u.id,
            name: u.unit_name,
            variant_name: variantName,
            default_cost: primary ? primary.purchase_cost : (u.selling_price || 0),
            vendor_partner_id: primary ? primary.vendor_partner_id : null
          };
        });
        products.push({
          product_id: prod.id,
          name: prod.name,
          units
        });
      } catch (detailErr) {
        console.warn('[purchaseOrders] Failed to load detail for product', prod.id, detailErr);
      }
    }
  } catch (err) {
    console.warn('[purchaseOrders] Failed to load products for context:', err);
  }

  return { vendors, products };
}

/**
 * Formats catalog data into structured context injection string for AgentProfile.
 * Matches #163 spike script structure.
 * @param {{ vendors: Array<any>, products: Array<any> }} catalog
 * @returns {string}
 */
export function formatCatalogContextPrompt(catalog) {
  return `### 系統現有供應商目錄（Context）：
${JSON.stringify(catalog?.vendors || [], null, 2)}

### 系統現有商品與單位成本目錄（Context）：
${JSON.stringify(catalog?.products || [], null, 2)}

### 意圖解析準則：
1. 供應商比對：根據使用者口語提及的供應商名稱模糊比對目錄中的 partner_id。若提及不存在的供應商，請直接以文字說明查無該供應商，不要任意捏造 partner_id，亦不要呼叫工具。
2. 商品與單位比對：模糊匹配商品名稱與計量單位，填入對應的 unit_id、quantity 與目錄中的預設成本 unit_price。若商品不存在於目錄，不要盲猜 ID，請以文字說明。
3. 歧義處理：若使用者提及的品項有複數高度相似商品無法唯一確定，或者供應商有歧義，絕對不要任意猜測，請以文字條列出相似選項並詢問使用者澄清，不呼叫工具。
4. 若使用者意圖為推進既有採購單（例如「可以下單了」、「貨到了」、「取消這張單」），請呼叫對應推進工具或以文字回覆。
5. 若無符合意圖，請以文字回覆，不要呼叫任何工具。`;
}

/**
 * Helper to locate the active Purchase Order bound to a Task.
 * @param {string | null} taskId
 * @param {string | null} [explicitOrderId]
 * @returns {Promise<any | null>}
 */
export async function findPurchaseOrderForTask(taskId, explicitOrderId = null) {
  if (explicitOrderId && String(explicitOrderId).trim()) {
    const trimmedId = String(explicitOrderId).trim();
    try {
      const res = await invoke('get_purchase_order', {
        order_id: trimmedId,
        orderId: trimmedId
      });
      return res ? (res.order ? { ...res.order, lines: res.lines } : res) : null;
    } catch {
      // Fallback to task lookup
    }
  }

  if (!taskId) return null;

  try {
    const list = await invoke('list_purchase_orders');
    const matched = (list || []).find((po) => po.task_id === taskId);
    if (!matched) return null;

    const res = await invoke('get_purchase_order', {
      order_id: matched.id,
      orderId: matched.id
    });
    return res ? (res.order ? { ...res.order, lines: res.lines } : res) : null;
  } catch (err) {
    console.warn('[purchaseOrders] Failed to find purchase order for task:', err);
    return null;
  }
}

/**
 * Helper to resolve product / unit display name from unit_id
 * @param {string} unitId
 * @param {any} [catalog]
 * @returns {Promise<{ productName: string, variantName: string, unitName: string, defaultCost: number, vendorPartnerId: string | null }>}
 */
export async function resolveUnitInfo(unitId, catalog = null) {
  if (catalog?.products) {
    for (const prod of catalog.products) {
      const foundUnit = (prod.units || []).find((u) => u.unit_id === unitId);
      if (foundUnit) {
        return {
          productName: prod.name,
          variantName: foundUnit.variant_name || '標準',
          unitName: foundUnit.name || '個',
          defaultCost: foundUnit.default_cost || 0,
          vendorPartnerId: foundUnit.vendor_partner_id || null
        };
      }
    }
  }

  // Fallback to dynamic lookup if not in catalog
  try {
    const prods = await invoke('list_products');
    for (const prod of prods || []) {
      const detail = await invoke('get_product_detail', { product_id: prod.id, productId: prod.id });
      const foundUnit = (detail.units || []).find((u) => u.id === unitId);
      if (foundUnit) {
        const variantMap = new Map((detail.variants || []).map((v) => [v.id, v.name]));
        const sources = (detail.supply_sources || []).filter((s) => s.unit_id === unitId);
        const primary = sources.find((s) => s.is_primary) || sources[0];
        return {
          productName: prod.name,
          variantName: variantMap.get(foundUnit.variant_id) || '標準',
          unitName: foundUnit.unit_name || '個',
          defaultCost: primary ? primary.purchase_cost : (foundUnit.selling_price || 0),
          vendorPartnerId: primary ? primary.vendor_partner_id : null
        };
      }
    }
  } catch (err) {
    console.warn('[purchaseOrders] Error resolving unit info:', err);
  }

  return {
    productName: '未知商品',
    variantName: '標準',
    unitName: '單位',
    defaultCost: 0,
    vendorPartnerId: null
  };
}

/**
 * Helper to resolve vendor name from partner_id
 * @param {string} partnerId
 * @param {any} [catalog]
 * @returns {Promise<string>}
 */
export async function resolveVendorName(partnerId, catalog = null) {
  if (catalog?.vendors) {
    const v = catalog.vendors.find((item) => item.partner_id === partnerId);
    if (v) return v.name;
  }
  try {
    const partners = await invoke('list_partners');
    const matched = (partners || []).find((p) => p.id === partnerId);
    if (matched) return matched.name;
  } catch (err) {
    console.warn('[purchaseOrders] Error resolving vendor name:', err);
  }
  return partnerId || '未知供應商';
}

// ==============================================================================
// ToolHandler 1: create_purchase_order (整批多明細建單草稿)
// ==============================================================================

/** @type {import('./types.js').ToolHandler} */
export const createPurchaseOrderToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'create_purchase_order',
      description: '建立一筆新的採購單草稿，包含供應商與多筆採購品項明細',
      parameters: {
        type: 'object',
        properties: {
          vendor_partner_id: {
            type: 'string',
            description: '對應供應商之 partner_id（必須存在於系統目錄）'
          },
          items: {
            type: 'array',
            description: '採購明細項目清單',
            items: {
              type: 'object',
              properties: {
                unit_id: {
                  type: 'string',
                  description: '商品單位的 unit_id（必須存在於系統目錄）'
                },
                quantity: {
                  type: 'number',
                  description: '採購數量（必須大於 0）'
                },
                unit_price: {
                  type: 'number',
                  description: '預計採購單價（參考目錄成本或口語指定，可選）'
                }
              },
              required: ['unit_id', 'quantity']
            }
          },
          note: {
            type: 'string',
            description: '選填備註資訊'
          }
        },
        required: ['vendor_partner_id', 'items']
      }
    }
  },
  requiresConfirmation: true,
  completesTask: false,
  confirmLabel: '確認建立採購單',
  cancelLabel: '取消',

  async prepareConfirmation(args, context = {}) {
    const vendorId = args?.vendor_partner_id ? String(args.vendor_partner_id).trim() : '';
    if (!vendorId) {
      throw new Error('未指定有效的供應商。若對話無法精準解析，建議前往 採購單工作區表單（/app/purchase-orders） 進行手動建立。');
    }

    const items = Array.isArray(args?.items) ? args.items : [];
    if (items.length === 0) {
      throw new Error('採購單至少需有 1 筆明細。若對話無法精準解析，建議前往 採購單工作區表單（/app/purchase-orders） 進行手動建立。');
    }

    const catalog = context?.catalog || (await buildCatalogContext(context));

    // Verify vendor
    const vendorName = await resolveVendorName(vendorId, catalog);
    if (!catalog.vendors.some((v) => v.partner_id === vendorId)) {
      throw new Error(`查無供應商「${vendorId}」。若對話無法精準辨識，建議前往 採購單工作區表單（/app/purchase-orders） 進行手動建立。`);
    }

    // Resolve and validate line items
    const resolvedItems = [];
    let grandTotal = 0;
    const seenUnits = new Set();

    for (const item of items) {
      const uId = item?.unit_id ? String(item.unit_id).trim() : '';
      if (!uId) {
        throw new Error('明細項目缺少 unit_id。若對話無法精準辨識，建議前往 採購單工作區表單（/app/purchase-orders） 進行手動建立。');
      }
      if (seenUnits.has(uId)) {
        throw new Error(`同一採購單內商品單位不可重複 (${uId})。請合併數量或前往 採購單工作區表單（/app/purchase-orders） 編輯。`);
      }
      seenUnits.add(uId);

      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`採購數量必須大於 0（目前為: ${item.quantity}）。`);
      }

      const uInfo = await resolveUnitInfo(uId, catalog);
      if (uInfo.productName === '未知商品') {
        throw new Error(`查無商品單位「${uId}」。若對話無法精準辨識，建議前往 採購單工作區表單（/app/purchase-orders） 進行手動建立。`);
      }

      const cost = item.unit_price !== undefined && !isNaN(Number(item.unit_price))
        ? Number(item.unit_price)
        : uInfo.defaultCost;
      if (cost < 0) {
        throw new Error('採購單價不可為負數。');
      }

      const subtotal = Math.round(qty * cost * 100) / 100;
      grandTotal += subtotal;

      resolvedItems.push({
        unit_id: uId,
        quantity: qty,
        unit_price: cost,
        product_name: uInfo.productName,
        variant_name: uInfo.variantName,
        unit_name: uInfo.unitName,
        subtotal,
        is_prefilled: item.unit_price === undefined
      });
    }

    args._resolvedVendorName = vendorName;
    args._resolvedItems = resolvedItems;
    args._grandTotal = Math.round(grandTotal * 100) / 100;
  },

  describeConfirmation(args) {
    const vendorName = args._resolvedVendorName || args.vendor_partner_id;
    const items = args._resolvedItems || [];
    const total = args._grandTotal || 0;

    const lineDescriptions = items.map((it) => {
      const sourceTag = it.is_prefilled ? '（供應來源預填）' : '（指定單價）';
      return `  • ${it.product_name} (${it.variant_name})：${it.quantity} ${it.unit_name} × NT$ ${it.unit_price} = NT$ ${it.subtotal} ${sourceTag}`;
    }).join('\n');

    return `偵測到您想向「${vendorName}」建立採購單草稿，明細共 ${items.length} 項：\n${lineDescriptions}\n總計預估金額：NT$ ${total}\n\n確認要建立這張採購單草稿嗎？（若對話辨識有誤，您亦可隨時前往 採購單工作區表單（/app/purchase-orders） 手動編輯）`;
  },

  async execute(args, context = {}) {
    const taskId = context?.taskId || context?.activeTask?.id || null;
    const items = args._resolvedItems || args.items || [];
    const initialLines = items.map((it) => ({
      unit_id: it.unit_id,
      quantity: Number(it.quantity),
      purchase_cost: it.unit_price !== undefined ? Number(it.unit_price) : undefined
    }));

    const result = await invoke('create_purchase_order', {
      vendor_partner_id: args.vendor_partner_id,
      vendorPartnerId: args.vendor_partner_id,
      currency: 'TWD',
      note: args.note || null,
      task_id: taskId,
      taskId: taskId,
      initial_lines: initialLines,
      initialLines: initialLines
    });

    const normalized = result?.order ? { ...result.order, lines: result.lines } : result;

    return {
      order: normalized,
      completesTask: false
    };
  },

  formatResult(result) {
    const order = result?.order || result;
    const poNum = order?.po_number || '草稿';
    const linesCount = order?.lines?.length || 0;
    const total = order?.total_amount || 0;
    return `已為您成功建立採購單「${poNum}」（草稿 draft，共 ${linesCount} 筆明細，總計 NT$ ${total}）。\n如欲送出下單，可在此對話輸入「可以下單了」或「送出這張單」。`;
  },

  describeToast(result) {
    const order = result?.order || result;
    return `已成功建立採購單「${order?.po_number || ''}」草稿！`;
  },

  describeTaskSummary(result) {
    const order = result?.order || result;
    return `✅ 採購單已建立草稿（單號：${order?.po_number || ''}）`;
  },

  describeCancel() {
    return '好的，已取消建立採購單。若需重新指定品項請直接告訴我，或前往 採購單工作區表單（/app/purchase-orders） 進行手動建單。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    // Simple single-item natural fallback (e.g. 跟大同買 5 台螢幕)
    const simpleMatch = trimmed.match(/(?:跟|向)\s*([^\s]+?)\s*(?:買|訂購|採購)\s*(\d+)\s*([^\s]+?)\s*([^\s,，。]+)/);
    if (simpleMatch) {
      return {
        tool: 'create_purchase_order',
        vendor_name_candidate: simpleMatch[1],
        quantity_candidate: Number(simpleMatch[2]),
        unit_candidate: simpleMatch[3],
        product_candidate: simpleMatch[4]
      };
    }
    return null;
  }
};

// ==============================================================================
// ToolHandler 2: submit_purchase_order (推進狀態：draft -> ordered)
// ==============================================================================

/** @type {import('./types.js').ToolHandler} */
export const submitPurchaseOrderToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'submit_purchase_order',
      description: '送出採購單下單（狀態轉換：草稿 draft -> 已下單 ordered）',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: '採購單 ID（選填，若未提供將由當前任務上下文自動關聯）'
          }
        }
      }
    }
  },
  requiresConfirmation: true,
  completesTask: false,
  confirmLabel: '確認送出下單',
  cancelLabel: '暫不下單',

  async prepareConfirmation(args, context = {}) {
    const taskId = context?.taskId || context?.activeTask?.id || null;
    const po = await findPurchaseOrderForTask(taskId, args?.order_id);

    if (!po) {
      throw new Error('當前任務尚未建立採購單草稿，無法送出下單。請先透過對話建立採購單，或前往 採購單工作區表單（/app/purchase-orders） 進行建立。');
    }

    if (po.status === 'ordered') {
      throw new Error(`採購單「${po.po_number}」已處於已下單 (ordered) 狀態，無需重複送出。`);
    }

    if (po.status !== 'draft') {
      throw new Error(`採購單「${po.po_number}」目前處於 ${po.status} 狀態，不可送出下單。`);
    }

    if (!po.lines || po.lines.length === 0) {
      throw new Error(`採購單「${po.po_number}」至少需有 1 筆明細方可下單。`);
    }

    args._resolvedOrder = po;
    args.order_id = po.id;
  },

  describeConfirmation(args) {
    const po = args._resolvedOrder;
    const poNum = po?.po_number || '';
    const vendorName = po?.vendor_name_snapshot || '供應商';
    const count = po?.lines?.length || 0;
    const total = po?.total_amount || 0;

    return `偵測到您想送出採購單「${poNum}」（供應商：${vendorName}，共 ${count} 項明細，總金額 NT$ ${total}），確認送出下單嗎？`;
  },

  async execute(args) {
    const orderId = args.order_id || args._resolvedOrder?.id;
    const result = await invoke('submit_purchase_order', {
      order_id: orderId,
      orderId: orderId
    });

    const normalized = result?.order ? { ...result.order, lines: result.lines } : result;

    return {
      order: normalized,
      completesTask: false
    };
  },

  formatResult(result) {
    const order = result?.order || result;
    return `採購單「${order?.po_number}」已成功送出下單（狀態更新為：已下單 ordered）。\n待商品全數送達或部分到貨時，請在對話輸入「貨到了」進行入庫驗收。`;
  },

  describeToast(result) {
    const order = result?.order || result;
    return `採購單「${order?.po_number}」已成功送出下單！`;
  },

  describeTaskSummary(result) {
    const order = result?.order || result;
    return `✅ 採購單「${order?.po_number}」已送出下單`;
  },

  describeCancel() {
    return '好的，暫不送出下單，採購單維持草稿狀態。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (/(?:可以下單了|送出這張單|送出採購單|確認下單|送出下單|送出單據|確認送出|下單吧|向廠商下單)/.test(trimmed)) {
      return { tool: 'submit_purchase_order' };
    }
    return null;
  }
};

// ==============================================================================
// ToolHandler 3: confirm_purchase_order_received (推進狀態：ordered -> received, completesTask: true)
// ==============================================================================

/** @type {import('./types.js').ToolHandler} */
export const confirmPurchaseOrderReceivedToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'confirm_purchase_order_received',
      description: '確認採購單到貨入庫（狀態轉換：已下單 ordered -> 已到貨 received，並生成入庫庫存流水帳，完成任務）',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: '採購單 ID（選填，若未提供由任務上下文自動解析）'
          },
          line_received_quantities: {
            type: 'array',
            description: '各明細項實到數量清單（若未指定則預設照訂購量全數到貨）',
            items: {
              type: 'object',
              properties: {
                line_id: {
                  type: 'string',
                  description: '明細項 line_id'
                },
                unit_id: {
                  type: 'string',
                  description: '商品單位 unit_id（若未給 line_id 可用 unit_id 比對）'
                },
                product_name: {
                  type: 'string',
                  description: '商品名稱（模糊比對）'
                },
                received_quantity: {
                  type: 'number',
                  description: '實際到貨數量'
                }
              },
              required: ['received_quantity']
            }
          }
        }
      }
    }
  },
  requiresConfirmation: true,
  completesTask: true,
  confirmLabel: '確認入庫到貨',
  cancelLabel: '取消',

  async prepareConfirmation(args, context = {}) {
    const taskId = context?.taskId || context?.activeTask?.id || null;
    const po = await findPurchaseOrderForTask(taskId, args?.order_id);

    if (!po) {
      throw new Error('當前任務尚未建立或找到採購單，無法確認到貨。請先建立採購單並下單。');
    }

    if (po.status === 'draft') {
      throw new Error(`採購單「${po.po_number}」目前仍為草稿狀態，尚未送出下單。請先輸入「可以下單了」送出採購單。`);
    }

    if (po.status === 'received') {
      throw new Error(`採購單「${po.po_number}」已經確認到貨入庫，無法重複確認。`);
    }

    if (po.status === 'cancelled') {
      throw new Error(`採購單「${po.po_number}」已取消，無法進行到貨確認。`);
    }

    const lines = po.lines || [];
    if (lines.length === 0) {
      throw new Error(`採購單「${po.po_number}」無任何明細項目。`);
    }

    // Resolve received quantity per line
    const inputRecs = Array.isArray(args.line_received_quantities)
      ? args.line_received_quantities
      : (Array.isArray(args.items) ? args.items : []);

    const finalLineReceivedList = [];
    const displayLines = [];
    let hasDiscrepancy = false;

    for (const line of lines) {
      // Find matching item from inputRecs
      const matchedInput = inputRecs.find((rec) => {
        if (rec.line_id && String(rec.line_id).trim() === line.id) return true;
        if (rec.unit_id && String(rec.unit_id).trim() === line.unit_id) return true;
        if (rec.product_name && line.product_name_snapshot) {
          const pName = String(rec.product_name).toLowerCase();
          const targetName = String(line.product_name_snapshot).toLowerCase();
          return targetName.includes(pName) || pName.includes(targetName);
        }
        return false;
      });

      let recQty = line.quantity;
      let specified = false;

      if (matchedInput && matchedInput.received_quantity !== undefined) {
        const parsed = Number(matchedInput.received_quantity);
        if (!isNaN(parsed) && parsed >= 0) {
          recQty = parsed;
          specified = true;
        } else if (parsed < 0) {
          throw new Error(`實到數量不可為負數（商品「${line.product_name_snapshot}」: ${matchedInput.received_quantity}）。`);
        }
      }

      if (recQty !== line.quantity) {
        hasDiscrepancy = true;
      }

      finalLineReceivedList.push({
        line_id: line.id,
        received_quantity: recQty
      });

      displayLines.push({
        line_id: line.id,
        product_name: line.product_name_snapshot || '商品',
        variant_name: line.variant_name_snapshot || '標準',
        unit_name: line.unit_name_snapshot || '單位',
        ordered_quantity: line.quantity,
        received_quantity: recQty,
        has_difference: recQty !== line.quantity,
        specified
      });
    }

    args._resolvedOrder = po;
    args._displayLines = displayLines;
    args._finalLineReceivedList = finalLineReceivedList;
    args._hasDiscrepancy = hasDiscrepancy;
    args.order_id = po.id;
  },

  describeConfirmation(args) {
    const po = args._resolvedOrder;
    const lines = args._displayLines || [];

    const lineText = lines.map((l) => {
      if (l.has_difference) {
        const diff = l.received_quantity - l.ordered_quantity;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        return `  • ⚠️ ${l.product_name} (${l.variant_name})：訂購 ${l.ordered_quantity} ${l.unit_name}，實到 ${l.received_quantity} ${l.unit_name}（差異：${diffStr}）`;
      }
      return `  • ${l.product_name} (${l.variant_name})：訂購 ${l.ordered_quantity} ${l.unit_name}，實到 ${l.received_quantity} ${l.unit_name}（全數到貨）`;
    }).join('\n');

    const note = args._hasDiscrepancy
      ? '（偵測到部分項目實到數量有差異，其餘未指定明細預設照訂購量全數到貨，請確認）'
      : '（全數明細照訂購量到貨入庫）';

    return `偵測到採購單「${po?.po_number}」到貨資訊如下 ${note}：\n${lineText}\n\n確認要執行到貨驗收入庫嗎？確認後將寫入入庫庫存流水帳，並將本任務標記為完成。`;
  },

  async execute(args) {
    const orderId = args.order_id || args._resolvedOrder?.id;
    const list = args._finalLineReceivedList || [];

    const result = await invoke('confirm_purchase_order_received', {
      order_id: orderId,
      orderId: orderId,
      line_received_quantities: list,
      lineReceivedQuantities: list
    });

    const normalized = result?.order ? { ...result.order, lines: result.lines } : result;

    return {
      order: normalized,
      completesTask: true
    };
  },

  formatResult(result) {
    const order = result?.order || result;
    return `採購單「${order?.po_number}」已成功確認到貨入庫！庫存異動流水帳已建立，任務已圓滿完成 (DONE)。`;
  },

  describeToast(result) {
    const order = result?.order || result;
    return `採購單「${order?.po_number}」到貨驗收完成，任務結案！`;
  },

  describeTaskSummary(result) {
    const order = result?.order || result;
    return `✅ 採購單「${order?.po_number}」已全數驗收到貨入庫`;
  },

  describeCancel() {
    return '好的，暫不到貨入庫，採購單維持已下單 (ordered) 狀態。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();

    // If text contains quantitative discrepancy keywords (e.g. "只來了", "少了", "多了", digits),
    // let dynamic profile LLM parse it rather than defaulting to full receipt
    if (/(?:只來了|只有|只到|少了|缺|多到|\d+\s*(?:台|個|隻|條|把|組|片|支|箱|包))/.test(trimmed)) {
      return null;
    }

    if (/(?:貨到了|確認到貨|全數到貨|商品已送達|東西到了|已到貨|收到貨了|已收貨|確認入庫)/.test(trimmed)) {
      return { tool: 'confirm_purchase_order_received' };
    }
    return null;
  }
};

// Alias handler for mark_purchase_order_received
export const markPurchaseOrderReceivedToolHandler = {
  ...confirmPurchaseOrderReceivedToolHandler,
  definition: {
    ...confirmPurchaseOrderReceivedToolHandler.definition,
    function: {
      ...confirmPurchaseOrderReceivedToolHandler.definition.function,
      name: 'mark_purchase_order_received'
    }
  }
};

// ==============================================================================
// ToolHandler 4: cancel_purchase_order (推進狀態：draft / ordered -> cancelled, cancelsTask: true)
// ==============================================================================

/** @type {import('./types.js').ToolHandler} */
export const cancelPurchaseOrderToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'cancel_purchase_order',
      description: '取消採購單（狀態轉換：草稿 draft 或已下單 ordered -> 已取消 cancelled，並標記任務取消）',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: '採購單 ID（選填，若未提供由任務上下文自動解析）'
          }
        }
      }
    }
  },
  requiresConfirmation: true,
  cancelsTask: true,
  confirmLabel: '確認取消採購單',
  cancelLabel: '暫不取消',

  async prepareConfirmation(args, context = {}) {
    const taskId = context?.taskId || context?.activeTask?.id || null;
    const po = await findPurchaseOrderForTask(taskId, args?.order_id);

    if (!po) {
      throw new Error('當前任務尚未建立採購單，無可取消的單據。');
    }

    if (po.status === 'received') {
      throw new Error(`採購單「${po.po_number}」已經確認到貨入庫，無法取消。`);
    }

    if (po.status === 'cancelled') {
      throw new Error(`採購單「${po.po_number}」已處於取消狀態，無需重複取消。`);
    }

    args._resolvedOrder = po;
    args.order_id = po.id;
  },

  describeConfirmation(args) {
    const po = args._resolvedOrder;
    const poNum = po?.po_number || '';
    const status = po?.status === 'ordered' ? '已下單' : '草稿';

    return `偵測到您想取消採購單「${poNum}」（目前狀態：${status}）。取消後將無法再推進此單據，且本任務將標記為取消 (CANCELLED)。確認要取消這張單嗎？`;
  },

  async execute(args) {
    const orderId = args.order_id || args._resolvedOrder?.id;
    const result = await invoke('cancel_purchase_order', {
      order_id: orderId,
      orderId: orderId
    });

    const normalized = result?.order ? { ...result.order, lines: result.lines } : result;

    return {
      order: normalized,
      cancelsTask: true
    };
  },

  formatResult(result) {
    const order = result?.order || result;
    return `採購單「${order?.po_number}」已取消，本任務已標記為取消 (CANCELLED)。`;
  },

  describeToast(result) {
    const order = result?.order || result;
    return `採購單「${order?.po_number}」已取消！`;
  },

  describeTaskSummary(result) {
    const order = result?.order || result;
    return `🛑 採購單「${order?.po_number}」已取消`;
  },

  describeCancel() {
    return '好的，暫不取消採購單，單據與任務維持原狀態。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (/(?:取消這張單|供應商說缺貨|取消採購單|取消採購|不要這張單了|取消訂單|不買了|取消這筆|終止採購)/.test(trimmed)) {
      return { tool: 'cancel_purchase_order' };
    }
    return null;
  }
};

// ==============================================================================
// AgentProfile: purchaseOrderAgentProfile
// ==============================================================================

/** @type {import('./types.js').AgentProfile} */
export const purchaseOrderAgentProfile = {
  id: 'vendor.manage_purchase_order',
  domain: 'vendor',
  systemPrompt: `你是一個智慧採購單助理。請根據使用者口語輸入與系統目錄資料，協助建立採購單或推進採購單狀態。

### 工具呼叫規則：
1. 建立採購單 (\`create_purchase_order\`)：使用者提出採購、買東西需求時（例如「跟大同買 5 台螢幕、3 個滑鼠」），請依據供應商目錄與商品單位目錄比對 partner_id 與 unit_id，組合成一次性的工具呼叫。
2. 送出下單 (\`submit_purchase_order\`)：使用者確認可以下單、送出採購單時呼叫。
3. 到貨入庫 (\`confirm_purchase_order_received\`)：使用者表示貨到了、確認到貨時呼叫。若使用者指出數量差異（如「貨到了，但螢幕只來了 3 台」），請在 line_received_quantities 指定該品項的實到數量。
4. 取消採購 (\`cancel_purchase_order\`)：使用者表示取消訂單、缺貨不買時呼叫。
5. 查無供應商或商品、或者有高度歧義時，**絕對不要任意捏造或盲猜 ID**，請直接以文字說明查無項目或條列相似品項請使用者澄清，不呼叫任何工具。
6. 若使用者的意圖不符合任何採購單操作，請直接回覆文字指引，不要呼叫任何工具。`,
  contextInjection: async (context = {}) => {
    const catalog = await buildCatalogContext(context);
    return formatCatalogContextPrompt(catalog);
  },
  tools: [
    createPurchaseOrderToolHandler.definition,
    submitPurchaseOrderToolHandler.definition,
    confirmPurchaseOrderReceivedToolHandler.definition,
    markPurchaseOrderReceivedToolHandler.definition,
    cancelPurchaseOrderToolHandler.definition
  ],
  toolHandlers: [
    createPurchaseOrderToolHandler,
    submitPurchaseOrderToolHandler,
    confirmPurchaseOrderReceivedToolHandler,
    markPurchaseOrderReceivedToolHandler,
    cancelPurchaseOrderToolHandler
  ],
  getFallbackMessage: () =>
    '我是採購單助理，可以協助您建立採購單草稿、送出下單、確認到貨入庫與取消採購單。請問您需要什麼協助？'
};
