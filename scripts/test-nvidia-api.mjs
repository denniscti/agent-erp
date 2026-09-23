// ==============================================================================
// NVIDIA NIM API Function / Tool Calling 測試腳本
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
  console.log("請在 .env 檔案設定 NVIDIA_API_KEY=nvapi-...，或於終端機設定環境變數：");
  console.log("  macOS / Linux: export NVIDIA_API_KEY=\"nvapi-...\"");
  console.log("  Windows (PS) : $env:NVIDIA_API_KEY=\"nvapi-...\"");
  console.log("  Windows (CMD): set NVIDIA_API_KEY=nvapi-...");
  process.exit(1);
}

const BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "z-ai/glm-5.3-flash";
const SYSTEM_PROMPT = "你是一個組織架構助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。";

const TOOLS = [
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
];

const testCases = [
  // --- 類別一：create_department（建立部門） ---
  {
    id: "TC-01",
    input: "我想新增行銷部",
    category: "建立部門 - 標準句型",
    expectedTool: "create_department",
    expectedArgCheck: (args) => args.name === "行銷部"
  },
  {
    id: "TC-02",
    input: "幫我設立一個全球運籌中心",
    category: "建立部門 - 口語/非『部』結尾單位",
    expectedTool: "create_department",
    expectedArgCheck: (args) => args.name?.includes("全球運籌中心")
  },
  {
    id: "TC-03",
    input: "請建立「AI 研發部」",
    category: "建立部門 - 含引號/書名號",
    expectedTool: "create_department",
    expectedArgCheck: (args) => args.name?.includes("AI 研發部") || args.name?.includes("AI研發部")
  },
  {
    id: "TC-04",
    input: "幫我開一個 DevOps 核心小組",
    category: "建立部門 - 中英混雜單位名稱",
    expectedTool: "create_department",
    expectedArgCheck: (args) => args.name?.includes("DevOps")
  },
  {
    id: "TC-05",
    input: "新增 人事部",
    category: "建立部門 - 簡短指令與空格",
    expectedTool: "create_department",
    expectedArgCheck: (args) => args.name === "人事部"
  },

  // --- 類別二：list_departments（查詢部門列表） ---
  {
    id: "TC-06",
    input: "目前有哪些部門？列給我看",
    category: "查詢部門 - 標準問句",
    expectedTool: "list_departments",
    expectedArgCheck: () => true
  },
  {
    id: "TC-07",
    input: "查一下部門列表",
    category: "查詢部門 - 簡短口語",
    expectedTool: "list_departments",
    expectedArgCheck: () => true
  },
  {
    id: "TC-08",
    input: "組織架構裡現在有哪些單位？",
    category: "查詢部門 - 語意同義詞 (組織/單位)",
    expectedTool: "list_departments",
    expectedArgCheck: () => true
  },
  {
    id: "TC-09",
    input: "列出所有 departments 清單",
    category: "查詢部門 - 中英混雜關鍵字",
    expectedTool: "list_departments",
    expectedArgCheck: () => true
  },

  // --- 類別三：無關意圖 / 邊界（不呼叫工具 / None） ---
  {
    id: "TC-10",
    input: "今天天氣真好，幫我查個天氣",
    category: "無關輸入 - 閒聊與天氣",
    expectedTool: null,
    expectedArgCheck: () => true
  },
  {
    id: "TC-11",
    input: "幫我導出上個月的財務報表",
    category: "無關輸入 - 跨模組業務指令",
    expectedTool: null,
    expectedArgCheck: () => true
  },
  {
    id: "TC-12",
    input: "這部電腦多少錢？",
    category: "歧義測試 - 含『部』字但為量詞非組織部門",
    expectedTool: null,
    expectedArgCheck: () => true
  },
  {
    id: "TC-13",
    input: "你好，你可以幫我做什麼？",
    category: "功能詢問 - 助手自介與打招呼",
    expectedTool: null,
    expectedArgCheck: () => true
  }
];

