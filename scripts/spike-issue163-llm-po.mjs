// ==============================================================================
// Issue #163 Spike 驗證腳本：
// 1. 動態 Profile（systemPrompt + tools）送 NIM & 部門 #93/#94 零回歸驗證
// 2. 採購單批次多明細與目錄模糊比對驗證（Context 注入）
// 3. max_tokens (512 vs 1024 vs 2048) 容納能力、截斷與延遲影響評估
// 4. 商品與供應商名稱歧義（Ambiguity）防瞎猜驗證
// ==============================================================================

import fs from 'fs';
import path from 'path';

let apiKey = process.env.NVIDIA_API_KEY;

if (!apiKey || !apiKey.trim()) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^NVIDIA_API_KEY\s*=\s*(.+)$/);
      if (match) {
        apiKey = match[1].trim().replace(/^['"]|['"]$/g, '');
        break;
      }
    }
  }
}

if (!apiKey || !apiKey.trim()) {
  console.error("\x1b[31m❌ 錯誤：未設定 NVIDIA_API_KEY 環境變數或 .env 檔案！\x1b[0m");
  process.exit(1);
}

const BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "z-ai/glm-5.3-flash";

// ------------------------------------------------------------------------------
// 通用 NIM 呼叫函式
// ------------------------------------------------------------------------------
async function callNim({ systemPrompt, userMessage, tools, maxTokens = 512, temperature = 0 }) {
  const startTime = Date.now();
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    temperature,
    max_tokens: maxTokens
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const elapsedMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const message = choice?.message;
  const toolCalls = message?.tool_calls || [];
  const content = message?.content || "";
  const usage = data.usage || {};

  return {
    elapsedMs,
    finishReason,
    content,
    toolCalls,
    usage,
    raw: data
  };
}

// ==============================================================================
// 領域一：部門 Profile 定義與既有 13 筆基準測試案例 (#93/#94)
// ==============================================================================
const departmentProfile = {
  id: 'department',
  systemPrompt: '你是一個組織架構助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。',
  tools: [
    {
      type: "function",
      function: {
        name: "create_department",
        description: "建立或新增一個組織部門",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "欲建立的部門名稱，例如：行銷部、研發部、IT專責小組"
            }
          },
          required: ["name"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_departments",
        description: "列出或查詢目前系統中已建立的所有部門列表",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    }
  ]
};

const departmentTestCases = [
  { id: "TC-D-01", input: "我想新增行銷部", expectedTool: "create_department", checkArgs: a => a.name === "行銷部" },
  { id: "TC-D-02", input: "幫我設立一個全球運籌中心", expectedTool: "create_department", checkArgs: a => a.name?.includes("全球運籌中心") },
  { id: "TC-D-03", input: "請建立「AI 研發部」", expectedTool: "create_department", checkArgs: a => a.name?.includes("AI 研發部") || a.name?.includes("AI研發部") },
  { id: "TC-D-04", input: "幫我開一個 DevOps 核心小組", expectedTool: "create_department", checkArgs: a => a.name?.includes("DevOps") },
  { id: "TC-D-05", input: "新增 人事部", expectedTool: "create_department", checkArgs: a => a.name === "人事部" },
  { id: "TC-D-06", input: "目前有哪些部門？列給我看", expectedTool: "list_departments", checkArgs: () => true },
  { id: "TC-D-07", input: "查一下部門列表", expectedTool: "list_departments", checkArgs: () => true },
  { id: "TC-D-08", input: "組織架構裡現在有哪些單位？", expectedTool: "list_departments", checkArgs: () => true },
  { id: "TC-D-09", input: "列出所有 departments 清單", expectedTool: "list_departments", checkArgs: () => true },
  { id: "TC-D-10", input: "今天天氣真好，幫我查個天氣", expectedTool: null },
  { id: "TC-D-11", input: "幫我導出上個月的財務報表", expectedTool: null },
  { id: "TC-D-12", input: "這部電腦多少錢？", expectedTool: null },
  { id: "TC-D-13", input: "你好，你可以幫我做什麼？", expectedTool: null }
];

