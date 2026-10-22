<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    fetchPurchaseOrders,
    fetchPurchaseOrderDetail,
    fetchInventoryLevels,
    fetchInventoryMovements,
    navigateToTask
  } from '../store.svelte.js';

  // Active view tab: 'orders' | 'inventory'
  let activeSubTab = $state('orders');
  let selectedStatusFilter = $state('all');
  let selectedOrderId = $state(null);
  let orderDetailLoading = $state(false);
  let orderDetailError = $state('');

  // Inventory breakdown state: unit_id that is currently expanded
  let expandedInventoryUnitId = $state(null);
  let unitMovementsLoading = $state(false);
  let unitMovements = $state([]);

  let isLoading = $state(false);

  // Sync subtab with current route
  $effect(() => {
    if (appState.route.startsWith('/app/inventory')) {
      activeSubTab = 'inventory';
    } else {
      activeSubTab = 'orders';
    }
  });

  onMount(async () => {
    await reloadData();
  });

  async function reloadData() {
    isLoading = true;
    try {
      await Promise.all([
        fetchPurchaseOrders(),
        fetchInventoryLevels()
      ]);
    } catch (err) {
      console.error("Failed to load purchase orders workspace data:", err);
    } finally {
      isLoading = false;
    }
  }

  function handleTabSwitch(tab) {
    activeSubTab = tab;
    selectedOrderId = null;
    expandedInventoryUnitId = null;
    if (tab === 'inventory') {
      navigate('/app/inventory');
    } else {
      navigate('/app/purchase-orders');
    }
  }

  // Filtered orders derived state
  let filteredOrders = $derived(
    appState.purchaseOrders.filter(order => {
      if (selectedStatusFilter === 'all') return true;
      return order.status === selectedStatusFilter;
    })
  );

  // Order counts by status
  let orderCounts = $derived({
    all: appState.purchaseOrders.length,
    draft: appState.purchaseOrders.filter(o => o.status === 'draft').length,
    ordered: appState.purchaseOrders.filter(o => o.status === 'ordered').length,
    received: appState.purchaseOrders.filter(o => o.status === 'received').length,
    cancelled: appState.purchaseOrders.filter(o => o.status === 'cancelled').length
  });

  async function handleSelectOrder(orderId) {
    selectedOrderId = orderId;
    orderDetailLoading = true;
    orderDetailError = '';
    try {
      await fetchPurchaseOrderDetail(orderId);
    } catch (err) {
      orderDetailError = err.message || '無法載入採購單明細';
    } finally {
      orderDetailLoading = false;
    }
  }

  function handleBackToList() {
    selectedOrderId = null;
    appState.currentPurchaseOrderDetail = null;
  }

  async function handleToggleUnitBreakdown(unitId) {
    if (expandedInventoryUnitId === unitId) {
      expandedInventoryUnitId = null;
      unitMovements = [];
      return;
    }
    expandedInventoryUnitId = unitId;
    unitMovementsLoading = true;
    try {
      const list = await fetchInventoryMovements(unitId);
      unitMovements = list || [];
    } catch (err) {
      console.error("Failed to fetch movements for unit:", err);
      unitMovements = [];
    } finally {
      unitMovementsLoading = false;
    }
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatCurrency(amount) {
    const val = Number(amount || 0);
    return `NT$ ${val.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'draft':
        return { label: '草稿 (Draft)', class: 'badge-slate' };
      case 'ordered':
        return { label: '已下單 (Ordered)', class: 'badge-amber' };
      case 'received':
        return { label: '已到貨 (Received)', class: 'badge-emerald' };
      case 'cancelled':
        return { label: '已取消 (Cancelled)', class: 'badge-red' };
      default:
        return { label: status || '未知', class: 'badge-slate' };
    }
  }

  function formatMovementReason(reason) {
    if (reason === 'opening_balance') return '期初開帳';
    if (reason === 'purchase_receipt') return '採購單入庫';
    return reason;
  }

  // Calculate cumulative inventory history for breakdown view
  let cumulativeMovements = $derived(() => {
    let running = 0;
    return unitMovements.map(m => {
      running += m.quantity_delta;
      return {
        ...m,
        cumulative_quantity: running
      };
    });
  });

  // Check if inventory is completely empty (no movements & no quantities)
  let isInventoryEmpty = $derived(
    appState.inventoryLevels.length === 0 ||
    appState.inventoryLevels.every(item => item.current_quantity === 0)
  );
</script>

<div class="workspace-container">
  <!-- Top Workspace Header & Tabs -->
  <header class="workspace-header glass-panel">
    <div class="header-left">
      <div class="header-title-row">
        <h2 class="workspace-title">採購管理與庫存中心</h2>
        <span class="badge badge-cyan">邊緣防禦 SQLite</span>
      </div>
      <p class="workspace-subtitle">檢視既有採購單據生命週期、狀態歷程與商品單位即時庫存量。</p>
    </div>

    <div class="header-right">
      <nav class="subtab-nav" aria-label="採購與庫存切換">
        <button
          class="subtab-btn {activeSubTab === 'orders' ? 'active' : ''}"
          onclick={() => handleTabSwitch('orders')}
          id="tab-btn-orders"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
            <path d="M3 6h18"></path>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
          採購單清單
          {#if appState.purchaseOrders.length > 0}
            <span class="subtab-count">{appState.purchaseOrders.length}</span>
          {/if}
        </button>

        <button
          class="subtab-btn {activeSubTab === 'inventory' ? 'active' : ''}"
          onclick={() => handleTabSwitch('inventory')}
          id="tab-btn-inventory"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
          庫存量查詢
          {#if appState.inventoryLevels.length > 0}
            <span class="subtab-count">{appState.inventoryLevels.length}</span>
          {/if}
        </button>
      </nav>

      <button class="btn btn-sm" onclick={reloadData} title="重新整理資料" aria-label="重新整理">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
        重新整理
      </button>
    </div>
  </header>

  <div class="workspace-content">
    <!-- ==================================================== -->
    <!-- SUBTAB 1: 採購單清單視圖 (Purchase Orders List / Detail) -->
    <!-- ==================================================== -->
    {#if activeSubTab === 'orders'}
      {#if selectedOrderId && appState.currentPurchaseOrderDetail}
        <!-- Purchase Order Detail View -->
        {@const detail = appState.currentPurchaseOrderDetail}
        {@const order = detail.order}
        {@const lines = detail.lines || []}
        <div class="detail-container glass-panel">
          <div class="detail-header-bar">
            <div class="detail-header-left">
              <button class="btn btn-sm btn-back" onclick={handleBackToList} id="btn-back-to-orders">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                返回採購單清單
              </button>
              <div class="detail-title-group">
                <span class="detail-po-number">{order.po_number}</span>
                <span class="badge {getStatusBadge(order.status).class}">
                  {getStatusBadge(order.status).label}
                </span>
                {#if order.task_id}
                  <button
                    class="link-task-btn"
                    onclick={() => navigateToTask(order.task_id)}
                    title="點擊切換至建立此採購單的 AI 任務對話"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    回到來源對話
                  </button>
                {/if}
              </div>
            </div>

            <div class="detail-header-right">
              <span class="total-label">總金額：</span>
              <span class="total-amount-highlight">{formatCurrency(order.total_amount)}</span>
            </div>
          </div>

          <!-- Order Summary Cards -->
          <div class="detail-meta-grid">
            <div class="meta-card">
              <span class="meta-label">供應商</span>
              <span class="meta-value font-bold">{order.vendor_name_snapshot || '-'}</span>
            </div>
            <div class="meta-card">
              <span class="meta-label">結算幣別</span>
              <span class="meta-value">{order.currency || 'TWD'}</span>
            </div>
            <div class="meta-card">
              <span class="meta-label">預計到貨日</span>
              <span class="meta-value">{formatTime(order.expected_date)}</span>
            </div>
            <div class="meta-card">
              <span class="meta-label">單據備註</span>
              <span class="meta-value">{order.note || '無備註'}</span>
            </div>
          </div>

          <!-- Status Timeline Cards -->
          <div class="timeline-section">
            <h4 class="section-subtitle">狀態變動時間歷程</h4>
            <div class="timeline-grid">
              <div class="timeline-card {order.created_at ? 'active' : ''}">
                <div class="timeline-marker">1</div>
                <div class="timeline-content">
                  <span class="timeline-title">建立時間 (Created)</span>
                  <span class="timeline-time">{formatTime(order.created_at)}</span>
                </div>
              </div>

              <div class="timeline-card {order.ordered_at ? 'active' : ''}">
                <div class="timeline-marker">2</div>
                <div class="timeline-content">
                  <span class="timeline-title">送出訂購 (Ordered)</span>
                  <span class="timeline-time">{formatTime(order.ordered_at)}</span>
                </div>
              </div>

              <div class="timeline-card {order.received_at ? 'active' : ''}">
                <div class="timeline-marker">3</div>
                <div class="timeline-content">
                  <span class="timeline-title">到貨驗收 (Received)</span>
                  <span class="timeline-time">{formatTime(order.received_at)}</span>
                </div>
              </div>

              {#if order.cancelled_at}
                <div class="timeline-card active cancelled">
                  <div class="timeline-marker">✕</div>
                  <div class="timeline-content">
                    <span class="timeline-title">取消單據 (Cancelled)</span>
                    <span class="timeline-time">{formatTime(order.cancelled_at)}</span>
                  </div>
                </div>
              {/if}
            </div>
          </div>

          <!-- Line Items Table -->
          <div class="detail-lines-section">
            <div class="lines-header-row">
              <h4 class="section-subtitle">採購商品明細 ({lines.length} 項)</h4>
              {#if order.status === 'received'}
                <span class="badge badge-emerald">已於到貨日完成庫存流水帳入庫</span>
              {/if}
            </div>

            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>商品名稱</th>
                    <th>規格/變體</th>
                    <th>SKU</th>
                    <th>單位</th>
                    <th class="text-right">訂購量</th>
                    <th class="text-right">實到量</th>
                    <th class="text-right">採購單價</th>
                    <th class="text-right">小計</th>
                  </tr>
                </thead>
                <tbody>
                  {#if lines.length === 0}
                    <tr>
                      <td colspan="9" class="text-center empty-cell">此採購單尚無任何品項明細</td>
                    </tr>
                  {:else}
                    {#each lines as line, index}
                      <tr>
                        <td>{line.line_no || index + 1}</td>
                        <td class="font-bold">{line.product_name_snapshot}</td>
                        <td>{line.variant_name_snapshot || '-'}</td>
                        <td class="text-muted">{line.sku_snapshot || '-'}</td>
                        <td><span class="unit-tag">{line.unit_name_snapshot}</span></td>
                        <td class="text-right font-medium">{line.quantity}</td>
                        <td class="text-right">
                          {#if order.status === 'received'}
                            {#if line.received_quantity !== undefined && line.received_quantity !== null}
                              {#if line.received_quantity < line.quantity}
                                <div class="qty-warning-box text-amber">
                                  <span class="qty-num">{line.received_quantity}</span>
                                  <span class="badge badge-amber badge-diff" title="實到數量少於訂購數量">
                                    少到 {line.quantity - line.received_quantity}
                                  </span>
                                </div>
                              {:else if line.received_quantity > line.quantity}
                                <div class="qty-warning-box text-amethyst">
                                  <span class="qty-num">{line.received_quantity}</span>
                                  <span class="badge badge-amethyst badge-diff" title="實到數量多於訂購數量">
                                    多到 {line.received_quantity - line.quantity}
                                  </span>
                                </div>
                              {:else}
                                <div class="qty-ok-box text-emerald">
                                  <span class="qty-num">{line.received_quantity}</span>
                                  <span class="badge badge-emerald badge-diff">全數到貨</span>
                                </div>
                              {/if}
                            {:else}
                              <span class="text-muted">-</span>
                            {/if}
                          {:else}
                            <span class="text-muted">尚未到貨</span>
                          {/if}
                        </td>
                        <td class="text-right">{formatCurrency(line.purchase_cost)}</td>
                        <td class="text-right font-bold">{formatCurrency(line.subtotal)}</td>
                      </tr>
                    {/each}
                  {/if}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      {:else}
        <!-- Purchase Orders Filter Bar -->
        <div class="filter-bar glass-panel">
          <div class="filter-group">
            <span class="filter-label">狀態篩選：</span>
            <div class="filter-pills" role="tablist">
              <button
                class="pill-btn {selectedStatusFilter === 'all' ? 'active' : ''}"
                onclick={() => selectedStatusFilter = 'all'}
                id="filter-all"
              >
                全部 ({orderCounts.all})
              </button>
              <button
                class="pill-btn {selectedStatusFilter === 'draft' ? 'active' : ''}"
                onclick={() => selectedStatusFilter = 'draft'}
                id="filter-draft"
              >
                草稿 ({orderCounts.draft})
              </button>
              <button
                class="pill-btn {selectedStatusFilter === 'ordered' ? 'active' : ''}"
                onclick={() => selectedStatusFilter = 'ordered'}
                id="filter-ordered"
              >
                已下單 ({orderCounts.ordered})
              </button>
              <button
                class="pill-btn {selectedStatusFilter === 'received' ? 'active' : ''}"
                onclick={() => selectedStatusFilter = 'received'}
                id="filter-received"
              >
                已到貨 ({orderCounts.received})
              </button>
              <button
                class="pill-btn {selectedStatusFilter === 'cancelled' ? 'active' : ''}"
                onclick={() => selectedStatusFilter = 'cancelled'}
                id="filter-cancelled"
              >
                已取消 ({orderCounts.cancelled})
              </button>
            </div>
          </div>
        </div>

        <!-- Orders Table or Empty State -->
        {#if filteredOrders.length === 0}
          <div class="empty-state-panel glass-panel">
            <div class="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
            </div>
            
            {#if appState.purchaseOrders.length === 0}
              <h3 class="empty-state-title">目前尚無任何採購單記錄</h3>
              <p class="empty-state-desc">
                採購單建立與推進支援「AI 任務對話」與「手動表單」兩種入口，共用同一套底層 Rust 核心防禦與庫存流水帳機制。
              </p>
              <div class="empty-actions-row">
                <button
                  class="btn btn-primary"
                  onclick={() => navigate('/app/agent')}
                  id="empty-btn-chat"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  透過 AI 任務對話建立
                </button>
                <button
                  class="btn"
                  onclick={() => {
                    showToast('採購單手動建立與狀態推進表單即將於 Issue #172 提供');
                    navigate('/app/purchase-orders/new');
                  }}
                  id="empty-btn-form"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  前往手動表單建立
                </button>
              </div>
            {:else}
              <h3 class="empty-state-title">無符合「{selectedStatusFilter}」狀態的採購單</h3>
              <p class="empty-state-desc">目前篩選條件下沒有找到任何採購單據。</p>
              <button class="btn btn-sm" onclick={() => selectedStatusFilter = 'all'}>
                清除篩選條件
              </button>
            {/if}
          </div>
        {:else}
          <div class="table-container glass-panel">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>採購單號</th>
                    <th>供應商</th>
                    <th>建立時間</th>
                    <th>狀態</th>
                    <th class="text-right">合計金額</th>
                    <th>任務對話</th>
                    <th class="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredOrders as order}
                    <tr class="clickable-row" onclick={() => handleSelectOrder(order.id)}>
                      <td class="font-bold po-col">
                        <button
                          class="link-po-number"
                          onclick={(e) => { e.stopPropagation(); handleSelectOrder(order.id); }}
                          title="查看採購單明細"
                        >
                          {order.po_number}
                        </button>
                      </td>
                      <td>{order.vendor_name_snapshot || '-'}</td>
                      <td class="text-muted">{formatTime(order.created_at)}</td>
                      <td>
                        <span class="badge {getStatusBadge(order.status).class}">
                          {getStatusBadge(order.status).label}
                        </span>
                      </td>
                      <td class="text-right font-bold total-col">
                        {formatCurrency(order.total_amount)}
                      </td>
                      <td>
                        {#if order.task_id && String(order.task_id).trim()}
                          <button
                            class="link-task-btn"
                            onclick={(e) => {
                              e.stopPropagation();
                              navigateToTask(order.task_id);
                            }}
                            title="連到建立此單據的 Task 對話"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            回到對話
                          </button>
                        {:else}
                          <span class="text-muted">-</span>
                        {/if}
                      </td>
                      <td class="text-right">
                        <button
                          class="btn btn-sm btn-view-detail"
                          onclick={(e) => {
                            e.stopPropagation();
                            handleSelectOrder(order.id);
                          }}
                        >
                          查看明細
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      {/if}

    <!-- ==================================================== -->
    <!-- SUBTAB 2: 庫存量查詢視圖 (Inventory Levels & Breakdown) -->
    <!-- ==================================================== -->
    {:else if activeSubTab === 'inventory'}
      {#if isInventoryEmpty}
        <div class="empty-state-panel glass-panel">
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </div>
          <h3 class="empty-state-title">目前尚無任何庫存異動紀錄</h3>
          <p class="empty-state-desc">
            尚未有期初開帳或採購單入庫紀錄。您可以透過手動表單提供的入口進行期初開帳，建立第一個庫存基準點。
          </p>
          <div class="empty-actions-row">
            <button
              class="btn btn-primary"
              onclick={() => {
                showToast('期初開帳表單即將於 Issue #172 提供');
                navigate('/app/inventory/opening-balance');
              }}
              id="empty-btn-opening-balance"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              前往「期初開帳」建立底帳
            </button>
          </div>
        </div>
      {:else}
        <div class="table-container glass-panel">
          <div class="inventory-info-banner">
            <div class="banner-text">
              <span class="badge badge-cyan">流水帳即時加總</span>
              <span>庫存量依商品各計量單位分開列示（遵循 #157 ADR，不跨單位折算）。點擊庫存數字可展開查看組成流水帳。</span>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>商品名稱</th>
                  <th>規格/變體</th>
                  <th>SKU</th>
                  <th>單位</th>
                  <th class="text-right">目前庫存量 (點擊看組成)</th>
                </tr>
              </thead>
              <tbody>
                {#each appState.inventoryLevels as item}
                  <tr class="inventory-row {expandedInventoryUnitId === item.unit_id ? 'row-expanded' : ''}">
                    <td class="font-bold">{item.product_name || '-'}</td>
                    <td>{item.variant_name || '-'}</td>
                    <td class="text-muted">{item.sku || '-'}</td>
                    <td><span class="unit-tag">{item.unit_name || '-'}</span></td>
                    <td class="text-right">
                      <button
                        class="btn-expand-breakdown {item.current_quantity > 0 ? 'qty-positive' : 'qty-zero'}"
                        onclick={() => handleToggleUnitBreakdown(item.unit_id)}
                        title="點擊展開此數字由來明細"
                      >
                        <span class="breakdown-qty-value">{item.current_quantity}</span>
                        <span class="breakdown-hint">
                          {expandedInventoryUnitId === item.unit_id ? '收合組成 ▲' : '展開組成 ▼'}
                        </span>
                      </button>
                    </td>
                  </tr>

                  {#if expandedInventoryUnitId === item.unit_id}
                    <tr class="breakdown-expanded-row">
                      <td colspan="5" class="breakdown-container-cell">
                        <div class="movement-breakdown-card">
                          <div class="breakdown-header">
                            <div class="breakdown-title-row">
                              <span class="font-bold">庫存數字組成明細：</span>
                              <span>{item.product_name} - {item.variant_name} ({item.unit_name})</span>
                            </div>
                            <span class="badge badge-cyan">依建立時間 (created_at) 排序</span>
                          </div>

                          {#if unitMovementsLoading}
                            <div class="loading-state">正在載入流水帳...</div>
                          {:else if unitMovements.length === 0}
                            <div class="empty-movements">此單位目前尚無流水帳異動紀錄。</div>
                          {:else}
                            <div class="movements-summary-bar">
                              <span>歷史異動摘要：</span>
                              <div class="summary-chips">
                                {#each cumulativeMovements() as mov, i}
                                  <span class="summary-chip">
                                    {formatMovementReason(mov.reason)}
                                    <strong class="{mov.quantity_delta >= 0 ? 'text-emerald' : 'text-red'}">
                                      {mov.quantity_delta >= 0 ? `+${mov.quantity_delta}` : mov.quantity_delta}
                                    </strong>
                                  </span>
                                  {#if i < unitMovements.length - 1}
                                    <span class="summary-arrow">→</span>
                                  {/if}
                                {/each}
                                <span class="summary-chip summary-total">
                                  共 <strong>{item.current_quantity}</strong> {item.unit_name}
                                </span>
                              </div>
                            </div>

                            <table class="nested-movement-table">
                              <thead>
                                <tr>
                                  <th>異動原因</th>
                                  <th class="text-right">異動數量</th>
                                  <th class="text-right">累計庫存</th>
                                  <th>異動時間</th>
                                  <th>關聯單據 (Reference)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {#each cumulativeMovements() as mov}
                                  <tr>
                                    <td>
                                      <span class="reason-tag {mov.reason === 'opening_balance' ? 'reason-opening' : 'reason-po'}">
                                        {formatMovementReason(mov.reason)}
                                      </span>
                                    </td>
                                    <td class="text-right font-bold {mov.quantity_delta >= 0 ? 'text-emerald' : 'text-red'}">
                                      {mov.quantity_delta >= 0 ? `+${mov.quantity_delta}` : mov.quantity_delta}
                                    </td>
                                    <td class="text-right font-medium text-muted">
                                      {mov.cumulative_quantity}
                                    </td>
                                    <td class="text-muted">{formatTime(mov.created_at)}</td>
                                    <td>
                                      {#if mov.reference_id}
                                        {#if mov.reference_type === 'purchase_order'}
                                          <button
                                            class="link-po-ref"
                                            onclick={() => {
                                              activeSubTab = 'orders';
                                              navigate('/app/purchase-orders');
                                              handleSelectOrder(mov.reference_id);
                                            }}
                                            title="點擊前往檢視對應採購單明細"
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                              <polyline points="15 3 21 3 21 9"></polyline>
                                              <line x1="10" y1="14" x2="21" y2="3"></line>
                                            </svg>
                                            採購單：{mov.reference_id}
                                          </button>
                                        {:else}
                                          <span class="text-muted">{mov.reference_id}</span>
                                        {/if}
                                      {:else}
                                        <span class="text-muted">-</span>
                                      {/if}
                                    </td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .workspace-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px;
    gap: 16px;
    overflow-y: auto;
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .workspace-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .workspace-subtitle {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .subtab-nav {
    display: flex;
    align-items: center;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 3px;
    gap: 4px;
  }

  .subtab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .subtab-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.05);
  }

  .subtab-btn.active {
    background: rgba(var(--accent-cyan), 0.16);
    color: rgb(var(--accent-cyan));
    border: 1px solid rgba(var(--accent-cyan), 0.3);
  }

  .subtab-count {
    background: rgba(255, 255, 255, 0.12);
    padding: 1px 6px;
    border-radius: 9999px;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .workspace-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex-grow: 1;
  }

  /* Filter Bar */
  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .filter-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .filter-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pill-btn {
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-color);
    border-radius: 9999px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .pill-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .pill-btn.active {
    background: rgba(var(--accent-cyan), 0.18);
    color: rgb(var(--accent-cyan));
    border-color: rgba(var(--accent-cyan), 0.4);
    font-weight: 600;
  }

  /* Tables */
  .table-container {
    padding: 0;
    overflow: hidden;
  }

  .table-responsive {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    text-align: left;
  }

  .data-table th {
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.25);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border-color);
  }

  .data-table td {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
  }

  .clickable-row {
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .clickable-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .text-right {
    text-align: right;
  }

  .text-center {
    text-align: center;
  }

  .font-bold {
    font-weight: 600;
  }

  .font-medium {
    font-weight: 500;
  }

  .text-muted {
    color: var(--text-muted);
  }

  .po-col {
    color: rgb(var(--accent-cyan));
  }

  .link-po-number {
    background: transparent;
    border: none;
    color: rgb(var(--accent-cyan));
    font-weight: 600;
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .link-po-number:hover {
    text-decoration-style: solid;
    color: #FFFFFF;
  }

  .total-col {
    color: rgb(var(--accent-emerald));
  }

  .link-task-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: rgba(var(--accent-amethyst), 0.12);
    color: rgb(var(--accent-amethyst));
    border: 1px solid rgba(var(--accent-amethyst), 0.25);
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .link-task-btn:hover {
    background: rgba(var(--accent-amethyst), 0.25);
    border-color: rgba(var(--accent-amethyst), 0.5);
    color: #FFFFFF;
  }

  .unit-tag {
    display: inline-block;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  /* Empty States */
  .empty-state-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    text-align: center;
    gap: 12px;
  }

  .empty-state-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .empty-state-title {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-state-desc {
    font-size: 0.88rem;
    color: var(--text-secondary);
    max-width: 520px;
    line-height: 1.6;
  }

  .empty-actions-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* Detail View Styles */
  .detail-container {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .detail-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap;
    gap: 12px;
  }

  .detail-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .detail-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .detail-po-number {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .detail-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .total-label {
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .total-amount-highlight {
    font-size: 1.3rem;
    font-weight: 700;
    color: rgb(var(--accent-emerald));
  }

  .detail-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .meta-card {
    padding: 12px 14px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .meta-value {
    font-size: 0.95rem;
    color: var(--text-primary);
  }

  .section-subtitle {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .timeline-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .timeline-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    opacity: 0.6;
    transition: all var(--transition-fast);
  }

  .timeline-card.active {
    opacity: 1;
    border-color: rgba(var(--accent-cyan), 0.35);
    background: rgba(var(--accent-cyan), 0.05);
  }

  .timeline-card.cancelled {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.05);
  }

  .timeline-marker {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-secondary);
  }

  .timeline-card.active .timeline-marker {
    background: rgb(var(--accent-cyan));
    color: #0F1015;
  }

  .timeline-card.cancelled .timeline-marker {
    background: #EF4444;
    color: #FFFFFF;
  }

  .timeline-content {
    display: flex;
    flex-direction: column;
  }

  .timeline-title {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .timeline-time {
    font-size: 0.85rem;
    color: var(--text-primary);
    font-family: monospace;
  }

  .lines-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  /* Quantity differences */
  .qty-warning-box, .qty-ok-box {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
  }

  .qty-num {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .badge-diff {
    font-size: 0.7rem;
    padding: 1px 6px;
  }

  .text-emerald {
    color: rgb(var(--accent-emerald));
  }

  .text-amber {
    color: rgb(var(--accent-amber));
  }

  .text-amethyst {
    color: rgb(var(--accent-amethyst));
  }

  .text-red {
    color: #EF4444;
  }

  .badge-red {
    background: rgba(239, 68, 68, 0.15);
    color: #EF4444;
  }

  /* Inventory & Movement Breakdown Styles */
  .inventory-info-banner {
    padding: 12px 16px;
    background: rgba(var(--accent-cyan), 0.06);
    border-bottom: 1px solid var(--border-color);
  }

  .banner-text {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .btn-expand-breakdown {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-expand-breakdown:hover {
    background: rgba(var(--accent-cyan), 0.1);
    border-color: rgba(var(--accent-cyan), 0.3);
  }

  .breakdown-qty-value {
    font-weight: 700;
    font-size: 0.95rem;
  }

  .qty-positive .breakdown-qty-value {
    color: rgb(var(--accent-emerald));
  }

  .qty-zero .breakdown-qty-value {
    color: var(--text-muted);
  }

  .breakdown-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .row-expanded {
    background: rgba(255, 255, 255, 0.02);
  }

  .breakdown-expanded-row {
    background: rgba(0, 0, 0, 0.3);
  }

  .breakdown-container-cell {
    padding: 16px 20px !important;
  }

  .movement-breakdown-card {
    background: rgba(21, 22, 30, 0.85);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .breakdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .breakdown-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    color: var(--text-primary);
  }

  .movements-summary-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    color: var(--text-secondary);
    flex-wrap: wrap;
  }

  .summary-chips {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .summary-chip {
    padding: 2px 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .summary-total {
    background: rgba(var(--accent-emerald), 0.12);
    border-color: rgba(var(--accent-emerald), 0.3);
    color: rgb(var(--accent-emerald));
  }

  .summary-arrow {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .nested-movement-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  .nested-movement-table th {
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text-muted);
    font-weight: 500;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
  }

  .nested-movement-table td {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .reason-tag {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .reason-opening {
    background: rgba(var(--accent-cyan), 0.12);
    color: rgb(var(--accent-cyan));
    border: 1px solid rgba(var(--accent-cyan), 0.25);
  }

  .reason-po {
    background: rgba(var(--accent-emerald), 0.12);
    color: rgb(var(--accent-emerald));
    border: 1px solid rgba(var(--accent-emerald), 0.25);
  }

  .link-po-ref {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: rgb(var(--accent-cyan));
    font-size: 0.8rem;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .link-po-ref:hover {
    color: #FFFFFF;
    text-decoration-style: solid;
  }

  .loading-state, .empty-movements {
    padding: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
</style>
