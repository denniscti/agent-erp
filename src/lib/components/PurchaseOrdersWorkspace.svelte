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
    navigateToTask,
    createPurchaseOrderAction,
    updatePurchaseOrderHeaderAction,
    addPurchaseOrderLineAction,
    updatePurchaseOrderLineAction,
    removePurchaseOrderLineAction,
    submitPurchaseOrderAction,
    confirmPurchaseOrderReceivedAction,
    cancelPurchaseOrderAction,
    recordOpeningInventoryBalanceAction,
    fetchWarehouses
  } from '../store.svelte.js';
  import { invoke } from '../tauri.js';

  // Active view tab: 'orders' | 'inventory'
  let activeSubTab = $state('orders');
  let selectedStatusFilter = $state('all');
  let selectedOrderId = $state(null);
  let orderDetailLoading = $state(false);
  let orderDetailError = $state('');

  // Auxiliary data for dropdowns
  let availableVendors = $state([]);
  let availableUnits = $state([]);
  let auxiliaryLoading = $state(false);

  // Global action status & error feedback
  let actionLoading = $state(false);
  let actionError = $state('');

  // Modal 1: Create Purchase Order Modal
  let isCreateModalOpen = $state(false);
  let createVendorPartnerId = $state('');
  let createCurrency = $state('TWD');
  let createExpectedDate = $state('');
  let createNote = $state('');
  let createWarehouseId = $state('');

  // Modal 2: Confirm Receipt Modal
  let isReceiveModalOpen = $state(false);
  let receiveLines = $state([]); // [{ line_id, line_no, product_name, variant_name, unit_name, quantity, received_quantity }]

  // Modal 3: Opening Inventory Balance Modal
  let isOpeningBalanceModalOpen = $state(false);
  let openingUnitId = $state('');
  let openingQuantity = $state(1);
  let openingUnitCost = $state(0);
  let openingWarehouseId = $state('');

  // Warehouse selection state (Issue #179)
  let selectedInventoryWarehouseId = $state('');
  let editWarehouseId = $state('');

  let activeWarehouses = $derived(
    (appState.warehouses || []).filter(w => w.is_active)
  );
  let defaultWarehouse = $derived(
    (appState.warehouses || []).find(w => w.is_default && w.is_active) || activeWarehouses[0] || null
  );

  function getWarehouseName(whId) {
    if (!whId) return '主倉 (預設)';
    const wh = (appState.warehouses || []).find(w => w.id === whId);
    return wh ? `${wh.name} (${wh.code})` : whId;
  }

  // Modal 4: In-App Confirmation Modal (Replaces native window.confirm for WebView compatibility)
  let isConfirmModalOpen = $state(false);
  let confirmModalTitle = $state('操作確認');
  let confirmModalMessage = $state('');
  let confirmModalAction = $state(null);
  let confirmModalButtonText = $state('確定');
  let confirmModalButtonClass = $state('btn-primary');

  // Draft Detail Line Operations
  let newLineUnitId = $state('');
  let newLineQuantity = $state(1);
  let newLineCost = $state('');
  let newLineCostHint = $state('');
  let editingLineId = $state(null);
  let editingLineQuantity = $state(1);
  let editingLineCost = $state(0);

  // Header Editing
  let isEditingHeader = $state(false);
  let editExpectedDate = $state('');
  let editNote = $state('');

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
    await loadAuxiliaryData();
  });

  async function reloadData() {
    isLoading = true;
    try {
      await Promise.all([
        fetchPurchaseOrders(),
        fetchInventoryLevels()
      ]);
      await loadAuxiliaryData();
    } catch (err) {
      console.error("Failed to load purchase orders workspace data:", err);
    } finally {
      isLoading = false;
    }
  }

  async function loadAuxiliaryData() {
    auxiliaryLoading = true;
    try {
      await fetchWarehouses();
      const [partners, products] = await Promise.all([
        invoke('list_partners'),
        invoke('list_products')
      ]);
      availableVendors = (partners || []).filter(p => p.is_vendor);

      const uList = [];
      for (const prod of (products || [])) {
        if (!prod.is_purchasable) continue;
        try {
          const detail = await invoke('get_product_detail', {
            product_id: prod.id,
            productId: prod.id
          });
          const variantMap = new Map((detail.variants || []).map(v => [v.id, v.name]));
          // In Rust ProductDetail, units is directly on detail.units (not v.units)
          for (const u of (detail.units || [])) {
            const variantName = variantMap.get(u.variant_id) || '標準';
            const unitSources = (detail.supply_sources || []).filter(s => s.unit_id === u.id);
            uList.push({
              unit_id: u.id,
              product_id: prod.id,
              product_name: prod.name,
              variant_name: variantName,
              unit_name: u.unit_name,
              label: `${prod.name} (${variantName}) - ${u.unit_name}`,
              supply_sources: unitSources
            });
          }
        } catch (e) {
          console.error("Failed to load product detail for", prod.id, e);
        }
      }
      availableUnits = uList;
    } catch (err) {
      console.error("Failed to load auxiliary vendor/product data:", err);
    } finally {
      auxiliaryLoading = false;
    }
  }

  function handleTabSwitch(tab) {
    activeSubTab = tab;
    selectedOrderId = null;
    expandedInventoryUnitId = null;
    actionError = '';
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
    actionError = '';
    isEditingHeader = false;
    editingLineId = null;
    resetNewLineForm();

    if (availableUnits.length === 0) {
      loadAuxiliaryData();
    }

    try {
      await fetchPurchaseOrderDetail(orderId);
      if (appState.currentPurchaseOrderDetail?.order) {
        const o = appState.currentPurchaseOrderDetail.order;
        editExpectedDate = o.expected_date ? new Date(o.expected_date * 1000).toISOString().slice(0, 10) : '';
        editNote = o.note || '';
        editWarehouseId = o.warehouse_id || defaultWarehouse?.id || '';
      }
    } catch (err) {
      orderDetailError = err.message || '無法載入採購單明細';
    } finally {
      orderDetailLoading = false;
    }
  }

  function handleBackToList() {
    selectedOrderId = null;
    appState.currentPurchaseOrderDetail = null;
    actionError = '';
    isEditingHeader = false;
    editingLineId = null;
  }

  // --- Modal Openers & Resets ---
  function openCreateModal() {
    actionError = '';
    createVendorPartnerId = availableVendors.length > 0 ? availableVendors[0].id : '';
    createCurrency = 'TWD';
    createExpectedDate = '';
    createNote = '';
    createWarehouseId = defaultWarehouse?.id || (activeWarehouses[0]?.id || '');
    isCreateModalOpen = true;
    if (availableVendors.length === 0) {
      loadAuxiliaryData();
    }
  }

  function closeCreateModal() {
    isCreateModalOpen = false;
  }

  function openOpeningBalanceModal() {
    actionError = '';
    openingUnitId = availableUnits.length > 0 ? availableUnits[0].unit_id : '';
    openingQuantity = 1;
    openingUnitCost = 0;
    openingWarehouseId = defaultWarehouse?.id || (activeWarehouses[0]?.id || '');
    isOpeningBalanceModalOpen = true;
    if (availableUnits.length === 0) {
      loadAuxiliaryData();
    }
  }

  function closeOpeningBalanceModal() {
    isOpeningBalanceModalOpen = false;
  }

  function openReceiveModal() {
    actionError = '';
    const detail = appState.currentPurchaseOrderDetail;
    if (!detail || !detail.lines) return;
    receiveLines = detail.lines.map(l => ({
      line_id: l.id,
      line_no: l.line_no,
      product_name: l.product_name_snapshot,
      variant_name: l.variant_name_snapshot,
      unit_name: l.unit_name_snapshot,
      quantity: l.quantity,
      received_quantity: l.quantity // default to ordered quantity
    }));
    isReceiveModalOpen = true;
  }

  function closeReceiveModal() {
    isReceiveModalOpen = false;
  }

  function requestConfirmation({ title, message, onConfirm, buttonText = '確定', buttonClass = 'btn-primary' }) {
    confirmModalTitle = title;
    confirmModalMessage = message;
    confirmModalAction = onConfirm;
    confirmModalButtonText = buttonText;
    confirmModalButtonClass = buttonClass;
    isConfirmModalOpen = true;
  }

  function resetNewLineForm() {
    newLineUnitId = '';
    newLineQuantity = 1;
    newLineCost = '';
    newLineCostHint = '';
  }

  // --- R-07 Cost Auto-prefill Logic ---
  async function handleNewLineUnitChange() {
    if (!newLineUnitId) {
      newLineCostHint = '';
      return;
    }
    const order = appState.currentPurchaseOrderDetail?.order;
    if (!order || !order.vendor_partner_id) return;

    let matchedCost = null;
    const unit = availableUnits.find(u => u.unit_id === newLineUnitId);
    if (unit && unit.supply_sources && unit.supply_sources.length > 0) {
      const matched = unit.supply_sources.find(s => s.vendor_partner_id === order.vendor_partner_id);
      if (matched && (matched.purchase_cost !== undefined || matched.cost !== undefined)) {
        matchedCost = matched.purchase_cost !== undefined ? matched.purchase_cost : matched.cost;
      }
    }

    if (matchedCost === null) {
      try {
        const sources = await invoke('list_supply_sources', { unit_id: newLineUnitId, unitId: newLineUnitId });
        const matched = (sources || []).find(s => s.vendor_partner_id === order.vendor_partner_id);
        if (matched && (matched.purchase_cost !== undefined || matched.cost !== undefined)) {
          matchedCost = matched.purchase_cost !== undefined ? matched.purchase_cost : matched.cost;
        }
      } catch (e) {
        // ignore if command doesn't exist
      }
    }

    if (matchedCost !== null && matchedCost !== undefined) {
      newLineCost = matchedCost;
      newLineCostHint = `已自動預填供應商歷史單價：NT$ ${matchedCost}`;
    } else {
      newLineCost = '';
      newLineCostHint = '查無此供應商之預設供應來源成本，請手動指定單價';
    }
  }

  // --- Actions Implementations ---

  async function handleCreatePurchaseOrder() {
    actionError = '';
    if (!createVendorPartnerId) {
      actionError = '請選擇供應商';
      return;
    }
    actionLoading = true;
    try {
      const expTimestamp = createExpectedDate ? Math.floor(new Date(createExpectedDate).getTime() / 1000) : null;
      const detail = await createPurchaseOrderAction({
        vendor_partner_id: createVendorPartnerId,
        currency: createCurrency,
        expected_date: expTimestamp,
        note: createNote,
        warehouse_id: createWarehouseId || defaultWarehouse?.id || null,
        task_id: null // manual form entry strictly null
      });
      isCreateModalOpen = false;
      await handleSelectOrder(detail.order.id);
    } catch (err) {
      actionError = err.message || '建立採購單失敗';
    } finally {
      actionLoading = false;
    }
  }

  async function handleSaveHeader() {
    actionError = '';
    const orderId = appState.currentPurchaseOrderDetail?.order?.id;
    if (!orderId) return;

    actionLoading = true;
    try {
      const expTimestamp = editExpectedDate ? Math.floor(new Date(editExpectedDate).getTime() / 1000) : null;
      await updatePurchaseOrderHeaderAction(orderId, {
        expected_date: expTimestamp,
        note: editNote,
        warehouse_id: editWarehouseId || null
      });
      isEditingHeader = false;
    } catch (err) {
      actionError = err.message || '更新表頭失敗';
    } finally {
      actionLoading = false;
    }
  }

  async function handleAddLine() {
    actionError = '';
    const orderId = appState.currentPurchaseOrderDetail?.order?.id;
    if (!orderId) {
      actionError = '找不到目前採購單資訊';
      return;
    }
    if (!newLineUnitId) {
      actionError = '請選擇採購商品單位';
      return;
    }
    const qty = Number(newLineQuantity);
    if (isNaN(qty) || qty <= 0) {
      actionError = '採購數量必須大於 0';
      return;
    }

    actionLoading = true;
    try {
      const payload = {
        unit_id: newLineUnitId,
        unitId: newLineUnitId,
        quantity: qty
      };
      if (newLineCost !== '' && newLineCost !== null && newLineCost !== undefined) {
        payload.purchase_cost = Number(newLineCost);
        payload.purchaseCost = Number(newLineCost);
      }
      await addPurchaseOrderLineAction(orderId, payload);
      resetNewLineForm();
    } catch (err) {
      actionError = err.message || '新增明細失敗';
    } finally {
      actionLoading = false;
    }
  }

  function startEditLine(line) {
    editingLineId = line.id;
    editingLineQuantity = line.quantity;
    editingLineCost = line.purchase_cost;
    actionError = '';
  }

  function cancelEditLine() {
    editingLineId = null;
  }

  async function handleSaveLine(lineId) {
    actionError = '';
    const qty = Number(editingLineQuantity);
    if (isNaN(qty) || qty <= 0) {
      actionError = '採購數量必須大於 0';
      return;
    }
    const cost = Number(editingLineCost);
    if (isNaN(cost) || cost < 0) {
      actionError = '採購單價不可為負數';
      return;
    }

    actionLoading = true;
    try {
      await updatePurchaseOrderLineAction(lineId, {
        quantity: qty,
        purchase_cost: cost
      });
      editingLineId = null;
    } catch (err) {
      actionError = err.message || '更新明細失敗';
    } finally {
      actionLoading = false;
    }
  }

  function handleDeleteLine(lineId) {
    requestConfirmation({
      title: '刪除明細確認',
      message: '確定要刪除此明細項目嗎？刪除後剩餘明細將自動重新編號。',
      buttonText: '確認刪除',
      buttonClass: 'btn-red',
      onConfirm: async () => {
        isConfirmModalOpen = false;
        actionError = '';
        actionLoading = true;
        try {
          await removePurchaseOrderLineAction(lineId);
        } catch (err) {
          actionError = err.message || '刪除明細失敗';
        } finally {
          actionLoading = false;
        }
      }
    });
  }

  function handleSubmitOrder() {
    const detail = appState.currentPurchaseOrderDetail;
    if (!detail) return;
    if (!detail.lines || detail.lines.length === 0) {
      actionError = '採購單至少需有 1 筆明細方可下單 (R-08)';
      return;
    }

    requestConfirmation({
      title: '送出訂購確認',
      message: `確認將採購單「${detail.order.po_number}」正式送出下單嗎？送出後明細項目將鎖定不可修改 (R-08~R-11)。`,
      buttonText: '確認送出訂購',
      buttonClass: 'btn-emerald',
      onConfirm: async () => {
        isConfirmModalOpen = false;
        actionError = '';
        actionLoading = true;
        try {
          await submitPurchaseOrderAction(detail.order.id);
        } catch (err) {
          actionError = err.message || '送出訂購失敗';
        } finally {
          actionLoading = false;
        }
      }
    });
  }

  async function handleConfirmReceive() {
    actionError = '';
    const orderId = appState.currentPurchaseOrderDetail?.order?.id;
    if (!orderId) return;

    for (const r of receiveLines) {
      const rq = Number(r.received_quantity);
      if (isNaN(rq) || rq < 0) {
        actionError = `明細 #${r.line_no} 實到數量不可為負數 (R-14)`;
        return;
      }
    }

    actionLoading = true;
    try {
      const payload = receiveLines.map(r => ({
        line_id: r.line_id,
        lineId: r.line_id,
        received_quantity: Number(r.received_quantity),
        receivedQuantity: Number(r.received_quantity)
      }));
      await confirmPurchaseOrderReceivedAction(orderId, payload);
      isReceiveModalOpen = false;
    } catch (err) {
      actionError = err.message || '驗收到貨結案失敗';
    } finally {
      actionLoading = false;
    }
  }

  function handleCancelOrder() {
    const detail = appState.currentPurchaseOrderDetail;
    if (!detail) return;

    requestConfirmation({
      title: '取消單據確認',
      message: `確定要取消採購單「${detail.order.po_number}」嗎？取消後單據狀態不可逆 (R-15~R-16)。`,
      buttonText: '確認取消採購單',
      buttonClass: 'btn-red',
      onConfirm: async () => {
        isConfirmModalOpen = false;
        actionError = '';
        actionLoading = true;
        try {
          await cancelPurchaseOrderAction(detail.order.id);
        } catch (err) {
          actionError = err.message || '取消採購單失敗';
        } finally {
          actionLoading = false;
        }
      }
    });
  }

  async function handleRecordOpeningBalance() {
    actionError = '';
    if (!openingUnitId) {
      actionError = '請選擇商品單位 (R-17)';
      return;
    }
    const qty = Number(openingQuantity);
    if (isNaN(qty) || qty <= 0) {
      actionError = '期初開帳數量必須大於 0 (R-17)';
      return;
    }
    const cost = Number(openingUnitCost);
    if (isNaN(cost) || cost < 0) {
      actionError = '期初開帳成本不可為負數 (R-17)';
      return;
    }

    actionLoading = true;
    try {
      await recordOpeningInventoryBalanceAction({
        unit_id: openingUnitId,
        unitId: openingUnitId,
        quantity_delta: qty,
        quantityDelta: qty,
        unit_cost: cost,
        unitCost: cost,
        warehouse_id: openingWarehouseId || defaultWarehouse?.id || null
      });
      isOpeningBalanceModalOpen = false;
      if (activeSubTab === 'inventory') {
        await reloadData();
      }
    } catch (err) {
      actionError = err.message || '建立期初庫存底帳失敗';
    } finally {
      actionLoading = false;
    }
  }

  async function handleWarehouseFilterChange() {
    isLoading = true;
    try {
      await fetchInventoryLevels(selectedInventoryWarehouseId || null);
    } catch (err) {
      console.error("Failed to filter inventory by warehouse:", err);
    } finally {
      isLoading = false;
    }
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
      const list = await fetchInventoryMovements(unitId, selectedInventoryWarehouseId || null);
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

      <!-- Action Buttons for Manual Form & Opening Balance -->
      <div class="workspace-action-group">
        <button
          class="btn btn-primary btn-sm"
          onclick={openCreateModal}
          id="btn-open-create-po-modal"
          title="手動建立採購單（任務對話之必要備援入口）"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          手動新增採購單
        </button>

        <button
          class="btn btn-secondary btn-sm"
          onclick={openOpeningBalanceModal}
          id="btn-open-opening-balance-modal"
          title="登記期初庫存底帳"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
          期初開帳
        </button>

        <button class="btn btn-sm" onclick={reloadData} title="重新整理資料" aria-label="重新整理">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          重新整理
        </button>
      </div>
    </div>
  </header>

  <!-- Global Action Error Banner -->
  {#if actionError}
    <div class="error-banner glass-panel" role="alert">
      <div class="error-content">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span class="error-msg">{actionError}</span>
      </div>
      <button class="btn-close-error" onclick={() => actionError = ''} aria-label="關閉錯誤提示">✕</button>
    </div>
  {/if}

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
                {:else}
                  <span class="badge badge-slate" title="此單據經由手動表單備援建立">手動備援單據</span>
                {/if}
              </div>
            </div>

            <!-- Status Transition Action Buttons -->
            <div class="detail-header-right">
              <div class="status-action-group">
                {#if order.status === 'draft'}
                  <button
                    class="btn btn-emerald btn-sm"
                    onclick={handleSubmitOrder}
                    disabled={actionLoading}
                    id="btn-submit-order"
                    title="送出訂購，進入已下單狀態 (R-08)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    送出訂購
                  </button>
                  <button
                    class="btn btn-red btn-sm"
                    onclick={handleCancelOrder}
                    disabled={actionLoading}
                    id="btn-cancel-order"
                    title="取消採購單 (R-15)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    取消單據
                  </button>
                  <button
                    class="btn btn-sm"
                    onclick={() => isEditingHeader = !isEditingHeader}
                    id="btn-edit-header"
                  >
                    {isEditingHeader ? '取消編輯' : '編輯表頭'}
                  </button>
                {:else if order.status === 'ordered'}
                  <button
                    class="btn btn-emerald btn-sm"
                    onclick={openReceiveModal}
                    disabled={actionLoading}
                    id="btn-open-receive-modal"
                    title="確認到貨驗收並一次入庫 (R-12~R-14)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    </svg>
                    確認到貨驗收
                  </button>
                  <button
                    class="btn btn-red btn-sm"
                    onclick={handleCancelOrder}
                    disabled={actionLoading}
                    id="btn-cancel-order"
                    title="取消未到貨之訂購 (R-15)"
                  >
                    取消採購單
                  </button>
                {:else if order.status === 'received'}
                  <span class="badge badge-emerald">已全數到貨結案</span>
                {:else if order.status === 'cancelled'}
                  <span class="badge badge-red">單據已取消</span>
                {/if}
              </div>

              <div class="total-display">
                <span class="total-label">總金額：</span>
                <span class="total-amount-highlight">{formatCurrency(order.total_amount)}</span>
              </div>
            </div>
          </div>

          <!-- Order Header Information / Editing -->
          {#if isEditingHeader}
            <div class="header-edit-box glass-panel">
              <h4 class="form-title">編輯表頭資訊</h4>
              <div class="form-row">
                <div class="form-group flex-1">
                  <label for="edit-expected-date">預計到貨日</label>
                  <input
                    type="date"
                    id="edit-expected-date"
                    bind:value={editExpectedDate}
                    class="form-input"
                  />
                </div>
                <div class="form-group flex-1">
                  <label for="edit-warehouse">進貨倉庫</label>
                  <select id="edit-warehouse" bind:value={editWarehouseId} class="form-select">
                    {#each activeWarehouses as wh}
                      <option value={wh.id}>{wh.name} ({wh.code}){wh.is_default ? ' ★ 預設倉' : ''}</option>
                    {/each}
                  </select>
                </div>
              </div>
              <div class="form-group" style="margin-top: 8px;">
                <label for="edit-note">單據備註</label>
                <input
                  type="text"
                  id="edit-note"
                  bind:value={editNote}
                  placeholder="備註說明..."
                  class="form-input"
                />
              </div>
              <div class="form-actions-inline" style="margin-top: 10px;">
                <button class="btn btn-primary btn-sm" onclick={handleSaveHeader} disabled={actionLoading}>
                  儲存表頭
                </button>
                <button class="btn btn-sm" onclick={() => isEditingHeader = false}>
                  取消
                </button>
              </div>
            </div>
          {:else}
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
                <span class="meta-label">進貨倉庫</span>
                <span class="meta-value font-medium" style="color: rgb(var(--accent-amber));">{getWarehouseName(order.warehouse_id)}</span>
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
          {/if}

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

          <!-- Draft Status: Add New Line Section -->
          {#if order.status === 'draft'}
            <div class="add-line-panel glass-panel">
              <h4 class="form-title">新增採購品項 (草稿編輯中)</h4>
              <div class="add-line-form">
                <div class="form-group flex-2">
                  <label for="select-new-unit">選擇採購商品與單位 *</label>
                  <select
                    id="select-new-unit"
                    bind:value={newLineUnitId}
                    onchange={handleNewLineUnitChange}
                    class="form-select"
                  >
                    {#if availableUnits.length === 0}
                      <option value="">-- 目前無可採購之商品單位 --</option>
                    {:else}
                      <option value="">-- 請選擇商品單位 --</option>
                      {#each availableUnits as unit}
                        <option value={unit.unit_id}>{unit.label}</option>
                      {/each}
                    {/if}
                  </select>
                </div>

                <div class="form-group flex-1">
                  <label for="input-new-quantity">採購數量 *</label>
                  <input
                    type="number"
                    id="input-new-quantity"
                    bind:value={newLineQuantity}
                    min="1"
                    class="form-input text-right"
                  />
                </div>

                <div class="form-group flex-1">
                  <label for="input-new-cost">採購單價 (TWD)</label>
                  <input
                    type="number"
                    id="input-new-cost"
                    bind:value={newLineCost}
                    min="0"
                    step="0.01"
                    placeholder="留空自動帶入"
                    class="form-input text-right"
                  />
                </div>

                <div class="form-group-btn">
                  <button
                    class="btn btn-primary"
                    onclick={handleAddLine}
                    disabled={actionLoading || !newLineUnitId}
                    id="btn-add-po-line"
                  >
                    {#if actionLoading}處理中...{:else}加入明細{/if}
                  </button>
                </div>
              </div>
              {#if newLineCostHint}
                <p class="cost-hint text-cyan">ℹ {newLineCostHint}</p>
              {/if}
              {#if availableUnits.length === 0 && !auxiliaryLoading}
                <p class="cost-hint text-amber">
                  ⚠️ 系統目前查無「可採購」之商品規格單位。請先至「商品管理」建立可採購（外購/原料）商品並新增單位。
                </p>
              {/if}
            </div>
          {/if}

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
                    {#if order.status === 'draft'}
                      <th class="text-right">操作</th>
                    {/if}
                  </tr>
                </thead>
                <tbody>
                  {#if lines.length === 0}
                    <tr>
                      <td colspan={order.status === 'draft' ? 10 : 9} class="text-center empty-cell">
                        此採購單尚無任何品項明細，請使用上方表單新增商品品項
                      </td>
                    </tr>
                  {:else}
                    {#each lines as line, index}
                      <tr>
                        <td>{line.line_no || index + 1}</td>
                        <td class="font-bold">{line.product_name_snapshot}</td>
                        <td>{line.variant_name_snapshot || '-'}</td>
                        <td class="text-muted">{line.sku_snapshot || '-'}</td>
                        <td><span class="unit-tag">{line.unit_name_snapshot}</span></td>

                        <!-- Quantity Column -->
                        <td class="text-right font-medium">
                          {#if editingLineId === line.id}
                            <input
                              type="number"
                              bind:value={editingLineQuantity}
                              min="1"
                              class="form-input form-input-sm text-right"
                            />
                          {:else}
                            {line.quantity}
                          {/if}
                        </td>

                        <!-- Received Quantity Column -->
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

                        <!-- Purchase Cost Column -->
                        <td class="text-right">
                          {#if editingLineId === line.id}
                            <input
                              type="number"
                              bind:value={editingLineCost}
                              min="0"
                              step="0.01"
                              class="form-input form-input-sm text-right"
                            />
                          {:else}
                            {formatCurrency(line.purchase_cost)}
                          {/if}
                        </td>

                        <!-- Subtotal Column -->
                        <td class="text-right font-bold">{formatCurrency(line.subtotal)}</td>

                        <!-- Line Mutation Actions in Draft Status -->
                        {#if order.status === 'draft'}
                          <td class="text-right">
                            {#if editingLineId === line.id}
                              <button
                                class="btn btn-sm btn-emerald"
                                onclick={() => handleSaveLine(line.id)}
                                disabled={actionLoading}
                              >
                                儲存
                              </button>
                              <button
                                class="btn btn-sm"
                                onclick={cancelEditLine}
                              >
                                取消
                              </button>
                            {:else}
                              <button
                                class="btn btn-sm"
                                onclick={() => startEditLine(line)}
                                id="btn-edit-line-{line.id}"
                                title="修改明細數量或單價"
                              >
                                修改
                              </button>
                              <button
                                class="btn btn-sm btn-red"
                                onclick={() => handleDeleteLine(line.id)}
                                disabled={actionLoading}
                                id="btn-delete-line-{line.id}"
                                title="刪除此明細 (R-06)"
                              >
                                刪除
                              </button>
                            {/if}
                          </td>
                        {/if}
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
                  onclick={openCreateModal}
                  id="empty-btn-form"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  手動建立採購單
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
                          <span class="text-muted">手動表單</span>
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
            此租戶尚未完成任何採購單入庫，亦無期初開帳紀錄。庫存底帳可由「採購單到貨驗收」自動生成，或由「期初開帳」手動建立基準。
          </p>
          <div class="empty-actions-row">
            <button
              class="btn btn-primary"
              onclick={() => handleTabSwitch('orders')}
              id="empty-inv-btn-orders"
            >
              檢視採購單進度
            </button>
            <button
              class="btn"
              onclick={openOpeningBalanceModal}
              id="empty-inv-btn-opening"
            >
              登記期初底帳
            </button>
          </div>
        </div>
      {:else}
        <div class="filter-bar glass-panel" style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label for="inv-warehouse-filter" style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">倉庫維度：</label>
            <select
              id="inv-warehouse-filter"
              bind:value={selectedInventoryWarehouseId}
              onchange={handleWarehouseFilterChange}
              class="form-select"
              style="width: 200px; padding: 6px 10px; font-size: 0.85rem;"
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
                        {expandedInventoryUnitId === item.unit_id ? '收合履歷' : '異動履歷'}
                      </button>
                    </td>
                  </tr>

                  <!-- Expanded Movements Breakdown Subtable -->
                  {#if expandedInventoryUnitId === item.unit_id}
                    <tr class="breakdown-row">
                      <td colspan="5" class="breakdown-cell">
                        <div class="breakdown-card glass-panel">
                          <h5 class="breakdown-title">
                            庫存流水帳履歷：{item.product_name} - {item.unit_name}
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
                                        <span class="reason-tag {mov.reason === 'opening_balance' ? 'reason-opening' : 'reason-po'}">
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
                                          <button
                                            class="link-po-ref"
                                            onclick={() => {
                                              handleTabSwitch('orders');
                                              handleSelectOrder(mov.reference_id);
                                            }}
                                            title="點擊前往此採購單明細"
                                          >
                                            採購單 #{mov.reference_id.slice(-6)}
                                          </button>
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
    {/if}
  </div>
</div>

<!-- ========================================== -->
<!-- MODAL 1: 手動新增採購單彈窗 (Create PO Modal) -->
<!-- ========================================== -->
{#if isCreateModalOpen}
  <div class="modal-backdrop" onclick={closeCreateModal} onkeydown={(e) => e.key === 'Escape' && closeCreateModal()} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-create-po-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-create-po-title" class="modal-title">手動建立採購單</h3>
        <button class="btn-close-modal" onclick={closeCreateModal} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">建立採購單草稿，可於建立後逐筆新增品項明細與預計單價。</p>
        <div class="form-group">
          <label for="create-po-vendor">供應商 *</label>
          <select id="create-po-vendor" bind:value={createVendorPartnerId} class="form-select">
            <option value="">-- 請選擇供應商 --</option>
            {#each availableVendors as vendor}
              <option value={vendor.id}>{vendor.name} ({vendor.tax_id || '無統編'})</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label for="create-po-warehouse">進貨倉庫 *</label>
          <select id="create-po-warehouse" bind:value={createWarehouseId} class="form-select">
            {#each activeWarehouses as wh}
              <option value={wh.id}>{wh.name} ({wh.code}){wh.is_default ? ' ★ 預設倉' : ''}</option>
            {/each}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group flex-1">
            <label for="create-po-currency">幣別</label>
            <input type="text" id="create-po-currency" value="TWD" disabled class="form-input text-muted" />
          </div>
          <div class="form-group flex-1">
            <label for="create-po-expdate">預計到貨日</label>
            <input type="date" id="create-po-expdate" bind:value={createExpectedDate} class="form-input" />
          </div>
        </div>
        <div class="form-group">
          <label for="create-po-note">單據備註</label>
          <textarea id="create-po-note" bind:value={createNote} placeholder="例如：11月份手動補充耗材" class="form-textarea" rows="2"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick={closeCreateModal}>取消</button>
        <button class="btn btn-primary" onclick={handleCreatePurchaseOrder} disabled={actionLoading || !createVendorPartnerId} id="btn-submit-create-po">
          建立草稿單據
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ========================================== -->
<!-- MODAL 2: 確認到貨驗收彈窗 (Receive PO Modal) -->
<!-- ========================================== -->
{#if isReceiveModalOpen}
  <div class="modal-backdrop" onclick={closeReceiveModal} onkeydown={(e) => e.key === 'Escape' && closeReceiveModal()} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal glass-modal-lg" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-receive-po-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-receive-po-title" class="modal-title">採購單到貨驗收確認</h3>
        <button class="btn-close-modal" onclick={closeReceiveModal} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">
          請逐項核對實到數量，確認後將由系統一次完成結案並建立各品項對應的庫存流水帳 (R-12~R-14)。
        </p>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>品項 / 規格</th>
                <th>單位</th>
                <th class="text-right">訂購量</th>
                <th class="text-right" style="width: 140px;">實到數量 *</th>
                <th>驗收狀況</th>
              </tr>
            </thead>
            <tbody>
              {#each receiveLines as line, idx}
                <tr>
                  <td>{line.line_no || idx + 1}</td>
                  <td class="font-bold">{line.product_name} ({line.variant_name || '標準'})</td>
                  <td><span class="unit-tag">{line.unit_name}</span></td>
                  <td class="text-right font-medium">{line.quantity}</td>
                  <td class="text-right">
                    <input
                      type="number"
                      bind:value={line.received_quantity}
                      min="0"
                      class="form-input form-input-sm text-right"
                    />
                  </td>
                  <td>
                    {#if Number(line.received_quantity) === Number(line.quantity)}
                      <span class="badge badge-emerald">足額到貨</span>
                    {:else if Number(line.received_quantity) < Number(line.quantity)}
                      <span class="badge badge-amber">短交少到 {Number(line.quantity) - Number(line.received_quantity)}</span>
                    {:else}
                      <span class="badge badge-amethyst">超交多到 {Number(line.received_quantity) - Number(line.quantity)}</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick={closeReceiveModal}>取消</button>
        <button class="btn btn-emerald" onclick={handleConfirmReceive} disabled={actionLoading} id="btn-submit-confirm-receive">
          確認驗收並結案入庫
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ========================================== -->
<!-- MODAL 3: 期初庫存開帳彈窗 (Opening Balance Modal) -->
<!-- ========================================== -->
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
          為尚未有採購單歷史的商品單位建立最初庫存基準底帳。注意：同一單位僅能開帳一次。
        </p>
        <div class="form-group">
          <label for="opening-unit">選擇商品與單位 *</label>
          <select id="opening-unit" bind:value={openingUnitId} class="form-select">
            <option value="">-- 請選擇商品單位 --</option>
            {#each availableUnits as unit}
              <option value={unit.unit_id}>{unit.label}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label for="opening-warehouse">開帳倉庫 *</label>
          <select id="opening-warehouse" bind:value={openingWarehouseId} class="form-select">
            {#each activeWarehouses as wh}
              <option value={wh.id}>{wh.name} ({wh.code}){wh.is_default ? ' ★ 預設倉' : ''}</option>
            {/each}
          </select>
        </div>
        <div class="form-row">
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

<!-- ========================================== -->
<!-- MODAL 4: 輕量通用操作確認彈窗 (In-App Confirm Modal) -->
<!-- ========================================== -->
{#if isConfirmModalOpen}
  <div class="modal-backdrop" onclick={() => isConfirmModalOpen = false} onkeydown={(e) => e.key === 'Escape' && (isConfirmModalOpen = false)} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal glass-modal-sm" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-confirm-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-confirm-title" class="modal-title">{confirmModalTitle}</h3>
        <button class="btn-close-modal" onclick={() => isConfirmModalOpen = false} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">{confirmModalMessage}</p>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick={() => isConfirmModalOpen = false}>取消</button>
        <button
          class="btn {confirmModalButtonClass}"
          onclick={() => {
            if (typeof confirmModalAction === 'function') {
              confirmModalAction();
            }
          }}
          disabled={actionLoading}
          id="btn-confirm-modal-ok"
        >
          {confirmModalButtonText}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .workspace-container {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }

  .glass-panel {
    background: rgba(18, 24, 38, 0.7);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
  }

  .workspace-header {
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .workspace-title {
    font-size: 1.4rem;
    font-weight: 700;
    color: #FFFFFF;
    margin: 0;
  }

  .workspace-subtitle {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 4px 0 0 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .workspace-action-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .subtab-nav {
    display: flex;
    background: rgba(0, 0, 0, 0.25);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .subtab-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subtab-btn:hover {
    color: #FFFFFF;
    background: rgba(255, 255, 255, 0.04);
  }

  .subtab-btn.active {
    color: #FFFFFF;
    background: rgba(var(--accent-cyan), 0.15);
    border: 1px solid rgba(var(--accent-cyan), 0.3);
    font-weight: 600;
  }

  .subtab-count {
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 0.75rem;
  }

  /* Error Banner */
  .error-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #FCA5A5;
    border-radius: 8px;
  }

  .error-content {
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

  /* Filter Bar */
  .filter-bar {
    padding: 14px 20px;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .filter-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .filter-pills {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pill-btn {
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-muted);
    font-size: 0.8rem;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pill-btn:hover {
    color: #FFFFFF;
    background: rgba(255, 255, 255, 0.06);
  }

  .pill-btn.active {
    background: rgba(var(--accent-cyan), 0.2);
    color: #FFFFFF;
    border-color: rgba(var(--accent-cyan), 0.5);
    font-weight: 600;
  }

  /* Tables */
  .table-container {
    padding: 8px;
    overflow: hidden;
  }

  .table-responsive {
    overflow-x: auto;
    width: 100%;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    text-align: left;
  }

  .data-table th {
    padding: 12px 16px;
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    white-space: nowrap;
  }

  .data-table td {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-color, #E2E8F0);
  }

  .clickable-row {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clickable-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .po-col {
    color: rgb(var(--accent-cyan));
  }

  .link-po-number {
    background: transparent;
    border: none;
    color: rgb(var(--accent-cyan));
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0;
  }

  .link-po-number:hover {
    text-decoration: underline;
  }

  .total-col {
    font-family: monospace;
    font-size: 0.95rem;
  }

  .unit-tag {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /* Badges */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .badge-slate {
    background: rgba(148, 163, 184, 0.15);
    color: #CBD5E1;
    border: 1px solid rgba(148, 163, 184, 0.25);
  }

  .badge-amber {
    background: rgba(245, 158, 11, 0.15);
    color: #FCD34D;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .badge-emerald {
    background: rgba(16, 185, 129, 0.15);
    color: #6EE7B7;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge-red {
    background: rgba(239, 68, 68, 0.15);
    color: #FCA5A5;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .badge-cyan {
    background: rgba(6, 182, 212, 0.15);
    color: #67E8F9;
    border: 1px solid rgba(6, 182, 212, 0.3);
  }

  .badge-amethyst {
    background: rgba(168, 85, 247, 0.15);
    color: #D8B4FE;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #FFFFFF;
    transition: all 0.15s ease;
  }

  .btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-sm {
    padding: 5px 10px;
    font-size: 0.8rem;
  }

  .btn-primary {
    background: rgba(var(--accent-cyan), 0.25);
    border-color: rgba(var(--accent-cyan), 0.5);
    color: #FFFFFF;
  }

  .btn-primary:hover:not(:disabled) {
    background: rgba(var(--accent-cyan), 0.4);
  }

  .btn-emerald {
    background: rgba(16, 185, 129, 0.25);
    border-color: rgba(16, 185, 129, 0.5);
    color: #6EE7B7;
  }

  .btn-emerald:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.4);
  }

  .btn-red {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
    color: #FCA5A5;
  }

  .btn-red:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.35);
  }

  .link-task-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(var(--accent-cyan), 0.1);
    border: 1px solid rgba(var(--accent-cyan), 0.25);
    border-radius: 4px;
    color: rgb(var(--accent-cyan));
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .link-task-btn:hover {
    background: rgba(var(--accent-cyan), 0.2);
    color: #FFFFFF;
  }

  /* Detail View */
  .detail-container {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .detail-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .detail-header-left {
    display: flex;
    align-items: center;
    gap: 16px;
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
    color: #FFFFFF;
    font-family: monospace;
  }

  .detail-header-right {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }

  .status-action-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .total-display {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .total-label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .total-amount-highlight {
    font-size: 1.3rem;
    font-weight: 700;
    color: #FFFFFF;
    font-family: monospace;
  }

  .detail-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }

  .meta-card {
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .meta-value {
    font-size: 0.95rem;
    color: #FFFFFF;
  }

  /* Form & Add Line Panel */
  .add-line-panel, .header-edit-box {
    padding: 16px 20px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
  }

  .form-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #FFFFFF;
    margin: 0 0 12px 0;
  }

  .add-line-form, .form-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .form-input, .form-select, .form-textarea {
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: #FFFFFF;
    font-size: 0.85rem;
  }

  .form-input:focus, .form-select:focus, .form-textarea:focus {
    outline: none;
    border-color: rgba(var(--accent-cyan), 0.6);
  }

  .form-input-sm {
    padding: 4px 8px;
    font-size: 0.8rem;
  }

  .form-actions-inline {
    display: flex;
    gap: 8px;
    padding-bottom: 2px;
  }

  .cost-hint {
    margin: 8px 0 0 0;
    font-size: 0.8rem;
  }

  /* Timeline */
  .timeline-section, .detail-lines-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-subtitle {
    font-size: 1rem;
    font-weight: 600;
    color: #FFFFFF;
    margin: 0;
  }

  .timeline-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .timeline-card {
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    opacity: 0.6;
  }

  .timeline-card.active {
    opacity: 1;
    border-color: rgba(var(--accent-cyan), 0.3);
    background: rgba(var(--accent-cyan), 0.03);
  }

  .timeline-card.cancelled {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.04);
  }

  .timeline-marker {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .timeline-card.active .timeline-marker {
    background: rgb(var(--accent-cyan));
    color: #000000;
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
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .timeline-time {
    font-size: 0.85rem;
    color: #FFFFFF;
    font-weight: 500;
  }

  .qty-warning-box, .qty-ok-box {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .qty-num {
    font-weight: 600;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .glass-modal {
    background: #111827;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  }

  .glass-modal-sm {
    max-width: 420px;
  }

  .glass-modal-lg {
    max-width: 780px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .modal-title {
    font-size: 1.15rem;
    font-weight: 700;
    color: #FFFFFF;
    margin: 0;
  }

  .btn-close-modal {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
  }

  .modal-body {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 70vh;
    overflow-y: auto;
  }

  .modal-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.2);
  }

  /* Empty state */
  .empty-state-panel {
    padding: 48px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .empty-state-icon {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .empty-state-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #FFFFFF;
    margin: 0;
  }

  .empty-state-desc {
    font-size: 0.88rem;
    color: var(--text-muted);
    max-width: 480px;
    margin: 0;
    line-height: 1.5;
  }

  .empty-actions-row {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* Breakdown row */
  .breakdown-row td {
    padding: 0;
  }

  .breakdown-card {
    padding: 16px;
    margin: 8px 16px 16px 16px;
    background: rgba(0, 0, 0, 0.35);
  }

  .breakdown-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #FFFFFF;
    margin: 0 0 12px 0;
  }

  .nested-movement-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  .nested-movement-table th {
    padding: 8px 12px;
    color: var(--text-muted);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
    background: rgba(16, 185, 129, 0.12);
    color: #6EE7B7;
    border: 1px solid rgba(16, 185, 129, 0.25);
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
  }

  .flex-1 { flex: 1; }
  .flex-2 { flex: 2; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .font-bold { font-weight: 700; }
  .font-medium { font-weight: 500; }
  .text-muted { color: var(--text-muted); }
  .text-emerald { color: #10B981; }
  .text-amber { color: #F59E0B; }
  .text-amethyst { color: #A855F7; }
  .text-cyan { color: rgb(var(--accent-cyan)); }
</style>
