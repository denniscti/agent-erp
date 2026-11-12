<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    formatCurrency,
    formatTime,
    fetchPartners,
    fetchWarehouses,
    getWarehouseName,
    fetchUnitInventoryLevel,
    fetchSalesOrders,
    fetchSalesOrderDetail,
    getQuoteDetailReadOnly,
    shipSalesOrderAction,
    cancelSalesOrderAction,
    selectQuote
  } from '../store.svelte.js';
  import {
    getSalesOrderStatusLabel,
    getSalesOrderStatusBadgeClass,
    isSalesOrderTerminal,
    canShipSalesOrder,
    canCancelSalesOrder,
    validateShipDate,
    buildInitialShipLines,
    evaluateShipLines,
    buildShipOrderPayload,
    formatOrderQty
  } from '../salesOrdersHelper.js';

  // View mode: 'list' | 'detail'
  let viewMode = $state('list');

  // Filters
  let filterStatus = $state('all');
  let filterCustomerId = $state('');
  let isLoading = $state(false);
  let errorMsg = $state('');

  // Auxiliary data
  let availableCustomers = $derived(
    (appState.partners || []).filter(
      p =>
        (p.is_customer === true || p.is_customer === 1 || p.is_customer) &&
        p.is_active !== false &&
        p.is_active !== 0
    )
  );

  // Detail state
  let currentDetail = $state(null);
  let isDetailLoading = $state(false);
  let detailError = $state('');
  let actionError = $state('');
  let sourceQuoteNumber = $state('');

  // Ship modal state (倉管出貨表單)
  let isShipModalOpen = $state(false);
  let shipDate = $state('');
  let shipNote = $state('');
  let shipLines = $state([]);
  let isLoadingStock = $state(false);
  let stockLoadError = $state('');
  let shipModalError = $state('');
  let isSubmittingShip = $state(false);

  // Cancel modal state
  let isCancelModalOpen = $state(false);
  let cancelModalError = $state('');
  let isSubmittingCancel = $state(false);

  function getTodayString() {
    return new Date().toISOString().slice(0, 10);
  }

  let currentWarehouseName = $derived.by(() => {
    const wid = currentDetail?.order?.warehouse_id;
    if (!wid) return '出貨倉庫';
    const wh = (appState.warehouses || []).find(w => w.id === wid);
    return wh ? wh.name : wid;
  });

  let shipEvaluation = $derived(evaluateShipLines(shipLines, currentWarehouseName));

  function getActiveListFilter() {
    return {
      status: filterStatus === 'all' ? undefined : filterStatus,
      customer_partner_id: filterCustomerId || undefined
    };
  }

  onMount(async () => {
    isLoading = true;
    try {
      await Promise.all([
        fetchPartners(),
        fetchWarehouses(),
        loadSalesOrdersList()
      ]);
      if (appState.selectedSalesOrderId) {
        const targetId = appState.selectedSalesOrderId;
        appState.selectedSalesOrderId = null;
        await openDetail(targetId);
      }
    } catch (e) {
      errorMsg = e.message || String(e);
    } finally {
      isLoading = false;
    }
  });

  $effect(() => {
    if (appState.selectedSalesOrderId) {
      const targetId = appState.selectedSalesOrderId;
      appState.selectedSalesOrderId = null;
      openDetail(targetId);
    }
  });

  async function loadSalesOrdersList() {
    try {
      await fetchSalesOrders(getActiveListFilter());
    } catch (e) {
      errorMsg = e.message || String(e);
    }
  }

  async function handleFilterChange() {
    isLoading = true;
    errorMsg = '';
    try {
      await loadSalesOrdersList();
    } finally {
      isLoading = false;
    }
  }

  async function clearFilters() {
    filterStatus = 'all';
    filterCustomerId = '';
    await handleFilterChange();
  }

  async function loadSourceQuoteNumber(quoteId) {
    sourceQuoteNumber = '';
    if (!quoteId) return;
    const cached = (appState.quotes || []).find(q => q.id === quoteId);
    if (cached?.quote_number) {
      sourceQuoteNumber = cached.quote_number;
      return;
    }
    try {
      const qDetail = await getQuoteDetailReadOnly(quoteId);
      if (qDetail?.quote?.quote_number) {
        sourceQuoteNumber = qDetail.quote.quote_number;
      }
    } catch (e) {
      // Fallback gracefully to displaying source_quote_id
    }
  }

  async function openDetail(orderId) {
    isDetailLoading = true;
    detailError = '';
    actionError = '';
    sourceQuoteNumber = '';
    isShipModalOpen = false;
    isCancelModalOpen = false;
    viewMode = 'detail';
    try {
      currentDetail = await fetchSalesOrderDetail(orderId);
      if (currentDetail?.order?.source_quote_id) {
        loadSourceQuoteNumber(currentDetail.order.source_quote_id);
      }
    } catch (e) {
      detailError = e.message || String(e);
      currentDetail = null;
    } finally {
      isDetailLoading = false;
    }
  }

  function backToList() {
    viewMode = 'list';
    currentDetail = null;
    detailError = '';
    actionError = '';
    sourceQuoteNumber = '';
    loadSalesOrdersList();
  }

  async function refreshShipModalStock(order, lines) {
    isLoadingStock = true;
    stockLoadError = '';
    try {
      const entries = await Promise.all(
        (lines || []).map(async (line) => {
          const lvl = await fetchUnitInventoryLevel(order.warehouse_id, line.unit_id);
          return [line.unit_id, Number(lvl?.current_quantity ?? 0)];
        })
      );
      const stockMap = Object.fromEntries(entries);
      shipLines = shipLines.map(row => ({
        ...row,
        available_stock: Object.prototype.hasOwnProperty.call(stockMap, row.unit_id)
          ? stockMap[row.unit_id]
          : null
      }));
    } catch (e) {
      stockLoadError = e.message || '無法讀取倉庫即時庫存';
    } finally {
      isLoadingStock = false;
    }
  }

  async function openShipModal() {
    if (!currentDetail || !canShipSalesOrder(currentDetail.order)) return;
    shipDate = getTodayString();
    shipNote = '';
    shipModalError = '';
    stockLoadError = '';
    shipLines = buildInitialShipLines(currentDetail.lines, {});
    isShipModalOpen = true;
    await refreshShipModalStock(currentDetail.order, currentDetail.lines);
  }

  function closeShipModal() {
    if (isSubmittingShip) return;
    isShipModalOpen = false;
    shipModalError = '';
  }

  async function handleConfirmShip(e) {
    if (e) e.preventDefault();
    if (!currentDetail) return;
    const so = currentDetail.order;
    if (!canShipSalesOrder(so)) {
      shipModalError = '目前銷售單狀態不允許出貨';
      return;
    }

    const todayStr = getTodayString();
    const dateCheck = validateShipDate(shipDate, todayStr);
    if (!dateCheck.valid) {
      shipModalError = dateCheck.error;
      return;
    }

    const evalRes = evaluateShipLines(shipLines, currentWarehouseName);
    if (!evalRes.canSubmit) {
      shipModalError = evalRes.blockingError;
      return;
    }

    isSubmittingShip = true;
    shipModalError = '';
    try {
      const payload = buildShipOrderPayload(so.id, dateCheck.resolvedDate, shipLines, undefined, shipNote);
      payload.listFilter = getActiveListFilter();
      const updated = await shipSalesOrderAction(payload);
      currentDetail = updated;
      isShipModalOpen = false;
      showToast(
        updated.order.status === 'shipped'
          ? `銷售單 ${updated.order.so_number} 已完成全部出貨`
          : `銷售單 ${updated.order.so_number} 已完成批次出貨（部分出貨）`
      );
    } catch (err) {
      const msg = err?.message || String(err);
      shipModalError = msg;
      await refreshShipModalStock(so, currentDetail.lines);
    } finally {
      isSubmittingShip = false;
    }
  }

  function openCancelModal() {
    if (!currentDetail || !canCancelSalesOrder(currentDetail.order)) return;
    cancelModalError = '';
    isCancelModalOpen = true;
  }

  function closeCancelModal() {
    if (isSubmittingCancel) return;
    isCancelModalOpen = false;
    cancelModalError = '';
  }

  async function handleConfirmCancel() {
    if (!currentDetail) return;
    const so = currentDetail.order;
    if (!canCancelSalesOrder(so)) {
      cancelModalError = '目前銷售單狀態不可取消';
      return;
    }
    isSubmittingCancel = true;
    cancelModalError = '';
    try {
      const updated = await cancelSalesOrderAction({
        order_id: so.id,
        listFilter: getActiveListFilter()
      });
      currentDetail = updated;
      isCancelModalOpen = false;
      showToast(`銷售單 ${updated.order.so_number} 已取消`);
    } catch (err) {
      cancelModalError = err?.message || String(err);
    } finally {
      isSubmittingCancel = false;
    }
  }
