# Phase 1 範圍檢視與優先順序建議

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`system_design/module_boundary_architecture.md`](system_design/module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本文件記錄對 `docs/phases/1.md` 與 `docs/system_design/` 底下模組系統相關設計（`module_manifest_contract.md`、`dynamic_module_gallery.md`、`dynamic_sqlite_initialization.md`、`svg_sanitizer_security.md`、`pluggable_svg_menu_keepalive.md`）的檢視結論，供後續排優先順序參考。

---

## 前提確認

**第三方模組開發者不是現階段的產品方向**——所有模組（Finance BI、CRM 等）目前且可預見的未來都是自家團隊開發、走自己的 CI/CD 發佈。這個前提改變了原本設計中「防禦不信任第三方程式碼」那一整套機制的必要性。

---

## 建議降級／簡化的部分

以下機制的設計初衷是防禦「不信任的第三方輸入」，在模組永遠是自家程式碼的前提下，即時攔截的必要性不高，建議降級為 CI 階段的品質檢查，而非 Rust 端每次安裝都要即時掃描：

- **SVG 過濾**（`svg_sanitizer_security.md`）：標籤黑名單、事件屬性清除、長度限制
- **SQL 語句白名單掃描**（`dynamic_sqlite_initialization.md`）：`CREATE TABLE` 語法審計、禁用關鍵字檢查
- **SHA-256 完整性校驗 + 五步驟安裝驗證鏈**（`module_manifest_contract.md` 第 6 節）：可精簡為單一步驟的基本檢查

## 建議保留的部分

- **`agent.skills ⊆ permissions.ipc` 白名單機制**：這個防的是「AI 自己判斷錯誤、呼叫了不該呼叫的工具」，跟模組作者是否可信無關，即使模組都是自家寫的，AI agent 的工具呼叫範圍仍然需要被約束在當前情境內。這是本次設計中最值得優先落地的部分。

## 真正的缺口：完全沒有租戶邊界

`module_{module_id}_*` 的表名隔離目前只做到「模組跟模組互不干擾」，沒有設計「同一模組、不同租戶之間的資料如何隔離」。這跟模組作者是誰無關，是多租戶架構的基本要求，且與 M1（帳號與租戶起步）正在建立的 Tenant/Company 模型直接相關。若 Phase 1 的模組系統照現有設計繼續往下做，等 M1 的多租戶正式上線後，資料表結構與權限模型大概率需要整個回頭改（表名前綴要多一層 `tenant_id`、`permissions.ipc` 的存取範圍也要納入租戶隔離）。

## 其他觀察

- `fetchModulesGallery()` 目前在每次 App 啟動時就會呼叫外部網址，與產品定位的「本地優先／邊緣運算」（AgentERP Edge）調性有落差，建議改成使用者進入「模組市集」分頁才觸發。

---

## 建議優先順序

1. 完成 M1（帳號與租戶起步）
2. 補上模組系統的 tenant 邊界設計（表名前綴、IPC 權限範圍納入租戶隔離）
3. 落地 agent-first 的 `skills` 白名單機制
4. 其餘（模組市集下載/更新、SVG 沙盒防禦、通知系統）視實際需求再排入，且第三方沙盒防禦相關機制可先簡化為 CI 階段檢查，不急著做即時攔截
