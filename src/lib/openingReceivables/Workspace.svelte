<script>
  import { onMount } from 'svelte';
  import { appState, showToast } from '../store.svelte.js';
  import { invoke } from '../tauri.js';
  import { calculateDueDate } from '../paymentTerms.js';
  import {
    loadOpeningReceivablesAction,
    createOpeningReceivableAction,
    voidOpeningReceivableAction
  } from './store.js';

  let props = $props();

  let isLoading = $state(false);
  let availableCustomers = $state([]);

  // Filters
  let filterCustomerId = $state('');
  let filterStatus = $state('all');

  // Create Modal
  let isCreateModalOpen = $state(false);
  let createError = $state('');
  let createSubmitting = $state(false);
  let createCustomerId = $state('');
  let createOriginalReference = $state('');
  let createDocumentDate = $state(getTodayDateString());
  let createDueDate = $state(getTodayDateString());
  let createAmount = $state('');
  let createNote = $state('');

  // Void Modal
  let isVoidModalOpen = $state(false);
  let voidTarget = $state(null);
  let voidReason = $state('');
  let voidError = $state('');
  let voidSubmitting = $state(false);

  function getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatCurrency(val) {
    if (val === null || val === undefined || isNaN(val)) return '$0';
    return '$' + Number(val).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  async function loadCustomers() {
    try {
      const partners = await invoke('list_partners');
      availableCustomers = (partners || []).filter(p => (p.is_customer === 1 || p.is_customer === true) && p.is_active !== 0 && p.is_active !== false);
    } catch (err) {
      console.error('Failed to load customers:', err);
    }
  }

  async function refreshList() {
    isLoading = true;
    try {
      const filter = {};
      if (filterCustomerId) filter.customer_partner_id = filterCustomerId;
      if (filterStatus && filterStatus !== 'all') filter.status = filterStatus;
      await loadOpeningReceivablesAction(filter);
    } catch (err) {
      showToast('載入荷初應收失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  function handleCustomerChange() {
    const cust = availableCustomers.find(c => c.id === createCustomerId);
    const termsType = cust?.collection_terms_type || cust?.payment_terms_type;
    const termsDays = cust?.collection_terms_days ?? cust?.payment_terms_days;
    if (cust && termsType) {
      createDueDate = calculateDueDate(createDocumentDate, termsType, termsDays);
    }
  }

  function handleDocDateChange() {
    const cust = availableCustomers.find(c => c.id === createCustomerId);
    const termsType = cust?.collection_terms_type || cust?.payment_terms_type;
    const termsDays = cust?.collection_terms_days ?? cust?.payment_terms_days;
    if (cust && termsType) {
      createDueDate = calculateDueDate(createDocumentDate, termsType, termsDays);
    } else if (createDueDate < createDocumentDate) {
      createDueDate = createDocumentDate;
    }
  }

  function openCreateModal() {
    createCustomerId = '';
    createOriginalReference = '';
    createDocumentDate = getTodayDateString();
    createDueDate = getTodayDateString();
    createAmount = '';
    createNote = '';
    createError = '';
    isCreateModalOpen = true;
  }

  function closeCreateModal() {
    isCreateModalOpen = false;
    createError = '';
  }

  async function handleCreateSubmit() {
    createError = '';
    if (!createCustomerId) {
      createError = '請選擇客戶';
      return;
    }
    if (!createOriginalReference.trim()) {
      createError = '請填寫原單號 / 發票號';
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
      createError = '未收金額必須大於 0';
      return;
    }

    createSubmitting = true;
    try {
      await createOpeningReceivableAction({
        customer_partner_id: createCustomerId,
        original_reference: createOriginalReference.trim(),
        document_date: createDocumentDate,
        due_date: createDueDate,
        amount: amt,
        note: createNote.trim() || null
      });
      closeCreateModal();
      await refreshList();
    } catch (err) {
      createError = err.message || String(err);
    } finally {
      createSubmitting = false;
    }
  }

  function openVoidModal(oar) {
    voidTarget = oar;
    voidReason = '';
    voidError = '';
    isVoidModalOpen = true;
  }

  function closeVoidModal() {
    isVoidModalOpen = false;
    voidTarget = null;
    voidError = '';
  }

  async function handleVoidSubmit() {
    voidError = '';
    if (!voidReason.trim()) {
      voidError = '請輸入作廢原因';
      return;
    }
    voidSubmitting = true;
    try {
      await voidOpeningReceivableAction(voidTarget.id, voidReason.trim());
      closeVoidModal();
      await refreshList();
    } catch (err) {
      voidError = err.message || String(err);
    } finally {
      voidSubmitting = false;
    }
  }

  onMount(async () => {
    await loadCustomers();
    await refreshList();
  });
</script>

<div class="workspace-container">
  <div class="workspace-header">
    <div class="header-title">
      <h2>期初應收帳款 (Opening Receivables)</h2>
      <p class="subtitle">導入系統前客戶已欠帳款起點維護，建立後自動納入應收帳款與帳齡分析</p>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" onclick={openCreateModal} id="btn-create-opening-receivable">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        新增期初應收
      </button>
    </div>
  </div>

  <div class="toolbar">
    <div class="filters">
      <div class="filter-group">
        <label for="filter-oar-customer">客戶：</label>
        <select id="filter-oar-customer" bind:value={filterCustomerId} onchange={refreshList}>
          <option value="">全部客戶</option>
          {#each availableCustomers as c}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="filter-oar-status">狀態：</label>
        <select id="filter-oar-status" bind:value={filterStatus} onchange={refreshList}>
          <option value="all">全部狀態</option>
          <option value="open">有效 (open)</option>
          <option value="voided">已作廢 (voided)</option>
        </select>
      </div>
    </div>
  </div>

  <div class="table-container">
    {#if isLoading}
      <div class="empty-state">資料載入中...</div>
    {:else if !appState.openingReceivables || appState.openingReceivables.length === 0}
      <div class="empty-state">
        <p>目前尚無期初應收帳款紀錄</p>
        <button class="btn btn-secondary" onclick={openCreateModal}>立即新增期初欠款</button>
      </div>
    {:else}
      <table class="data-table">
        <thead>
          <tr>
            <th>期初單號</th>
            <th>客戶</th>
            <th>原單號 / 發票號</th>
            <th>單據日</th>
            <th>到期日</th>
            <th class="text-right">未收金額 (含稅)</th>
            <th>狀態</th>
            <th>備註</th>
            <th class="text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {#each appState.openingReceivables as oar}
            <tr class={oar.status === 'voided' ? 'row-voided' : ''}>
              <td class="font-mono font-medium">{oar.opening_number}</td>
              <td>{oar.customer_name_snapshot}</td>
              <td class="font-mono">{oar.original_reference}</td>
              <td>{oar.document_date}</td>
              <td>{oar.due_date}</td>
              <td class="text-right font-medium">{formatCurrency(oar.amount)}</td>
              <td>
                {#if oar.status === 'open'}
                  <span class="badge badge-success">有效 (open)</span>
                {:else if oar.status === 'voided'}
                  <span class="badge badge-danger">已作廢 (voided)</span>
                {:else}
                  <span class="badge">{oar.status}</span>
                {/if}
              </td>
              <td class="text-muted text-sm">{oar.note || '-'}</td>
              <td class="text-center">
                {#if oar.status === 'open'}
                  <button 
                    class="btn-action text-danger" 
                    onclick={() => openVoidModal(oar)}
                    title="作廢此期初應收"
                  >
                    作廢
                  </button>
                {:else}
                  <span class="text-xs text-muted" title={oar.void_reason || ''}>
                    {oar.void_reason ? `原因: ${oar.void_reason}` : '已作廢'}
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <!-- Create Modal -->
  {#if isCreateModalOpen}
    <div class="modal-backdrop" onclick={closeCreateModal} onkeydown={(e) => e.key === 'Escape' && closeCreateModal()} role="presentation">
      <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>新增期初應收帳款</h3>
          <button class="btn-close" onclick={closeCreateModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if createError}
            <div class="alert alert-danger" id="create-oar-error-msg">{createError}</div>
          {/if}

          <div class="form-group">
            <label for="create-oar-customer">客戶 <span class="required">*</span></label>
            <select 
              id="create-oar-customer" 
              bind:value={createCustomerId} 
              onchange={handleCustomerChange}
              required
            >
              <option value="" disabled>請選擇客戶</option>
              {#each availableCustomers as c}
                <option value={c.id}>
                  {c.name} {(c.collection_terms_type || c.payment_terms_type) ? `(${(c.collection_terms_type || c.payment_terms_type) === 'net' ? '貨到' : '月結'} ${c.collection_terms_days ?? c.payment_terms_days} 天)` : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="create-oar-orig-ref">原單號 / 發票號 <span class="required">*</span></label>
            <input 
              type="text" 
              id="create-oar-orig-ref" 
              bind:value={createOriginalReference} 
              placeholder="舊系統單號或發票號碼"
              required 
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="create-oar-doc-date">原單據日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="create-oar-doc-date" 
                bind:value={createDocumentDate} 
                onchange={handleDocDateChange}
                required 
              />
              <span class="help-text">不可晚於今天；有銷售單時須早於首張銷售單</span>
            </div>

            <div class="form-group">
              <label for="create-oar-due-date">到期日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="create-oar-due-date" 
                bind:value={createDueDate} 
                required 
              />
              <span class="help-text">不可早於單據日</span>
            </div>
          </div>

          <div class="form-group">
            <label for="create-oar-amount">未收金額 (含稅) <span class="required">*</span></label>
            <input 
              type="number" 
              id="create-oar-amount" 
              bind:value={createAmount} 
              placeholder="0.00" 
              step="0.01" 
              min="0.01" 
              required 
            />
          </div>

          <div class="form-group">
            <label for="create-oar-note">備註</label>
            <textarea 
              id="create-oar-note" 
              bind:value={createNote} 
              placeholder="選填備註說明" 
              rows="2"
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeCreateModal} disabled={createSubmitting}>取消</button>
          <button class="btn btn-primary" onclick={handleCreateSubmit} disabled={createSubmitting} id="btn-submit-create-opening-receivable">
            {createSubmitting ? '儲存中...' : '確認新增'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Void Modal -->
  {#if isVoidModalOpen}
    <div class="modal-backdrop" onclick={closeVoidModal} onkeydown={(e) => e.key === 'Escape' && closeVoidModal()} role="presentation">
      <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>作廢期初應收帳款</h3>
          <button class="btn-close" onclick={closeVoidModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if voidError}
            <div class="alert alert-danger" id="void-oar-error-msg">{voidError}</div>
          {/if}

          <p class="text-sm">
            確定要作廢期初單據 <strong class="font-mono">{voidTarget?.opening_number}</strong>（{voidTarget?.customer_name_snapshot}，原單號：{voidTarget?.original_reference}）嗎？
          </p>

          <div class="alert alert-warning text-xs">
            ⚠️ 作廢後將連動作廢其對應之應收帳款紀錄。若已發生收款核銷將無法直接作廢。
          </div>

          <div class="form-group">
            <label for="void-oar-reason">作廢原因 <span class="required">*</span></label>
            <textarea 
              id="void-oar-reason" 
              bind:value={voidReason} 
              placeholder="請填寫作廢原因（必填）" 
              rows="3"
              required
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeVoidModal} disabled={voidSubmitting}>取消</button>
          <button class="btn btn-danger" onclick={handleVoidSubmit} disabled={voidSubmitting} id="btn-submit-void-opening-receivable">
            {voidSubmitting ? '作廢中...' : '確認作廢'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .workspace-container {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .workspace-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header-title h2 {
    margin: 0 0 0.25rem 0;
    font-size: 1.5rem;
    font-weight: 600;
  }
  .subtitle {
    margin: 0;
    color: var(--text-muted, #6c757d);
    font-size: 0.875rem;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-card, #fff);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid var(--border-color, #e9ecef);
  }
  .filters {
    display: flex;
    gap: 1.5rem;
    align-items: center;
  }
  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .filter-group label {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .filter-group select {
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--border-color, #ced4da);
    background: var(--bg-input, #fff);
    font-size: 0.875rem;
  }
  .table-container {
    background: var(--bg-card, #fff);
    border-radius: 8px;
    border: 1px solid var(--border-color, #e9ecef);
    overflow-x: auto;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .data-table th, .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-color, #e9ecef);
    text-align: left;
  }
  .data-table th {
    background: var(--bg-table-header, #f8f9fa);
    font-weight: 600;
  }
  .data-table tr.row-voided {
    opacity: 0.6;
    background: var(--bg-voided, #fdfdfe);
  }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .font-mono { font-family: monospace; }
  .font-medium { font-weight: 500; }
  .text-muted { color: var(--text-muted, #6c757d); }
  .text-sm { font-size: 0.875rem; }
  .text-xs { font-size: 0.75rem; }
  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 4px;
    background: #e9ecef;
    color: #495057;
  }
  .badge-success {
    background: #d4edda;
    color: #155724;
  }
  .badge-danger {
    background: #f8d7da;
    color: #721c24;
  }
  .btn-action {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }
  .btn-action:hover {
    background: rgba(0,0,0,0.05);
  }
  .text-danger { color: #dc3545; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--primary-color, #0d6efd);
    color: #fff;
  }
  .btn-secondary {
    background: #e9ecef;
    color: #495057;
    border-color: #ced4da;
  }
  .btn-danger {
    background: #dc3545;
    color: #fff;
  }
  .empty-state {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--text-muted, #6c757d);
  }
  .empty-state p { margin-bottom: 1rem; }
  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-box {
    background: #fff;
    border-radius: 8px;
    width: 100%;
    max-width: 500px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    overflow: hidden;
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e9ecef;
  }
  .modal-header h3 { margin: 0; font-size: 1.125rem; }
  .btn-close {
    background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #6c757d;
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
    border-top: 1px solid #e9ecef;
    background: #f8f9fa;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .form-group label {
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .form-group input, .form-group select, .form-group textarea {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid #ced4da;
    font-size: 0.875rem;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .required { color: #dc3545; }
  .help-text { font-size: 0.75rem; color: #6c757d; }
  .alert {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }
  .alert-danger { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
  .alert-warning { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
</style>
