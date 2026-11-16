# 任務清單：路由表機制與 App.svelte 殼層瘦身重構（Issue #249）

- [x] 0. 規劃與分析 <!-- id: 0 -->
  - [x] 調查 `App.svelte`、各領域 Workspace 元件與路由導覽架構 <!-- id: 0.1 -->
  - [x] 撰寫實作計畫 `implementation_plan.md` 與測試觀點表 <!-- id: 0.2 -->
- [x] 1. 建立 `src/lib/settings/Workspace.svelte` 提取基礎資料工作區 <!-- id: 1 -->
  - [x] 抽取成員、部門組織、技能設定、夥伴、商品規格 BOM、倉庫維護與審計日誌至 `src/lib/settings/Workspace.svelte` <!-- id: 1.1 -->
  - [x] 調整 `tests/settings-entity-card.test.js` 以相容新工作區路徑 <!-- id: 1.2 -->
  - [x] [CR 修復] 補齊 `logoutAction` 與 `simulateTokenExpiry` 具名 import，排除 ReferenceError <!-- id: 1.3 -->
- [x] 2. 建立 `src/lib/routes.js` 路由登記機制 <!-- id: 2 -->
  - [x] 註冊所有領域的 `Workspace.svelte` 與 `ChatBox.svelte` <!-- id: 2.1 -->
  - [x] 實作 `getRoute`, `resolveRouteComponent`, `getRouteLabel`, `getWorkspaceRoutePath` 查表函式 <!-- id: 2.2 -->
  - [x] 保持 `store.svelte.js` 中 `getWorkspaceLabel` 的 100% 向後相容 <!-- id: 2.3 -->
- [x] 3. 重構 `src/App.svelte` 瘦身為 App Shell 骨架 <!-- id: 3 -->
  - [x] 移除所有 inline settings template 與 handlers <!-- id: 3.1 -->
  - [x] 將寫死之長條件式替換為路由表查表渲染 <!-- id: 3.2 -->
  - [x] [CR 修復] 請款單側欄圖示 SVG path 補回遺失的 sweep-flag `0` (`0 0 0 2-2V8z`) <!-- id: 3.3 -->
  - [x] 移除未使用的 `logoutAction` 與 `simulateTokenExpiry` import <!-- id: 3.4 -->
  - [x] 驗證行數大幅下降至 500 行以內 (從 3241 行降至 460 行) <!-- id: 3.5 -->
- [x] 4. 撰寫單元與整合測試 <!-- id: 4 -->
  - [x] 建立 `tests/issue249-route-table-navigation.test.js` <!-- id: 4.1 -->
  - [x] 遵循 Given/When/Then 格式實作等價類與邊界值測試 <!-- id: 4.2 -->
  - [x] 加入 TC-RT-INT-04 與 TC-RT-INT-05 針對 CR 回饋的自動化防回歸測試 <!-- id: 4.3 -->
- [x] 5. 全面建置與回歸驗收 <!-- id: 5 -->
  - [x] 執行 `node --test tests/issue249-route-table-navigation.test.js` (32/32 passed) <!-- id: 5.1 -->
  - [x] 執行 `npm test` 確認全量前端測試通過 (696/696 passed) <!-- id: 5.2 -->
  - [x] 執行 `npm run build` 確認 Vite 建置正常 <!-- id: 5.3 -->
  - [x] 執行 `cargo test` 確認後端測試無回歸 (445/445 passed) <!-- id: 5.4 -->

