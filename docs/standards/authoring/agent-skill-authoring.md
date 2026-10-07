# Agent Skill 撰寫規範

適用範圍：所有新增「使用者可透過對話驅動完成的具體任務情境」的 issue（例如 #117、#118、#119、#120 這類情境）。角色定位與規範文件之間的關係見 [`CLAUDE.md`](../../../CLAUDE.md)。這份文件橫跨 Rust 與 Svelte 兩邊，是 [`task_driven_workflow.md`](../../system_design/task_driven_workflow.md) 第 3.2/3.3 節 `AgentProfile`/`ToolHandler` 介面定義、與 [`agent_first_ux.md`](../../system_design/agent_first_ux.md) 第 7 節模組 manifest 規格之上的擴充規範，不取代原有欄位定義。

---

## 1. 什麼是 Agent Skill

Agent Skill（以下簡稱 skill）是一個可被使用者透過對話驅動完成的具體任務情境，在程式架構上對應一個 `AgentProfile`（可能搭配一個或多個 `ToolHandler`）。例如「新增客戶基本資料」（#117）、「設定部門」（既有的 `departmentAgentProfile`）都是一個 skill。

一個 skill 通常會打包數個相關的 `ToolHandler`（例如部門的 skill 同時打包 `create_department` 與 `list_departments`），對使用者而言是一個完整的任務情境，不是單一個工具呼叫。

