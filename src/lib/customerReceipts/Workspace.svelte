<script>
  import { onMount } from 'svelte';
  import {
    appState,
    fetchPartners,
    showToast,
    formatCurrency,
    formatTime
  } from '../store.svelte.js';
  import {
    loadCustomerReceiptsAction,
    getCustomerReceiptAction,
    createCustomerReceiptAction,
    updateCustomerReceiptHeaderAction,
    addCustomerReceiptAllocationAction,
    updateCustomerReceiptAllocationAction,
    removeCustomerReceiptAllocationAction,
    postCustomerReceiptAction,
    cancelCustomerReceiptAction,
    voidCustomerReceiptAction,
    loadCustomerOpenReceivablesAction
  } from './store.js';

  let props = $props();

  // View state: 'list' | 'draft' | 'detail'
  let viewMode = $state('list');
  let isLoading = $state(false);
  let isActionLoading = $state(false);
  let errorMessage = $state('');

  // List filters
  let filterStatus = $state('all');
  let filterCustomerId = $state('');
  let filterFromDate = $state('');
  let filterToDate = $state('');
  let searchTerm = $state('');

  // Selected receipt
  let selectedReceipt = $state(null);

  // Create Modal state
  let isCreateModalOpen = $state(false);
  let newCustomerId = $state('');
  let newReceiptDate = $state(getTodayDateString());
  let newReceiptMethod = $state('bank_transfer');
  let newReceiptRef = $state('');
  let newReceiptNote = $state('');
  let newReceiptError = $state('');
  let isCreatingReceipt = $state(false);

  // Draft Editor State
  let draftDate = $state('');
  let draftMethod = $state('bank_transfer');
  let draftRef = $state('');
  let draftNote = $state('');
  let isSavingHeader = $state(false);
  let candidateReceivables = $state([]);
  let draftAllocations = $state({}); // arId -> { selected, amount, rawInput, allocationId, error }

  // Void Modal State
  let isVoidModalOpen = $state(false);
  let voidTargetReceipt = $state(null);
  let voidReason = $state('');
  let voidError = $state('');
  let isVoiding = $state(false);

  // Helpers
  function getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getMethodLabel(method) {
    switch (method) {
      case 'bank_transfer': return '銀行轉帳';
      case 'cash': return '現金';
      case 'check': return '支票';
      case 'other': return '其他';
      default: return method || '-';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'draft': return '草稿 (draft)';
      case 'posted': return '已過帳 (posted)';
      case 'voided': return '已作廢 (voided)';
      case 'cancelled': return '已取消 (cancelled)';
      default: return status || '-';
    }
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'draft': return 'badge-warning';
      case 'posted': return 'badge-success';
      case 'voided': return 'badge-danger';
      case 'cancelled': return 'badge-secondary';
      default: return 'badge-info';
    }
  }

  // Derived state
  let customers = $derived(
    (appState.partners || []).filter(p => p.is_customer)
  );

  let receiptsList = $derived(appState.customerReceipts || []);

  let filteredReceipts = $derived(
    receiptsList.filter(rcpt => {
      if (filterStatus !== 'all' && rcpt.status !== filterStatus) return false;
      if (filterCustomerId && rcpt.customer_partner_id !== filterCustomerId) return false;
      if (filterFromDate && rcpt.receipt_date < filterFromDate) return false;
      if (filterToDate && rcpt.receipt_date > filterToDate) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const num = (rcpt.receipt_number || '').toLowerCase();
        const cust = (rcpt.customer_name_snapshot || '').toLowerCase();
        const ref = (rcpt.receipt_reference || '').toLowerCase();
        return num.includes(term) || cust.includes(term) || ref.includes(term);
      }
      return true;
    })
  );

  // Statistics
  let stats = $derived.by(() => {
    let totalCount = receiptsList.length;
    let draftCount = 0;
    let postedCount = 0;
    let postedAmount = 0;
    let voidedCount = 0;

    for (const r of receiptsList) {
      if (r.status === 'draft') draftCount++;
      else if (r.status === 'posted') {
        postedCount++;
        postedAmount += Number(r.total_amount || 0);
      } else if (r.status === 'voided') {
        voidedCount++;
      }
    }

    return {
      totalCount,
      draftCount,
      postedCount,
      postedAmount: Math.round(postedAmount * 100) / 100,
      voidedCount
    };
  });

  // Derived live total for draft allocations
  let draftTotalAmount = $derived.by(() => {
    let sum = 0;
    for (const arId of Object.keys(draftAllocations)) {
      const a = draftAllocations[arId];
      if (a && a.selected && !isNaN(a.amount) && a.amount > 0) {
        sum += Number(a.amount);
      }
    }
    return Math.round(sum * 100) / 100;
  });

  let draftAllocCount = $derived.by(() => {
    let count = 0;
    for (const arId of Object.keys(draftAllocations)) {
      const a = draftAllocations[arId];
      if (a && a.selected) count++;
    }
    return count;
  });

  let hasDraftAllocationErrors = $derived.by(() => {
    for (const arId of Object.keys(draftAllocations)) {
      const a = draftAllocations[arId];
      if (a && a.selected) {
        if (a.error || isNaN(a.amount) || a.amount <= 0) {
          return true;
        }
      }
    }
    return false;
  });

  // Lifecycle
  onMount(async () => {
    isLoading = true;
    try {
      if (!appState.partners || appState.partners.length === 0) {
        await fetchPartners();
      }
      await loadCustomerReceiptsAction();
    } catch (err) {
      console.error('Failed to initialize CustomerReceiptsWorkspace:', err);
      errorMessage = err.message || String(err);
    } finally {
      isLoading = false;
    }
  });

  async function refreshReceipts() {
    isLoading = true;
    try {
      await loadCustomerReceiptsAction();
    } catch (err) {
      errorMessage = err.message || String(err);
    } finally {
      isLoading = false;
    }
  }

  // Create Modal Actions
  function openCreateModal() {
    newCustomerId = customers.length > 0 ? customers[0].id : '';
    newReceiptDate = getTodayDateString();
    newReceiptMethod = 'bank_transfer';
    newReceiptRef = '';
    newReceiptNote = '';
    newReceiptError = '';
    isCreateModalOpen = true;
  }

  function closeCreateModal() {
    isCreateModalOpen = false;
    newReceiptError = '';
  }

  async function handleCreateReceiptSubmit() {
    newReceiptError = '';
    if (!newCustomerId) {
      newReceiptError = '請選擇客戶';
      return;
    }
    if (!newReceiptDate) {
      newReceiptError = '請選擇收款日';
      return;
    }
    if (newReceiptDate > getTodayDateString()) {
      newReceiptError = '收款日不可晚於今天';
      return;
    }

    isCreatingReceipt = true;
    try {
      const created = await createCustomerReceiptAction({
        customer_partner_id: newCustomerId,
        receipt_date: newReceiptDate,
        receipt_method: newReceiptMethod,
        receipt_reference: newReceiptRef.trim() || null,
        note: newReceiptNote.trim() || null
      });
      isCreateModalOpen = false;
      await openDraftEditView(created);
    } catch (err) {
      newReceiptError = err.message || String(err);
    } finally {
      isCreatingReceipt = false;
    }
  }

  // Draft Editor Actions
  async function openDraftEditView(receipt) {
    errorMessage = '';
    isLoading = true;
    viewMode = 'draft';

    try {
      // Always ensure full detail with allocations is loaded
      const receiptDetail = await getCustomerReceiptAction(receipt.id);
      selectedReceipt = receiptDetail;
      draftDate = receiptDetail.receipt_date || getTodayDateString();
      draftMethod = receiptDetail.receipt_method || 'bank_transfer';
      draftRef = receiptDetail.receipt_reference || '';
      draftNote = receiptDetail.note || '';

      // Query open accounts receivable for this customer
      const arList = await loadCustomerOpenReceivablesAction(receiptDetail.customer_partner_id);

      // Map existing allocations
      const allocMap = {};
      for (const a of (receiptDetail.allocations || [])) {
        allocMap[a.account_receivable_id] = a;
      }

      // Merge candidates: open AR plus any AR already allocated in this draft
      const candidateMap = new Map();
      for (const ar of arList) {
        candidateMap.set(ar.id, ar);
      }
      for (const a of (receiptDetail.allocations || [])) {
        if (!candidateMap.has(a.account_receivable_id)) {
          candidateMap.set(a.account_receivable_id, {
            id: a.account_receivable_id,
            customer_partner_id: receiptDetail.customer_partner_id,
            source_type: a.source_type,
            source_number: a.source_number,
            document_date: a.document_date,
            due_date: a.due_date,
            amount: a.ar_amount || a.amount,
            outstanding_amount: a.amount // fallback
          });
        }
      }

      const candidates = Array.from(candidateMap.values());

      // Prepare state map
      const stateMap = {};
      for (const ar of candidates) {
        const existingAlloc = allocMap[ar.id];
        if (existingAlloc) {
          stateMap[ar.id] = {
            selected: true,
            amount: existingAlloc.amount,
            rawInput: String(existingAlloc.amount),
            allocationId: existingAlloc.id,
            error: ''
          };
        } else {
          stateMap[ar.id] = {
            selected: false,
            amount: ar.outstanding_amount,
            rawInput: String(ar.outstanding_amount),
            allocationId: null,
            error: ''
          };
        }
      }

      candidateReceivables = candidates;
      draftAllocations = stateMap;
    } catch (err) {
      console.error('Failed to load candidate receivables:', err);
      errorMessage = '載入待核銷應收失敗：' + (err.message || String(err));
    } finally {
      isLoading = false;
    }
  }

  async function openDetailView(receipt) {
    errorMessage = '';
    isLoading = true;
    try {
      const full = await getCustomerReceiptAction(receipt.id);
      selectedReceipt = full;
      viewMode = 'detail';
    } catch (err) {
      errorMessage = err.message || String(err);
    } finally {
      isLoading = false;
    }
  }

  async function handleToggleAllocation(ar) {
    errorMessage = '';
    const allocState = draftAllocations[ar.id];
    if (!allocState) return;

    if (!allocState.selected) {
      // User is checking this receivable
      allocState.selected = true;
      let amt = Number(allocState.amount);
      if (isNaN(amt) || amt <= 0) {
        amt = ar.outstanding_amount;
        allocState.amount = amt;
        allocState.rawInput = String(amt);
      }
      allocState.error = '';

      try {
        isActionLoading = true;
        const updated = await addCustomerReceiptAllocationAction(selectedReceipt.id, ar.id, amt);
        selectedReceipt = updated;
        const added = (updated.allocations || []).find(a => a.account_receivable_id === ar.id);
        if (added) {
          allocState.allocationId = added.id;
        }
      } catch (err) {
        allocState.selected = false;
        errorMessage = err.message || String(err);
      } finally {
        isActionLoading = false;
      }
    } else {
      // User is unchecking this receivable
      allocState.selected = false;
      allocState.error = '';
      if (allocState.allocationId) {
        try {
          isActionLoading = true;
          const updated = await removeCustomerReceiptAllocationAction(selectedReceipt.id, allocState.allocationId);
          selectedReceipt = updated;
          allocState.allocationId = null;
        } catch (err) {
          allocState.selected = true;
          errorMessage = err.message || String(err);
        } finally {
          isActionLoading = false;
        }
      }
    }
  }

  async function handleAllocationAmountChange(ar, newValue) {
    const allocState = draftAllocations[ar.id];
    if (!allocState) return;

    allocState.rawInput = newValue;
    const num = parseFloat(newValue);
    allocState.amount = isNaN(num) ? 0 : num;

    // Boundary & error check for visual feedback
    if (isNaN(num) || num <= 0) {
      allocState.error = '核銷金額必須大於 0';
    } else if (num > ar.outstanding_amount) {
      allocState.error = `超過未收餘額 ${formatCurrency(ar.outstanding_amount)}`;
    } else {
      allocState.error = '';
    }

    // Sync to backend if checked and valid
    if (allocState.selected && allocState.allocationId && !allocState.error) {
      try {
        const updated = await updateCustomerReceiptAllocationAction(selectedReceipt.id, allocState.allocationId, num);
        selectedReceipt = updated;
      } catch (err) {
        errorMessage = err.message || String(err);
      }
    }
  }

  async function handleSaveDraftHeader() {
    errorMessage = '';
    if (!draftDate) {
      errorMessage = '收款日不可為空';
      return;
    }
    if (draftDate > getTodayDateString()) {
      errorMessage = '收款日不可晚於今天';
      return;
    }

    isSavingHeader = true;
    try {
      const updated = await updateCustomerReceiptHeaderAction({
        id: selectedReceipt.id,
        receipt_id: selectedReceipt.id,
        receipt_date: draftDate,
        receipt_method: draftMethod,
        receipt_reference: draftRef.trim() || null,
        note: draftNote.trim() || null
      });
      selectedReceipt = updated;
    } catch (err) {
      errorMessage = err.message || String(err);
    } finally {
      isSavingHeader = false;
    }
  }

  async function handlePostReceipt() {
    errorMessage = '';

    // Check if any checked allocation exceeds outstanding or is invalid
    for (const ar of candidateReceivables) {
      const allocState = draftAllocations[ar.id];
      if (allocState && allocState.selected) {
        if (allocState.error) {
          errorMessage = `核銷明細含有錯誤（${allocState.error}），請修正後再行過帳`;
          return;
        }
        if (isNaN(allocState.amount) || allocState.amount <= 0) {
          errorMessage = '核銷金額必須大於 0';
          return;
        }
        if (allocState.amount > ar.outstanding_amount) {
          try {
            isActionLoading = true;
            if (allocState.allocationId) {
              await updateCustomerReceiptAllocationAction(selectedReceipt.id, allocState.allocationId, allocState.amount);
            } else {
              await addCustomerReceiptAllocationAction(selectedReceipt.id, ar.id, allocState.amount);
            }
          } catch (err) {
            errorMessage = err.message || String(err);
            isActionLoading = false;
            return;
          }
        }
      }
    }

    if (draftAllocCount === 0) {
      errorMessage = '收款單至少需有 1 筆核銷方可過帳';
      return;
    }

    isActionLoading = true;
    try {
      const posted = await postCustomerReceiptAction(selectedReceipt.id);
      selectedReceipt = posted;
      viewMode = 'detail';
      await refreshReceipts();
    } catch (err) {
      errorMessage = err.message || String(err);
    } finally {
      isActionLoading = false;
    }
  }

  async function handleCancelReceipt() {
    errorMessage = '';
    if (!confirm(`確定要取消收款單「${selectedReceipt.receipt_number}」嗎？`)) {
      return;
    }

    isActionLoading = true;
    try {
      const cancelled = await cancelCustomerReceiptAction(selectedReceipt.id);
      selectedReceipt = cancelled;
      viewMode = 'detail';
      await refreshReceipts();
    } catch (err) {
      errorMessage = err.message || String(err);
    } finally {
      isActionLoading = false;
    }
  }

  // Void Modal Actions
  function openVoidModal(receipt) {
    voidTargetReceipt = receipt;
    voidReason = '';
    voidError = '';
    isVoidModalOpen = true;
  }

  function closeVoidModal() {
    isVoidModalOpen = false;
    voidTargetReceipt = null;
    voidError = '';
  }

  async function handleVoidSubmit() {
    if (!voidTargetReceipt) return;
    if (!voidReason.trim()) {
      voidError = '作廢需填寫原因';
      return;
    }

    isVoiding = true;
    voidError = '';
    try {
      const voided = await voidCustomerReceiptAction(voidTargetReceipt.id, voidReason.trim());
      isVoidModalOpen = false;
      voidTargetReceipt = null;
      if (selectedReceipt && selectedReceipt.id === voided.id) {
        selectedReceipt = voided;
      }
      await refreshReceipts();
    } catch (err) {
      voidError = err.message || String(err);
    } finally {
      isVoiding = false;
    }
  }
