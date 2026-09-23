# 任務驅動工作流程設計說明書 (Task-Driven Workflow)

本設計定義 AgentERP 的「任務（Task）」——一個橫跨所有模組的一等公民資料實體，是 AI Agent 協助使用者完成工作的核心單位，也是對話延續性（Continuity）的載體。

---

## 1. 核心概念：Task 是對話的容器，不只是待辦事項

傳統的「任務清單」只是狀態追蹤器（打勾、標記完成）。AgentERP 的 Task 更進一步：**每個 Task 綁定一段專屬的對話歷史**。使用者點擊某個 Task，看到的不是空白對話框，而是回到那個 Task 專屬的上下文——AI 記得之前討論到哪裡，使用者不需要重新描述背景。

這解決了純聊天介面的根本問題：對話一多就散掉、找不回脈絡。Task 把「這件事」跟「關於這件事的所有對話」綁在一起。

---

## 2. Task 資料模型

```typescript
interface Task {
  id: string;
  title: string;                  // 「大同國中智慧顯示設備採購」
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  parentTaskId?: string | null;   // 父任務 id，頂層任務為 null
  moduleId: string;                // 所屬模組（對應 sidebar-rail 的任務類型）
  assignee: string;                 // 指派對象（顯示用字串，如「主管」「財會」「小華」）
  createdAt: number;
  completedAt?: number | null;
  conversationId: string;          // 綁定的對話串 id（見第 3 節）
}
```

- **父子任務**：`parentTaskId` 建立層級關係（例：「超預算核准」「請款草稿確認」是「大同國中智慧顯示設備採購」的子任務）。子任務可以指派給不同人、各自有獨立對話串。
- **狀態**：`pending`（待處理）、`in_progress`（進行中）、`done`（完成）、`cancelled`（使用者/業務判斷不需要做了）。父任務的完成不會自動由子任務狀態推導——由對應的業務邏輯決定是否要提示使用者確認完成。
- **失敗不是一種狀態**：單次嘗試失敗（例如邀請成員時 email 已存在）不會把 Task 標成某種「失敗」終態——任務本身還是要做，應留在 `pending`/`in_progress` 讓子 Agent 可以重試。失敗記錄在該 Task 的 `Conversation` 訊息裡（子 Agent 在對話中說明失敗原因），必要時另外透過 `notification_system.md` 發一個 `error` 類型通知，不會反映在 `status` 欄位上。

---

## 3. 對話與 Task 的綁定關係

對話不強制綁定 Task。使用者開啟某個模組時，預設進入一個**未綁定的環境對話（Ambient Conversation）**，畫面標示「目前對話：一般業務詢問（尚未建立任務）」。

```typescript
interface Conversation {
  id: string;
  taskId?: string | null;   // null = 尚未綁定任務的環境對話
  moduleId: string;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: number }[];
}
```

**建立時機**：當 AI 判斷使用者的意圖已具體化為可追蹤的工作項目時（例如使用者描述了一筆具體採購案，不是單純查詢），主動詢問「要不要幫你建立一個任務追蹤這件事？」。使用者同意後：

1. 建立新的 `Task`
2. 把當前 `Conversation` 的 `taskId` 回填（該對話從此刻起歸屬這個 Task；已發生的訊息一併歸入，不會遺失前情）
3. 後續同一個 Task 的對話，都是同一條 `Conversation`，不會散成多條

系統也可以直接建立 Task 而不經過對話判斷（例如 M2 引導流程在租戶建立成功時自動建立「新租戶起步」任務，見第 6 節）——此時 Task 一開始沒有對話紀錄，AI 主動開口的第一句話就是這個 Task 底下的第一則訊息。

---

## 3.1. 主 Agent 與子 Agent：任務由子 Agent 代理，結果回報主 Agent

模組層級的環境對話（第 3 節的 Ambient Conversation）由**主 Agent** 負責——它是使用者切換模組時看到的那個持續身份（`agent_first_ux.md` 第 3 節的 `AgentProfile`，見本文件第 3.2 節）。

每個 Task 一旦建立，實際協助使用者完成它的不是主 Agent 本人，而是一個**專屬這個 Task 的子 Agent**：

