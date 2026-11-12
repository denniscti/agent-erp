# 模組專屬 SQLite 加密建表機制設計說明書 (Dynamic SQLite Initialization)

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`module_boundary_architecture.md`](module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本設計定義了 Rust 後端如何提供一個安全的安全 IPC 通道，允許獨立下載的業務模組動態初始化自己所需的加密 SQLite 資料表，同時不危害核心資料表的安全。

---

## 1. 安全 IPC 接口

Rust 端將導出以下 Tauri Command 接口：

```rust
#[tauri::command]
async fn initialize_module_db(
    app_handle: tauri::AppHandle,
    module_id: String,
    create_table_sql: String
) -> Result<(), String> {
    // 執行安全校驗與 SQL 執行
    db::setup_module_table(&app_handle, &module_id, &create_table_sql)
}
```

---

## 2. 嚴格的安全防禦機制

由於 SQL 語句是由前端模組傳入的，為防止惡意代碼，Rust 端會執行以下防禦：

### 2.1. 命名空間前綴限制 (Namespace Prefix)
* **規則**：模組所申請建立的資料表，名稱必須且只能以 `module_{module_id}_` 為前綴。
* **範例**：若 `moduleId` 為 `sales_bi`，則建立的資料表必須命名為 `module_sales_bi_settings` 或 `module_sales_bi_cache`。
* **檢查方式**：Rust 會解析 SQL 語句或使用正則表達式，提取 `CREATE TABLE` 後的表名，確認其符合前綴規則。若表名不符，直接拒絕執行。

### 2.2. SQL 語法白名單與黑名單 (SQL Auditing)
* **禁用關鍵字**：SQL 語句中嚴禁出現 `DROP TABLE`、`ALTER TABLE` 等可能破壞現有結構的指令。
* **系統資料表保護**：嚴禁 SQL 包含任何系統核心資料表名稱（如 `mirrored_orders`、`audit_logs`、`installed_modules`）。
* **操作受限**：此 IPC 接口僅允許執行 `CREATE TABLE IF NOT EXISTS` 語句，禁止在此階段直接傳入 `INSERT` 或 `DELETE` 大量未知 SQL（資料增刪改查將由模組後續專屬的 CRUD API 或安全參數綁定查詢執行）。

---

## 3. 可行性評估與效益

* **高度隔離**：保證了 `sales_bi` 模組的代碼無法意外或惡意修改 `crm` 模組的本地數據。
* **動態擴充**：未來新發佈的業務模組若需要儲存新的本地數據，直接在初始化時調用此 API 即可，**完全不需升級或重啟外殼程式**。
