<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    formatCurrency,
    formatTime,
    fetchVendorBills,
    fetchVendorBillDetail,
    fetchUnbilledReceivedOrders,
    createVendorBillAction,
    updateVendorBillHeaderAction,
    addVendorBillOrderAction,
    removeVendorBillOrderAction,
    postVendorBillAction,
    acceptVendorBillDifferenceAction,
    returnVendorBillToDraftAction,
    cancelVendorBillAction,
    voidVendorBillAction
  } from '../store.svelte.js';
  import { invoke } from '../tauri.js';
  import { calculateDueDate, getPaymentTermsNotice } from '../paymentTerms.js';

  // Sub tab: 'bills' | 'unbilled' | 'detail' | 'create'
  let activeSubTab = $state('bills');

  // Filter states
  let filterVendorId = $state('');
  let filterStatus = $state('all');
  let isLoading = $state(false);

  // Auxiliary data
  let availableVendors = $state([]);

  // Detail view state
  let currentDetail = $state(null);
  let isDetailLoading = $state(false);
  let detailError = $state('');

  // Draft editing state
  let editInvoiceNumber = $state('');
  let editBillDate = $state('');
  let editDueDate = $state('');
  let editUntaxedAmount = $state('');
  let editTaxAmount = $state('');
  let editNote = $state('');
  let isEditingHeader = $state(false);
  let isSavingHeader = $state(false);
  let isActionLoading = $state(false);

  // Available unbilled POs for current bill's vendor (to add to bill)
  let vendorUnbilledOrders = $state([]);
  let isAddingOrderModalOpen = $state(false);
  let selectedOrderToAdd = $state('');

  // Create Bill Form State
  let createVendorId = $state('');
  let createInvoiceNumber = $state('');
  let createBillDate = $state(getTodayDateString());
  let createDueDate = $state(getTodayDateString());
  let createUntaxedAmount = $state('');
  let createTaxAmount = $state('');
  let createNote = $state('');
  let createSelectedPoIds = $state([]); // array of PO ids
  let createPreselectedOrders = $state([]); // [{ purchase_order_id, po_number, total_amount, received_total_amount }]
  let isCreatingBill = $state(false);
  let createError = $state('');

  // Unbilled received orders selection state (grouped by vendor)
  let unbilledSelection = $state({}); // { [vendorId]: Set of po_id }

  // Dispute Accept Modal State
  let isDisputeModalOpen = $state(false);
  let disputeDifferenceNote = $state('');
  let disputeError = $state('');

  // Void Modal State
  let isVoidModalOpen = $state(false);
  let voidReason = $state('');
  let voidError = $state('');

  // Cancel Modal State
  let isCancelModalOpen = $state(false);
  let cancelError = $state('');

  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onMount(async () => {
    await loadInitialData();

    if (appState.selectedVendorBillId) {
      const targetId = appState.selectedVendorBillId;
      appState.selectedVendorBillId = null;
      await openDetail(targetId);
    }
  });

  $effect(() => {
    if (appState.selectedVendorBillId) {
      const targetId = appState.selectedVendorBillId;
      appState.selectedVendorBillId = null;
      openDetail(targetId);
    }
  });

  async function loadInitialData() {
    isLoading = true;
    try {
      const partners = await invoke('list_partners', {});
      availableVendors = (partners || []).filter(p => p.is_vendor && p.is_active !== false);
      await Promise.all([
        refreshBillsList(),
        refreshUnbilledOrders()
      ]);
    } catch (err) {
      console.error('Failed to load initial vendor bills data:', err);
      showToast('載入資料失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  async function refreshBillsList() {
    await fetchVendorBills({
      vendor_partner_id: filterVendorId || null,
      status: filterStatus !== 'all' ? filterStatus : null
    });
  }

  async function refreshUnbilledOrders() {
    await fetchUnbilledReceivedOrders(filterVendorId || null);
  }

  // Derived: Filtered bills
  let filteredBills = $derived(
    (appState.vendorBills || []).filter(b => {
      if (filterVendorId && b.vendor_partner_id !== filterVendorId) return false;
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      return true;
    })
  );

  // Derived: Unbilled orders grouped by vendor
  let unbilledByVendor = $derived.by(() => {
    const map = new Map();
    for (const po of appState.unbilledReceivedOrders || []) {
      const vId = po.vendor_partner_id;
      if (!map.has(vId)) {
        map.set(vId, {
          vendor_partner_id: vId,
          vendor_name: po.vendor_name_snapshot,
          orders: []
        });
      }
      map.get(vId).orders.push(po);
    }
    return Array.from(map.values());
  });

  function getVendorPaymentTermsInfo(vendorId) {
    const vendor = availableVendors.find(v => v.id === vendorId);
    if (!vendor) return { type: null, days: null, notice: '此供應商未設定付款條件' };
    const notice = getPaymentTermsNotice(vendor.payment_terms_type);
    let desc = '';
    if (vendor.payment_terms_type === 'net') {
      desc = `依付款條件：Net ${vendor.payment_terms_days} 天`;
    } else if (vendor.payment_terms_type === 'month_end') {
      desc = `依付款條件：月結 ${vendor.payment_terms_days} 天`;
    } else {
      desc = notice || '此供應商未設定付款條件';
    }
    return {
      type: vendor.payment_terms_type,
      days: vendor.payment_terms_days,
      desc
    };
  }

  // Handle Due Date Auto-Calculation when Bill Date or Vendor changes
  function updateDueDateForVendor(vendorId, billDate, currentDueDate) {
    const terms = getVendorPaymentTermsInfo(vendorId);
    if (terms.type && billDate) {
      return calculateDueDate(billDate, terms.type, terms.days);
    }
    return billDate || currentDueDate || getTodayDateString();
  }

  // Checkbox toggle for unbilled received orders
  function toggleOrderSelection(vendorId, poId) {
    if (!unbilledSelection[vendorId]) {
      unbilledSelection[vendorId] = new Set();
    }
    if (unbilledSelection[vendorId].has(poId)) {
      unbilledSelection[vendorId].delete(poId);
    } else {
      unbilledSelection[vendorId].add(poId);
    }
    // Trigger reactivity
    unbilledSelection = { ...unbilledSelection };
  }

  function isOrderSelected(vendorId, poId) {
    return unbilledSelection[vendorId] && unbilledSelection[vendorId].has(poId);
  }

  // Start creation with selected POs
  function startCreateBillForVendor(vendorGroup) {
    const selectedSet = unbilledSelection[vendorGroup.vendor_partner_id] || new Set();
    const selectedOrders = vendorGroup.orders.filter(po => selectedSet.has(po.purchase_order_id));

    createVendorId = vendorGroup.vendor_partner_id;
    createInvoiceNumber = '';
    createBillDate = getTodayDateString();
    createDueDate = updateDueDateForVendor(createVendorId, createBillDate, '');
    createNote = '';
    createError = '';

    createPreselectedOrders = selectedOrders;
    createSelectedPoIds = selectedOrders.map(o => o.purchase_order_id);

    // Sum received total amount of selected POs
    const totalBasis = selectedOrders.reduce((sum, o) => sum + (o.received_total_amount || 0), 0);
    createUntaxedAmount = totalBasis > 0 ? totalBasis.toFixed(2) : '';
    createTaxAmount = totalBasis > 0 ? Math.round(totalBasis * 0.05).toFixed(2) : '0';

    activeSubTab = 'create';
  }

  // Handle Create Bill Submission
  async function handleCreateBillSubmit(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    createError = '';

    if (!createVendorId) {
      createError = '請選擇供應商';
      return;
    }
    if (!createInvoiceNumber.trim()) {
      createError = '請填寫發票號碼';
      return;
    }
    if (!createBillDate) {
      createError = '請選擇請款日';
      return;
    }
    const untaxed = parseFloat(createUntaxedAmount);
    if (isNaN(untaxed) || untaxed <= 0) {
      createError = '未稅金額必須大於 0';
      return;
    }
    const tax = parseFloat(createTaxAmount || '0');
    if (isNaN(tax) || tax < 0) {
      createError = '稅額不能為負數';
      return;
    }

    isCreatingBill = true;
    try {
      const detail = await createVendorBillAction({
        vendor_partner_id: createVendorId,
        vendor_invoice_number: createInvoiceNumber.trim(),
        bill_date: createBillDate,
        due_date: createDueDate || null,
        untaxed_amount: untaxed,
        tax_amount: tax,
        note: createNote.trim() || null
      });

      // Attach preselected orders
      for (const poId of createSelectedPoIds) {
        await addVendorBillOrderAction(detail.bill.id, poId);
      }

      // Clear selection
      if (unbilledSelection[createVendorId]) {
        for (const poId of createSelectedPoIds) {
          unbilledSelection[createVendorId].delete(poId);
        }
        unbilledSelection = { ...unbilledSelection };
      }

      showToast(`請款單「${detail.bill.bill_number}」已建立！`);
      await openDetail(detail.bill.id);
    } catch (err) {
      createError = err.message || String(err);
    } finally {
      isCreatingBill = false;
    }
  }

  // Detail View Management
  async function openDetail(billId) {
    isDetailLoading = true;
    detailError = '';
    try {
      const detail = await fetchVendorBillDetail(billId);
      currentDetail = detail;
      syncEditForm(detail);
      activeSubTab = 'detail';
    } catch (err) {
      console.error('Failed to open vendor bill detail:', err);
      detailError = err.message || String(err);
      showToast('載入請款單明細失敗：' + detailError);
    } finally {
      isDetailLoading = false;
    }
  }

  function syncEditForm(detail) {
    if (!detail || !detail.bill) return;
    const b = detail.bill;
    editInvoiceNumber = b.vendor_invoice_number || '';
    editBillDate = b.bill_date || '';
    editDueDate = b.due_date || '';
    editUntaxedAmount = b.untaxed_amount !== undefined ? String(b.untaxed_amount) : '';
    editTaxAmount = b.tax_amount !== undefined ? String(b.tax_amount) : '0';
    editNote = b.note || '';
    isEditingHeader = false;
  }

  // Calculations for current detail
  let currentBasisAmount = $derived.by(() => {
    if (!currentDetail || !currentDetail.orders) return 0;
    return currentDetail.orders.reduce((sum, o) => sum + (o.received_total_amount || 0), 0);
  });

  let currentOrderedTotal = $derived.by(() => {
    if (!currentDetail || !currentDetail.orders) return 0;
    return currentDetail.orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  });

  let currentUntaxed = $derived.by(() => {
    if (isEditingHeader) {
      return parseFloat(editUntaxedAmount) || 0;
    }
    return currentDetail?.bill?.untaxed_amount || 0;
  });

  let currentDifference = $derived(
    Math.round((currentUntaxed - currentBasisAmount) * 100) / 100
  );

  let isDifferenceDisputed = $derived(
    Math.abs(currentDifference) >= 1.0
  );

  // Save Header edits
  async function handleSaveHeader() {
    if (!currentDetail || currentDetail.bill.status !== 'draft') return;
    if (!editInvoiceNumber.trim()) {
      showToast('發票號碼不可為空');
      return;
    }
    const untaxed = parseFloat(editUntaxedAmount);
    if (isNaN(untaxed) || untaxed <= 0) {
      showToast('未稅金額必須大於 0');
      return;
    }
    const tax = parseFloat(editTaxAmount || '0');
    if (isNaN(tax) || tax < 0) {
      showToast('稅額不能為負數');
      return;
    }

    isSavingHeader = true;
    try {
      const updated = await updateVendorBillHeaderAction({
        bill_id: currentDetail.bill.id,
        vendor_invoice_number: editInvoiceNumber.trim(),
        bill_date: editBillDate,
        due_date: editDueDate,
        untaxed_amount: untaxed,
        tax_amount: tax,
        note: editNote.trim() || null
      });
      currentDetail = updated;
      syncEditForm(updated);
      isEditingHeader = false;
    } catch (err) {
      showToast('更新失敗：' + (err.message || String(err)));
    } finally {
      isSavingHeader = false;
    }
  }

  // Add Order to current bill
  async function openAddOrderModal() {
    if (!currentDetail) return;
    isAddingOrderModalOpen = true;
    selectedOrderToAdd = '';
    try {
      const list = await invoke('list_unbilled_received_orders', {
        vendorPartnerId: currentDetail.bill.vendor_partner_id,
        vendor_partner_id: currentDetail.bill.vendor_partner_id
      });
      vendorUnbilledOrders = list || [];
    } catch (err) {
      console.error('Failed to load unbilled orders for modal:', err);
    }
  }

  async function handleConfirmAddOrder() {
    if (!selectedOrderToAdd || !currentDetail) return;
    isActionLoading = true;
    try {
      const updated = await addVendorBillOrderAction(currentDetail.bill.id, selectedOrderToAdd);
      currentDetail = updated;
      isAddingOrderModalOpen = false;
    } catch (err) {
      showToast('新增採購單失敗：' + (err.message || String(err)));
    } finally {
      isActionLoading = false;
    }
  }

  // Remove Order from current bill
  async function handleRemoveOrder(poId) {
    if (!currentDetail) return;
    isActionLoading = true;
    try {
      const updated = await removeVendorBillOrderAction(currentDetail.bill.id, poId);
      currentDetail = updated;
    } catch (err) {
      showToast('移除採購單失敗：' + (err.message || String(err)));
    } finally {
      isActionLoading = false;
    }
  }

  // Post Bill
  async function handlePostBill() {
    if (!currentDetail) return;
    if (currentDetail.orders.length === 0) {
      showToast('請款單至少須涵蓋一張採購單');
      return;
    }
    isActionLoading = true;
    try {
      const updated = await postVendorBillAction(currentDetail.bill.id);
      currentDetail = updated;
    } catch (err) {
      showToast('過帳失敗：' + (err.message || String(err)));
    } finally {
      isActionLoading = false;
    }
  }

  // Accept Dispute
  function openDisputeModal() {
    disputeDifferenceNote = '';
    disputeError = '';
    isDisputeModalOpen = true;
  }

  async function handleConfirmAcceptDispute() {
    if (!disputeDifferenceNote.trim()) {
      disputeError = '必須填寫差異說明';
      return;
    }
    isActionLoading = true;
    try {
      const updated = await acceptVendorBillDifferenceAction(
        currentDetail.bill.id,
        disputeDifferenceNote.trim()
      );
      currentDetail = updated;
      isDisputeModalOpen = false;
    } catch (err) {
      disputeError = err.message || String(err);
    } finally {
      isActionLoading = false;
    }
  }

  // Return to Draft
  async function handleReturnToDraft() {
    if (!currentDetail) return;
    isActionLoading = true;
    try {
      const updated = await returnVendorBillToDraftAction(currentDetail.bill.id);
      currentDetail = updated;
      syncEditForm(updated);
    } catch (err) {
      showToast('退回草稿失敗：' + (err.message || String(err)));
    } finally {
      isActionLoading = false;
    }
  }

  // Cancel Draft / Disputed
  function openCancelModal() {
    cancelError = '';
    isCancelModalOpen = true;
  }

  async function handleConfirmCancel() {
    if (!currentDetail) return;
    isActionLoading = true;
    cancelError = '';
    try {
      const updated = await cancelVendorBillAction(currentDetail.bill.id);
      currentDetail = updated;
      isCancelModalOpen = false;
    } catch (err) {
      cancelError = err.message || String(err);
    } finally {
      isActionLoading = false;
    }
  }

  // Void Posted Bill
  function openVoidModal() {
    voidReason = '';
    voidError = '';
    isVoidModalOpen = true;
  }

  async function handleConfirmVoid() {
    if (!voidReason.trim()) {
      voidError = '請填寫作廢原因';
      return;
    }
    isActionLoading = true;
    try {
      const updated = await voidVendorBillAction(currentDetail.bill.id, voidReason.trim());
      currentDetail = updated;
      isVoidModalOpen = false;
    } catch (err) {
      voidError = err.message || String(err);
    } finally {
      isActionLoading = false;
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'draft':
        return { label: '草稿', class: 'badge-draft' };
      case 'disputed':
        return { label: '差異待處理', class: 'badge-amber' };
      case 'posted':
        return { label: '已過帳', class: 'badge-emerald' };
      case 'cancelled':
        return { label: '已取消', class: 'badge-muted' };
      case 'voided':
        return { label: '已作廢', class: 'badge-rose' };
      default:
        return { label: status, class: 'badge-muted' };
    }
  }
</script>

<div class="workspace-scrollable">
  <div class="vendor-bills-container">
    <!-- Top Bar: Navigation Tabs & Actions -->
    <div class="bills-header-row">
      <div class="bills-tabs-left">
        <button
          class="tab-btn {activeSubTab === 'bills' ? 'active' : ''}"
          onclick={() => { activeSubTab = 'bills'; refreshBillsList(); }}
        >
          請款單清單
        </button>
        <button
          class="tab-btn {activeSubTab === 'unbilled' ? 'active' : ''}"
          onclick={() => { activeSubTab = 'unbilled'; refreshUnbilledOrders(); }}
        >
          已到貨未請款
          {#if appState.unbilledReceivedOrders.length > 0}
            <span class="tab-badge">{appState.unbilledReceivedOrders.length}</span>
          {/if}
        </button>
        {#if activeSubTab === 'detail' && currentDetail}
          <button class="tab-btn active">
            請款單明細 ({currentDetail.bill.bill_number})
          </button>
        {/if}
        {#if activeSubTab === 'create'}
          <button class="tab-btn active">
            建立請款單
          </button>
        {/if}
      </div>

      <div class="bills-actions-right">
        {#if activeSubTab === 'bills'}
          <button
            class="btn btn-primary"
            onclick={() => {
              createVendorId = '';
              createInvoiceNumber = '';
              createBillDate = getTodayDateString();
              createDueDate = getTodayDateString();
              createUntaxedAmount = '';
              createTaxAmount = '0';
              createNote = '';
              createSelectedPoIds = [];
              createPreselectedOrders = [];
              createError = '';
              activeSubTab = 'create';
            }}
          >
            + 手動建立請款單
          </button>
        {/if}
      </div>
    </div>

    <!-- VIEW 1: BILLS LIST -->
    {#if activeSubTab === 'bills'}
      <!-- Filter Bar -->
      <div class="filter-panel glass-panel">
        <div class="filter-group">
          <label for="filter-vendor">供應商：</label>
          <select id="filter-vendor" bind:value={filterVendorId} onchange={refreshBillsList}>
            <option value="">全部供應商</option>
            {#each availableVendors as vendor}
              <option value={vendor.id}>{vendor.name}</option>
            {/each}
          </select>
        </div>

        <div class="filter-group">
          <label for="filter-status">狀態：</label>
          <select id="filter-status" bind:value={filterStatus} onchange={refreshBillsList}>
            <option value="all">全部狀態</option>
            <option value="draft">草稿</option>
            <option value="disputed">差異待處理</option>
            <option value="posted">已過帳</option>
            <option value="voided">已作廢</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>

        <button class="btn btn-secondary" onclick={refreshBillsList}>重新整理</button>
      </div>

      <!-- Table -->
      {#if isLoading}
        <div class="empty-panel glass-panel">載入中...</div>
      {:else if filteredBills.length === 0}
        <div class="empty-panel glass-panel">
          <p>查無請款單記錄。</p>
        </div>
      {:else}
        <div class="table-container glass-panel">
          <table class="data-table">
            <thead>
              <tr>
                <th>請款單號</th>
                <th>供應商</th>
                <th>發票號碼</th>
                <th>請款日</th>
                <th>到期日</th>
                <th class="text-right">未稅金額</th>
                <th class="text-right">含稅合計</th>
                <th class="text-center">涵蓋採購單</th>
                <th class="text-center">狀態</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredBills as bill}
                {@const badge = getStatusBadge(bill.status)}
                <tr class="clickable-row" onclick={() => openDetail(bill.id)}>
                  <td class="font-bold link-text">{bill.bill_number}</td>
                  <td>{bill.vendor_name_snapshot}</td>
                  <td><code>{bill.vendor_invoice_number}</code></td>
                  <td>{bill.bill_date}</td>
                  <td>{bill.due_date}</td>
                  <td class="text-right">{formatCurrency(bill.untaxed_amount)}</td>
                  <td class="text-right font-bold">{formatCurrency(bill.total_amount)}</td>
                  <td class="text-center">{bill.order_count} 張</td>
                  <td class="text-center">
                    <span class="badge {badge.class}">{badge.label}</span>
                  </td>
                  <td class="text-center" onclick={(e) => e.stopPropagation()}>
                    <button class="btn-sm btn-secondary" onclick={() => openDetail(bill.id)}>
                      {bill.status === 'draft' ? '編輯' : '檢視'}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

    <!-- VIEW 2: UNBILLED RECEIVED ORDERS -->
    {:else if activeSubTab === 'unbilled'}
      <div class="filter-panel glass-panel">
        <div class="filter-group">
          <label for="filter-unbilled-vendor">供應商：</label>
          <select id="filter-unbilled-vendor" bind:value={filterVendorId} onchange={refreshUnbilledOrders}>
            <option value="">全部供應商</option>
            {#each availableVendors as vendor}
              <option value={vendor.id}>{vendor.name}</option>
            {/each}
          </select>
        </div>
        <button class="btn btn-secondary" onclick={refreshUnbilledOrders}>重新整理</button>
      </div>

      {#if unbilledByVendor.length === 0}
        <div class="empty-panel glass-panel">
          <p>目前沒有已到貨未請款的採購單。</p>
        </div>
      {:else}
        {#each unbilledByVendor as group}
          {@const selectedCount = (unbilledSelection[group.vendor_partner_id] || new Set()).size}
          <div class="vendor-group-card glass-panel">
            <div class="group-header">
              <div class="group-title">
                <h3>{group.vendor_name}</h3>
                <span class="group-count">（共 {group.orders.length} 筆已到貨）</span>
              </div>
              <button
                class="btn btn-primary"
                disabled={selectedCount === 0}
                onclick={() => startCreateBillForVendor(group)}
              >
                建立請款單 ({selectedCount})
              </button>
            </div>

            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 40px;">選取</th>
                  <th>採購單號</th>
                  <th>到貨日</th>
                  <th class="text-right">下單金額</th>
                  <th class="text-right">實到金額（未稅）</th>
                </tr>
              </thead>
              <tbody>
                {#each group.orders as order}
                  {@const isChecked = isOrderSelected(group.vendor_partner_id, order.purchase_order_id)}
                  <tr class="clickable-row" onclick={() => toggleOrderSelection(group.vendor_partner_id, order.purchase_order_id)}>
                    <td onclick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onchange={() => toggleOrderSelection(group.vendor_partner_id, order.purchase_order_id)}
                      />
                    </td>
                    <td class="font-bold">
                      <a
                        href="#purchase-orders"
                        onclick={(e) => {
                          e.preventDefault();
                          appState.selectedPurchaseOrderId = order.purchase_order_id;
                          navigate('/app/purchase-orders');
                        }}
                      >
                        {order.po_number}
                      </a>
                    </td>
                    <td>{order.received_at ? formatTime(order.received_at) : '—'}</td>
                    <td class="text-right">{formatCurrency(order.total_amount)}</td>
                    <td class="text-right font-bold text-emerald">
                      {formatCurrency(order.received_total_amount)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/each}
      {/if}

    <!-- VIEW 3: CREATE BILL FORM -->
    {:else if activeSubTab === 'create'}
      <div class="form-container glass-panel">
        <div class="form-header">
          <h2>建立請款單</h2>
          <button class="btn btn-secondary" onclick={() => activeSubTab = 'bills'}>返回清單</button>
        </div>

        {#if createError}
          <div class="alert alert-danger">{createError}</div>
        {/if}

        <form onsubmit={handleCreateBillSubmit}>
          <div class="form-grid">
            <div class="form-group">
              <label for="create-vendor">供應商 *</label>
              <select
                id="create-vendor"
                bind:value={createVendorId}
                disabled={createPreselectedOrders.length > 0}
                onchange={() => {
                  createDueDate = updateDueDateForVendor(createVendorId, createBillDate, createDueDate);
                }}
              >
                <option value="">-- 請選擇供應商 --</option>
                {#each availableVendors as v}
                  <option value={v.id}>{v.name}</option>
                {/each}
              </select>
            </div>

            <div class="form-group">
              <label for="create-invoice">發票號碼 *</label>
              <input
                id="create-invoice"
                type="text"
                bind:value={createInvoiceNumber}
                placeholder="例如：AB-12345678"
                required
              />
            </div>

            <div class="form-group">
              <label for="create-bill-date">請款日 *</label>
              <input
                id="create-bill-date"
                type="date"
                bind:value={createBillDate}
                onchange={() => {
                  createDueDate = updateDueDateForVendor(createVendorId, createBillDate, createDueDate);
                }}
                required
              />
            </div>

            <div class="form-group">
              <label for="create-due-date">到期日</label>
              <input
                id="create-due-date"
                type="date"
                bind:value={createDueDate}
              />
              <span class="field-hint">
                {getVendorPaymentTermsInfo(createVendorId).desc}
              </span>
            </div>

            <div class="form-group">
              <label for="create-untaxed">未稅金額 (TWD) *</label>
              <input
                id="create-untaxed"
                type="number"
                step="0.01"
                min="0.01"
                bind:value={createUntaxedAmount}
                oninput={() => {
                  const val = parseFloat(createUntaxedAmount) || 0;
                  createTaxAmount = Math.round(val * 0.05).toFixed(2);
                }}
                required
              />
            </div>

            <div class="form-group">
              <label for="create-tax">稅額 (5%)</label>
              <input
                id="create-tax"
                type="number"
                step="0.01"
                min="0"
                bind:value={createTaxAmount}
              />
            </div>

            <div class="form-group full-width">
              <label for="create-note">備註</label>
              <textarea id="create-note" bind:value={createNote} rows="2"></textarea>
            </div>
          </div>

          <!-- Preselected orders summary -->
          {#if createPreselectedOrders.length > 0}
            <div class="covered-orders-preview">
              <h4>涵蓋採購單 ({createPreselectedOrders.length} 張)</h4>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>採購單號</th>
                    <th class="text-right">下單金額</th>
                    <th class="text-right">實到金額（未稅）</th>
                  </tr>
                </thead>
                <tbody>
                  {#each createPreselectedOrders as po}
                    <tr>
                      <td class="font-bold">{po.po_number}</td>
                      <td class="text-right">{formatCurrency(po.total_amount)}</td>
                      <td class="text-right font-bold">{formatCurrency(po.received_total_amount)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <div class="form-actions">
            <button class="btn btn-secondary" type="button" onclick={() => activeSubTab = 'bills'}>取消</button>
            <button class="btn btn-primary" type="submit" disabled={isCreatingBill}>
              {isCreatingBill ? '建立中...' : '確認建立請款單'}
            </button>
          </div>
        </form>
      </div>

    <!-- VIEW 4: DETAIL / EDIT VIEW -->
    {:else if activeSubTab === 'detail' && currentDetail}
      {@const bill = currentDetail.bill}
      {@const badge = getStatusBadge(bill.status)}

      <div class="detail-container">
        <!-- Top Title & State Actions -->
        <div class="detail-header glass-panel">
          <div class="detail-title-col">
            <div class="detail-title-row">
              <h2>{bill.bill_number}</h2>
              <span class="badge {badge.class}">{badge.label}</span>
            </div>
            <p class="detail-sub">
              供應商：<strong>{bill.vendor_name_snapshot}</strong> ｜ 發票號碼：<code>{bill.vendor_invoice_number}</code>
            </p>
          </div>

          <div class="detail-actions">
            <button class="btn btn-secondary" onclick={() => activeSubTab = 'bills'}>返回清單</button>

            <!-- DRAFT ACTIONS -->
            {#if bill.status === 'draft'}
              {#if isEditingHeader}
                <button class="btn btn-secondary" onclick={() => syncEditForm(currentDetail)}>取消修改</button>
                <button class="btn btn-primary" disabled={isSavingHeader} onclick={handleSaveHeader}>
                  {isSavingHeader ? '儲存中...' : '儲存表頭'}
                </button>
              {:else}
                <button class="btn btn-secondary" onclick={() => isEditingHeader = true}>修改表頭</button>
                <button class="btn btn-primary" disabled={isActionLoading} onclick={handlePostBill}>
                  過帳請款單
                </button>
                <button class="btn btn-danger-outline" disabled={isActionLoading} onclick={openCancelModal}>
                  取消請款單
                </button>
              {/if}

            <!-- DISPUTED ACTIONS -->
            {:else if bill.status === 'disputed'}
              <button class="btn btn-primary" disabled={isActionLoading} onclick={openDisputeModal}>
                接受差異並過帳
              </button>
              <button class="btn btn-secondary" disabled={isActionLoading} onclick={handleReturnToDraft}>
                退回修改
              </button>
              <button class="btn btn-danger-outline" disabled={isActionLoading} onclick={openCancelModal}>
                取消
              </button>

            <!-- POSTED ACTIONS -->
            {:else if bill.status === 'posted'}
              <button class="btn btn-danger" disabled={isActionLoading} onclick={openVoidModal}>
                作廢請款單
              </button>
            {/if}
          </div>
        </div>

        <!-- DISPUTE ALERT BANNER -->
        {#if bill.status === 'disputed'}
          <div class="dispute-banner glass-panel">
            <div class="dispute-title">⚠️ 請款金額與實到應付基準存在差異待處理</div>
            <div class="dispute-grid">
              <div>應付基準：<strong>{formatCurrency(bill.basis_amount || 0)}</strong></div>
              <div>請款未稅：<strong>{formatCurrency(bill.untaxed_amount)}</strong></div>
              <div class="text-amber">
                差異金額：<strong>{formatCurrency(bill.difference_amount || 0)}</strong>
              </div>
            </div>
            <p class="dispute-hint">
              您可以填寫差異說明直接「接受差異並過帳」，或點擊「退回修改」調整採購單與表頭金額。
            </p>
          </div>
        {/if}

        <!-- LIVE MATCHING PREVIEW (IN DRAFT) -->
        {#if bill.status === 'draft'}
          <div class="matching-preview-card glass-panel {isDifferenceDisputed ? 'border-amber' : 'border-emerald'}">
            <div class="preview-header">
              <h4>即時預覽比對</h4>
              {#if isDifferenceDisputed}
                <span class="badge badge-amber">過帳後將轉差異待處理</span>
              {:else}
                <span class="badge badge-emerald">金額吻合 (容差範圍內)</span>
              {/if}
            </div>
            <div class="matching-stats-row">
              <div class="stat-box">
                <span class="stat-label">應付基準 (實到未稅)</span>
                <span class="stat-value">{formatCurrency(currentBasisAmount)}</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">請款未稅</span>
                <span class="stat-value">{formatCurrency(currentUntaxed)}</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">差異 (未稅 - 基準)</span>
                <span class="stat-value {isDifferenceDisputed ? 'text-amber' : 'text-emerald'}">
                  {formatCurrency(currentDifference)}
                </span>
              </div>
            </div>
          </div>
        {/if}

        <div class="detail-content-grid">
          <!-- Left: Bill Header Card -->
          <div class="bill-info-card glass-panel">
            <h3>表頭資訊</h3>

            {#if isEditingHeader && bill.status === 'draft'}
              <div class="edit-form-stack">
                <div class="form-group">
                  <label for="edit-inv">發票號碼 *</label>
                  <input id="edit-inv" type="text" bind:value={editInvoiceNumber} required />
                </div>
                <div class="form-group">
                  <label for="edit-bdate">請款日 *</label>
                  <input
                    id="edit-bdate"
                    type="date"
                    bind:value={editBillDate}
                    onchange={() => {
                      editDueDate = updateDueDateForVendor(bill.vendor_partner_id, editBillDate, editDueDate);
                    }}
                    required
                  />
                </div>
                <div class="form-group">
                  <label for="edit-ddate">到期日</label>
                  <input id="edit-ddate" type="date" bind:value={editDueDate} />
                  <span class="field-hint">
                    {getVendorPaymentTermsInfo(bill.vendor_partner_id).desc}
                  </span>
                </div>
                <div class="form-group">
                  <label for="edit-untaxed">未稅金額 (TWD) *</label>
                  <input
                    id="edit-untaxed"
                    type="number"
                    step="0.01"
                    min="0.01"
                    bind:value={editUntaxedAmount}
                    oninput={() => {
                      const val = parseFloat(editUntaxedAmount) || 0;
                      editTaxAmount = Math.round(val * 0.05).toFixed(2);
                    }}
                    required
                  />
                </div>
                <div class="form-group">
                  <label for="edit-tax">稅額</label>
                  <input id="edit-tax" type="number" step="0.01" min="0" bind:value={editTaxAmount} />
                </div>
                <div class="form-group">
                  <label for="edit-note">備註</label>
                  <textarea id="edit-note" bind:value={editNote} rows="2"></textarea>
                </div>
              </div>
            {:else}
              <div class="info-kv-list">
                <div class="kv-item">
                  <span class="kv-label">發票號碼：</span>
                  <span class="kv-val"><code>{bill.vendor_invoice_number}</code></span>
                </div>
                <div class="kv-item">
                  <span class="kv-label">請款日：</span>
                  <span class="kv-val">{bill.bill_date}</span>
                </div>
                <div class="kv-item">
                  <span class="kv-label">到期日：</span>
                  <span class="kv-val">{bill.due_date}</span>
                </div>
                <div class="kv-item">
                  <span class="kv-label">付款條件依據：</span>
                  <span class="kv-val text-muted">{getVendorPaymentTermsInfo(bill.vendor_partner_id).desc}</span>
                </div>
                <div class="kv-item">
                  <span class="kv-label">未稅金額：</span>
                  <span class="kv-val">{formatCurrency(bill.untaxed_amount)}</span>
                </div>
                <div class="kv-item">
                  <span class="kv-label">稅額：</span>
                  <span class="kv-val">{formatCurrency(bill.tax_amount)}</span>
                </div>
                <div class="kv-item highlight-kv">
                  <span class="kv-label font-bold">含稅合計：</span>
                  <span class="kv-val font-bold text-cyan">{formatCurrency(bill.total_amount)}</span>
                </div>
                {#if bill.note}
                  <div class="kv-item">
                    <span class="kv-label">備註：</span>
                    <span class="kv-val">{bill.note}</span>
                  </div>
                {/if}
                {#if bill.difference_note}
                  <div class="kv-item highlight-kv border-amber">
                    <span class="kv-label">差異說明：</span>
                    <span class="kv-val">{bill.difference_note}</span>
                  </div>
                {/if}
                {#if bill.void_reason}
                  <div class="kv-item highlight-kv border-rose">
                    <span class="kv-label">作廢原因：</span>
                    <span class="kv-val">{bill.void_reason}</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Right: Covered Purchase Orders Table -->
          <div class="covered-orders-card glass-panel">
            <div class="card-header-row">
              <h3>涵蓋採購單 ({currentDetail.orders.length} 張)</h3>
              {#if bill.status === 'draft'}
                <button class="btn-sm btn-secondary" onclick={openAddOrderModal}>+ 加入採購單</button>
              {/if}
            </div>

            <table class="data-table">
              <thead>
                <tr>
                  <th>採購單號</th>
                  <th class="text-right">下單金額</th>
                  <th class="text-right">實到金額（未稅）</th>
                  {#if bill.status === 'draft'}
                    <th class="text-center" style="width: 60px;">操作</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#if currentDetail.orders.length === 0}
                  <tr>
                    <td colspan="4" class="text-center py-4 text-muted">目前未涵蓋任何採購單</td>
                  </tr>
                {:else}
                  {#each currentDetail.orders as ord}
                    <tr>
                      <td class="font-bold">
                        <a
                          href="#purchase-orders"
                          onclick={(e) => {
                            e.preventDefault();
                            appState.selectedPurchaseOrderId = ord.purchase_order_id;
                            navigate('/app/purchase-orders');
                          }}
                        >
                          {ord.po_number_snapshot}
                        </a>
                      </td>
                      <td class="text-right">{formatCurrency(ord.total_amount)}</td>
                      <td class="text-right font-bold">{formatCurrency(ord.received_total_amount)}</td>
                      {#if bill.status === 'draft'}
                        <td class="text-center">
                          <button
                            class="btn-sm btn-danger-outline"
                            title="移除此採購單"
                            onclick={() => handleRemoveOrder(ord.purchase_order_id)}
                          >
                            ✕
                          </button>
                        </td>
                      {/if}
                    </tr>
                  {/each}
                {/if}
              </tbody>
              <tfoot>
                <tr class="table-total-row">
                  <td class="font-bold">合計</td>
                  <td class="text-right font-bold">{formatCurrency(currentOrderedTotal)}</td>
                  <td class="text-right font-bold text-emerald">{formatCurrency(currentBasisAmount)}</td>
                  {#if bill.status === 'draft'}
                    <td></td>
                  {/if}
                </tr>
              </tfoot>
            </table>

            <!-- POSTED / VOIDED: ASSOCIATED AP & ALLOCATIONS -->
            {#if (bill.status === 'posted' || bill.status === 'voided') && currentDetail.payable}
              {@const ap = currentDetail.payable}
              <div class="associated-ap-section">
                <h4>對應應付帳款與核銷明細</h4>
                <div class="ap-summary-box">
                  <div class="ap-stat">
                    <span>應付編號：</span>
                    <strong>{ap.source_number || ap.id}</strong>
                  </div>
                  <div class="ap-stat">
                    <span>未付餘額：</span>
                    <strong class="text-cyan">{formatCurrency(ap.outstanding_amount)}</strong>
                  </div>
                  <div class="ap-stat">
                    <span>已付金額：</span>
                    <strong class="text-emerald">{formatCurrency(ap.paid_amount)}</strong>
                  </div>
                </div>

                <div class="allocations-subtable">
                  <h5>核銷明細 ({ap.allocations?.length || 0} 筆)</h5>
                  {#if !ap.allocations || ap.allocations.length === 0}
                    <p class="text-muted text-sm">尚無付款核銷明細。</p>
                  {:else}
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>付款單號</th>
                          <th>付款日期</th>
                          <th class="text-right">核銷金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each ap.allocations as alloc}
                          <tr>
                            <td>{alloc.payment_number || alloc.payment_id}</td>
                            <td>{alloc.payment_date || '—'}</td>
                            <td class="text-right font-bold">{formatCurrency(alloc.amount)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- MODAL: ADD ORDER TO BILL -->
{#if isAddingOrderModalOpen}
  <div class="modal-backdrop" onclick={() => isAddingOrderModalOpen = false} onkeydown={(e) => e.key === 'Escape' && (isAddingOrderModalOpen = false)} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-dialog glass-panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>加入採購單至請款單</h3>
        <button class="btn-close" onclick={() => isAddingOrderModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        {#if vendorUnbilledOrders.length === 0}
          <p class="text-muted">查無此供應商其他已到貨未請款之採購單。</p>
        {:else}
          <div class="form-group">
            <label for="select-po-to-add">選擇採購單：</label>
            <select id="select-po-to-add" bind:value={selectedOrderToAdd}>
              <option value="">-- 請選擇採購單 --</option>
              {#each vendorUnbilledOrders as uo}
                <option value={uo.purchase_order_id}>
                  {uo.po_number} (實到 NT$ {uo.received_total_amount})
                </option>
              {/each}
            </select>
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => isAddingOrderModalOpen = false}>取消</button>
        <button
          class="btn btn-primary"
          disabled={!selectedOrderToAdd || isActionLoading}
          onclick={handleConfirmAddOrder}
        >
          加入
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL: ACCEPT DISPUTE -->
{#if isDisputeModalOpen}
  <div class="modal-backdrop" onclick={() => isDisputeModalOpen = false} onkeydown={(e) => e.key === 'Escape' && (isDisputeModalOpen = false)} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-dialog glass-panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>接受差異並過帳</h3>
        <button class="btn-close" onclick={() => isDisputeModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        <p class="text-sm text-muted mb-3">
          接受請款差異將按請款金額過帳並產生應付帳款，請務必填寫差異說明（例如：運費加價、協議調整等）。
        </p>
        {#if disputeError}
          <div class="alert alert-danger">{disputeError}</div>
        {/if}
        <div class="form-group">
          <label for="dispute-note">差異說明 *</label>
          <textarea
            id="dispute-note"
            bind:value={disputeDifferenceNote}
            rows="3"
            placeholder="請填寫接受此差異之原因與依據..."
            required
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => isDisputeModalOpen = false}>取消</button>
        <button
          class="btn btn-primary"
          disabled={!disputeDifferenceNote.trim() || isActionLoading}
          onclick={handleConfirmAcceptDispute}
        >
          確認接受並過帳
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL: VOID BILL -->
{#if isVoidModalOpen}
  <div class="modal-backdrop" onclick={() => isVoidModalOpen = false} onkeydown={(e) => e.key === 'Escape' && (isVoidModalOpen = false)} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-dialog glass-panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>作廢請款單</h3>
        <button class="btn-close" onclick={() => isVoidModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        <p class="text-sm text-danger mb-3">
          作廢後，對應之應付帳款將一併作廢，所涵蓋之採購單將恢復為「未請款」狀態。
        </p>
        {#if voidError}
          <div class="alert alert-danger">{voidError}</div>
        {/if}
        <div class="form-group">
          <label for="void-reason">作廢原因 *</label>
          <textarea
            id="void-reason"
            bind:value={voidReason}
            rows="3"
            placeholder="請填寫作廢此請款單之原因..."
            required
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => isVoidModalOpen = false}>取消</button>
        <button
          class="btn btn-danger"
          disabled={!voidReason.trim() || isActionLoading}
          onclick={handleConfirmVoid}
        >
          確認作廢
        </button>
      </div>
    </div>
  </div>
{/if}

{#if isCancelModalOpen}
  <div class="modal-backdrop" onclick={() => isCancelModalOpen = false} onkeydown={(e) => e.key === 'Escape' && (isCancelModalOpen = false)} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-dialog glass-panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>取消請款單</h3>
        <button class="btn-close" onclick={() => isCancelModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        <p class="text-sm text-danger mb-3">
          確定要取消請款單「{currentDetail?.bill?.bill_number}」嗎？取消後該請款單將無法再編輯或過帳，所涵蓋的採購單將恢復為「未請款」狀態並可重新請款。
        </p>
        {#if cancelError}
          <div class="alert alert-danger">{cancelError}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => isCancelModalOpen = false}>放棄取消</button>
        <button
          class="btn btn-danger"
          disabled={isActionLoading}
          onclick={handleConfirmCancel}
        >
          {isActionLoading ? '處理中...' : '確認取消'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .vendor-bills-container {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 1300px;
    margin: 0 auto;
  }

  .bills-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .bills-tabs-left {
    display: flex;
    gap: 8px;
  }

  .tab-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-secondary);
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
  }

  .tab-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .tab-btn.active {
    background: rgba(var(--accent-cyan-rgb, 6, 182, 212), 0.15);
    border-color: rgba(var(--accent-cyan-rgb, 6, 182, 212), 0.4);
    color: rgb(var(--accent-cyan, 6, 182, 212));
    font-weight: 600;
  }

  .tab-badge {
    background: rgb(var(--accent-amber, 245, 158, 11));
    color: #000;
    font-size: 0.75rem;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: bold;
  }

  .filter-panel {
    padding: 16px;
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.88rem;
  }

  .filter-group select {
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
  }

  .table-container {
    overflow-x: auto;
    border-radius: 8px;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  .data-table th,
  .data-table td {
    padding: 12px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    text-align: left;
  }

  .data-table th {
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-muted);
    font-weight: 600;
  }

  .clickable-row {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clickable-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .font-bold { font-weight: 600; }
  .text-cyan { color: rgb(var(--accent-cyan, 6, 182, 212)); }
  .text-emerald { color: rgb(var(--accent-emerald, 16, 185, 129)); }
  .text-amber { color: rgb(var(--accent-amber, 245, 158, 11)); }
  .text-muted { color: var(--text-muted); }
  .text-sm { font-size: 0.82rem; }
  .mb-3 { margin-bottom: 12px; }

  .link-text {
    color: rgb(var(--accent-cyan, 6, 182, 212));
    text-decoration: underline;
  }

  .vendor-group-card {
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 20px;
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .group-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .group-title h3 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text-primary);
  }

  .group-count {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .form-container {
    padding: 24px;
    border-radius: 8px;
  }

  .form-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group.full-width {
    grid-column: 1 / -1;
  }

  .form-group label {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
    font-size: 0.9rem;
  }

  .field-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .covered-orders-preview {
    margin: 20px 0;
    padding: 16px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
  }

  .covered-orders-preview h4 {
    margin: 0 0 12px 0;
    font-size: 0.95rem;
  }

  /* Detail View Styles */
  .detail-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .detail-header {
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 8px;
  }

  .detail-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .detail-title-row h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .detail-sub {
    margin: 6px 0 0 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  .detail-actions {
    display: flex;
    gap: 10px;
  }

  .dispute-banner {
    padding: 16px 20px;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
  }

  .dispute-title {
    font-weight: 600;
    color: rgb(var(--accent-amber, 245, 158, 11));
    margin-bottom: 8px;
  }

  .dispute-grid {
    display: flex;
    gap: 24px;
    font-size: 0.9rem;
    margin-bottom: 6px;
  }

  .dispute-hint {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .matching-preview-card {
    padding: 16px 20px;
    border-radius: 8px;
  }

  .border-amber {
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.04);
  }

  .border-emerald {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.04);
  }

  .border-rose {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.04);
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .preview-header h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .matching-stats-row {
    display: flex;
    gap: 32px;
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-label {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .stat-value {
    font-size: 1.15rem;
    font-weight: 600;
  }

  .detail-content-grid {
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: 16px;
  }

  .bill-info-card,
  .covered-orders-card {
    padding: 20px;
    border-radius: 8px;
  }

  .bill-info-card h3,
  .covered-orders-card h3 {
    margin: 0 0 16px 0;
    font-size: 1.1rem;
  }

  .info-kv-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.88rem;
  }

  .kv-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .kv-label {
    color: var(--text-muted);
  }

  .highlight-kv {
    padding: 10px 12px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
  }

  .card-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .table-total-row {
    background: rgba(255, 255, 255, 0.02);
    border-top: 2px solid rgba(255, 255, 255, 0.1);
  }

  .associated-ap-section {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .associated-ap-section h4 {
    margin: 0 0 12px 0;
    font-size: 0.95rem;
    color: var(--text-primary);
  }

  .ap-summary-box {
    display: flex;
    gap: 24px;
    padding: 12px 16px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border-color);
    margin-bottom: 16px;
    font-size: 0.88rem;
  }

  .allocations-subtable h5 {
    margin: 0 0 8px 0;
    font-size: 0.85rem;
    color: var(--text-muted);
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
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
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

  .btn-close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 20px;
  }

  .empty-panel {
    padding: 40px;
    text-align: center;
    border-radius: 8px;
    color: var(--text-muted);
  }

  .badge-draft {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }

  .badge-emerald {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .badge-amber {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }

  .badge-rose {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .badge-muted {
    background: rgba(100, 116, 139, 0.15);
    color: #64748b;
  }

  .btn-danger {
    background: rgba(239, 68, 68, 0.8);
    color: #fff;
    border: 1px solid #ef4444;
  }

  .btn-danger:hover {
    background: #ef4444;
  }

  .btn-danger-outline {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.4);
  }

  .btn-danger-outline:hover {
    background: rgba(239, 68, 68, 0.18);
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--border-color);
  }

  .alert {
    padding: 10px 14px;
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 0.85rem;
  }

  .alert-danger {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
</style>