</script>

<div class="sales-orders-workspace-container">
  <!-- Top Workspace Header -->
  <header class="workspace-header">
    <div class="header-title-row">
      <div class="header-left">
        <h2>銷售單管理</h2>
        <span class="header-subtitle">Sales Orders & Warehouse Shipment</span>
      </div>
      <div class="header-actions">
        {#if viewMode === 'detail'}
          <button class="btn btn-secondary" onclick={backToList} id="btn-back-to-so-list">
            ← 返回清單
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => navigate('/app/quotes')}
            id="btn-header-go-quotes"
          >
            前往報價單建立（M13）
          </button>
        {/if}
      </div>
    </div>

    <!-- Filter Bar (when in list mode) -->
    {#if viewMode === 'list'}
      <div class="filter-bar glass-panel">
        <div class="filter-group">
          <label for="so-filter-status">狀態篩選</label>
          <select
            id="so-filter-status"
            bind:value={filterStatus}
            onchange={handleFilterChange}
            class="input-select"
          >
            <option value="all">全部狀態</option>
            <option value="confirmed">已確認 (confirmed)</option>
            <option value="partially_shipped">部分出貨 (partially_shipped)</option>
            <option value="shipped">已出貨 (shipped)</option>
            <option value="cancelled">已取消 (cancelled)</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="so-filter-customer">客戶篩選</label>
          <select
            id="so-filter-customer"
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

  <!-- View Mode 1: Read-Only Sales Orders List -->
  {#if viewMode === 'list'}
    <div class="list-section">
      {#if isLoading}
        <div class="loading-state">載入銷售單清單中...</div>
      {:else if appState.salesOrders.length === 0}
        <div class="empty-state glass-panel" id="so-empty-state">
          <p class="empty-title">目前尚無符合條件的銷售單</p>
          <p class="empty-guide">銷售單僅能由已核准並送出之報價單轉單產生，請從報價單建立。</p>
          <div class="empty-actions">
            <button
              type="button"
              class="btn btn-primary"
              id="btn-go-to-quotes"
              onclick={() => navigate('/app/quotes')}
            >
              前往 M13 報價清單
            </button>
            {#if filterStatus !== 'all' || filterCustomerId !== ''}
              <button
                type="button"
                class="btn btn-secondary"
                id="btn-clear-so-filters"
                onclick={clearFilters}
              >
                清除篩選條件
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="table-container glass-panel">
          <table class="sales-orders-table" id="sales-orders-table">
            <thead>
              <tr>
                <th>銷售單號</th>
                <th>客戶名稱</th>
                <th>出貨倉庫</th>
                <th>預計出貨日</th>
                <th>實際出貨日</th>
                <th>總金額</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each appState.salesOrders as order (order.id)}
                <tr class="so-row" onclick={() => openDetail(order.id)}>
                  <td class="font-bold so-number-cell">{order.so_number}</td>
                  <td>{order.customer_name_snapshot || '—'}</td>
                  <td>{getWarehouseName(order.warehouse_id)}</td>
                  <td>{order.expected_ship_date || '—'}</td>
                  <td>{order.ship_date || '—'}</td>
                  <td class="amount-cell">{order.currency} {formatCurrency(order.total_amount)}</td>
                  <td>
                    <span class="badge {getSalesOrderStatusBadgeClass(order.status)}">
                      {getSalesOrderStatusLabel(order.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      onclick={(e) => { e.stopPropagation(); openDetail(order.id); }}
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

  <!-- View Mode 2: Sales Order Detail (Read-Only Lines + Ship / Cancel) -->
  {#if viewMode === 'detail'}
    {#if isDetailLoading}
      <div class="loading-state">載入銷售單詳細資訊中...</div>
    {:else if detailError}
      <div class="detail-load-error-box glass-panel">
        <div class="alert alert-danger">{detailError}</div>
        <button class="btn btn-secondary" onclick={backToList}>← 返回銷售單清單</button>
      </div>
    {:else if currentDetail}
      {@const so = currentDetail.order}
      {@const isTerminal = isSalesOrderTerminal(so)}

      <div class="detail-container">
        {#if actionError}
          <div class="action-error-banner glass-panel" role="alert" id="so-action-error-banner">
            <div class="action-error-content">
              <span>⚠️</span>
              <span>{actionError}</span>
            </div>
            <button class="btn-close-error" onclick={() => actionError = ''} aria-label="關閉錯誤提示">✕</button>
          </div>
        {/if}

        <!-- Header Card -->
        <div class="so-header-card glass-panel">
          <div class="card-top-row">
            <div class="so-id-block">
              <span class="so-number-title" id="so-detail-number">{so.so_number}</span>
              <span class="badge {getSalesOrderStatusBadgeClass(so.status)}" id="so-detail-status">
                {getSalesOrderStatusLabel(so.status)}
              </span>
            </div>
            <div class="so-actions-row">
              {#if canShipSalesOrder(so)}
                <button
                  type="button"
                  class="btn btn-primary"
                  id="btn-open-ship-modal"
                  onclick={openShipModal}
                >
                  {so.status === 'partially_shipped' ? '繼續出貨' : '出貨'}
                </button>
              {/if}
              {#if canCancelSalesOrder(so)}
                <button
                  type="button"
                  class="btn btn-danger btn-sm"
                  id="btn-open-cancel-so-modal"
                  onclick={openCancelModal}
                >
                  取消銷售單
                </button>
              {/if}
              {#if isTerminal}
                <span class="terminal-tag" id="so-terminal-badge">
                  {so.status === 'cancelled' ? '已取消唯讀（不可再修改）' : '已出貨唯讀（不可再修改）'}
                </span>
              {/if}
            </div>
          </div>

          <div class="header-info-grid">
            <div class="info-item">
              <span class="info-label">往來客戶</span>
              <span class="info-value font-bold">{so.customer_name_snapshot}</span>
            </div>
            <div class="info-item">
              <span class="info-label">出貨倉庫</span>
              <span class="info-value">{getWarehouseName(so.warehouse_id)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">來源報價</span>
              <div class="info-value">
                <button
                  type="button"
                  class="quote-link-btn"
                  id="so-source-quote-link"
                  onclick={() => selectQuote(so.source_quote_id)}
                  title="前往來源報價單詳細頁"
                >
                  🔗 {sourceQuoteNumber ? `${sourceQuoteNumber} (${so.source_quote_id})` : so.source_quote_id}
                </button>
              </div>
            </div>
            <div class="info-item">
              <span class="info-label">客戶採購單號 (PO)</span>
              <span class="info-value">{so.customer_reference || '—'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">預計出貨日</span>
              <span class="info-value">{so.expected_ship_date || '—'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">實際出貨日</span>
              <span class="info-value">{so.ship_date || '—'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">訂單總計金額</span>
              <span class="info-value amount-total">{so.currency} {formatCurrency(so.total_amount)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">確認時間</span>
              <span class="info-value">{formatTime(so.confirmed_at)}</span>
            </div>
            {#if so.status === 'partially_shipped' || so.status === 'shipped'}
              <div class="info-item">
                <span class="info-label">累計已出貨金額</span>
                <span class="info-value font-bold">{so.currency} {formatCurrency(so.shipped_amount)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">最近出貨時間</span>
                <span class="info-value">{so.shipped_at ? formatTime(so.shipped_at) : '—'}</span>
              </div>
            {/if}
            {#if so.status === 'cancelled' && so.cancelled_at}
              <div class="info-item">
                <span class="info-label">取消時間</span>
                <span class="info-value">{formatTime(so.cancelled_at)}</span>
              </div>
            {/if}
            {#if so.note}
              <div class="info-item full-width">
                <span class="info-label">備註說明</span>
                <span class="info-value">{so.note}</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Read-Only Line Items Card -->
        <div class="so-lines-card glass-panel">
          <div class="lines-header">
            <div class="lines-title-group">
              <h3>銷售品項明細</h3>
              <span class="readonly-hint">唯讀明細（品項、訂購數量、單價不可編輯）</span>
            </div>
            <span class="lines-count">共 {currentDetail.lines.length} 項</span>
          </div>

          <div class="table-container">
            <table class="lines-table" id="so-lines-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>商品名稱</th>
                  <th>規格</th>
                  <th>單位</th>
                  <th class="text-right">訂購數量</th>
                  {#if so.status === 'partially_shipped' || so.status === 'shipped'}
                    <th class="text-right">累計已出貨</th>
                    <th class="text-right">剩餘未出</th>
                  {/if}
                  <th class="text-right">單價</th>
                  <th class="text-right">小計金額</th>
                </tr>
              </thead>
              <tbody>
                {#each currentDetail.lines as line (line.id)}
                  {@const cumShipped = Number(line.shipped_quantity || 0)}
                  {@const remainingQty = Math.max(0, Number(line.quantity) - cumShipped)}
                  <tr>
                    <td class="text-muted">{line.line_no}</td>
                    <td class="font-bold">{line.product_name_snapshot}</td>
                    <td>{line.variant_name_snapshot || '單一規格'}</td>
                    <td>{line.unit_name_snapshot}</td>
                    <td class="text-right">{formatOrderQty(line.quantity)}</td>
                    {#if so.status === 'partially_shipped' || so.status === 'shipped'}
                      <td class="text-right">{line.shipped_quantity !== null && line.shipped_quantity !== undefined ? formatOrderQty(line.shipped_quantity) : '0'}</td>
                      <td class="text-right">{formatOrderQty(remainingQty)}</td>
                    {/if}
                    <td class="amount-cell text-right">{formatCurrency(line.unit_price)}</td>
                    <td class="amount-cell font-bold text-right">{formatCurrency(line.subtotal)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Shipment History Card (每次出貨批次紀錄) -->
        <div class="so-lines-card so-shipments-card glass-panel" id="so-shipments-history">
          <div class="lines-header">
            <div class="lines-title-group">
              <h3>出貨紀錄明細</h3>
              <span class="readonly-hint">逐筆記錄每次倉庫實際扣帳出貨批次（總累計不得超過訂購數量）</span>
            </div>
            <span class="lines-count">共 {(currentDetail.shipments || []).length} 筆</span>
          </div>

          {#if !currentDetail.shipments || currentDetail.shipments.length === 0}
            <div class="empty-shipments-hint text-muted">尚無出貨紀錄</div>
          {:else}
            <div class="shipments-list">
              {#each currentDetail.shipments as shp (shp.id)}
                <div class="shipment-record-item" data-shipment-number={shp.shipment_number}>
                  <div class="shipment-record-header">
                    <div class="shipment-record-title">
                      <span class="font-bold">{shp.shipment_number}</span>
                      <span class="summary-sep">·</span>
                      <span>出貨日：{shp.ship_date}</span>
                      <span class="summary-sep">·</span>
                      <span class="text-muted">作業時間：{formatTime(shp.shipped_at)}</span>
                    </div>
                    <div class="shipment-record-meta">
                      {#if shp.note}
                        <span class="shipment-note-tag">備註：{shp.note}</span>
                      {/if}
                      <span class="font-bold">{so.currency} {formatCurrency(shp.total_amount)}</span>
                    </div>
                  </div>
                  <div class="shipment-record-lines">
                    {#each shp.lines as sline (sline.id)}
                      <div class="shipment-record-line">
                        <span>{sline.product_name_snapshot}（{sline.variant_name_snapshot}）</span>
                        <span class="font-bold">本次出貨：{formatOrderQty(sline.shipped_quantity)} {sline.unit_name_snapshot}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<!-- Modal 1: Warehouse Shipment Form (倉管出貨表單) -->
{#if isShipModalOpen && currentDetail}
  {@const so = currentDetail.order}
  <div class="modal-backdrop">
    <div class="modal-dialog modal-dialog-wide glass-panel" id="so-ship-modal" role="dialog" aria-modal="true" aria-labelledby="ship-modal-title">
      <div class="modal-header">
        <h3 id="ship-modal-title">銷售單出貨作業</h3>
        <button class="btn-close" onclick={closeShipModal} aria-label="關閉彈窗">✕</button>
      </div>
      <form onsubmit={handleConfirmShip}>
        <div class="modal-body">
          <div class="info-summary">
            <div>
              <strong>銷售單號：</strong>{so.so_number}
              <span class="summary-sep">·</span>
              <strong>客戶：</strong>{so.customer_name_snapshot}
              <span class="summary-sep">·</span>
              <strong>出貨倉庫：</strong>{getWarehouseName(so.warehouse_id)}
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="ship-date-input">出貨日期 <span class="required">*</span></label>
              <input
                id="ship-date-input"
                type="date"
                bind:value={shipDate}
                max={getTodayString()}
                class="input-text"
              />
            </div>
            <div class="form-group">
              <label for="ship-note-input">出貨備註（選填）</label>
              <input
                id="ship-note-input"
                type="text"
                bind:value={shipNote}
                placeholder="例如：第一批出貨、物流單號..."
                class="input-text"
              />
            </div>
          </div>

          {#if isLoadingStock}
            <div class="stock-loading-hint" id="ship-stock-loading">正在讀取倉庫即時庫存...</div>
          {:else if stockLoadError}
            <div class="alert alert-warning">{stockLoadError}</div>
          {/if}

          <!-- Real-time pre-submit insufficient stock banner -->
          {#if !isLoadingStock && shipEvaluation.hasInsufficientStock}
            <div class="stock-warning-banner" id="ship-stock-warning" role="alert">
              <div class="stock-warning-title">⚠️ 以下明細庫存不足，無法完成出貨：</div>
              <ul class="stock-warning-list">
                {#each shipEvaluation.insufficientLines as item (item.line_id)}
                  <li>{item.message}</li>
                {/each}
              </ul>
            </div>
          {/if}

          <div class="table-container">
            <table class="lines-table" id="ship-lines-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>品項 / 規格</th>
                  <th>單位</th>
                  <th class="text-right">訂購量</th>
                  <th class="text-right">已出 / 剩餘</th>
                  <th class="text-right">現有庫存</th>
                  <th class="text-right" style="width: 140px;">本次出貨數量</th>
                  <th>庫存檢核</th>
                </tr>
              </thead>
              <tbody>
                {#each shipLines as row, idx (row.line_id)}
                  {@const state = shipEvaluation.lineStates[idx]}
                  {@const remainingQty = row.remaining_quantity ?? Math.max(0, Number(row.ordered_quantity) - Number(row.already_shipped || 0))}
                  <tr class={state?.isInsufficientStock ? 'insufficient-stock-row' : ''}>
                    <td class="text-muted">{row.line_no}</td>
                    <td class="font-bold">
                      {row.product_name_snapshot}
                      <div class="variant-subtext text-muted">{row.variant_name_snapshot}</div>
                    </td>
                    <td>{row.unit_name_snapshot}</td>
                    <td class="text-right">{formatOrderQty(row.ordered_quantity)}</td>
                    <td class="text-right">
                      <span class="text-muted">{formatOrderQty(row.already_shipped || 0)} / </span>
                      <span class="font-bold">{formatOrderQty(remainingQty)}</span>
                    </td>
                    <td class="text-right">
                      {#if isLoadingStock}
                        <span class="text-muted">...</span>
                      {:else if row.available_stock !== null}
                        <span class={state?.isInsufficientStock ? 'text-rose font-bold' : ''}>
                          {formatOrderQty(row.available_stock)}
                        </span>
                      {:else}
                        <span class="text-muted">—</span>
                      {/if}
                    </td>
                    <td class="text-right">
                      <input
                        id="ship-qty-input-{row.line_id}"
                        type="number"
                        min="0"
                        max={remainingQty}
                        step="any"
                        bind:value={row.shipped_quantity}
                        class="input-text input-qty-right {state?.isInsufficientStock || state?.inlineError ? 'input-invalid' : ''}"
                      />
                    </td>
                    <td>
                      {#if state?.inlineError}
                        <span class="badge badge-stock-error">{state.inlineError}</span>
                      {:else if state?.isInsufficientStock}
                        <span class="badge badge-stock-error">
                          庫存不足（現有 {formatOrderQty(state.availableStock)}）
                        </span>
                      {:else if remainingQty <= 0 && Number(row.shipped_quantity) === 0}
                        <span class="badge badge-stock-zero">已全數出貨</span>
                      {:else if Number(row.shipped_quantity) === 0}
                        <span class="badge badge-stock-zero">本次不出貨</span>
                      {:else if row.available_stock !== null}
                        <span class="badge badge-stock-ok">庫存充足</span>
                      {:else}
                        <span class="text-muted">—</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if shipModalError}
            <div class="alert alert-danger" id="ship-modal-error">{shipModalError}</div>
          {/if}
        </div>
        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            onclick={closeShipModal}
            disabled={isSubmittingShip}
          >
            取消
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            id="btn-confirm-ship"
            disabled={isSubmittingShip || isLoadingStock}
          >
            {isSubmittingShip ? '出貨處理中...' : '確認出貨'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Modal 2: Cancel Sales Order Confirmation Modal -->
{#if isCancelModalOpen && currentDetail}
  {@const so = currentDetail.order}
  <div class="modal-backdrop">
    <div class="modal-dialog glass-panel" id="so-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-so-modal-title">
      <div class="modal-header">
        <h3 id="cancel-so-modal-title">取消銷售單確認</h3>
        <button class="btn-close" onclick={closeCancelModal} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-prompt-text">
          確定要取消銷售單 <strong>{so.so_number}</strong>（客戶：{so.customer_name_snapshot}）嗎？
        </p>
        <p class="modal-prompt-subtext">
          取消後銷售單將進入結案唯讀狀態（cancelled），不可再進行出貨或任何修改；此操作不會更動庫存流水，來源報價單亦維持已轉單狀態。
        </p>
        {#if cancelModalError}
          <div class="alert alert-danger" id="so-cancel-modal-error">{cancelModalError}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          onclick={closeCancelModal}
          disabled={isSubmittingCancel}
        >
          返回
        </button>
        <button
          type="button"
          class="btn btn-danger"
          id="btn-confirm-cancel-so"
          onclick={handleConfirmCancel}
          disabled={isSubmittingCancel}
        >
          {isSubmittingCancel ? '取消中...' : '確定取消銷售單'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sales-orders-workspace-container {
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

  .table-container {
    overflow-x: auto;
    border-radius: var(--radius-md);
  }

  .sales-orders-table, .lines-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    text-align: left;
  }

  .sales-orders-table th, .lines-table th {
    padding: 12px 16px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-weight: 500;
    border-bottom: 1px solid var(--border-color);
  }

  .sales-orders-table td, .lines-table td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .so-row {
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .so-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .so-number-cell {
    color: var(--accent);
  }

  .amount-cell {
    font-family: monospace;
    font-size: 0.92rem;
  }

  .text-right {
    text-align: right;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
  }

  .badge-so-confirmed {
    background: rgba(59, 130, 246, 0.15);
    color: #60A5FA;
    border: 1px solid rgba(59, 130, 246, 0.35);
  }

  .badge-so-partial {
    background: rgba(245, 158, 11, 0.15);
    color: #FBBF24;
    border: 1px solid rgba(245, 158, 11, 0.35);
  }

  .badge-so-shipped {
    background: rgba(16, 185, 129, 0.15);
    color: #34D399;
    border: 1px solid rgba(16, 185, 129, 0.35);
  }

  .badge-so-cancelled {
    background: rgba(113, 113, 122, 0.15);
    color: #A1A1AA;
    border: 1px solid rgba(113, 113, 122, 0.35);
  }

  .badge-so-default {
    background: rgba(156, 163, 175, 0.15);
    color: #9CA3AF;
    border: 1px solid rgba(156, 163, 175, 0.3);
  }

  .badge-stock-ok {
    background: rgba(16, 185, 129, 0.12);
    color: #34D399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge-stock-zero {
    background: rgba(148, 163, 184, 0.12);
    color: #94A3B8;
    border: 1px solid rgba(148, 163, 184, 0.3);
  }

  .badge-stock-error {
    background: rgba(239, 68, 68, 0.15);
    color: #F87171;
    border: 1px solid rgba(239, 68, 68, 0.35);
  }

  /* Empty State */
  .empty-state, .loading-state {
    padding: 40px;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-title {
    margin: 0 0 8px 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-guide {
    margin: 0 0 18px 0;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }

  .empty-actions {
    display: flex;
    justify-content: center;
    gap: 12px;
  }

  /* Detail Layout */
  .detail-container {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .so-header-card, .so-lines-card {
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

  .so-id-block {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .so-number-title {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .so-actions-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .terminal-tag {
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
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

  .quote-link-btn {
    background: rgba(59, 130, 246, 0.12);
    color: #60A5FA;
    border: 1px solid rgba(59, 130, 246, 0.35);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: 0.84rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .quote-link-btn:hover {
    background: rgba(59, 130, 246, 0.22);
    border-color: rgba(59, 130, 246, 0.6);
  }

  .lines-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .lines-title-group {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .lines-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary);
  }

  .readonly-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .lines-count {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  /* Forms & Inputs */
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
  }

  .form-row .form-group {
    flex: 1;
  }

  .input-select, .input-text {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
    outline: none;
    transition: border var(--transition-fast);
  }

  .input-select:focus, .input-text:focus {
    border-color: var(--accent);
  }

  .input-qty-right {
    width: 110px;
    text-align: right;
  }

  .input-invalid {
    border-color: #EF4444;
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

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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

  .btn-sm {
    padding: 5px 10px;
    font-size: 0.82rem;
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
    max-width: 92vw;
    max-height: 90vh;
    overflow-y: auto;
    padding: 24px;
    border-radius: var(--radius-md);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  }

  .modal-dialog-wide {
    width: 820px;
    max-width: 95vw;
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
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-primary);
  }

  .modal-prompt-subtext {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .info-summary {
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
  }

  .summary-sep {
    margin: 0 8px;
    color: var(--text-muted);
  }

  .stock-loading-hint {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .stock-warning-banner {
    padding: 12px 14px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: var(--radius-sm);
    color: #FCA5A5;
    font-size: 0.86rem;
  }

  .stock-warning-title {
    font-weight: 600;
    margin-bottom: 6px;
  }

  .stock-warning-list {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .insufficient-stock-row {
    background: rgba(239, 68, 68, 0.06);
  }

  .variant-subtext {
    font-size: 0.78rem;
    font-weight: 400;
    margin-top: 2px;
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

  .alert-warning {
    background: rgba(245, 158, 11, 0.1);
    color: #FBBF24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .detail-load-error-box {
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .action-error-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #FCA5A5;
    border-radius: var(--radius-md);
  }

  .action-error-content {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
  }

  .btn-close-error {
    background: transparent;
    border: none;
    color: #FCA5A5;
    cursor: pointer;
    font-size: 1rem;
    padding: 4px 8px;
  }

  .shipments-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .shipment-record-item {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: rgba(15, 23, 42, 0.35);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .shipment-record-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .shipment-record-title,
  .shipment-record-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.88rem;
  }

  .shipment-note-tag {
    background: rgba(59, 130, 246, 0.12);
    color: #93C5FD;
    border: 1px solid rgba(59, 130, 246, 0.28);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 0.78rem;
  }

  .shipment-record-lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-subtle);
  }

  .shipment-record-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }

  .empty-shipments-hint {
    padding: 12px 4px;
    font-size: 0.88rem;
  }

  .text-muted { color: var(--text-muted); }
  .text-rose { color: #F87171; }
  .font-bold { font-weight: 600; }
</style>

