<script>
  // @ts-check
  import { onMount } from 'svelte';
  import { appState, showToast, formatCurrency, navigate } from '../store.svelte.js';
  import {
    fetchCustomerInvoices,
    fetchCustomerInvoiceDetail,
    fetchUninvoicedSalesOrders,
    fetchPendingAllowanceInvoices,
    fetchSalesAllowances,
    createSalesAllowanceAction,
    updateSalesAllowanceAction,
    postSalesAllowanceAction,
    cancelSalesAllowanceAction,
    voidSalesAllowanceAction,
    createCustomerInvoiceAction,
    updateCustomerInvoiceHeaderAction,
    postCustomerInvoiceAction,
    cancelCustomerInvoiceAction,
    voidCustomerInvoiceAction
  } from './store.js';
  import { fetchPartners } from '../partners/store.js';

  // Sub tabs: 'invoices' | 'uninvoiced' | 'allowances' | 'detail' | 'create'
  let activeSubTab = $state('invoices');

  // Filters for invoices tab
  let filterCustomerId = $state('');
  let filterStatus = $state('all');
  let searchQuery = $state('');
  let isLoading = $state(false);

  // Detail view state
  let currentDetail = $derived(appState.currentCustomerInvoiceDetail);
  let isSubmitting = $state(false);
  let actionError = $state('');

  // Post Modal state
  let isPostModalOpen = $state(false);
  let postTaxInvoiceNumber = $state('');
  let postExemptionReason = $state('');
  let postDifferenceNote = $state('');
  let postNote = $state('');
  let postModalError = $state('');

  // Void Modal state
  let isVoidModalOpen = $state(false);
  let voidReason = $state('');
  let voidModalError = $state('');

  // Create Allowance Modal state
  let isCreateAllowanceModalOpen = $state(false);
  let allowanceInvoice = $state(/** @type {any | null} */ (null));
  let allowanceDate = $state(getTodayDateString());
  let allowanceUntaxedAmount = $state('');
  let allowanceTaxAmount = $state('');
  let allowanceExternalReference = $state('');
  let allowanceNote = $state('');
  let allowanceError = $state('');

  // Void Allowance Modal state
  let isVoidAllowanceModalOpen = $state(false);
  let targetAllowanceId = $state('');
  let targetAllowanceNumber = $state('');
  let voidAllowanceReason = $state('');
  let voidAllowanceError = $state('');

  // Create Form state
  let createCustomerId = $state('');
  let createIssuanceMode = $state('per_order');
  let createInvoiceDate = $state(getTodayDateString());
  let createDueDate = $state(getTodayDateString());
  let createUntaxedAmount = $state('');
  let createTaxAmount = $state('0');
  let createTaxInvoiceNumber = $state('');
  let createExemptionReason = $state('');
  let createSelectedSoIds = $state(/** @type {string[]} */ ([]));
  let createNote = $state('');
  let createError = $state('');

  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Available customers from partners
  let availableCustomers = $derived.by(() => {
    return (appState.partners || []).filter(p => p.isCustomer || p.is_customer);
  });

  // Filtered invoices
  let filteredInvoices = $derived.by(() => {
    let list = appState.customerInvoices || [];
    if (filterCustomerId) {
      list = list.filter(i => i.customer_partner_id === filterCustomerId);
    }
    if (filterStatus !== 'all') {
      list = list.filter(i => i.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(i =>
        (i.invoice_number || '').toLowerCase().includes(q) ||
        (i.tax_invoice_number || '').toLowerCase().includes(q) ||
        (i.customer_name_snapshot || '').toLowerCase().includes(q)
      );
    }
    return list;
  });

  // Uninvoiced orders grouped into (a), (b), (c)
  let groupedUninvoiced = $derived.by(() => {
    const all = appState.uninvoicedSalesOrders || [];
    const groupA = all.filter(o => o.group === 'per_order_confirmed');
    const groupB = all.filter(o => o.group === 'per_order_shipped');
    const groupC = all.filter(o => o.group === 'monthly_consolidated');

    const sumA = Math.round(groupA.reduce((s, o) => s + (o.uninvoiced_amount || 0), 0) * 100) / 100;
    const sumB = Math.round(groupB.reduce((s, o) => s + (o.uninvoiced_amount || 0), 0) * 100) / 100;
    const sumC = Math.round(groupC.reduce((s, o) => s + (o.uninvoiced_amount || 0), 0) * 100) / 100;

    return {
      groupA,
      groupB,
      groupC,
      sumA,
      sumB,
      sumC,
      totalCount: all.length,
      totalAmount: Math.round((sumA + sumB + sumC) * 100) / 100
    };
  });

  let ordersForCustomer = $derived.by(() => {
    return (appState.uninvoicedSalesOrders || []).filter(o =>
      !createCustomerId || o.customer_partner_id === createCustomerId
    );
  });

  let lastProcessedInvoiceId = $state('');

  function checkAndOpenTargetInvoice() {
    let targetId = appState.selectedCustomerInvoiceId;
    if (targetId) {
      appState.selectedCustomerInvoiceId = null;
    } else {
      const currentRoute = appState.route || (typeof window !== 'undefined' ? window.location.hash : '');
      if (currentRoute && typeof currentRoute === 'string') {
        const match = currentRoute.match(/[?&]id=([^&#]+)/);
        if (match && match[1]) {
          targetId = decodeURIComponent(match[1]);
        }
      }
    }
    if (targetId && targetId !== lastProcessedInvoiceId) {
      lastProcessedInvoiceId = targetId;
      handleOpenDetail(targetId);
    }
  }

  onMount(async () => {
    isLoading = true;
    try {
      await fetchPartners();
      await refreshAll();
      checkAndOpenTargetInvoice();
    } catch (err) {
      console.error('Initialization error:', err);
    } finally {
      isLoading = false;
    }
  });

  $effect(() => {
    const r = appState.route;
    const s = appState.selectedCustomerInvoiceId;
    if (r || s) {
      checkAndOpenTargetInvoice();
    }
  });

  async function refreshAll() {
    await Promise.all([
      fetchCustomerInvoices({
        customerPartnerId: filterCustomerId || null,
        status: filterStatus === 'all' ? null : filterStatus,
        searchQuery: searchQuery || null
      }),
      fetchUninvoicedSalesOrders(filterCustomerId || null),
      fetchPendingAllowanceInvoices(filterCustomerId || null),
      fetchSalesAllowances()
    ]);
  }

  function handleOpenCreateAllowance(inv) {
    if (!inv) return;
    allowanceInvoice = inv;
    allowanceDate = getTodayDateString();
    allowanceUntaxedAmount = String(inv.shipment_shortfall || '');
    const untaxedNum = Number(inv.shipment_shortfall || 0);
    const invUntaxed = Number(inv.untaxed_amount || 0);
    const invTax = Number(inv.tax_amount || 0);
    if (invUntaxed > 0) {
      allowanceTaxAmount = String(Math.round(untaxedNum * invTax / invUntaxed * 100) / 100);
    } else {
      allowanceTaxAmount = '0';
    }
    allowanceExternalReference = '';
    allowanceNote = '';
    allowanceError = '';
    isCreateAllowanceModalOpen = true;
  }

  async function handleSubmitCreateAllowance() {
    if (!allowanceInvoice) return;
    try {
      isSubmitting = true;
      allowanceError = '';
      const untaxed = parseFloat(allowanceUntaxedAmount);
      const tax = parseFloat(allowanceTaxAmount || '0');
      if (isNaN(untaxed) || untaxed <= 0) {
        allowanceError = '折讓未稅金額需大於 0';
        return;
      }
      await createSalesAllowanceAction({
        customer_invoice_id: allowanceInvoice.id,
        allowance_date: allowanceDate,
        untaxed_amount: untaxed,
        tax_amount: isNaN(tax) ? 0 : tax,
        external_reference: allowanceExternalReference.trim() || null,
        note: allowanceNote.trim() || null,
        reason_type: 'shipment_shortfall'
      });
      isCreateAllowanceModalOpen = false;
      await refreshAll();
      if (currentDetail && currentDetail.invoice.id === allowanceInvoice.id) {
        await handleOpenDetail(allowanceInvoice.id);
      }
    } catch (err) {
      allowanceError = (/** @type {any} */ (err))?.message || String(err);
    } finally {
      isSubmitting = false;
    }
  }

  async function handlePostAllowance(allowanceId) {
    try {
      isSubmitting = true;
      await postSalesAllowanceAction(allowanceId);
      await refreshAll();
      if (currentDetail) {
        await handleOpenDetail(currentDetail.invoice.id);
      }
    } catch (err) {
      showToast('折讓單過帳失敗：' + ((/** @type {any} */ (err))?.message || String(err)));
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCancelAllowance(allowanceId) {
    try {
      isSubmitting = true;
      await cancelSalesAllowanceAction(allowanceId);
      await refreshAll();
      if (currentDetail) {
        await handleOpenDetail(currentDetail.invoice.id);
      }
    } catch (err) {
      showToast('取消折讓單失敗：' + ((/** @type {any} */ (err))?.message || String(err)));
    } finally {
      isSubmitting = false;
    }
  }

  function handleOpenVoidAllowance(alw) {
    targetAllowanceId = alw.id;
    targetAllowanceNumber = alw.allowance_number;
    voidAllowanceReason = '';
    voidAllowanceError = '';
    isVoidAllowanceModalOpen = true;
  }

  async function handleSubmitVoidAllowance() {
    if (!voidAllowanceReason.trim()) {
      voidAllowanceError = '作廢原因必填';
      return;
    }
    try {
      isSubmitting = true;
      voidAllowanceError = '';
      await voidSalesAllowanceAction(targetAllowanceId, voidAllowanceReason.trim());
      isVoidAllowanceModalOpen = false;
      await refreshAll();
      if (currentDetail) {
        await handleOpenDetail(currentDetail.invoice.id);
      }
    } catch (err) {
      voidAllowanceError = (/** @type {any} */ (err))?.message || String(err);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleOpenDetail(invoiceId) {
    isLoading = true;
    try {
      await fetchCustomerInvoiceDetail(invoiceId);
      activeSubTab = 'detail';
    } catch (err) {
      const msg = (/** @type {any} */ (err))?.message || String(err);
      showToast('載入發票明細失敗：' + msg);
    } finally {
      isLoading = false;
    }
  }

  function handleStartCreateFromOrders(orderIds, partnerId, defaultMode = 'per_order') {
    createCustomerId = partnerId || '';
    createIssuanceMode = defaultMode;
    createInvoiceDate = getTodayDateString();
    createDueDate = getTodayDateString();
    createSelectedSoIds = [...orderIds];
    createUntaxedAmount = '';
    createTaxAmount = '0';
    createTaxInvoiceNumber = '';
    createExemptionReason = '';
    createNote = '';
    createError = '';

    // Calculate initial amounts from orders
    recalcCreateAmounts();
    activeSubTab = 'create';
  }

  function recalcCreateAmounts() {
    const selectedOrders = (appState.uninvoicedSalesOrders || []).filter(o =>
      createSelectedSoIds.includes(o.sales_order_id)
    );
    const sum = selectedOrders.reduce((acc, o) => acc + (o.uninvoiced_amount || 0), 0);
    if (sum > 0) {
      createUntaxedAmount = String(Math.round(sum * 100) / 100);
      createTaxAmount = String(Math.round(sum * 0.05 * 100) / 100);
    }
  }

  async function handlePostInvoice() {
    if (!currentDetail) return;
    postModalError = '';
    postTaxInvoiceNumber = currentDetail.invoice.tax_invoice_number || '';
    postExemptionReason = currentDetail.invoice.tax_invoice_exemption_reason || '';
    postDifferenceNote = currentDetail.invoice.difference_note || '';
    postNote = currentDetail.invoice.note || '';
    isPostModalOpen = true;
  }

  async function submitPostInvoice() {
    if (!currentDetail) return;
    isSubmitting = true;
    postModalError = '';
    try {
      await postCustomerInvoiceAction({
        invoice_id: currentDetail.invoice.id,
        tax_invoice_number: postTaxInvoiceNumber ? postTaxInvoiceNumber.trim() : null,
        tax_invoice_exemption_reason: postExemptionReason ? postExemptionReason.trim() : null,
        difference_note: postDifferenceNote ? postDifferenceNote.trim() : null,
        note: postNote ? postNote.trim() : null
      });
      isPostModalOpen = false;
      await fetchCustomerInvoiceDetail(currentDetail.invoice.id);
    } catch (err) {
      postModalError = (/** @type {any} */ (err))?.message || String(err);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCancelInvoice() {
    if (!currentDetail) return;
    if (!confirm(`確定要取消銷項發票「${currentDetail.invoice.invoice_number}」嗎？`)) return;
    isSubmitting = true;
    try {
      await cancelCustomerInvoiceAction(currentDetail.invoice.id);
      await fetchCustomerInvoiceDetail(currentDetail.invoice.id);
    } catch (err) {
      const msg = (/** @type {any} */ (err))?.message || String(err);
      showToast('取消發票失敗：' + msg);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleVoidInvoice() {
    if (!currentDetail) return;
    voidModalError = '';
    voidReason = '';
    isVoidModalOpen = true;
  }

  async function submitVoidInvoice() {
    if (!currentDetail) return;
    if (!voidReason.trim()) {
      voidModalError = '作廢原因為必填';
      return;
    }
    isSubmitting = true;
    voidModalError = '';
    try {
      await voidCustomerInvoiceAction({
        invoice_id: currentDetail.invoice.id,
        void_reason: voidReason.trim()
      });
      isVoidModalOpen = false;
      await fetchCustomerInvoiceDetail(currentDetail.invoice.id);
    } catch (err) {
      voidModalError = (/** @type {any} */ (err))?.message || String(err);
    } finally {
      isSubmitting = false;
    }
  }

  async function submitCreateInvoice() {
    createError = '';
    if (!createCustomerId) {
      createError = '請選擇客戶';
      return;
    }
    if (!createInvoiceDate) {
      createError = '請選擇發票日期';
      return;
    }
    if (createSelectedSoIds.length === 0) {
      createError = '請至少選擇一張銷售單';
      return;
    }
    if (createIssuanceMode === 'per_order' && createSelectedSoIds.length > 1) {
      createError = '逐單開立僅能涵蓋一張銷售單';
      return;
    }

    isSubmitting = true;
    try {
      const payload = {
        customer_partner_id: createCustomerId,
        issuance_mode: createIssuanceMode,
        invoice_date: createInvoiceDate,
        due_date: createDueDate || null,
        untaxed_amount: createUntaxedAmount ? Number(createUntaxedAmount) : null,
        tax_amount: createTaxAmount ? Number(createTaxAmount) : null,
        sales_order_ids: createSelectedSoIds,
        tax_invoice_number: createTaxInvoiceNumber ? createTaxInvoiceNumber.trim() : null,
        tax_invoice_exemption_reason: createExemptionReason ? createExemptionReason.trim() : null,
        note: createNote ? createNote.trim() : null
      };

      const detail = await createCustomerInvoiceAction(payload);
      await handleOpenDetail(detail.invoice.id);
    } catch (err) {
      createError = (/** @type {any} */ (err))?.message || String(err);
    } finally {
      isSubmitting = false;
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'draft':
        return { label: '草稿', class: 'badge-amber' };
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
  <div class="invoices-container">
    <!-- Header row & sub-tabs -->
    <div class="invoices-header-row">
      <div class="invoices-tabs-left">
        <button
          class="tab-btn {activeSubTab === 'invoices' ? 'active' : ''}"
          onclick={() => {
            activeSubTab = 'invoices';
            lastProcessedInvoiceId = '';
            if (appState.route?.includes('?')) navigate('/app/customer-invoices');
            refreshAll();
          }}
        >
          銷項發票清單
        </button>
        <button
          class="tab-btn {activeSubTab === 'uninvoiced' ? 'active' : ''}"
          onclick={() => {
            activeSubTab = 'uninvoiced';
            lastProcessedInvoiceId = '';
            if (appState.route?.includes('?')) navigate('/app/customer-invoices');
            refreshAll();
          }}
        >
          待開票清單
          {#if (groupedUninvoiced.totalCount || 0) > 0}
            <span class="tab-badge">{groupedUninvoiced.totalCount}</span>
          {/if}
        </button>
        <button
          class="tab-btn {activeSubTab === 'allowances' ? 'active' : ''}"
          onclick={() => {
            activeSubTab = 'allowances';
            lastProcessedInvoiceId = '';
            if (appState.route?.includes('?')) navigate('/app/customer-invoices');
            refreshAll();
          }}
        >
          待開折讓清單
          {#if (appState.pendingAllowanceInvoices || []).length > 0}
            <span class="tab-badge badge-danger">{(appState.pendingAllowanceInvoices || []).length}</span>
          {/if}
        </button>
        {#if activeSubTab === 'detail' && currentDetail}
          <button class="tab-btn active">
            發票明細 ({currentDetail.invoice.invoice_number})
          </button>
        {/if}
        {#if activeSubTab === 'create'}
          <button class="tab-btn active">
            開立發票
          </button>
        {/if}
      </div>

      <div class="invoices-actions-right">
        {#if activeSubTab === 'invoices'}
          <button
            class="btn btn-primary"
            onclick={() => {
              createCustomerId = '';
              createIssuanceMode = 'per_order';
              createInvoiceDate = getTodayDateString();
              createDueDate = getTodayDateString();
              createUntaxedAmount = '';
              createTaxAmount = '0';
              createTaxInvoiceNumber = '';
              createExemptionReason = '';
              createSelectedSoIds = [];
              createNote = '';
              createError = '';
              activeSubTab = 'create';
            }}
          >
            + 手動開立發票
          </button>
        {/if}
      </div>
    </div>

    <!-- TAB 1: INVOICES LIST -->
    {#if activeSubTab === 'invoices'}
      <div class="filter-panel glass-panel">
        <div class="filter-group">
          <label for="filter-cust">客戶：</label>
          <select id="filter-cust" bind:value={filterCustomerId} onchange={refreshAll}>
            <option value="">全部客戶</option>
            {#each availableCustomers as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-status">狀態：</label>
          <select id="filter-status" bind:value={filterStatus} onchange={refreshAll}>
            <option value="all">全部狀態</option>
            <option value="draft">草稿</option>
            <option value="posted">已過帳</option>
            <option value="voided">已作廢</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div class="filter-group search-group">
          <input
            type="text"
            class="input-search"
            placeholder="搜尋發票號碼、統一發票、客戶..."
            bind:value={searchQuery}
            oninput={refreshAll}
          />
        </div>
        <button class="btn btn-secondary" onclick={refreshAll}>重新整理</button>
      </div>

      {#if isLoading}
        <div class="empty-panel glass-panel">載入中...</div>
      {:else if filteredInvoices.length === 0}
        <div class="empty-panel glass-panel">查無銷項發票記錄。</div>
      {:else}
        <div class="table-container glass-panel">
          <table class="data-table">
            <thead>
              <tr>
                <th>發票單號</th>
                <th>客戶名稱</th>
                <th>開票模式</th>
                <th>發票日期</th>
                <th>到期日</th>
                <th class="text-right">未稅金額</th>
                <th class="text-right">含稅總額</th>
                <th>收入分類</th>
                <th>狀態</th>
                <th>標記警示</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredInvoices as inv}
                {@const badge = getStatusBadge(inv.status)}
                <tr>
                  <td class="font-mono font-bold">
                    <button class="link-btn" onclick={() => handleOpenDetail(inv.id)}>
                      {inv.invoice_number}
                    </button>
                  </td>
                  <td>{inv.customer_name_snapshot}</td>
                  <td>
                    <span class="badge {inv.issuance_mode === 'monthly_consolidated' ? 'badge-blue' : 'badge-slate'}">
                      {inv.issuance_mode === 'monthly_consolidated' ? '月結彙開' : '逐單開立'}
                    </span>
                  </td>
                  <td>{inv.invoice_date}</td>
                  <td>{inv.due_date}</td>
                  <td class="text-right font-mono">{formatCurrency(inv.untaxed_amount)}</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(inv.total_amount)}</td>
                  <td>
                    {#if inv.revenue_status === 'recognized'}
                      <span class="badge badge-emerald">已認列</span>
                    {:else}
                      <span class="badge badge-amber">遞延收入</span>
                    {/if}
                  </td>
                  <td>
                    <span class="badge {badge.class}">{badge.label}</span>
                  </td>
                  <td>
                    <div class="tags-container">
                      {#if inv.is_late_issued}
                        <span class="badge badge-warning" title="CI-09: 逾時開立">逾時開立</span>
                      {/if}
                      {#if inv.shipment_shortfall >= 1.0}
                        <span class="badge badge-danger" title="CI-10: 出貨短少 NT$ {inv.shipment_shortfall}">
                          短少 {formatCurrency(inv.shipment_shortfall)}
                        </span>
                      {/if}
                    </div>
                  </td>
                  <td>
                    <button class="btn btn-sm btn-secondary" onclick={() => handleOpenDetail(inv.id)}>
                      查看明細
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

    <!-- TAB 2: UNINVOICED ORDERS (分三組) -->
    {:else if activeSubTab === 'uninvoiced'}
      <!-- Group Summary Cards -->
      <div class="kpi-grid">
        <div class="kpi-card glass-panel">
          <div class="kpi-title">(a) 逐單客戶、已確認未開票</div>
          <div class="kpi-value">{groupedUninvoiced.groupA.length} 筆</div>
          <div class="kpi-sub">未開票金額：{formatCurrency(groupedUninvoiced.sumA)}</div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-title">(b) 逐單客戶、已出貨未開票</div>
          <div class="kpi-value text-warning">{groupedUninvoiced.groupB.length} 筆</div>
          <div class="kpi-sub">未開票金額：{formatCurrency(groupedUninvoiced.sumB)}</div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-title">(c) 月結客戶本月待彙開</div>
          <div class="kpi-value text-primary">{groupedUninvoiced.groupC.length} 筆</div>
          <div class="kpi-sub">本月出貨金額：{formatCurrency(groupedUninvoiced.sumC)}</div>
        </div>
      </div>

      <!-- Section (a) -->
      <div class="section-card glass-panel">
        <div class="section-header">
          <h3>(a) 逐單客戶、已確認未開票 ({groupedUninvoiced.groupA.length})</h3>
          <span class="text-muted">訂單已確認、尚未出貨，可依付款條款先行開票</span>
        </div>
        {#if groupedUninvoiced.groupA.length === 0}
          <p class="text-muted empty-sub">目前無此類型待開票訂單</p>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>銷售單號</th>
                <th>客戶名稱</th>
                <th>確認日期</th>
                <th class="text-right">訂單總金額</th>
                <th>未開票金額 (uninvoiced_amount)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each groupedUninvoiced.groupA as o}
                <tr>
                  <td class="font-mono font-bold">{o.so_number}</td>
                  <td>{o.customer_name_snapshot}</td>
                  <td>{new Date(o.confirmed_at * 1000).toLocaleDateString()}</td>
                  <td class="text-right font-mono">{formatCurrency(o.total_amount)}</td>
                  <td class="font-mono font-bold text-primary">{formatCurrency(o.uninvoiced_amount)}</td>
                  <td>
                    <button
                      class="btn btn-sm btn-primary"
                      onclick={() => handleStartCreateFromOrders([o.sales_order_id], o.customer_partner_id, 'per_order')}
                    >
                      開立發票
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Section (b) -->
      <div class="section-card glass-panel">
        <div class="section-header">
          <h3>(b) 逐單客戶、已出貨未開票 ({groupedUninvoiced.groupB.length})</h3>
          <span class="text-muted">訂單已出貨，需依憑證時限儘速開票</span>
        </div>
        {#if groupedUninvoiced.groupB.length === 0}
          <p class="text-muted empty-sub">目前無此類型待開票訂單</p>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>銷售單號</th>
                <th>客戶名稱</th>
                <th>出貨日期</th>
                <th class="text-right">已出貨金額</th>
                <th>未開票金額 (uninvoiced_amount)</th>
                <th>風險標記</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each groupedUninvoiced.groupB as o}
                <tr>
                  <td class="font-mono font-bold">{o.so_number}</td>
                  <td>{o.customer_name_snapshot}</td>
                  <td>{o.ship_date || '—'}</td>
                  <td class="text-right font-mono">{formatCurrency(o.shipped_amount)}</td>
                  <td class="font-mono font-bold text-primary">{formatCurrency(o.uninvoiced_amount)}</td>
                  <td>
                    {#if o.is_overdue_risk}
                      <span class="badge badge-danger">逾時風險 (CI-09)</span>
                    {:else}
                      <span class="badge badge-emerald">正常時效</span>
                    {/if}
                  </td>
                  <td>
                    <button
                      class="btn btn-sm btn-primary"
                      onclick={() => handleStartCreateFromOrders([o.sales_order_id], o.customer_partner_id, 'per_order')}
                    >
                      開立發票
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Section (c) -->
      <div class="section-card glass-panel">
        <div class="section-header">
          <h3>(c) 月結客戶本月待彙開 ({groupedUninvoiced.groupC.length})</h3>
          <span class="text-muted">月結客戶當月已出貨訂單，月結時彙整開立</span>
        </div>
        {#if groupedUninvoiced.groupC.length === 0}
          <p class="text-muted empty-sub">目前本月無月結待彙開訂單</p>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>銷售單號</th>
                <th>客戶名稱</th>
                <th>出貨日期</th>
                <th class="text-right">已出貨金額</th>
                <th>未開票金額 (uninvoiced_amount)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each groupedUninvoiced.groupC as o}
                <tr>
                  <td class="font-mono font-bold">{o.so_number}</td>
                  <td>{o.customer_name_snapshot}</td>
                  <td>{o.ship_date || '—'}</td>
                  <td class="text-right font-mono">{formatCurrency(o.shipped_amount)}</td>
                  <td class="font-mono font-bold text-primary">{formatCurrency(o.uninvoiced_amount)}</td>
                  <td>
                    <button
                      class="btn btn-sm btn-primary"
                      onclick={() => handleStartCreateFromOrders([o.sales_order_id], o.customer_partner_id, 'monthly_consolidated')}
                    >
                      開立發票
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

    <!-- TAB 3: PENDING ALLOWANCES (待開折讓) -->
    {:else if activeSubTab === 'allowances'}
      <div class="section-card glass-panel">
        <div class="section-header">
          <h3>待開折讓清單 ({ (appState.pendingAllowanceInvoices || []).length })</h3>
          <span class="text-muted">先開票、後少出貨（CI-10 標記）且尚未全數折讓沖減之已過帳發票</span>
        </div>
        {#if (appState.pendingAllowanceInvoices || []).length === 0}
          <div class="empty-panel">目前無出貨短少待開折讓發票。</div>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>發票單號</th>
                <th>客戶名稱</th>
                <th>發票日期</th>
                <th class="text-right">發票含稅總額</th>
                <th class="text-right">比對基準</th>
                <th class="text-right text-danger">剩餘短少金額</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each (appState.pendingAllowanceInvoices || []) as inv}
                <tr>
                  <td class="font-mono font-bold">
                    <button class="link-btn" onclick={() => handleOpenDetail(inv.id)}>
                      {inv.invoice_number}
                    </button>
                  </td>
                  <td>{inv.customer_name_snapshot}</td>
                  <td>{inv.invoice_date}</td>
                  <td class="text-right font-mono">{formatCurrency(inv.total_amount)}</td>
                  <td class="text-right font-mono">{formatCurrency(inv.basis_amount || 0)}</td>
                  <td class="text-right font-mono font-bold text-danger">
                    {formatCurrency(inv.shipment_shortfall)}
                  </td>
                  <td>
                    <button
                      class="btn btn-sm btn-danger"
                      onclick={() => handleOpenCreateAllowance(inv)}
                    >
                      開立折讓單
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        <div class="section-header" style="margin-top: 2rem;">
          <h3>已開立折讓單 ({ (appState.salesAllowances || []).length })</h3>
          <span class="text-muted">針對出貨短少發票開立之折讓單</span>
        </div>
        {#if (appState.salesAllowances || []).length === 0}
          <div class="empty-panel">目前尚無已開立之折讓單。</div>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>折讓單號</th>
                <th>原發票單號</th>
                <th>客戶名稱</th>
                <th>折讓日期</th>
                <th class="text-right">未稅金額</th>
                <th class="text-right">稅額</th>
                <th class="text-right">含稅總額</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each (appState.salesAllowances || []) as alw}
                <tr>
                  <td class="font-mono font-bold">{alw.allowance_number}</td>
                  <td class="font-mono">{alw.invoice_number_snapshot}</td>
                  <td>{alw.customer_name_snapshot}</td>
                  <td>{alw.allowance_date}</td>
                  <td class="text-right font-mono">{formatCurrency(alw.untaxed_amount)}</td>
                  <td class="text-right font-mono">{formatCurrency(alw.tax_amount)}</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(alw.total_amount)}</td>
                  <td>
                    <span class="badge {getStatusBadge(alw.status).class}">
                      {getStatusBadge(alw.status).label}
                    </span>
                  </td>
                  <td>
                    {#if alw.status === 'draft'}
                      <button class="btn btn-sm btn-primary" onclick={() => handlePostAllowance(alw.id)} disabled={isSubmitting}>
                        過帳
                      </button>
                      <button class="btn btn-sm btn-secondary" onclick={() => handleCancelAllowance(alw.id)} disabled={isSubmitting}>
                        取消
                      </button>
                    {:else if alw.status === 'posted'}
                      <button class="btn btn-sm btn-danger" onclick={() => handleOpenVoidAllowance(alw)} disabled={isSubmitting}>
                        作廢
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

    <!-- TAB 4: DETAIL VIEW -->
    {:else if activeSubTab === 'detail' && currentDetail}
      {@const inv = currentDetail.invoice}
      {@const badge = getStatusBadge(inv.status)}

      <!-- Shortfall Banner (CI-10) -->
      {#if currentDetail.shipment_shortfall >= 1.0}
        <div class="banner banner-danger glass-panel">
          <div class="banner-content">
            <span class="banner-title">出貨短少警示（CI-10）</span>
            <p>
              此發票涵蓋之銷售單已全數出貨，但出貨總額少於比對基準。
              剩餘短少金額：<strong class="font-mono">{formatCurrency(currentDetail.shipment_shortfall)}</strong>
            </p>
          </div>
          <div class="banner-action">
            <button
              class="btn btn-danger"
              onclick={() => handleOpenCreateAllowance({ ...inv, shipment_shortfall: currentDetail.shipment_shortfall })}
            >
              開立折讓單
            </button>
          </div>
        </div>
      {/if}

      <!-- Late Issue Warning (CI-09) -->
      {#if currentDetail.is_late_issued && currentDetail.late_issue_warning}
        <div class="banner banner-warning glass-panel">
          <div class="banner-content">
            <span class="banner-title">逾時開立警示（CI-09）</span>
            <p>{currentDetail.late_issue_warning}</p>
          </div>
        </div>
      {/if}

      <!-- Main detail card -->
      <div class="detail-grid">
        <div class="glass-panel detail-card">
          <div class="detail-header">
            <div>
              <span class="text-muted">發票號碼</span>
              <h2>{inv.invoice_number}</h2>
            </div>
            <span class="badge {badge.class} badge-lg">{badge.label}</span>
          </div>

          <div class="info-rows">
            <div class="info-row">
              <span class="info-label">客戶名稱</span>
              <span class="info-val font-bold">{inv.customer_name_snapshot}</span>
            </div>
            <div class="info-row">
              <span class="info-label">開票模式</span>
              <span class="info-val">
                {inv.issuance_mode === 'monthly_consolidated' ? '月結彙開' : '逐單開立'}
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">統一發票號碼</span>
              <span class="info-val font-mono">{inv.tax_invoice_number || '—'}</span>
            </div>
            {#if inv.tax_invoice_exemption_reason}
              <div class="info-row">
                <span class="info-label">免開立原因</span>
                <span class="info-val">{inv.tax_invoice_exemption_reason}</span>
              </div>
            {/if}
            <div class="info-row">
              <span class="info-label">發票日期</span>
              <span class="info-val font-mono">{inv.invoice_date}</span>
            </div>
            <div class="info-row">
              <span class="info-label">到期日</span>
              <span class="info-val font-mono">{inv.due_date}</span>
            </div>
            <div class="info-row">
              <span class="info-label">收入分類</span>
              <span class="info-val">
                {#if currentDetail.revenue_status === 'recognized'}
                  <span class="badge badge-emerald">
                    已認列 ({currentDetail.revenue_recognized_date || '出貨認列'})
                  </span>
                {:else}
                  <span class="badge badge-amber">遞延收入</span>
                {/if}
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">未稅金額</span>
              <span class="info-val font-mono">{formatCurrency(inv.untaxed_amount)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">銷項稅額</span>
              <span class="info-val font-mono">{formatCurrency(inv.tax_amount)}</span>
            </div>
            <div class="info-row highlight-row">
              <span class="info-label font-bold">含稅總額</span>
              <span class="info-val font-mono font-bold text-primary">{formatCurrency(inv.total_amount)}</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="detail-actions">
            {#if inv.status === 'draft'}
              <button class="btn btn-primary" onclick={handlePostInvoice} disabled={isSubmitting}>
                過帳發票
              </button>
              <button class="btn btn-secondary" onclick={handleCancelInvoice} disabled={isSubmitting}>
                取消發票
              </button>
            {:else if inv.status === 'posted'}
              <button class="btn btn-danger" onclick={handleVoidInvoice} disabled={isSubmitting}>
                作廢發票
              </button>
            {/if}
          </div>
        </div>

        <!-- Orders & AR Side Column -->
        <div class="side-column">
          <div class="glass-panel sub-card">
            <h3>涵蓋銷售單 ({currentDetail.orders.length})</h3>
            <table class="sub-table">
              <thead>
                <tr>
                  <th>單號</th>
                  <th>狀態</th>
                  <th class="text-right">銷售額</th>
                  <th class="text-right">已出貨額</th>
                </tr>
              </thead>
              <tbody>
                {#each currentDetail.orders as o}
                  <tr>
                    <td class="font-mono font-bold">{o.so_number_snapshot}</td>
                    <td><span class="badge badge-slate">{o.status}</span></td>
                    <td class="text-right font-mono">{formatCurrency(o.total_amount)}</td>
                    <td class="text-right font-mono">{formatCurrency(o.shipped_amount)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if currentDetail.receivable}
            {@const ar = currentDetail.receivable}
            <div class="glass-panel sub-card">
              <h3>關聯應收帳款（AR）</h3>
              <div class="info-rows">
                <div class="info-row">
                  <span class="info-label">來源單號</span>
                  <span class="info-val font-mono font-bold">{ar.source_number || ar.id}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">應收總額</span>
                  <span class="info-val font-mono">{formatCurrency(ar.amount)}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">已收金額</span>
                  <span class="info-val font-mono">{formatCurrency(ar.received_amount || 0)}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">折讓沖減</span>
                  <span class="info-val font-mono text-danger font-bold">
                    {formatCurrency(ar.allowance_amount || 0)}
                  </span>
                </div>
                <div class="info-row">
                  <span class="info-label">未收餘額</span>
                  <span class="info-val font-mono font-bold text-primary">
                    {formatCurrency(ar.outstanding_amount)}
                  </span>
                </div>
                <div class="info-row">
                  <span class="info-label">結案狀態</span>
                  <span class="info-val">{ar.settlement_status}</span>
                </div>
              </div>
            </div>
          {/if}

          {#if (appState.salesAllowances || []).some(sa => sa.customer_invoice_id === inv.id)}
            {@const linkedAllowances = (appState.salesAllowances || []).filter(sa => sa.customer_invoice_id === inv.id)}
            <div class="glass-panel sub-card">
              <h3>關聯折讓單 ({linkedAllowances.length})</h3>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>折讓單號</th>
                    <th>折讓日期</th>
                    <th class="text-right">未稅金額</th>
                    <th class="text-right">稅額</th>
                    <th class="text-right">總計</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {#each linkedAllowances as sa}
                    <tr>
                      <td class="font-mono font-bold">{sa.allowance_number}</td>
                      <td>{sa.allowance_date}</td>
                      <td class="text-right font-mono">{formatCurrency(sa.untaxed_amount)}</td>
                      <td class="text-right font-mono">{formatCurrency(sa.tax_amount)}</td>
                      <td class="text-right font-mono font-bold">{formatCurrency(sa.total_amount)}</td>
                      <td>
                        <span class="badge {getStatusBadge(sa.status).class}">
                          {getStatusBadge(sa.status).label}
                        </span>
                      </td>
                      <td>
                        {#if sa.status === 'draft'}
                          <button class="btn btn-sm btn-primary" onclick={() => handlePostAllowance(sa.id)} disabled={isSubmitting}>過帳</button>
                          <button class="btn btn-sm btn-secondary" onclick={() => handleCancelAllowance(sa.id)} disabled={isSubmitting}>取消</button>
                        {:else if sa.status === 'posted'}
                          <button class="btn btn-sm btn-danger" onclick={() => handleOpenVoidAllowance(sa)} disabled={isSubmitting}>作廢</button>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>

    <!-- TAB 5: CREATE FORM -->
    {:else if activeSubTab === 'create'}
      <div class="create-form-card glass-panel">
        <h2>開立銷項發票</h2>
        {#if createError}
          <div class="error-banner">{createError}</div>
        {/if}

        <div class="form-grid">
          <div class="form-field">
            <label for="create-cust">客戶 *</label>
            <select
              id="create-cust"
              bind:value={createCustomerId}
              onchange={() => {
                const cust = availableCustomers.find(c => c.id === createCustomerId);
                if (cust?.invoice_issuance_mode) {
                  createIssuanceMode = cust.invoice_issuance_mode;
                }
              }}
            >
              <option value="">請選擇客戶</option>
              {#each availableCustomers as c}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </div>

          <div class="form-field">
            <label for="create-mode">開票模式 *</label>
            <select id="create-mode" bind:value={createIssuanceMode}>
              <option value="per_order">逐單開立 (per_order)</option>
              <option value="monthly_consolidated">月結彙開 (monthly_consolidated)</option>
            </select>
          </div>

          <div class="form-field">
            <label for="create-inv-date">發票日期 *</label>
            <input type="date" id="create-inv-date" bind:value={createInvoiceDate} />
          </div>

          <div class="form-field">
            <label for="create-due-date">到期日</label>
            <input type="date" id="create-due-date" bind:value={createDueDate} />
          </div>

          <div class="form-field">
            <label for="create-untaxed">未稅金額</label>
            <input type="number" id="create-untaxed" step="0.01" bind:value={createUntaxedAmount} placeholder="依訂單自動帶入" />
          </div>

          <div class="form-field">
            <label for="create-tax">銷項稅額</label>
            <input type="number" id="create-tax" step="0.01" bind:value={createTaxAmount} />
          </div>

          <div class="form-field">
            <label for="create-tax-num">統一發票號碼</label>
            <input type="text" id="create-tax-num" bind:value={createTaxInvoiceNumber} placeholder="例如 AB-12345678" />
          </div>

          <div class="form-field">
            <label for="create-exemption">免開原因 (無發票號碼時)</label>
            <select id="create-exemption" bind:value={createExemptionReason}>
              <option value="">無</option>
              <option value="small_business">小規模營業人</option>
              <option value="tax_exempt">免稅憑證</option>
              <option value="foreign_customer">境外客戶</option>
              <option value="other">其他</option>
            </select>
          </div>
        </div>

        <!-- Order selection section -->
        <div class="orders-selection-section">
          <h3>選擇涵蓋之待開票銷售單 *</h3>
          {#if ordersForCustomer.length === 0}
            <p class="text-muted">查無此客戶之待開票銷售單，請確認訂單狀態是否為 confirmed 或 shipped。</p>
          {:else}
            <div class="so-checkboxes">
              {#each ordersForCustomer as o}
                <label class="so-checkbox-item glass-panel">
                  <input
                    type="checkbox"
                    value={o.sales_order_id}
                    checked={createSelectedSoIds.includes(o.sales_order_id)}
                    onchange={(e) => {
                      const checked = /** @type {HTMLInputElement} */ (e.target).checked;
                      if (createIssuanceMode === 'per_order') {
                        createSelectedSoIds = checked ? [o.sales_order_id] : [];
                      } else {
                        if (checked) {
                          createSelectedSoIds = [...createSelectedSoIds, o.sales_order_id];
                        } else {
                          createSelectedSoIds = createSelectedSoIds.filter(id => id !== o.sales_order_id);
                        }
                      }
                      recalcCreateAmounts();
                    }}
                  />
                  <div class="so-info">
                    <span class="font-mono font-bold">{o.so_number}</span>
                    <span class="text-muted">（{o.customer_name_snapshot} | {o.status}）</span>
                  </div>
                  <div class="so-amt font-mono text-primary font-bold">
                    {formatCurrency(o.uninvoiced_amount)}
                  </div>
                </label>
              {/each}
            </div>
          {/if}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick={() => { activeSubTab = 'invoices'; }}>
            取消
          </button>
          <button class="btn btn-primary" onclick={submitCreateInvoice} disabled={isSubmitting}>
            {isSubmitting ? '處理中...' : '確認建立發票'}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- POST MODAL -->
{#if isPostModalOpen}
  <div class="modal-backdrop">
    <div class="modal-card glass-panel">
      <h3>過帳銷項發票</h3>
      {#if postModalError}
        <div class="error-banner">{postModalError}</div>
      {/if}
      <div class="form-field">
        <label for="post-num">統一發票號碼</label>
        <input type="text" id="post-num" bind:value={postTaxInvoiceNumber} placeholder="例如 AB-12345678" />
      </div>
      <div class="form-field">
        <label for="post-exempt">免開原因 (無統一發票號碼時必選)</label>
        <select id="post-exempt" bind:value={postExemptionReason}>
          <option value="">無</option>
          <option value="small_business">小規模營業人</option>
          <option value="tax_exempt">免稅憑證</option>
          <option value="foreign_customer">境外客戶</option>
          <option value="other">其他</option>
        </select>
      </div>
      <div class="form-field">
        <label for="post-diff">比對金額差異說明 (若有差額需填寫)</label>
        <input type="text" id="post-diff" bind:value={postDifferenceNote} placeholder="例如：手續費扣除或約定折扣" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick={() => { isPostModalOpen = false; }}>
          取消
        </button>
        <button class="btn btn-primary" onclick={submitPostInvoice} disabled={isSubmitting}>
          {isSubmitting ? '處理中...' : '確認過帳'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- VOID MODAL -->
{#if isVoidModalOpen}
  <div class="modal-backdrop">
    <div class="modal-card glass-panel">
      <h3>作廢銷項發票</h3>
      {#if voidModalError}
        <div class="error-banner">{voidModalError}</div>
      {/if}
      <p class="text-danger font-bold">警告：作廢發票將一併作廢已生成的應收帳款，此操作無法復原！</p>
      <div class="form-field">
        <label for="void-reason">作廢原因 *</label>
        <textarea id="void-reason" bind:value={voidReason} placeholder="請輸入作廢原因"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick={() => { isVoidModalOpen = false; }}>
          取消
        </button>
        <button class="btn btn-danger" onclick={submitVoidInvoice} disabled={isSubmitting}>
          {isSubmitting ? '處理中...' : '確認作廢'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- CREATE ALLOWANCE MODAL -->
{#if isCreateAllowanceModalOpen && allowanceInvoice}
  <div class="modal-backdrop">
    <div class="modal-card glass-panel">
      <h3>開立折讓單（出貨短少）</h3>
      {#if allowanceError}
        <div class="error-banner">{allowanceError}</div>
      {/if}
      <div class="summary-box">
        <div><strong>原發票單號：</strong> {allowanceInvoice.invoice_number}</div>
        <div><strong>客戶名稱：</strong> {allowanceInvoice.customer_name_snapshot}</div>
        <div><strong>剩餘短少金額：</strong> NT$ {allowanceInvoice.shipment_shortfall}</div>
      </div>
      <div class="form-field">
        <label for="alw-date">折讓日期 *</label>
        <input type="date" id="alw-date" bind:value={allowanceDate} />
      </div>
      <div class="form-field">
        <label for="alw-untaxed">折讓未稅金額 *</label>
        <input
          type="number"
          id="alw-untaxed"
          step="0.01"
          bind:value={allowanceUntaxedAmount}
          oninput={() => {
            const u = parseFloat(allowanceUntaxedAmount);
            const invUntaxed = Number(allowanceInvoice.untaxed_amount || 0);
            const invTax = Number(allowanceInvoice.tax_amount || 0);
            if (!isNaN(u) && invUntaxed > 0) {
              allowanceTaxAmount = String(Math.round(u * invTax / invUntaxed * 100) / 100);
            }
          }}
        />
      </div>
      <div class="form-field">
        <label for="alw-tax">折讓稅額 *</label>
        <input type="number" id="alw-tax" step="0.01" bind:value={allowanceTaxAmount} />
      </div>
      <div class="form-field">
        <label for="alw-ref">電子折讓單號 (選填)</label>
        <input type="text" id="alw-ref" bind:value={allowanceExternalReference} placeholder="平台折讓單號" />
      </div>
      <div class="form-field">
        <label for="alw-note">備註</label>
        <textarea id="alw-note" bind:value={allowanceNote} placeholder="備註說明"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick={() => { isCreateAllowanceModalOpen = false; }}>
          取消
        </button>
        <button class="btn btn-primary" onclick={handleSubmitCreateAllowance} disabled={isSubmitting}>
          {isSubmitting ? '建立中...' : '確認開立'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- VOID ALLOWANCE MODAL -->
{#if isVoidAllowanceModalOpen}
  <div class="modal-backdrop">
    <div class="modal-card glass-panel">
      <h3>作廢折讓單 ({targetAllowanceNumber})</h3>
      {#if voidAllowanceError}
        <div class="error-banner">{voidAllowanceError}</div>
      {/if}
      <p class="text-danger font-bold">作廢折讓單後，原應收帳款未收餘額將恢復，且可能重新出現出貨短少標記。</p>
      <div class="form-field">
        <label for="void-alw-reason">作廢原因 *</label>
        <textarea id="void-alw-reason" bind:value={voidAllowanceReason} placeholder="請輸入作廢原因"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick={() => { isVoidAllowanceModalOpen = false; }}>
          取消
        </button>
        <button class="btn btn-danger" onclick={handleSubmitVoidAllowance} disabled={isSubmitting}>
          {isSubmitting ? '處理中...' : '確認作廢'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .workspace-scrollable {
    overflow-y: auto;
    height: 100%;
    padding: 1.5rem;
  }
  .invoices-container {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .invoices-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.75rem;
  }
  .invoices-tabs-left {
    display: flex;
    gap: 0.5rem;
  }
  .tab-btn {
    background: transparent;
    border: none;
    color: var(--color-text-muted, #94a3b8);
    padding: 0.5rem 1rem;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    transition: all 0.15s ease;
  }
  .tab-btn:hover {
    color: var(--color-text, #f8fafc);
    background: rgba(255, 255, 255, 0.05);
  }
  .tab-btn.active {
    color: var(--color-primary, #38bdf8);
    background: rgba(56, 189, 248, 0.1);
    font-weight: 600;
  }
  .tab-badge {
    background: #3b82f6;
    color: white;
    font-size: 0.75rem;
    padding: 0.1rem 0.45rem;
    border-radius: 9999px;
    font-weight: 600;
  }
  .tab-badge.badge-danger {
    background: #ef4444;
  }
  .filter-panel {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: 8px;
  }
  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }
  .search-group {
    flex: 1;
    min-width: 200px;
  }
  .input-search {
    width: 100%;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: inherit;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
  }
  .summary-box {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.875rem;
  }
  .table-container {
    overflow-x: auto;
    border-radius: 8px;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    text-align: left;
  }
  .data-table th, .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }
  .data-table th {
    background: rgba(255, 255, 255, 0.03);
    font-weight: 600;
    color: var(--color-text-muted, #94a3b8);
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--color-primary, #38bdf8);
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    padding: 0;
    text-decoration: underline;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
  }
  .kpi-card {
    padding: 1rem;
    border-radius: 8px;
  }
  .kpi-title {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 0.35rem;
  }
  .kpi-value {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .kpi-sub {
    font-size: 0.8rem;
    color: #64748b;
    margin-top: 0.25rem;
  }
  .section-card {
    padding: 1.25rem;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .section-header h3 {
    margin: 0;
    font-size: 1.1rem;
  }
  .section-header .text-muted {
    font-size: 0.85rem;
  }
  .empty-panel {
    padding: 3rem;
    text-align: center;
    color: #94a3b8;
  }
  .empty-sub {
    font-style: italic;
    padding: 1rem 0;
  }
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-radius: 8px;
  }
  .banner-danger {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
  }
  .banner-warning {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.4);
  }
  .banner-title {
    font-weight: 700;
    font-size: 0.95rem;
    display: block;
    margin-bottom: 0.25rem;
  }
  .banner-content p {
    margin: 0;
    font-size: 0.875rem;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.25rem;
  }
  .detail-card {
    padding: 1.5rem;
    border-radius: 8px;
  }
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 1rem;
    margin-bottom: 1rem;
  }
  .detail-header h2 {
    margin: 0.25rem 0 0 0;
    font-family: monospace;
  }
  .info-rows {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    font-size: 0.9rem;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
  }
  .highlight-row {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 0.5rem;
    font-size: 1.05rem;
  }
  .detail-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .side-column {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .sub-card {
    padding: 1.25rem;
    border-radius: 8px;
  }
  .sub-card h3 {
    margin-top: 0;
    font-size: 1rem;
    margin-bottom: 0.75rem;
  }
  .sub-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .sub-table th, .sub-table td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .create-form-card {
    padding: 1.5rem;
    border-radius: 8px;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    margin: 1.25rem 0;
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.875rem;
  }
  .form-field input, .form-field select, .form-field textarea {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: inherit;
    padding: 0.5rem;
    border-radius: 6px;
  }
  .orders-selection-section {
    margin: 1.5rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 1rem;
  }
  .so-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .so-checkbox-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .so-info {
    flex: 1;
    font-size: 0.875rem;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 1rem;
  }
  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid #ef4444;
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-card {
    background: #1e293b;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 1.5rem;
    width: 90%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .badge {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .badge-emerald { background: rgba(16, 185, 129, 0.2); color: #34d399; }
  .badge-amber { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
  .badge-rose { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
  .badge-blue { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
  .badge-slate { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; }
  .badge-warning { background: #f59e0b; color: #1e293b; }
  .badge-danger { background: #ef4444; color: white; }
  .badge-muted { background: rgba(255, 255, 255, 0.1); color: #94a3b8; }
  .badge-lg { font-size: 0.85rem; padding: 0.35rem 0.75rem; }
  .tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s ease;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary { background: #0284c7; color: white; }
  .btn-primary:hover:not(:disabled) { background: #0369a1; }
  .btn-secondary { background: rgba(255, 255, 255, 0.1); color: white; }
  .btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); }
  .btn-danger { background: #dc2626; color: white; }
  .btn-danger:hover:not(:disabled) { background: #b91c1c; }
  .btn-sm { padding: 0.25rem 0.6rem; font-size: 0.8rem; }
</style>