- 子 Agent 在該 Task 綁定的 `Conversation` 裡跟使用者互動，範疇收斂在這個 Task 本身——`systemPrompt` 可以比模組層級更具體（例：「你正在協助處理『超預算核准』這筆採購案的核准/拒絕，不需要處理其他業務」），`tools` 也可以只給這個任務需要的子集，不用整個模組的工具都開放
- 主 Agent **不需要持有子 Agent 的完整對話記錄**——上下文不會隨著任務數量增加而被拖大，每個子 Agent 各自輕量、聚焦
- 子 Agent 的任務結束時（狀態轉為 `done`/`cancelled`），把結果**摘要**回報給主 Agent 的環境對話（以系統訊息形式插入，例如：「✅「超預算核准」已由主管核准，金額 $XX」）——使用者即使沒有點進子任務，回到環境對話也能看到事情有進展，不需要自己去每個任務裡確認

這個關係跟第 4 節的任務面板互動一致：點擊任務卡片＝切換到該 Task 專屬的子 Agent 與其 `Conversation`；回到環境對話＝切回主 Agent，主 Agent 手上只有各子 Agent回報的摘要，不是原始逐字稿。

---

## 3.2. AgentProfile 的格式與人在迴圈執行

「Skill」這個詞在本文件裡保留給未來的程序性指南內容（見本節最後一段的名詞界定），不用來稱呼下面這個結構。不管是模組層級的主 Agent，還是任務層級的子 Agent，兩者的身份與能力定義都是同一種結構，稱為 `AgentProfile`：

```typescript
interface AgentProfile {
  systemPrompt: string;
  tools: ToolDefinition[];
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;   // JSON Schema
  };
}
```

`ToolDefinition` 的形狀跟 OpenAI／NVIDIA NIM 的 `tools` 參數相容，AI 端不需要額外轉換格式。子 Agent 的 `tools` 是主 Agent `tools` 的子集——子 Agent 的範疇收斂在單一 Task，不會持有比主 Agent 更大的呼叫權限。

AI 選中一個工具並帶出參數後，不會直接執行：一律先轉譯成人看得懂的確認文字，插入該 Task（或環境對話）的訊息串等待使用者明確確認，確認後才真的呼叫對應的 Tauri command。白名單檢查（是否為宣告過的工具名稱）跟人在迴圈確認是兩層獨立的防護，缺一不可——白名單擋越權呼叫，確認卡片擋 AI 誤判或幻覺出的錯誤動作。

任務層級的 `tools` 目前直接定義在 Rust 程式碼裡（依任務類型對應一組固定的工具函式），模組層級走 `manifest.json`（見 `agent_first_ux.md` 第 7 節）——兩者的外部化程度不需要同步，任務層級之後有需要再抽離成獨立設定。

每個任務類型／模組的 `tools` 集合是靜態、依 ID 固定給的，不隨任務目前的狀態或對話進度動態增減；也沒有版本機制——改了程式碼或 manifest 就是改了，跟 App 本身的版本綁在一起，同一時間只存在一份定義。多版本並存（例如已進行中的對話沿用建立當下的舊版 `AgentProfile`）是一個獨立於本文件之外的問題，只有在真的出現這種需求時才需要另外設計。

**`AgentProfile` 不是 Skill**：`systemPrompt`（一句話框住角色與邊界）加 `tools`（單一動作的呼叫規格），兩者都不是「教 AI 怎麼一步步協助使用者完成某類任務」的程序性指南（步驟、範例、邊界情況、什麼時候該先問清楚）。後者才是「Skill」這個詞該指的東西，目前無論模組層級或任務層級都還沒有這一層內容，是獨立於 `AgentProfile` 之外、尚待設計的問題。

---

## 3.3. Harness：驅動迴圈、跨模組共用與觀測性

Harness 是驅動「模型 ⇄ 工具執行」這個迴圈的執行環境本身——`AgentProfile`（第 3.2 節）跟 Skill 都只是餵給 harness 的輸入資料，harness 才是真正跑這個迴圈、決定要不要真的執行 AI 選中的動作的程式碼。目前這段邏輯散落在 `ChatBox.svelte`（觸發偵測、呈現確認卡片）與 `store.svelte.js`（確認後執行、結果回填）裡，且完全綁定「設定部門」這一個任務，沒有可以跨模組／跨任務共用的形式。

### 核心迴圈（跨模組/任務共用，不重寫）

