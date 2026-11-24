# 模組邊界架構設計說明書 (Module Boundary Architecture)

本文件取代 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的「manifest.json + 五插槽 Shell + 動態 ESM 載入」設計（見文末「跟舊文件的關係」）。這裡定義的是實際採用、分階段落地的模組邊界架構。

---

## 1. 背景：為什麼現在要做

`src/lib/store.svelte.js`（約 5200 行）、`src/lib/tauri.js`（約 7700 行，單一 `invoke(cmd, args)` 函式裡一條上百個 case 的 switch）、`src/App.svelte`（約 3200 行）隨 M1-M15 開發累積成上帝檔案——每個 milestone 的 issue 範圍都會寫「`tauri.js` mock 同步」，往同一個檔案加東西，沒有人中途喊停去拆，因為當時的優先序是先把 M1、再把整個 ERP 核心業務流程做完。這個決定本身沒有錯，但累積到現在，三個檔案已經讓「哪段程式碼屬於哪個業務領域」只能靠人工紀律維持，Code Review 也很難抓到越界存取。

這份文件定義的架構，分三個階段：

| 階段 / 層次 | 內容 | 架構定義與邊界決策 |
|---|---|---|
| Stage 1 | 把三個上帝檔案拆成領域資料夾，模組邊界變成實體目錄 | 實體領域目錄作為邊界（見第 2 節） |
| Stage 2 | 前端動態載入與領域清單（簡化版的舊 `module_manifest_contract.md` 設計） | 領域宣告式清單與動態路由載入（見第 3 節） |
| Stage 3 | 後端 WASM 插件主機，真正不重新編譯就能上後端新功能 | **明確不做**（見第 4 節與第 5 節） |

---

## 2. Stage 1：領域資料夾邊界

### 2.1 目標結構

```
src/lib/
  store.svelte.js      -- 共用殼層：appState 核心骨架 + 登入/租戶/Task Panel/通知/導覽
  tauri.js              -- 共用殼層：薄 dispatcher，查表呼叫各領域的 mocks.js
  paymentTerms.js        -- 跨領域共用的計算工具
  workflow/
    index.js            -- taskProfileMap 跨領域註冊表
    domains.js           -- KNOWN_DOMAINS，目前最接近「module manifest」的既有機制
  {domain}/              -- 例：purchaseOrders、quotes、salesOrders、vendorBills、
    mocks.js             --   accountsPayable、vendorPayments、openingPayables、
    store.js             --   warehouses、inventoryAdjustments、stockTransfers、
    workflow.js           --   stocktakes、partners、products、departments
    Workspace.svelte
```

### 2.2 邊界原則

- **一個 Rust 檔案對應一個前端領域資料夾**：`src-tauri/src/{domain}.rs` ↔ `src/lib/{domain}/`，這是最明確、最不會吵架的切法。
- **領域資料夾只能操作自己名下的 `appState` key**：報價要讀商品標準售價，`import` 商品領域的 `store.js` 函式，不直接伸手進商品的 state。
- **共用殼層不屬於任何單一領域**：登入態、租戶、Task Panel、通知、導覽路由、`apiCall` 共用轉發留在外層。
- **跨領域依賴是正常的，不是要消除的東西**：ERP 業務本來就有真實的跨模組依賴（報價依賴商品標準價、應收依賴銷售單出貨），Stage 1 要做的是讓依賴關係顯式（透過 import 函式），不是假裝模組之間互不相干。

### 2.3 跟既有機制的關係

- `workflow/domains.js` 的 `KNOWN_DOMAINS` 註冊表、`agent-skill-authoring.md` 定義的 `id`/`domain` 慣例維持不變，是目前唯一真正落地的「模組識別」機制，Stage 1 不重新發明一套。
- Rust 後端已經是一個檔案一個領域，Stage 1 不需要改動後端。

---

## 3. Stage 2：前端動態載入與領域清單規格

在 Stage 1 的實體目錄邊界確定後，前端架構採用領域宣告式清單（Domain Manifest）、Vite/Rollup 程式碼切割（Code Splitting）與非同步動態載入，達成效能精簡與模組解耦。

### 3.1 核心架構理念與安全模型

