# 模組 Manifest 合約規格說明書 (Module Manifest Contract)

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`module_boundary_architecture.md`](module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本設計定義了每個可安裝業務模組**必須**提供的 `manifest.json` 完整規格。Manifest 是模組的唯一合約文件，Shell 與 Rust 後端依賴它來確認模組的身份、版面配置、AI 技能、存取權限及資料庫需求。

---

## 1. 設計定位

`manifest.json` 是模組的**單一真實來源（Single Source of Truth）**：

- **Shell** 讀取它以配置版面插槽、AI 提示詞與技能白名單。
- **Rust 後端** 讀取它以驗證安全性、初始化資料庫資料表，並完成模組註冊。
- **開發者** 透過它宣告模組的一切能力與邊界，無需修改 Shell 或後端程式碼。

**設計原則**：Manifest 的每個欄位都是一個承諾。Shell 與 Rust 有權拒絕任何違背承諾或超越聲明範圍的操作請求。

---

## 2. 完整 Manifest 結構

```json
{
  "moduleId": "order_approval",
  "name": "訂單審核",
  "version": "1.0.0",
  "description": "協助業務主管查詢、篩選並核准銷售訂單，提供 AI 輔助風險分析。",
  "author": "Numax",
  "iconSvg": "<svg viewBox=\"0 0 24 24\"><path d=\"M9 12l2 2 4-4\"/></svg>",
  "entryType": "js",
  "entry": "order_approval.js",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",

  "agent": {
    "systemPrompt": "你是一位訂單審核專家，負責協助業務主管審核銷售訂單。你只能查詢和核准訂單，無法修改訂單金額或客戶資料。",
    "skills": ["get_orders", "approve_order", "check_capacity"]
  },

  "layout": {
    "context": "order_context_panel.js",
    "toolbar": "order_toolbar.js",
    "statusbar": null
  },

  "permissions": {
    "ipc": ["get_mirrored_orders", "confirm_mutation"],
    "sqlite": ["read", "write"],
    "network": false
  },

  "database": {
    "tables": [
      {
        "name": "module_order_approval_cache",
        "schema": "CREATE TABLE IF NOT EXISTS module_order_approval_cache (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)"
      }
    ]
  }
}
```

---

## 3. 欄位逐一說明

### 3.1. 頂層識別欄位

| 欄位名稱      | 型別     | 必填 | 說明                                                                                       |
|---------------|----------|------|--------------------------------------------------------------------------------------------|
| `moduleId`    | `string` | 是   | 模組的全域唯一識別符，僅允許小寫英文字母、數字與底線（`^[a-z][a-z0-9_]*$`）              |
| `name`        | `string` | 是   | 顯示名稱，用於 UI 的側邊欄圖示 Tooltip 與通知來源標示，≤20 字元                          |
| `version`     | `string` | 是   | 語意化版本號（SemVer），格式 `MAJOR.MINOR.PATCH`                                           |
| `description` | `string` | 是   | 模組功能簡介，顯示於模組市集與設定頁面，≤200 字元                                         |
| `author`      | `string` | 是   | 模組開發者名稱，用於稽核與信任鏈追蹤                                                       |
| `iconSvg`     | `string` | 是   | 內嵌 SVG 圖示字串，詳見第 5 節限制說明                                                     |
| `entryType`   | `string` | 是   | 模組進入點類型，目前僅支援 `"js"`                                                           |
| `entry`       | `string` | 是   | 相對於模組根目錄的主進入點 JS 檔案路徑                                                     |
| `sha256`      | `string` | 是   | `entry` 檔案的 SHA-256 哈希值（Hex 編碼），用於安裝時完整性校驗                            |

### 3.2. `agent` 區塊

| 欄位名稱       | 型別       | 必填 | 說明                                                                                      |
|----------------|------------|------|-------------------------------------------------------------------------------------------|
| `systemPrompt` | `string`   | 是   | 切換至本模組時注入 AI 的系統提示詞，定義 AI 角色與行為限制，≤2000 字元                   |
| `skills`       | `string[]` | 是   | AI 可呼叫的技能名稱列表；名稱必須與 `permissions.ipc` 中的指令名稱**完全一致**或為其子集 |

### 3.3. `layout` 區塊

| 欄位名稱   | 型別              | 必填 | 說明                                                                           |
|------------|-------------------|------|--------------------------------------------------------------------------------|
| `context`  | `string \| null`  | 是   | `context-panel` 插槽元件的相對路徑；`null` 表示不使用，Shell 顯示備用內容     |
| `toolbar`  | `string \| null`  | 是   | `toolbar` 插槽元件的相對路徑；`null` 表示不使用，Shell 顯示全域預設工具列     |
| `statusbar`| `string \| null`  | 是   | `statusbar` 插槽元件的相對路徑；`null` 表示不使用，插槽保持預設狀態資訊       |

### 3.4. `permissions` 區塊

| 欄位名稱  | 型別       | 必填 | 說明                                                                                        |
|-----------|------------|------|---------------------------------------------------------------------------------------------|
| `ipc`     | `string[]` | 是   | 模組可呼叫的 Tauri IPC 指令白名單；Rust 端拒絕所有未在此列表中的指令請求                   |
| `sqlite`  | `string[]` | 是   | SQLite 存取權限，可包含 `"read"` 與/或 `"write"`；值為 `[]` 表示不需要資料庫存取權         |
| `network` | `boolean`  | 是   | 是否允許模組前端程式碼發出網路請求；`false` 表示完全禁止，Tauri CSP 將強制執行              |

### 3.5. `database` 區塊

| 欄位名稱         | 型別     | 必填 | 說明                                                                                      |
|------------------|----------|------|-------------------------------------------------------------------------------------------|
| `tables`         | `array`  | 否   | 模組所需建立的 SQLite 資料表定義列表；若模組不需要資料庫，此欄位可省略或設為 `[]`        |
| `tables[].name`  | `string` | 是   | 資料表名稱，**必須**以 `module_{moduleId}_` 為前綴（由 Rust 強制驗證）                    |
| `tables[].schema`| `string` | 是   | 完整的 `CREATE TABLE IF NOT EXISTS ...` SQL 語句，僅允許此操作類型                        |

---

## 4. `permissions` 區塊詳細說明

### 4.1. IPC 白名單（`ipc`）

`permissions.ipc` 定義了模組前端可向 Rust 後端呼叫的完整指令集合。此列表在模組安裝時由 Rust 解析並儲存。當前端模組嘗試呼叫任何**不在此列表**中的 Tauri 指令時，Rust 端的 IPC Guard 中介層將立即拒絕並回傳錯誤，不會執行該指令。

注意：`agent.skills` 是 `permissions.ipc` 的**子集**——AI 可呼叫的技能不能超越模組本身獲授權的 IPC 範圍。

### 4.2. SQLite 存取範圍（`sqlite`）

- `"read"`：模組可透過 Rust 的安全查詢 API 讀取帶有 `module_{moduleId}_` 前綴的資料表。
- `"write"`：模組可透過 Rust 的安全更新 API 寫入帶有 `module_{moduleId}_` 前綴的資料表。
- **任何情況下**，模組都不能直接存取核心系統資料表（如 `mirrored_orders`、`audit_logs`、`installed_modules`），即使聲明了 `"write"` 權限。

### 4.3. 網路存取旗標（`network`）

- `false`（推薦預設）：Tauri 的 Content Security Policy 阻斷所有外部網路請求，模組只能透過 IPC 與 Rust 後端通訊。
- `true`：Shell 在側邊欄的模組圖示附加「允許網路」警告圖示，並在首次載入時向使用者顯示確認提示。

---

## 5. `iconSvg` 安全限制

`iconSvg` 欄位受到以下安全約束（詳見 `svg_sanitizer_security.md`）：

- **長度限制**：≤ 4000 字元。
- **禁止標籤**：`<script>`、`<iframe>`、`<object>`、`<embed>`、`<foreignObject>`。
- **禁止屬性**：所有 `on*` 事件屬性（`onclick`、`onload` 等）；帶有 `javascript:` 或 `data:` 協議的屬性值。
- **允許元素白名單**：`svg`、`path`、`g`、`circle`、`rect`、`line`、`polyline`、`polygon`、`ellipse`、`defs`、`linearGradient`、`stop`、`style`（純 CSS，禁止內含 JS）。

---

## 6. Rust 安裝驗證流程

Rust 後端在執行 `install_module()` IPC 指令時，依序對 `manifest.json` 執行以下驗證步驟：

```
步驟 1：SHA-256 校驗（Integrity Check）
   ├─ 計算下載的 entry JS 檔案的 SHA-256 哈希值
   └─ 與 manifest.sha256 比對，不一致則立即中止並回傳錯誤

步驟 2：SVG 安全過濾（SVG Sanitization）
   ├─ 驗證 iconSvg 長度 ≤ 4000 字元
   ├─ 掃描並移除禁止標籤與事件屬性
   └─ 若包含無法清理的惡意元素（如 <script>），中止安裝

步驟 3：權限範圍檢查（Permission Scope Check）
   ├─ 驗證 agent.skills 為 permissions.ipc 的子集
   ├─ 驗證 database.tables[].name 均以 module_{moduleId}_ 開頭
   └─ 若 permissions.sqlite 為空，但 database.tables 不為空，回傳警告

步驟 4：SQL Schema 驗證（SQL Schema Validation）
   ├─ 解析每條 database.tables[].schema
   ├─ 確認語句僅為 CREATE TABLE IF NOT EXISTS（禁止 DROP、ALTER 等）
   ├─ 確認表名前綴符合規則（namespace prefix enforcement）
   └─ 在 SQLite 中試執行（BEGIN → CREATE → ROLLBACK，僅驗證語法，不實際建表）

步驟 5：模組註冊（Registration）
   ├─ 將模組資訊寫入 installed_modules 資料表
   ├─ 執行 database.tables 中的 schema，建立模組專屬資料表
   └─ 透過 Tauri 事件通知前端刷新模組列表
```

---

## 7. 技能名稱與 IPC 指令的繫結關係

`agent.skills` 中的每個字串名稱，必須**同時**出現在 `permissions.ipc` 中，且與 Rust 端以 `#[tauri::command]` 標記的函式名稱一致：

```
manifest.agent.skills      manifest.permissions.ipc    Rust 函式
──────────────────────────────────────────────────────────────────
"get_orders"           ⊆   "get_orders"           →   get_orders()
"approve_order"        ⊆   "approve_order"         →   approve_order()
"check_capacity"       ⊆   "check_capacity"        →   check_capacity()
                           "get_mirrored_orders"   →   get_mirrored_orders()
                           "confirm_mutation"       →   confirm_mutation()
                           ↑ 僅供模組 JS 直接呼叫，AI 不在技能列表中
```

上述例子說明：`permissions.ipc` 可以包含比 `agent.skills` 更多的指令，額外的指令供模組前端 JavaScript 直接呼叫（非 AI 路徑），但 AI 只能使用 `skills` 白名單中的技能。

---

## 8. 版本管理與升級策略

| 場景           | 策略                                                                                         |
|----------------|----------------------------------------------------------------------------------------------|
| **Patch 升級** (`1.0.x`) | 允許靜默後台更新，自動替換 entry JS 檔案後重新驗證 SHA-256，不重建資料庫資料表        |
| **Minor 升級** (`1.x.0`) | 需使用者手動確認；`database.tables` 中新增的資料表會被 Rust 建立；現有資料表不刪除    |
| **Major 升級** (`x.0.0`) | 視為全新安裝流程，完整執行第 6 節的驗證序列；舊的模組資料表保留（以 `_deprecated` 標記） |
| **降版**       | 不允許；Rust 驗證新版本號必須 ≥ 現有安裝版本號                                              |
