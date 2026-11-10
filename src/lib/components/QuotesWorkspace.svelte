<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    formatCurrency,
    formatTime,
    fetchPartners,
    fetchProducts,
    fetchQuotes,
    fetchQuoteDetail,
    fetchPendingApprovalQuotes,
    createQuoteAction,
    updateQuoteHeaderAction,
    addQuoteLineAction,
    updateQuoteLineAction,
    deleteQuoteLineAction,
    submitQuoteAction,
    withdrawQuoteApprovalAction,
    approveQuoteAction,
    rejectQuoteAction,
    declineQuoteAction,
    convertQuoteAction,
    cancelQuoteAction
  } from '../store.svelte.js';
  import { invoke } from '../tauri.js';

  // Sub tab / view mode: 'list' | 'detail'
  let viewMode = $state('list');

  // Filters
  let filterStatus = $state('all');
  let filterCustomerId = $state('');
  let isLoading = $state(false);
  let errorMsg = $state('');

  // Auxiliary data
  let availableCustomers = $derived(
    (appState.partners || []).filter(p => 
      (p.is_customer === true || p.is_customer === 1 || p.is_customer) &&
      p.is_active !== false &&
      p.is_active !== 0
    )
  );

  // Flattened sellable units for line item selection
  let availableSellableUnits = $state([]);

  async function loadSellableUnits() {
    try {
      const products = await fetchProducts();
      const uList = [];
      for (const prod of (products || [])) {
        if (prod.is_sellable === false || prod.is_sellable === 0) continue;
        // Check if units are attached directly (Mock)
        if (prod.variants && prod.variants.length > 0 && prod.variants[0].units) {
          for (const variant of prod.variants) {
            for (const unit of (variant.units || [])) {
              uList.push({
                unit_id: unit.id,
                product_id: prod.id,
                product_name: prod.name,
                variant_name: variant.name,
                unit_name: unit.name || unit.unit_name,
                selling_price: unit.selling_price || unit.sell_price || 0,
                label: `${prod.name} (${variant.name}) - ${unit.name || unit.unit_name} [標準價: ${unit.selling_price ?? 0}]`
              });
            }
          }
        } else {
          // Fetch product detail for Rust backend
          try {
            const detail = await invoke('get_product_detail', { product_id: prod.id, productId: prod.id });
            const variantMap = new Map((detail.variants || []).map(v => [v.id, v.name]));
            for (const u of (detail.units || [])) {
              const vName = variantMap.get(u.variant_id) || '標準';
              const price = u.selling_price !== undefined ? u.selling_price : (u.sell_price || 0);
              uList.push({
                unit_id: u.id,
                product_id: prod.id,
                product_name: prod.name,
                variant_name: vName,
                unit_name: u.unit_name,
                selling_price: price,
                label: `${prod.name} (${vName}) - ${u.unit_name} [標準價: ${price}]`
              });
            }
          } catch (e) {
            console.warn('Failed to load detail for product:', prod.id, e);
          }
        }
      }
      availableSellableUnits = uList;
    } catch (e) {
      console.warn('Failed to load sellable units:', e);
    }
  }

  // Current selected quote detail
  let currentDetail = $state(null);
  let isDetailLoading = $state(false);
  let detailError = $state('');

  // Modals state
  let isCreateModalOpen = $state(false);
  let createCustomerId = $state('');
  let createValidUntil = $state(getDefaultValidUntil());
  let createCurrency = $state('TWD');
  let createPoNumber = $state('');
  let createNote = $state('');
  let createError = $state('');
  let isCreating = $state(false);

  // Header editing state (draft only)
  let isEditingHeader = $state(false);
  let editCustomerId = $state('');
  let editValidUntil = $state('');
  let editPoNumber = $state('');
  let editNote = $state('');
  let isSavingHeader = $state(false);

  // Add line state (draft only)
  let newLineUnitId = $state('');
  let newLineQuantity = $state(1);
  let newLineUnitPrice = $state(0);
  let newLineNotes = $state('');
  let isAddingLine = $state(false);
  let lineError = $state('');

  // Edit line modal state
  let editingLine = $state(null);
  let editLineQuantity = $state(1);
  let editLineUnitPrice = $state(0);
  let editLineNotes = $state('');
  let isSavingLine = $state(false);

  // Generic Prompt / Action Modal
  // actionType: 'withdraw' | 'approve' | 'reject' | 'decline' | 'convert' | 'cancel'
  let isActionModalOpen = $state(false);
  let actionModalType = $state('');
  let actionModalTitle = $state('');
  let actionModalPrompt = $state('');
  let actionModalInputVal = $state('');
  let actionModalInputRequired = $state(false);
  let actionModalInputLabel = $state('');
  let actionModalInputPlaceholder = $state('');
  let actionModalError = $state('');
  let isSubmittingAction = $state(false);

  function getDefaultValidUntil() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }

  function getTodayString() {
    return new Date().toISOString().slice(0, 10);
  }

  onMount(async () => {
    isLoading = true;
    try {
      await Promise.all([
        fetchPartners(),
        loadSellableUnits(),
        loadQuotesList()
      ]);
    } catch (e) {
      errorMsg = e.message || String(e);
    } finally {
      isLoading = false;
    }
  });

  async function loadQuotesList() {
    try {
      await fetchQuotes({
        status: filterStatus === 'all' ? undefined : filterStatus,
        customer_partner_id: filterCustomerId || undefined
      });
    } catch (e) {
      errorMsg = e.message || String(e);
    }
  }

  async function handleFilterChange() {
    isLoading = true;
    errorMsg = '';
    try {
      await loadQuotesList();
    } finally {
      isLoading = false;
    }
  }

  async function openDetail(quoteId) {
    isDetailLoading = true;
    detailError = '';
    viewMode = 'detail';
    try {
      if (availableSellableUnits.length === 0) {
        loadSellableUnits();
      }
      currentDetail = await fetchQuoteDetail(quoteId);
      isEditingHeader = false;
      newLineUnitId = '';
      newLineQuantity = 1;
      newLineUnitPrice = 0;
      newLineNotes = '';
      editingLine = null;
    } catch (e) {
      detailError = e.message || String(e);
    } finally {
      isDetailLoading = false;
    }
  }

  function backToList() {
    viewMode = 'list';
    currentDetail = null;
    loadQuotesList();
  }

  // Create Quote
  async function openCreateModal() {
    if (!appState.partners || appState.partners.length === 0) {
      try {
        await fetchPartners();
      } catch (e) {
        console.warn('Failed to fetch partners:', e);
      }
    }
    createCustomerId = availableCustomers.length > 0 ? availableCustomers[0].id : '';
    createValidUntil = getDefaultValidUntil();
    createCurrency = 'TWD';
    createPoNumber = '';
    createNote = '';
    createError = '';
    isCreateModalOpen = true;
  }

  async function handleCreateQuote(e) {
    if (e) e.preventDefault();
    if (!createCustomerId) {
      createError = '請選擇客戶';
      return;
    }
    if (!createValidUntil) {
      createError = '請輸入有效期限';
      return;
    }
    isCreating = true;
    createError = '';
    try {
      const res = await createQuoteAction({
        customer_partner_id: createCustomerId,
        valid_until: createValidUntil,
        note: createNote || undefined,
        customer_po_number: createPoNumber || undefined
      });
      isCreateModalOpen = false;
      showToast(`報價單 ${res.quote.quote_number} 建立成功`);
      await openDetail(res.quote.id);
    } catch (e) {
      createError = e.message || String(e);
    } finally {
      isCreating = false;
    }
  }

  // Edit Header
  function startEditHeader() {
    if (!currentDetail) return;
    const q = currentDetail.quote;
    editCustomerId = q.customer_partner_id;
    editValidUntil = q.valid_until;
    editPoNumber = q.customer_po_number || '';
    editNote = q.note || '';
    isEditingHeader = true;
  }

  function cancelEditHeader() {
    isEditingHeader = false;
  }

  async function handleSaveHeader() {
    if (!currentDetail) return;
    isSavingHeader = true;
    detailError = '';
    try {
      const updated = await updateQuoteHeaderAction({
        quote_id: currentDetail.quote.id,
        customer_partner_id: editCustomerId,
        valid_until: editValidUntil,
        customer_po_number: editPoNumber || null,
        note: editNote || null
      });
      currentDetail = updated;
      isEditingHeader = false;
      showToast('表頭資訊已更新');
    } catch (e) {
      detailError = e.message || String(e);
    } finally {
      isSavingHeader = false;
    }
  }

  // Unit selection auto-fill selling price
  function handleUnitChange(e) {
    const uid = e.target.value;
    newLineUnitId = uid;
    const selected = availableSellableUnits.find(u => u.unit_id === uid);
    if (selected) {
      newLineUnitPrice = selected.selling_price;
    }
  }

  // Add Line Item
  async function handleAddLine(e) {
    if (e) e.preventDefault();
    if (!currentDetail) return;
    if (!newLineUnitId) {
      lineError = '請選擇商品單位';
      return;
    }
    if (newLineQuantity <= 0) {
      lineError = '數量必須大於 0';
      return;
    }
    if (newLineUnitPrice < 0) {
      lineError = '單價不可為負數';
      return;
    }

    isAddingLine = true;
    lineError = '';
    try {
      const updated = await addQuoteLineAction({
        quote_id: currentDetail.quote.id,
        unit_id: newLineUnitId,
        quantity: newLineQuantity,
        unit_price: newLineUnitPrice,
        note: newLineNotes || undefined
      });
      currentDetail = updated;
      newLineUnitId = '';
      newLineQuantity = 1;
      newLineUnitPrice = 0;
      newLineNotes = '';
      showToast('品項已加入');
    } catch (e) {
      lineError = e.message || String(e);
    } finally {
      isAddingLine = false;
    }
  }

  // Edit Line Item
  function startEditLine(line) {
    editingLine = line;
    editLineQuantity = line.quantity;
    editLineUnitPrice = line.unit_price;
    editLineNotes = line.note || line.notes || '';
  }

  function cancelEditLine() {
    editingLine = null;
  }

  async function handleSaveLine() {
    if (!currentDetail || !editingLine) return;
    if (editLineQuantity <= 0) {
      showToast('數量必須大於 0');
      return;
    }
    if (editLineUnitPrice < 0) {
      showToast('單價不可為負數');
      return;
    }

    isSavingLine = true;
    detailError = '';
    try {
      const updated = await updateQuoteLineAction({
        quote_id: currentDetail.quote.id,
        line_id: editingLine.id,
        quantity: editLineQuantity,
        unit_price: editLineUnitPrice,
        note: editLineNotes || null
      });
      currentDetail = updated;
      editingLine = null;
      showToast('品項已更新');
    } catch (e) {
      detailError = e.message || String(e);
    } finally {
      isSavingLine = false;
    }
  }

  // Delete Line Item
  async function handleDeleteLine(lineId) {
    if (!currentDetail) return;
    detailError = '';
    try {
      const updated = await deleteQuoteLineAction({
        quote_id: currentDetail.quote.id,
        line_id: lineId
      });
      currentDetail = updated;
      showToast('品項已刪除');
    } catch (e) {
      detailError = e.message || String(e);
    }
  }

  // Lifecycle Action Handlers
  async function handleSubmitQuote() {
    if (!currentDetail) return;
    detailError = '';
    try {
      const updated = await submitQuoteAction({
        quote_id: currentDetail.quote.id
      });
      currentDetail = updated;
      if (updated.quote.status === 'pending_approval') {
        showToast(updated.message || '報價單含低於標準價品項，已送出並進入待核准審核');
      } else {
        showToast(updated.message || '報價單已成功送出');
      }
    } catch (e) {
      detailError = e.message || String(e);
    }
  }

  function openActionModal(type) {
    actionModalType = type;
    actionModalInputVal = '';
    actionModalError = '';
    isActionModalOpen = true;

    if (type === 'withdraw') {
      actionModalTitle = '撤回送審確認';
      actionModalPrompt = '您確定要撤回此報價單的審核申請嗎？撤回後將退回草稿狀態。';
      actionModalInputLabel = '撤回原因（選填）';
      actionModalInputPlaceholder = '請輸入撤回原因...';
      actionModalInputRequired = false;
    } else if (type === 'approve') {
      actionModalTitle = '主管核准確認';
      actionModalPrompt = '確認核准此報價單？核准後狀態將轉為已送出 (sent)。';
      actionModalInputLabel = '核准備註（選填）';
      actionModalInputPlaceholder = '請輸入核准備註...';
      actionModalInputRequired = false;
    } else if (type === 'reject') {
      actionModalTitle = '主管駁回確認';
      actionModalPrompt = '駁回此報價單，請務必填寫駁回理由，報價單將退回草稿狀態。';
      actionModalInputLabel = '駁回理由（必填）';
      actionModalInputPlaceholder = '例如：折讓幅度過高，請重新調整單價...';
      actionModalInputRequired = true;
    } else if (type === 'decline') {
      actionModalTitle = '標記客戶拒絕';
      actionModalPrompt = '標記客戶已拒絕此報價單，狀態將變更為已拒絕 (declined) 並結案。';
      actionModalInputLabel = '客戶拒絕理由（選填）';
      actionModalInputPlaceholder = '例如：預算不足、選用其他廠商...';
      actionModalInputRequired = false;
    } else if (type === 'convert') {
      actionModalTitle = '轉為銷售訂單';
      actionModalPrompt = '客戶已確認報價，將此報價單標記為已轉單 (converted) 並結案。';
      actionModalInputLabel = '銷售訂單編號（選填）';
      actionModalInputPlaceholder = '例如：SO-2026-0001...';
      actionModalInputRequired = false;
    } else if (type === 'cancel') {
      actionModalTitle = '取消報價單確認';
      actionModalPrompt = '您確定要取消此報價單嗎？取消後將結案且不可再次修改。請填寫取消理由：';
      actionModalInputLabel = '取消理由（必填）';
      actionModalInputPlaceholder = '請輸入取消理由，例如：客戶需求變更、重複開單...';
      actionModalInputRequired = true;
    }
  }

  async function handleExecuteActionModal() {
    if (!currentDetail) return;
    const qId = currentDetail.quote.id;
    if (actionModalInputRequired && !actionModalInputVal.trim()) {
      actionModalError = `${actionModalInputLabel}為必填項目`;
      return;
    }

    isSubmittingAction = true;
    actionModalError = '';
    try {
      let updated = null;
      if (actionModalType === 'withdraw') {
        updated = await withdrawQuoteApprovalAction({
          quote_id: qId,
          reason: actionModalInputVal.trim() || undefined
        });
        showToast('已撤回送審，報價單退回草稿');
      } else if (actionModalType === 'approve') {
        updated = await approveQuoteAction({
          quote_id: qId,
          reason: actionModalInputVal.trim() || undefined
        });
        showToast('報價單已核准並送出');
      } else if (actionModalType === 'reject') {
        updated = await rejectQuoteAction({
          quote_id: qId,
          reason: actionModalInputVal.trim()
        });
        showToast('報價單已駁回並退回草稿');
      } else if (actionModalType === 'decline') {
        updated = await declineQuoteAction({
          quote_id: qId,
          reason: actionModalInputVal.trim() || undefined
        });
        showToast('報價單已標記為客戶拒絕');
      } else if (actionModalType === 'convert') {
        updated = await convertQuoteAction({
          quote_id: qId,
          sales_order_id: actionModalInputVal.trim() || undefined
        });
        showToast('報價單已成功轉單結案');
      } else if (actionModalType === 'cancel') {
        updated = await cancelQuoteAction({
          quote_id: qId,
          reason: actionModalInputVal.trim()
        });
        showToast('報價單已取消');
      }

      currentDetail = updated;
      isActionModalOpen = false;
    } catch (e) {
      actionModalError = e.message || String(e);
    } finally {
      isSubmittingAction = false;
    }
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'draft': return 'badge-status-draft';
      case 'pending_approval': return 'badge-status-pending';
      case 'sent': return 'badge-status-sent';
      case 'converted': return 'badge-status-converted';
      case 'declined': return 'badge-status-declined';
      case 'expired': return 'badge-status-expired';
      case 'cancelled': return 'badge-status-cancelled';
      default: return 'badge-status-default';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'draft': return '草稿';
      case 'pending_approval': return '待核准';
      case 'sent': return '已送出';
      case 'converted': return '已轉單';
      case 'declined': return '已拒絕';
      case 'expired': return '已過期';
      case 'cancelled': return '已取消';
      default: return status || '未知';
    }
  }
