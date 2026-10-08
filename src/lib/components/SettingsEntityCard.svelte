<script>
  /**
   * @file SettingsEntityCard.svelte
   * @description Shared card shell component for entity management in Settings views (Issue #134).
   * Encapsulates header bar (title + badge + action/refresh buttons), description text,
   * form snippet area, error banner, and item list container with empty state.
   */

  /**
   * @typedef {Object} Props
   * @property {string} title - Card title text
   * @property {string} [badge] - Optional badge text next to the title
   * @property {string} [badgeClass] - CSS class for badge (default: 'badge-cyan')
   * @property {string} [description] - Card description paragraph text
   * @property {(() => void | Promise<void>)} [onRefresh] - Refresh button click handler
   * @property {string} [refreshLabel] - Refresh button text (default: '重新整理')
   * @property {boolean} [isRefreshing] - Whether refresh action is in progress
   * @property {string} [errorMessage] - Error message to display (in red banner)
   * @property {boolean} [isEmpty] - Whether the list has no items
   * @property {string} [emptyMessage] - Message to display when isEmpty is true
   * @property {string} [listClass] - CSS class for the list container
   * @property {string} [listStyle] - Inline styles for the list container
   * @property {string} [containerClass] - CSS class for outer container (default: 'settings-group glass-panel')
   * @property {string} [containerStyle] - Inline styles for outer container
   * @property {import('svelte').Snippet} [headerExtra] - Extra controls on the right of header
   * @property {import('svelte').Snippet} [form] - Form content snippet
   * @property {import('svelte').Snippet} [children] - Main list items snippet
   */

  let {
    title,
    badge = '',
    badgeClass = 'badge-cyan',
    description = '',
    onRefresh,
    refreshLabel = '重新整理',
    isRefreshing = false,
    errorMessage = '',
    isEmpty = false,
    emptyMessage = '目前尚無資料。',
    listClass = '',
    listStyle = 'display: flex; flex-direction: column; gap: 8px;',
    containerClass = 'settings-group glass-panel',
    containerStyle = '',
    headerExtra,
    form,
    children
  } = $props();
</script>

<div class={containerClass} style={containerStyle}>
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
    {#if badge}
      <div style="display: flex; align-items: center; gap: 8px;">
        <h3 style="margin: 0;">{title}</h3>
        <span class="badge {badgeClass}" style="font-size: 0.72rem;">{badge}</span>
      </div>
    {:else}
      <h3 style="margin: 0;">{title}</h3>
    {/if}

    <div style="display: flex; align-items: center; gap: 8px;">
      {#if headerExtra}
        {@render headerExtra()}
      {/if}
      {#if onRefresh}
        <button class="btn btn-sm" onclick={onRefresh} disabled={isRefreshing}>
          {refreshLabel}
        </button>
      {/if}
    </div>
  </div>

  {#if description}
    <p class="settings-desc">{description}</p>
  {/if}

  {#if form}
    {@render form()}
  {/if}

  {#if errorMessage}
    <div style="color: #ef4444; font-size: 0.8rem; margin-bottom: 12px;">{errorMessage}</div>
  {/if}

  <div class={listClass} style={listStyle}>
    {#if isEmpty}
      <div class="empty-audit" style="padding: 20px; text-align: center;">{emptyMessage}</div>
    {:else if children}
      {@render children()}
    {/if}
  </div>
</div>