// ==============================================================================
// 領域二：採購單 Profile 與 Mock 目錄 Context
// ==============================================================================
const mockCatalogContext = {
  vendors: [
    { partner_id: "v_tatung", name: "大同股份有限公司", tax_id: "11923456" },
    { partner_id: "v_synnex", name: "聯強國際股份有限公司", tax_id: "22019988" }
  ],
  products: [
    {
      product_id: "p_screen_27_4k",
      name: "27 吋 4K 護眼螢幕",
      units: [
        { unit_id: "u_screen_27_4k", name: "台", default_cost: 4500, vendor_partner_id: "v_tatung" }
      ]
    },
    {
      product_id: "p_mouse_silent",
      name: "2.4G 靜音無線滑鼠",
      units: [
        { unit_id: "u_mouse_silent", name: "個", default_cost: 350, vendor_partner_id: "v_tatung" }
      ]
    },
    {
      product_id: "p_kb_blue",
      name: "機械式鍵盤青軸",
      units: [
        { unit_id: "u_kb_blue", name: "把", default_cost: 1200, vendor_partner_id: "v_synnex" }
      ]
    },
    {
      product_id: "p_nb_14",
      name: "輕薄筆記型電腦 14 吋",
      units: [
        { unit_id: "u_nb_14", name: "台", default_cost: 28000, vendor_partner_id: "v_synnex" }
      ]
    },
    {
      product_id: "p_dongle",
      name: "Type-C 多功能轉接器",
      units: [
        { unit_id: "u_dongle", name: "個", default_cost: 650, vendor_partner_id: "v_synnex" }
      ]
    },
    {
      product_id: "p_cable_hdmi",
      name: "HDMI 2.1 高速傳輸線 2M",
      units: [
        { unit_id: "u_cable_hdmi", name: "條", default_cost: 180, vendor_partner_id: "v_synnex" }
      ]
    },
    {
      product_id: "p_headphone",
      name: "主動降噪耳罩式耳機",
      units: [
        { unit_id: "u_headphone", name: "支", default_cost: 2200, vendor_partner_id: "v_tatung" }
      ]
    },
    {
      product_id: "p_stand",
      name: "鋁合金筆電散熱支架",
      units: [
        { unit_id: "u_stand", name: "組", default_cost: 480, vendor_partner_id: "v_tatung" }
      ]
    }
  ]
};

function formatPurchaseSystemPrompt(catalog) {
  return `你是一個智慧採購單助理。請根據使用者口語輸入與下方系統目錄資料，協助建立採購單意圖呼叫 \`create_purchase_order\`。

### 系統現有供應商目錄（Context）：
${JSON.stringify(catalog.vendors, null, 2)}

### 系統現有商品與單位成本目錄（Context）：
${JSON.stringify(catalog.products, null, 2)}

### 意圖解析準則：
1. 供應商比對：根據使用者口語提及的供應商名稱模糊比對目錄中的 \`partner_id\`。若提及不存在的供應商，請直接以文字說明查無該供應商，不要任意捏造 \`partner_id\`，亦不要呼叫工具。
2. 商品與單位比對：模糊匹配商品名稱與計量單位，填入對應的 \`unit_id\`、\`quantity\` 與目錄中的預設成本 \`unit_price\`。若商品不存在於目錄，不要盲猜 ID，請以文字說明。
3. 歧義處理：若使用者提及的品項有複數高度相似商品無法唯一確定，或者供應商有歧義，**絕對不要任意猜測**，請以文字條列出相似選項並詢問使用者澄清，不呼叫工具。
4. 若無符合意圖，請以文字回覆，不要呼叫任何工具。`;
}

const purchaseOrderTools = [
  {
    type: "function",
    function: {
      name: "create_purchase_order",
      description: "建立一筆新的採購單，包含供應商與多筆採購品項明細",
      parameters: {
        type: "object",
        properties: {
          vendor_partner_id: {
            type: "string",
            description: "對應供應商之 partner_id（必須存在於目錄）"
          },
          items: {
            type: "array",
            description: "採購明細項目清單",
            items: {
              type: "object",
              properties: {
                unit_id: {
                  type: "string",
                  description: "商品單位的 unit_id（必須存在於目錄）"
                },
                quantity: {
                  type: "number",
                  description: "採購數量（必須大於 0）"
                },
                unit_price: {
                  type: "number",
                  description: "預計採購單價（參考目錄成本）"
                }
              },
              required: ["unit_id", "quantity"]
            }
          },
          note: {
            type: "string",
            description: "選填備註資訊"
          }
        },
        required: ["vendor_partner_id", "items"]
      }
    }
  }
];