</script>

<div class="quotes-workspace-container">
  <!-- Top Workspace Header -->
  <header class="workspace-header">
    <div class="header-title-row">
      <div class="header-left">
        <h2>報價管理</h2>
        <span class="header-subtitle">Sales Quotes Management</span>
      </div>
      <div class="header-actions">
        {#if viewMode === 'detail'}
          <button class="btn btn-secondary" onclick={backToList}>
            ← 返回清單
          </button>
        {/if}
        <button class="btn btn-primary" onclick={openCreateModal} id="btn-create-quote">
          ＋ 建立報價單
        </button>
      </div>
    </div>

    <!-- Filter Bar (when in list mode) -->
    {#if viewMode === 'list'}
      <div class="filter-bar glass-panel">
        <div class="filter-group">
          <label for="filter-status">狀態篩選</label>
          <select 
            id="filter-status" 
            bind:value={filterStatus} 
            onchange={handleFilterChange}
            class="input-select"
          >
            <option value="all">全部狀態</option>
            <option value="draft">草稿 (draft)</option>
            <option value="pending_approval">待核准 (pending_approval)</option>
            <option value="sent">已送出 (sent)</option>
            <option value="converted">已轉單 (converted)</option>
            <option value="declined">已拒絕 (declined)</option>
            <option value="expired">已過期 (expired)</option>
            <option value="cancelled">已取消 (cancelled)</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filter-customer">客戶篩選</label>
          <select 
            id="filter-customer" 
            bind:value={filterCustomerId} 
            onchange={handleFilterChange}
            class="input-select"
          >
            <option value="">全部客戶</option>
            {#each availableCustomers as cust}
              <option value={cust.id}>{cust.name}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}
  </header>

  <!-- Error feedback -->
  {#if errorMsg}
    <div class="alert alert-danger">
      <span>{errorMsg}</span>
      <button class="btn-close" onclick={() => errorMsg = ''}>✕</button>
    </div>
  {/if}

  <!-- View Mode 1: Quotes List -->
  {#if viewMode === 'list'}
    <div class="list-section">
      {#if isLoading}
        <div class="loading-state">載入報價清單中...</div>
      {:else if appState.quotes.length === 0}
        <div class="empty-state glass-panel">
          <p>查無符合條件的報價單</p>
          <button class="btn btn-primary" onclick={openCreateModal}>立刻建立第一筆報價單</button>
        </div>
      {:else}
        <div class="table-container glass-panel">
          <table class="quotes-table">
            <thead>
              <tr>
                <th>報價單號</th>
                <th>客戶名稱</th>
                <th>有效日期</th>
                <th>幣別</th>
                <th>總金額</th>
                <th>狀態</th>
                <th>提示 / 理由</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each appState.quotes as quote (quote.id)}
                <tr class="quote-row" onclick={() => openDetail(quote.id)}>
                  <td class="font-bold quote-number-cell">{quote.quote_number}</td>
                  <td>{quote.customer_name_snapshot || '—'}</td>
                  <td>{quote.valid_until || '—'}</td>
                  <td>{quote.currency}</td>
                  <td class="amount-cell">{formatCurrency(quote.total_amount)}</td>
                  <td>
                    <span class="badge {getStatusBadgeClass(quote.status)}">
                      {getStatusLabel(quote.status)}
                    </span>
                  </td>
                  <td>
                    {#if quote.status === 'draft' && quote.approval_rejection_reason}
                      <span class="badge badge-rejection-warn" title={quote.approval_rejection_reason}>
                        ⚠️ 駁回：{quote.approval_rejection_reason}
                      </span>
                    {:else if quote.status === 'pending_approval'}
                      <span class="text-amber">待主管核准</span>
                    {:else if quote.status === 'declined' && quote.decline_reason}
                      <span class="text-muted">拒絕：{quote.decline_reason}</span>
                    {:else if quote.status === 'cancelled' && quote.cancel_reason}
                      <span class="text-muted">取消：{quote.cancel_reason}</span>
                    {:else}
                      <span class="text-muted">—</span>
                    {/if}
                  </td>
                  <td>
                    <button 
                      class="btn btn-sm btn-ghost" 
                      onclick={(e) => { e.stopPropagation(); openDetail(quote.id); }}
                    >
                      檢視
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- View Mode 2: Quote Detail & Edit -->
  {#if viewMode === 'detail'}
    {#if isDetailLoading}
      <div class="loading-state">載入報價單詳細資訊中...</div>
    {:else if detailError}
      <div class="alert alert-danger">{detailError}</div>
    {:else if currentDetail}
      {@const q = currentDetail.quote}
      {@const isDraft = q.status === 'draft'}
      {@const isPending = q.status === 'pending_approval'}
      {@const isSent = q.status === 'sent'}
      {@const isTerminal = ['converted', 'declined', 'expired', 'cancelled'].includes(q.status)}

      <div class="detail-container">
        <!-- Rejection Alert Banner on Draft -->
        {#if isDraft && q.approval_rejection_reason}
          <div class="rejection-callout glass-panel" id="rejection-reason-banner">
            <div class="callout-icon">⚠️</div>
            <div class="callout-body">
              <div class="callout-title">最近一次審核駁回理由</div>
              <div class="callout-content">{q.approval_rejection_reason}</div>
            </div>
          </div>
        {/if}

        <!-- Cancellation Alert Banner on Cancelled -->
        {#if q.status === 'cancelled' && q.cancel_reason}
          <div class="rejection-callout glass-panel rejection-callout-muted" id="cancel-reason-banner">
            <div class="callout-icon">🚫</div>
            <div class="callout-body">
              <div class="callout-title">報價單取消理由</div>
              <div class="callout-content">{q.cancel_reason}</div>
            </div>
          </div>
        {/if}

        <!-- Header Card -->
        <div class="quote-header-card glass-panel">
          <div class="card-top-row">
            <div class="quote-id-block">
              <span class="quote-number-title">{q.quote_number}</span>
              <span class="badge {getStatusBadgeClass(q.status)}">
                {getStatusLabel(q.status)}
              </span>
            </div>
            <div class="quote-actions-row">
              {#if isDraft}
                {#if !isEditingHeader}
                  <button class="btn btn-secondary btn-sm" onclick={startEditHeader}>
                    編輯表頭
                  </button>
                {/if}
                <button class="btn btn-primary" onclick={handleSubmitQuote} id="btn-submit-quote">
                  送出報價
                </button>
                <button class="btn btn-danger btn-sm" onclick={() => openActionModal('cancel')} id="btn-cancel-quote">
                  取消報價
                </button>
              {:else if isPending}
                <button class="btn btn-secondary" onclick={() => openActionModal('withdraw')} id="btn-withdraw-approval">
                  撤回送審
                </button>
                <button class="btn btn-primary" onclick={() => openActionModal('approve')} id="btn-approve-quote">
                  核准
                </button>
                <button class="btn btn-danger" onclick={() => openActionModal('reject')} id="btn-reject-quote">
                  駁回
                </button>
              {:else if isSent}
                <button class="btn btn-warning" onclick={() => openActionModal('decline')} id="btn-decline-quote">
                  標記客戶拒絕
                </button>
                <button class="btn btn-primary" onclick={() => openActionModal('convert')} id="btn-convert-quote">
                  轉為銷售訂單
                </button>
                <button class="btn btn-danger btn-sm" onclick={() => openActionModal('cancel')} id="btn-cancel-quote">
                  取消報價
                </button>
              {:else if isTerminal}
                <span class="terminal-tag">結案唯讀 (Terminal)</span>
              {/if}
            </div>
          </div>

          <!-- Header details or editing form -->
          {#if isEditingHeader}
            <div class="header-edit-form">
              <div class="form-row">
                <div class="form-group">
                  <label for="edit-customer">客戶</label>
                  <select id="edit-customer" bind:value={editCustomerId} class="input-select">
                    {#each availableCustomers as cust}
                      <option value={cust.id}>{cust.name}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-group">
                  <label for="edit-valid-until">有效期限</label>
                  <input id="edit-valid-until" type="date" bind:value={editValidUntil} class="input-text" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="edit-po-number">客戶 PO 號</label>
                  <input id="edit-po-number" type="text" bind:value={editPoNumber} placeholder="選填" class="input-text" />
                </div>
                <div class="form-group">
                  <label for="edit-note">備註</label>
                  <input id="edit-note" type="text" bind:value={editNote} placeholder="選填" class="input-text" />
                </div>
              </div>
              <div class="form-actions">
                <button class="btn btn-secondary btn-sm" onclick={cancelEditHeader} disabled={isSavingHeader}>取消</button>
                <button class="btn btn-primary btn-sm" onclick={handleSaveHeader} disabled={isSavingHeader}>
                  {isSavingHeader ? '儲存中...' : '儲存表頭'}
                </button>
              </div>
            </div>
          {:else}
            <div class="header-info-grid">
              <div class="info-item">
                <span class="info-label">往來客戶</span>
                <span class="info-value font-bold">{q.customer_name_snapshot}</span>
              </div>
              <div class="info-item">
                <span class="info-label">有效期限</span>
                <span class="info-value">{q.valid_until}</span>
              </div>
              <div class="info-item">
                <span class="info-label">客戶採購單號 (PO)</span>
                <span class="info-value">{q.customer_po_number || '—'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">報價總計金額</span>
                <span class="info-value amount-total">{q.currency} {formatCurrency(currentDetail.total_amount)}</span>
              </div>
              {#if q.note}
                <div class="info-item full-width">
                  <span class="info-label">備註說明</span>
                  <span class="info-value">{q.note}</span>
                </div>
              {/if}
              {#if q.decline_reason}
                <div class="info-item full-width">
                  <span class="info-label">客戶拒絕理由</span>
                  <span class="info-value text-rose">{q.decline_reason}</span>
                </div>
              {/if}
              {#if q.converted_sales_order_id}
                <div class="info-item full-width">
                  <span class="info-label">轉入銷售訂單</span>
                  <span class="info-value text-emerald">{q.converted_sales_order_id}</span>
                </div>
              {/if}
              {#if q.cancel_reason}
                <div class="info-item full-width" id="quote-header-cancel-reason">
                  <span class="info-label">取消理由</span>
                  <span class="info-value text-muted">{q.cancel_reason}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Line Items Section -->
        <div class="quote-lines-card glass-panel">
          <div class="lines-header">
            <h3>報價品項明細</h3>
            <span class="lines-count">共 {currentDetail.lines.length} 項</span>
          </div>

          <!-- Add Line Item Form (Draft only) -->
          {#if isDraft}
            <form class="add-line-box" onsubmit={handleAddLine}>
              <div class="line-inputs-row">
                <div class="form-group flex-2">
                  <label for="new-line-unit">商品規格 / 單位</label>
                  <select 
                    id="new-line-unit" 
                    value={newLineUnitId} 
                    onchange={handleUnitChange} 
                    class="input-select"
                  >
                    <option value="">-- 請選擇商品單位 --</option>
                    {#each availableSellableUnits as item}
                      <option value={item.unit_id}>{item.label}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-group flex-1">
                  <label for="new-line-quantity">數量</label>
                  <input 
                    id="new-line-quantity" 
                    type="number" 
                    step="1" 
                    min="1" 
                    bind:value={newLineQuantity} 
                    class="input-text" 
                  />
                </div>
                <div class="form-group flex-1">
                  <label for="new-line-price">單價</label>
                  <input 
                    id="new-line-price" 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    bind:value={newLineUnitPrice} 
                    class="input-text" 
                  />
                </div>
                <div class="form-group flex-2">
                  <label for="new-line-notes">品項備註</label>
                  <input 
                    id="new-line-notes" 
                    type="text" 
                    bind:value={newLineNotes} 
                    placeholder="選填備註" 
                    class="input-text" 
                  />
                </div>
                <div class="form-group button-group">
                  <span class="label-spacer"></span>
                  <button type="submit" class="btn btn-primary" disabled={isAddingLine} id="btn-add-line">
                    {isAddingLine ? '加入中...' : '＋ 加入品項'}
                  </button>
                </div>
              </div>
              {#if lineError}
                <div class="line-error-msg">{lineError}</div>
              {/if}
            </form>
          {/if}

          <!-- Lines Table -->
          {#if currentDetail.lines.length === 0}
            <div class="empty-lines-state">
              尚未加入任何明細品項。請使用上方表單加入品項。
            </div>
          {:else}
            <div class="table-container">
              <table class="lines-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>商品名稱</th>
                    <th>規格</th>
                    <th>單位</th>
                    <th>數量</th>
                    <th>單價</th>
                    <th>標準價與對比差額</th>
                    <th>小計金額</th>
                    {#if isDraft}
                      <th>操作</th>
                    {/if}
                  </tr>
                </thead>
                <tbody>
                  {#each currentDetail.lines as line (line.id)}
                    {@const isBelow = line.unit_price < line.standard_price_snapshot || line.standard_price_snapshot <= 0}
                    {@const diff = line.unit_price - line.standard_price_snapshot}
                    {@const diffPct = line.standard_price_snapshot > 0 ? ((diff / line.standard_price_snapshot) * 100).toFixed(1) : '—'}

                    <tr>
                      <td class="text-muted">{line.line_no}</td>
                      <td class="font-bold">
                        {line.product_name_snapshot}
                        {#if line.note}
                          <div class="line-note-subtext text-muted font-normal">{line.note}</div>
                        {/if}
                      </td>
                      <td>{line.variant_name_snapshot || '單一規格'}</td>
                      <td>{line.unit_name_snapshot}</td>
                      <td>{line.quantity}</td>
                      <td class="amount-cell">{formatCurrency(line.unit_price)}</td>
                      <td>
                        <div class="price-comparison-box">
                          <span class="std-price">標準: {formatCurrency(line.standard_price_snapshot)}</span>
                          {#if isBelow}
                            <span class="badge badge-below-std">
                              低於標準價 ({diff < 0 ? '' : '+'}{formatCurrency(diff)} / {diffPct}%)
                            </span>
                          {:else}
                            <span class="badge badge-std-ok">合格</span>
                          {/if}
                        </div>
                      </td>
                      <td class="amount-cell font-bold">{formatCurrency(line.line_amount)}</td>
                      {#if isDraft}
                        <td>
                          <div class="action-btn-group">
                            <button class="btn btn-ghost btn-xs" onclick={() => startEditLine(line)}>
                              編輯
                            </button>
                            <button class="btn btn-danger-ghost btn-xs" onclick={() => handleDeleteLine(line.id)}>
                              刪除
                            </button>
                          </div>
                        </td>
                      {/if}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<!-- Modal 1: Create Quote Modal -->
{#if isCreateModalOpen}
  <div class="modal-backdrop">
    <div class="modal-dialog glass-panel">
      <div class="modal-header">
        <h3>建立報價單</h3>
        <button class="btn-close" onclick={() => isCreateModalOpen = false}>✕</button>
      </div>
      <form onsubmit={handleCreateQuote}>
        <div class="modal-body">
          <div class="form-group">
            <label for="create-customer">往來客戶 <span class="required">*</span></label>
            <select id="create-customer" bind:value={createCustomerId} class="input-select">
              <option value="">-- 請選擇客戶 --</option>
              {#each availableCustomers as cust}
                <option value={cust.id}>{cust.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label for="create-valid-until">有效期限 <span class="required">*</span></label>
            <input 
              id="create-valid-until" 
              type="date" 
              bind:value={createValidUntil} 
              min={getTodayString()}
              class="input-text" 
            />
          </div>
          <div class="form-group">
            <label for="create-currency">幣別</label>
            <input id="create-currency" type="text" bind:value={createCurrency} class="input-text" />
          </div>
          <div class="form-group">
            <label for="create-po-number">客戶採購單號 (PO)</label>
            <input 
              id="create-po-number" 
              type="text" 
              bind:value={createPoNumber} 
              placeholder="選填" 
              class="input-text" 
            />
          </div>
          <div class="form-group">
            <label for="create-note">備註說明</label>
            <textarea 
              id="create-note" 
              bind:value={createNote} 
              placeholder="選填備註..." 
              class="input-textarea"
            ></textarea>
          </div>
          {#if createError}
            <div class="alert alert-danger">{createError}</div>
          {/if}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={() => isCreateModalOpen = false}>
            取消
          </button>
          <button type="submit" class="btn btn-primary" disabled={isCreating} id="modal-submit-create">
            {isCreating ? '建立中...' : '確定建立'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Modal 2: Edit Line Modal -->
{#if editingLine}
  <div class="modal-backdrop">
    <div class="modal-dialog glass-panel">
      <div class="modal-header">
        <h3>編輯品項</h3>
        <button class="btn-close" onclick={cancelEditLine}>✕</button>
      </div>
      <div class="modal-body">
        <div class="info-summary">
          <strong>{editingLine.product_name_snapshot}</strong> - {editingLine.variant_name_snapshot || '單一規格'} ({editingLine.unit_name_snapshot})
        </div>
        <div class="form-group">
          <label for="edit-line-qty">數量 <span class="required">*</span></label>
          <input 
            id="edit-line-qty" 
            type="number" 
            step="1" 
            min="1" 
            bind:value={editLineQuantity} 
            class="input-text" 
          />
        </div>
        <div class="form-group">
          <label for="edit-line-price">單價 <span class="required">*</span></label>
          <input 
            id="edit-line-price" 
            type="number" 
            step="0.01" 
            min="0" 
            bind:value={editLineUnitPrice} 
            class="input-text" 
          />
        </div>
        <div class="form-group">
          <label for="edit-line-notes">備註</label>
          <input 
            id="edit-line-notes" 
            type="text" 
            bind:value={editLineNotes} 
            class="input-text" 
          />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={cancelEditLine} disabled={isSavingLine}>取消</button>
        <button class="btn btn-primary" onclick={handleSaveLine} disabled={isSavingLine}>
          {isSavingLine ? '儲存中...' : '儲存品項'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal 3: Action Confirmation Prompt Modal -->
{#if isActionModalOpen}
  <div class="modal-backdrop">
    <div class="modal-dialog glass-panel">
      <div class="modal-header">
        <h3>{actionModalTitle}</h3>
        <button class="btn-close" onclick={() => isActionModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-prompt-text">{actionModalPrompt}</p>
        {#if actionModalInputLabel}
          <div class="form-group">
            <label for="action-modal-input">
              {actionModalInputLabel}
              {#if actionModalInputRequired}<span class="required">*</span>{/if}
            </label>
            <input 
              id="action-modal-input" 
              type="text" 
              bind:value={actionModalInputVal} 
              placeholder={actionModalInputPlaceholder} 
              class="input-text" 
            />
          </div>
        {/if}
        {#if actionModalError}
          <div class="alert alert-danger">{actionModalError}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => isActionModalOpen = false} disabled={isSubmittingAction}>
          取消
        </button>
        <button 
          class="btn {actionModalType === 'reject' || actionModalType === 'cancel' ? 'btn-danger' : 'btn-primary'}" 
          onclick={handleExecuteActionModal} 
          disabled={isSubmittingAction}
          id="btn-confirm-action"
        >
          {isSubmittingAction ? '處理中...' : '確認執行'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .quotes-workspace-container {
    padding: 24px;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    background: var(--bg-primary);
  }

  .workspace-header {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .header-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left h2 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--text-primary);
  }

  .header-subtitle {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  .filter-bar {
    display: flex;
    gap: 20px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.88rem;
  }

  .filter-group label {
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .glass-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }

  /* Table styling */
  .table-container {
    overflow-x: auto;
    border-radius: var(--radius-md);
  }

  .quotes-table, .lines-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    text-align: left;
  }

  .quotes-table th, .lines-table th {
    padding: 12px 16px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-weight: 500;
    border-bottom: 1px solid var(--border-color);
  }

  .quotes-table td, .lines-table td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .quote-row {
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .quote-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .quote-number-cell {
    color: var(--accent);
  }

  .amount-cell {
    font-family: monospace;
    font-size: 0.92rem;
  }

  /* Status Badges */
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
  }

  .badge-status-draft {
    background: rgba(156, 163, 175, 0.15);
    color: #9CA3AF;
    border: 1px solid rgba(156, 163, 175, 0.3);
  }

  .badge-status-pending {
    background: rgba(245, 158, 11, 0.15);
    color: #F59E0B;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .badge-status-sent {
    background: rgba(59, 130, 246, 0.15);
    color: #60A5FA;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge-status-converted {
    background: rgba(16, 185, 129, 0.15);
    color: #34D399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge-status-declined {
    background: rgba(244, 63, 94, 0.15);
    color: #FB7185;
    border: 1px solid rgba(244, 63, 94, 0.3);
  }

  .badge-status-expired {
    background: rgba(100, 116, 139, 0.15);
    color: #94A3B8;
    border: 1px solid rgba(100, 116, 139, 0.3);
  }

  .badge-status-cancelled {
    background: rgba(113, 113, 122, 0.15);
    color: #A1A1AA;
    border: 1px solid rgba(113, 113, 122, 0.3);
  }

  .badge-rejection-warn {
    background: rgba(239, 68, 68, 0.15);
    color: #F87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .badge-below-std {
    background: rgba(239, 68, 68, 0.15);
    color: #F87171;
    border: 1px solid rgba(239, 68, 68, 0.4);
    font-size: 0.72rem;
  }

  .badge-std-ok {
    background: rgba(16, 185, 129, 0.1);
    color: #10B981;
    font-size: 0.72rem;
  }

  .price-comparison-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .std-price {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .line-note-subtext {
    font-size: 0.78rem;
    font-weight: 400;
    margin-top: 3px;
    opacity: 0.85;
  }

  /* Detail Layout */
  .detail-container {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .rejection-callout {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 18px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
  }

  .rejection-callout-muted {
    background: rgba(148, 163, 184, 0.08);
    border-color: rgba(148, 163, 184, 0.3);
  }

  .rejection-callout-muted .callout-title {
    color: #94A3B8;
  }

  .callout-icon {
    font-size: 1.3rem;
  }

  .callout-title {
    font-weight: 600;
    color: #F87171;
    font-size: 0.92rem;
    margin-bottom: 4px;
  }

  .callout-content {
    font-size: 0.88rem;
    color: var(--text-primary);
  }

  .quote-header-card {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 12px;
  }

  .quote-id-block {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .quote-number-title {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .quote-actions-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-info-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .info-item.full-width {
    grid-column: span 4;
  }

  .info-label {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .info-value {
    font-size: 0.92rem;
    color: var(--text-primary);
  }

  .amount-total {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--accent);
  }

  /* Lines section */
  .quote-lines-card {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .lines-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .lines-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary);
  }

  .lines-count {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .add-line-box {
    padding: 16px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }

  .line-inputs-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }

  .label-spacer {
    display: block;
    height: 18px;
  }

  .flex-1 { flex: 1; }
  .flex-2 { flex: 2; }

  .line-error-msg {
    margin-top: 8px;
    font-size: 0.82rem;
    color: #F87171;
  }

  .empty-lines-state {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .action-btn-group {
    display: flex;
    gap: 6px;
  }

  .terminal-tag {
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  /* Form controls */
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .form-row {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
  }

  .form-row .form-group {
    flex: 1;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .input-select, .input-text, .input-textarea {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
    outline: none;
    transition: border var(--transition-fast);
  }

  .input-select:focus, .input-text:focus, .input-textarea:focus {
    border-color: var(--accent);
  }

  .input-textarea {
    resize: vertical;
    min-height: 60px;
  }

  .required {
    color: #F87171;
  }

  /* Buttons */
  .btn {
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    font-weight: 500;
    font-size: 0.88rem;
    cursor: pointer;
    border: none;
    transition: all var(--transition-fast);
  }

  .btn-primary {
    background: var(--accent);
    color: #000;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .btn-warning {
    background: #F59E0B;
    color: #000;
  }

  .btn-danger {
    background: #EF4444;
    color: #FFF;
  }

  .btn-ghost {
    background: transparent;
    color: var(--accent);
  }

  .btn-ghost:hover {
    background: var(--accent-hover);
  }

  .btn-danger-ghost {
    background: transparent;
    color: #F87171;
  }

  .btn-danger-ghost:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .btn-sm {
    padding: 5px 10px;
    font-size: 0.82rem;
  }

  .btn-xs {
    padding: 3px 6px;
    font-size: 0.75rem;
  }

  .btn-close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-dialog {
    width: 480px;
    max-width: 90vw;
    padding: 24px;
    border-radius: var(--radius-md);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.15rem;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 20px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .modal-prompt-text {
    font-size: 0.9rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .info-summary {
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
  }

  /* Alerts */
  .alert {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .alert-danger {
    background: rgba(239, 68, 68, 0.1);
    color: #F87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .empty-state, .loading-state {
    padding: 40px;
    text-align: center;
    color: var(--text-muted);
  }

  .text-muted { color: var(--text-muted); }
  .text-amber { color: #F59E0B; }
  .text-rose { color: #F43F5E; }
  .text-emerald { color: #10B981; }
  .font-bold { font-weight: 600; }
</style>
