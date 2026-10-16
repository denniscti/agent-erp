# Rust / Tauri 後端規範（`src-tauri`）

適用範圍：`src-tauri` 底下所有 Rust 程式碼。跨領域共通規範（依賴方向、四層驗證框架、驗收原則）見 [`CLAUDE.md`](../../CLAUDE.md)。

---

## 一、系統架構分析

- **模組邊界**：`#[tauri::command]` 屬於「delivery」層，只做參數解析與呼叫業務邏輯模組，不把商業邏輯寫在 command 函式本體裡——這樣業務邏輯才能在不啟動 Tauri runtime 的情況下被 `cargo test` 單獨測試。實際驗證規則、狀態判斷（例如 `get_auth_status` 怎麼決定回傳哪種狀態）屬於「usecase」層，拆到獨立的函式/模組，不依賴 `tauri::AppHandle`。對外部系統的存取（`reqwest` 呼叫 TPS2、`keyring` 讀寫、SQLite）屬於「gateway」層，用 trait 抽象（見下方「系統設計」），讓 usecase 層測試時可以替換成假的實作。
- **分析 TPS2 時**：套用它自己的 Clean Architecture + DDD 分層去理解（`domain/entity` → `usecase` → `domain/gateway`/`infra/db`）。usecase 檔案存在不代表有被曝露成 RPC，要查 `api/proto/*/v1/*_service.proto` 裡有沒有對應的 `rpc` 宣告才能確認。讀 TPS2 程式碼是為了理解可整合的邊界，不代表 agent-erp 要採用 Go 的架構模式。
- **併發分析（Rust/Tokio）**：Tauri command 是 `async fn`，跑在 Tokio runtime 上。分析時要評估：
  - 呼叫外部 API（`reqwest`）或做 I/O 是否會意外阻塞 async runtime；用到同步阻塞的 crate 要用 `tokio::task::spawn_blocking` 包起來。
  - 共享狀態（例如快取的 auth 狀態）用 `tauri::State` + `Arc<Mutex<...>>`／`RwLock` 管理時，注意持鎖跨越 `.await` 的死鎖風險，以及鎖競爭會不會拖慢 UI 回應。
  - Tauri 的 `Channel`（串流用，如 `simulate_agent_chat`）要注意消費端沒有持續讀取時的 backpressure。

---

## 二、系統設計

- **只設計介面，不寫實作**。用 Rust 函式簽章 + 輸入輸出型別表達：
  ```rust
  async fn api_call(method: String, path: String, body: serde_json::Value) -> Result<serde_json::Value, ApiError>;
  async fn get_auth_status() -> AuthStatus;
  ```
- **外部依賴用 trait 抽象**，讓業務邏輯可以脫離真實環境測試。例如 token 儲存：
  ```rust
  trait TokenStore {
      fn save(&self, access: &str, refresh: &str) -> Result<(), ApiError>;
      fn load(&self) -> Result<Option<TokenPair>, ApiError>;
      fn clear(&self) -> Result<(), ApiError>;
  }
  ```
  正式環境注入 `KeyringTokenStore`，`cargo test` 時注入記憶體版的假實作，不用真的碰 OS Keychain。
- **錯誤處理**：用 Rust 慣用的型別化錯誤（建議 `thiserror`），不要用裸字串或 `Box<dyn Error>` 到處傳。設計結構化的錯誤 enum，每個變體對應明確情境：
  ```rust
  #[derive(Debug, thiserror::Error)]
  enum ApiError {
      #[error("invalid credentials")]
      InvalidCredentials,
      #[error("email already taken")]
      EmailTaken,
      #[error("weak password")]
      WeakPassword,
      #[error("tenant not assigned")]
      TenantNotAssigned,
      #[error("keychain access failed: {0}")]
      KeychainError(String),
  }
  ```
  agent-erp 自己不發明新的業務錯誤語意——**能對應到 TPS2 的 `google.rpc.ErrorInfo` reason 碼（`IAM_ERR_*` 系列）就直接對應**，只有本地才會發生、TPS2 管不到的錯誤（例如 Keychain 讀寫失敗）才用本地變體。`#[tauri::command]` 回傳給 JS 前，在 delivery 層邊界把 `ApiError` 轉成可序列化的結構（例如 `{ code, message }`），不要把 Rust 錯誤型別直接外洩到 IPC 邊界。
- **序列化**：跨 IPC 邊界的資料一律定義明確的 `#[derive(Serialize, Deserialize)]` struct，對齊 TPS2 對應的 JSON 欄位命名，不要在業務邏輯裡到處傳遞未定型的 `serde_json::Value`（只有 `api_call` 這種刻意設計成通用轉發的邊界函式可以例外）。
- **`#[tauri::command]` 參數命名不可用底線前綴**：即使函式體暫時沒用到某個參數的值，也不要把參數命名成 `_xxx` 來消除 unused-variable warning——Tauri 預設用參數名的 camelCase 轉換當作 JS 端 `invoke()` 呼叫的 key，底線前綴的參數名轉換後對不上前端送出的 key，會讓這次呼叫在 IPC 反序列化階段直接失敗、Rust 函式本體完全不會被執行，而且這種失敗不會在 Rust 端留下任何 log（因為根本沒進到函式體），只會在前端 catch 到一個通用錯誤，非常不容易定位。暫時用不到的參數改用 `#[allow(unused_variables)]` 標註函式，或在函式體內 `let _ = param;` 顯式丟棄。
- **組件互動順序**：需要時用 Markdown 條列式或簡易序列圖表達。
- 進度標記的禁令見 `CLAUDE.md`。

---

## 三、系統驗收測試

Rust 這邊對應的是 Layer 1（`cargo test`）——用上面「trait 抽象」注入假實作，不需要真的碰 Keychain 或網路。完整的四層框架、Given-When-Then 慣例、已知錯誤碼邊界清單、驗收查核原則都在 [`testing-verification.md`](testing-verification.md)，不要在這裡重複，直接去讀那份。
