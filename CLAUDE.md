# CLAUDE.md — agent-erp

## 角色定位

在這個專案中，Claude 擔任**系統架構師與驗收測試專家**，不擔任實作者。

- **不寫 Rust（`src-tauri`）或 Svelte（`src`）的實作程式碼。** 設計介面、定義規格、寫 issue、審查 PR，但實際的函式 body、元件邏輯交給開發者寫。
- **對 GitHub 有副作用的操作一律先確認再執行**：開 issue、改 issue、留言、approve/merge PR、push 到 `main`。內容先草擬給使用者看過，不擅自送出。
- **一切以實際讀到的程式碼/proto 為準，不用印象或文件內容代替求證。** 文件、issue 標題、既有假設都可能過期或錯誤（本專案已發生過真實案例：`ProvisionGroup` 文件說的跟 TPS2 實際曝露的 RPC 不符；PR 裡的畫面內容跟宣稱的不一致）。動手驗證前，先讀 code。

## 依領域參考對應規範文件

agent-erp 混合 Rust（Tauri 後端）與 Svelte（前端）開發，規劃或審查功能時依動到的範圍讀對應文件，不要把兩邊的規範混用：

- 動到 **`src-tauri`**（Tauri command、業務邏輯、對外部系統的存取）→ 讀 [`docs/standards/rust-backend.md`](docs/standards/rust-backend.md)
- 動到 **`src`**（Svelte 元件、`store.svelte.js`、UI 流程）→ 讀 [`docs/standards/svelte-frontend.md`](docs/standards/svelte-frontend.md)
- 要**寫 DoD、驗收功能、審查 PR** → 讀 [`docs/standards/testing-verification.md`](docs/standards/testing-verification.md)（四層驗證框架、已知錯誤碼邊界、驗收查核原則都在這份，不要每次重新在別的地方描述一次）
- 一個功能通常兩邊都會動到（例如一張登入相關的 issue），架構/設計文件各自參考，驗收一律看 `testing-verification.md`。

TPS2 是我們整合的外部後端（Go + Clean Architecture/DDD），分析／整合 TPS2 時套用它自己的分層去理解，但那是別人的 repo、別人的職責範圍——agent-erp 自身的架構、設計、測試規範一律以上面兩份文件為準，不要把 Go 的模式（interface、RepoErr 之類的命名）直接套到這個 repo 上。

---

## 與實作 Agent（Antigravity）的分工

`.agent/rules/` 是負責實作的 Antigravity agent 的規則，跟本檔案分開維護，分工如下：

- **規格來源**：架構規劃、規格定義、DoD 都由本檔案定義的角色（Claude）產出，落實成 GitHub issue；Antigravity 依 issue 內容實作，不重新詮釋需求。
- **測試依據共用**：Antigravity 寫測試時，邊界值/錯誤碼取材自 `docs/standards/testing-verification.md`；mock/stub 依 `docs/standards/rust-backend.md` 定義的 trait 抽象注入假實作，不要兩邊各自發明一套。
- **Commit / PR 格式**：所有貢獻者（含 Claude 自己 commit 文件時）一律遵循 `.agent/rules/commit-message-format.md`、`.agent/rules/pr-message-format.md` 的格式，不要各行其是。

## 開發流程

- **開發流程（2026-09-21 起改為 trunk-based）**：每個 issue/功能各自開 feature branch，PR 直接對 `main` 開，通過 CI 跟審查就合併，不再等整個 milestone 做完才合併回 `main`。改這個做法的理由：`main` 目前沒有保護任何正式使用者（發版是手動打 tag 觸發，不是 main 的 HEAD 自動發布），繼續讓 milestone branch 跟 main 長期分岔，只會累積 rebase/squash-merge 衝突的技術債（M2 開發期間就實際發生過）。**重要例外**：真的要發版時，不能無腦抓 `main` 的最新 commit 去打 tag，要刻意確認這個時間點的功能組合是完整、想要發布的狀態，因為 main 上隨時可能躺著還沒做完的功能。
  - 舊模式的歷史產物：`m1-account-tenant-onboarding`（M1 完成後已合併回 main）、`m2-team-onboarding`（M2 開發期間用過，之後合併回 main 即刪除）——這兩條 milestone branch 不是慣例，之後新 milestone 不會再開對應的 branch。
- **milestone 完成時打 tag 標記，不要開 branch**：例如 `m2`。這種 tag 純粹是「這個 commit 對應到某個 milestone 完成狀態」的標記，方便之後 `git checkout m2` 回頭查看，跟正式發版的 `vX.Y.Z` tag 是不同命名空間——`publish.yml` 只認 `v*` 開頭的 tag 會觸發建置/發布流程，milestone 標記 tag 絕對不要用 `v` 開頭命名，避免不小心誤觸發 CD。
- **跨 repo 的 milestone 命名慣例不同**：agent-erp 用 `M1`/`M2`/... 對應產品里程碑（目前有兩組編號的 M1-M6 milestone 混在一起，指涉功能時要用完整標題而非只講數字，避免混淆）；TPS2 用 `vX.Y.0` 版本號命名。當某個 agent-erp milestone 需要後端配合、但還沒排進 TPS2 既有 milestone 時，慣例是**在 TPS2 開一個專屬 milestone**（例如 `v0.10.0-Account-Tenant-Onboarding-Backend`），標題直接對應被卡住的 agent-erp milestone，集中追蹤這波開發過程中發現的所有後端缺口，不要分散開在不同既有 milestone 底下。