Stage 2 沿用舊 `module_manifest_contract.md` 的核心構想（manifest 宣告、插槽式佈局），但依第 5 節的前提（全模組由自家團隊開發），重新界定防禦邊界：

- **SHA-256 完整性校驗、SQL 掃描與 permissions.ipc 權限集合**：**明確不實作**。舊設計為防範不信任第三方外部外掛設計了下載 SHA-256 雜湊校驗、SQL 語法攔截與 IPC 權限沙盒；現行所有業務領域模組皆為內部團隊開發並納入同一 git 倉庫，程式碼完整性由 Git 與 CI 版本控制保證，故不實作外部雜湊檢驗，manifest 亦不包含 permissions 欄位（以 3.2 節定案之 7 個欄位為準）。
- **圖示安全（SVG 白名單）**：舊設計的即時 SVG 消毒過濾轉化為兩道靜態防線：CI 階段透過 `scripts/verify-domain-manifests.mjs` 檢驗 manifest 宣告之圖示必須存在於 `KNOWN_ICONS` 白名單；前端元件 `Icon.svelte` 採用純 Svelte 條件聲明式渲染 SVG `<path>`，完全排除 `{@html}` 語法，杜絕任意 SVG 或 XSS 腳本注入。
- **防禦性動態載入**：在非同步載入工作區元件時，納入競態取消 Token（Race Condition Cancellation）與錯誤降級 UI（Error Fallback），防止網路波動或快速連續點擊切換導致的白畫面與狀態撕裂。

---

### 3.2 領域清單（Domain Manifest）Schema 與欄位定義

14 個業務領域資料夾根目錄具備單一 `manifest.json`，作為領域的元資料宣告契約（另有 5 個應收相關工作區以 `ADDITIONAL_ROUTES` 註冊，見 3.3 節）。格式定案如下：

```json
{
  "id": "quotes",
  "label": "報價單",
  "icon": "clipboard-list",
  "route": "/app/quotes",
  "aliases": [
    "quotes",
    "quote",
    "/app/quote"
  ],
  "entry": "Workspace.svelte",
  "topLevelNav": true
}
```

#### 欄位規範與型別約束

| 欄位名稱 | 型別 | 必填 | 規範與說明 |
|---|---|---|---|
| `id` | `string` | 是 | 領域唯一識別碼，必須與領域資料夾名稱完全一致（例如 `quotes`、`salesOrders`）。 |
| `label` | `string` | 是 | 繁體中文工作區顯示名稱（例如 `報價單`、`採購單`）。 |
| `icon` | `string` | 是 | 圖示識別字串，必須註冊於 `src/lib/icons.js` 之 `KNOWN_ICONS` 白名單中。 |
| `route` | `string` | 是 | 標準 canonical 路由路徑，必須以 `/` 開頭（例如 `/app/quotes`）。 |
| `aliases` | `string[]` | 是 | 路由別名清單，包含舊式路徑或無前綴識別碼，用於向後相容。 |
| `entry` | `string` | 是 | 領域前端進入點檔案名稱，通常為 `Workspace.svelte`，且檔案必須實體存在。 |
| `topLevelNav` | `boolean` | 是 | 布林值，宣告該領域是否於頂層側邊欄主導覽列中顯示按鈕。 |

---

### 3.3 動態路由表與 Code Splitting 機制

路由表由 `src/lib/routes.js` 統一管理，全面告別靜態全部引入，由三組路由來源組合而成，且所有工作區皆透過具名動態 `import()` 實現程式碼切割（Code Splitting）：

1. **路由來源組合（`ROUTES`）**：
   - **核心殼層路由（`CORE_ROUTES`）**：包含 AI 助理（`/app/agent`）與系統設定（`/app/settings`）。
   - **領域清單驅動路由（`MANIFEST_ROUTES`）**：由 14 個業務領域之 `DOMAIN_MANIFESTS` 動態對應生成。
   - **獨立擴充路由（`ADDITIONAL_ROUTES`）**：涵蓋 5 個未配置 manifest、於 `routes.js` 直接定義路由契約的業務工作區（`opening-receivables`、`customer-invoices`、`accounts-receivable`、`customer-credit`、`customer-receipts`），同樣使用 `DOMAIN_LOADERS` 實現非同步動態載入。