</script>

<div class="workspace-container">
  <!-- Header -->
  <div class="workspace-header">
    <div class="header-title">
      <h2>客戶收款單與核銷管理</h2>
      <p class="subtitle">登錄客戶外部收款（轉帳、現金、支票），並精確核銷對應之應收帳款（發票或期初欠款）</p>
    </div>
    <div class="header-actions">
      {#if viewMode === 'list'}
        <button class="btn btn-primary" onclick={openCreateModal} id="btn-new-receipt">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          新增收款單
        </button>
      {:else}
        <button class="btn btn-secondary" onclick={() => { viewMode = 'list'; refreshReceipts(); }} id="btn-back-to-list">
          返回收款單列表
        </button>
      {/if}
    </div>
  </div>

  <!-- Global Alert Error -->
  {#if errorMessage}
    <div class="alert alert-danger" role="alert">
      <span>{errorMessage}</span>
      <button class="btn-close" onclick={() => errorMessage = ''} aria-label="關閉警示">×</button>
    </div>
  {/if}

  <!-- VIEW 1: LIST VIEW -->
  {#if viewMode === 'list'}
    <!-- Statistics Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">全部收款單</div>
        <div class="stat-value">{stats.totalCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">草稿中</div>
        <div class="stat-value text-warning">{stats.draftCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已過帳收款</div>
        <div class="stat-value text-success">{formatCurrency(stats.postedAmount)}</div>
        <div class="stat-hint">{stats.postedCount} 筆已結算</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已作廢</div>
        <div class="stat-value text-muted">{stats.voidedCount}</div>
      </div>
    </div>

    <!-- Toolbar & Filters -->
    <div class="toolbar">
      <div class="filters">
        <div class="filter-group">
          <label for="filter-status">單據狀態：</label>
          <select id="filter-status" bind:value={filterStatus} class="form-select">
            <option value="all">全部狀態</option>
            <option value="draft">草稿 (draft)</option>
            <option value="posted">已過帳 (posted)</option>
            <option value="voided">已作廢 (voided)</option>
            <option value="cancelled">已取消 (cancelled)</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filter-customer">客戶：</label>
          <select id="filter-customer" bind:value={filterCustomerId} class="form-select">
            <option value="">全部客戶</option>
            {#each customers as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>

        <div class="filter-group">
          <label for="filter-from-date">起日：</label>
          <input type="date" id="filter-from-date" bind:value={filterFromDate} class="form-input" />
        </div>

        <div class="filter-group">
          <label for="filter-to-date">迄日：</label>
          <input type="date" id="filter-to-date" bind:value={filterToDate} class="form-input" />
        </div>

        <div class="filter-group">
          <label for="filter-search">搜尋：</label>
          <input
            type="text"
            id="filter-search"
            placeholder="單號 / 客戶 / 參考碼..."
            bind:value={searchTerm}
            class="form-input"
          />
        </div>
      </div>

      <div class="toolbar-actions">
        <button class="btn btn-secondary btn-sm" onclick={refreshReceipts}>重新整理</button>
      </div>
    </div>

    <!-- Receipts Data Table -->
    <div class="table-container">
      {#if isLoading}
        <div class="empty-state">載入收款單資料中...</div>
      {:else if filteredReceipts.length === 0}
        <div class="empty-state">
          <p>尚無符合條件的收款單</p>
          <button class="btn btn-secondary" onclick={openCreateModal}>建立第一張收款單</button>
        </div>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>收款單號</th>
              <th>收款日期</th>
              <th>客戶名稱</th>
              <th>收款方式</th>
              <th>交易參考</th>
              <th class="text-right">收款總額</th>
              <th class="text-center">核銷筆數</th>
              <th class="text-center">狀態</th>
              <th>備註</th>
              <th class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredReceipts as rcpt (rcpt.id)}
              <tr>
                <td class="font-mono font-medium">
                  <button class="link-btn" onclick={() => rcpt.status === 'draft' ? openDraftEditView(rcpt) : openDetailView(rcpt)}>
                    {rcpt.receipt_number}
                  </button>
                </td>
                <td>{rcpt.receipt_date}</td>
                <td class="font-medium">{rcpt.customer_name_snapshot}</td>
                <td>
                  <span class="badge badge-info">{getMethodLabel(rcpt.receipt_method)}</span>
                </td>
                <td class="font-mono text-sm">{rcpt.receipt_reference || '-'}</td>
                <td class="text-right font-medium text-success">{formatCurrency(rcpt.total_amount)}</td>
                <td class="text-center">{rcpt.allocation_count !== undefined ? rcpt.allocation_count : (rcpt.allocations || []).length}</td>
                <td class="text-center">
                  <span class="badge {getStatusBadgeClass(rcpt.status)}">
                    {getStatusLabel(rcpt.status)}
                  </span>
                </td>
                <td class="text-muted text-sm">{rcpt.note || '-'}</td>
                <td class="text-center">
                  <div class="action-buttons">
                    {#if rcpt.status === 'draft'}
                      <button class="btn-action" onclick={() => openDraftEditView(rcpt)} title="編輯草稿與核銷">
                        編輯
                      </button>
                    {:else}
                      <button class="btn-action" onclick={() => openDetailView(rcpt)} title="檢視明細">
                        檢視
                      </button>
                    {/if}

                    {#if rcpt.status === 'posted'}
                      <button class="btn-action text-danger" onclick={() => openVoidModal(rcpt)} title="作廢收款單">
                        作廢
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

  <!-- VIEW 2: DRAFT EDIT VIEW -->
  {:else if viewMode === 'draft' && selectedReceipt}
    <div class="panel draft-panel">
      <div class="panel-header">
        <div class="panel-title">
          <h3>
            編輯草稿收款單：<span class="font-mono text-primary">{selectedReceipt.receipt_number}</span>
          </h3>
          <span class="badge badge-warning">草稿中 (draft)</span>
        </div>
        <div class="panel-actions">
          <button class="btn btn-secondary btn-sm" onclick={handleCancelReceipt} id="btn-cancel-receipt" disabled={isActionLoading}>
            取消此單
          </button>
          <button class="btn btn-success" onclick={handlePostReceipt} id="btn-post-receipt" disabled={isActionLoading || draftAllocCount === 0 || hasDraftAllocationErrors}>
            確認過帳 ({draftAllocCount} 筆 / {formatCurrency(draftTotalAmount)})
          </button>
        </div>
      </div>

      <!-- Header Edit Form -->
      <div class="panel-body">
        <div class="form-grid">
          <div class="form-group">
            <label for="draft-header-customer">客戶名稱：</label>
            <input id="draft-header-customer" type="text" class="form-input bg-disabled" value={selectedReceipt.customer_name_snapshot} readonly disabled />
          </div>

          <div class="form-group">
            <label for="draft-header-date">收款日期：<span class="text-danger">*</span></label>
            <input
              type="date"
              id="draft-header-date"
              class="form-input"
              max={getTodayDateString()}
              bind:value={draftDate}
            />
          </div>

          <div class="form-group">
            <label for="draft-header-method">收款方式：<span class="text-danger">*</span></label>
            <select id="draft-header-method" class="form-select" bind:value={draftMethod}>
              <option value="bank_transfer">銀行轉帳</option>
              <option value="cash">現金</option>
              <option value="check">支票</option>
              <option value="other">其他</option>
            </select>
          </div>

          <div class="form-group">
            <label for="draft-header-ref">交易參考號：</label>
            <input
              type="text"
              id="draft-header-ref"
              class="form-input"
              placeholder="匯款單號 / 支票號碼..."
              bind:value={draftRef}
            />
          </div>

          <div class="form-group full-width">
            <label for="draft-header-note">備註說明：</label>
            <input
              type="text"
              id="draft-header-note"
              class="form-input"
              placeholder="選填備註..."
              bind:value={draftNote}
            />
          </div>
        </div>

        <div class="form-actions mt-2">
          <button class="btn btn-secondary btn-sm" onclick={handleSaveDraftHeader} id="btn-save-draft-header" disabled={isSavingHeader}>
            {isSavingHeader ? '儲存中...' : '更新表頭資訊'}
          </button>
        </div>
      </div>
    </div>

    <!-- Allocations Section -->
    <div class="panel mt-4">
      <div class="panel-header">
        <div class="panel-title">
          <h4>待核銷應收帳款明細</h4>
          <span class="text-sm text-muted">
            勾選並輸入欲核銷金額（系統已預設帶入當前未收餘額）
          </span>
        </div>
        <div class="allocation-summary">
          <span class="mr-4">已勾選：<strong>{draftAllocCount}</strong> 筆</span>
          <span>收款總額：<strong class="text-success font-mono font-lg">{formatCurrency(draftTotalAmount)}</strong></span>
        </div>
      </div>

      <div class="panel-body p-0">
        {#if candidateReceivables.length === 0}
          <div class="empty-state">
            此客戶目前無未結清之應收帳款（未收餘額皆為 0）
          </div>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th class="w-12 text-center">核銷</th>
                <th>來源單據</th>
                <th>單據號碼</th>
                <th>單據日</th>
                <th>到期日</th>
                <th class="text-right">應收金額</th>
                <th class="text-right">未收餘額</th>
                <th class="text-right w-48">本次核銷金額</th>
                <th>核銷狀態提示</th>
              </tr>
            </thead>
            <tbody>
              {#each candidateReceivables as ar (ar.id)}
                {@const alloc = draftAllocations[ar.id] || { selected: false, amount: ar.outstanding_amount, rawInput: String(ar.outstanding_amount), error: '' }}
                <tr class={alloc.selected ? 'row-selected' : ''}>
                  <td class="text-center">
                    <input
                      type="checkbox"
                      checked={alloc.selected}
                      onchange={() => handleToggleAllocation(ar)}
                      class="form-checkbox"
                      id={`chk-ar-${ar.id}`}
                    />
                  </td>
                  <td>
                    {#if ar.source_type === 'customer_invoice'}
                      <span class="badge badge-info">銷項發票</span>
                    {:else if ar.source_type === 'opening_balance'}
                      <span class="badge badge-secondary">期初應收</span>
                    {:else}
                      <span class="badge">{ar.source_type}</span>
                    {/if}
                  </td>
                  <td class="font-mono">{ar.source_number || '-'}</td>
                  <td>{ar.document_date || '-'}</td>
                  <td>{ar.due_date || '-'}</td>
                  <td class="text-right font-medium">{formatCurrency(ar.amount)}</td>
                  <td class="text-right font-mono font-medium text-warning">{formatCurrency(ar.outstanding_amount)}</td>
                  <td class="text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={ar.outstanding_amount}
                      class="form-input text-right font-mono {alloc.error ? 'input-error' : ''}"
                      value={alloc.rawInput}
                      disabled={!alloc.selected}
                      oninput={(e) => handleAllocationAmountChange(ar, e.target.value)}
                      id={`input-alloc-${ar.id}`}
                    />
                  </td>
                  <td>
                    {#if alloc.error}
                      <span class="text-danger text-sm font-medium">{alloc.error}</span>
                    {:else if alloc.selected}
                      {#if Number(alloc.amount) === Number(ar.outstanding_amount)}
                        <span class="badge badge-success">剛好收清</span>
                      {:else}
                        <span class="badge badge-info">部分核銷 (餘 {formatCurrency(ar.outstanding_amount - alloc.amount)})</span>
                      {/if}
                    {:else}
                      <span class="text-muted text-sm">未勾選</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>

  <!-- VIEW 3: DETAIL VIEW (POSTED / VOIDED / CANCELLED) -->
  {:else if viewMode === 'detail' && selectedReceipt}
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h3>
            收款單詳情：<span class="font-mono">{selectedReceipt.receipt_number}</span>
          </h3>
          <span class="badge {getStatusBadgeClass(selectedReceipt.status)}">
            {getStatusLabel(selectedReceipt.status)}
          </span>
        </div>
        <div class="panel-actions">
          {#if selectedReceipt.status === 'posted'}
            <button class="btn btn-danger" onclick={() => openVoidModal(selectedReceipt)} id="btn-open-void-modal">
              作廢此收款單
            </button>
          {/if}
        </div>
      </div>

      {#if selectedReceipt.status === 'voided'}
        <div class="alert alert-danger mb-4">
          <strong>此收款單已作廢</strong><br />
          作廢原因：{selectedReceipt.void_reason || '-'}<br />
          作廢時間：{formatTime(selectedReceipt.voided_at)}
        </div>
      {:else if selectedReceipt.status === 'cancelled'}
        <div class="alert alert-secondary mb-4">
          <strong>此收款單已取消</strong>
        </div>
      {/if}

      <div class="panel-body">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">客戶名稱</span>
            <span class="detail-val font-medium">{selectedReceipt.customer_name_snapshot}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">收款日期</span>
            <span class="detail-val">{selectedReceipt.receipt_date}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">收款方式</span>
            <span class="detail-val">{getMethodLabel(selectedReceipt.receipt_method)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">交易參考碼</span>
            <span class="detail-val font-mono">{selectedReceipt.receipt_reference || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">幣別</span>
            <span class="detail-val">{selectedReceipt.currency || 'TWD'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">收款總額</span>
            <span class="detail-val font-mono font-lg text-success font-bold">
              {formatCurrency(selectedReceipt.total_amount)}
            </span>
          </div>
          <div class="detail-item full-width">
            <span class="detail-label">備註</span>
            <span class="detail-val">{selectedReceipt.note || '-'}</span>
          </div>
        </div>

        <h4 class="mt-6 mb-2">已核銷應收帳款明細 ({selectedReceipt.allocations?.length || 0} 筆)</h4>
        <div class="table-container p-0">
          <table class="data-table">
            <thead>
              <tr>
                <th>來源單據</th>
                <th>單據號碼</th>
                <th>單據日</th>
                <th>到期日</th>
                <th class="text-right">原始應收金額</th>
                <th class="text-right">核銷金額</th>
              </tr>
            </thead>
            <tbody>
              {#if !selectedReceipt.allocations || selectedReceipt.allocations.length === 0}
                <tr>
                  <td colspan="6" class="text-center text-muted py-4">無核銷明細</td>
                </tr>
              {:else}
                {#each selectedReceipt.allocations as a}
                  <tr>
                    <td>
                      {#if a.source_type === 'customer_invoice'}
                        <span class="badge badge-info">銷項發票</span>
                      {:else if a.source_type === 'opening_balance'}
                        <span class="badge badge-secondary">期初應收</span>
                      {:else}
                        <span class="badge">{a.source_type || '-'}</span>
                      {/if}
                    </td>
                    <td class="font-mono">{a.source_number || '-'}</td>
                    <td>{a.document_date || '-'}</td>
                    <td>{a.due_date || '-'}</td>
                    <td class="text-right font-medium">{formatCurrency(a.ar_amount || a.amount)}</td>
                    <td class="text-right font-mono font-bold text-success">{formatCurrency(a.amount)}</td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- MODAL 1: CREATE RECEIPT DRAFT -->
{#if isCreateModalOpen}
  <div class="modal-backdrop" onclick={closeCreateModal} onkeydown={(e) => e.key === 'Escape' && closeCreateModal()} role="presentation">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>新增客戶收款單</h3>
        <button class="btn-close" onclick={closeCreateModal}>×</button>
      </div>

      {#if newReceiptError}
        <div class="alert alert-danger mx-4 my-2">
          {newReceiptError}
        </div>
      {/if}

      <form onsubmit={(e) => { e.preventDefault(); handleCreateReceiptSubmit(); }}>
        <div class="modal-body">
          <div class="form-group">
            <label for="select-receipt-customer">選擇客戶：<span class="text-danger">*</span></label>
            <select id="select-receipt-customer" class="form-select" bind:value={newCustomerId} required>
              {#each customers as c}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="input-receipt-date">收款日期：<span class="text-danger">*</span></label>
            <input
              type="date"
              id="input-receipt-date"
              class="form-input"
              max={getTodayDateString()}
              bind:value={newReceiptDate}
              required
            />
            <span class="form-hint">不可晚於今天</span>
          </div>

          <div class="form-group">
            <label for="select-receipt-method">收款方式：<span class="text-danger">*</span></label>
            <select id="select-receipt-method" class="form-select" bind:value={newReceiptMethod} required>
              <option value="bank_transfer">銀行轉帳</option>
              <option value="cash">現金</option>
              <option value="check">支票</option>
              <option value="other">其他</option>
            </select>
          </div>

          <div class="form-group">
            <label for="input-receipt-ref">交易參考號：</label>
            <input
              type="text"
              id="input-receipt-ref"
              class="form-input"
              placeholder="例如匯款後五碼、支票號碼..."
              bind:value={newReceiptRef}
            />
          </div>

          <div class="form-group">
            <label for="input-receipt-note">備註：</label>
            <input
              type="text"
              id="input-receipt-note"
              class="form-input"
              placeholder="選填備註說明..."
              bind:value={newReceiptNote}
            />
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={closeCreateModal}>取消</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-create-receipt" disabled={isCreatingReceipt}>
            {isCreatingReceipt ? '建立中...' : '建立收款草稿'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- MODAL 2: VOID RECEIPT MODAL -->
{#if isVoidModalOpen && voidTargetReceipt}
  <div class="modal-backdrop" onclick={closeVoidModal} onkeydown={(e) => e.key === 'Escape' && closeVoidModal()} role="presentation">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" id="void-receipt-modal">
      <div class="modal-header">
        <h3 class="text-danger">作廢收款單</h3>
        <button class="btn-close" onclick={closeVoidModal}>×</button>
      </div>

      {#if voidError}
        <div class="alert alert-danger mx-4 my-2">
          {voidError}
        </div>
      {/if}

      <form onsubmit={(e) => { e.preventDefault(); handleVoidSubmit(); }}>
        <div class="modal-body">
          <p class="mb-2">
            確定要作廢收款單「<strong class="font-mono">{voidTargetReceipt.receipt_number}</strong>」嗎？
          </p>
          <p class="text-sm text-danger mb-4">
            作廢後，該單所核銷之應收帳款（共 {voidTargetReceipt.allocation_count ?? voidTargetReceipt.allocations?.length ?? 0} 筆，總額 {formatCurrency(voidTargetReceipt.total_amount)}）將即時全數恢復未收餘額與結案狀態。
          </p>

          <div class="form-group">
            <label for="input-void-reason">作廢原因：<span class="text-danger">*</span></label>
            <input
              type="text"
              id="input-void-reason"
              class="form-input"
              placeholder="請務必填寫作廢原因..."
              bind:value={voidReason}
              required
            />
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={closeVoidModal}>取消</button>
          <button type="submit" class="btn btn-danger" id="btn-confirm-void-receipt" disabled={isVoiding || !voidReason.trim()}>
            {isVoiding ? '作廢中...' : '確認作廢'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .workspace-container {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
    font-family: inherit;
  }

  .workspace-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .header-title h2 {
    margin: 0 0 0.25rem 0;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .subtitle {
    margin: 0;
    color: var(--color-text-muted, #64748b);
    font-size: 0.875rem;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    padding: 1rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--color-text-muted, #64748b);
    text-transform: uppercase;
    font-weight: 600;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    margin-top: 0.25rem;
  }

  .stat-hint {
    font-size: 0.75rem;
    color: var(--color-text-muted, #64748b);
    margin-top: 0.25rem;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .filters {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .table-container {
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    text-align: left;
  }

  .data-table th, .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
  }

  .data-table th {
    background: var(--color-surface-subtle, #f8fafc);
    font-weight: 600;
    color: var(--color-text-muted, #64748b);
  }

  .data-table tbody tr:hover {
    background: var(--color-surface-hover, #f1f5f9);
  }

  .row-selected {
    background: #f0fdf4 !important;
  }

  .panel {
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
  }

  .panel-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .panel-title h3, .panel-title h4 {
    margin: 0;
  }

  .panel-body {
    padding: 1.25rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .form-group label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted, #64748b);
  }

  .form-input, .form-select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border, #cbd5e1);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: #ffffff;
  }

  .form-input:focus, .form-select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 1px #3b82f6;
  }

  .input-error {
    border-color: #ef4444 !important;
    background: #fef2f2 !important;
  }

  .form-checkbox {
    width: 1.125rem;
    height: 1.125rem;
    cursor: pointer;
  }

  .full-width {
    grid-column: 1 / -1;
  }

  .bg-disabled {
    background: #f1f5f9;
    cursor: not-allowed;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .detail-label {
    font-size: 0.75rem;
    color: var(--color-text-muted, #64748b);
    font-weight: 600;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-sm {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .btn-primary {
    background: #2563eb;
    color: #ffffff;
  }
  .btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-secondary {
    background: #ffffff;
    border-color: #cbd5e1;
    color: #334155;
  }
  .btn-secondary:hover:not(:disabled) {
    background: #f8fafc;
  }

  .btn-success {
    background: #16a34a;
    color: #ffffff;
  }
  .btn-success:hover:not(:disabled) {
    background: #15803d;
  }

  .btn-danger {
    background: #dc2626;
    color: #ffffff;
  }
  .btn-danger:hover:not(:disabled) {
    background: #b91c1c;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-action {
    background: none;
    border: none;
    color: #2563eb;
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
  }
  .btn-action:hover {
    text-decoration: underline;
  }

  .link-btn {
    background: none;
    border: none;
    color: #2563eb;
    cursor: pointer;
    font-weight: 500;
    padding: 0;
  }
  .link-btn:hover {
    text-decoration: underline;
  }

  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge-warning { background: #fef3c7; color: #92400e; }
  .badge-success { background: #dcfce7; color: #166534; }
  .badge-danger { background: #fee2e2; color: #991b1b; }
  .badge-secondary { background: #f1f5f9; color: #475569; }
  .badge-info { background: #e0f2fe; color: #075985; }

  .alert {
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
  }
  .alert-danger { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .alert-secondary { background: #f8fafc; border: 1px solid #e2e8f0; color: #475569; }

  .btn-close {
    background: none;
    border: none;
    font-size: 1.25rem;
    cursor: pointer;
    color: inherit;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-text-muted, #64748b);
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 0.5rem;
    width: 100%;
    max-width: 520px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
  }
  .modal-header h3 { margin: 0; font-size: 1.125rem; }

  .modal-body {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
    border-bottom-left-radius: 0.5rem;
    border-bottom-right-radius: 0.5rem;
  }

  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .font-medium { font-weight: 500; }
  .font-bold { font-weight: 700; }
  .font-lg { font-size: 1.125rem; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .text-muted { color: #64748b; }
  .text-danger { color: #dc2626; }
  .text-warning { color: #d97706; }
  .text-success { color: #16a34a; }
  .text-primary { color: #2563eb; }
  .text-sm { font-size: 0.75rem; }
  .mt-2 { margin-top: 0.5rem; }
  .mt-4 { margin-top: 1rem; }
  .mt-6 { margin-top: 1.5rem; }
  .mb-2 { margin-bottom: 0.5rem; }
  .mb-4 { margin-bottom: 1rem; }
  .mr-4 { margin-right: 1rem; }
  .p-0 { padding: 0 !important; }
  .w-12 { width: 3rem; }
  .w-48 { width: 12rem; }
</style>
