# 雲端模組市集同步與下載設計說明書 (Dynamic Module Gallery)

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`module_boundary_architecture.md`](module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本設計定義了 AgentERP 主程式如何向雲端同步可用模組列表，並在背景下載安裝模組包的流程與資料格式。

---

## 1. 雲端市集清單格式 (`modules_gallery.json`)

此檔案託管於 Cloudflare R2（或靜態 CDN），為公有格式：
```json
[
  {
    "id": "sales_bi",
    "name": "Finance BI 大看板",
    "version": "1.0.2",
    "description": "提供即時的銷售數據分析與利潤試算工具。",
    "iconSvg": "<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle></svg>",
    "downloadUrl": "https://cdn.yourdomain.com/modules/sales_bi_1.0.2.zip",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
]
```

---

## 2. 本地資料表結構 (`installed_modules`)

儲存於 SQLite `agent_erp.db` 中，用以記錄本機已安裝且可執行的模組：
```sql
CREATE TABLE IF NOT EXISTS installed_modules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    entry_path TEXT NOT NULL,  -- 本地 AppData 安全目錄中的 JS 進入點路徑
    icon_svg TEXT NOT NULL,    -- 經過 Rust 過濾後安全無毒的 SVG 代碼
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. 開發/下載控制流程

1. **同步清單**：App 啟動時發送 GET 請求讀取 `modules_gallery.json`，在「設定 ➜ 模組市集」面板中比對本機已安裝的版號，標記為 `未安裝`、`已是最新版` 或 `有新版本（可更新）`。
2. **背景下載與校驗**：
   * 用戶點擊下載，前端透過 IPC 調用 `install_module(moduleId, downloadUrl, sha256)`。
   * Rust 下載 ZIP 二進位流，先計算其 **SHA-256** 哈希值並與參數比對，若不一致則立刻拋出錯誤阻斷。
   * 比對無誤後，解壓到安全沙盒路徑 `AppData/modules/{moduleId}/`。
   * 寫入 `installed_modules` 資料表，並透過 Tauri 事件通知前端刷新。