async function runTest() {
  console.log("\x1b[36m==============================================================================\x1b[0m");
  console.log(`📡 NVIDIA NIM API Function / Tool Calling 完整測試資料集驗證`);
  console.log(`端點: ${BASE_URL}`);
  console.log(`模型: ${MODEL}`);
  console.log(`工具清單: ${TOOLS.map(t => t.function.name).join(', ')}`);
  console.log(`測試案例總數: ${testCases.length} 筆`);
  console.log("\x1b[36m==============================================================================\x1b[0m\n");

  let successCount = 0;
  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    process.stdout.write(`[${tc.id}] 輸入: "${tc.input}" (${tc.category})...\n`);

    try {
      const startTime = Date.now();
      const response = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: tc.input }
          ],
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0,
          max_tokens: 512
        })
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      if (!response.ok) {
        const errText = await response.text();
        console.log(`\x1b[31m   ❌ 請求失敗: HTTP ${response.status}: ${errText}\x1b[0m\n`);
        results.push({ id: tc.id, pass: false, note: `HTTP ${response.status}` });
        continue;
      }

      const data = await response.json();
      const choice = data.choices?.[0]?.message;
      const toolCalls = choice?.tool_calls;
      const firstCall = toolCalls?.[0];

      if (tc.expectedTool) {
        if (firstCall && firstCall.function?.name === tc.expectedTool) {
          const args = JSON.parse(firstCall.function.arguments || "{}");
          if (tc.expectedArgCheck(args)) {
            console.log(`\x1b[32m   ✅ 成功命中: ${tc.expectedTool} (${elapsed}s)\x1b[0m`);
            console.log(`      參數: ${JSON.stringify(args)}\n`);
            successCount++;
            results.push({ id: tc.id, pass: true, tool: tc.expectedTool, args, elapsed });
          } else {
            console.log(`\x1b[33m   ⚠️ 工具名稱正確但參數不符: ${JSON.stringify(args)}\x1b[0m\n`);
            results.push({ id: tc.id, pass: false, note: `參數不符: ${JSON.stringify(args)}` });
          }
        } else {
          console.log(`\x1b[31m   ❌ 未命中預期工具: 實際回傳 tool=${firstCall?.function?.name || 'none'}\x1b[0m\n`);
          results.push({ id: tc.id, pass: false, note: `預期 ${tc.expectedTool}，實際 ${firstCall?.function?.name || 'none'}` });
        }
      } else {
        if (!toolCalls || toolCalls.length === 0) {
          console.log(`\x1b[32m   ✅ 成功不呼叫任何工具 (純文字回覆, ${elapsed}s)\x1b[0m`);
          const summary = (choice?.content || '').replace(/\n/g, ' ').slice(0, 70);
          console.log(`      回覆摘要: "${summary}..."\n`);
          successCount++;
          results.push({ id: tc.id, pass: true, tool: 'none', elapsed });
        } else {
          console.log(`\x1b[31m   ❌ 預期不呼叫工具，但模型呼叫了: ${firstCall?.function?.name}\x1b[0m\n`);
          results.push({ id: tc.id, pass: false, note: `誤觸發 ${firstCall?.function?.name}` });
        }
      }
    } catch (err) {
      console.log(`\x1b[31m   ❌ 連線異常: ${err.message}\x1b[0m\n`);
      results.push({ id: tc.id, pass: false, note: err.message });
    }
  }

  console.log("\x1b[36m==============================================================================\x1b[0m");
  console.log(`📊 測試總結報告：`);
  console.log(`   - 測試案例通過率: ${successCount} / ${testCases.length} (${((successCount / testCases.length) * 100).toFixed(1)}%)`);
  if (successCount === testCases.length) {
    console.log(`\x1b[32m🎉 13 筆測試案例全數通過！NVIDIA NIM Tool Calling 在各種口語與歧義情境下皆表現優異。\x1b[0m`);
  } else {
    console.log(`\x1b[33m⚠️ 有部分測試未通過，請參考上方日誌。\x1b[0m`);
  }
  console.log("\x1b[36m==============================================================================\x1b[0m");
}

runTest();
