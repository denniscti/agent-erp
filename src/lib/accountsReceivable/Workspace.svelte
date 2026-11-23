<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    formatCurrency,
    formatTime,
    fetchPartners,
    loadReceivablesAgingAction,
    loadAccountsReceivableAction
  } from '../store.svelte.js';
  import OpeningReceivablesWorkspace from '../openingReceivables/Workspace.svelte';
  import CustomerReceiptsWorkspace from '../customerReceipts/Workspace.svelte';
  import CustomerCreditWorkspace from '../customerCredits/Workspace.svelte';

  let { initialSubTab = 'aging' } = $props();

  // Sub tab: 'aging' | 'opening-receivables' | 'customer-receipts' | 'accounts-receivable' | 'customer-credit'
  let activeSubTab = $state(initialSubTab);

  // Auxiliary data
  let availableCustomers = $state([]);
  let isLoading = $state(false);

  // ==========================================
  // Aging States (Issue #228)
  // ==========================================
  let receivablesAging = $state(null);
  let isAgingLoading = $state(false);
  let selectedAgingCustomerId = $state(null);
  let filterCustomerId = $state('');
  let searchQuery = $state('');

  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  let asOfDate = $state(getTodayDateString());

  async function refreshAging() {
    isAgingLoading = true;
    try {
      receivablesAging = await loadReceivablesAgingAction(asOfDate);
    } catch (err) {
      console.error('Failed to load receivables aging:', err);
      showToast('載入應收帳齡分析失敗：' + (err.message || err), 'error');
    } finally {
      isAgingLoading = false;
    }
  }

  async function loadCustomers() {
    try {
      const partners = await fetchPartners();
      availableCustomers = (partners || []).filter(p => p.isCustomer || p.is_customer);
    } catch (err) {
      console.error('Failed to load customers:', err);
    }
  }

  // Selected customer drill-down
  let selectedAgingCustomer = $derived.by(() => {
    if (!receivablesAging || !selectedAgingCustomerId) return null;
    return (receivablesAging.customers || []).find(c => c.customer_partner_id === selectedAgingCustomerId) || null;
  });

  // Filtered customer aging list
  let filteredCustomers = $derived.by(() => {
    if (!receivablesAging || !receivablesAging.customers) return [];
    let list = receivablesAging.customers;
    if (filterCustomerId) {
      list = list.filter(c => c.customer_partner_id === filterCustomerId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(c =>
        (c.customer_name || '').toLowerCase().includes(q) ||
        (c.customer_partner_id || '').toLowerCase().includes(q)
      );
    }
    return list;
  });

  // All Accounts Receivable subtab states
  let filterArCustomerId = $state('');
  let filterArSettlementStatus = $state('all');
  let filterArStatus = $state('all');
  let isArLoading = $state(false);
  let allArList = $derived(appState.accountsReceivable || []);

  async function refreshAccountsReceivable() {
    isArLoading = true;
    try {
      const filter = {};
      if (filterArCustomerId) filter.customer_partner_id = filterArCustomerId;
      if (filterArSettlementStatus !== 'all') filter.settlement_status = filterArSettlementStatus;
      if (filterArStatus !== 'all') filter.status = filterArStatus;
      await loadAccountsReceivableAction(filter);
    } catch (err) {
      console.error('Failed to load accounts receivable list:', err);
      showToast('載入應收帳款清單失敗：' + (err.message || err), 'error');
    } finally {
      isArLoading = false;
    }
  }

  onMount(async () => {
    await loadCustomers();
    if (activeSubTab === 'aging') {
      await refreshAging();
    } else if (activeSubTab === 'accounts-receivable') {
      await refreshAccountsReceivable();
    }
  });

  function openCustomerDrilldown(customerId) {
    selectedAgingCustomerId = customerId;
  }

  function closeCustomerDrilldown() {
    selectedAgingCustomerId = null;
  }

  function goToCustomerCredit(customerId) {
    activeSubTab = 'customer-credit';
  }

  function goToCustomerReceipt(customerId) {
    activeSubTab = 'customer-receipts';
  }
</script>

<div class="accounts-receivable-workspace">
  <!-- Top Navigation Subtabs -->
  <header class="workspace-header">
    <div class="header-title">
      <h2>應收帳款管理</h2>
      <p class="subtitle">M14 財務專屬應收帳款工作區：帳齡分段分析、未開票監控與信用管理</p>
    </div>

    <div class="subtabs-bar">
      <button
        class="subtab-btn {activeSubTab === 'aging' ? 'active' : ''}"
        onclick={() => { activeSubTab = 'aging'; refreshAging(); }}
        id="tab-ar-aging"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        應收帳齡分析
      </button>

      <button
        class="subtab-btn {activeSubTab === 'opening-receivables' ? 'active' : ''}"
        onclick={() => { activeSubTab = 'opening-receivables'; }}
        id="tab-ar-opening"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        期初應收帳款
      </button>

      <button
        class="subtab-btn {activeSubTab === 'customer-receipts' ? 'active' : ''}"
        onclick={() => { activeSubTab = 'customer-receipts'; }}
        id="tab-ar-receipts"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="20" height="14" x="2" y="5" rx="2"></rect>
          <line x1="2" x2="22" y1="10" y2="10"></line>
        </svg>
        客戶收款單
      </button>

      <button
        class="subtab-btn {activeSubTab === 'accounts-receivable' ? 'active' : ''}"
        onclick={() => { activeSubTab = 'accounts-receivable'; refreshAccountsReceivable(); }}
        id="tab-ar-all"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
        應收帳款明細
      </button>

      <button
        class="subtab-btn {activeSubTab === 'customer-credit' ? 'active' : ''}"
        onclick={() => { activeSubTab = 'customer-credit'; }}
        id="tab-ar-credits"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
        客戶信用與開票設定
      </button>
    </div>
  </header>

  <!-- ======================================================== -->
  <!-- SUBTAB 1: Aging Analysis View (Issue #228)               -->
  <!-- ======================================================== -->
  {#if activeSubTab === 'aging'}
    <div class="aging-view">
      <!-- KPI Overview Cards -->
      <div class="kpi-grid">
        <div class="kpi-card" id="kpi-total-outstanding">
          <span class="kpi-title">總未收餘額 (已扣折讓)</span>
          <span class="kpi-value text-danger font-mono font-bold">
            {formatCurrency(receivablesAging?.totals?.total_outstanding || 0)}
          </span>
          <span class="kpi-sub font-mono">計算基準日：{receivablesAging?.as_of_date || asOfDate}</span>
        </div>

        <div class="kpi-card" id="kpi-current">
          <span class="kpi-title">正常未到期 (≤ 0 天)</span>
          <span class="kpi-value text-success font-mono font-bold">
            {formatCurrency(receivablesAging?.totals?.current || 0)}
          </span>
          <span class="kpi-sub">未到期正常帳款</span>
        </div>

        <div class="kpi-card" id="kpi-overdue">
          <span class="kpi-title">總逾期金額 (> 0 天)</span>
          <span class="kpi-value text-warning font-mono font-bold">
            {formatCurrency(
              ((receivablesAging?.totals?.overdue_1_30 || 0) +
               (receivablesAging?.totals?.overdue_31_60 || 0) +
               (receivablesAging?.totals?.overdue_61_90 || 0) +
               (receivablesAging?.totals?.overdue_90_plus || 0))
            )}
          </span>
          <span class="kpi-sub">包含 1-30, 31-60, 61-90, 90+ 天</span>
        </div>

        <div class="kpi-card kpi-reference" id="kpi-uninvoiced">
          <span class="kpi-title">未開票銷售單 (參考欄)</span>
          <span class="kpi-value text-primary font-mono font-bold">
            {formatCurrency(receivablesAging?.totals?.uninvoiced_amount || 0)}
          </span>
          <span class="kpi-sub">
            (a) {formatCurrency(receivablesAging?.totals?.uninvoiced_group_a || 0)} |
            (b) {formatCurrency(receivablesAging?.totals?.uninvoiced_group_b || 0)} |
            (c) {formatCurrency(receivablesAging?.totals?.uninvoiced_group_c || 0)}
          </span>
        </div>
      </div>

      <!-- Toolbar & Filters -->
      <div class="toolbar">
        <div class="filters">
          <div class="filter-group">
            <label for="input-as-of-date">帳齡基準日：</label>
            <input
              type="date"
              id="input-as-of-date"
              bind:value={asOfDate}
              onchange={refreshAging}
            />
          </div>

          <div class="filter-group">
            <label for="select-filter-customer">客戶篩選：</label>
            <select id="select-filter-customer" bind:value={filterCustomerId}>
              <option value="">全部客戶</option>
              {#each availableCustomers as cust}
                <option value={cust.id}>{cust.name}</option>
              {/each}
            </select>
          </div>

          <div class="filter-group">
            <input
              type="text"
              id="input-search-aging"
              placeholder="搜尋客戶名稱或 ID..."
              bind:value={searchQuery}
            />
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary btn-sm" onclick={refreshAging} id="btn-refresh-aging" disabled={isAgingLoading}>
            {isAgingLoading ? '計算中...' : '重新整理'}
          </button>
        </div>
      </div>

      <!-- Main Aging Table -->
      <div class="table-container">
        {#if isAgingLoading}
          <div class="empty-state">
            <p>正在載入應收帳款帳齡分析資料...</p>
          </div>
        {:else if !receivablesAging || !filteredCustomers || filteredCustomers.length === 0}
          <div class="empty-state">
            <p>目前尚無符合條件的客戶應收帳款或未開票資料。</p>
          </div>
        {:else}
          <table class="data-table" id="table-receivables-aging">
            <thead>
              <tr>
                <th>客戶名稱</th>
                <th class="text-right">未收餘額 (已扣折讓)</th>
                <th class="text-right">正常未到期 (≤0天)</th>
                <th class="text-right">逾期 1-30 天</th>
                <th class="text-right">逾期 31-60 天</th>
                <th class="text-right">逾期 61-90 天</th>
                <th class="text-right">逾期 90+ 天</th>
                <th class="text-right bg-ref">未開票參考欄 (依三組)</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredCustomers as c}
                <tr class="customer-row {selectedAgingCustomerId === c.customer_partner_id ? 'row-selected' : ''}">
                  <td class="font-medium">
                    <button
                      class="btn-link-customer"
                      onclick={() => openCustomerDrilldown(c.customer_partner_id)}
                      title="點擊檢視單據明細"
                    >
                      {c.customer_name || c.customer_partner_id}
                    </button>
                  </td>
                  <td class="text-right font-mono font-bold {c.total_outstanding > 0 ? 'text-danger' : ''}">
                    {formatCurrency(c.total_outstanding)}
                  </td>
                  <td class="text-right font-mono {c.current > 0 ? 'text-success font-medium' : 'text-muted'}">
                    {formatCurrency(c.current)}
                  </td>
                  <td class="text-right font-mono {c.overdue_1_30 > 0 ? 'text-warning font-medium' : 'text-muted'}">
                    {formatCurrency(c.overdue_1_30)}
                  </td>
                  <td class="text-right font-mono {c.overdue_31_60 > 0 ? 'text-warning font-medium' : 'text-muted'}">
                    {formatCurrency(c.overdue_31_60)}
                  </td>
                  <td class="text-right font-mono {c.overdue_61_90 > 0 ? 'text-danger font-medium' : 'text-muted'}">
                    {formatCurrency(c.overdue_61_90)}
                  </td>
                  <td class="text-right font-mono {c.overdue_90_plus > 0 ? 'text-danger font-bold' : 'text-muted'}">
                    {formatCurrency(c.overdue_90_plus)}
                  </td>
                  <td class="text-right font-mono bg-ref">
                    <span class="uninvoiced-badge" title="未開票合計：{formatCurrency(c.uninvoiced_amount)} (依單確認: {formatCurrency(c.uninvoiced_group_a)}, 依單出貨: {formatCurrency(c.uninvoiced_group_b)}, 月結: {formatCurrency(c.uninvoiced_group_c)})">
                      {formatCurrency(c.uninvoiced_amount)}
                    </span>
                  </td>
                  <td class="text-center actions-cell">
                    <button
                      class="btn-action"
                      onclick={() => openCustomerDrilldown(c.customer_partner_id)}
                      id="btn-view-customer-aging"
                      title="檢視未收帳款明細"
                    >
                      明細
                    </button>
                    <button
                      class="btn-action text-primary"
                      onclick={() => goToCustomerReceipt(c.customer_partner_id)}
                      id="btn-action-receipt"
                      title="前往收款"
                    >
                      收款
                    </button>
                    <button
                      class="btn-action text-info"
                      onclick={() => goToCustomerCredit(c.customer_partner_id)}
                      id="btn-action-credit"
                      title="前往客戶信用設定 (正式收款條件與開票模式)"
                    >
                      信用 ↗
                    </button>
                  </td>
                </tr>
              {/each}

              <!-- Grand Totals Row -->
              <tr class="row-total">
                <td class="font-bold">合計</td>
                <td class="text-right font-mono font-bold text-danger">
                  {formatCurrency(receivablesAging.totals.total_outstanding)}
                </td>
                <td class="text-right font-mono font-bold">
                  {formatCurrency(receivablesAging.totals.current)}
                </td>
                <td class="text-right font-mono font-bold">
                  {formatCurrency(receivablesAging.totals.overdue_1_30)}
                </td>
                <td class="text-right font-mono font-bold">
                  {formatCurrency(receivablesAging.totals.overdue_31_60)}
                </td>
                <td class="text-right font-mono font-bold">
                  {formatCurrency(receivablesAging.totals.overdue_61_90)}
                </td>
                <td class="text-right font-mono font-bold">
                  {formatCurrency(receivablesAging.totals.overdue_90_plus)}
                </td>
                <td class="text-right font-mono font-bold text-muted bg-ref">
                  {formatCurrency(receivablesAging.totals.uninvoiced_amount)}
                </td>
                <td class="text-center font-bold text-muted">-</td>
              </tr>
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Customer Detail Drilldown Panel -->
      {#if selectedAgingCustomer}
        <div class="drilldown-panel glass-panel">
          <div class="drilldown-header">
            <div class="drilldown-title">
              <h3>{selectedAgingCustomer.customer_name} — 帳款與開票明細</h3>
              <span class="badge badge-info">客戶代碼：{selectedAgingCustomer.customer_partner_id}</span>
            </div>
            <div class="drilldown-actions">
              <button
                class="btn btn-secondary btn-sm"
                onclick={() => goToCustomerCredit(selectedAgingCustomer.customer_partner_id)}
                id="btn-drilldown-customer-credit"
              >
                客戶信用與開票設定 ↗
              </button>
              <button
                class="btn btn-primary btn-sm"
                onclick={() => goToCustomerReceipt(selectedAgingCustomer.customer_partner_id)}
                id="btn-drilldown-receipt"
              >
                前往客戶收款
              </button>
              <button class="btn btn-close" onclick={closeCustomerDrilldown} title="關閉明細">✕</button>
            </div>
          </div>

          <!-- Aging Chips -->
          <div class="aging-chips-row">
            <div class="chip">
              <span class="chip-label">未收餘額 (已扣折讓)</span>
              <span class="chip-val font-mono text-danger font-bold">{formatCurrency(selectedAgingCustomer.total_outstanding)}</span>
            </div>
            <div class="chip">
              <span class="chip-label">正常未到期</span>
              <span class="chip-val font-mono">{formatCurrency(selectedAgingCustomer.current)}</span>
            </div>
            <div class="chip">
              <span class="chip-label">逾期 1-30 天</span>
              <span class="chip-val font-mono">{formatCurrency(selectedAgingCustomer.overdue_1_30)}</span>
            </div>
            <div class="chip">
              <span class="chip-label">逾期 31-60 天</span>
              <span class="chip-val font-mono">{formatCurrency(selectedAgingCustomer.overdue_31_60)}</span>
            </div>
            <div class="chip">
              <span class="chip-label">逾期 61-90 天</span>
              <span class="chip-val font-mono">{formatCurrency(selectedAgingCustomer.overdue_61_90)}</span>
            </div>
            <div class="chip">
              <span class="chip-label">逾期 90+ 天</span>
              <span class="chip-val font-mono">{formatCurrency(selectedAgingCustomer.overdue_90_plus)}</span>
            </div>
            <div class="chip bg-ref">
              <span class="chip-label">未開票 (a:確認 / b:出貨 / c:月結)</span>
              <span class="chip-val font-mono">
                {formatCurrency(selectedAgingCustomer.uninvoiced_amount)}
                <span class="text-xs text-muted">
                  ({formatCurrency(selectedAgingCustomer.uninvoiced_group_a)} / {formatCurrency(selectedAgingCustomer.uninvoiced_group_b)} / {formatCurrency(selectedAgingCustomer.uninvoiced_group_c)})
                </span>
              </span>
            </div>
          </div>

          <!-- Detail Items Table -->
          <div class="drilldown-table-container">
            <h4>未收應收帳款清單 ({selectedAgingCustomer.items.length})</h4>
            {#if selectedAgingCustomer.items.length === 0}
              <p class="text-muted text-sm py-4">此客戶目前無未清償之應收帳款（僅有未開票銷售單或款項已清償）。</p>
            {:else}
              <table class="data-table" id="table-drilldown-items">
                <thead>
                  <tr>
                    <th>來源單號</th>
                    <th>類別</th>
                    <th>原單據日</th>
                    <th>到期日</th>
                    <th class="text-right">逾期天數</th>
                    <th class="text-center">帳齡區間</th>
                    <th class="text-right">原始金額</th>
                    <th class="text-right text-muted">已折讓</th>
                    <th class="text-right text-muted">已收金額</th>
                    <th class="text-right font-bold">未收餘額</th>
                    <th class="text-center">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {#each selectedAgingCustomer.items as item}
                    <tr>
                      <td class="font-mono font-medium">{item.source_number || item.account_receivable_id}</td>
                      <td>
                        <span class="badge {item.source_type === 'opening_balance' ? 'badge-info' : 'badge-primary'}">
                          {item.source_type === 'opening_balance' ? '期初帳款' : '銷項發票'}
                        </span>
                      </td>
                      <td class="font-mono text-sm">{item.document_date}</td>
                      <td class="font-mono text-sm">{item.due_date}</td>
                      <td class="text-right font-mono {item.overdue_days > 0 ? 'text-danger font-bold' : 'text-success'}">
                        {item.overdue_days > 0 ? `逾期 ${item.overdue_days} 天` : (item.overdue_days === 0 ? '今天到期' : `尚有 ${Math.abs(item.overdue_days)} 天`)}
                      </td>
                      <td class="text-center">
                        <span class="badge {item.bucket === 'current' ? 'badge-success' : (item.bucket === '1-30' ? 'badge-warning' : 'badge-danger')}">
                          {item.bucket}
                        </span>
                      </td>
                      <td class="text-right font-mono">{formatCurrency(item.amount)}</td>
                      <td class="text-right font-mono text-muted">{item.allowance_amount > 0 ? `-${formatCurrency(item.allowance_amount)}` : '$0'}</td>
                      <td class="text-right font-mono text-muted">{item.received_amount > 0 ? formatCurrency(item.received_amount) : '$0'}</td>
                      <td class="text-right font-mono font-bold text-danger">{formatCurrency(item.outstanding_amount)}</td>
                      <td class="text-center">
                        <span class="badge {item.settlement_status === 'paid' ? 'badge-success' : (item.settlement_status === 'partially_paid' ? 'badge-warning' : 'badge-secondary')}">
                          {item.settlement_status === 'paid' ? '已收清' : (item.settlement_status === 'partially_paid' ? '部分收款' : '未收款')}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        </div>
      {/if}
    </div>

  <!-- ======================================================== -->
  <!-- SUBTAB 2: Opening Receivables                            -->
  <!-- ======================================================== -->
  {:else if activeSubTab === 'opening-receivables'}
    <div class="embedded-subtab">
      <OpeningReceivablesWorkspace />
    </div>

  <!-- ======================================================== -->
  <!-- SUBTAB 3: Customer Receipts                              -->
  <!-- ======================================================== -->
  {:else if activeSubTab === 'customer-receipts'}
    <div class="embedded-subtab">
      <CustomerReceiptsWorkspace />
    </div>

  <!-- ======================================================== -->
  <!-- SUBTAB 4: All Accounts Receivable List                   -->
  <!-- ======================================================== -->
  {:else if activeSubTab === 'accounts-receivable'}
    <div class="ar-list-view">
      <div class="toolbar">
        <div class="filters">
          <div class="filter-group">
            <label for="select-ar-customer">客戶：</label>
            <select id="select-ar-customer" bind:value={filterArCustomerId} onchange={refreshAccountsReceivable}>
              <option value="">全部客戶</option>
              {#each availableCustomers as cust}
                <option value={cust.id}>{cust.name}</option>
              {/each}
            </select>
          </div>

          <div class="filter-group">
            <label for="select-ar-status">狀態：</label>
            <select id="select-ar-status" bind:value={filterArStatus} onchange={refreshAccountsReceivable}>
              <option value="all">全部狀態</option>
              <option value="open">未結 (Open)</option>
              <option value="voided">已作廢 (Voided)</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="select-ar-settlement">結清狀態：</label>
            <select id="select-ar-settlement" bind:value={filterArSettlementStatus} onchange={refreshAccountsReceivable}>
              <option value="all">全部結清狀態</option>
              <option value="unpaid">未收款 (Unpaid)</option>
              <option value="partially_paid">部分收款 (Partially Paid)</option>
              <option value="paid">已收清 (Paid)</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary btn-sm" onclick={refreshAccountsReceivable} disabled={isArLoading}>
            {isArLoading ? '載入中...' : '重新整理'}
          </button>
        </div>
      </div>

      <div class="table-container">
        {#if isArLoading}
          <div class="empty-state"><p>正在載入應收帳款明細...</p></div>
        {:else if allArList.length === 0}
          <div class="empty-state"><p>無符合篩選條件的應收帳款記錄。</p></div>
        {:else}
          <table class="data-table" id="table-all-receivables">
            <thead>
              <tr>
                <th>單號</th>
                <th>客戶名稱</th>
                <th>來源類別</th>
                <th>原單據日</th>
                <th>到期日</th>
                <th class="text-right">原始金額</th>
                <th class="text-right text-muted">已折讓</th>
                <th class="text-right text-muted">已收金額</th>
                <th class="text-right font-bold">未收餘額</th>
                <th class="text-center">狀態</th>
                <th class="text-center">結清狀態</th>
              </tr>
            </thead>
            <tbody>
              {#each allArList as ar}
                <tr class={ar.status === 'voided' ? 'row-voided' : ''}>
                  <td class="font-mono font-medium">{ar.source_number || ar.id}</td>
                  <td>{ar.customer_name_snapshot || ar.customer_partner_id}</td>
                  <td>
                    <span class="badge {ar.source_type === 'opening_balance' ? 'badge-info' : 'badge-primary'}">
                      {ar.source_type === 'opening_balance' ? '期初應收' : '銷項發票'}
                    </span>
                  </td>
                  <td class="font-mono text-sm">{ar.document_date}</td>
                  <td class="font-mono text-sm">{ar.due_date}</td>
                  <td class="text-right font-mono">{formatCurrency(ar.amount)}</td>
                  <td class="text-right font-mono text-muted">{ar.allowance_amount > 0 ? `-${formatCurrency(ar.allowance_amount)}` : '$0'}</td>
                  <td class="text-right font-mono text-muted">{ar.received_amount > 0 ? formatCurrency(ar.received_amount) : '$0'}</td>
                  <td class="text-right font-mono font-bold {ar.outstanding_amount > 0 ? 'text-danger' : ''}">
                    {formatCurrency(ar.outstanding_amount)}
                  </td>
                  <td class="text-center">
                    <span class="badge {ar.status === 'open' ? 'badge-success' : 'badge-danger'}">
                      {ar.status === 'open' ? '有效' : '已作廢'}
                    </span>
                  </td>
                  <td class="text-center">
                    <span class="badge {ar.settlement_status === 'paid' ? 'badge-success' : (ar.settlement_status === 'partially_paid' ? 'badge-warning' : 'badge-secondary')}">
                      {ar.settlement_status === 'paid' ? '已收清' : (ar.settlement_status === 'partially_paid' ? '部分收款' : '未收款')}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>

  <!-- ======================================================== -->
  <!-- SUBTAB 5: Customer Credit Workspace (#219)               -->
  <!-- ======================================================== -->
  {:else if activeSubTab === 'customer-credit'}
    <div class="embedded-subtab">
      <CustomerCreditWorkspace />
    </div>
  {/if}
</div>

<style>
  .accounts-receivable-workspace {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .workspace-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    border-bottom: 1px solid var(--border-color, #e9ecef);
    padding-bottom: 1rem;
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

  .subtabs-bar {
    display: flex;
    gap: 0.5rem;
    background: #f1f5f9;
    padding: 0.25rem;
    border-radius: 8px;
    flex-wrap: wrap;
  }

  .subtab-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    border: none;
    background: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    color: #475569;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subtab-btn:hover {
    background: #e2e8f0;
    color: #1e293b;
  }

  .subtab-btn.active {
    background: #ffffff;
    color: #0284c7;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .kpi-card.kpi-reference {
    background: #f8fafc;
    border-left: 4px solid #0284c7;
  }

  .kpi-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .kpi-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
    line-height: 1.2;
  }

  .kpi-sub {
    font-size: 0.6875rem;
    color: #94a3b8;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-card, #fff);
    padding: 0.875rem 1rem;
    border-radius: 8px;
    border: 1px solid var(--border-color, #e9ecef);
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .filters {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    flex-wrap: wrap;
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

  .filter-group select, .filter-group input {
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--border-color, #ced4da);
    background: var(--bg-input, #fff);
    font-size: 0.875rem;
  }

  /* Tables */
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

  .data-table tr.row-total {
    background-color: #f1f5f9;
    border-top: 2px solid #cbd5e1;
  }

  .data-table tr.row-selected {
    background-color: #e0f2fe;
  }

  .data-table tr.row-voided {
    opacity: 0.6;
    background: #fdfdfe;
  }

  .bg-ref {
    background-color: #f8fafc;
  }

  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .font-mono { font-family: monospace; }
  .font-medium { font-weight: 500; }
  .font-bold { font-weight: 700; }
  .text-muted { color: #64748b; }
  .text-danger { color: #dc2626; }
  .text-warning { color: #d97706; }
  .text-success { color: #16a34a; }
  .text-primary { color: #0284c7; }
  .text-info { color: #0284c7; }
  .text-xs { font-size: 0.75rem; }
  .text-sm { font-size: 0.875rem; }

  .btn-link-customer {
    background: none;
    border: none;
    color: #0284c7;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }

  .btn-action {
    background: none;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    cursor: pointer;
    margin: 0 0.125rem;
    background: #ffffff;
  }

  .btn-action:hover {
    background: #f1f5f9;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-sm {
    padding: 0.25rem 0.625rem;
    font-size: 0.8125rem;
  }

  .btn-primary {
    background: #0284c7;
    color: #fff;
  }

  .btn-secondary {
    background: #e2e8f0;
    color: #334155;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 1.125rem;
    cursor: pointer;
    color: #64748b;
  }

  .badge {
    display: inline-block;
    padding: 0.1875rem 0.4375rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 4px;
    background: #e2e8f0;
    color: #475569;
  }

  .badge-primary { background: #e0f2fe; color: #0369a1; }
  .badge-success { background: #dcfce7; color: #15803d; }
  .badge-warning { background: #fef3c7; color: #b45309; }
  .badge-danger { background: #fee2e2; color: #b91c1c; }
  .badge-info { background: #e0f2fe; color: #0284c7; }

  .uninvoiced-badge {
    background: #f1f5f9;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8125rem;
    color: #0369a1;
    border: 1px solid #cbd5e1;
  }

  .empty-state {
    padding: 3rem 1rem;
    text-align: center;
    color: #64748b;
  }

  /* Drilldown Panel */
  .drilldown-panel {
    margin-top: 1.5rem;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .drilldown-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .drilldown-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .drilldown-title h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .drilldown-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .aging-chips-row {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }

  .chip {
    padding: 0.5rem 0.75rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .chip-label {
    font-size: 0.6875rem;
    color: #64748b;
  }

  .chip-val {
    font-size: 0.9375rem;
  }

  .drilldown-table-container h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.95rem;
    font-weight: 600;
  }
</style>

