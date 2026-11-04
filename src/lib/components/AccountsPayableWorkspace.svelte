<script>
  import { onMount } from 'svelte';
  import {
    appState,
    showToast,
    loadOpeningPayablesAction,
    createOpeningPayableAction,
    voidOpeningPayableAction,
    formatCurrency,
    formatTime
  } from '../store.svelte.js';
  import { invoke } from '../tauri.js';
  import { calculateDueDate } from '../paymentTerms.js';

  // Sub tab: 'opening-payables'
  let activeSubTab = $state('opening-payables');

  // Filter states
  let filterVendorId = $state('');
  let filterStatus = $state('all');
  let isLoading = $state(false);

  // Auxiliary data
  let availableVendors = $state([]);

  // Create Modal states
  let isCreateModalOpen = $state(false);
  let createVendorId = $state('');
  let createOriginalReference = $state('');
  let createDocumentDate = $state(new Date().toISOString().slice(0, 10));
  let createDueDate = $state(new Date().toISOString().slice(0, 10));
  let createAmount = $state('');
  let createNote = $state('');
  let createError = $state('');
  let createSubmitting = $state(false);
  let paymentTermsHint = $state('');

  // Void Modal states
  let isVoidModalOpen = $state(false);
  let voidTargetOap = $state(null);
  let voidReason = $state('');
  let voidError = $state('');
  let voidSubmitting = $state(false);

  onMount(async () => {
    await loadInitialData();
  });

  async function loadInitialData() {
    isLoading = true;
    try {
      // 1. Load partners to get vendors
      const partners = await invoke('list_partners', {});
      availableVendors = (partners || []).filter(p => p.is_vendor && p.is_active !== false);

      // 2. Load opening payables
      await refreshList();
    } catch (err) {
      console.error('Failed to load accounts payable initial data:', err);
      showToast('載入資料失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  async function refreshList() {
    isLoading = true;
    try {
      const filter = {};
      if (filterVendorId) filter.vendor_partner_id = filterVendorId;
      if (filterStatus && filterStatus !== 'all') filter.status = filterStatus;
      await loadOpeningPayablesAction(filter);
    } catch (err) {
      console.error('Failed to refresh opening payables:', err);
    } finally {
      isLoading = false;
    }
  }

  function handleVendorChange() {
    const vendor = availableVendors.find(v => v.id === createVendorId);
    if (!vendor) {
      paymentTermsHint = '';
      return;
    }

    if (vendor.payment_terms_type) {
      const typeLabel = vendor.payment_terms_type === 'net' ? '貨到' : '月結';
      paymentTermsHint = `已依付款條件（${typeLabel} ${vendor.payment_terms_days || 0} 天）自動推算並預填到期日，可手動修改`;
      createDueDate = calculateDueDate(createDocumentDate, vendor.payment_terms_type, vendor.payment_terms_days);
    } else {
      paymentTermsHint = '此供應商未設定付款條件，預設單據日為到期日，可手動修改';
      createDueDate = createDocumentDate;
    }
  }

  function handleDocDateChange() {
    const vendor = availableVendors.find(v => v.id === createVendorId);
    if (vendor && vendor.payment_terms_type) {
      createDueDate = calculateDueDate(createDocumentDate, vendor.payment_terms_type, vendor.payment_terms_days);
    }
  }

  function openCreateModal() {
    createVendorId = availableVendors.length > 0 ? availableVendors[0].id : '';
    createOriginalReference = '';
    createDocumentDate = new Date().toISOString().slice(0, 10);
    createDueDate = new Date().toISOString().slice(0, 10);
    createAmount = '';
    createNote = '';
    createError = '';
    paymentTermsHint = '';
    if (createVendorId) {
      handleVendorChange();
    }
    isCreateModalOpen = true;
  }

  function closeCreateModal() {
    isCreateModalOpen = false;
  }

  async function handleCreateSubmit() {
    createError = '';
    if (!createVendorId) {
      createError = '請選擇供應商';
      return;
    }
    if (!createOriginalReference.trim()) {
      createError = '原單號或發票號不可為空';
      return;
    }
    if (!createDocumentDate) {
      createError = '請選擇原單據日';
      return;
    }
    if (!createDueDate) {
      createError = '請選擇到期日';
      return;
    }
    const amt = parseFloat(createAmount);
    if (isNaN(amt) || amt <= 0) {
      createError = '未付金額必須大於 0';
      return;
    }

    createSubmitting = true;
    try {
      await createOpeningPayableAction({
        vendor_partner_id: createVendorId,
        original_reference: createOriginalReference.trim(),
        document_date: createDocumentDate,
        due_date: createDueDate,
        amount: amt,
        note: createNote.trim() || null
      });
      isCreateModalOpen = false;
      await refreshList();
    } catch (err) {
      createError = err.message || String(err);
    } finally {
      createSubmitting = false;
    }
  }

  function openVoidModal(oap) {
    voidTargetOap = oap;
    voidReason = '';
    voidError = '';
    isVoidModalOpen = true;
  }

  function closeVoidModal() {
    isVoidModalOpen = false;
    voidTargetOap = null;
  }

  async function handleVoidSubmit() {
    if (!voidTargetOap) return;
    if (!voidReason.trim()) {
      voidError = '作廢原因為必填';
      return;
    }

    voidSubmitting = true;
    voidError = '';
    try {
      await voidOpeningPayableAction(voidTargetOap.id, voidReason.trim());
      isVoidModalOpen = false;
      voidTargetOap = null;
      await refreshList();
    } catch (err) {
      voidError = err.message || String(err);
    } finally {
      voidSubmitting = false;
    }
  }

  let openingPayablesList = $derived(appState.openingPayables || []);
</script>

<div class="ap-workspace">
  <!-- Header -->
  <header class="workspace-header">
    <div class="header-left">
      <div class="icon-wrap">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="20" height="14" x="2" y="5" rx="2"></rect>
          <line x1="2" x2="22" y1="10" y2="10"></line>
        </svg>
      </div>
      <div>
        <h2>應付帳款工作區 (Accounts Payable)</h2>
        <p class="subtitle">管理期初應付帳款登錄、核銷與對帳明細</p>
      </div>
    </div>
  </header>

  <!-- Sub Tabs Navigation -->
  <div class="subtabs-bar">
    <button 
      class="subtab-btn {activeSubTab === 'opening-payables' ? 'active' : ''}" 
      onclick={() => (activeSubTab = 'opening-payables')}
      id="tab-opening-payables"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      期初應付 (Opening Payables)
    </button>
  </div>

  <!-- Main View Area -->
  <div class="view-content">
    {#if activeSubTab === 'opening-payables'}
      <div class="toolbar">
        <div class="filters">
          <div class="filter-group">
            <label for="filter-vendor">供應商：</label>
            <select id="filter-vendor" bind:value={filterVendorId} onchange={refreshList}>
              <option value="">全部供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>{v.name}</option>
              {/each}
            </select>
          </div>

          <div class="filter-group">
            <label for="filter-status">狀態：</label>
            <select id="filter-status" bind:value={filterStatus} onchange={refreshList}>
              <option value="all">全部狀態</option>
              <option value="open">有效 (open)</option>
              <option value="voided">已作廢 (voided)</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-primary" onclick={openCreateModal} id="btn-create-opening-payable">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            新增期初應付
          </button>
        </div>
      </div>

      <!-- Table -->
      <div class="table-container">
        {#if isLoading}
          <div class="empty-state">資料載入中...</div>
        {:else if openingPayablesList.length === 0}
          <div class="empty-state">
            <p>目前尚無期初應付帳款紀錄</p>
            <button class="btn btn-secondary" onclick={openCreateModal}>立即新增期初欠款</button>
          </div>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>期初單號</th>
                <th>供應商</th>
                <th>原單號 / 發票號</th>
                <th>單據日</th>
                <th>到期日</th>
                <th class="text-right">未付金額 (含稅)</th>
                <th>狀態</th>
                <th>備註</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {#each openingPayablesList as oap}
                <tr class={oap.status === 'voided' ? 'row-voided' : ''}>
                  <td class="font-mono font-medium">{oap.opening_number}</td>
                  <td>{oap.vendor_name_snapshot}</td>
                  <td class="font-mono">{oap.original_reference}</td>
                  <td>{oap.document_date}</td>
                  <td>{oap.due_date}</td>
                  <td class="text-right font-medium">{formatCurrency(oap.amount)}</td>
                  <td>
                    {#if oap.status === 'open'}
                      <span class="badge badge-success">有效 (open)</span>
                    {:else if oap.status === 'voided'}
                      <span class="badge badge-danger">已作廢 (voided)</span>
                    {:else}
                      <span class="badge">{oap.status}</span>
                    {/if}
                  </td>
                  <td class="text-muted text-sm">{oap.note || '-'}</td>
                  <td class="text-center">
                    {#if oap.status === 'open'}
                      <button 
                        class="btn-action text-danger" 
                        onclick={() => openVoidModal(oap)}
                        title="作廢此期初應付"
                      >
                        作廢
                      </button>
                    {:else}
                      <span class="text-xs text-muted" title={oap.void_reason || ''}>
                        {oap.void_reason ? `原因: ${oap.void_reason}` : '已作廢'}
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Create Modal -->
  {#if isCreateModalOpen}
    <div class="modal-backdrop" onclick={closeCreateModal} onkeydown={(e) => e.key === 'Escape' && closeCreateModal()} role="presentation">
      <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>新增期初應付帳款</h3>
          <button class="btn-close" onclick={closeCreateModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if createError}
            <div class="alert alert-danger" id="create-error-msg">{createError}</div>
          {/if}

          <div class="form-group">
            <label for="create-vendor">供應商 <span class="required">*</span></label>
            <select 
              id="create-vendor" 
              bind:value={createVendorId} 
              onchange={handleVendorChange}
              required
            >
              <option value="" disabled>請選擇供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>
                  {v.name} {v.payment_terms_type ? `(${v.payment_terms_type === 'net' ? '貨到' : '月結'} ${v.payment_terms_days} 天)` : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="create-orig-ref">原單號 / 發票號 <span class="required">*</span></label>
            <input 
              type="text" 
              id="create-orig-ref" 
              bind:value={createOriginalReference} 
              placeholder="舊系統單號或發票號碼"
              required 
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="create-doc-date">原單據日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="create-doc-date" 
                bind:value={createDocumentDate} 
                onchange={handleDocDateChange}
                required 
              />
              <span class="help-text">不可晚於今天；有採購單時須早於首張採購單</span>
            </div>

            <div class="form-group">
              <label for="create-due-date">到期日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="create-due-date" 
                bind:value={createDueDate} 
                required 
              />
              <span class="help-text">不可早於單據日</span>
            </div>
          </div>

          {#if paymentTermsHint}
            <div class="terms-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              {paymentTermsHint}
            </div>
          {/if}

          <div class="form-group">
            <label for="create-amount">未付金額 (含稅) <span class="required">*</span></label>
            <input 
              type="number" 
              id="create-amount" 
              bind:value={createAmount} 
              placeholder="0.00" 
              step="0.01" 
              min="0.01"
              required 
            />
          </div>

          <div class="form-group">
            <label for="create-note">備註</label>
            <input 
              type="text" 
              id="create-note" 
              bind:value={createNote} 
              placeholder="期初未結備註說明（選填）" 
            />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeCreateModal} disabled={createSubmitting}>取消</button>
          <button class="btn btn-primary" onclick={handleCreateSubmit} disabled={createSubmitting} id="btn-submit-create">
            {createSubmitting ? '建立中...' : '確定建立'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Void Modal -->
  {#if isVoidModalOpen && voidTargetOap}
    <div class="modal-backdrop" onclick={closeVoidModal} onkeydown={(e) => e.key === 'Escape' && closeVoidModal()} role="presentation">
      <div class="modal-box modal-box-sm" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>作廢期初應付帳款</h3>
          <button class="btn-close" onclick={closeVoidModal}>&times;</button>
        </div>

        <div class="modal-body">
          <p class="text-sm mb-3">
            確定要作廢期初應付單 <strong class="font-mono">{voidTargetOap.opening_number}</strong>
            （供應商：{voidTargetOap.vendor_name_snapshot}，金額：{formatCurrency(voidTargetOap.amount)}）？
          </p>
          <p class="text-xs text-muted mb-3">
            作廢後將同步作廢關聯之應付帳款。若此單據已有付款核銷，必須先作廢付款單才可作廢此單。
          </p>

          {#if voidError}
            <div class="alert alert-danger" id="void-error-msg">{voidError}</div>
          {/if}

          <div class="form-group">
            <label for="void-reason">作廢原因 <span class="required">*</span></label>
            <textarea 
              id="void-reason" 
              bind:value={voidReason} 
              rows="3" 
              placeholder="請填寫作廢原因（必填）" 
              required
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeVoidModal} disabled={voidSubmitting}>取消</button>
          <button class="btn btn-danger" onclick={handleVoidSubmit} disabled={voidSubmitting} id="btn-submit-void">
            {voidSubmitting ? '作廢中...' : '確定作廢'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ap-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--color-bg-primary, #ffffff);
    color: var(--color-text-primary, #1e293b);
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
    background-color: var(--color-bg-secondary, #f8fafc);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background-color: #e0f2fe;
    color: #0284c7;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }

  .subtitle {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #64748b);
    margin: 0.25rem 0 0 0;
  }

  .subtabs-bar {
    display: flex;
    gap: 0.5rem;
    padding: 0 1.5rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
    background-color: var(--color-bg-secondary, #f8fafc);
  }

  .subtab-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-muted, #64748b);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subtab-btn:hover {
    color: var(--color-text-primary, #1e293b);
  }

  .subtab-btn.active {
    color: #0284c7;
    border-bottom-color: #0284c7;
  }

  .view-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .filter-group select {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border, #cbd5e1);
    border-radius: 6px;
    background: #ffffff;
    font-size: 0.875rem;
  }

  .table-container {
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 8px;
    overflow: hidden;
    background: #ffffff;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    text-align: left;
  }

  .data-table th {
    background-color: #f8fafc;
    padding: 0.75rem 1rem;
    font-weight: 600;
    color: #475569;
    border-bottom: 1px solid #e2e8f0;
  }

  .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #f1f5f9;
  }

  .data-table tr:last-child td {
    border-bottom: none;
  }

  .row-voided {
    opacity: 0.65;
    background-color: #fdf2f2;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .font-medium {
    font-weight: 500;
  }

  .text-right {
    text-align: right;
  }

  .text-center {
    text-align: center;
  }

  .text-sm {
    font-size: 0.875rem;
  }

  .text-xs {
    font-size: 0.75rem;
  }

  .text-muted {
    color: #64748b;
  }

  .text-danger {
    color: #dc2626;
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge-success {
    background-color: #dcfce7;
    color: #15803d;
  }

  .badge-danger {
    background-color: #fee2e2;
    color: #b91c1c;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-primary {
    background-color: #0284c7;
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: #0369a1;
  }

  .btn-secondary {
    background-color: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: #e2e8f0;
  }

  .btn-danger {
    background-color: #dc2626;
    color: #ffffff;
  }

  .btn-danger:hover:not(:disabled) {
    background-color: #b91c1c;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-action {
    background: none;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .btn-action:hover {
    background-color: #fee2e2;
  }

  .empty-state {
    padding: 3rem 1.5rem;
    text-align: center;
    color: #64748b;
  }

  .empty-state p {
    margin-bottom: 1rem;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 10px;
    width: 100%;
    max-width: 520px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  .modal-box-sm {
    max-width: 440px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: #94a3b8;
  }

  .btn-close:hover {
    color: #334155;
  }

  .modal-body {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid #e2e8f0;
    background-color: #f8fafc;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #334155;
  }

  .required {
    color: #dc2626;
  }

  input, select, textarea {
    padding: 0.5rem 0.75rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
  }

  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: #0284c7;
    box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
  }

  .help-text {
    font-size: 0.6875rem;
    color: #64748b;
  }

  .terms-hint {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: #0369a1;
    background-color: #f0f9ff;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid #bae6fd;
  }

  .alert {
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.8125rem;
  }

  .alert-danger {
    background-color: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .mb-3 {
    margin-bottom: 0.75rem;
  }
</style>