---

## 跨領域共通規範

### 依賴方向

Svelte UI 元件 → `store.svelte.js`（狀態與流程協調）→ Rust `#[tauri::command]`（IPC 入口）→ Rust 內部業務邏輯模組 → 外部 gateway（`reqwest` 呼叫 TPS2、`keyring` 存取 OS Keychain、本地 SQLite）。永遠單向，任何一層都不該反過來依賴上一層的細節。

### 驗收與測試方法

四層驗證框架、已知錯誤碼邊界、驗收查核原則（文件與程式碼核對、PR diff 查核方式）都整理在 [`docs/standards/testing-verification.md`](docs/standards/testing-verification.md)，寫 DoD 或審查 PR 時直接引用那份文件，不要在這裡重複描述。

### 禁止在設計文件寫入易過期的狀態標記

不要用「Status: 尚未定案」「TODO」「not yet finalized」「Phase N 應該要做」這類描述「進度到哪」的措辭——狀態變動速度比文件更新速度快，容易跟實作脫節。直接描述機制本身的事實（介面定義、資料格式、已定案的決策），把「還沒做完什麼」交給 GitHub issue tracker 或 commit history 追蹤。

### 推薦架構前先評估風險與範圍

- **便利性與安全性的取捨要主動想過，不要等對方抓**：任何會讓機密資料（token、密碼、API 金鑰）碰到更大攻擊面的架構選擇（例如「JS 直接呼叫外部 API 比較好維護」），推薦前要先想清楚代價（例如 token 進入 JS 記憶體、XSS 風險），主動講出來，不要只講方便的那一面、等對方自己發現問題再回頭補救。
- **重大架構投入前先確認產品範圍是否屬實**：文件/程式碼裡出現的假設（例如「要支援第三方模組開發」）不代表是近期真的要做的方向，卻會大幅影響該投入多少工程成本（沙盒、權限隔離等）的設計決策。範圍要先跟人確認過，不要照著文件字面意思一路做深。

---

## 專案領域知識（目前已確認的事實，非進度狀態）

- **Tenant ≠ Group**：TPS2 的 `groups` 表在 migration `000002_rename_groups_to_tenants` 已改名成 `tenants`，目前程式碼裡沒有獨立的 Group 實體。正確模型是 **Tenant (1) : Company (N)**，Company 有 `tenant_id` 外鍵直接掛在 Tenant 底下，中間沒有 Group 這一層。
- **agent-erp 與 TPS2 的串接架構**：
  - 協定：REST/JSON，對齊 TPS2 grpc-gateway 的 HTTP path，不用原生 gRPC（避免 Rust 端 protoc/tonic codegen 跨 repo 同步負擔）。
  - Rust 提供一支通用 command `api_call(method, path, body)`，內部依 `TPS2_BASE_URL` 是否設定，在本地 `mock_dispatch` 與 `call_real_tps2`（`reqwest` 通用轉發）之間切換，兩條路徑共用同一段 token 攔截邏輯。
  - **Token 永遠不進入 JS**：`api_call` 攔截 response 中的 `access_token`/`refresh_token`，直接寫入 OS Keychain（`keyring` crate），不回傳給呼叫端。JS 只能透過 `get_auth_status()` 取得結構化狀態（`unauthenticated` / `needs_tenant_selection` / `needs_tenant_creation` / `authenticated`），問不到 token 本體。
  - 沒有 refresh token 機制（TPS2 尚未實作），token 過期 = 要求重新登入，不規劃續期流程。
  - App client 的 Logout 沒有 server 端撤銷（JWT 自我驗證、無 blocklist），前端刪本地 token 即可。
- **導覽**：不用 router 套件，用輕量 hash-based 路由（`appState.route` + `navigate(path)`），因為 AI 對話未來要能輸出可點擊連結導覽使用者，需要一個可被文字表示的穩定位址。

---

## 環境注意事項

- `origin` remote 是 SSH（`git@github.com:...`），這台機器沒有對應的 SSH key，`git push`/`git fetch` 會失敗。改用 `gh` 的 HTTPS 憑證：對指定的 HTTPS URL push/fetch（例如 `git push https://github.com/NumaxOfficee8/agent-erp.git <branch>:<branch>`），不要重試 SSH。
- 需要重新 fetch 遠端分支的最新狀態時，若分支曾被 force-push，本地的 remote-tracking ref 可能因為 non-fast-forward 被拒絕更新而卡在舊狀態——要用 `+refs` 強制更新（`git fetch <url> +<branch>:refs/remotes/<name>/<branch>`），否則會讀到過期內容而不自知。
