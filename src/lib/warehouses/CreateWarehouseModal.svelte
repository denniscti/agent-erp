<script>
  import {
    appState,
    fetchWarehouses,
    createWarehouseAction,
    closeCreateWarehouseModal
  } from '../store.svelte.js';

  let code = $state('');
  let name = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  function handleClose() {
    closeCreateWarehouseModal();
    code = '';
    name = '';
    errorMessage = '';
  }

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    errorMessage = '';
    const trimmedCode = (code || '').trim();
    const trimmedName = (name || '').trim();
    if (!trimmedCode) {
      errorMessage = '倉別代碼不可空白';
      return;
    }
    if (!trimmedName) {
      errorMessage = '倉別名稱不可空白';
      return;
    }

    isSubmitting = true;
    try {
      await createWarehouseAction({ code: trimmedCode, name: trimmedName });
      handleClose();
      await fetchWarehouses();
    } catch (err) {
      // Direct display of Rust W-02 error message
      errorMessage = err.message || '建立倉庫失敗';
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if appState.isCreateWarehouseModalOpen}
  <div class="modal-backdrop" onclick={handleClose} onkeydown={(e) => e.key === 'Escape' && handleClose()} role="presentation" id="create-warehouse-modal-backdrop">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-create-warehouse-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-create-warehouse-title" class="modal-title">新增倉別 (Warehouse Master)</h3>
        <button class="btn-close-modal" onclick={handleClose} aria-label="關閉彈窗">✕</button>
      </div>
      <form onsubmit={handleSubmit}>
        <div class="modal-body">
          <p class="modal-desc">
            建立新的實體倉庫或分倉據點。若為租戶的第一個倉庫，系統將自動設定為預設倉。
          </p>

          {#if errorMessage}
            <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.82rem;">
              {errorMessage}
            </div>
          {/if}

          <div class="form-group" style="margin-bottom: 12px;">
            <label for="create-wh-code" style="display: block; font-size: 0.8rem; margin-bottom: 4px; color: var(--text-secondary);">倉庫代碼 *</label>
            <input
              id="create-wh-code"
              type="text"
              class="form-input"
              placeholder="例：WH-TPE、WH-01"
              bind:value={code}
              style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
            />
          </div>

          <div class="form-group">
            <label for="create-wh-name" style="display: block; font-size: 0.8rem; margin-bottom: 4px; color: var(--text-secondary);">倉庫名稱 *</label>
            <input
              id="create-wh-name"
              type="text"
              class="form-input"
              placeholder="例：台北總倉、高雄分倉"
              bind:value={name}
              style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick={handleClose}>取消</button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting} id="btn-submit-create-wh">
            {#if isSubmitting}建立中...{:else}確定建立{/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .glass-modal {
    width: 100%;
    max-width: 480px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .btn-close-modal {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
  }

  .btn-close-modal:hover {
    color: var(--text-primary);
  }

  .modal-body {
    padding: 16px 18px;
  }

  .modal-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 14px;
    line-height: 1.5;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.15);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
    transition: all var(--transition-fast);
  }

  .btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }

  .btn-primary {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
    font-weight: 600;
  }

  .btn-outline {
    background: transparent;
    color: var(--text-secondary);
  }
</style>
