# Shell 佈局架構設計說明書 (Shell Layout Architecture)

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`module_boundary_architecture.md`](module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本設計定義了 AgentERP 桌面應用的外殼（Shell）如何以「插槽」（Slot）為核心概念，為各業務模組提供一套可預期、可組合的版面配置系統。其設計靈感來自 VSCode 的面板區域劃分模型。

---

## 1. 設計哲學

Shell 的核心職責是**定義版面區域**，而非決定區域內的內容。Shell 預先配置好 5 個具名插槽（Named Slots），每個插槽的尺寸、位置與行為由 Shell 統一管控。業務模組在安裝時，於各自的 `layout.json`（或 `manifest.json` 的 `layout` 區塊）中聲明要填充哪些插槽的元件；Shell 在模組切換時，負責載入並掛載對應的元件到正確的插槽中。

**原則**：

- **插槽歸 Shell，內容歸模組**：Shell 永遠不硬編碼模組的 UI 細節；模組永遠不自行決定在哪裡渲染。
- **零依賴掛載**：模組插槽元件被設計為獨立的 JavaScript 模組，可在不知道其他模組存在的情況下完整運作。
- **漸進式覆蓋**：若模組未聲明某個插槽的元件，Shell 自動顯示該插槽的預設備用內容（Fallback），確保版面永不破損。

---

## 2. 五大佈局插槽

| 插槽名稱          | 固定尺寸        | 職責說明                                                        |
|-------------------|-----------------|-----------------------------------------------------------------|
| `sidebar-rail`    | 寬度 64px       | 左側圖示導覽列，顯示各模組圖示及通知徽章，**由 Shell 自身管控**，模組不可替換其內容 |
| `agent-main`      | `flex-grow: 1`  | 主要 AI 對話區域，跨模組共用同一個 AI Chat 元件實例，模組切換時透過 `systemPrompt` 重新配置身份而非重建元件 |
| `context-panel`   | 寬度 340px      | 右側上下文面板，顯示 AI 操作相關的資料（訂單列表、庫存圖表等），**由當前模組提供** |
| `toolbar`         | 高度 48px       | 頂部操作工具列，顯示當前任務的快捷動作按鈕，**由當前模組提供** |
| `statusbar`       | 高度 28px       | 底部狀態列，顯示輕量級即時狀態資訊，**由當前模組提供**（可聲明為 `null` 以隱藏） |

---

## 3. CSS Grid 整體佈局實作

整體 `app-container` 使用 CSS Grid 的具名區域（Named Template Areas）實作，確保各插槽的排列關係由 CSS 宣告式管理，而非 JavaScript 動態計算。

```css
/* app-container: 全螢幕根容器 */
.app-container {
  display: grid;
  width: 100vw;
  height: 100vh;
  grid-template-columns: 64px 1fr 340px;
  grid-template-rows: 48px 1fr 28px;
  grid-template-areas:
    "rail toolbar  toolbar"
    "rail main     context"
    "rail statusbar statusbar";
}

/* 各插槽對應的 Grid 區域 */
.slot-sidebar-rail  { grid-area: rail; }
.slot-toolbar       { grid-area: toolbar; }
.slot-agent-main    { grid-area: main; overflow: hidden; }
.slot-context-panel { grid-area: context; overflow-y: auto; }
.slot-statusbar     { grid-area: statusbar; }
```

`agent-main` 插槽內部使用 Flexbox 垂直堆疊，包含 `AlertBanner`（`flex-shrink: 0`）與 `ChatViewport`（`flex-grow: 1`），確保警告橫幅出現時不會擠壓對話區域。

---

## 4. 插槽尺寸限制與可調整性

| 插槽名稱          | 最小尺寸    | 最大尺寸    | 可調整 |
|-------------------|-------------|-------------|--------|
| `sidebar-rail`    | 64px        | 64px（固定）| 否     |
| `agent-main`      | min-width: 400px | 無限制 | 否（由 Grid 自動填充） |
| `context-panel`   | 240px       | 560px       | **是**（拖曳分隔線） |
| `toolbar`         | 48px        | 48px（固定）| 否     |
| `statusbar`       | 28px        | 28px（固定）| 否     |

`context-panel` 的寬度可由使用者拖曳 `rail | main` 邊界上的 ResizeHandle 元件進行調整，Shell 將調整後的寬度持久化至 `localStorage`（鍵名：`shell.contextPanelWidth`），下次啟動時恢復。

若模組聲明 `"context": null`，Shell 將 `context-panel` 的 `grid-template-columns` 調整為 `64px 1fr 0`，使其折疊隱藏。

---

## 5. 插槽備用預設內容（Slot Fallback）

當模組未聲明某插槽的元件時，Shell 展示以下備用內容：

| 插槽名稱          | 備用內容（Fallback）                                      |
|-------------------|-----------------------------------------------------------|
| `context-panel`   | 顯示「請選擇左側功能以載入相關資訊」的空狀態佔位元件     |
| `toolbar`         | 僅顯示應用程式名稱文字及全域設定齒輪圖示                  |
| `statusbar`       | 顯示 `已就緒` 字樣與當前時間，插槽高度不塌陷             |

---

## 6. 模組插槽聲明格式

每個模組在其 `manifest.json` 的 `layout` 區塊中聲明需要填充的插槽元件：

```json
{
  "moduleId": "order_approval",
  "layout": {
    "context": "order_context_panel.js",
    "toolbar": "order_toolbar.js",
    "statusbar": null
  }
}
```

- 值為字串時，表示相對於模組根目錄的 JS 元件路徑。
- 值為 `null` 時，表示模組明確宣告不使用此插槽，Shell 將隱藏或顯示備用內容。
- 若鍵完全省略，Shell 行為等同於 `null`（向後相容）。

---

## 7. 模組切換時的插槽載入順序

Shell 在用戶點擊側邊欄圖示切換模組時，依序執行以下步驟：

1. **卸載舊插槽元件**：呼叫當前 `context-panel`、`toolbar`、`statusbar` 元件的 `destroy()` 方法，解除其事件監聽器，從 DOM 移除。
2. **更新 AI 身份**：讀取新模組 `manifest.json` 中的 `agent.systemPrompt`，呼叫 `window.__SHELL__.setSystemPrompt(prompt)` 注入至 AI 執行環境。
3. **註冊新技能**：讀取新模組的 `agent.skills`，透過 IPC 將對應的 Tauri 指令繫結至 AI 工具列表（詳見 `agent_first_ux.md`）。
4. **載入新插槽元件**：動態 `import()` 新模組宣告的 `context`、`toolbar`、`statusbar` JS 模組，將其掛載至對應的 DOM 插槽容器中。
5. **發送切換事件**：透過事件匯流排廣播 `module:switched` 事件，攜帶新舊模組 ID，供各插槽元件接收並自行初始化資料。

---

## 8. 跨插槽通訊：Shell 事件匯流排

各插槽的元件雖然物理上分離，但需要相互協作（例如：toolbar 的「核准」按鈕需要觸發 context-panel 的資料刷新）。Shell 提供全域事件匯流排作為唯一通訊管道：

```javascript
// 插槽元件（toolbar）發送事件
window.__SHELL__.emit('order:approved', { orderId: 'ORD-2024-001' });

// 另一個插槽元件（context-panel）監聽事件
window.__SHELL__.on('order:approved', (payload) => {
  this.refreshOrderList(payload.orderId);
});

// 移除監聽器（元件銷毀時必須呼叫，防止記憶體洩漏）
window.__SHELL__.off('order:approved', listenerRef);
```

**事件命名規範**：`{module_id}:{event_name}`（全小寫、以冒號分隔），Shell 保留 `shell:` 前綴命名空間供系統內部事件使用。

---

## 9. AgentERP 插槽 vs. VSCode 面板對照表

| AgentERP 插槽       | VSCode 等效區域               | 主要差異                                                      |
|---------------------|-------------------------------|---------------------------------------------------------------|
| `sidebar-rail`      | Activity Bar                  | AgentERP 的 rail 由 Shell 硬管控，VSCode 的 Activity Bar 可由擴充套件貢獻按鈕 |
| `agent-main`        | Editor Group                  | AgentERP 的 main 永遠是 AI Chat 的單一實例，VSCode 的 Editor 支援多標籤分割 |
| `context-panel`     | Side Bar (Explorer / Search)  | AgentERP 的 context 由當前模組提供，VSCode 的 Side Bar 由聚焦的 Activity Bar 圖示決定 |
| `toolbar`           | Editor Action Toolbar         | 功能相似，均由當前活躍的「文件/模組」提供情境操作             |
| `statusbar`         | Status Bar                    | 功能高度一致，差異在於 AgentERP 可由模組聲明為 `null` 完全隱藏 |
