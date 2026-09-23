// ==============================================================================
// AgentERP 測試資料生成與種子寫入腳本 (Seed Test Data)
// ==============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

console.log("\x1b[36m==============================================================================\x1b[0m");
console.log(`🌱 正在生成 AgentERP 系統測試資料...`);
console.log("\x1b[36m==============================================================================\x1b[0m\n");

// 1. 定義豐富的測試資料集
const now = Math.floor(Date.now() / 1000);

export const SEED_DATA = {
  departments: [
    { id: "dept_1001", name: "總經理室", parent_id: null, created_at: now - 86400 * 5 },
    { id: "dept_1002", name: "研發總處", parent_id: null, created_at: now - 86400 * 4 },
    { id: "dept_1003", name: "前端小組", parent_id: "dept_1002", created_at: now - 86400 * 3 },
    { id: "dept_1004", name: "後端架構組", parent_id: "dept_1002", created_at: now - 86400 * 3 },
    { id: "dept_1005", name: "AI 智能核心組", parent_id: "dept_1002", created_at: now - 86400 * 2 },
    { id: "dept_1006", name: "行銷業務部", parent_id: null, created_at: now - 86400 * 4 },
    { id: "dept_1007", name: "海外事業開發處", parent_id: "dept_1006", created_at: now - 86400 * 2 },
    { id: "dept_1008", name: "全球運籌中心", parent_id: null, created_at: now - 86400 * 1 },
    { id: "dept_1009", name: "財務會計處", parent_id: null, created_at: now - 86400 * 4 }
  ],

  tasks: [
    {
      id: "task_parent_1",
      title: "新租戶起步",
      status: "in_progress",
      parent_task_id: null,
      module_id: "sales",
      assignee: "主管",
      created_at: now - 3600 * 4,
      completed_at: null
    },
    {
      id: "task_sub_1",
      title: "設定部門",
      status: "pending",
      parent_task_id: "task_parent_1",
      module_id: "sales",
      assignee: "主管",
      created_at: now - 3600 * 4,
      completed_at: null
    },
    {
      id: "task_sub_2",
      title: "邀請團隊成員",
      status: "pending",
      parent_task_id: "task_parent_1",
      module_id: "sales",
      assignee: "主管",
      created_at: now - 3600 * 3,
      completed_at: null
    },
    {
      id: "task_sub_3",
      title: "配置財務審核規則",
      status: "pending",
      parent_task_id: "task_parent_1",
      module_id: "finance",
      assignee: "財務長",
      created_at: now - 3600 * 2,
      completed_at: null
    }
  ],

  taskMessages: [
    {
      id: "msg_1",
      task_id: "main",
      role: "assistant",
      content: "你好，我是 AgentERP 智能助理。已載入本地安全邊緣工作站上下文。您目前有 4 筆待處理任務、2 則未讀通知。想從下面的常用任務開始，或直接跟我說您需要什麼協助：",
      timestamp: now - 3600 * 4
    },
    {
      id: "msg_2",
      task_id: "task_sub_1",
      role: "assistant",
      content: "您好！我是部門設定助理。新租戶建立完成後，首要步驟是建立組織部門。請問您想先新增哪一個部門？（您可以直接輸入「我想新增行銷部」或詢問「目前有哪些部門」）",
      timestamp: now - 3600 * 4
    }
  ],

  orders: [
    {
      so_id: "SO-9921",
      customer_name: "A 公司 (Customer A)",
      po_reference: "PO-2026-0091",
      items_json: JSON.stringify([{ name: "智能核心晶片 (AI Core Chip)", qty: 500, price: 120 }]),
      total_amount: 60000.0,
      profit_margin: 0.25,
      capacity_usage: 0.85,
      status: "pending",
      created_at: now - 7200
    },
    {
      so_id: "SO-9922",
      customer_name: "B 企業 (Enterprise B)",
      po_reference: "PO-2026-0092",
      items_json: JSON.stringify([
        { name: "高階邊緣伺服器 (Edge Server X1)", qty: 10, price: 4500 },
        { name: "專用安全模組 (TPM v2.0)", qty: 20, price: 350 }
      ]),
      total_amount: 52000.0,
      profit_margin: 0.32,
      capacity_usage: 0.60,
      status: "pending",
      created_at: now - 3600
    }
  ],

  auditLogs: [
    {
      id: `LOG-${now - 3600 * 2}`,
      action_type: "login",
      arguments: JSON.stringify({ user: "admin@example.com", client_type: "app" }),
      decision: "success",
      operator: "Admin User",
      timestamp: now - 3600 * 2
    },
    {
      id: `LOG-${now - 3600}`,
      action_type: "select_tenant",
      arguments: JSON.stringify({ tenant_code: "numax" }),
      decision: "success",
      operator: "Admin User",
      timestamp: now - 3600
    }
  ]
};

// 2. 尋找系統 SQLite 資料庫路徑
function getDbPaths() {
  const home = os.homedir();
  const candidates = [
    path.join(process.cwd(), 'src-tauri', 'target', 'agent_erp_test.db'),
    path.join(home, 'Library', 'Application Support', 'com.agent.erp', 'agent_erp.db'),
    path.join(home, 'AppData', 'Roaming', 'com.agent.erp', 'agent_erp.db'),
    path.join(home, '.local', 'share', 'com.agent.erp', 'agent_erp.db')
  ];
  return candidates;
}

