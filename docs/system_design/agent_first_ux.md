# Agent 優先 UX 設計哲學說明書 (Agent-First UX Design Philosophy)

本設計定義了 AgentERP 與傳統 ERP 系統的根本差異：**AI Agent 是主要操作介面，資料表格與表單是輔助確認工具**。

---

## 1. 核心哲學宣言

> **「AI Agent 是主要介面；資料表是確認工具。」**

傳統 ERP 的互動模型要求使用者必須先理解系統架構（哪個選單、哪個表單），才能完成業務操作。AgentERP 翻轉此模型：使用者只需以自然語言描述業務意圖，AI Agent 負責理解、查詢、執行，並將結果以結構化方式呈現供人工確認。

---

## 2. 傳統 ERP vs. AgentERP 互動模型對比

| 維度               | 傳統 ERP（表格優先）                            | AgentERP（對話優先）                                     |
|--------------------|------------------------------------------------|----------------------------------------------------------|
| **主要介面**       | 資料表格（Grid）與多步驟表單（Form Wizard）     | AI 對話視窗（Conversation UI）                            |
| **操作起點**       | 使用者導航至對應選單頁面                         | 使用者在對話框輸入業務描述                                |
| **系統理解負擔**   | 高（需熟悉欄位名稱、流程順序）                   | 低（以自然語言描述目標即可）                              |
| **資料視圖**       | 主視圖，使用者直接在表格中操作                   | 次級確認視圖，由 AI 觸發後呈現在右側 Context Panel        |
| **錯誤處置**       | 表單驗證紅色提示框，需逐欄修正                   | AI 以對話解釋問題並提供替代方案                           |
| **批次操作**       | 勾選多行 → 點擊批次按鈕                          | 以語言描述條件（「核准所有低於 10 萬且客戶評級 A 的訂單」）|

---

## 3. 模組切換如何改變 AI Agent 的身份

AgentERP 中只有一個 AI Chat 元件實例，但它在不同模組下扮演截然不同的專家角色。這通過以下三個機制實現：

### 3.1. 系統提示詞注入（System Prompt Injection）

每個模組在 `manifest.json` 的 `agent.systemPrompt` 欄位聲明專屬的系統提示詞。當使用者切換至該模組時，Shell 立即呼叫 AI 執行環境的 API，以新的提示詞替換當前上下文：

```javascript
// Shell 在模組切換時執行
window.__SHELL__.setSystemPrompt(newModule.agent.systemPrompt);
```

**效果**：AI 從「通用助理」立即轉變為該業務領域的「域內專家」，其回答風格、優先考慮的資訊、乃至語氣均由模組控制。

### 3.2. 工具（Tools）動態註冊

每個模組在 `agent.tools` 中聲明一組工具定義（格式見第 7 節，跟 `task_driven_workflow.md` 第 3.2 節的 `AgentProfile`/`ToolDefinition` 結構共用同一份定義），對應模組所需的業務操作能力。Shell 在模組切換時，向 AI 執行環境動態解除舊模組的工具繫結，並重新掛載新模組的工具：

```javascript
// Shell 在模組切換時執行
window.__SHELL__.unregisterTools(prevModule.agent.tools);
window.__SHELL__.registerTools(newModule.agent.tools);
```

AI 工具列表（Tool List）因此動態更新，確保 AI 在「訂單審核」模組中只能呼叫訂單相關的工具，不會越界呼叫庫存或財務指令。工具清單只決定 AI「能不能看到、選到」這個動作——選到之後仍要經過第 8 節的人在迴圈確認才會真的執行，不會因為在白名單內就跳過確認。

### 3.3. AI 域內身份範例

| 模組              | `systemPrompt` 定義的身份  | 可用工具範例                                       |
|-------------------|----------------------------|----------------------------------------------------|
| `order_approval`  | 訂單審核專家               | `get_orders`, `approve_order`, `check_capacity`    |
| `finance_analysis`| 財務分析師                 | `get_pnl_report`, `flag_anomaly`, `export_csv`     |
| `inventory`       | 庫存管理專員               | `get_stock_levels`, `create_purchase_order`, `alert_low_stock` |

表中名稱是每個工具 `ToolDefinition.function.name` 的簡寫，完整定義（含 `description`/`parameters`）見第 7 節。

---

## 4. 任務導向的側邊欄設計

`sidebar-rail` 的圖示代表**任務類型（Task Types）**，而非 UI 頁面。

- **傳統 ERP**：「訂單管理」選單 → 頁面跳轉 → 表格 → 操作
- **AgentERP**：點擊「訂單審核」圖示 → AI 化身訂單審核專家 → 使用者描述今日審核目標

這意味著點擊圖示的動作等同於「切換工作情境（Context Switch）」，而非「導航至頁面」。側邊欄本質上是一個任務選擇器。

---

## 5. 標準使用者工作流程

AgentERP 的每一個業務操作均遵循以下五步驟工作流程：

