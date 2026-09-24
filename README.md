# Agent ERP

Tauri v2 + Svelte 5 桌面 ERP 應用，內建 AI 對話助理，整合外部後端 TPS2（Go + gRPC-Gateway）。

## 技術棧

- **前端**：Svelte 5 + Vite。`npm run dev` 走瀏覽器 mock 層即可本機開發，不需要先啟動 Tauri 視窗。
- **後端**：Rust（`src-tauri`），Tauri v2 command 作為 IPC 入口。
- **外部整合**：TPS2（Go + gRPC-Gateway），協定為 REST/JSON，對齊 grpc-gateway 曝露的 HTTP path。

## 架構

依賴方向單向：

```
Svelte UI 元件 → store.svelte.js → Tauri #[tauri::command] → Rust 業務邏輯 → 外部 gateway（reqwest / keyring / SQLite）
```

- **`api_call(method, path, body)`**：唯一的通用 API 轉發 command。依 `TPS2_BASE_URL` 環境變數是否設定，在本地 SQLite mock（`mock_dispatch`）與真實 TPS2（`call_real_tps2`）之間切換，前端不需要知道現在打的是 mock 還是真的後端。
- **Token 安全**：`access_token`/`refresh_token` 由 Rust 攔截後直接寫入 OS Keychain（`keyring` crate），永遠不會回傳給 JS。前端只能透過 `get_auth_status()` 拿到結構化狀態，問不到 token 本體。
- **導覽**：hash-based 路由（`appState.route` + `navigate(path)`），不使用 router 套件。

## 功能

各功能的詳細設計說明書放在 [`docs/system_design/`](./docs/system_design/)，README 只列索引，不重複內容：

- [`account_tenant_onboarding.md`](./docs/system_design/account_tenant_onboarding.md)：帳號登入、租戶選擇/建立的狀態機與真實後端對接方式
- [`task_driven_workflow.md`](./docs/system_design/task_driven_workflow.md)：任務（Task）資料模型、任務與對話的綁定關係、任務面板行為
- 其餘既有設計文件（Shell 版面、模組安裝、通知系統等）見該目錄下其他檔案

各 milestone 的使用者旅程（步驟順序、進入/離開條件、DoD）放在 [`docs/journeys/`](./docs/journeys/)，跟 `system_design/` 分開——`system_design/` 記機制怎麼運作，`journeys/` 記使用者從頭走到尾的路徑，兩者互相引用不重複描述：

- [`m2_team_onboarding.md`](./docs/journeys/m2_team_onboarding.md)：新租戶建立後的團隊組建旅程

## 開發

```bash
npm install
npm run dev        # 瀏覽器 mock 模式
npm run tauri dev  # 真實 Tauri 視窗
npm run check      # svelte-check 型別檢查
npm run build      # 前端靜態資源建置
npm run tauri build  # 打包成當前平台可安裝的桌面應用（.app/.dmg、.exe/.msi 等）
```

### 對接真實 TPS2 環境

不設定下列環境變數時，自動使用本地 SQLite mock，不影響本機開發。這些是**真的 process 環境變數**，要用 `export` 或指令前綴設定，不是 `.env` 檔案——這個專案沒有裝 `dotenv` 之類的 crate，Rust 是直接讀 process 的 `env::var`；`.env` 檔案即使存在也不會被 Rust 讀到（Vite 本身雖然會讀 `.env`，但只會把 `VITE_` 開頭的變數曝露給前端 JS，跟這裡要設的變數無關）。

而且只有 `npm run tauri dev`（或未來的正式建置版本）才會真的用到這些變數：`npm run dev` 純瀏覽器模式下，`invoke()` 完全走 JS 端的 mock 邏輯，不會呼叫 Rust，設定了也不會有作用。

