# 模組邊界架構設計說明書 (Module Boundary Architecture)

本文件取代 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的「manifest.json + 五插槽 Shell + 動態 ESM 載入」設計（見文末「跟舊文件的關係」）。這裡定義的是實際採用、分階段落地的模組邊界架構。

---

## 1. 背景：為什麼現在要做

`src/lib/store.svelte.js`（約 5200 行）、`src/lib/tauri.js`（約 7700 行，單一 `invoke(cmd, args)` 函式裡一條上百個 case 的 switch）、`src/App.svelte`（約 3200 行）隨 M1-M15 開發累積成上帝檔案——每個 milestone 的 issue 範圍都會寫「`tauri.js` mock 同步」，往同一個檔案加東西，沒有人中途喊停去拆，因為當時的優先序是先把 M1、再把整個 ERP 核心業務流程做完。這個決定本身沒有錯，但累積到現在，三個檔案已經讓「哪段程式碼屬於哪個業務領域」只能靠人工紀律維持，Code Review 也很難抓到越界存取。

這份文件定義的架構，分三個階段：

| 階段 | 內容 | 狀態 |
|---|---|---|
| Stage 1 | 把三個上帝檔案拆成領域資料夾，模組邊界變成實體目錄 | 本文件生效時的目標（對應 Gitea milestone「Phase 2 - 模組邊界重構」） |
| Stage 2 | 前端動態載入（簡化版的舊 `module_manifest_contract.md` 設計） | 排在 Stage 1 之後，等邊界穩定才有意義做 |
| Stage 3 | 後端 WASM 插件主機，真正不重新編譯就能上後端新功能 | **明確不做**，見第 5 節 |

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

## 3. Stage 2：前端動態載入（簡化版）

等 Stage 1 的邊界穩定、每個領域資料夾都是自成一體的單元之後，才有條件做動態載入——邊界不清楚時做動態載入只是把問題搬到執行期。

Stage 2 沿用舊 `module_manifest_contract.md` 的核心構想（manifest 宣告、`permissions.ipc` 白名單、插槽式佈局），但依下方第 5 節的前提，把原本為了防禦「不信任第三方程式碼」設計的即時攔截機制降級：

- SHA-256 完整性校驗、SVG 過濾、SQL 語句白名單掃描：降級為 CI 階段的品質檢查，不是 Rust 端每次安裝都要即時掃描
- `agent.skills ⊆ permissions.ipc` 白名單機制：保留。這防的是「AI 自己判斷錯誤、呼叫了不該呼叫的工具」，跟模組作者是否可信無關，即使模組都是自家寫的，AI agent 的工具呼叫範圍仍然需要被約束

Stage 2 具體要做的事（排在 Stage 1 之後，本文件先留下方向，細節等排進 milestone 時再補規格）：
- `App.svelte` 的路由表（Stage 1 第 6 張 issue的產出）從靜態 import 換成動態 `import()`
- 每個領域資料夾可以加一個簡化版 `manifest.json`，但這是宣告文件，不是安裝驗證鏈的入口

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

本文件（Stage 1 的目標架構）跟舊設計最大的差異：舊設計一開始就假設要做動態載入（Stage 2/3 的東西），本文件把動態載入排到邊界先穩定之後才做，而且後端動態載入（Stage 3）明確不做。
