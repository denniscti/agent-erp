<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    fetchWarehouses,
    fetchInventoryLevels,
    fetchUnitInventoryLevel,
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
    formatCurrency,
    formatAdjustmentReason,
    formatAdjustmentStatus,
    fetchInventoryAdjustments,
    fetchInventoryAdjustmentDetail,
    selectInventoryAdjustment,
    createInventoryAdjustmentAction,
    updateInventoryAdjustmentHeaderAction,
    addInventoryAdjustmentLineAction,
    updateInventoryAdjustmentLineAction,
    removeInventoryAdjustmentLineAction,
    postInventoryAdjustmentAction,
    cancelInventoryAdjustmentAction,
    formatStocktakeStatus,
    getStocktakeStatusBadgeClass,
    formatStocktakeProgress,
    isStocktakeMovementConflictError,
    STOCKTAKE_VARIANCE_EPSILON,
    fetchStocktakes,
    fetchStocktakeDetail,
    selectStocktake,
    createStocktakeAction,
    updateStocktakeHeaderAction,
    addStocktakeLinesAction,
    addStocktakeLinesFromStockAction,
    removeStocktakeLineAction,
    startStocktakeCountingAction,
    setStocktakeCountedQuantityAction,
    refreshStocktakeSystemQuantityAction,
    postStocktakeAction,
    cancelStocktakeAction,
    calculateStocktakePostSummary,
    parseStocktakeConflictLines,
    isStocktakeLineCounted
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

  // Adjustments list & detail state (Issue #183)
  let selectedAdjustmentWarehouseId = $state('');
  let selectedAdjustmentStatusFilter = $state('');
  let selectedAdjustmentId = $state(null);
  let adjustmentLoading = $state(false);
  let adjustmentError = $state('');
  let unitStockCache = $state({}); // key: `${whId}_${unitId}` -> number

  // Create Adjustment Modal state
  let isCreateAdjustmentModalOpen = $state(false);
  let createAdjWarehouseId = $state('');
  let createAdjReasonCode = $state('damage');
  let createAdjNote = $state('');
  let createAdjLines = $state([]); // array of { unit_id, quantity_delta }
  let newAdjLineUnitId = $state('');
  let newAdjLineDelta = $state(1);
  let createAdjError = $state('');
  let isCreatingAdjustment = $state(false);

  // Detail inline add line state (for draft)
  let draftDetailNewUnitId = $state('');
  let draftDetailNewDelta = $state(1);
  let draftDetailLineError = $state('');
  let isAddingDraftLine = $state(false);

  // Post Confirm Modal state
  let isPostConfirmModalOpen = $state(false);
  let postConfirmLoading = $state(false);
  let postConfirmError = $state('');

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

  let filteredAdjustments = $derived(
    (appState.inventoryAdjustments || []).filter(a => {
      if (selectedAdjustmentWarehouseId && a.warehouse_id !== selectedAdjustmentWarehouseId) {
        return false;
      }
      if (selectedAdjustmentStatusFilter && a.status !== selectedAdjustmentStatusFilter) {
        return false;
      }
      return true;
    })
  );

  let currentAdjustment = $derived(
    appState.currentInventoryAdjustmentDetail?.adjustment || null
  );

  let currentAdjustmentLines = $derived(
    appState.currentInventoryAdjustmentDetail?.lines || []
  );

  // Stocktakes list & detail state (Issue #184)
  let selectedStocktakeWarehouseId = $state('');
  let selectedStocktakeStatusFilter = $state('');
  let selectedStocktakeId = $derived(appState.selectedStocktakeId);
  let lineErrors = $state({});
  let stocktakeLoading = $state(false);
  let stocktakeError = $state('');

  // Stocktake modal state (consolidated: null | 'create' | 'editHeader' | 'startCounting' | 'post' | 'refresh')
  let activeStocktakeModal = $state(null);
  let stocktakeModalLoading = $state(false);
  let stocktakeModalError = $state('');

  // Modal-specific form parameters
  let createStkWarehouseId = $state('');
  let createStkNote = $state('');
  let createStkAutoFill = $state(false);
  let editStkWarehouseId = $state('');
  let editStkNote = $state('');
  let refreshTargetLineIds = $state([]);

  // Draft add line state
  let draftStkUnitId = $state('');
  let draftStkError = $state('');
  let isAddingDraftStkLine = $state(false);

  // S-07 / S-08 Affected lines state
  let affectedLineIds = $state([]);
  let affectedErrorMsg = $state('');

  let filteredStocktakes = $derived(
    (appState.stocktakes || []).filter(s => {
      if (selectedStocktakeWarehouseId && s.warehouse_id !== selectedStocktakeWarehouseId) {
        return false;
      }
      if (selectedStocktakeStatusFilter && s.status !== selectedStocktakeStatusFilter) {
        return false;
      }
      return true;
    })
  );

  let currentStocktake = $derived(
    appState.currentStocktakeDetail?.stocktake || null
  );

  let currentStocktakeLines = $derived(
    appState.currentStocktakeDetail?.lines || []
  );

  let postSummary = $derived(calculateStocktakePostSummary(currentStocktakeLines));

  let countedStocktakeLinesCount = $derived(
    postSummary.matched + postSummary.surplus + postSummary.shortage
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
      if (!selectedAdjustmentId && (!appState.inventoryAdjustments || appState.inventoryAdjustments.length === 0)) {
        loadAdjustments();
      }
    } else if (route.includes('/warehouses/stocktakes')) {
      activeSubTab = 'stocktakes';
      if (!selectedStocktakeId && (!appState.stocktakes || appState.stocktakes.length === 0)) {
        loadStocktakes();
      }
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
    if (activeSubTab === 'adjustments') {
      await loadAdjustments();
    }
    if (activeSubTab === 'stocktakes') {
      await loadStocktakes();
    }
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
    stocktakeError = '';
    expandedUnitId = null;

    if (tab === 'inventory') {
      navigate('/app/inventory');
    } else if (tab === 'warehouses') {
      navigate('/app/warehouses/master');
    } else if (tab === 'adjustments') {
      navigate('/app/warehouses/adjustments');
      selectedAdjustmentId = null;
      loadAdjustments();
    } else if (tab === 'stocktakes') {
      navigate('/app/warehouses/stocktakes');
      selectStocktake(null);
      if (appState.stocktakes && appState.stocktakes.length > 0) {
        loadStocktakes();
      }
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

  // Navigate to inventory adjustment detail from inventory ledger reference
  async function handleNavigateToAdjustment(adjId) {
    if (!adjId) return;
    activeSubTab = 'adjustments';
    navigate('/app/warehouses/adjustments');
    await handleSelectAdjustment(adjId);
  }

  // Navigate to stocktake detail from inventory ledger reference
  async function handleNavigateToStocktake(stkId) {
    if (!stkId) return;
    activeSubTab = 'stocktakes';
    navigate('/app/warehouses/stocktakes');
    await handleSelectStocktake(stkId);
  }

  // Stocktakes helper methods (Issue #184)
  async function loadStocktakes() {
    if (stocktakeLoading) return;
    stocktakeLoading = true;
    stocktakeError = '';
    try {
      await fetchStocktakes({
        status: selectedStocktakeStatusFilter || null,
        warehouse_id: selectedStocktakeWarehouseId || null
      });
    } catch (err) {
      console.error("Failed to load stocktakes:", err);
      showToast(err.message || '載入盤點單失敗', 'error');
    } finally {
      stocktakeLoading = false;
    }
  }

  async function handleSelectStocktake(stkId) {
    stocktakeError = '';
    draftStkError = '';
    affectedLineIds = [];
    affectedErrorMsg = '';
    lineErrors = {};
    if (!stkId) {
      await selectStocktake(null);
      return;
    }
    stocktakeLoading = true;
    try {
      await selectStocktake(stkId);
    } catch (err) {
      stocktakeError = err.message || '載入盤點單明細失敗';
    } finally {
      stocktakeLoading = false;
    }
  }

  async function handleBackToStocktakesList() {
    await selectStocktake(null);
    draftStkError = '';
    affectedLineIds = [];
    affectedErrorMsg = '';
    lineErrors = {};
    await loadStocktakes();
  }

  function closeStocktakeModal() {
    activeStocktakeModal = null;
    stocktakeModalLoading = false;
    stocktakeModalError = '';
  }

  function handleOpenCreateStocktake() {
    createStkWarehouseId = defaultWarehouse ? defaultWarehouse.id : (activeWarehouses[0]?.id || '');
    createStkNote = '';
    createStkAutoFill = false;
    stocktakeModalError = '';
    activeStocktakeModal = 'create';
  }

  async function handleConfirmCreateStocktake() {
    stocktakeModalError = '';
    if (!createStkWarehouseId) {
      stocktakeModalError = '請選擇盤點倉庫';
      return;
    }
    stocktakeModalLoading = true;
    try {
      const stk = await createStocktakeAction({
        warehouse_id: createStkWarehouseId,
        note: createStkNote ? createStkNote.trim() : null,
        task_id: null
      });

      closeStocktakeModal();
      if (stk?.id) {
        activeStocktakeTab = 'lines';
        affectedLineIds = [];
        affectedErrorMsg = '';
        lineErrors = {};
      }

      if (createStkAutoFill && stk?.id) {
        try {
          await addStocktakeLinesFromStockAction(stk.id);
        } catch (fillErr) {
          console.warn("Auto-fill lines warning:", fillErr);
          showToast(`自動帶入現有品項失敗：${fillErr.message || fillErr}`, 'error');
        }
      }
    } catch (err) {
      stocktakeModalError = err.message || '建立盤點單失敗';
    } finally {
      stocktakeModalLoading = false;
    }
  }

  function handleOpenEditHeaderModal() {
    if (!currentStocktake) return;
    editStkWarehouseId = currentStocktake.warehouse_id || '';
    editStkNote = currentStocktake.note || '';
    stocktakeModalError = '';
    activeStocktakeModal = 'editHeader';
  }

  async function handleConfirmEditHeader() {
    if (!selectedStocktakeId) return;
    if (!editStkWarehouseId) {
      stocktakeModalError = '請選擇盤點倉庫';
      return;
    }
    stocktakeModalLoading = true;
    stocktakeModalError = '';
    try {
      await updateStocktakeHeaderAction(selectedStocktakeId, {
        warehouse_id: editStkWarehouseId,
        note: editStkNote
      });
      closeStocktakeModal();
    } catch (err) {
      stocktakeModalError = err.message || '更新盤點單表頭失敗';
    } finally {
      stocktakeModalLoading = false;
    }
  }

  async function handleAddStocktakeLineFromDraft() {
    if (!draftStkUnitId || !selectedStocktakeId) return;
    draftStkError = '';
    isAddingDraftStkLine = true;
    try {
      await addStocktakeLinesAction(selectedStocktakeId, [draftStkUnitId]);
      draftStkUnitId = '';
    } catch (err) {
      draftStkError = err.message || '加入品項失敗';
    } finally {
      isAddingDraftStkLine = false;
    }
  }

  async function handleAddStocktakeLinesFromStock() {
    if (!selectedStocktakeId) return;
    stocktakeError = '';
    try {
      await addStocktakeLinesFromStockAction(selectedStocktakeId);
    } catch (err) {
      stocktakeError = err.message || '帶入現有庫存品項失敗';
    }
  }

  async function handleRemoveStocktakeLine(lineId) {
    if (!lineId) return;
    try {
      await removeStocktakeLineAction(lineId);
    } catch (err) {
      stocktakeError = err.message || '移除品項失敗';
    }
  }

  function handleOpenStartCountingModal() {
    stocktakeModalError = '';
    if (!currentStocktakeLines || currentStocktakeLines.length === 0) {
      stocktakeError = '盤點單沒有任何品項，請先新增品項 (S-05)';
      return;
    }
    activeStocktakeModal = 'startCounting';
  }

  async function handleConfirmStartCounting() {
    if (!selectedStocktakeId) return;
    stocktakeModalLoading = true;
    stocktakeModalError = '';
    try {
      await startStocktakeCountingAction(selectedStocktakeId);
      closeStocktakeModal();
    } catch (err) {
      stocktakeModalError = err.message || '開始盤點失敗';
    } finally {
      stocktakeModalLoading = false;
    }
  }

  async function handleCountedQuantityChange(lineId, rawValue, inputEl = null) {
    if (!lineId) return;
    delete lineErrors[lineId];
    const line = currentStocktakeLines.find(l => l.id === lineId);
    if (!line) return;

    const revertInput = () => {
      const el = inputEl || document.getElementById(`input-counted-${lineId}`);
      if (el) {
        el.value = line.counted_quantity ?? '';
      }
    };

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      if (line.counted_quantity === null || line.counted_quantity === undefined) {
        revertInput();
        return;
      }
      try {
        await setStocktakeCountedQuantityAction(lineId, null);
      } catch (err) {
        lineErrors[lineId] = err.message || '清除實盤量失敗';
        revertInput();
      }
      return;
    }

    const val = Number(rawValue);
    if (isNaN(val) || val < 0) {
      lineErrors[lineId] = '實盤量不可為負';
      revertInput();
      return;
    }

    if (line.counted_quantity === val) {
      return;
    }

    try {
      await setStocktakeCountedQuantityAction(lineId, val);
    } catch (err) {
      lineErrors[lineId] = err.message || '儲存實盤量失敗';
      revertInput();
    }
  }

  function handleOpenPostStocktakeModal() {
    stocktakeModalError = '';
    if (postSummary.missing > 0) {
      stocktakeError = `尚有 ${postSummary.missing} 項未輸入實盤量，無法過帳 (S-07)`;
      return;
    }
    activeStocktakeModal = 'post';
  }

  async function handleConfirmPostStocktake() {
    if (!selectedStocktakeId) return;
    stocktakeModalLoading = true;
    stocktakeModalError = '';
    try {
      await postStocktakeAction(selectedStocktakeId);
      closeStocktakeModal();
      affectedLineIds = [];
      affectedErrorMsg = '';
    } catch (err) {
      const msg = err.message || String(err);
      stocktakeModalError = msg;
      // Detect S-07 concurrency movement error
      if (isStocktakeMovementConflictError(err)) {
        const matched = parseStocktakeConflictLines(err, currentStocktakeLines);
        if (matched.length > 0) {
          affectedLineIds = matched;
          affectedErrorMsg = msg;
        } else {
          affectedLineIds = [];
          affectedErrorMsg = '';
          showToast(msg, 'error');
        }
        closeStocktakeModal();
      } else {
        affectedLineIds = [];
        affectedErrorMsg = '';
      }
    } finally {
      stocktakeModalLoading = false;
    }
  }

  function handleOpenRefreshSystemQtyModal(targetLineIds) {
    if (!Array.isArray(targetLineIds) || targetLineIds.length === 0) {
      refreshTargetLineIds = [];
      return;
    }
    refreshTargetLineIds = [...targetLineIds];
    stocktakeModalError = '';
    activeStocktakeModal = 'refresh';
  }

  async function handleConfirmRefreshSystemQty() {
    if (!selectedStocktakeId || refreshTargetLineIds.length === 0) return;
    stocktakeModalLoading = true;
    stocktakeModalError = '';
    try {
      await refreshStocktakeSystemQuantityAction(selectedStocktakeId, refreshTargetLineIds);
      closeStocktakeModal();
      affectedErrorMsg = '';
      affectedLineIds = [];
    } catch (err) {
      stocktakeModalError = err.message || '重新取得系統量失敗';
    } finally {
      stocktakeModalLoading = false;
    }
  }

  const STOCKTAKE_LINE_COLUMNS = {
    draft: [
      { key: 'no', label: '#', width: '44px' },
      { key: 'product', label: '商品／規格／單位' },
      { key: 'system_qty', label: '系統量快照', align: 'right' },
      { key: 'actions', label: '操作', align: 'center', width: '80px' }
    ],
    counting: [
      { key: 'no', label: '#', width: '44px' },
      { key: 'product', label: '商品／規格／單位' },
      { key: 'system_qty', label: '帳面量 (快照)', align: 'right' },
      { key: 'snapshot_at', label: '快照時間', width: '140px' },
      { key: 'counted_qty', label: '實盤量', align: 'right', width: '130px' },
      { key: 'delta', label: '差異', align: 'right', width: '120px' },
      { key: 'actions', label: '狀態／操作', align: 'center', width: '130px' }
    ],
    posted: [
      { key: 'no', label: '#', width: '44px' },
      { key: 'product', label: '商品／規格／單位' },
      { key: 'system_qty', label: '帳面量 (快照)', align: 'right' },
      { key: 'snapshot_at', label: '快照時間', width: '140px' },
      { key: 'counted_qty', label: '實盤量', align: 'right', width: '130px' },
      { key: 'delta', label: '差異', align: 'right', width: '120px' }
    ],
    cancelled: [
      { key: 'no', label: '#', width: '44px' },
      { key: 'product', label: '商品／規格／單位' },
      { key: 'system_qty', label: '帳面量 (快照)', align: 'right' },
      { key: 'snapshot_at', label: '快照時間', width: '140px' },
      { key: 'counted_qty', label: '實盤量', align: 'right', width: '130px' },
      { key: 'delta', label: '差異', align: 'right', width: '120px' }
    ]
  };

  function getStocktakeLineColumns(status) {
    return STOCKTAKE_LINE_COLUMNS[status] || STOCKTAKE_LINE_COLUMNS.counting;
  }

  function getStocktakeStatusBanner(status) {
    switch (status) {
      case 'counting':
        return { badgeClass: 'badge-sky', label: '盤點中 (隨時可中途離開，輸入內容已由本地儲存)' };
      case 'posted':
        return { badgeClass: 'badge-emerald', label: '唯讀 (已過帳)' };
      case 'cancelled':
        return { badgeClass: 'badge-slate', label: '唯讀 (已取消)' };
      default:
        return null;
    }
  }

  function getAdjustmentStatusBadgeClass(status) {
    switch (status) {
      case 'posted':
        return 'badge-emerald';
      case 'cancelled':
        return 'badge-slate';
      default:
        return 'badge-amber';
    }
  }

  async function handleCancelStocktake() {
    if (!currentStocktake) return;
    if (!confirm(`確定要取消盤點單 #${currentStocktake.stocktake_number} 嗎？`)) {
      return;
    }
    try {
      await cancelStocktakeAction(currentStocktake.id);
    } catch (err) {
      showToast(err.message || '取消盤點單失敗', 'error');
    }
  }

  // Adjustments helper methods (Issue #183)
  function getUnitLabel(unitId) {
    if (!unitId) return '';
    const found = availableUnits.find(u => u.unit_id === unitId);
    if (found) return found.label;
    const inv = (appState.inventoryLevels || []).find(l => l.unit_id === unitId);
    if (inv) {
      return `${inv.product_name} (${inv.variant_name || '標準'}) - ${inv.unit_name || ''}`;
    }
    return unitId;
  }

  async function fetchUnitStock(warehouseId, unitId) {
    if (!warehouseId || !unitId) return 0;
    const key = `${warehouseId}_${unitId}`;
    try {
      const res = await fetchUnitInventoryLevel(warehouseId, unitId);
      const qty = res ? (res.current_quantity || 0) : 0;
      unitStockCache[key] = qty;
      return qty;
    } catch (err) {
      console.error('Failed to fetch inventory level for unit:', unitId, err);
      return 0;
    }
  }

  function getCachedStock(warehouseId, unitId) {
    if (!warehouseId || !unitId) return 0;
    const key = `${warehouseId}_${unitId}`;
    if (unitStockCache[key] !== undefined) {
      return unitStockCache[key];
    }
    fetchUnitStock(warehouseId, unitId);
    const match = (appState.inventoryLevels || []).find(
      l => l.unit_id === unitId && (l.warehouse_id === warehouseId || !l.warehouse_id)
    );
    return match ? (match.current_quantity || 0) : 0;
  }

  async function loadAdjustments() {
    adjustmentLoading = true;
    adjustmentError = '';
    try {
      await fetchInventoryAdjustments(
        selectedAdjustmentWarehouseId || null,
        selectedAdjustmentStatusFilter || null
      );
    } catch (err) {
      adjustmentError = err.message || '載入調整單失敗';
    } finally {
      adjustmentLoading = false;
    }
  }

  async function handleSelectAdjustment(id) {
    selectedAdjustmentId = id;
    adjustmentLoading = true;
    adjustmentError = '';
    try {
      const detail = await selectInventoryAdjustment(id);
      if (detail && detail.adjustment && detail.lines) {
        for (const line of detail.lines) {
          fetchUnitStock(detail.adjustment.warehouse_id, line.unit_id);
        }
      }
    } catch (err) {
      adjustmentError = err.message || '載入調整單明細失敗';
    } finally {
      adjustmentLoading = false;
    }
  }

  async function handleBackToAdjustmentsList() {
    selectedAdjustmentId = null;
    await selectInventoryAdjustment(null);
    await loadAdjustments();
  }

  function handleOpenCreateAdjustment(prefill = null) {
    createAdjError = '';
    if (prefill) {
      createAdjWarehouseId = prefill.warehouse_id || (defaultWarehouse ? defaultWarehouse.id : (activeWarehouses[0]?.id || ''));
      createAdjReasonCode = prefill.reason_code || 'damage';
      createAdjNote = prefill.note || '';
      createAdjLines = prefill.lines ? [...prefill.lines] : [];
      newAdjLineUnitId = prefill.unit_id || '';
      newAdjLineDelta = prefill.delta !== undefined ? prefill.delta : 1;
    } else {
      createAdjWarehouseId = defaultWarehouse ? defaultWarehouse.id : (activeWarehouses[0]?.id || '');
      createAdjReasonCode = 'damage';
      createAdjNote = '';
      createAdjLines = [];
      newAdjLineUnitId = '';
      newAdjLineDelta = 1;
    }
    if (createAdjWarehouseId && newAdjLineUnitId) {
      fetchUnitStock(createAdjWarehouseId, newAdjLineUnitId);
    }
    if (createAdjWarehouseId && createAdjLines.length > 0) {
      for (const line of createAdjLines) {
        fetchUnitStock(createAdjWarehouseId, line.unit_id);
      }
    }
    isCreateAdjustmentModalOpen = true;
  }

  function handleCloseCreateAdjustmentModal() {
    isCreateAdjustmentModalOpen = false;
    createAdjError = '';
    createAdjLines = [];
    newAdjLineUnitId = '';
    newAdjLineDelta = 1;
  }

  function handleAddLineToCreateModal() {
    createAdjError = '';
    if (!newAdjLineUnitId) {
      createAdjError = '請先選擇商品單位';
      return;
    }
    const deltaNum = Number(newAdjLineDelta);
    if (!deltaNum || deltaNum === 0 || !Number.isInteger(deltaNum)) {
      createAdjError = '增減數量必須為非零整數 (A-04)';
      return;
    }
    if (createAdjLines.some(l => l.unit_id === newAdjLineUnitId)) {
      createAdjError = '同一張調整單內不能包含重複的商品單位 (A-05)';
      return;
    }

    createAdjLines = [
      ...createAdjLines,
      {
        unit_id: newAdjLineUnitId,
        quantity_delta: deltaNum
      }
    ];

    fetchUnitStock(createAdjWarehouseId, newAdjLineUnitId);
    newAdjLineUnitId = '';
    newAdjLineDelta = 1;
  }

  function handleRemoveLineFromCreateModal(index) {
    createAdjLines = createAdjLines.filter((_, idx) => idx !== index);
  }

  async function handleSubmitCreateAdjustment() {
    createAdjError = '';
    if (!createAdjWarehouseId) {
      createAdjError = '請選擇倉庫 (A-01)';
      return;
    }
    if (createAdjReasonCode === 'other' && (!createAdjNote || !createAdjNote.trim())) {
      createAdjError = '調整原因為「其他」時，備註為必填 (A-03)';
      return;
    }

    isCreatingAdjustment = true;
    try {
      const adj = await createInventoryAdjustmentAction({
        warehouse_id: createAdjWarehouseId,
        reason_code: createAdjReasonCode,
        note: createAdjNote?.trim() ? createAdjNote.trim() : null,
        task_id: null,
        initial_lines: createAdjLines.map(line => ({
          unit_id: line.unit_id,
          quantity_delta: line.quantity_delta
        }))
      });

      showToast('調整單草稿建立成功', 'success');
      handleCloseCreateAdjustmentModal();
      await handleSelectAdjustment(adj.id);
    } catch (err) {
      createAdjError = err.message || '建立調整單失敗';
    } finally {
      isCreatingAdjustment = false;
    }
  }

  async function handleAddLineToDraftDetail() {
    draftDetailLineError = '';
    if (!draftDetailNewUnitId) {
      draftDetailLineError = '請先選擇商品單位';
      return;
    }
    const deltaNum = Number(draftDetailNewDelta);
    if (!deltaNum || deltaNum === 0 || !Number.isInteger(deltaNum)) {
      draftDetailLineError = '增減數量必須為非零整數 (A-04)';
      return;
    }
    if (currentAdjustmentLines.some(l => l.unit_id === draftDetailNewUnitId)) {
      draftDetailLineError = '此商品單位已在明細中 (A-05)';
      return;
    }

    isAddingDraftLine = true;
    try {
      await addInventoryAdjustmentLineAction(
        currentAdjustment.id,
        draftDetailNewUnitId,
        deltaNum
      );
      fetchUnitStock(currentAdjustment.warehouse_id, draftDetailNewUnitId);
      draftDetailNewUnitId = '';
      draftDetailNewDelta = 1;
      showToast('明細項目已新增', 'success');
    } catch (err) {
      draftDetailLineError = err.message || '新增明細失敗';
    } finally {
      isAddingDraftLine = false;
    }
  }

  async function handleRemoveLineFromDraftDetail(lineId) {
    if (!currentAdjustment || currentAdjustment.status !== 'draft') return;
    try {
      await removeInventoryAdjustmentLineAction(lineId);
      showToast('明細已移除', 'info');
    } catch (err) {
      showToast(err.message || '移除明細失敗', 'error');
    }
  }

  function handleOpenPostConfirmModal() {
    postConfirmError = '';
    isPostConfirmModalOpen = true;
  }

  function handleClosePostConfirmModal() {
    isPostConfirmModalOpen = false;
    postConfirmError = '';
  }

  async function handleConfirmPostAdjustment() {
    if (!currentAdjustment) return;
    postConfirmLoading = true;
    postConfirmError = '';
    try {
      const adjWhId = currentAdjustment.warehouse_id;
      await postInventoryAdjustmentAction(currentAdjustment.id);
      showToast('調整單已成功過帳 (庫存已更新)', 'success');
      handleClosePostConfirmModal();
      unitStockCache = {};
      await fetchInventoryLevels(selectedWarehouseId || null);
      if (adjWhId && currentAdjustmentLines?.length) {
        for (const line of currentAdjustmentLines) {
          fetchUnitStock(adjWhId, line.unit_id);
        }
      }
    } catch (err) {
      postConfirmError = err.message || String(err);
    } finally {
      postConfirmLoading = false;
    }
  }

  async function handleCancelAdjustment() {
    if (!currentAdjustment || currentAdjustment.status !== 'draft') return;
    if (!confirm(`確定要取消草稿調整單 #${currentAdjustment.adjustment_number} 嗎？`)) {
      return;
    }
    try {
      await cancelInventoryAdjustmentAction(currentAdjustment.id);
      showToast('調整單已取消', 'info');
    } catch (err) {
      showToast(err.message || '取消調整單失敗', 'error');
    }
  }

  function handleCreateReverseAdjustment() {
    if (!currentAdjustment || currentAdjustment.status !== 'posted') return;
    const invertedLines = currentAdjustmentLines.map(l => ({
      unit_id: l.unit_id,
      quantity_delta: -l.quantity_delta
    }));

    handleOpenCreateAdjustment({
      warehouse_id: currentAdjustment.warehouse_id,
      reason_code: currentAdjustment.reason_code,
      note: `反向調整自 ${currentAdjustment.adjustment_number}`,
      lines: invertedLines
    });
  }

  function handleCreateOpeningCorrectionAdjustment(whId, unitId) {
    closeOpeningBalanceModal();
    activeSubTab = 'adjustments';
    navigate('/app/warehouses/adjustments');
    handleOpenCreateAdjustment({
      warehouse_id: whId || (defaultWarehouse ? defaultWarehouse.id : (activeWarehouses[0]?.id || '')),
      reason_code: 'opening_correction',
      unit_id: unitId,
      delta: 0,
      note: '期初更正調整'
    });
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
        {:else if activeSubTab === 'adjustments' && !hasZeroWarehouses}
          <button
            class="btn btn-primary btn-sm"
            onclick={() => handleOpenCreateAdjustment()}
            id="btn-open-create-adjustment-modal"
          >
            + 新增調整單
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
                                          {:else if mov.reference_type === 'inventory_adjustment' || mov.reason === 'adjustment' || mov.reference_id.startsWith('adj_')}
                                            <button
                                              class="link-po-ref link-adj-ref"
                                              onclick={() => handleNavigateToAdjustment(mov.reference_id)}
                                              title="點擊前往此調整單明細"
                                            >
                                              調整單 #{mov.reference_id.slice(-6)}
                                            </button>
                                          {:else if mov.reference_type === 'stocktake' || mov.reason === 'stocktake' || mov.reason === 'stocktake_discrepancy' || mov.reference_id.startsWith('stk_')}
                                            <button
                                              class="link-po-ref link-stk-ref"
                                              onclick={() => handleNavigateToStocktake(mov.reference_id)}
                                              title="點擊前往此盤點單明細"
                                              id="link-stk-{mov.reference_id}"
                                            >
                                              盤點單 #{mov.reference_id.slice(-6)}
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

    <!-- SUBTAB 3: 庫存調整單 (Issue #183) -->
    {:else if activeSubTab === 'adjustments'}
      {#if selectedAdjustmentId && currentAdjustment}
        <!-- DETAIL VIEW -->
        <div class="adjustment-detail-container">
          <!-- Top back bar & actions -->
          <div class="detail-header-bar flex-between" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                id="btn-back-to-adjustments"
                onclick={handleBackToAdjustmentsList}
              >
                ← 返回調整單清單
              </button>
              <h2 style="margin: 0; font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                <span>調整單 #{currentAdjustment.adjustment_number}</span>
                <span class="badge {getAdjustmentStatusBadgeClass(currentAdjustment.status)}">
                  {formatAdjustmentStatus(currentAdjustment.status)}
                </span>
              </h2>
            </div>

            <div class="detail-actions" style="display: flex; gap: 8px;">
              {#if currentAdjustment.status === 'draft'}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  id="btn-post-adjustment"
                  onclick={handleOpenPostConfirmModal}
                  disabled={currentAdjustmentLines.length === 0}
                  title={currentAdjustmentLines.length === 0 ? '無明細時無法過帳 (A-07)' : '過帳調整單'}
                >
                  過帳調整單
                </button>
                <button
                  type="button"
                  class="btn btn-outline btn-sm text-red"
                  id="btn-cancel-adjustment"
                  onclick={handleCancelAdjustment}
                >
                  取消調整單
                </button>
              {:else if currentAdjustment.status === 'posted'}
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  id="btn-reverse-adjustment"
                  onclick={handleCreateReverseAdjustment}
                >
                  ↺ 建立反向調整單
                </button>
              {/if}
            </div>
          </div>

          <!-- Info cards -->
          <div class="glass-panel" style="padding: 16px; margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">調整倉庫</div>
                <div style="font-weight: 600;">{getWarehouseName(currentAdjustment.warehouse_id)}</div>
              </div>
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">調整原因</div>
                <span class="badge badge-amber">{formatAdjustmentReason(currentAdjustment.reason_code)}</span>
              </div>
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">備註說明</div>
                <div>{currentAdjustment.note || '無備註'}</div>
              </div>
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">建立時間</div>
                <div style="font-family: monospace; font-size: 0.85rem;">{formatTime(currentAdjustment.created_at)}</div>
              </div>
              {#if currentAdjustment.posted_at}
                <div>
                  <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">過帳時間</div>
                  <div style="font-family: monospace; font-size: 0.85rem;" class="text-emerald font-semibold">{formatTime(currentAdjustment.posted_at)}</div>
                </div>
              {/if}
              {#if currentAdjustment.cancelled_at}
                <div>
                  <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">取消時間</div>
                  <div style="font-family: monospace; font-size: 0.85rem;" class="text-muted">{formatTime(currentAdjustment.cancelled_at)}</div>
                </div>
              {/if}
            </div>
          </div>

          <!-- Lines Table Card -->
          <div class="glass-panel" style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h3 style="margin: 0; font-size: 1rem; font-weight: 600;">
                調整單明細 ({currentAdjustmentLines.length} 筆)
              </h3>
              {#if currentAdjustment.status !== 'draft'}
                <span class="badge badge-slate" style="font-size: 0.75rem;">唯讀 (已過帳/已取消)</span>
              {/if}
            </div>

            {#if currentAdjustmentLines.length > 0}
              <div class="table-responsive">
                <table class="inventory-table">
                  <thead>
                    <tr>
                      <th style="width: 48px;">#</th>
                      <th>商品單位</th>
                      <th class="text-right">目前庫存</th>
                      <th class="text-right">增減數量</th>
                      <th class="text-right">調整後數量</th>
                      {#if currentAdjustment.status === 'draft'}
                        <th class="text-center" style="width: 80px;">操作</th>
                      {/if}
                    </tr>
                  </thead>
                  <tbody>
                    {#each currentAdjustmentLines as line}
                      {@const curStock = getCachedStock(currentAdjustment.warehouse_id, line.unit_id)}
                      {@const afterStock = curStock + line.quantity_delta}
                      {@const isNeg = afterStock < 0}
                      <tr class={isNeg ? 'row-warning' : ''}>
                        <td>{line.line_no ?? line.line_number ?? ''}</td>
                        <td class="font-medium">{getUnitLabel(line.unit_id)}</td>
                        <td class="text-right font-mono">{curStock}</td>
                        <td class="text-right font-mono font-bold {line.quantity_delta > 0 ? 'text-emerald' : 'text-amber'}">
                          {line.quantity_delta > 0 ? `+${line.quantity_delta}` : line.quantity_delta}
                        </td>
                        <td class="text-right font-mono {isNeg ? 'text-red font-bold' : 'text-emerald font-semibold'}">
                          {afterStock}
                          {#if isNeg}
                            <span class="badge badge-red ml-1">⚠️ 負數</span>
                          {/if}
                        </td>
                        {#if currentAdjustment.status === 'draft'}
                          <td class="text-center">
                            <button
                              type="button"
                              class="btn-icon-danger"
                              id="btn-remove-line-{line.id}"
                              onclick={() => handleRemoveLineFromDraftDetail(line.id)}
                              title="移除此明細"
                            >
                              ✕
                            </button>
                          </td>
                        {/if}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <div class="empty-lines-hint text-center" style="padding: 24px; color: var(--text-secondary); font-size: 0.85rem;">
                此調整單目前沒有任何明細項目。
              </div>
            {/if}

            <!-- Draft Inline Add Line -->
            {#if currentAdjustment.status === 'draft'}
              <div class="add-draft-line-box" style="margin-top: 16px; padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-color); border-radius: 6px;">
                <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 8px; color: var(--text-secondary);">+ 新增明細項目</div>
                {#if draftDetailLineError}
                  <div class="alert alert-danger" style="margin-bottom: 8px; padding: 6px 10px; border-radius: 4px; font-size: 0.8rem; color: #ef4444; background: rgba(239, 68, 68, 0.1);">
                    {draftDetailLineError}
                  </div>
                {/if}
                <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;">
                  <div style="flex: 2; min-width: 200px;">
                    <label for="draft-detail-new-unit" style="display: block; font-size: 0.75rem; margin-bottom: 4px;">商品單位</label>
                    <select
                      id="draft-detail-new-unit"
                      bind:value={draftDetailNewUnitId}
                      class="form-select form-select-sm"
                      onchange={(e) => {
                        fetchUnitStock(currentAdjustment.warehouse_id, e.currentTarget.value);
                      }}
                    >
                      <option value="">-- 選擇商品單位 --</option>
                      {#each availableUnits.filter(u => !currentAdjustmentLines.some(l => l.unit_id === u.unit_id)) as unit}
                        <option value={unit.unit_id}>{unit.label}</option>
                      {/each}
                    </select>
                  </div>
                  <div style="flex: 1; min-width: 100px;">
                    <label for="draft-detail-new-delta" style="display: block; font-size: 0.75rem; margin-bottom: 4px;">增減量 (+/-)</label>
                    <input
                      type="number"
                      id="draft-detail-new-delta"
                      bind:value={draftDetailNewDelta}
                      class="form-input form-input-sm text-right"
                      placeholder="非 0 整數"
                    />
                  </div>
                  <div style="flex: 2; min-width: 180px;">
                    <span style="display: block; font-size: 0.75rem; margin-bottom: 4px; color: var(--text-secondary);">庫存預覽</span>
                    {#if draftDetailNewUnitId}
                      {@const cur = getCachedStock(currentAdjustment.warehouse_id, draftDetailNewUnitId)}
                      {@const after = cur + (Number(draftDetailNewDelta) || 0)}
                      {@const isNeg = after < 0}
                      <div style="font-size: 0.8rem; padding: 5px 8px; background: rgba(255,255,255,0.04); border-radius: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>目前: <strong>{cur}</strong></span>
                        <span>→</span>
                        <span class={isNeg ? 'text-red font-bold' : 'text-emerald font-semibold'}>調整後: {after}</span>
                        {#if isNeg}
                          <span class="badge badge-red" style="font-size: 0.7rem;">⚠️ 負數</span>
                        {/if}
                      </div>
                    {:else}
                      <div style="font-size: 0.8rem; color: var(--text-muted); padding: 5px 8px;">選擇單位預覽</div>
                    {/if}
                  </div>
                  <div>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      id="btn-add-draft-line"
                      onclick={handleAddLineToDraftDetail}
                      disabled={isAddingDraftLine}
                    >
                      + 加入明細
                    </button>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- LIST VIEW -->
        <div class="adjustments-list-container">
          <!-- Filter bar -->
          <div class="filter-bar glass-panel" style="display: flex; gap: 14px; align-items: center; padding: 12px 16px; margin-bottom: 16px; flex-wrap: wrap;">
            {#if activeWarehouses.length > 1}
              <div style="display: flex; align-items: center; gap: 6px;">
                <label for="filter-adj-warehouse" style="font-size: 0.85rem; color: var(--text-secondary);">倉別：</label>
                <select
                  id="filter-adj-warehouse"
                  bind:value={selectedAdjustmentWarehouseId}
                  class="form-select form-select-sm"
                  onchange={loadAdjustments}
                >
                  <option value="">全部倉庫</option>
                  {#each activeWarehouses as wh}
                    <option value={wh.id}>{wh.name} ({wh.code})</option>
                  {/each}
                </select>
              </div>
            {/if}

            <div style="display: flex; align-items: center; gap: 6px;">
              <label for="filter-adj-status" style="font-size: 0.85rem; color: var(--text-secondary);">狀態：</label>
              <select
                id="filter-adj-status"
                bind:value={selectedAdjustmentStatusFilter}
                class="form-select form-select-sm"
                onchange={loadAdjustments}
              >
                <option value="">全部狀態</option>
                <option value="draft">草稿 (draft)</option>
                <option value="posted">已過帳 (posted)</option>
                <option value="cancelled">已取消 (cancelled)</option>
              </select>
            </div>

            <div style="margin-left: auto;">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onclick={loadAdjustments}
                disabled={adjustmentLoading}
              >
                {adjustmentLoading ? '載入中...' : '重新整理'}
              </button>
            </div>
          </div>

          {#if adjustmentError}
            <div class="alert alert-danger" style="margin-bottom: 14px; padding: 10px 14px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.85rem;">
              {adjustmentError}
            </div>
          {/if}

          {#if filteredAdjustments.length === 0}
            <div class="empty-state-panel glass-panel" style="padding: 48px 24px; text-align: center;">
              <div class="empty-state-icon" style="margin-bottom: 12px; opacity: 0.6;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0 1.82.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </div>
              <h3 class="empty-state-title" style="margin-bottom: 6px; font-size: 1.1rem; font-weight: 600;">尚無庫存調整單</h3>
              <p class="empty-state-desc" style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
                目前條件下沒有找到任何庫存調整單。您可以點擊下方按鈕建立第一筆調整單。
              </p>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                onclick={() => handleOpenCreateAdjustment()}
              >
                + 建立調整單
              </button>
            </div>
          {:else}
            <div class="table-responsive glass-panel" style="padding: 0; overflow: hidden;">
              <table class="inventory-table">
                <thead>
                  <tr>
                    <th>單號</th>
                    <th>倉別</th>
                    <th>原因</th>
                    <th class="text-right">明細筆數</th>
                    <th>建立時間</th>
                    <th>狀態</th>
                    <th class="text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredAdjustments as adj}
                    <tr class="table-row-hover">
                      <td>
                        <button
                          type="button"
                          class="link-po-ref"
                          style="font-family: monospace; font-weight: 600;"
                          id="adj-link-{adj.id}"
                          onclick={() => handleSelectAdjustment(adj.id)}
                        >
                          #{adj.adjustment_number}
                        </button>
                      </td>
                      <td>
                        <span class="unit-tag" style="background: rgba(var(--accent-amber), 0.1); color: rgb(var(--accent-amber)); border: 1px solid rgba(var(--accent-amber), 0.2);">
                          {getWarehouseName(adj.warehouse_id)}
                        </span>
                      </td>
                      <td>
                        <span class="badge badge-amber">{formatAdjustmentReason(adj.reason_code)}</span>
                      </td>
                      <td class="text-right font-mono">{adj.lines_count ?? '-'}</td>
                      <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">{formatTime(adj.created_at)}</td>
                      <td>
                        <span class="badge {getAdjustmentStatusBadgeClass(adj.status)}">
                          {formatAdjustmentStatus(adj.status)}
                        </span>
                      </td>
                      <td class="text-center">
                        <button
                          type="button"
                          class="btn btn-outline btn-xs"
                          id="btn-view-adj-{adj.id}"
                          onclick={() => handleSelectAdjustment(adj.id)}
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

    <!-- SUBTAB 4: 盤點單作業 (Issue #184) -->
    {:else if activeSubTab === 'stocktakes'}
      {#if selectedStocktakeId && currentStocktake}
        <!-- DETAIL VIEW -->
        <div class="stocktake-detail-container">
          <!-- Top back bar & actions -->
          <div class="detail-header-bar flex-between" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                id="btn-back-to-stocktakes"
                onclick={handleBackToStocktakesList}
              >
                ← 返回盤點單清單
              </button>
              <h2 style="margin: 0; font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                <span>盤點單 #{currentStocktake.stocktake_number}</span>
                <span class="badge {getStocktakeStatusBadgeClass(currentStocktake.status)}">
                  {formatStocktakeStatus(currentStocktake.status)}
                </span>
              </h2>
            </div>

            <div class="detail-actions" style="display: flex; gap: 8px;">
              {#if currentStocktake.status === 'draft'}
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  id="btn-edit-stocktake-header"
                  onclick={handleOpenEditHeaderModal}
                  title="修改盤點倉庫或備註"
                >
                  ✏️ 編輯表頭
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  id="btn-start-counting"
                  onclick={handleOpenStartCountingModal}
                  disabled={currentStocktakeLines.length === 0}
                  title={currentStocktakeLines.length === 0 ? '無明細時無法開始盤點 (S-05)' : '開始盤點並鎖定庫存快照'}
                >
                  開始盤點
                </button>
                <button
                  type="button"
                  class="btn btn-outline btn-sm text-red"
                  id="btn-cancel-stocktake"
                  onclick={handleCancelStocktake}
                >
                  取消單據
                </button>
              {:else if currentStocktake.status === 'counting'}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  id="btn-post-stocktake"
                  onclick={handleOpenPostStocktakeModal}
                  disabled={postSummary.missing > 0}
                  title={postSummary.missing > 0 ? `尚有 ${postSummary.missing} 項未輸入實盤量` : '過帳盤點結果'}
                >
                  過帳盤點單
                </button>
                <button
                  type="button"
                  class="btn btn-outline btn-sm text-red"
                  id="btn-cancel-stocktake"
                  onclick={handleCancelStocktake}
                >
                  取消單據
                </button>
              {/if}
            </div>
          </div>

          <!-- ADR #157 Notice -->
          <div class="alert alert-info" style="margin-bottom: 16px; padding: 10px 14px; border-radius: 6px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); color: var(--text-primary); font-size: 0.85rem; display: flex; align-items: center; gap: 8px;">
            <span>ℹ️</span>
            <span><strong>盤點提示（包裝單位原則）：</strong>不同包裝單位請分行盤點；若有拆箱，箱與個會分別顯示盤虧與盤盈。</span>
          </div>

          <!-- S-07 Movement Warning if detected -->
          {#if affectedErrorMsg}
            <div class="alert alert-danger" style="margin-bottom: 16px; padding: 12px 16px; border-radius: 6px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; font-size: 0.85rem;">
              <div style="font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>⚠️ 異動衝突警示（S-07）</span>
              </div>
              <div style="margin-bottom: 8px;">
                {affectedErrorMsg}
              </div>
              <button
                type="button"
                class="btn btn-outline btn-xs"
                style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4);"
                id="btn-refresh-affected-lines"
                onclick={() => handleOpenRefreshSystemQtyModal(affectedLineIds)}
              >
                🔄 重新取得受影響品項之系統量 (S-08)
              </button>
            </div>
          {/if}

          <!-- General stocktake error banner -->
          {#if stocktakeError}
            <div class="alert alert-danger" style="margin-bottom: 16px; padding: 10px 14px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.85rem;">
              {stocktakeError}
            </div>
          {/if}

          <!-- Header info card -->
          <div class="glass-panel" style="padding: 16px; margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">盤點倉庫</div>
                <div style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                  <span>{getWarehouseName(currentStocktake.warehouse_id)}</span>
                  {#if currentStocktake.status === 'draft'}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs text-muted"
                      style="padding: 1px 5px; font-size: 0.75rem;"
                      onclick={handleOpenEditHeaderModal}
                      title="編輯表頭"
                    >
                      ✏️
                    </button>
                  {/if}
                </div>
              </div>
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">備註說明</div>
                <div>{currentStocktake.note || '無備註'}</div>
              </div>
              <div>
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">建立時間</div>
                <div style="font-family: monospace; font-size: 0.85rem;">{formatTime(currentStocktake.created_at)}</div>
              </div>
              {#if currentStocktake.status === 'counting' || currentStocktake.status === 'posted'}
                <div>
                  <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">開始盤點時間</div>
                  <div style="font-family: monospace; font-size: 0.85rem;">{formatTime(currentStocktake.counting_started_at)}</div>
                </div>
              {/if}
              {#if currentStocktake.posted_at}
                <div>
                  <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">過帳時間</div>
                  <div style="font-family: monospace; font-size: 0.85rem;" class="text-emerald font-semibold">{formatTime(currentStocktake.posted_at)}</div>
                </div>
              {/if}
              {#if currentStocktake.cancelled_at}
                <div>
                  <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">取消時間</div>
                  <div style="font-family: monospace; font-size: 0.85rem;" class="text-muted">{formatTime(currentStocktake.cancelled_at)}</div>
                </div>
              {/if}
              {#if currentStocktake.status === 'counting'}
                <div>
                  <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 4px;">實盤進度</div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="badge {postSummary.missing === 0 ? 'badge-emerald' : 'badge-sky'}" style="font-size: 0.85rem;">
                      已輸入 {countedStocktakeLinesCount} / 總數 {currentStocktakeLines.length}
                    </span>
                    {#if postSummary.missing > 0}
                      <span style="font-size: 0.75rem; color: #ef4444;">(尚有 {postSummary.missing} 項未填)</span>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>

          <!-- Lines table card -->
          <div class="glass-panel" style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; font-size: 1rem; font-weight: 600;">
                  盤點品項明細 ({currentStocktakeLines.length} 筆)
                </h3>
                {#if getStocktakeStatusBanner(currentStocktake.status)}
                  {@const banner = getStocktakeStatusBanner(currentStocktake.status)}
                  <span class="badge {banner.badgeClass}" style="font-size: 0.75rem;">
                    {banner.label}
                  </span>
                {/if}
              </div>

              {#if currentStocktake.status === 'draft'}
                <div style="display: flex; gap: 8px;">
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    id="btn-add-lines-from-stock"
                    onclick={handleAddStocktakeLinesFromStock}
                  >
                    + 帶入此倉現有庫存品項 (S-04)
                  </button>
                </div>
              {:else if currentStocktake.status === 'counting'}
                <div style="display: flex; gap: 8px;">
                  <button
                    type="button"
                    class="btn btn-outline btn-xs"
                    id="btn-refresh-all-system-qty"
                    onclick={() => handleOpenRefreshSystemQtyModal(currentStocktakeLines.map(l => l.id))}
                    title="對全單品項重新取得帳面量快照 (S-08)"
                  >
                    🔄 重新取得系統量快照
                  </button>
                </div>
              {/if}
            </div>

            <!-- Draft: Manual Add Product Section (Supports items with 0 stock) -->
            {#if currentStocktake.status === 'draft'}
              <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; margin-bottom: 14px;">
                <div style="font-size: 0.82rem; font-weight: 600; margin-bottom: 8px; color: var(--text-secondary);">
                  手動加入品項（可選帳面為 0 的品項）：
                </div>
                {#if draftStkError}
                  <div class="alert alert-danger" style="margin-bottom: 8px; padding: 6px 10px; font-size: 0.8rem;">
                    {draftStkError}
                  </div>
                {/if}
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                  <select
                    bind:value={draftStkUnitId}
                    class="form-select form-select-sm"
                    id="select-draft-stk-unit"
                    style="flex: 1; min-width: 260px;"
                  >
                    <option value="">-- 請選擇品項單位 --</option>
                    {#each availableUnits as u}
                      <option value={u.unit_id}>{u.label}</option>
                    {/each}
                  </select>
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    id="btn-add-draft-stk-line"
                    onclick={handleAddStocktakeLineFromDraft}
                    disabled={!draftStkUnitId || isAddingDraftStkLine}
                  >
                    {isAddingDraftStkLine ? '加入中...' : '+ 加入品項'}
                  </button>
                </div>
              </div>
            {/if}

            <!-- Lines Table -->
            {#if currentStocktakeLines.length > 0}
              <div class="table-responsive">
                <table class="inventory-table">
                  <thead>
                    <tr>
                      {#each getStocktakeLineColumns(currentStocktake.status) as col}
                        <th
                          class="{col.align ? `text-${col.align}` : ''}"
                          style="{col.width ? `width: ${col.width};` : ''}"
                        >
                          {col.label}
                        </th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each currentStocktakeLines as line (line.id)}
                      {@const isAffected = affectedLineIds.includes(line.id)}
                      {@const hasCounted = isStocktakeLineCounted(line.counted_quantity)}
                      {@const delta = hasCounted ? (Number(line.counted_quantity) - (line.system_quantity || 0)) : null}
                      <tr class="{isAffected ? 'row-warning' : ''}">
                        <td>{line.line_no}</td>
                        <td>
                          <div style="font-weight: 600;">{line.product_name_snapshot}</div>
                          <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; gap: 6px; align-items: center; margin-top: 2px;">
                            <span>規格：{line.variant_name_snapshot}</span>
                            <span class="unit-tag">{line.unit_name_snapshot}</span>
                            {#if line.sku_snapshot}
                              <span style="font-family: monospace; opacity: 0.7;">SKU: {line.sku_snapshot}</span>
                            {/if}
                          </div>
                        </td>

                        {#if currentStocktake.status === 'draft'}
                          <td class="text-right font-mono text-muted">開始盤點時快照</td>
                          <td class="text-center">
                            <button
                              type="button"
                              class="btn-icon-danger"
                              id="btn-remove-line-{line.id}"
                              onclick={() => handleRemoveStocktakeLine(line.id)}
                              title="移除此品項"
                            >
                              ✕
                            </button>
                          </td>
                        {:else}
                          <td class="text-right font-mono font-medium">{line.system_quantity ?? 0}</td>
                          <td style="font-family: monospace; font-size: 0.78rem; color: var(--text-secondary);">
                            {formatTime(line.system_quantity_at)}
                          </td>
                          <td class="text-right">
                            {#if currentStocktake.status === 'counting'}
                              <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  class="form-input form-input-sm text-right font-mono font-bold"
                                  style="width: 100px; padding: 4px 8px; {lineErrors[line.id] ? 'border-color: var(--color-danger, #ef4444);' : ''}"
                                  id="input-counted-{line.id}"
                                  value={line.counted_quantity ?? ''}
                                  onchange={(e) => handleCountedQuantityChange(line.id, e.target.value, e.target)}
                                  placeholder="實盤量"
                                />
                                {#if lineErrors[line.id]}
                                  <span class="text-red" style="font-size: 0.72rem; margin-top: 2px;">
                                    {lineErrors[line.id]}
                                  </span>
                                {/if}
                              </div>
                            {:else}
                              <span class="font-mono font-bold">{line.counted_quantity ?? '-'}</span>
                            {/if}
                          </td>
                          <td class="text-right font-mono">
                            {#if delta === null}
                              <span class="text-muted">-</span>
                            {:else if delta > STOCKTAKE_VARIANCE_EPSILON}
                              <span class="text-emerald font-bold font-mono">+{delta}</span>
                              <span class="badge badge-emerald" style="font-size: 0.65rem; padding: 2px 4px; margin-left: 2px;">盤盈</span>
                            {:else if delta < -STOCKTAKE_VARIANCE_EPSILON}
                              <span class="text-red font-bold font-mono">{delta}</span>
                              <span class="badge badge-red" style="font-size: 0.65rem; padding: 2px 4px; margin-left: 2px;">盤虧</span>
                            {:else}
                              <span class="text-muted font-mono">0 (相符)</span>
                            {/if}
                          </td>
                          {#if currentStocktake.status === 'counting'}
                            <td class="text-center">
                              <div style="display: flex; gap: 4px; align-items: center; justify-content: center;">
                                {#if isAffected}
                                  <button
                                    type="button"
                                    class="btn btn-outline btn-xs"
                                    style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4); font-size: 0.7rem; padding: 2px 6px;"
                                    onclick={() => handleOpenRefreshSystemQtyModal([line.id])}
                                    title="重新取得此行系統量快照 (S-08)"
                                  >
                                    重取快照
                                  </button>
                                {/if}
                                <button
                                  type="button"
                                  class="btn-icon-danger"
                                  id="btn-remove-line-{line.id}"
                                  onclick={() => handleRemoveStocktakeLine(line.id)}
                                  title="在盤點中移除此品項"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          {/if}
                        {/if}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <div style="text-align: center; padding: 28px; color: var(--text-secondary); font-size: 0.85rem;">
                目前尚未加入任何品項。請點擊「帶入此倉現有庫存品項」或「手動加入品項」。
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- LIST VIEW -->
        <div class="stocktakes-list-container">
          <!-- Filter bar -->
          <div class="filter-bar glass-panel" style="display: flex; gap: 14px; align-items: center; padding: 12px 16px; margin-bottom: 16px; flex-wrap: wrap;">
            {#if activeWarehouses.length > 1}
              <div style="display: flex; align-items: center; gap: 6px;">
                <label for="filter-stk-warehouse" style="font-size: 0.85rem; color: var(--text-secondary);">倉別：</label>
                <select
                  id="filter-stk-warehouse"
                  bind:value={selectedStocktakeWarehouseId}
                  class="form-select form-select-sm"
                  onchange={loadStocktakes}
                >
                  <option value="">全部倉庫</option>
                  {#each activeWarehouses as wh}
                    <option value={wh.id}>{wh.name} ({wh.code})</option>
                  {/each}
                </select>
              </div>
            {/if}

            <div style="display: flex; align-items: center; gap: 6px;">
              <label for="filter-stk-status" style="font-size: 0.85rem; color: var(--text-secondary);">狀態：</label>
              <select
                id="filter-stk-status"
                bind:value={selectedStocktakeStatusFilter}
                class="form-select form-select-sm"
                onchange={loadStocktakes}
              >
                <option value="">全部狀態</option>
                <option value="draft">草稿 (draft)</option>
                <option value="counting">盤點中 (counting)</option>
                <option value="posted">已過帳 (posted)</option>
                <option value="cancelled">已取消 (cancelled)</option>
              </select>
            </div>

            <div style="margin-left: auto; display: flex; gap: 8px;">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onclick={loadStocktakes}
                disabled={stocktakeLoading}
              >
                {stocktakeLoading ? '載入中...' : '重新整理'}
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                id="btn-open-create-stocktake"
                onclick={handleOpenCreateStocktake}
              >
                + 建立盤點單
              </button>
            </div>
          </div>

          {#if stocktakeError}
            <div class="alert alert-danger" style="margin-bottom: 14px; padding: 10px 14px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.85rem;">
              {stocktakeError}
            </div>
          {/if}

          {#if filteredStocktakes.length === 0}
            <div class="empty-state-panel glass-panel" style="padding: 48px 24px; text-align: center;">
              <div class="empty-state-icon" style="margin-bottom: 12px; opacity: 0.6;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  <path d="m9 14 2 2 4-4"></path>
                </svg>
              </div>
              <h3 class="empty-state-title" style="margin-bottom: 6px; font-size: 1.1rem; font-weight: 600;">尚無盤點單</h3>
              <p class="empty-state-desc" style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
                目前條件下沒有找到任何盤點單。您可以點擊下方按鈕建立第一筆實地盤點單。
              </p>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                onclick={handleOpenCreateStocktake}
              >
                + 建立盤點單
              </button>
            </div>
          {:else}
            <div class="table-responsive glass-panel" style="padding: 0; overflow: hidden;">
              <table class="inventory-table">
                <thead>
                  <tr>
                    <th>單號</th>
                    <th>倉別</th>
                    <th>狀態</th>
                    <th class="text-right">品項數</th>
                    <th>實盤進度</th>
                    <th>建立時間</th>
                    <th class="text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredStocktakes as stk}
                    {@const prog = formatStocktakeProgress(stk)}
                    <tr class="table-row-hover">
                      <td>
                        <button
                          type="button"
                          class="link-po-ref"
                          style="font-family: monospace; font-weight: 600;"
                          id="stk-link-{stk.id}"
                          onclick={() => handleSelectStocktake(stk.id)}
                        >
                          #{stk.stocktake_number}
                        </button>
                      </td>
                      <td>
                        <span class="unit-tag" style="background: rgba(var(--accent-amber), 0.1); color: rgb(var(--accent-amber)); border: 1px solid rgba(var(--accent-amber), 0.2);">
                          {getWarehouseName(stk.warehouse_id)}
                        </span>
                      </td>
                      <td>
                        <span class="badge {getStocktakeStatusBadgeClass(stk.status)}">
                          {formatStocktakeStatus(stk.status)}
                        </span>
                      </td>
                      <td class="text-right font-mono">{stk.lines_count !== undefined ? stk.lines_count : '-'}</td>
                      <td>
                        {#if prog.type === 'badge'}
                          <span class="badge {prog.badgeClass}">{prog.label}</span>
                        {:else}
                          <span class="text-muted">{prog.label}</span>
                        {/if}
                      </td>
                      <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">{formatTime(stk.created_at)}</td>
                      <td class="text-center">
                        <button
                          type="button"
                          class="btn btn-outline btn-xs"
                          id="btn-view-stk-{stk.id}"
                          onclick={() => handleSelectStocktake(stk.id)}
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
            <div>{openingModalError}</div>
            {#if openingModalError.includes('已開帳') || openingModalError.includes('O-01') || openingModalError.includes('重複')}
              <button
                type="button"
                id="btn-open-correction-from-opening-modal"
                class="btn-correction-link"
                style="margin-top: 6px; font-size: 0.8rem; background: none; border: none; color: #3b82f6; text-decoration: underline; cursor: pointer; padding: 0; display: inline-block;"
                onclick={() => handleCreateOpeningCorrectionAdjustment(openingWarehouseId || (activeWarehouses[0]?.id || ''), openingUnitId)}
              >
                ➜ 建立期初更正調整單
              </button>
            {/if}
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

<!-- ============================================================== -->
<!-- MODAL 3: 建立庫存調整單彈窗 (Issue #183)                       -->
<!-- ============================================================== -->
{#if isCreateAdjustmentModalOpen}
  <div class="modal-backdrop" onclick={handleCloseCreateAdjustmentModal} onkeydown={(e) => e.key === 'Escape' && handleCloseCreateAdjustmentModal()} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal" style="max-width: 680px;" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-create-adj-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-create-adj-title" class="modal-title">建立庫存調整單 (Inventory Adjustment)</h3>
        <button class="btn-close-modal" onclick={handleCloseCreateAdjustmentModal} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">
          建立一張調整單草稿，可輸入報廢、遺失、尋獲或期初更正等數量增減。每一項商品即時預覽調整後數量。
        </p>

        {#if createAdjError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.82rem;">
            {createAdjError}
          </div>
        {/if}

        <!-- 倉庫選擇器：單一啟用倉時隱藏選擇器，多倉時顯示下拉選單 -->
        {#if activeWarehouses.length > 1}
          <div class="form-group" style="margin-bottom: 12px;">
            <label for="create-adj-warehouse">調整倉庫 *</label>
            <select
              id="create-adj-warehouse"
              bind:value={createAdjWarehouseId}
              class="form-select"
              onchange={(e) => {
                if (newAdjLineUnitId) fetchUnitStock(e.currentTarget.value, newAdjLineUnitId);
                for (const l of createAdjLines) fetchUnitStock(e.currentTarget.value, l.unit_id);
              }}
            >
              {#each activeWarehouses as wh}
                <option value={wh.id}>{wh.name} ({wh.code}){wh.is_default ? ' ★ 預設倉' : ''}</option>
              {/each}
            </select>
          </div>
        {:else if activeWarehouses.length === 1}
          <div class="form-group" style="margin-bottom: 12px;">
            <span style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: var(--text-secondary);">調整倉庫</span>
            <div class="static-field-value">
              {activeWarehouses[0].name} ({activeWarehouses[0].code})
            </div>
          </div>
        {/if}

        <!-- 原因與備註 -->
        <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 14px;">
          <div class="form-group flex-1">
            <label for="create-adj-reason">調整原因 *</label>
            <select id="create-adj-reason" bind:value={createAdjReasonCode} class="form-select">
              <option value="damage">報廢 / 損壞</option>
              <option value="loss">遺失</option>
              <option value="found">尋獲</option>
              <option value="opening_correction">期初更正</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div class="form-group flex-2">
            <label for="create-adj-note">
              備註說明 {createAdjReasonCode === 'other' ? '(必填 *)' : '(選填)'}
            </label>
            <input
              type="text"
              id="create-adj-note"
              bind:value={createAdjNote}
              class="form-input"
              placeholder={createAdjReasonCode === 'other' ? '選其他原因時必填原因說明 (A-03)' : '選填備註說明'}
            />
          </div>
        </div>

        <!-- 明細清單 -->
        <div class="create-adj-lines-section" style="border-top: 1px solid var(--border-color); padding-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 600; font-size: 0.85rem;">調整明細清單 ({createAdjLines.length} 項)</span>
            <span class="text-muted" style="font-size: 0.75rem;">建立草稿後亦可在詳細頁增刪明細</span>
          </div>

          {#if createAdjLines.length > 0}
            <div class="table-responsive" style="max-height: 180px; overflow-y: auto; margin-bottom: 12px;">
              <table class="inventory-table create-lines-table">
                <thead>
                  <tr>
                    <th style="width: 36px;">#</th>
                    <th>商品單位</th>
                    <th class="text-right">目前庫存</th>
                    <th class="text-right">增減量</th>
                    <th class="text-right">調整後數量</th>
                    <th class="text-center" style="width: 60px;">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {#each createAdjLines as line, idx}
                    {@const curStock = getCachedStock(createAdjWarehouseId, line.unit_id)}
                    {@const afterStock = curStock + line.quantity_delta}
                    {@const isNeg = afterStock < 0}
                    <tr class={isNeg ? 'row-warning' : ''}>
                      <td>{idx + 1}</td>
                      <td class="font-medium">{getUnitLabel(line.unit_id)}</td>
                      <td class="text-right font-mono">{curStock}</td>
                      <td class="text-right font-mono font-bold {line.quantity_delta > 0 ? 'text-emerald' : 'text-amber'}">
                        {line.quantity_delta > 0 ? `+${line.quantity_delta}` : line.quantity_delta}
                      </td>
                      <td class="text-right font-mono {isNeg ? 'text-red font-bold' : 'text-emerald font-semibold'}">
                        {afterStock}
                        {#if isNeg}
                          <span class="badge badge-red ml-1" style="font-size: 0.7rem;">⚠️ 負數</span>
                        {/if}
                      </td>
                      <td class="text-center">
                        <button
                          type="button"
                          class="btn-icon-danger"
                          onclick={() => handleRemoveLineFromCreateModal(idx)}
                          title="移除項目"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <!-- 加入明細列 -->
          <div class="add-line-subform" style="background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-color); border-radius: 6px; padding: 10px;">
            <div style="font-size: 0.75rem; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary);">+ 新增商品明細</div>
            <div style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap;">
              <div style="flex: 2; min-width: 180px;">
                <label for="create-adj-new-unit" style="display: block; font-size: 0.75rem; margin-bottom: 3px;">選擇單位</label>
                <select
                  id="create-adj-new-unit"
                  bind:value={newAdjLineUnitId}
                  class="form-select form-select-sm"
                  onchange={(e) => {
                    fetchUnitStock(createAdjWarehouseId, e.currentTarget.value);
                  }}
                >
                  <option value="">-- 請選擇單位 --</option>
                  {#each availableUnits.filter(u => !createAdjLines.some(l => l.unit_id === u.unit_id)) as unit}
                    <option value={unit.unit_id}>{unit.label}</option>
                  {/each}
                </select>
              </div>

              <div style="flex: 1; min-width: 90px;">
                <label for="create-adj-new-delta" style="display: block; font-size: 0.75rem; margin-bottom: 3px;">增減數量 (+/-)</label>
                <input
                  type="number"
                  id="create-adj-new-delta"
                  bind:value={newAdjLineDelta}
                  class="form-input form-input-sm text-right"
                  placeholder="非 0 整數"
                />
              </div>

              <div style="flex: 2; min-width: 160px;">
                <span style="display: block; font-size: 0.75rem; margin-bottom: 3px; color: var(--text-secondary);">數量預覽</span>
                {#if newAdjLineUnitId}
                  {@const cur = getCachedStock(createAdjWarehouseId, newAdjLineUnitId)}
                  {@const after = cur + (Number(newAdjLineDelta) || 0)}
                  {@const isNeg = after < 0}
                  <div style="font-size: 0.8rem; padding: 4px 8px; background: rgba(255,255,255,0.04); border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                    <span>現有 <strong>{cur}</strong></span>
                    <span>→</span>
                    <span class={isNeg ? 'text-red font-bold' : 'text-emerald font-semibold'}>{after}</span>
                    {#if isNeg}
                      <span class="badge badge-red" style="font-size: 0.68rem; padding: 1px 4px;">⚠️ 負數</span>
                    {/if}
                  </div>
                {:else}
                  <div style="font-size: 0.78rem; color: var(--text-muted); padding: 4px 8px;">選擇單位預覽</div>
                {/if}
              </div>

              <div>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  id="btn-add-line-to-modal"
                  onclick={handleAddLineToCreateModal}
                >
                  + 加入
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn" onclick={handleCloseCreateAdjustmentModal}>取消</button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-submit-create-adjustment"
          onclick={handleSubmitCreateAdjustment}
          disabled={isCreatingAdjustment}
        >
          {isCreatingAdjustment ? '建立中...' : '建立草稿調整單'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ============================================================== -->
<!-- MODAL 4: 調整單過帳確認彈窗 (Issue #183)                       -->
<!-- ============================================================== -->
{#if isPostConfirmModalOpen && currentAdjustment}
  <div class="modal-backdrop" onclick={handleClosePostConfirmModal} onkeydown={(e) => e.key === 'Escape' && handleClosePostConfirmModal()} role="presentation">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="glass-modal" style="max-width: 600px;" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-post-confirm-title" tabindex="-1">
      <div class="modal-header">
        <h3 id="modal-post-confirm-title" class="modal-title">過帳確認 (Post Confirmation)</h3>
        <button class="btn-close-modal" onclick={handleClosePostConfirmModal} aria-label="關閉彈窗">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">
          過帳後將正式更新倉庫即時庫存並寫入庫存流水帳，此動作<strong>無法復原</strong>。請核對以下調整資訊：
        </p>

        {#if postConfirmError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 10px 14px; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; font-size: 0.85rem;">
            <div class="font-bold mb-1">過帳失敗 (後端拒絕)：</div>
            <div style="font-family: monospace; white-space: pre-wrap; font-size: 0.8rem;">{postConfirmError}</div>
          </div>
        {/if}

        <div class="summary-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; background: rgba(255, 255, 255, 0.03); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.85rem;">
          <div><span class="text-muted">單號：</span><strong>#{currentAdjustment.adjustment_number}</strong></div>
          <div><span class="text-muted">倉庫：</span><strong>{getWarehouseName(currentAdjustment.warehouse_id)}</strong></div>
          <div><span class="text-muted">原因：</span><span class="badge badge-amber">{formatAdjustmentReason(currentAdjustment.reason_code)}</span></div>
          <div><span class="text-muted">備註：</span><span>{currentAdjustment.note || '無備註'}</span></div>
        </div>

        <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 8px;">調整明細與庫存預覽：</div>
        
        <div class="table-responsive" style="max-height: 200px; overflow-y: auto;">
          <table class="inventory-table">
            <thead>
              <tr>
                <th style="width: 36px;">#</th>
                <th>商品單位</th>
                <th class="text-right">目前庫存</th>
                <th class="text-right">增減量</th>
                <th class="text-right">調整後庫存</th>
              </tr>
            </thead>
            <tbody>
              {#each currentAdjustmentLines as line}
                {@const curStock = getCachedStock(currentAdjustment.warehouse_id, line.unit_id)}
                {@const afterStock = curStock + line.quantity_delta}
                {@const isNeg = afterStock < 0}
                <tr class={isNeg ? 'row-warning' : ''}>
                  <td>{line.line_no ?? line.line_number ?? ''}</td>
                  <td class="font-medium">{getUnitLabel(line.unit_id)}</td>
                  <td class="text-right font-mono">{curStock}</td>
                  <td class="text-right font-mono font-bold {line.quantity_delta > 0 ? 'text-emerald' : 'text-amber'}">
                    {line.quantity_delta > 0 ? `+${line.quantity_delta}` : line.quantity_delta}
                  </td>
                  <td class="text-right font-mono {isNeg ? 'text-red font-bold' : 'text-emerald font-semibold'}">
                    {afterStock}
                    {#if isNeg}
                      <span class="badge badge-red ml-1" style="font-size: 0.7rem;">⚠️ 負數</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if currentAdjustmentLines.some(l => (getCachedStock(currentAdjustment.warehouse_id, l.unit_id) + l.quantity_delta) < 0)}
          <div class="alert alert-warning" style="margin-top: 12px; padding: 8px 12px; border-radius: 6px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; font-size: 0.8rem;">
            ⚠️ 警告：包含調整後庫存為負數的明細項目，送出後後端將拒絕過帳 (A-09)。
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn" onclick={handleClosePostConfirmModal} disabled={postConfirmLoading}>
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-confirm-post-adjustment"
          onclick={handleConfirmPostAdjustment}
          disabled={postConfirmLoading}
        >
          {postConfirmLoading ? '過帳處理中...' : '確認過帳'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Create Stocktake Modal (Issue #184) -->
{#if activeStocktakeModal === 'create'}
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) closeStocktakeModal(); }} onkeydown={(e) => e.key === 'Escape' && closeStocktakeModal()} role="presentation">
    <div class="modal-card glass-panel" style="max-width: 500px; width: 100%;">
      <div class="modal-header">
        <h3 class="modal-title">建立實地盤點單</h3>
        <button type="button" class="btn-close" onclick={closeStocktakeModal}>✕</button>
      </div>
      <div class="modal-body">
        {#if stocktakeModalError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; font-size: 0.85rem;">
            {stocktakeModalError}
          </div>
        {/if}
        <div class="form-group" style="margin-bottom: 14px;">
          <label for="create-stk-warehouse" class="form-label" style="display: block; font-size: 0.85rem; margin-bottom: 6px;">盤點倉庫</label>
          <select
            id="create-stk-warehouse"
            bind:value={createStkWarehouseId}
            class="form-select"
            style="width: 100%;"
          >
            {#each activeWarehouses as wh}
              <option value={wh.id}>{wh.name} ({wh.code}) {wh.is_default ? '★ 預設' : ''}</option>
            {/each}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 14px;">
          <label for="create-stk-note" class="form-label" style="display: block; font-size: 0.85rem; margin-bottom: 6px;">備註說明 (選填)</label>
          <input
            type="text"
            id="create-stk-note"
            class="form-input"
            bind:value={createStkNote}
            placeholder="例如：2026 Q4 年終實盤清點"
            style="width: 100%;"
          />
        </div>
        <div class="form-group" style="margin-bottom: 14px;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer;">
            <input
              type="checkbox"
              id="chk-stk-autofill"
              bind:checked={createStkAutoFill}
            />
            <span>建立後自動帶入此倉現有庫存品項 (S-04)</span>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick={closeStocktakeModal} disabled={stocktakeModalLoading}>
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-confirm-create-stocktake"
          onclick={handleConfirmCreateStocktake}
          disabled={stocktakeModalLoading}
        >
          {stocktakeModalLoading ? '建立中...' : '確認建立草稿'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit Stocktake Header Modal (Issue #184) -->
{#if activeStocktakeModal === 'editHeader'}
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) closeStocktakeModal(); }} onkeydown={(e) => e.key === 'Escape' && closeStocktakeModal()} role="presentation">
    <div class="modal-card glass-panel" style="max-width: 500px; width: 100%;">
      <div class="modal-header">
        <h3 class="modal-title">編輯盤點單表頭</h3>
        <button type="button" class="btn-close" onclick={closeStocktakeModal}>✕</button>
      </div>
      <div class="modal-body">
        {#if stocktakeModalError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; font-size: 0.85rem;">
            {stocktakeModalError}
          </div>
        {/if}
        <div class="form-group" style="margin-bottom: 14px;">
          <label for="edit-stk-warehouse" class="form-label" style="display: block; font-size: 0.85rem; margin-bottom: 6px;">盤點倉庫</label>
          <select
            id="edit-stk-warehouse"
            bind:value={editStkWarehouseId}
            class="form-select"
            style="width: 100%;"
            disabled={stocktakeModalLoading}
          >
            {#each activeWarehouses as wh}
              <option value={wh.id}>{wh.name} ({wh.code}) {wh.is_default ? '★ 預設' : ''}</option>
            {/each}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 14px;">
          <label for="edit-stk-note" class="form-label" style="display: block; font-size: 0.85rem; margin-bottom: 6px;">備註說明 (選填)</label>
          <textarea
            id="edit-stk-note"
            class="form-input"
            rows="3"
            bind:value={editStkNote}
            placeholder="例如：調整盤點目的或說明"
            style="width: 100%; resize: vertical;"
            disabled={stocktakeModalLoading}
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick={closeStocktakeModal} disabled={stocktakeModalLoading}>
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-confirm-edit-header"
          onclick={handleConfirmEditHeader}
          disabled={stocktakeModalLoading || !editStkWarehouseId}
        >
          {stocktakeModalLoading ? '儲存中...' : '儲存變更'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Start Counting Modal (Issue #184) -->
{#if activeStocktakeModal === 'startCounting'}
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) closeStocktakeModal(); }} onkeydown={(e) => e.key === 'Escape' && closeStocktakeModal()} role="presentation">
    <div class="modal-card glass-panel" style="max-width: 480px; width: 100%;">
      <div class="modal-header">
        <h3 class="modal-title">確認開始盤點？</h3>
        <button type="button" class="btn-close" onclick={closeStocktakeModal}>✕</button>
      </div>
      <div class="modal-body">
        {#if stocktakeModalError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; font-size: 0.85rem;">
            {stocktakeModalError}
          </div>
        {/if}
        <div class="alert alert-warning" style="margin-bottom: 14px; padding: 12px; border-radius: 6px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; font-size: 0.85rem;">
          ⚠️ <strong>注意：開始後不能再新增品項</strong>（S-06）。
          系統將對目前 {currentStocktakeLines.length} 個品項鎖定當前帳面庫存快照，並進入盤點中狀態。
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary);">
          進入盤點中狀態後，您可逐行填寫實盤量，隨時離開畫面資料均會完整保留。
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick={closeStocktakeModal} disabled={stocktakeModalLoading}>
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-confirm-start-counting"
          onclick={handleConfirmStartCounting}
          disabled={stocktakeModalLoading}
        >
          {stocktakeModalLoading ? '處理中...' : '確認開始盤點'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Post Stocktake Summary Modal (Issue #184) -->
{#if activeStocktakeModal === 'post'}
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) closeStocktakeModal(); }} onkeydown={(e) => e.key === 'Escape' && closeStocktakeModal()} role="presentation">
    <div class="modal-card glass-panel" style="max-width: 520px; width: 100%;">
      <div class="modal-header">
        <h3 class="modal-title">過帳盤點單確認</h3>
        <button type="button" class="btn-close" onclick={closeStocktakeModal}>✕</button>
      </div>
      <div class="modal-body">
        {#if stocktakeModalError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; font-size: 0.85rem;">
            {stocktakeModalError}
          </div>
        {/if}
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 14px;">
          請確認以下盤點盈虧統計摘要，過帳後系統將產生庫存調整流水帳並更新各倉庫存：
        </p>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px;">
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 12px; text-align: center;">
            <div style="font-size: 0.75rem; color: #10b981; margin-bottom: 4px;">盤盈品項</div>
            <div style="font-size: 1.3rem; font-weight: 700; color: #10b981;">{postSummary.surplus}</div>
          </div>
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; padding: 12px; text-align: center;">
            <div style="font-size: 0.75rem; color: #ef4444; margin-bottom: 4px;">盤虧品項</div>
            <div style="font-size: 1.3rem; font-weight: 700; color: #ef4444;">{postSummary.shortage}</div>
          </div>
          <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 6px; padding: 12px; text-align: center;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">相符品項</div>
            <div style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary);">{postSummary.matched}</div>
          </div>
        </div>
        {#if postSummary.missing > 0}
          <div class="alert alert-danger" style="padding: 8px 12px; font-size: 0.85rem;">
            ⚠️ 尚有 {postSummary.missing} 項未輸入實盤量，無法過帳 (S-07)。
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick={closeStocktakeModal} disabled={stocktakeModalLoading}>
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-confirm-post-stocktake"
          onclick={handleConfirmPostStocktake}
          disabled={stocktakeModalLoading || postSummary.missing > 0}
        >
          {stocktakeModalLoading ? '過帳處理中...' : '確認過帳'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Refresh System Quantity Modal (Issue #184) -->
{#if activeStocktakeModal === 'refresh'}
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) closeStocktakeModal(); }} onkeydown={(e) => e.key === 'Escape' && closeStocktakeModal()} role="presentation">
    <div class="modal-card glass-panel" style="max-width: 480px; width: 100%;">
      <div class="modal-header">
        <h3 class="modal-title">重新取得系統量確認 (S-08)</h3>
        <button type="button" class="btn-close" onclick={closeStocktakeModal}>✕</button>
      </div>
      <div class="modal-body">
        {#if stocktakeModalError}
          <div class="alert alert-danger" style="margin-bottom: 12px; padding: 8px 12px; font-size: 0.85rem;">
            {stocktakeModalError}
          </div>
        {/if}
        <div class="alert alert-warning" style="margin-bottom: 14px; padding: 12px; border-radius: 6px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; font-size: 0.85rem;">
          ⚠️ <strong>提示：這些行的實盤量會被清空，需要重新盤點</strong>（S-08）。
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary);">
          系統將重新讀取目標品項（共 {refreshTargetLineIds.length} 項）的最新帳面量並更新快照時間戳。
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick={closeStocktakeModal} disabled={stocktakeModalLoading}>
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="btn-confirm-refresh-system-qty"
          onclick={handleConfirmRefreshSystemQty}
          disabled={stocktakeModalLoading}
        >
          {stocktakeModalLoading ? '更新中...' : '確認重新取得系統量'}
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
  .badge-red {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .text-amber {
    color: rgb(var(--accent-amber));
  }
  .static-field-value {
    padding: 7px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 500;
  }
  .btn-icon-danger {
    background: transparent;
    border: none;
    color: #ef4444;
    cursor: pointer;
    padding: 2px 6px;
    font-size: 0.85rem;
    border-radius: 4px;
    transition: background 0.15s ease;
  }
  .btn-icon-danger:hover {
    background: rgba(239, 68, 68, 0.15);
  }
  .row-warning {
    background: rgba(239, 68, 68, 0.06);
  }
  .link-adj-ref {
    color: rgb(var(--accent-amber)) !important;
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