| 變數 | 必填 | 說明 |
|---|---|---|
| `AGENT_ERP_SEED_DEMO_DATA` | 否 | 設為 `1` 時，會在本地 SQLite 資料庫為空時自動寫入預設測試帳號（`admin@example.com` / `password123` 等）與租戶種子資料。未設定或為其他值則不寫入（正式發佈預設安全不啟用） |
| `TPS2_BASE_URL` | 是 | TPS2 環境的 base URL（例如 `https://api-tps2-dev.numax.com.tw`）。留空或不設定則走本地 mock |
| `CF_ACCESS_CLIENT_ID` | 視環境而定 | 若目標環境有 Cloudflare Access 保護才需要，對應 `CF-Access-Client-Id` header |
| `CF_ACCESS_CLIENT_SECRET` | 視環境而定 | 若目標環境有 Cloudflare Access 保護才需要，對應 `CF-Access-Client-Secret` header |
| `AGENT_ERP_LLM_TRACE_RETENTION_DAYS` | 否 | `llm_traces` 表（見 [`task_driven_workflow.md`](./docs/system_design/task_driven_workflow.md) 第 3.3 節）的保留天數，App 啟動時清除超過此天數的紀錄。未設定則預設 30 天 |

```bash
# 本地開發需要預設測試帳號時：
AGENT_ERP_SEED_DEMO_DATA=1 npm run tauri dev

# 對接真實 TPS2 環境時：
TPS2_BASE_URL=https://api-tps2-dev.numax.com.tw \
CF_ACCESS_CLIENT_ID=xxx \
CF_ACCESS_CLIENT_SECRET=xxx \
npm run tauri dev
```

Rust 測試：

```bash
cd src-tauri && cargo test
```

### 使用 LLM 部門意圖偵測（NVIDIA NIM）

「設定部門」任務裡判斷使用者想建立/查詢部門的意圖，預設走本地正規表達式；設定 `NVIDIA_API_KEY` 後會改用 NVIDIA NIM（`z-ai/glm-5.3-flash`）判斷，對間接語意（例如「我想開一個 IT 專責小組」）判斷得更準，API 沒設定、呼叫失敗、或回傳 `NONE` 時都會自動退回正規表達式，不影響原有流程。

| 變數 | 必填 | 說明 |
|---|---|---|
| `NVIDIA_API_KEY` | 否 | [NVIDIA NIM](https://build.nvidia.com/) 的 API key（Free Endpoint 免費申請即可，但官方定位僅供評估/測試，不建議正式生產流量） |

只有 `npm run tauri dev` 會用到這把 key，`npm run dev` 純瀏覽器模式下無作用（規則同上方 TPS2 環境變數）——`npm run tauri dev` 會啟動真的 Rust process（不是純網頁瀏覽），這個 process 會繼承**啟動它的那個終端機**當下的環境變數，所以 key 要在執行 `npm run tauri dev` 之前，於同一個終端機 session 裡設定好：

```bash
# 直接用環境變數：
NVIDIA_API_KEY=nvapi-xxx npm run tauri dev

# 或用便利腳本，會自動從 .env 讀取、沒有的話互動式提示輸入（macOS/Linux 用 dev:mac，Windows 用 dev:win）：
npm run dev:mac
npm run dev:win

# 單獨測試 API key 是否可用，不需要啟動整個 App：
NVIDIA_API_KEY=nvapi-xxx npm run test:llm
```

## Tag 命名規則

兩種 tag 不要混用，命名空間分開：

- **`vX.Y.Z`**：正式發版用，push 這種 tag 會觸發 `.github/workflows/publish.yml` 的正式建置/發布流程（macOS/Windows 安裝檔、自動更新 manifest）。
- **milestone 完成標記**（例如 `m2`）：單純標記「這個 commit 對應到某個 milestone 完成的狀態」，方便之後用 `git checkout m2` 回頭查看，**不會**觸發任何 CI/CD——`publish.yml` 只認 `v*` 開頭的 tag。命名時務必避開 `v` 開頭，不要不小心取成看起來像版號的名字。

開發流程已改成 trunk-based（見 [`CLAUDE.md`](./CLAUDE.md#開發流程)），milestone 不再對應一條長期 branch，只在完成時打一個標記 tag。

## 規範文件

- [`CLAUDE.md`](./CLAUDE.md)：專案角色定位、架構原則、開發流程
- [`docs/standards/rust-backend.md`](./docs/standards/rust-backend.md)：Rust/Tauri 後端規範
- [`docs/standards/svelte-frontend.md`](./docs/standards/svelte-frontend.md)：Svelte 前端規範
- [`docs/standards/testing-verification.md`](./docs/standards/testing-verification.md)：四層驗證框架、已知錯誤碼邊界、驗收查核原則

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
