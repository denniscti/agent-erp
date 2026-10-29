<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    fetchWarehouses,
    fetchInventoryLevels,
    fetchInventoryMovements,
    fetchProducts,
    getProductDetailAction,
    createWarehouseAction,
    updateWarehouseAction,
    setDefaultWarehouseAction,
    deactivateWarehouseAction,
    reactivateWarehouseAction,
    recordOpeningInventoryBalanceAction,
    openCreateWarehouseModal,
    closeCreateWarehouseModal,
    selectPurchaseOrder,
    getWarehouseName,
    formatMovementReason,
    formatTime,
    formatCurrency
  } from '../store.svelte.js';

  // Subtabs: 'inventory' | 'warehouses' | 'adjustments' | 'stocktakes' | 'transfers'
  let activeSubTab = $state('inventory');

  // Loading and error states
  let isLoading = $state(false);
  let actionLoading = $state(false);
  let actionError = $state('');
  let warehouseError = $state('');

  // Warehouse filter for inventory query
  let selectedWarehouseId = $state('');

  // Inventory breakdown state
  let expandedUnitId = $state(null);
  let unitMovementsLoading = $state(false);
  let unitMovements = $state([]);
  let allUnitMovements = $state([]);

  // Auxiliary data for opening balance modal
  let availableUnits = $state([]);
  let auxiliaryLoading = $state(false);

  // Opening balance modal state
  let isOpeningBalanceModalOpen = $state(false);
  let openingUnitId = $state('');
  let openingQuantity = $state(1);
  let openingUnitCost = $state(0);
  let openingWarehouseId = $state('');
  let openingModalError = $state('');

  // Warehouse Master Inline Edit State
  let editingWarehouseId = $state(null);
  let editWarehouseCode = $state('');
  let editWarehouseName = $state('');
  let isSavingWarehouse = $state(false);

  // Local state for Create Warehouse Modal
  let newWarehouseCode = $state('');
  let newWarehouseName = $state('');
  let isCreatingWarehouse = $state(false);
  let createWarehouseError = $state('');

  // Derived state
  let activeWarehouses = $derived(
    (appState.warehouses || []).filter(w => w.is_active)
  );

  let defaultWarehouse = $derived(
    (appState.warehouses || []).find(w => w.is_default && w.is_active) || activeWarehouses[0] || null
  );

  let hasZeroWarehouses = $derived(
    (appState.warehouses || []).length === 0
  );

  let isInventoryEmpty = $derived(
    appState.inventoryLevels.length === 0 ||
    appState.inventoryLevels.every(item => item.current_quantity === 0)
  );

  // Sync subtab with route
  $effect(() => {
    const route = appState.route;
    if (route.startsWith('/app/inventory')) {
      activeSubTab = 'inventory';
    } else if (route.includes('/warehouses/master') || route.includes('/warehouses/warehouses')) {
      activeSubTab = 'warehouses';
    } else if (route.includes('/warehouses/adjustments')) {
      activeSubTab = 'adjustments';
    } else if (route.includes('/warehouses/stocktakes')) {
      activeSubTab = 'stocktakes';
    } else if (route.includes('/warehouses/transfers')) {
      activeSubTab = 'transfers';
    } else if (route.startsWith('/app/warehouses')) {
      // Default to inventory view if just /app/warehouses
      if (activeSubTab !== 'warehouses' && activeSubTab !== 'adjustments' && activeSubTab !== 'stocktakes' && activeSubTab !== 'transfers') {
        activeSubTab = 'inventory';
      }
    }
  });

  onMount(async () => {
    await reloadData();
    await loadAuxiliaryData();
  });

  async function reloadData() {
    isLoading = true;
    try {
      await Promise.all([
        fetchWarehouses(),
        fetchInventoryLevels(selectedWarehouseId || null)
      ]);
    } catch (err) {
      console.error("Failed to load warehouse workspace data:", err);
    } finally {
      isLoading = false;
    }
  }

  async function loadAuxiliaryData() {
    auxiliaryLoading = true;
    try {
      const products = await fetchProducts();
      const uList = [];
      for (const prod of (products || [])) {
        try {
          const detail = await getProductDetailAction(prod.id);
          const variantMap = new Map((detail.variants || []).map(v => [v.id, v.name]));
          for (const u of (detail.units || [])) {
            const variantName = variantMap.get(u.variant_id) || '標準';
            uList.push({
              unit_id: u.id,
              product_id: prod.id,
              product_name: prod.name,
              variant_name: variantName,
              unit_name: u.unit_name,
              label: `${prod.name} (${variantName}) - ${u.unit_name}`
            });
          }
        } catch (e) {
          console.error("Failed to load product detail for unit:", prod.id, e);
        }
      }
      availableUnits = uList;
    } catch (err) {
      console.error("Failed to load auxiliary units data:", err);
    } finally {
      auxiliaryLoading = false;
    }
  }

  function handleTabSwitch(tab) {
    activeSubTab = tab;
    actionError = '';
    warehouseError = '';
    expandedUnitId = null;

    if (tab === 'inventory') {
      navigate('/app/inventory');
    } else if (tab === 'warehouses') {
      navigate('/app/warehouses/master');
    } else if (tab === 'adjustments') {
      navigate('/app/warehouses/adjustments');
    } else if (tab === 'stocktakes') {
      navigate('/app/warehouses/stocktakes');
    } else if (tab === 'transfers') {
      navigate('/app/warehouses/transfers');
    }
  }

  async function handleWarehouseFilterChange() {
    expandedUnitId = null;
    unitMovements = [];
    allUnitMovements = [];
    await fetchInventoryLevels(selectedWarehouseId || null);
  }

  async function handleToggleUnitBreakdown(unitId) {
    if (expandedUnitId === unitId) {
      expandedUnitId = null;
      unitMovements = [];
      allUnitMovements = [];
      return;
    }
    expandedUnitId = unitId;
    unitMovementsLoading = true;
    try {
      const [filteredMovements, allMovements] = await Promise.all([
        fetchInventoryMovements(unitId, selectedWarehouseId || null),
        selectedWarehouseId ? fetchInventoryMovements(unitId, null) : Promise.resolve(null)
      ]);
      unitMovements = filteredMovements || [];
      allUnitMovements = allMovements || filteredMovements || [];
    } catch (err) {
      console.error("Failed to fetch unit movements breakdown:", err);
      unitMovements = [];
      allUnitMovements = [];
    } finally {
      unitMovementsLoading = false;
    }
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

  // Calculate warehouse distribution for expanded unit across all warehouses
  let warehouseDistribution = $derived(() => {
    const dist = new Map();
    for (const m of allUnitMovements) {
      const whId = m.warehouse_id || 'unassigned';
      const prev = dist.get(whId) || 0;
      dist.set(whId, prev + m.quantity_delta);
    }
    const result = [];
    for (const [whId, qty] of dist.entries()) {
      const wh = (appState.warehouses || []).find(w => w.id === whId);
      result.push({
        warehouse_id: whId,
        warehouse_name: wh ? wh.name : (whId === 'unassigned' ? '未指定倉' : whId),
        warehouse_code: wh ? wh.code : '',
        is_default: wh ? wh.is_default : false,
        is_active: wh ? wh.is_active : false,
        quantity: qty
      });
    }
    return result;
  });

  // Navigate to purchase order detail from inventory ledger reference
  function handleNavigateToPurchaseOrder(orderId) {
    if (!orderId) return;
    selectPurchaseOrder(orderId);
  }

  // Opening Balance Modal Handlers
  function resetOpeningBalanceForm() {
    openingUnitId = '';
    openingQuantity = 1;
    openingUnitCost = 0;
    openingWarehouseId = defaultWarehouse ? defaultWarehouse.id : (activeWarehouses[0]?.id || '');
    openingModalError = '';
  }

  function openOpeningBalanceModal() {
    resetOpeningBalanceForm();
    if (hasZeroWarehouses) {
      openCreateWarehouseModal(() => {
        resetOpeningBalanceForm();
        isOpeningBalanceModalOpen = true;
      });
      return;
    }
    isOpeningBalanceModalOpen = true;
  }

  function closeOpeningBalanceModal() {
    isOpeningBalanceModalOpen = false;
    resetOpeningBalanceForm();
  }

  async function handleRecordOpeningBalance() {
    openingModalError = '';
    if (!openingUnitId) {
      openingModalError = '請選擇要開帳的商品單位';
      return;
    }
    const qty = Number(openingQuantity);
    if (isNaN(qty) || qty <= 0) {
      openingModalError = '期初開帳數量必須大於 0';
      return;
    }
    const cost = Number(openingUnitCost);
    if (isNaN(cost) || cost < 0) {
      openingModalError = '期初開帳成本不可為負數';
      return;
    }

    actionLoading = true;
    try {
      const targetWh = openingWarehouseId || defaultWarehouse?.id;
      await recordOpeningInventoryBalanceAction({
        unit_id: openingUnitId,
        quantity_delta: qty,
        unit_cost: cost,
        warehouse_id: targetWh || null
      });
      closeOpeningBalanceModal();
      await fetchInventoryLevels(selectedWarehouseId || null);
    } catch (err) {
      // Direct display of Rust O-01 / W-00 error
      openingModalError = err.message || '登記期初開帳失敗';
    } finally {
      actionLoading = false;
    }
  }

  // Warehouse Master Operations
  function handleStartEditWarehouse(wh) {
    editingWarehouseId = wh.id;
    editWarehouseCode = wh.code;
    editWarehouseName = wh.name;
    warehouseError = '';
  }

  function handleCancelEditWarehouse() {
    editingWarehouseId = null;
    editWarehouseCode = '';
    editWarehouseName = '';
  }

  async function handleSaveEditWarehouse(id) {
    warehouseError = '';
    isSavingWarehouse = true;
    try {
      await updateWarehouseAction(id, editWarehouseCode, editWarehouseName);
      editingWarehouseId = null;
    } catch (err) {
      // Direct display of Rust error message
      warehouseError = err.message || '更新倉別失敗';
    } finally {
      isSavingWarehouse = false;
    }
  }

  async function handleSetDefaultWarehouse(id) {
    warehouseError = '';
    try {
      await setDefaultWarehouseAction(id);
    } catch (err) {
      warehouseError = err.message || '設為預設倉失敗';
    }
  }

  async function handleDeactivateWarehouse(id) {
    warehouseError = '';
    try {
      await deactivateWarehouseAction(id);
    } catch (err) {
      // Direct display of Rust W-03 error message
      warehouseError = err.message || '停用倉別失敗';
    }
  }

  async function handleReactivateWarehouse(id) {
    warehouseError = '';
    try {
      await reactivateWarehouseAction(id);
    } catch (err) {
      warehouseError = err.message || '重新啟用倉別失敗';
    }
  }

  // Create Warehouse Modal Actions (Single entry for M12)
  function handleOpenCreateWarehouse() {
    newWarehouseCode = '';
    newWarehouseName = '';
    createWarehouseError = '';
    openCreateWarehouseModal();
  }

  function handleCloseCreateWarehouseModal() {
    closeCreateWarehouseModal();
    createWarehouseError = '';
  }

  async function handleSubmitCreateWarehouse(e) {
    if (e && e.preventDefault) e.preventDefault();
    createWarehouseError = '';
    const code = (newWarehouseCode || '').trim();
    const name = (newWarehouseName || '').trim();
    if (!code) {
      createWarehouseError = '倉別代碼不可空白';
      return;
    }
    if (!name) {
      createWarehouseError = '倉別名稱不可空白';
      return;
    }

    isCreatingWarehouse = true;
    try {
      await createWarehouseAction({ code, name });
      handleCloseCreateWarehouseModal();
      await fetchWarehouses();
      await fetchInventoryLevels(selectedWarehouseId || null);
    } catch (err) {
      // Direct display of Rust W-02 error
      createWarehouseError = err.message || '建立倉庫失敗';
    } finally {
      isCreatingWarehouse = false;
    }
  }
</script>

<div class="warehouse-workspace" id="warehouse-workspace-root">
  <!-- 1. Header Toolbar -->
  <div class="workspace-header glass-panel">
    <div class="workspace-title-row">
      <div class="title-with-badge">
        <h2 class="workspace-title">倉庫管理 (Warehouse Management)</h2>
        <span class="badge badge-amber">M12 倉儲核心</span>
      </div>
      <p class="workspace-subtitle">
        集中管理實體倉別主檔、分倉即時庫存與流水帳異動，統一串接調整單、盤點單與調撥單。
      </p>
    </div>

    <!-- Subtabs Navigation -->
    <div class="subtabs-bar">
      <nav class="subtabs-nav" aria-label="倉庫管理次分頁">
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

        <button
          class="subtab-btn {activeSubTab === 'warehouses' ? 'active' : ''}"
          onclick={() => handleTabSwitch('warehouses')}
          id="tab-btn-warehouses"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          倉別管理
          {#if (appState.warehouses || []).length > 0}
            <span class="subtab-count">{(appState.warehouses || []).length}</span>
          {/if}
        </button>

        <button
          class="subtab-btn {activeSubTab === 'adjustments' ? 'active' : ''}"
          onclick={() => handleTabSwitch('adjustments')}
          id="tab-btn-adjustments"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          調整單
        </button>

        <button
          class="subtab-btn {activeSubTab === 'stocktakes' ? 'active' : ''}"
          onclick={() => handleTabSwitch('stocktakes')}
          id="tab-btn-stocktakes"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            <path d="m9 14 2 2 4-4"></path>
          </svg>
          盤點單
        </button>

        <button
          class="subtab-btn {activeSubTab === 'transfers' ? 'active' : ''}"
          onclick={() => handleTabSwitch('transfers')}
          id="tab-btn-transfers"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          調撥單
        </button>
      </nav>

      <!-- Action Group -->
      <div class="workspace-action-group">
        {#if activeSubTab === 'inventory' && !hasZeroWarehouses}
          <button
            class="btn btn-primary btn-sm"
            onclick={openOpeningBalanceModal}
            id="btn-open-opening-balance-modal"
          >
            + 登記期初底帳
          </button>
        {:else if activeSubTab === 'warehouses'}
          <button
            class="btn btn-primary btn-sm"
            onclick={handleOpenCreateWarehouse}
            id="btn-open-create-warehouse-modal"
          >
            + 新增倉別
          </button>
        {/if}
      </div>
    </div>
  </div>

  <!-- 2. Main Content Area -->
  <div class="workspace-content">
    <!-- SUBTAB 1: 庫存量查詢 -->
    {#if activeSubTab === 'inventory'}
      {#if hasZeroWarehouses}
        <!-- Empty State Guide: Zero Warehouses (W-00 Rule Guide) -->
        <div class="empty-state-panel glass-panel" id="zero-warehouse-empty-state">
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <h3 class="empty-state-title">目前尚未建立任何倉別</h3>
          <p class="empty-state-desc">
            此租戶尚未建立任何實體倉庫。分倉庫存查詢、採購入庫與期初開帳皆需先建立至少一個倉別（第一個建立之倉庫將自動成為預設倉）。
          </p>
          <div class="empty-actions-row">
            <button
              class="btn btn-primary"
              onclick={handleOpenCreateWarehouse}
              id="btn-create-first-warehouse-cta"
            >
              + 建立第一個倉別
            </button>
          </div>
        </div>
      {:else if isInventoryEmpty}
        <!-- Empty State: Has Warehouses, but zero movements -->
        <div class="empty-state-panel glass-panel" id="zero-inventory-empty-state">
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </div>
          <h3 class="empty-state-title">目前尚無任何庫存異動紀錄</h3>
          <p class="empty-state-desc">
            此租戶尚未完成任何採購單入庫，亦無期初開帳紀錄。庫存底帳可由「採購單到貨驗收」自動生成，或由「期初開帳」手動建立基準。
          </p>
          <div class="empty-actions-row">
            <button
              class="btn btn-primary"
              onclick={openOpeningBalanceModal}
              id="empty-inv-btn-opening"
            >
              登記期初底帳
            </button>
          </div>
        </div>
      {:else}
        <!-- Warehouse Filter Bar -->
        <div class="filter-bar glass-panel" style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label for="inv-warehouse-filter" style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">倉庫維度：</label>
            <select
              id="inv-warehouse-filter"
              bind:value={selectedWarehouseId}
              onchange={handleWarehouseFilterChange}
              class="form-select"
              style="width: 220px; padding: 6px 10px; font-size: 0.85rem;"
            >
              <option value="">全部倉庫 (合計總量)</option>
              {#each appState.warehouses as wh}
                <option value={wh.id}>{wh.name} ({wh.code}){wh.is_default ? ' ★ 預設' : ''}{!wh.is_active ? ' (停用)' : ''}</option>
              {/each}
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick={openOpeningBalanceModal}>
            + 登記期初底帳
          </button>
        </div>

        <!-- Inventory Levels Table -->
        <div class="table-container glass-panel">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>商品名稱</th>
                  <th>規格/變體</th>
                  <th>單位</th>
                  <th class="text-right">即時庫存量</th>
                  <th class="text-right">明細</th>
                </tr>
              </thead>
              <tbody>
                {#each appState.inventoryLevels as item}
                  <tr>
                    <td class="font-bold">{item.product_name}</td>
                    <td>{item.variant_name || '-'}</td>
                    <td><span class="unit-tag">{item.unit_name}</span></td>
                    <td class="text-right font-bold qty-col {item.current_quantity > 0 ? 'text-emerald' : 'text-muted'}">
                      {item.current_quantity}
                    </td>
                    <td class="text-right">
                      <button
                        class="btn btn-sm btn-breakdown"
                        onclick={() => handleToggleUnitBreakdown(item.unit_id)}
                        id="btn-breakdown-{item.unit_id}"
                      >
                        {expandedUnitId === item.unit_id ? '收合履歷' : '異動履歷'}
                      </button>
                    </td>
                  </tr>

                  <!-- Expanded Breakdown: Warehouse Distribution + Movements Ledger -->
                  {#if expandedUnitId === item.unit_id}
                    <tr class="breakdown-row">
                      <td colspan="5" class="breakdown-cell">
                        <div class="breakdown-card glass-panel" style="padding: 16px; background: rgba(0, 0, 0, 0.25);">
                          
                          <!-- Warehouse Distribution (選「全部倉」時展開看各倉分佈) -->
                          <div class="distribution-section" style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
                            <h5 style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">
                              🏬 各倉庫存分佈 ({item.product_name} - {item.unit_name})
                            </h5>
                            {#if warehouseDistribution().length === 0}
                              <div style="font-size: 0.8rem; color: var(--text-muted);">尚無各倉分佈紀錄</div>
                            {:else}
                              <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                                {#each warehouseDistribution() as dist}
                                  <div class="warehouse-dist-chip" style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-color);">
                                    <span style="font-weight: 600; color: var(--text-primary); font-size: 0.82rem;">{dist.warehouse_name}</span>
                                    {#if dist.warehouse_code}
                                      <span class="badge badge-slate" style="font-size: 0.7rem; font-family: monospace;">{dist.warehouse_code}</span>
                                    {/if}
                                    {#if dist.is_default}
                                      <span class="badge badge-amber" style="font-size: 0.7rem;">預設</span>
                                    {/if}
                                    <span class="font-bold {dist.quantity > 0 ? 'text-emerald' : 'text-muted'}" style="font-size: 0.85rem; margin-left: 4px;">
                                      {dist.quantity} {item.unit_name}
                                    </span>
                                  </div>
                                {/each}
                              </div>
                            {/if}
                          </div>

                          <!-- Movements Ledger -->
                          <h5 class="breakdown-title" style="margin-bottom: 10px; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                            📜 庫存流水帳異動履歷
                          </h5>

                          {#if unitMovementsLoading}
                            <div class="loading-state">載入異動流水帳中...</div>
                          {:else if unitMovements.length === 0}
                            <div class="empty-movements">尚無任何庫存異動紀錄</div>
                          {:else}
                            <div class="table-responsive">
                              <table class="nested-movement-table">
                                <thead>
                                  <tr>
                                    <th>時間</th>
                                    <th>異動原因</th>
                                    <th>倉別</th>
                                    <th class="text-right">異動數量</th>
                                    <th class="text-right">單位成本</th>
                                    <th class="text-right">異動後累計</th>
                                    <th>關聯單據</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {#each cumulativeMovements() as mov}
                                    <tr>
                                      <td class="text-muted">{formatTime(mov.created_at)}</td>
                                      <td>
                                        <span class="reason-tag reason-{mov.reason}">
                                          {formatMovementReason(mov.reason)}
                                        </span>
                                      </td>
                                      <td>
                                        <span class="unit-tag" style="background: rgba(var(--accent-amber), 0.1); color: rgb(var(--accent-amber)); border: 1px solid rgba(var(--accent-amber), 0.2);">
                                          {getWarehouseName(mov.warehouse_id)}
                                        </span>
                                      </td>
                                      <td class="text-right font-bold {mov.quantity_delta > 0 ? 'text-emerald' : 'text-red'}">
                                        {mov.quantity_delta > 0 ? `+${mov.quantity_delta}` : mov.quantity_delta}
                                      </td>
                                      <td class="text-right">{formatCurrency(mov.unit_cost)}</td>
                                      <td class="text-right font-medium">{mov.cumulative_quantity}</td>
                                      <td>
                                        {#if mov.reference_id}
                                          {#if mov.reason === 'purchase_receipt' || mov.reference_type === 'purchase_order' || mov.reference_id.startsWith('po_')}
                                            <button
                                              class="link-po-ref"
                                              onclick={() => handleNavigateToPurchaseOrder(mov.reference_id)}
                                              title="點擊前往此採購單明細"
                                            >
                                              採購單 #{mov.reference_id.slice(-6)}
                                            </button>
                                          {:else}
                                            <span class="badge badge-slate" style="font-family: monospace;">#{mov.reference_id.slice(-6)}</span>
                                          {/if}
                                        {:else}
                                          <span class="text-muted">-</span>
                                        {/if}
                                      </td>
                                    </tr>
                                  {/each}
                                </tbody>
                              </table>
                            </div>
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

    <!-- SUBTAB 2: 倉別管理 -->
    {:else if activeSubTab === 'warehouses'}
      {#if warehouseError}
        <div class="alert alert-danger" style="margin-bottom: 14px; padding: 10px 14px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.85rem;">
          {warehouseError}
        </div>
      {/if}

      {#if hasZeroWarehouses}
        <!-- Empty State for Warehouses -->
        <div class="empty-state-panel glass-panel">
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <h3 class="empty-state-title">目前尚無倉庫資料</h3>
          <p class="empty-state-desc">
            管理實體倉庫據點與分倉維度。請先新增第一個倉庫（將自動成為開單與開帳的預設倉）。
          </p>
          <div class="empty-actions-row">
            <button
              class="btn btn-primary"
              onclick={handleOpenCreateWarehouse}
              id="btn-create-first-wh"
            >
              + 建立第一個倉別
            </button>
          </div>
        </div>
      {:else}
        <div class="warehouse-list-container glass-panel" style="padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div>
              <h4 style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary);">倉別主檔清單</h4>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                管理分倉維度、預設倉切換與防護停用檢查。
              </p>
            </div>
            <button class="btn btn-primary btn-sm" onclick={handleOpenCreateWarehouse}>
              + 新增倉別
            </button>
          </div>

          <div class="warehouse-items-grid" style="display: flex; flex-direction: column; gap: 10px;">
            {#each appState.warehouses as wh (wh.id)}
              <div class="warehouse-card" style="padding: 12px 16px; border-radius: 8px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                {#if editingWarehouseId === wh.id}
                  <!-- Inline Edit Mode -->
                  <form onsubmit={(e) => { e.preventDefault(); handleSaveEditWarehouse(wh.id); }} style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;">
                    <div style="flex: 1; min-width: 120px;">
                      <label for="edit-wh-code-{wh.id}" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">代碼</label>
                      <input
                        id="edit-wh-code-{wh.id}"
                        type="text"
                        class="form-input"
                        bind:value={editWarehouseCode}
                        style="width: 100%; padding: 6px 8px; font-size: 0.85rem;"
                      />
                    </div>
                    <div style="flex: 1.5; min-width: 160px;">
                      <label for="edit-wh-name-{wh.id}" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">名稱</label>
                      <input
                        id="edit-wh-name-{wh.id}"
                        type="text"
                        class="form-input"
                        bind:value={editWarehouseName}
                        style="width: 100%; padding: 6px 8px; font-size: 0.85rem;"
                      />
                    </div>
                    <div style="display: flex; gap: 6px;">
                      <button type="submit" class="btn btn-primary btn-xs" disabled={isSavingWarehouse} style="height: 31px; padding: 0 12px;">儲存</button>
                      <button type="button" class="btn btn-outline btn-xs" onclick={handleCancelEditWarehouse} style="height: 31px; padding: 0 10px;">取消</button>
                    </div>
                  </form>
                {:else}
                  <!-- Display Mode -->
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(var(--accent-amber), 0.12); border: 1px solid rgba(var(--accent-amber), 0.3); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                        🏬
                      </div>
                      <div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                          <span style="font-weight: 600; color: var(--text-primary); font-size: 0.95rem;">{wh.name}</span>
                          <span class="badge badge-slate" style="font-family: monospace; font-size: 0.75rem;">{wh.code}</span>
                          {#if wh.is_default}
                            <span class="badge badge-amber" style="font-size: 0.72rem; font-weight: 600;">
                              ★ 預設倉
                            </span>
                          {/if}
                          {#if wh.is_active}
                            <span class="badge badge-emerald" style="font-size: 0.72rem;">啟用中</span>
                          {:else}
                            <span class="badge badge-slate" style="font-size: 0.72rem; opacity: 0.7;">已停用</span>
                          {/if}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; font-family: monospace;">ID: {wh.id}</div>
                      </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 6px;">
                      {#if !wh.is_default && wh.is_active}
                        <button
                          type="button"
                          class="btn btn-outline btn-xs"
                          onclick={() => handleSetDefaultWarehouse(wh.id)}
                          title="將此倉庫設為開單與開帳預設倉"
                        >
                          設為預設
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="btn btn-outline btn-xs"
                        onclick={() => handleStartEditWarehouse(wh)}
                      >
                        編輯
                      </button>
                      {#if wh.is_active}
                        {#if !wh.is_default}
                          <button
                            type="button"
                            class="btn btn-outline btn-xs"
                            style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);"
                            onclick={() => handleDeactivateWarehouse(wh.id)}
                          >
                            停用
                          </button>
                        {/if}
                      {:else}
                        <button
                          type="button"
                          class="btn btn-outline btn-xs"
                          style="color: #10b981; border-color: rgba(16, 185, 129, 0.3);"
                          onclick={() => handleReactivateWarehouse(wh.id)}
                        >
                          重新啟用
                        </button>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

    <!-- SUBTABS 3, 4, 5: 調整單 / 盤點單 / 調撥單 (Placeholders) -->
    {:else if activeSubTab === 'adjustments'}
      <div class="empty-state-panel glass-panel">
        <div class="empty-state-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">庫存調整單 (Inventory Adjustments)</h3>
        <p class="empty-state-desc">
          記錄庫存報損、盤盈盤虧微調、期初更正等數量異動。（此畫面將於 M12 專屬 issue 交付）
        </p>
        <span class="badge badge-amber" style="padding: 4px 10px; font-size: 0.8rem;">功能開發中 (M12)</span>
      </div>

    {:else if activeSubTab === 'stocktakes'}
      <div class="empty-state-panel glass-panel">
        <div class="empty-state-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            <path d="m9 14 2 2 4-4"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">盤點作業 (Stocktaking)</h3>
        <p class="empty-state-desc">
          支援不凍結倉別之盤點快照、實盤量登記、異動偵測與差額過帳。（此畫面將於 M12 專屬 issue 交付）
        </p>
        <span class="badge badge-amber" style="padding: 4px 10px; font-size: 0.8rem;">功能開發中 (M12)</span>
      </div>

    {:else if activeSubTab === 'transfers'}
      <div class="empty-state-panel glass-panel">
        <div class="empty-state-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">倉庫調撥單 (Warehouse Transfers)</h3>
        <p class="empty-state-desc">
          多倉之間調撥出庫與調撥入庫作業。（此畫面將於 M12 專屬 issue 交付）
        </p>
        <span class="badge badge-amber" style="padding: 4px 10px; font-size: 0.8rem;">功能開發中 (M12)</span>
      </div>
    {/if}
  </div>
</div>

<!-- Note: Create Warehouse Modal is globally handled by CreateWarehouseModal.svelte in App.svelte -->

<!-- ============================================================== -->
<!-- MODAL 2: 期初庫存開帳彈窗 (Migrated from Purchase Orders)      -->
<!-- ============================================================== -->
{#if isOpeningBalanceModalOpen}
  <div class="modal-backdrop" onclick={closeOpeningBalanceModal} onkeydown={(e) => e.key === 'Escape' && closeOpeningBalanceModal()} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-opening-balance-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-opening-balance-title" class="modal-title">登記期初庫存底帳 (R-17)</h3>
        <button class="btn-close-modal" onclick={closeOpeningBalanceModal} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">
          為尚未有採購單歷史的商品單位建立最初庫存基準底帳。注意：同一單位在同一倉僅能開帳一次。
        </p>

        {#if openingModalError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.82rem;">
            {openingModalError}
          </div>
        {/if}

        <div class="form-group" style="margin-bottom: 12px;">
          <label for="opening-unit">選擇商品與單位 *</label>
          <select id="opening-unit" bind:value={openingUnitId} class="form-select">
            <option value="">-- 請選擇商品單位 --</option>
            {#each availableUnits as unit}
              <option value={unit.unit_id}>{unit.label}</option>
            {/each}
          </select>
        </div>

        <!-- 倉庫選擇器：單一啟用倉時隱藏，多倉時顯示 -->
        {#if activeWarehouses.length > 1}
          <div class="form-group" style="margin-bottom: 12px;">
            <label for="opening-warehouse">開帳倉庫 *</label>
            <select id="opening-warehouse" bind:value={openingWarehouseId} class="form-select">
              {#each activeWarehouses as wh}
                <option value={wh.id}>{wh.name} ({wh.code}){wh.is_default ? ' ★ 預設倉' : ''}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div class="form-row" style="display: flex; gap: 10px;">
          <div class="form-group flex-1">
            <label for="opening-qty">期初數量 *</label>
            <input type="number" id="opening-qty" bind:value={openingQuantity} min="1" class="form-input text-right" />
          </div>
          <div class="form-group flex-1">
            <label for="opening-cost">單位成本 (TWD)</label>
            <input type="number" id="opening-cost" bind:value={openingUnitCost} min="0" step="0.01" class="form-input text-right" />
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick={closeOpeningBalanceModal}>取消</button>
        <button class="btn btn-primary" onclick={handleRecordOpeningBalance} disabled={actionLoading || !openingUnitId} id="btn-submit-opening-balance">
          登記期初開帳
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .warehouse-workspace {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
    overflow-y: auto;
    padding: 16px 20px 40px;
  }

  .workspace-header {
    padding: 16px 20px;
    border-radius: var(--radius-md);
  }

  .workspace-title-row {
    margin-bottom: 16px;
  }

  .title-with-badge {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .workspace-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .workspace-subtitle {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .subtabs-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
  }

  .subtabs-nav {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .subtab-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .subtab-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.04);
  }

  .subtab-btn.active {
    background: rgba(var(--accent-rgb), 0.12);
    border-color: rgba(var(--accent-rgb), 0.3);
    color: var(--accent);
    font-weight: 600;
  }

  .subtab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.1);
    font-size: 0.72rem;
    font-weight: 600;
  }

  .empty-state-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 24px;
    text-align: center;
    border-radius: var(--radius-md);
  }

  .empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: rgba(var(--accent-amber), 0.1);
    color: rgb(var(--accent-amber));
    margin-bottom: 16px;
  }

  .empty-state-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .empty-state-desc {
    max-width: 500px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 20px;
  }

  .empty-actions-row {
    display: flex;
    gap: 10px;
  }

  /* Table styles */
  .table-container {
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .table-responsive {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    text-align: left;
  }

  .data-table th {
    padding: 12px 14px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--border-color);
  }

  .data-table td {
    padding: 12px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .data-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .unit-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    font-size: 0.75rem;
  }

  .btn-breakdown {
    padding: 4px 10px;
    font-size: 0.78rem;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-breakdown:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }

  .breakdown-row {
    background: rgba(0, 0, 0, 0.15) !important;
  }

  .breakdown-cell {
    padding: 0 14px 14px !important;
  }

  .nested-movement-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  .nested-movement-table th {
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .nested-movement-table td {
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  }

  .reason-tag {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 500;
  }

  .reason-opening_balance {
    background: rgba(var(--accent-amethyst), 0.15);
    color: rgb(var(--accent-amethyst));
  }

  .reason-purchase_receipt {
    background: rgba(var(--accent-emerald), 0.15);
    color: rgb(var(--accent-emerald));
  }

  .reason-adjustment, .reason-inventory_adjustment {
    background: rgba(var(--accent-amber), 0.15);
    color: rgb(var(--accent-amber));
  }

  .reason-stocktake {
    background: rgba(var(--accent-cyan), 0.15);
    color: rgb(var(--accent-cyan));
  }

  .link-po-ref {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    font-size: 0.8rem;
    padding: 0;
  }

  .link-po-ref:hover {
    filter: brightness(1.2);
  }

  /* Modals */
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
    z-index: 999;
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

  .form-group label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .form-select, .form-input {
    width: 100%;
    padding: 7px 10px;
    font-size: 0.85rem;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .text-right {
    text-align: right;
  }
  .font-bold {
    font-weight: 700;
  }
  .font-medium {
    font-weight: 500;
  }
  .text-emerald {
    color: rgb(var(--accent-emerald));
  }
  .text-red {
    color: #ef4444;
  }
  .text-muted {
    color: var(--text-muted);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 500;
  }
  .badge-amber {
    background: rgba(var(--accent-amber), 0.15);
    color: rgb(var(--accent-amber));
    border: 1px solid rgba(var(--accent-amber), 0.3);
  }
  .badge-emerald {
    background: rgba(var(--accent-emerald), 0.15);
    color: rgb(var(--accent-emerald));
    border: 1px solid rgba(var(--accent-emerald), 0.3);
  }
  .badge-slate {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
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
    border-color: var(--border-active);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
    font-weight: 600;
  }
  .btn-primary:hover:not(:disabled) {
    background: rgba(var(--accent-rgb), 0.9);
    border-color: rgba(var(--accent-rgb), 0.9);
  }
  .btn-outline {
    background: transparent;
    border-color: var(--border-color);
    color: var(--text-secondary);
  }
  .btn-outline:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
  }
  .btn-sm {
    padding: 5px 10px;
    font-size: 0.8rem;
  }
  .btn-xs {
    padding: 3px 8px;
    font-size: 0.72rem;
  }
</style>
