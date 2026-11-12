# 動態 SVG 側邊欄選單與 Keep-Alive 緩存設計說明書

> **⚠️ 歷史文件**：本文件描述 Phase 0/1 時期提出、但從未在現在的 ERP 程式碼上落地的模組化構想（manifest.json、五插槽 Shell、動態 ESM 載入等），對應的實作程式碼已經在清理舊展示功能時移除，現在的程式碼完全沒有採用這套設計。現況請看 [`module_boundary_architecture.md`](module_boundary_architecture.md)。本文件保留作為歷史記錄，不代表現行架構。

本設計定義了 Svelte 5 前端如何動態渲染側邊欄選單（支援模組自訂 SVG 圖示），以及在切換工作區時如何保留使用者介面狀態。

---

## 1. 動態選單渲染機制

側邊欄導覽列將不再包含任何硬編碼（Hardcoded）的業務項目。

### 1.1. Svelte 5 渲染結構
當 `appState.installedModules` 狀態更新時，側邊欄會動態重繪。使用 Svelte 的 `{@html}` 標記安全渲染由模組宣告的 SVG：

```html
<nav class="dynamic-navigation">
  <ul>
    {#each appState.installedModules as mod (mod.id)}
      <li>
        <button 
          class="menu-item" 
          class:active={appState.activeWorkspace === mod.id}
          onclick={() => switchWorkspace(mod.id)}
        >
          <span class="menu-icon">
            <!-- 渲染模組自帶的 SVG 圖示 -->
            {@html mod.iconSvg}
          </span>
          <span>{mod.name}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>
```

---

## 2. 視窗切換之 Keep-Alive 狀態保留

為避免用戶在切換工作區（如從 BI 到 CRM）時遺失輸入中的表單、滾動位置或圖表試算結果，我們使用 **CSS 隱藏顯示法** 代替銷毀重建。

### 2.1. 佈局實作
* 所有已加載的模組元件將**同時存在於 DOM 樹中**。
* 透過 `.hidden` 類別控制可見性（採用 `display: none !important`）：

```html
<div class="workspace-viewport">
  {#each appState.installedModules as mod (mod.id)}
    <div class="workspace-wrapper" class:hidden={appState.activeWorkspace !== mod.id}>
      <!-- 根據 Registry 載入的 Dynamic Component -->
      {@const Component = appState.loadedComponents[mod.id]}
      {#if Component}
        <Component />
      {/if}
    </div>
  {/each}
</div>

<style>
  .workspace-wrapper.hidden {
    display: none !important;
  }
</style>
```

### 2.2. 可行性優勢
Svelte 5 的 Runes 響應式狀態（如 `$state`、`$derived`）綁定在元件執行個體中。只要元件不被毀損（Unmount），其記憶體變數便會一直保持，用戶再次切換回來時體驗極其流暢。
