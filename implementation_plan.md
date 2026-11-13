# 實作計畫：採購單領域模組化重構（Issue #245 / #243）

本計畫針對 Issue #245（上層情境 #243 領域模組化重構），將 M11 採購單生命週期領域從單體架構中抽離至獨立領域目錄 `src/lib/purchaseOrders/`。

---

## 1. 架構現況與重構目標

### 現況
- `src/lib/store.svelte.js` 中包含採購單（PO）與倉庫/庫存（Inventory）混合的章節「Purchase Orders & Inventory Management」。
- `src/lib/tauri.js` 包含 10 個採購單核心 command 及 mock state（`mockPurchaseOrders`, `mockPurchaseOrderLines`）。
- `src/lib/workflow/purchaseOrders.js` 定義了對話式 AgentProfile 及 ToolHandler。
- `src/lib/components/PurchaseOrdersWorkspace.svelte` 為採購單與庫存檢視的 UI 工作區。

### 重構目標
建立 `src/lib/purchaseOrders/` 模組，包含：
1. `store.js`：純採購單核心 actions（建單、表頭修改、明細增刪修、送出、到貨驗收、取消、選單），並在 `store.svelte.js` 保持命名 re-export 確保 100% 向後相容。
2. `mocks.js`：採購單相關 mock 狀態及 10 個 IPC command mock handlers（`purchaseOrderMocks`），對接 `tauri.js` 的 `domainMocks` 派送表。
3. `workflow.js`：搬移 `workflow/purchaseOrders.js`，包含 ToolHandlers 與 AgentProfile；在原位置保留 re-export stub。
4. `Workspace.svelte`：搬移 `components/PurchaseOrdersWorkspace.svelte`，並在原位置保留 re-export stub；更新 `App.svelte` 引用路徑。

### 明確邊界守則
- 庫存流水帳與查詢（`fetchInventoryLevels`, `fetchUnitInventoryLevel`, `fetchInventoryMovements`）及期初底帳（`recordOpeningInventoryBalanceAction`）、倉庫管理（`fetchWarehouses` 等）屬於跨模組共用與倉庫範疇（M12），**留在 `store.svelte.js` / 共用層，不搬入 `purchaseOrders`**。
- 不改變任何商業邏輯、不變更 Rust 後端程式碼。

---

## 2. 測試觀點表（Test Perspectives Table）

依據 `.agent/rules/test-strategy.md` 設計等價類劃分與邊界值測試觀點：

| Case ID | 輸入 / 前置條件 | 測試觀點（等價類 / 邊界值） | 預期結果 | 備註 |
|---|---|---|---|---|
| TC-PO-MOD-01 | 表單入口：建立採購單（含 2 筆明細） | 等價類 – 正常路徑 | 成功建立 draft 採購單與明細，計算正確總金額 | 驗證 `createPurchaseOrderAction` 遷移 |
| TC-PO-MOD-02 | 表單入口：修改採購單表頭與明細 | 等價類 – 正常路徑 | 更新預計到貨日、備註、修改明細數量及單價 | 驗證 `updatePurchaseOrderHeaderAction`, `updatePurchaseOrderLineAction` |
| TC-PO-MOD-03 | 表單入口：送出採購單 | 等價類 – 狀態轉換 | draft 成功轉換為 ordered，記錄 ordered_at | 驗證 `submitPurchaseOrderAction` |
| TC-PO-MOD-04 | 表單入口：到貨驗收（含數量差異） | 邊界值 / 業務情境 – 數量短缺與超額 | 成功轉換為 received，正確更新 received_quantity 並寫入入庫異動 | 驗證 `confirmPurchaseOrderReceivedAction` |
| TC-PO-MOD-05 | 表單入口：取消採購單 | 等價類 – 狀態轉換 | draft/ordered 成功轉換為 cancelled | 驗證 `cancelPurchaseOrderAction` |
| TC-PO-MOD-06 | 對話入口：以自然語言建立採購單 | 等價類 – ToolHandler 提取候選單 | 產出待確認卡片（Pending Card），確認後成功建單 | 驗證 `workflow.js` 遷移 |
| TC-PO-MOD-07 | 對話入口：推進下單、到貨確認、取消 | 等價類 – 對話狀態機推進 | 對話 Agent 正確執行各動作並回傳格式化訊息 | 驗證 AgentProfile 與 ToolHandler |
| TC-PO-MOD-08 | 模組化向後相容：從 `store.svelte.js` 與 `workflow/purchaseOrders.js` 引用 | 等價類 – 相容性驗證 | 所有舊有 import 均能正確解析且型別/函式行為一致 | 驗證 re-export stubs |
| TC-PO-MOD-09 | 邊界值：空供應商 ID / 空採購單 ID / 負數數量 / 負數單價 | 邊界值 – 空值與非負數 | 正確拋出驗證錯誤訊息，不影響既有資料 | 邊界檢核 |
| TC-PO-MOD-10 | 全域整合：跨模組與全量現有測試 | 整合驗證 – 全量回歸 | 全數 657+ 前端測試通過、Vite build 正常、Cargo 445 tests 通過 | 驗收標準 |

---

## 3. 實作步驟規劃

1. **建立 `src/lib/purchaseOrders/mocks.js`**
   - 抽出 `mockPurchaseOrders`, `mockPurchaseOrderLines`、序號產生器與格式化工具。
   - 實作 `purchaseOrderMocks` 包含 10 個 IPC 指令處理函式。
   - 在 `src/lib/tauri.js` 引入並註冊至 `domainMocks`，移出既有 switch 語句中對應的 cases。

2. **建立 `src/lib/purchaseOrders/store.js`**
   - 搬移採購單核心 actions（`fetchPurchaseOrders`, `fetchPurchaseOrderDetail`, `selectPurchaseOrder`, `createPurchaseOrderAction`, `updatePurchaseOrderHeaderAction`, `addPurchaseOrderLineAction`, `updatePurchaseOrderLineAction`, `removePurchaseOrderLineAction`, `submitPurchaseOrderAction`, `confirmPurchaseOrderReceivedAction`, `cancelPurchaseOrderAction`）。
   - 在 `src/lib/store.svelte.js` 中保留具名 re-export。

3. **搬移並重命名 `workflow.js`**
   - 將 `src/lib/workflow/purchaseOrders.js` 搬移至 `src/lib/purchaseOrders/workflow.js`。
   - `src/lib/workflow/purchaseOrders.js` 改為向後相容 re-export stub。
   - 更新 `src/lib/workflow/index.js` 指向新路徑。

4. **搬移並重命名 `Workspace.svelte`**
   - 將 `src/lib/components/PurchaseOrdersWorkspace.svelte` 搬移至 `src/lib/purchaseOrders/Workspace.svelte`。
   - `src/lib/components/PurchaseOrdersWorkspace.svelte` 保留相容包裹元件。
   - 更新 `src/App.svelte` 引用路徑至 `src/lib/purchaseOrders/Workspace.svelte`。

5. **驗證與測試**
   - 執行 `npm test` 確認現有 657 項測試全數通過。
   - 執行 `npm run build` 確認 Vite 建置無錯誤。
   - 執行 `cargo test --manifest-path src-tauri/Cargo.toml` 確認後端 445 項測試全數通過。
   - 驗證表單與對話兩條路徑完整走通生命週期（建單→送出→到貨確認含數量差異→取消）。

