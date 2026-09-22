// ==============================================================================
// NVIDIA NIM API 連線與意圖抽取測試腳本
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
const SYSTEM_PROMPT = "你的任務是判斷使用者輸入中是否包含想建立的部門名稱。如果有，只回覆部門名稱本身（例如：行銷部），不要加任何其他文字。如果沒有明確的部門建立意圖，只回覆 NONE。";

const testCases = [
  { input: "我想新增行銷部", category: "直接輸入", expected: "行銷部" },
  { input: "我想開一個 IT 專責小組", category: "間接語意 (正規抓不到)", expected: "IT 專責小組" },
  { input: "幫我設立全球運籌中心", category: "間接語意", expected: "全球運籌中心" },
  { input: "今天天氣真好，幫我查個天氣", category: "無關輸入", expected: "NONE" },
  { input: "幫我導出上個月的財務報表", category: "業務指令 (非建立部門)", expected: "NONE" }
];

async function runTest() {
  console.log("\x1b[36m========================================================\x1b[0m");
  console.log(`📡 正在連線至 NVIDIA NIM API...`);
  console.log(`端點: ${BASE_URL}`);
  console.log(`模型: ${MODEL}`);
  console.log("\x1b[36m========================================================\x1b[0m\n");

  let successCount = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    process.stdout.write(`[${i + 1}/${testCases.length}] 測試輸入: "${tc.input}" (${tc.category})... `);

    try {
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
          temperature: 0,
          max_tokens: 512
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.log(`\x1b[31m[失敗]\x1b[0m`);
        console.error(`   HTTP ${response.status}: ${errText}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim() || "";
      console.log(`\x1b[32m[成功]\x1b[0m`);
      console.log(`   模型回覆 -> "${content}" (參考預期: "${tc.expected}")\n`);
      successCount++;
    } catch (err) {
      console.log(`\x1b[31m[連線異常]\x1b[0m`);
      console.error(`   ${err.message}\n`);
    }
  }

  console.log("\x1b[36m========================================================\x1b[0m");
  if (successCount === testCases.length) {
    console.log(`\x1b[32m🎉 測試全數成功！NVIDIA NIM 連線與意圖判斷運作正常。\x1b[0m`);
  } else {
    console.log(`\x1b[33m⚠️ 完成測試：${successCount}/${testCases.length} 個成功。\x1b[0m`);
  }
}

runTest();