2. **靜態宣告動態 Loader（`DOMAIN_LOADERS`）**：
   ```javascript
   export const DOMAIN_LOADERS = {
     quotes: createLazyComponent('QuotesWorkspace', () => import('./quotes/Workspace.svelte')),
     salesOrders: createLazyComponent('SalesOrdersWorkspace', () => import('./salesOrders/Workspace.svelte')),
     accountsReceivable: createLazyComponent('AccountsReceivableWorkspace', () => import('./accountsReceivable/Workspace.svelte')),
     // ...其餘領域與工作區
   };
   ```
   透過字面值 `() => import(...)` 讓 Vite / Rollup 在 build 階段進行靜態分析，將各領域切為獨立實體 chunk。
3. **包裝函式 `createLazyComponent(name, loader)`**：
   封裝 loader 並賦予 `componentName` 屬性，在兼顧非同步呼叫的同時保留測試反射與除錯能力。
4. **查表函式向後相容**：
   `resolveRouteComponent(routeOrKey)`、`getRouteLabel(routeOrKey)`、`getWorkspaceRoutePath(ws)` 統一支援標準路徑、別名與 Hash 前綴查詢。

---

### 3.4 非同步載入彈性與防禦機制

在 `src/App.svelte` 中，工作區元件解析升級為非同步流程，並具備完整防禦機制：

```javascript
$effect(() => {
  const route = appState.route;
  const loader = resolveRouteComponent(route);
  if (loader && loader === currentLoadedLoader && ActiveWorkspace) return;

  isWorkspaceLoading = true;
  workspaceLoadError = null;
  ActiveWorkspace = null;
  let cancelled = false;

  // 執行 loader 並處理 Promise
  // 利用 cancellation token 避免快速連續切換產生競態覆蓋
  return () => { cancelled = true; };
});
```

- **狀態指示（Loading Indicator）**：載入中顯示符合無障礙規範（`role="status"`、`aria-live="polite"`）的骨架或讀取動畫。
- **取消 Token（Cancellation Token）**：當使用者在網路緩慢時快速連續點擊切換，前一次 Promise 完成時會因 `cancelled === true` 而放棄狀態寫入，避免後發先至的競態撕裂。
- **錯誤降級 UI（Error Fallback）**：當模組 chunk 載入失敗（例如網路斷線或版本發佈後舊 chunk 404）時，不會引發白畫面，而是呈現友善錯誤面板，並提供「重新整理頁面」與「返回 AI 助理」按鈕供使用者復原。

---

### 3.5 頂層側欄導覽與聲明式圖示安全

`App.svelte` 的業務工作區側欄導覽解耦為清單驅動迴圈，移除業務領域的硬編碼按鈕與 inline SVG：

- **動態導覽項目聚合（`getTopLevelNavRoutes`）**：側欄主導覽區透過 `getTopLevelNavRoutes()` 動態合併具備 `topLevelNav: true` 的項目，來源包含核心路由（AI 助理）、14 個領域清單宣告 `topLevelNav: true` 的項目（採購單、請款單、倉庫管理、應付帳款、報價單、銷售單），以及 `ADDITIONAL_ROUTES` 中標記 `topLevelNav: true` 的工作區（銷項發票、應收帳款、客戶信用、客戶收款單），以 Svelte `{#each topLevelNavItems as nav (nav.id)}` 迴圈動態渲染；系統設定按鈕（`#rail-nav-settings`）與頂部品牌 Logo 則作為 `App.svelte` 導覽列中的獨立固定按鈕，系統設定在 `CORE_ROUTES` 中標記 `topLevelNav: false`，不經由 `getTopLevelNavRoutes()`。
- **聲明式白名單圖示（`<Icon name={nav.icon} />`）**：在 `src/lib/components/Icon.svelte` 透過純 Svelte 條件渲染 SVG `<path>`，完全排除 `{@html}` 語法，消除 SVG 腳本注入風險，且圖示名稱嚴格受 `KNOWN_ICONS` 白名單限制。
- **集中式 Active 判斷（`isNavActive`）**：自動支援標準路徑與各來源定義之 `aliases`，確保從任一途徑或別名切換皆能正確高亮目前工作區。

---

### 3.6 CI 靜態驗證機制