```
1. 組 AgentProfile（systemPrompt + tools）送給模型
2. 收到回應：
   - 無 tool_call → 直接顯示文字回覆
   - 有 tool_call → 白名單檢查 function.name 是否在 AgentProfile.tools 內
     → 通過：查該工具的 ToolHandler，呼叫 handler.describeConfirmation(args)
       產生確認文字，插入待確認卡片
     → 不通過：AI 選中未宣告過的工具，視為異常（見下方觀測性）
3. 使用者確認後：呼叫 handler.execute(args)
4. 執行結果丟給 handler.formatResult(result)，插入對話訊息
```

### ToolHandler（各模組/任務註冊，harness 核心不需要知道細節）

```typescript
interface ToolHandler {
  definition: ToolDefinition;
  describeConfirmation(args): string;
  execute(args): Promise<unknown>;
  formatResult(result): string;
  requiresConfirmation?: boolean;   // 預設 true，唯讀查詢可設 false
}
```

harness 核心迴圈只寫一次、跨模組共用；各模組/任務只要註冊自己的 `ToolHandler[]`，不用重寫整套確認卡片流程。`requiresConfirmation` 讓「唯讀查詢是否也要走確認卡片」變成每個工具自己的明確選擇，不是套用同一套流程時的疏漏。

### 是否讓 harness 本身可抽換（不同實作互換）

現階段不做。目前只有一個實作（#93/#94 的部門偵測），沒有第二個具體案例可以歸納「抽換介面該長什麼樣」——跟 `agent_first_ux.md` 原先那套模組層級設計犯過的錯一樣：在還沒有真實案例前先設計一層抽象。常見會想「優化」的地方，都已經有更精準的抽換點可以用，不需要整個 harness 可抽換：換 LLM 供應商/模型交給 `NimClient` trait；要不要確認交給 `ToolHandler.requiresConfirmation`；重試/逾時策略是 `NimClient` 實作內部的事。真的需要「整套迴圈邏輯本身要換」（例如模型一次連續選好幾個工具、不必每次都回來問人，跟現在的單輪一個工具不同形狀）的情境出現時，才需要設計抽換介面。

### 觀測性——兩條分開的紀錄，不要混用同一張表

**1. 人的決定**（沿用既有 `audit_logs` 表：`id`/`action_type`/`arguments`/`decision`/`operator`/`timestamp`，已用於訂單核准/拒絕流程）：每次確認/取消寫一筆，`decision` = `"approved"`/`"rejected"`（沿用既有訂單核准流程的詞彙，不同功能不要各自發明一套決定詞彙）；白名單檢查未通過時也寫一筆，`decision` = `"rejected_unauthorized"`，跟使用者主動取消分開查，用來事後追蹤 AI 有沒有出現越界呼叫的異常行為。目前部門建立/查詢流程完全沒有寫入這張表——harness 落地時要補上，這不是新增能力，是把既有機制套用到所有工具呼叫。

**2. LLM 互動內容**（新表 `llm_traces`，供事後檢視、優化 prompt 用，跟業務稽核用的 `audit_logs` 刻意分開，不合併）：

```sql
CREATE TABLE llm_traces (
  id TEXT PRIMARY KEY,
  agent_scope TEXT NOT NULL,      -- 這次呼叫屬於哪個 AgentProfile（module id 或 task id）
  system_prompt TEXT NOT NULL,
  tools_json TEXT NOT NULL,       -- 送出的 tools schema
  user_message TEXT NOT NULL,
  raw_response TEXT,              -- 模型原始回應（content 或 tool_calls 的 JSON）
  parsed_result TEXT,             -- harness 解析後的結果
  model TEXT NOT NULL,
  latency_ms INTEGER,
  error TEXT,                     -- 呼叫失敗時記錄錯誤訊息
  human_decision TEXT,            -- 之後使用者確認/取消的結果，NULL = 尚未確認或無需確認
  created_at INTEGER NOT NULL
)
```

harness 核心每次呼叫模型就寫一筆（`parsed_result`/`error` 收到回應後補上），使用者確認/取消時回填同一筆的 `human_decision`（用 `id` 關聯，不等使用者做出決定才一次寫入，避免沒有決定的案例查不到模型當時的判斷）。這樣可以直接查「哪些 `parsed_result` 是 `NULL` 但 `user_message` 看起來應該要中」、「哪些被使用者 cancel、原始輸入長什麼樣」，拿去調整 `system_prompt`。