// ==============================================================================
// 領域三：歧義測試 Context 與 Prompt
// ==============================================================================
const ambiguousCatalog = {
  vendors: [
    { partner_id: "v_tatung_corp", name: "大同股份有限公司", tax_id: "11923456" },
    { partner_id: "v_tatung_tis", name: "大同世界科技股份有限公司", tax_id: "70771234" }
  ],
  products: [
    {
      product_id: "p_screen_27_4k",
      name: "27 吋 4K 護眼螢幕 (HDMI/DP)",
      units: [{ unit_id: "u_screen_4k", name: "台", default_cost: 4500 }]
    },
    {
      product_id: "p_screen_27_gaming",
      name: "27 吋 電競 165Hz 高刷螢幕 (Type-C)",
      units: [{ unit_id: "u_screen_gaming", name: "台", default_cost: 4900 }]
    },
    {
      product_id: "p_mouse",
      name: "靜音無線滑鼠",
      units: [{ unit_id: "u_mouse", name: "個", default_cost: 350 }]
    }
  ]
};

// ==============================================================================
// 執行測試主程式
// ==============================================================================
async function runAllSpikeTests() {
  console.log("\x1b[36m==============================================================================\x1b[0m");
  console.log(`🚀 [Spike #163] LLM Profile 動態組裝 & 採購單批次自然語言解析可行性驗證`);
  console.log(`端點: ${BASE_URL} | 模型: ${MODEL}`);
  console.log("\x1b[36m==============================================================================\x1b[0m\n");

  const results = {
    q1: { passed: 0, total: departmentTestCases.length, cases: [] },
    q2: { passed: 0, total: 0, cases: [] },
    q3: { cases: [] },
    q4: { cases: [] }
  };

  // ----------------------------------------------------------------------------
  // 問題 1 驗證：動態 Profile 送審 & 部門 13 筆零回歸測試
  // ----------------------------------------------------------------------------
  console.log("\x1b[33m▶ [問題 1] 部門 Profile 動態注入驗證（既有 #93/#94 13 筆零回歸測試）...\x1b[0m");
  for (const tc of departmentTestCases) {
    try {
      const res = await callNim({
        systemPrompt: departmentProfile.systemPrompt,
        userMessage: tc.input,
        tools: departmentProfile.tools
      });

      const firstCall = res.toolCalls[0];
      let pass = false;
      let actualTool = firstCall?.function?.name || null;
      let args = {};

      if (firstCall) {
        try { args = JSON.parse(firstCall.function.arguments || "{}"); } catch {}
      }

      if (tc.expectedTool) {
        if (actualTool === tc.expectedTool && tc.checkArgs(args)) {
          pass = true;
        }
      } else {
        if (!actualTool) {
          pass = true;
        }
      }

      if (pass) {
        results.q1.passed++;
        console.log(`  ✅ [${tc.id}] "${tc.input}" -> 命中: ${actualTool || '純文字'} (${(res.elapsedMs / 1000).toFixed(2)}s)`);
      } else {
        console.log(`  ❌ [${tc.id}] "${tc.input}" -> 預期: ${tc.expectedTool}, 實際: ${actualTool}, args: ${JSON.stringify(args)}`);
      }
      results.q1.cases.push({ id: tc.id, input: tc.input, pass, elapsedMs: res.elapsedMs, actualTool, args });
    } catch (err) {
      console.log(`  ❌ [${tc.id}] 連線/執行錯誤: ${err.message}`);
      results.q1.cases.push({ id: tc.id, pass: false, error: err.message });
    }
  }
  console.log(`  📊 問題 1 結果: ${results.q1.passed} / ${results.q1.total} (${((results.q1.passed / results.q1.total) * 100).toFixed(1)}%)\n`);

  // ----------------------------------------------------------------------------
  // 問題 2 驗證：採購單批次多明細與目錄模糊比對
  // ----------------------------------------------------------------------------
  console.log("\x1b[33m▶ [問題 2] 採購單批次多明細與目錄模糊比對驗證...\x1b[0m");
  const purchaseSystemPrompt = formatPurchaseSystemPrompt(mockCatalogContext);

  const poTestCases = [
    {
      id: "TC-PO-01",
      name: "標準雙品項採購",
      input: "跟大同買 5 台 27 吋螢幕、3 個無線滑鼠",
      validate: (call, content) => {
        if (!call || call.function.name !== "create_purchase_order") return { pass: false, note: "未呼叫 create_purchase_order" };
        const args = JSON.parse(call.function.arguments);
        const vOk = args.vendor_partner_id === "v_tatung";
        const items = args.items || [];
        const item1 = items.find(i => i.unit_id === "u_screen_27_4k" && i.quantity === 5);
        const item2 = items.find(i => i.unit_id === "u_mouse_silent" && i.quantity === 3);
        const pass = vOk && !!item1 && !!item2 && items.length === 2;
        return { pass, note: `vendor=${args.vendor_partner_id}, itemsCount=${items.length}, item1=${!!item1}, item2=${!!item2}` };
      }
    },
    {
      id: "TC-PO-02",
      name: "口語化與中文數字單品項",
      input: "向大同訂購螢幕五台",
      validate: (call, content) => {
        if (!call || call.function.name !== "create_purchase_order") return { pass: false, note: "未呼叫 create_purchase_order" };
        const args = JSON.parse(call.function.arguments);
        const vOk = args.vendor_partner_id === "v_tatung";
        const items = args.items || [];
        const item1 = items.find(i => i.unit_id === "u_screen_27_4k" && i.quantity === 5);
        return { pass: vOk && !!item1, note: `vendor=${args.vendor_partner_id}, items=${JSON.stringify(items)}` };
      }
    },
    {
      id: "TC-PO-03",
      name: "同供應商 4 筆多明細批次採購",
      input: "向大同訂購 5 台 27 吋螢幕、10 個無線滑鼠、2 支耳罩式耳機、6 組筆電散熱支架",
      validate: (call, content) => {
        if (!call || call.function.name !== "create_purchase_order") return { pass: false, note: `未呼叫 create_purchase_order (回覆: ${content.slice(0, 50)}...)` };
        const args = JSON.parse(call.function.arguments);
        const items = args.items || [];
        const pass = args.vendor_partner_id === "v_tatung" && items.length === 4;
        return { pass, note: `vendor=${args.vendor_partner_id}, itemsCount=${items.length}` };
      }
    },
    {
      id: "TC-PO-04",
      name: "異常供應商（目錄外）",
      input: "跟小明商行買 2 個無線滑鼠",
      validate: (call, content) => {
        if (!call) {
          return { pass: true, note: `成功以文字說明拒絕盲猜: "${content.slice(0, 40).replace(/\n/g, ' ')}..."` };
        }
        const args = JSON.parse(call.function.arguments);
        if (args.vendor_partner_id === "v_tatung" || args.vendor_partner_id === "v_synnex") {
          return { pass: false, note: `誤將小明指派為現有供應商 ${args.vendor_partner_id}` };
        }
        return { pass: false, note: `捏造不存在之 partner_id: ${args.vendor_partner_id}` };
      }
    },
    {
      id: "TC-PO-05",
      name: "異常商品（目錄外）",
      input: "跟大同買 10 箱太空梭",
      validate: (call, content) => {
        if (!call) {
          return { pass: true, note: `成功以文字說明查無太空梭: "${content.slice(0, 40).replace(/\n/g, ' ')}..."` };
        }
        const args = JSON.parse(call.function.arguments);
        return { pass: false, note: `模型仍為不存在商品建立了 tool_call: ${JSON.stringify(args)}` };
      }
    },
    {
      id: "TC-PO-06",
      name: "跨供應商品項衝突偵測（向聯強買大同專屬螢幕）",
      input: "向聯強訂購 2 台輕薄筆記型電腦、4 台 27 吋螢幕",
      validate: (call, content) => {
        // 模型應主動指出 27 吋螢幕屬於大同而非聯強，要求使用者確認或拆單，不盲目合併
        if (!call) {
          const trimmed = (content || '').trim();
          if (trimmed.length === 0) {
            return {
              pass: false,
              note: `⚠️ 模型返回完全空白內容 (無 tool_call 亦無 content)，反映複雜推理下偶發空回應風險，需後續 pipeline 具備 retry/fallback 機制`
            };
          }
          const notesConflict = content.includes("大同") || content.includes("供應商") || content.includes("不符") || content.includes("確認") || content.includes("拆");
          return {
            pass: notesConflict,
            note: notesConflict
              ? `✅ 成功辨識商品與供應商不符衝突，文字請求確認 (${content.slice(0, 50).replace(/\n/g, ' ')}...)`
              : `⚠️ 文字未包含預期關鍵字（模型措辭變動）: "${content.slice(0, 50).replace(/\n/g, ' ')}..."`
          };
        }
        return { pass: false, note: `盲目建立了跨供應商採購單: ${call.function.arguments}` };
      }
    }
  ];

  results.q2.total = poTestCases.length;

  for (const tc of poTestCases) {
    try {
      const res = await callNim({
        systemPrompt: purchaseSystemPrompt,
        userMessage: tc.input,
        tools: purchaseOrderTools,
        maxTokens: 1024
      });

      const firstCall = res.toolCalls[0];
      const check = tc.validate(firstCall, res.content);

      if (check.pass) {
        results.q2.passed++;
        console.log(`  ✅ [${tc.id} ${tc.name}] ${(res.elapsedMs / 1000).toFixed(2)}s - ${check.note}`);
      } else {
        console.log(`  ❌ [${tc.id} ${tc.name}] ${(res.elapsedMs / 1000).toFixed(2)}s - ${check.note}`);
      }
      results.q2.cases.push({ id: tc.id, name: tc.name, pass: check.pass, elapsedMs: res.elapsedMs, note: check.note, usage: res.usage });
    } catch (err) {
      console.log(`  ❌ [${tc.id}] 錯誤: ${err.message}`);
      results.q2.cases.push({ id: tc.id, pass: false, error: err.message });
    }
  }
  console.log(`  📊 問題 2 結果: ${results.q2.passed} / ${results.q2.total} (${((results.q2.passed / results.q2.total) * 100).toFixed(1)}%)\n`);

  // ----------------------------------------------------------------------------
  // 問題 3 驗證：max_tokens 限制（512 vs 1024 vs 2048）容納度與延遲影響
  // ----------------------------------------------------------------------------
  console.log("\x1b[33m▶ [問題 3] max_tokens 限制（512 vs 1024 vs 2048）容納度與延遲評估...\x1b[0m");
  const multiItemInput = "向大同購買 5 台 27 吋 4K 護眼螢幕、10 個 2.4G 靜音無線滑鼠、3 支主動降噪耳罩式耳機、8 組鋁合金筆電散熱支架，備註請於週五前送達";

  for (const tokensLimit of [512, 1024, 2048]) {
    try {
      const res = await callNim({
        systemPrompt: purchaseSystemPrompt,
        userMessage: multiItemInput,
        tools: purchaseOrderTools,
        maxTokens: tokensLimit
      });

      const firstCall = res.toolCalls[0];
      let itemsCount = 0;
      let validJson = false;
      let rawArgsLength = 0;

      if (firstCall) {
        rawArgsLength = firstCall.function.arguments.length;
        try {
          const parsed = JSON.parse(firstCall.function.arguments);
          itemsCount = parsed.items?.length || 0;
          validJson = true;
        } catch {
          validJson = false;
        }
      }

      console.log(`  [4 筆明細基準 @ max_tokens=${tokensLimit}]`);
      console.log(`    - 耗時: ${(res.elapsedMs / 1000).toFixed(2)}s (${res.elapsedMs}ms)`);
      console.log(`    - finish_reason: ${res.finishReason}`);
      console.log(`    - Token Usage: prompt=${res.usage.prompt_tokens}, completion=${res.usage.completion_tokens}, total=${res.usage.total_tokens}`);
      console.log(`    - JSON 狀態: ${validJson ? '✅ 完整合法' : '❌ 被截斷或未呼叫'} (明細筆數: ${itemsCount}, 參數字元數: ${rawArgsLength})`);

      results.q3.cases.push({
        maxTokens: tokensLimit,
        elapsedMs: res.elapsedMs,
        finishReason: res.finishReason,
        usage: res.usage,
        validJson,
        itemsCount,
        rawArgsLength
      });
    } catch (err) {
      console.log(`  [max_tokens=${tokensLimit}] ❌ 錯誤: ${err.message}`);
    }
  }

  // 3.2 複雜衝突情境之極限壓測（驗證 512 token 耗盡截斷現象）
  console.log("\n  [極限壓測] 8 品項複雜衝突情境 @ max_tokens=512 (重現思維鏈耗盡 512 上限現象)...");
  const complexConflictInput = "向聯強訂購以下 8 項商品，請詳細列出每一項在目錄中的登記供應商、是否有衝突、衝突原因與處理建議：2 台輕薄筆記型電腦 14 吋、5 台 27 吋 4K 護眼螢幕、10 個 2.4G 靜音無線滑鼠、3 把機械式鍵盤青軸、8 個 Type-C 多功能轉接器、15 條 HDMI 2.1 高速傳輸線 2M、6 支主動降噪耳罩式耳機、12 組鋁合金筆電散熱支架";
  try {
    const res512 = await callNim({
      systemPrompt: purchaseSystemPrompt,
      userMessage: complexConflictInput,
      tools: purchaseOrderTools,
      maxTokens: 512
    });
    const contentLength = res512.content ? res512.content.length : 0;
    console.log(`    - max_tokens=512: finish_reason=${res512.finishReason}, completion_tokens=${res512.usage?.completion_tokens}, content_length=${contentLength}`);
    if (res512.finishReason === 'length') {
      console.log(`    ⚠️ 成功重現！512 tokens 全數被內部推理 (reasoning_content) 耗盡，導致 content 無法完整輸出 (${contentLength === 0 ? '整段空白' : '被截斷'})`);
    }
  } catch (err) {
    console.log(`    - 壓測執行異常: ${err.message}`);
  }
  console.log();

  // ----------------------------------------------------------------------------
  // 問題 4 驗證：名稱歧義防瞎猜評估
  // ----------------------------------------------------------------------------
  console.log("\x1b[33m▶ [問題 4] 名稱歧義（Ambiguity）防瞎猜驗證...\x1b[0m");
  const ambiguousPrompt = formatPurchaseSystemPrompt(ambiguousCatalog);

  const ambiguityCases = [
    {
      id: "TC-AMB-01",
      name: "商品名稱歧義（目錄有 4K 護眼 與 電競 165Hz 兩款 27 吋螢幕）",
      input: "跟大同買 5 台 27 吋螢幕",
      validate: (call, content) => {
        // 預期：不呼叫 tool_call 盲猜 ID，以文字詢問是哪一款
        if (!call) {
          const clarifies = content.includes("4K") || content.includes("電競") || content.includes("護眼") || content.includes("選擇") || content.includes("哪一");
          return {
            pass: clarifies,
            note: clarifies ? `✅ 成功以文字主動詢問澄清 (${content.slice(0, 50)}...)` : `⚠️ 未呼叫工具，但文字未明確列出歧義品項`
          };
        }
        const args = JSON.parse(call.function.arguments);
        return {
          pass: false,
          note: `❌ 發生盲猜！在有兩款螢幕下隨機挑選了: ${JSON.stringify(args.items?.[0])}`
        };
      }
    },
    {
      id: "TC-AMB-02",
      name: "供應商名稱歧義（目錄有 大同股份 與 大同世界科技）",
      input: "跟大同買 3 個靜音無線滑鼠",
      validate: (call, content) => {
        if (!call) {
          const clarifies = content.includes("大同股份有限公司") || content.includes("大同世界科技") || content.includes("確認") || content.includes("哪一家") || content.includes("哪一間");
          return {
            pass: clarifies,
            note: clarifies ? `✅ 成功以文字主動詢問澄清供應商 (${content.slice(0, 50)}...)` : `⚠️ 未呼叫工具，但文字未明確列出歧義供應商`
          };
        }
        const args = JSON.parse(call.function.arguments);
        return {
          pass: false,
          note: `❌ 發生盲猜！隨機挑選了供應商 ID: ${args.vendor_partner_id}`
        };
      }
    }
  ];

  for (const tc of ambiguityCases) {
    try {
      const res = await callNim({
        systemPrompt: ambiguousPrompt,
        userMessage: tc.input,
        tools: purchaseOrderTools,
        maxTokens: 512
      });

      const firstCall = res.toolCalls[0];
      const check = tc.validate(firstCall, res.content);
      console.log(`  [${tc.id} ${tc.name}]`);
      console.log(`    - 耗時: ${(res.elapsedMs / 1000).toFixed(2)}s`);
      console.log(`    - 評估: ${check.note}`);
      results.q4.cases.push({ id: tc.id, name: tc.name, pass: check.pass, elapsedMs: res.elapsedMs, note: check.note, content: res.content });
    } catch (err) {
      console.log(`  [${tc.id}] ❌ 錯誤: ${err.message}`);
    }
  }

  console.log("\n\x1b[36m==============================================================================\x1b[0m");
  console.log("🏁 所有 Spike 驗證項目執行完畢！");
  console.log("\x1b[36m==============================================================================\x1b[0m\n");

  return results;
}

runAllSpikeTests();
