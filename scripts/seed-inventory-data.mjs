// ==============================================================================
// AgentERP 庫存調整單與庫存流水帳測試資料生成腳本
// ==============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const home = os.homedir();
const dbPath = path.join(home, 'Library', 'Application Support', 'com.numaxofficee8.agent-erp', 'agent_erp.db');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 找不到資料庫檔案: ${dbPath}`);
  process.exit(1);
}

console.log(`📁 連接資料庫: ${dbPath}`);

// 取得當前活躍的 tenant 與 user
let activeTenant = 'tnt_18e0c783cfe643f8';
let activeUser = 'usr_18da0ff5033bd350';

try {
  const sessionRow = execSync(`sqlite3 "${dbPath}" "SELECT user_id, active_tenant_id FROM sessions ORDER BY created_at DESC LIMIT 1;"`).toString().trim();
  if (sessionRow) {
    const [u, t] = sessionRow.split('|');
    if (u) activeUser = u;
    if (t) activeTenant = t;
  }
} catch (e) {
  console.warn('無法讀取 session，使用預設 tenant/user');
}

console.log(`🏢 目標租戶 (Tenant ID): ${activeTenant}`);
console.log(`👤 目標使用者 (User ID): ${activeUser}`);

const now = Math.floor(Date.now() / 1000);

// 尋找目標租戶下的倉庫
let whMain = '';
let whTest = '';
try {
  const whRows = execSync(`sqlite3 "${dbPath}" "SELECT id, is_default FROM warehouses WHERE tenant_id = '${activeTenant}' ORDER BY is_default DESC;"`).toString().trim().split('\n');
  if (whRows.length > 0 && whRows[0]) {
    whMain = whRows[0].split('|')[0];
    whTest = whRows.length > 1 ? whRows[1].split('|')[0] : whMain;
  }
} catch (e) {
  console.warn('無法讀取倉庫，將自動建立');
}

let sql = 'BEGIN TRANSACTION;\n';

// 1. 若無倉庫則建立倉庫
if (!whMain) {
  whMain = `wh_${now}_main`;
  whTest = `wh_${now}_test`;
  sql += `INSERT OR IGNORE INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
          VALUES ('${whMain}', '${activeTenant}', 'MAIN', '台北主倉', 1, 1, ${now});\n`;
  sql += `INSERT OR IGNORE INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
          VALUES ('${whTest}', '${activeTenant}', 'WH-TEST', '測試與報廢倉', 0, 1, ${now});\n`;
}

// 2. 建立示範商品、規格與單位
const demoProducts = [
  {
    prodId: `prod_${now}_srv`,
    name: '高效能 AI 運算伺服器',
    category: 'manufactured',
    varId: `var_${now}_srv`,
    sku: 'SRV-AI-2026',
    varName: '標準',
    unitId: `unit_${now}_srv`,
    unitName: '台',
    sellPrice: 150000.0,
    costPrice: 85000.0,
    stockMain: 15.0,
    stockTest: 2.0
  },
  {
    prodId: `prod_${now}_cool`,
    name: '工業級散熱模組',
    category: 'raw_material',
    varId: `var_${now}_cool`,
    sku: 'COOL-IND-01',
    varName: '標準',
    unitId: `unit_${now}_cool`,
    unitName: '組',
    sellPrice: 850.0,
    costPrice: 450.0,
    stockMain: 120.0,
    stockTest: 30.0
  },
  {
    prodId: `prod_${now}_cable`,
    name: '高速傳輸光纖線纜 (2M)',
    category: 'resale',
    varId: `var_${now}_cable`,
    sku: 'CAB-OPT-2M',
    varName: '2米標準',
    unitId: `unit_${now}_cable`,
    unitName: '條',
    sellPrice: 320.0,
    costPrice: 120.0,
    stockMain: 300.0,
    stockTest: 50.0
  }
];

for (const p of demoProducts) {
  sql += `INSERT OR IGNORE INTO products (id, tenant_id, name, category, is_sellable, is_purchasable, created_at)
          VALUES ('${p.prodId}', '${activeTenant}', '${p.name}', '${p.category}', 1, 1, ${now - 86400 * 2});\n`;
  sql += `INSERT OR IGNORE INTO product_variants (id, product_id, sku, name, spec_attributes, is_default, created_at)
          VALUES ('${p.varId}', '${p.prodId}', '${p.sku}', '${p.varName}', '{}', 1, ${now - 86400 * 2});\n`;
  sql += `INSERT OR IGNORE INTO product_units (id, variant_id, unit_name, conversion_ratio, is_base_unit, selling_price, created_at)
          VALUES ('${p.unitId}', '${p.varId}', '${p.unitName}', 1.0, 1, ${p.sellPrice}, ${now - 86400 * 2});\n`;

  // 初始開帳庫存 (台北主倉)
  sql += `INSERT INTO inventory_movements (id, tenant_id, warehouse_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
          VALUES ('im_${now}_init_${p.prodId}_main', '${activeTenant}', '${whMain}', '${p.unitId}', ${p.stockMain}, ${p.costPrice}, 'opening_balance', 'opening_balance', NULL, '${activeUser}', ${now - 86400});\n`;

  // 初始開帳庫存 (測試倉)
  sql += `INSERT INTO inventory_movements (id, tenant_id, warehouse_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
          VALUES ('im_${now}_init_${p.prodId}_test', '${activeTenant}', '${whTest}', '${p.unitId}', ${p.stockTest}, ${p.costPrice}, 'opening_balance', 'opening_balance', NULL, '${activeUser}', ${now - 86400});\n`;
}

// 3. 建立示範庫存調整單

// --- 調整單 1: 已過帳 (Posted) - 損壞報廢 (damage) ---
const adj1Id = `adj_${now}_001`;
const adj1No = `ADJ-${String(now).slice(-5)}`;
sql += `INSERT INTO inventory_adjustments (id, tenant_id, adjustment_number, warehouse_id, reason_code, status, note, created_by, created_at, posted_at, cancelled_at)
        VALUES ('${adj1Id}', '${activeTenant}', '${adj1No}', '${whMain}', 'damage', 'posted', '例行搬運過程中撞損外包裝，依規範辦理報廢出庫', '${activeUser}', ${now - 7200}, ${now - 3600}, NULL);\n`;

sql += `INSERT INTO inventory_adjustment_lines (id, adjustment_id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, created_at)
        VALUES ('adjl_${now}_1_1', '${adj1Id}', 1, '${demoProducts[0].unitId}', -1.0, '${demoProducts[0].name}', '${demoProducts[0].varName}', '${demoProducts[0].sku}', '${demoProducts[0].unitName}', ${now - 7200});\n`;
sql += `INSERT INTO inventory_adjustment_lines (id, adjustment_id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, created_at)
        VALUES ('adjl_${now}_1_2', '${adj1Id}', 2, '${demoProducts[1].unitId}', -5.0, '${demoProducts[1].name}', '${demoProducts[1].varName}', '${demoProducts[1].sku}', '${demoProducts[1].unitName}', ${now - 7200});\n`;

// 對應的流水帳 (由過帳產生)
sql += `INSERT INTO inventory_movements (id, tenant_id, warehouse_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
        VALUES ('im_${now}_adj_1_1', '${activeTenant}', '${whMain}', '${demoProducts[0].unitId}', -1.0, NULL, 'adjustment', 'inventory_adjustment', '${adj1Id}', '${activeUser}', ${now - 3600});\n`;
sql += `INSERT INTO inventory_movements (id, tenant_id, warehouse_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
        VALUES ('im_${now}_adj_1_2', '${activeTenant}', '${whMain}', '${demoProducts[1].unitId}', -5.0, NULL, 'adjustment', 'inventory_adjustment', '${adj1Id}', '${activeUser}', ${now - 3600});\n`;

// --- 調整單 2: 已過帳 (Posted) - 盤盈尋獲 (found) ---
const adj2Id = `adj_${now}_002`;
const adj2No = `ADJ-${String(now + 1).slice(-5)}`;
sql += `INSERT INTO inventory_adjustments (id, tenant_id, adjustment_number, warehouse_id, reason_code, status, note, created_by, created_at, posted_at, cancelled_at)
        VALUES ('${adj2Id}', '${activeTenant}', '${adj2No}', '${whTest}', 'found', 'posted', '貨架整理時於儲存格深處尋獲未入帳線纜備品', '${activeUser}', ${now - 5400}, ${now - 1800}, NULL);\n`;

sql += `INSERT INTO inventory_adjustment_lines (id, adjustment_id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, created_at)
        VALUES ('adjl_${now}_2_1', '${adj2Id}', 1, '${demoProducts[2].unitId}', 10.0, '${demoProducts[2].name}', '${demoProducts[2].varName}', '${demoProducts[2].sku}', '${demoProducts[2].unitName}', ${now - 5400});\n`;

sql += `INSERT INTO inventory_movements (id, tenant_id, warehouse_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
        VALUES ('im_${now}_adj_2_1', '${activeTenant}', '${whTest}', '${demoProducts[2].unitId}', 10.0, NULL, 'adjustment', 'inventory_adjustment', '${adj2Id}', '${activeUser}', ${now - 1800});\n`;

// --- 調整單 3: 草稿狀態 (Draft) - 待複核過帳 ---
const adj3Id = `adj_${now}_003`;
const adj3No = `ADJ-${String(now + 2).slice(-5)}`;
sql += `INSERT INTO inventory_adjustments (id, tenant_id, adjustment_number, warehouse_id, reason_code, status, note, created_by, created_at, posted_at, cancelled_at)
        VALUES ('${adj3Id}', '${activeTenant}', '${adj3No}', '${whMain}', 'opening_correction', 'draft', '期初盤點微調：散熱模組多領調整，光纖線纜盤點增補（待主管核對）', '${activeUser}', ${now - 900}, NULL, NULL);\n`;

sql += `INSERT INTO inventory_adjustment_lines (id, adjustment_id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, created_at)
        VALUES ('adjl_${now}_3_1', '${adj3Id}', 1, '${demoProducts[1].unitId}', -2.0, '${demoProducts[1].name}', '${demoProducts[1].varName}', '${demoProducts[1].sku}', '${demoProducts[1].unitName}', ${now - 900});\n`;
sql += `INSERT INTO inventory_adjustment_lines (id, adjustment_id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, created_at)
        VALUES ('adjl_${now}_3_2', '${adj3Id}', 2, '${demoProducts[2].unitId}', 5.0, '${demoProducts[2].name}', '${demoProducts[2].varName}', '${demoProducts[2].sku}', '${demoProducts[2].unitName}', ${now - 800});\n`;

// --- 調整單 4: 已作廢 (Cancelled) ---
const adj4Id = `adj_${now}_004`;
const adj4No = `ADJ-${String(now + 3).slice(-5)}`;
sql += `INSERT INTO inventory_adjustments (id, tenant_id, adjustment_number, warehouse_id, reason_code, status, note, created_by, created_at, posted_at, cancelled_at)
        VALUES ('${adj4Id}', '${activeTenant}', '${adj4No}', '${whMain}', 'other', 'cancelled', '誤建之重複報廢單，已聯絡主管作廢重開', '${activeUser}', ${now - 3600}, NULL, ${now - 1200});\n`;

sql += `INSERT INTO inventory_adjustment_lines (id, adjustment_id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, created_at)
        VALUES ('adjl_${now}_4_1', '${adj4Id}', 1, '${demoProducts[0].unitId}', -1.0, '${demoProducts[0].name}', '${demoProducts[0].varName}', '${demoProducts[0].sku}', '${demoProducts[0].unitName}', ${now - 3600});\n`;

sql += 'COMMIT;\n';

try {
  execSync(`sqlite3 "${dbPath}"`, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('✅ 成功寫入測試資料至 SQLite 資料庫！');
  console.log(`   - 示範商品: 3 項 (高效能伺服器、散熱模組、光纖線纜)`);
  console.log(`   - 初始庫存流水帳: 6 筆 (台北主倉與測試倉各 3 項商品)`);
  console.log(`   - 示範庫存調整單: 4 張`);
  console.log(`     * ${adj1No}: [已過帳] 損壞報廢 (出庫 2 項)`);
  console.log(`     * ${adj2No}: [已過帳] 盤盈尋獲 (入庫 1 項)`);
  console.log(`     * ${adj3No}: [草稿中] 開帳更正 (可供在介面上進行編輯與過帳測試)`);
  console.log(`     * ${adj4No}: [已作廢] 其他原因`);
} catch (e) {
  console.error('❌ 寫入資料庫失敗:', e);
  process.exit(1);
}