**保留期限**：預設保留 30 天，可用環境變數 `AGENT_ERP_LLM_TRACE_RETENTION_DAYS` 覆寫（比照現有 `AGENT_ERP_SEED_DEMO_DATA`/`TPS2_BASE_URL` 的慣例）。App 啟動時執行一次 `DELETE FROM llm_traces WHERE created_at < now - retention_days`，不另開背景排程/timer——跟這個專案目前沒有背景常駐服務的風格一致。不做「無限期保留、之後再讓使用者手動清」，避免累積成使用者沒注意過的儲存負擔。

**不在這次規劃範圍內**：`llm_traces` 是給開發者調 prompt 用的工程資料，跟業務稽核軌跡的用途不同，兩張表刻意不合併。執行結果失敗（例如核准後才發現部門重名）目前只透過對話訊息/Toast 呈現給使用者，不寫進 `audit_logs`——這張表的 `decision` 欄位語意是「人的決定」，不是「執行結果」，混在一起會讓查詢語意不清楚；之後真的需要追蹤「核准了但執行失敗」的案例，要另外設計，不要塞進同一個欄位。

---

## 4. 任務面板（Task Panel）

常駐於側邊欄旁的獨立面板（可收合），顯示與目前使用者相關的任務：

- 標題列顯示未完成任務數量徽章（`pending` + `in_progress` 的數量總和，不含 `done`/`cancelled`）
- 每個任務卡片顯示：標題、狀態標籤、（若為子任務）父任務名稱、指派對象、（若已完成）完成時間
- 點擊任務卡片：載入該任務綁定的 `Conversation` 到 `agent-main`，若任務所屬模組跟目前不同，Shell 同步切換模組（`AgentProfile` 一併替換，見第 3.2 節與 `agent_first_ux.md` 第 3 節）

---

## 5. AI 主動開場與快速起點卡片

使用者進入模組、尚未選定任何任務時，AI 的開場白主動報告現況，不是固定招呼詞：

> 你好，我是 AgentERP 智能助理。您目前有 **{n}** 筆待處理任務、**{m}** 則未讀通知。想從下面的常用任務開始，或直接跟我說您需要什麼協助：

下方渲染一組「常用任務類型」卡片（依模組宣告的工具範疇整理，非特定任務實例），使用者點擊即可帶著範例意圖起手；也可以完全忽略卡片、直接輸入自然語言。

---

## 6. 與通知系統的關係

`notification_system.md` 定義的通知是一次性的 FYI 推送；Task 是可追蹤、可恢復的工作單位。兩者透過通知的 `action` 欄位串接：一則通知可以將 `action.target` 指向一個 Task id，使用者點擊通知即直接跳轉並載入該 Task 的對話——但通知本身「已讀/關閉」的生命週期跟 Task 的 `status` 是獨立的兩件事，不要混用同一套狀態機。

「現況總覽」區塊分開列出「待處理任務數」與「未讀通知數」兩個計數，維持兩者概念獨立。

---

## 7. 套用範例：#73 新租戶起步引導

1. `create-tenant`/`register-tenant` 成功、且判定為全新租戶（見 #73）時，系統自動建立父任務「新租戶起步」（`status: in_progress`），以及三個子任務：「設定部門」「邀請成員」「指派角色」（皆為 `pending`）
2. 使用者進入主畫面，AI 開場白依第 5 節的格式，報告「3 筆待處理任務」，並在 `context-panel` 渲染一張 `action-list` 卡片（見 `agent_first_ux.md` 第 6 節）列出三個子任務
3. 使用者點擊某個子任務（例如「設定部門」），切換到該子任務的**子 Agent**，在其專屬 `Conversation` 裡用自然語言完成（例如「幫我新增一個部門」），子 Agent 執行後，該子任務狀態轉為 `done`
4. 子 Agent 把結果摘要回報給主 Agent 的環境對話（「✅「設定部門」已完成，新增了『銷售部』」），使用者不用切回子任務也能在環境對話看到進度
5. 三個子任務都 `done` 後，主 Agent 提示「新租戶起步」父任務是否可標記完成

---

## 8. 待確認事項

- Task 的持久化位置（本機 SQLite 或依 M1 的 mock/real 切換機制對接 TPS2）尚未定案，需要跟後端討論這是純前端本機概念、還是需要跨裝置同步的伺服器端資料
- AI 判斷「對話該不該提升為 Task」的具體規則（關鍵字？意圖分類？）需要在實作時進一步定義，本文件只定義機制與資料模型，不涵蓋判斷演算法細節