```
1. 選擇任務（Select Task）
   └─ 點擊 sidebar-rail 圖示，切換至目標業務模組

2. 描述目標（Describe Goal）
   └─ 在 agent-main 對話框以自然語言輸入業務意圖
       例：「顯示今日所有待審的訂單，金額超過 50 萬的優先排列」

3. AI 處理（AI Processes with Tools）
   └─ AI 解析意圖，呼叫對應工具（如 get_orders）查詢資料
   └─ AI 將結果整理為結構化回應卡片，透過 Shell API 推送至 context-panel

4. 使用者驗證（User Verifies in Context Panel）
   └─ 使用者在右側 context-panel 檢視 AI 整理好的訂單列表
   └─ 可展開單一訂單查看詳情，或要求 AI 進一步篩選

5. 使用者確認（User Confirms / Approves）
   └─ 在 context-panel 中點擊「核准」或對 AI 說「核准這三筆訂單」
   └─ AI 呼叫 approve_order 工具（IPC → Rust → 資料庫），完成操作
   └─ 操作結果以 Toast 或 AI 回覆訊息告知使用者
```

---

## 6. 結構化 AI 回應卡片

AI 不僅能回傳純文字，還能回傳結構化的**回應卡片（Response Cards）**，由 Shell 在 `context-panel` 中渲染，或直接嵌入於對話視窗的訊息氣泡中。

支援的卡片類型：

| 卡片類型        | 說明                                                          | 渲染位置            |
|-----------------|---------------------------------------------------------------|---------------------|
| `data-table`    | 可排序/篩選的資料表格                                         | `context-panel`     |
| `action-list`   | 帶有核准/拒絕按鈕的操作項目列表                               | `context-panel`     |
| `chart`         | 折線圖/長條圖（使用模組提供的圖表元件）                        | `context-panel`     |
| `summary-card`  | 統計摘要卡片（KPI 指標、數字高亮）                             | `agent-main` 訊息泡 |
| `confirm-dialog`| 需要使用者明確確認的操作摘要（顯示將執行的變更內容）           | `agent-main` 訊息泡 |

AI 透過在其回應 JSON 中包含 `__shell_render__` 指令通知 Shell 觸發卡片渲染：

```json
{
  "text": "找到 3 筆符合條件的訂單，詳細資料已載入右側面板。",
  "__shell_render__": {
    "zone": "context-panel",
    "type": "data-table",
    "payload": { "rows": [...], "columns": [...] }
  }
}
```

---

## 7. 模組 Manifest `agent` 區塊規格

```json
{
  "agent": {
    "systemPrompt": "你是一位訂單審核專家，負責協助業務主管審核銷售訂單。你只能查詢和核准訂單，無法修改訂單金額或客戶資料。在提供建議前，你應優先呼叫 get_orders 取得最新資料。",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "approve_order",
          "description": "核准指定的銷售訂單",
          "parameters": {
            "type": "object",
            "properties": {
              "orderId": { "type": "string", "description": "訂單編號" }
            },
            "required": ["orderId"]
          }
        }
      }
    ]
  }
}
```

| 欄位            | 型別               | 必填 | 說明                                                                                                                                    |
|-----------------|--------------------|------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `systemPrompt`  | `string`           | 是   | 注入 AI 的系統提示詞，定義 AI 的角色、能力範圍與行為準則                                                                               |
| `tools`         | `ToolDefinition[]` | 是   | 本模組允許 AI 呼叫的工具定義列表，格式與 OpenAI／NVIDIA NIM 的 `tools` 參數相容（`type`/`function.name`/`function.description`/`function.parameters`）。Shell 僅允許列表內宣告過的 `function.name`，且每次呼叫都要經過第 8 節的人在迴圈確認才會真的轉發執行——只放工具名稱清單不夠，AI 需要 `description`/`parameters` 才能判斷要不要呼叫、怎麼帶參數 |

---

## 8. 工具名稱與 Tauri IPC 指令的對應關係

`agent.tools` 中每個 `function.name` 對應一個 Rust 端以 `#[tauri::command]` 標記的指令函式。對應方式採用直接映射（`function.name` 即指令函式名稱）：

```
工具名稱（manifest 的 function.name）  →  Tauri IPC 指令名稱   →  Rust 函式
──────────────────────────────────────────────────────────────────────────
"get_orders"                          →  get_orders            →  async fn get_orders(...)
"approve_order"                       →  approve_order         →  async fn approve_order(...)
"check_capacity"                      →  check_capacity        →  async fn check_capacity(...)
```

Shell 在模組載入完成後，向 AI 執行環境提供一個工具呼叫代理（Tool Call Proxy），攔截 AI 發出的工具呼叫請求，驗證工具名稱是否在當前模組的白名單內；若通過，不會立即執行，而是先轉譯成人看得懂的確認文字，交給使用者明確確認（比照 `task_driven_workflow.md` 第 3.2 節任務層級已驗證過的 human-in-the-loop 模式），使用者確認後才真的透過 `invoke(toolName, args)` 轉發至 Tauri 後端：

```javascript
// Shell 的 Tool Call Proxy 核心邏輯
async function handleToolCall(toolName, args) {
  const allowedTools = activeModule.agent.tools.map(t => t.function.name);
  if (!allowedTools.includes(toolName)) {
    throw new Error(`工具 "${toolName}" 不在當前模組的授權範圍內。`);
  }
  // 不會直接執行：轉譯成待確認卡片，等待使用者明確確認後才真的呼叫 invoke()
  return presentPendingConfirmation(toolName, args);
}
```

這確保了兩層獨立的防護：白名單擋 AI 模型嘗試呼叫未授權的指令（Shell 前端 + Rust 端 IPC 雙重防護），人在迴圈確認則擋白名單內、但 AI 誤判或幻覺出的錯誤動作——兩者缺一不可，白名單通過不代表可以跳過確認。
