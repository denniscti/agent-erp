# SVG 圖示安全過濾與限制設計說明書 (SVG Sanitizer Security)

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`module_boundary_architecture.md`](module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本設計定義了 Rust 本地核心在將模組的 SVG 圖示存入本地 SQLite 前，如何進行字串長度與標籤/屬性的安全過濾，杜絕跨站腳本攻擊 (XSS) 與本地程式控制權限外洩。

---

## 1. 威脅模型 (Threat Model)

* **攻擊途徑**：惡意模組的 `manifest.json` 中內嵌帶有惡意 JavaScript 的 SVG 圖示（如 `<svg onload="alert(1)">` 或 `<script>` 標籤）。
* **潛在危害**：因為 WebView 擁有 Tauri API 權限，若惡意 JS 執行，可能會藉由 Tauri 安全通道非法調用本地系統 API，讀取硬碟文件或篡改配置。

---

## 2. 雙重防禦過濾機制

Rust 在接收到註冊請求、寫入 SQLite 前，將對 `iconSvg` 進行以下過濾：

### 2.1. 長度硬性限制 (Length Guard)
* **規則**：`iconSvg` 字串長度限制在 **4000 字元** 以內。
* **目的**：足以容納所有常規的 UI 向量圖示，但能有效阻斷在 SVG 中嵌入大型編碼惡意二進位檔案或極長程式碼的企圖。

### 2.2. 標籤與屬性過濾 (Tag & Event Scrubbing)
Rust 本地端會使用正則表達式或 XML 掃描器，對 SVG 內容進行以下清理：

1. **標籤黑名單 (Element Blacklist)**：
   * 移除或拒絕任何含有以下標籤的 SVG：`<script>`、`<iframe>`、`<object>`、`<embed>`、`<foreignObject>`。
2. **事件屬性清除 (Event Attributes Purge)**：
   * 移除所有以 `on` 開頭的屬性（例如 `onclick`、`onload`、`onmouseover`、`onerror` 等）。
   * 移除屬性中包含 `javascript:` 或 `data:` 協議的連結（如 `href="javascript:..."`）。
3. **白名單繪圖元素 (Whitelist)**：
   * 僅保留安全的向量繪圖元素：`svg`, `path`, `g`, `circle`, `rect`, `line`, `polyline`, `polygon`, `ellipse`, `defs`, `linearGradient`, `stop`, `style` (純 CSS，不含 JS)。

---

## 3. 前端安全渲染

通過 Rust 安全過濾並存入資料庫的 `iconSvg`，前端 Svelte 才允許使用 `{@html}` 進行渲染。這保證了渲染的圖示 100% 無害，實現安全可靠的動態側邊欄。