為確保模組邊界宣告不會隨時間退化或人為失誤損毀，在 CI 品質檢驗管線中加入專用腳本：

- **檢驗腳本**：`scripts/verify-domain-manifests.mjs`。
- **執行指令**：`npm run verify:manifests`。
- **檢驗範疇**：
  1. 14 個業務領域目錄全數包含 `manifest.json`。
  2. 欄位型別與必填約束（id、label、icon、route、aliases、entry、topLevelNav）。
  3. 領域 `id` 必須與資料夾名稱完全匹配。
  4. 領域 `id` 全域唯一無重複。
  5. 圖示名稱必須存在於 `KNOWN_ICONS` 白名單。
  6. 進入點檔案 `entry` 必須在目錄下實體存在。

---

### 3.7 Bundle 切割量測成果（Before vs After）

Stage 2 實作完成後，經由 `npm run build` 實測比對驗證動態載入之實際效益：

| 指標維度 | Stage 2 之前（靜態單體導入） | Stage 2 之後（Manifest 動態載入） | 效益對比 |
|---|---|---|---|
| **主 JavaScript Bundle** | **1,089.02 kB** (gzip: ~260 kB) | **425.56 kB** (gzip: 116.68 kB) | **縮減 663.46 kB（降低 60.9%）** |
| **實體 JS Chunk 總數** | 1 個（單體） | **24 個獨立 Chunk** | 各領域 Workspace、ChatBox 獨立為物理檔案 |
| **實體 CSS Chunk 總數** | 1 個（單體） | **14 個 Scoped CSS Chunk** | 樣式依工作區隨選加載 |
| **隨選加載實測驗證** | 無法隨選（首頁一次全下載） | **確認隨選（On-demand Chunk）** | 切換工作區才動態下載對應的 `Workspace-*.js` |

---

## 4. Stage 3：明確不做

後端真正的動態載入（新增/移除 Tauri command 不需要重新編譯整個 App）需要一個外掛主機：Rust 核心定義穩定的 ABI/trait，每個模組編譯成 `.wasm`，用 `wasmtime`/`wasmer` 之類的 runtime 載入。

**明確不做**，理由見第 5 節：模組永遠是自家團隊寫的，WASM 插件主機原本用來隔離不信任程式碼的特性大部分用不到，純粹是為「不重新編譯就能上新後端功能」這個部署彈性付出的高成本，目前沒有足夠頻繁的需求值得這個投入。

---

## 5. 前提：模組永遠是自家團隊開發

跟舊 `phase1_scope_review.md` 已經確認過的前提一致：**第三方模組開發者不是現階段的產品方向**——所有模組都是自家團隊開發、走自己的 CI/CD 發佈，不對外開放給不信任的第三方開發者安裝。這個前提是 Stage 2 簡化即時防禦機制、Stage 3 不做的共同理由。若之後產品方向改變（真的要開放第三方開發者），本文件的 Stage 2/3 判斷要整個重新評估，不能延用這裡的降級結論。

---

## 6. 跟舊文件的關係

Phase 0/1 時期的舊構想（manifest.json、五插槽 Shell、動態 ESM 載入、雲端模組市集、SHA-256 五步驟安裝驗證鏈）對應的實作程式碼（`mock_cdn/`、`downloader.rs`）已經在清理舊展示功能時移除，現在的 ERP 程式碼完全沒有採用這套設計。描述這套舊設計的文件（`phase1_scope_review.md`、`module_manifest_contract.md`、`shell_layout_architecture.md`、`dynamic_module_gallery.md`、`dynamic_sqlite_initialization.md`、`svg_sanitizer_security.md`、`pluggable_svg_menu_keepalive.md`、`phases/0.md`、`phases/1.md`）已經整份移除，不留存——跟現在程式碼完全脫節的舊設計文件留著只會誤導之後的人以為這條架構還活著，過去的決策脈絡已經寫進本文件第 1 節，不需要靠保留原文件追溯。

本文件（Stage 1 與 Stage 2 的落地方案）跟舊設計最大的差異：舊設計一開始就假設要為第三方開發者做動態載入與沙盒防禦，本文件在邊界穩定後以自家團隊開發為前提落地前端動態載入（Stage 2），而後端動態載入（Stage 3）明確不做。