// 3. 執行種子寫入
async function seedSqlite() {
  const dbPaths = getDbPaths();
  let foundDb = null;

  for (const p of dbPaths) {
    if (fs.existsSync(p)) {
      foundDb = p;
      break;
    }
  }

  // 匯出 JSON 備份檔案供前端或離線匯入
  const jsonExportPath = path.resolve(process.cwd(), 'dist_seed_data.json');
  fs.writeFileSync(jsonExportPath, JSON.stringify(SEED_DATA, null, 2), 'utf8');
  console.log(`\x1b[32m✅ 測試資料集已匯出至 JSON 檔案:\x1b[0m ${jsonExportPath}`);

  if (foundDb) {
    console.log(`\x1b[36m📁 偵測到本地 SQLite 資料庫:\x1b[0m ${foundDb}`);
    try {
      // 嘗試透過 sqlite3 CLI 寫入
      let sqlScript = `
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, parent_task_id TEXT, module_id TEXT NOT NULL, assignee TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS task_messages (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mirrored_orders (so_id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, po_reference TEXT NOT NULL, items_json TEXT NOT NULL, total_amount REAL NOT NULL, profit_margin REAL NOT NULL, capacity_usage REAL NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action_type TEXT NOT NULL, arguments TEXT NOT NULL, decision TEXT NOT NULL, operator TEXT NOT NULL, timestamp INTEGER NOT NULL);
`;

      for (const d of SEED_DATA.departments) {
        sqlScript += `INSERT OR REPLACE INTO departments (id, name, parent_id, created_at) VALUES ('${d.id.replace(/'/g, "''")}', '${d.name.replace(/'/g, "''")}', ${d.parent_id ? `'${d.parent_id.replace(/'/g, "''")}'` : 'NULL'}, ${d.created_at});\n`;
      }

      for (const t of SEED_DATA.tasks) {
        sqlScript += `INSERT OR REPLACE INTO tasks (id, title, status, parent_task_id, module_id, assignee, created_at, completed_at) VALUES ('${t.id.replace(/'/g, "''")}', '${t.title.replace(/'/g, "''")}', '${t.status.replace(/'/g, "''")}', ${t.parent_task_id ? `'${t.parent_task_id.replace(/'/g, "''")}'` : 'NULL'}, '${t.module_id.replace(/'/g, "''")}', '${t.assignee.replace(/'/g, "''")}', ${t.created_at}, ${t.completed_at || 'NULL'});\n`;
      }

      for (const m of SEED_DATA.taskMessages) {
        sqlScript += `INSERT OR REPLACE INTO task_messages (id, task_id, role, content, timestamp) VALUES ('${m.id.replace(/'/g, "''")}', '${m.task_id.replace(/'/g, "''")}', '${m.role.replace(/'/g, "''")}', '${m.content.replace(/'/g, "''")}', ${m.timestamp});\n`;
      }

      for (const o of SEED_DATA.orders) {
        sqlScript += `INSERT OR REPLACE INTO mirrored_orders (so_id, customer_name, po_reference, items_json, total_amount, profit_margin, capacity_usage, status, created_at) VALUES ('${o.so_id.replace(/'/g, "''")}', '${o.customer_name.replace(/'/g, "''")}', '${o.po_reference.replace(/'/g, "''")}', '${o.items_json.replace(/'/g, "''")}', ${o.total_amount}, ${o.profit_margin}, ${o.capacity_usage}, '${o.status.replace(/'/g, "''")}', ${o.created_at});\n`;
      }

      for (const a of SEED_DATA.auditLogs) {
        sqlScript += `INSERT OR REPLACE INTO audit_logs (id, action_type, arguments, decision, operator, timestamp) VALUES ('${a.id.replace(/'/g, "''")}', '${a.action_type.replace(/'/g, "''")}', '${a.arguments.replace(/'/g, "''")}', '${a.decision.replace(/'/g, "''")}', '${a.operator.replace(/'/g, "''")}', ${a.timestamp});\n`;
      }

      sqlScript += `COMMIT;\n`;

      execSync(`sqlite3 "${foundDb}"`, { input: sqlScript, stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`\x1b[32m✅ 成功將 ${SEED_DATA.departments.length} 筆部門、${SEED_DATA.tasks.length} 筆任務、${SEED_DATA.orders.length} 筆訂單寫入 SQLite 資料庫！\x1b[0m\n`);
    } catch (e) {
      console.log(`\x1b[33m⚠️ 本地未安裝 sqlite3 指令或無法寫入檔案 (${e.message})，可使用前端自動 Mock 或執行 Tauri 應用程式自動載入。\x1b[0m\n`);
    }
  } else {
    console.log(`\x1b[33mℹ️ 尚未生成原生 SQLite 檔案（啟動 Tauri 應用時會自動建立），測試資料已準備於記憶體與 JSON 檔案。\x1b[0m\n`);
  }

  console.log("\x1b[36m==============================================================================\x1b[0m");
  console.log(`📋 測試資料摘要：`);
  console.log(`   - 組織部門: ${SEED_DATA.departments.length} 筆 (包含一級部門與二級子小組)`);
  console.log(`   - 待辦任務: ${SEED_DATA.tasks.length} 筆 (包含起步主任務與子任務)`);
  console.log(`   - 對話紀錄: ${SEED_DATA.taskMessages.length} 筆`);
  console.log(`   - 孿生訂單: ${SEED_DATA.orders.length} 筆`);
  console.log(`   - 審計日誌: ${SEED_DATA.auditLogs.length} 筆`);
  console.log("\x1b[36m==============================================================================\x1b[0m");
}

seedSqlite();