Skill 是**部門層級操作權限**的最小管理單位（見 [#115](http://gitea.94peter.dev/Numax/agent-erp/issues/115)「部門可用 Skill 設定」）：一個部門有沒有某個 skill 的使用權，決定它對應的工具能不能被呼叫。這是跟「資料層面可以存取到哪些具體記錄/欄位」完全獨立的另一層，skill 權限不隱含資料權限，資料層面的可見性/範圍限制屬於各資料管理情境自己的範圍，不在這份規範處理。

### 多部門時的有效 skill：取聯集

使用者可同時隸屬多個部門（#114）。使用者實際可用的 skill 集合，是其所屬**所有部門已授予 skill 的聯集**，不是交集——這是由原始需求（同一位員工可能同時支援業務部與客服部，兩邊的能力都要能用）邏輯上決定的，交集在多數情況下會讓多部門指派失去意義。

這代表「把一個使用者加進某個部門」本質上是一個**提權動作**，不只是組織標籤——指派介面（#114）在新增部門時應該讓管理者看得到「這會讓該使用者額外取得哪些 skill」，不要讓管理者在看不到後果的情況下做出提權決定。

---

## 2. Skill 識別碼（`id`）

每個 skill 要有一個穩定、人類可讀的唯一識別碼，命名慣例：

```
<domain>.<scenario_slug>
```

- `domain`：所屬領域（見第 3 節）
- `scenario_slug`：這個情境的動作描述，英文小寫、以底線分隔

範例：`customer.create_basic_profile`、`department.manage`。

這個 `id` 就是 [#115](http://gitea.94peter.dev/Numax/agent-erp/issues/115) 部門權限授予清單、以及未來「依權限動態生成導覽任務」情境共用的鏈接鍵——**不另外訂一套獨立的權限識別碼**，減少概念數量。

---

## 3. 分類（`domain`）

每個 skill 要宣告一個 `domain` 欄位，用於：

- [#115](http://gitea.94peter.dev/Numax/agent-erp/issues/115) 權限設定頁的分組顯示與搜尋（skill 清單會隨時間持續增加，不能假設項目數量少）
- 未來「依權限動態生成導覽任務」情境的分類過濾

`domain` **刻意獨立於 Gitea milestone**，不要直接拿 milestone 名稱當分類。milestone 是開發排期用的概念，之後可能合併、改名、結束；`domain` 是產品長期穩定的執行期資料，兩者生命週期不同，不該綁死。

### 唯一真相來源：`KNOWN_DOMAINS` 註冊表

合法的 `domain` 清單由 `src/lib/workflow/domains.js` 匯出的 `KNOWN_DOMAINS` 陣列**唯一**定義，底下的表格是它的說明文件、不是另一份獨立清單——新增 domain 時先改 `KNOWN_DOMAINS`，再回來補這張表的說明，兩者永遠同步。

`workflow/index.js` 的 `registerAgentProfile` 註冊一個 `AgentProfile` 時，要檢查其 `domain` 是否存在於 `KNOWN_DOMAINS`，不存在就直接拋錯，不允許靜默通過。這樣新增一個不在清單內的 domain，只能透過「先在 `domains.js` 加一行」這個會出現在 PR diff 裡的明確動作完成，審查者看 diff 就知道這次要引入新分類，不會因為字串打錯（例如 `customer` vs `customers`）而悄悄產生不一致的分類。

目前已知的 domain（隨新情境擴充持續增加，不是封閉清單）：

| domain | 說明 | 對應情境範例 |
|---|---|---|
| `department` | 部門與組織結構 | 設定部門（既有） |
| `customer` | 客戶（Partner 的 `is_customer` 身份） | #117、#118 |
| `vendor` | 供應商（Partner 的 `is_vendor` 身份） | #119、#120 |

---

## 4. Manifest 必要欄位

在既有 `AgentProfile`（[`types.js`](../../../src/lib/workflow/types.js)）的基礎上，新增兩個欄位：

```js
/** @type {import('./types.js').AgentProfile} */
export const exampleAgentProfile = {
  id: 'customer.create_basic_profile',   // 新增：skill 識別碼
  domain: 'customer',                     // 新增：所屬領域
  systemPrompt: '...',                    // 既有欄位，不變
  tools: [...],                           // 既有欄位，不變
  toolHandlers: [...],                    // 既有欄位，不變
  // ...其餘既有欄位（getFallbackMessage/quickAction 等）不變
};
```

`id`/`domain` 不影響既有的 `taskProfileMap` 註冊機制（[`workflow/index.js`](../../../src/lib/workflow/index.js)），兩者並存：`taskProfileMap` 負責「這個 task 對應哪個 `AgentProfile`」，`id`/`domain` 負責「這個 skill 在權限與導覽系統裡怎麼被識別、分類」。

---

## 5. 撰寫流程

新增一個 skill 時，依序完成：

1. **寫使用者情境**：Who（角色）／Context（觸發點）／What（行動目標）／Why（價值效益），跟現有 issue 的寫法一致
2. **定義 `id` 與 `domain`**：依第 2、3 節命名慣例
3. **定義 `ToolHandler`**：對應的底層 Tauri command，依 [`rust-backend.md`](../rust-backend.md) 規範撰寫後端邏輯
4. **定義 `AgentProfile`**：`systemPrompt` + `tools` + `toolHandlers`，依 [`svelte-frontend.md`](../svelte-frontend.md) 規範撰寫前端流程
5. **串接導覽入口**（如適用）：sidebar 任務列表或 `QuickStartCards.svelte`
6. **（之後）在部門權限設定（[#115](http://gitea.94peter.dev/Numax/agent-erp/issues/115)）登記這個 skill**——這一步等 #115 落地後才需要執行，新增 skill 當下不用等它

DoD 一律依 [`testing-verification.md`](../testing-verification.md) 驗收。

**#115 實作時的額外 DoD 要求**：部門的 skill 授予/撤銷本身是敏感操作，變更時要寫入既有的 `audit_logs`（比照 #98/#102 已建立的觀測性慣例），記錄「誰、何時、把哪個 skill 授予/撤銷給哪個部門」。這不是資料存取的稽核（那是資料權限的範圍），是權限設定變更本身的稽核，兩者不同但都該留痕。

---

## 6. 範例：新增客戶基本資料（對應 #117）

```js
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
  getFallbackMessage() {
    return '請告訴我想建立的客戶名稱，或詢問目前有哪些已建立的客戶。';
  }
};
```

`createPartnerToolHandler`/`listPartnersToolHandler` 的撰寫方式比照既有 [`departments.js`](../../../src/lib/workflow/departments.js) 的 `createDepartmentToolHandler`/`listDepartmentsToolHandler`（`describeConfirmation`/`execute`/`formatResult`/`extractCandidateRegex` 等欄位的實作模式一致）。

---

## 7. 跟既有文件的關係

- 不取代 [`agent_first_ux.md`](../../system_design/agent_first_ux.md) 第 7 節的 manifest 規格，`id`/`domain` 是在它之上的擴充欄位
- 不取代 [`task_driven_workflow.md`](../../system_design/task_driven_workflow.md) 第 3.2/3.3 節的 `AgentProfile`/`ToolHandler` 介面定義
- Skill 的操作權限管理見 [#115](http://gitea.94peter.dev/Numax/agent-erp/issues/115)；資料層面的欄位可見性/範圍限制屬於各資料管理情境自己的範圍，不在這份文件處理
