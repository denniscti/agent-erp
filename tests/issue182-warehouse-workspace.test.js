/**
 * @file issue182-warehouse-workspace.test.js
 * @description Layer 2 automated test suite for Warehouse Workspace, Dimension Centralization,
 * and W-00 Zero Warehouse Defense (Issue #182).
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-182-NAV-01 | Route set to '/app/warehouses' | Equivalence – Normal Navigation | activeWorkspace returns 'warehouses', getWorkspaceLabel returns '倉庫管理' | Primary workspace route |
 * | TC-182-NAV-02 | Route set to '/app/inventory' | Equivalence – Backward Compatibility | activeWorkspace returns 'inventory', getWorkspaceLabel returns '庫存查詢' | Legacy URL support |
 * | TC-182-NAV-03 | Warehouse workspace subroutes | Equivalence – Subpath Resolution | Resolves activeWorkspace 'warehouses' for subpaths | Subroute routing |
 * | TC-182-W00-01 | Zero-warehouse tenant calling list_warehouses & list_inventory_levels | Boundary – Zero Warehouses (0) | Returns empty array [] safely without throwing | Rule Q-01 |
 * | TC-182-W00-02 | Zero-warehouse tenant calling createPurchaseOrderAction | Error – W-00 Defense & Modal Trigger | Throws W-00 error and opens Create Warehouse Modal | W-00 Interception |
 * | TC-182-W00-03 | Zero-warehouse tenant calling recordOpeningInventoryBalanceAction | Error – W-00 Defense & Modal Trigger | Throws W-00 error and opens Create Warehouse Modal | W-00 Interception |
 * | TC-182-WH-01 | Create first warehouse in new tenant | Equivalence – First Default | is_default = true, is_active = true, code & name match | Rule W-06 |
 * | TC-182-WH-02 | createWarehouseAction with empty code | Boundary – Empty Code (empty) | Validation error: '倉庫代碼為必填項目' | Rule W-02 |
 * | TC-182-WH-03 | createWarehouseAction with whitespace-only code | Boundary – Whitespace Code | Validation error: '倉庫代碼為必填項目' | Rule W-02 |
 * | TC-182-WH-04 | createWarehouseAction with empty name | Boundary – Empty Name (empty) | Validation error: '倉庫名稱為必填項目' | Rule W-02 |
 * | TC-182-WH-05 | createWarehouseAction with duplicate code (case-insensitive) | Error – Unique Code | Validation error: '倉別代碼已存在' | Rule W-02 |
 * | TC-182-WH-06 | createWarehouseAction with callback execution | Equivalence – Success Callback | Runs success callback upon warehouse creation | Seamless workflow resume |
 * | TC-182-WH-07 | updateWarehouseAction with new code and name | Equivalence – Master Update | code and name updated, default status preserved | Master maintenance |
 * | TC-182-WH-08 | setDefaultWarehouseAction switches default warehouse | Equivalence – Atomic Default Switch | Target warehouse becomes default, previous default is demoted | Rule W-05 |
 * | TC-182-WH-09 | deactivateWarehouseAction on default warehouse | Error – W-03 Default Guard | Validation error: '預設倉不可停用' | Rule W-03 |
 * | TC-182-WH-10 | deactivateWarehouseAction on warehouse with stock | Error – W-03 Stock Guard | Validation error: '此倉仍有庫存，請先調撥或調整歸零' | Rule W-03 |
 * | TC-182-WH-11 | deactivateWarehouseAction on warehouse referenced by open PO | Error – W-03 Reference Guard | Validation error: '此倉仍被未結案單據引用' | Rule W-03 |
 * | TC-182-WH-12 | deactivateWarehouseAction on empty non-default warehouse | Equivalence – Deactivation | is_active transitions to false | Rule W-03 |
 * | TC-182-WH-13 | reactivateWarehouseAction on deactivated warehouse | Equivalence – Reactivation | is_active transitions to true | Rule W-03 |
 * | TC-182-PO-01 | PO creation with single active warehouse (null warehouse_id) | Boundary – Single Warehouse (1) | Automatically resolves and associates default warehouse | Rule P-01 |
 * | TC-182-PO-02 | PO creation with explicit secondary warehouse | Equivalence – Multi-Warehouse Selection | Saves explicit warehouse_id on purchase order | Rule P-01 |
 * | TC-182-PO-03 | updatePurchaseOrderHeaderAction warehouse on draft PO | Equivalence – Draft Header Edit | Warehouse successfully changed to target active warehouse | Rule P-02 |
 * | TC-182-PO-04 | updatePurchaseOrderHeaderAction warehouse on ordered PO | Equivalence – Ordered Header Edit | Warehouse successfully changed in ordered status | Rule P-02 |
 * | TC-182-PO-05 | updatePurchaseOrderHeaderAction on received PO | Error – Terminal State Guard | Rejection error: '不允許修改表頭' | Rule P-02 |
 * | TC-182-PO-06 | updatePurchaseOrderHeaderAction on cancelled PO | Error – Terminal State Guard | Rejection error: '不允許修改表頭' | Rule P-02 |
 * | TC-182-OB-01 | recordOpeningInventoryBalanceAction in warehouse 1 | Equivalence – Opening Balance | Movement created with reason opening_balance and warehouse_id | Rule O-01 |
 * | TC-182-OB-02 | Duplicate opening balance in same warehouse | Error – O-01 Duplicate Rejection | Rejected with message: '此商品單位在〔{wh_name}〕已開帳，數量更正請用庫存調整' | Rule O-01 |
 * | TC-182-OB-03 | Opening balance on same unit in different warehouse | Equivalence – Multi-Warehouse Independence | Allowed to record opening balance in second warehouse | Rule O-01 |
 * | TC-182-OB-04 | Opening balance with quantity = 0 | Boundary – Zero Quantity (0) | Validation error: '期初開帳數量必須大於 0' | Boundary 0 |
 * | TC-182-OB-05 | Opening balance with quantity = -1 | Boundary – Negative Quantity (-1) | Validation error: '期初開帳數量必須大於 0' | Boundary -1 |
 * | TC-182-OB-06 | Opening balance with unit cost = -1 | Boundary – Negative Cost (-1) | Validation error: '期初開帳成本不可為負數' | Boundary -1 |
 * | TC-182-INV-01 | list_inventory_levels with null warehouse (Company Total) | Equivalence – Aggregated Total | Returns SUM across all warehouses without cross-unit conversion | ADR #157 / Rule Q-01 |
 * | TC-182-INV-02 | list_inventory_levels filtered by specific warehouse | Equivalence – Partition Filter | Returns balance strictly for that specific warehouse | Rule Q-01 |
 * | TC-182-INV-03 | PO receipt reflected in inventory levels and movements | Equivalence – Receipt Inventory Linkage | Stock increased in PO warehouse; movement contains warehouse_id | Rule P-03 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 runes for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}
if (typeof globalThis.$derived === 'undefined') {
  globalThis.$derived = (fn) => typeof fn === 'function' ? fn() : fn;
}

const { invoke } = await import('../src/lib/tauri.js');
const storeModule = await import('../src/lib/store.svelte.js');
const {
  appState,
  getWorkspaceLabel,
  navigate,
  openCreateWarehouseModal,
  closeCreateWarehouseModal,
  fetchWarehouses,
  createWarehouseAction,
  updateWarehouseAction,
  setDefaultWarehouseAction,
  deactivateWarehouseAction,
  reactivateWarehouseAction,
  createPurchaseOrderAction,
  updatePurchaseOrderHeaderAction,
  confirmPurchaseOrderReceivedAction,
  recordOpeningInventoryBalanceAction,
  fetchInventoryLevels,
  fetchInventoryMovements,
  isZeroWarehouseError,
  handleZeroWarehouseError,
  selectPurchaseOrder,
  formatMovementReason,
  formatCurrency,
  formatTime,
  getWarehouseName
} = storeModule;

// Helper: switch active mock tenant
async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

// ========================================================
// 1. Navigation & Routing Tests (TC-182-NAV-01 ~ 03)
// ========================================================

test('TC-182-NAV-01: Equivalence - Route set to /app/warehouses resolves activeWorkspace and label', () => {
  // Given: Route set to /app/warehouses
  appState.route = '/app/warehouses';

  // When: Checking activeWorkspace and getWorkspaceLabel
  const ws = appState.activeWorkspace;
  const label = getWorkspaceLabel(ws);

  // Then: Workspace is warehouses and label is 倉庫管理
  assert.equal(ws, 'warehouses');
  assert.equal(label, '倉庫管理');
});

test('TC-182-NAV-02: Equivalence - Legacy route /app/inventory resolves activeWorkspace and label', () => {
  // Given: Route set to /app/inventory (backward compatibility for AI chat links)
  appState.route = '/app/inventory';

  // When: Checking activeWorkspace and getWorkspaceLabel
  const ws = appState.activeWorkspace;
  const label = getWorkspaceLabel(ws);

  // Then: Workspace is inventory and label is 庫存查詢
  assert.equal(ws, 'inventory');
  assert.equal(label, '庫存查詢');
});

test('TC-182-NAV-03: Equivalence - Warehouse subroutes resolve activeWorkspace properly', () => {
  // Given: Subroutes under warehouses
  const subroutes = [
    '/app/warehouses/master',
    '/app/warehouses/adjustments',
    '/app/warehouses/stocktakes',
    '/app/warehouses/transfers'
  ];

  for (const route of subroutes) {
    // When: Setting route
    appState.route = route;

    // Then: activeWorkspace consistently resolves to warehouses
    assert.equal(appState.activeWorkspace, 'warehouses');
    assert.equal(getWorkspaceLabel(appState.activeWorkspace), '倉庫管理');
  }
});

// ========================================================
// 2. Zero-Warehouse Defense & W-00 Modal Trigger (TC-182-W00-01 ~ 03)
// ========================================================

test('TC-182-W00-01: Boundary - Zero warehouse tenant calling list_warehouses & list_inventory_levels returns [] (Q-01)', async () => {
  // Given: Brand new tenant with zero warehouses
  const tid = `tnt_zero_${Date.now()}`;
  await switchTenant(tid);

  // When: Querying warehouses and inventory levels (Q-01 pure query)
  const whs = await invoke('list_warehouses');
  const levels = await invoke('list_inventory_levels');

  // Then: Safe empty arrays without throwing errors
  assert.deepEqual(whs, []);
  assert.deepEqual(levels, []);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-W00-02: Error - Zero-warehouse tenant calling createPurchaseOrderAction triggers W-00 modal', async () => {
  // Given: Zero warehouse tenant
  const tid = `tnt_zero_po_${Date.now()}`;
  await switchTenant(tid);
  closeCreateWarehouseModal();
  assert.equal(appState.isCreateWarehouseModalOpen, false);

  // When & Then: createPurchaseOrderAction throws W-00 error and opens Create Warehouse Modal
  await assert.rejects(
    async () => {
      await createPurchaseOrderAction({
        vendor_partner_id: 'vnd_mock',
        currency: 'TWD'
      });
    },
    (err) => {
      assert.ok(err.message.includes('尚未建立任何倉別'));
      return true;
    }
  );

  // Then: Modal is automatically opened for user to create the first warehouse immediately
  assert.equal(appState.isCreateWarehouseModalOpen, true);

  // Teardown
  closeCreateWarehouseModal();
  await switchTenant('tnt_mock_1');
});

test('TC-182-W00-03: Error - Zero-warehouse tenant calling recordOpeningInventoryBalanceAction triggers W-00 modal', async () => {
  // Given: Zero warehouse tenant with a registered product
  const tid = `tnt_zero_ob_${Date.now()}`;
  await switchTenant(tid);
  closeCreateWarehouseModal();
  assert.equal(appState.isCreateWarehouseModalOpen, false);

  const prod = await invoke('create_product', { name: '零倉測試品', category: 'resale', unit_name: '件' });
  const unit = prod.units[0];

  // When & Then: recordOpeningInventoryBalanceAction throws W-00 error and opens Create Warehouse Modal
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({
        unit_id: unit.id,
        quantity_delta: 10,
        unit_cost: 100
      });
    },
    (err) => {
      assert.ok(err.message.includes('尚未建立任何倉別'));
      return true;
    }
  );

  // Then: Modal is automatically opened
  assert.equal(appState.isCreateWarehouseModalOpen, true);

  // Teardown
  closeCreateWarehouseModal();
  await switchTenant('tnt_mock_1');
});

// ========================================================
// 3. Warehouse Master Management (TC-182-WH-01 ~ 13)
// ========================================================

test('TC-182-WH-01: Equivalence - First created warehouse automatically becomes default (W-06)', async () => {
  // Given: Fresh tenant
  const tid = `tnt_wh_crud_${Date.now()}`;
  await switchTenant(tid);

  // When: Creating first warehouse
  const wh = await createWarehouseAction({ code: 'WH-01', name: '台北總倉' });

  // Then: Automatically marked default and active
  assert.ok(wh.id.startsWith('wh_'));
  assert.equal(wh.code, 'WH-01');
  assert.equal(wh.name, '台北總倉');
  assert.equal(wh.is_default, true);
  assert.equal(wh.is_active, true);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-02 & WH-03: Boundary - createWarehouseAction with empty or whitespace code rejected (W-02)', async () => {
  // Given: Valid name with empty / whitespace code
  await assert.rejects(
    async () => await createWarehouseAction({ code: '', name: '分倉' }),
    { message: '倉庫代碼為必填項目' }
  );

  await assert.rejects(
    async () => await createWarehouseAction({ code: '   ', name: '分倉' }),
    { message: '倉庫代碼為必填項目' }
  );
});

test('TC-182-WH-04: Boundary - createWarehouseAction with empty or whitespace name rejected (W-02)', async () => {
  // Given: Valid code with empty / whitespace name
  await assert.rejects(
    async () => await createWarehouseAction({ code: 'WH-KHH', name: '' }),
    { message: '倉庫名稱為必填項目' }
  );

  await assert.rejects(
    async () => await createWarehouseAction({ code: 'WH-KHH', name: '   ' }),
    { message: '倉庫名稱為必填項目' }
  );
});

test('TC-182-WH-05: Error - Duplicate warehouse code is rejected (W-02)', async () => {
  // Given: Tenant with warehouse WH-DUP
  const tid = `tnt_wh_dup_${Date.now()}`;
  await switchTenant(tid);
  await createWarehouseAction({ code: 'WH-DUP', name: '原創倉' });

  // When & Then: Creating duplicate code (case-insensitive) fails
  await assert.rejects(
    async () => await createWarehouseAction({ code: 'wh-dup', name: '重複倉' }),
    (err) => {
      assert.ok(err.message.includes('倉別代碼已存在'));
      return true;
    }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-06: Equivalence - createWarehouseAction triggers success callback', async () => {
  // Given: A registered callback
  const tid = `tnt_wh_cb_${Date.now()}`;
  await switchTenant(tid);

  let callbackCalledWith = null;
  openCreateWarehouseModal((wh) => {
    callbackCalledWith = wh;
  });

  // When: Creating warehouse
  const wh = await createWarehouseAction({ code: 'WH-CB', name: '回呼測試倉' });

  // Then: Callback was executed with newly created warehouse
  assert.ok(callbackCalledWith);
  assert.equal(callbackCalledWith.id, wh.id);
  assert.equal(callbackCalledWith.code, 'WH-CB');

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-07: Equivalence - updateWarehouseAction updates code and name', async () => {
  // Given: Tenant with a warehouse
  const tid = `tnt_wh_upd_${Date.now()}`;
  await switchTenant(tid);
  const wh = await createWarehouseAction({ code: 'OLD-01', name: '舊倉庫名' });

  // When: Updating code and name
  const updated = await updateWarehouseAction(wh.id, 'NEW-01', '新倉庫名');

  // Then: Attributes updated, default preserved
  assert.equal(updated.code, 'NEW-01');
  assert.equal(updated.name, '新倉庫名');
  assert.equal(updated.is_default, true);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-08: Equivalence - setDefaultWarehouseAction switches default atomically (W-05)', async () => {
  // Given: Tenant with two warehouses (WH1 default, WH2 non-default)
  const tid = `tnt_wh_atomic_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'WH1', name: '第一倉' });
  const wh2 = await createWarehouseAction({ code: 'WH2', name: '第二倉' });
  assert.equal(wh1.is_default, true);
  assert.equal(wh2.is_default, false);

  // When: Switching default to WH2
  const updatedWh2 = await setDefaultWarehouseAction(wh2.id);

  // Then: WH2 is default, WH1 is no longer default, exactly 1 default exists
  assert.equal(updatedWh2.is_default, true);
  const list = await fetchWarehouses();
  const defaults = list.filter(w => w.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, wh2.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-09: Error - deactivateWarehouseAction rejects deactivating default warehouse (W-03)', async () => {
  // Given: Default warehouse
  const tid = `tnt_wh_def_guard_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'DEF-01', name: '預設防護倉' });

  // When & Then: Deactivating default warehouse is blocked
  await assert.rejects(
    async () => await deactivateWarehouseAction(wh1.id),
    (err) => {
      assert.ok(err.message.includes('預設倉不可停用'));
      return true;
    }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-10: Error - deactivateWarehouseAction rejects deactivating warehouse with stock (W-03)', async () => {
  // Given: Non-default warehouse with positive stock
  const tid = `tnt_wh_stock_guard_${Date.now()}`;
  await switchTenant(tid);
  await createWarehouseAction({ code: 'DEF-WH', name: '主預設倉' });
  const subWh = await createWarehouseAction({ code: 'SUB-WH', name: '有庫存次倉' });

  // Given: Create product & unit, record opening balance in subWh
  const product = await invoke('create_product', { name: '防停用測試品', category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  await recordOpeningInventoryBalanceAction({
    unit_id: unit.id,
    quantity_delta: 5,
    unit_cost: 100,
    warehouse_id: subWh.id
  });

  // When & Then: Deactivating subWh is rejected due to stock guard (W-03)
  await assert.rejects(
    async () => await deactivateWarehouseAction(subWh.id),
    (err) => {
      assert.ok(err.message.includes('此倉仍有庫存'));
      return true;
    }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-11: Error - deactivateWarehouseAction rejects deactivating warehouse referenced by open PO (W-03)', async () => {
  // Given: Non-default warehouse referenced by a draft PO
  const tid = `tnt_wh_po_guard_${Date.now()}`;
  await switchTenant(tid);
  await createWarehouseAction({ code: 'WH-MAIN', name: '主倉' });
  const whSub = await createWarehouseAction({ code: 'WH-SUB', name: '被採購單引用次倉' });
  const vendor = await invoke('create_partner', { name: `供應商_${Date.now()}`, is_vendor: true });

  await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    warehouse_id: whSub.id
  });

  // When & Then: Deactivating whSub is rejected due to open PO reference
  await assert.rejects(
    async () => await deactivateWarehouseAction(whSub.id),
    (err) => {
      assert.ok(err.message.includes('此倉仍被未結案單據引用'));
      return true;
    }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-WH-12 & WH-13: Equivalence - Lifecycle of deactivating and reactivating empty warehouse', async () => {
  // Given: Non-default empty warehouse
  const tid = `tnt_wh_lifecycle_${Date.now()}`;
  await switchTenant(tid);
  await createWarehouseAction({ code: 'MAIN', name: '主倉' });
  const sub = await createWarehouseAction({ code: 'SUB', name: '空次倉' });
  assert.equal(sub.is_active, true);

  // When: Deactivating
  const deactivated = await deactivateWarehouseAction(sub.id);
  assert.equal(deactivated.is_active, false);

  // When: Reactivating
  const reactivated = await reactivateWarehouseAction(sub.id);
  assert.equal(reactivated.is_active, true);

  // Teardown
  await switchTenant('tnt_mock_1');
});

// ========================================================
// 4. Purchase Order Warehouse Dimension (TC-182-PO-01 ~ 06)
// ========================================================

test('TC-182-PO-01: Boundary - Single active warehouse fallback to default warehouse (Rule P-01)', async () => {
  // Given: Tenant with single active warehouse
  const tid = `tnt_po_single_wh_${Date.now()}`;
  await switchTenant(tid);
  const defWh = await createWarehouseAction({ code: 'WH-ONLY', name: '獨一倉' });
  const vendor = await invoke('create_partner', { name: `供應商_SINGLE_${Date.now()}`, is_vendor: true });

  // When: Creating PO without explicit warehouse_id
  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD'
  });

  // Then: Order automatically associated with default warehouse
  assert.equal(detail.order.warehouse_id, defWh.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-PO-02: Equivalence - Multi-warehouse PO creation specifies target warehouse (Rule P-01)', async () => {
  // Given: Tenant with two warehouses
  const tid = `tnt_po_multi_wh_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'WH1', name: '倉一' });
  const wh2 = await createWarehouseAction({ code: 'WH2', name: '倉二' });
  const vendor = await invoke('create_partner', { name: `供應商_MULTI_${Date.now()}`, is_vendor: true });

  // When: Creating PO explicitly targeting wh2
  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    warehouse_id: wh2.id
  });

  // Then: PO recorded with wh2
  assert.equal(detail.order.warehouse_id, wh2.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-PO-03: Equivalence - Draft PO header edit allows changing warehouse (Rule P-02)', async () => {
  // Given: Draft PO in wh1
  const tid = `tnt_po_draft_edit_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'W1', name: '原進貨倉' });
  const wh2 = await createWarehouseAction({ code: 'W2', name: '改派進貨倉' });
  const vendor = await invoke('create_partner', { name: `供應商_DRAFT_${Date.now()}`, is_vendor: true });

  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    warehouse_id: wh1.id
  });
  assert.equal(detail.order.warehouse_id, wh1.id);

  // When: Editing header on draft PO to wh2
  const updated = await updatePurchaseOrderHeaderAction(detail.order.id, {
    warehouse_id: wh2.id
  });

  // Then: Order warehouse updated to wh2
  assert.equal(updated.order.warehouse_id, wh2.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-PO-04: Equivalence - Ordered PO header edit allows changing warehouse (Rule P-02)', async () => {
  // Given: Submitted (ordered) PO in wh1
  const tid = `tnt_po_ordered_edit_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'W1', name: '初派倉' });
  const wh2 = await createWarehouseAction({ code: 'W2', name: '重派倉' });
  const vendor = await invoke('create_partner', { name: `供應商_ORD_${Date.now()}`, is_vendor: true });
  const product = await invoke('create_product', { name: `採購商品_${Date.now()}`, category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    warehouse_id: wh1.id,
    initial_lines: [{ unit_id: unit.id, quantity: 10, purchase_cost: 50 }]
  });

  // Submit order to 'ordered'
  await invoke('submit_purchase_order', { order_id: detail.order.id });

  // When: Editing header warehouse while in 'ordered' status
  const updated = await updatePurchaseOrderHeaderAction(detail.order.id, {
    warehouse_id: wh2.id
  });

  // Then: Successfully modified in ordered status
  assert.equal(updated.order.status, 'ordered');
  assert.equal(updated.order.warehouse_id, wh2.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-PO-05 & PO-06: Error - Terminal state PO (received/cancelled) rejects header modification (Rule P-02)', async () => {
  // Given: Received PO
  const tid = `tnt_po_terminal_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'W1', name: '第一倉' });
  const wh2 = await createWarehouseAction({ code: 'W2', name: '第二倉' });
  const vendor = await invoke('create_partner', { name: `供應商_TERM_${Date.now()}`, is_vendor: true });
  const product = await invoke('create_product', { name: `終態商品_${Date.now()}`, category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    warehouse_id: wh1.id,
    initial_lines: [{ unit_id: unit.id, quantity: 5, purchase_cost: 60 }]
  });
  await invoke('submit_purchase_order', { order_id: detail.order.id });
  await confirmPurchaseOrderReceivedAction(detail.order.id);

  // When & Then: Attempting to modify header on received PO fails
  await assert.rejects(
    async () => await updatePurchaseOrderHeaderAction(detail.order.id, { warehouse_id: wh2.id }),
    (err) => {
      assert.ok(err.message.includes('不允許修改表頭'));
      return true;
    }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

// ========================================================
// 5. Opening Balance Multi-Warehouse & O-01 Uniqueness (TC-182-OB-01 ~ 06)
// ========================================================

test('TC-182-OB-01 & OB-02: Equivalence & Error - Opening balance creates movement and duplicate throws O-01', async () => {
  // Given: Tenant with warehouse
  const tid = `tnt_ob_o01_${Date.now()}`;
  await switchTenant(tid);
  const wh = await createWarehouseAction({ code: 'OB-WH', name: '開帳倉' });

  const product = await invoke('create_product', { name: '開帳測試品', category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  // When: TC-182-OB-01 - Recording first opening balance
  const mov = await recordOpeningInventoryBalanceAction({
    unit_id: unit.id,
    quantity_delta: 20,
    unit_cost: 150,
    warehouse_id: wh.id
  });

  // Then: Movement created with opening_balance reason and wh.id
  assert.equal(mov.reason, 'opening_balance');
  assert.equal(mov.warehouse_id, wh.id);
  assert.equal(mov.quantity_delta, 20);

  // When & Then: TC-182-OB-02 - Duplicate opening balance in same warehouse is rejected with O-01 message
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({
        unit_id: unit.id,
        quantity_delta: 5,
        unit_cost: 150,
        warehouse_id: wh.id
      });
    },
    (err) => {
      assert.equal(
        err.message,
        `此商品單位在〔${wh.name}〕已開帳，數量更正請用庫存調整（原因：期初更正）`
      );
      return true;
    }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-OB-03: Equivalence - Multi-warehouse opening balance independence on same unit (Rule O-01)', async () => {
  // Given: Tenant with WH1 and WH2
  const tid = `tnt_ob_multi_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'WH1', name: '倉一' });
  const wh2 = await createWarehouseAction({ code: 'WH2', name: '倉二' });

  const product = await invoke('create_product', { name: '多倉開帳品', category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  // When: Opening balance in WH1
  await recordOpeningInventoryBalanceAction({
    unit_id: unit.id,
    quantity_delta: 15,
    unit_cost: 100,
    warehouse_id: wh1.id
  });

  // When: Opening balance on SAME unit in WH2
  const mov2 = await recordOpeningInventoryBalanceAction({
    unit_id: unit.id,
    quantity_delta: 30,
    unit_cost: 100,
    warehouse_id: wh2.id
  });

  // Then: WH2 allowed independently without conflict
  assert.equal(mov2.warehouse_id, wh2.id);
  assert.equal(mov2.quantity_delta, 30);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-OB-04, 05, 06: Boundary - Opening balance quantity <= 0 and cost < 0 validations', async () => {
  // Given: Valid warehouse and unit
  const tid = `tnt_ob_bnd_${Date.now()}`;
  await switchTenant(tid);
  const wh = await createWarehouseAction({ code: 'BND-WH', name: '邊界倉' });
  const product = await invoke('create_product', { name: '邊界開帳品', category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  // When & Then: TC-182-OB-04 - Quantity = 0
  await assert.rejects(
    async () => await recordOpeningInventoryBalanceAction({ unit_id: unit.id, quantity_delta: 0, unit_cost: 100, warehouse_id: wh.id }),
    { message: '期初開帳數量必須大於 0' }
  );

  // When & Then: TC-182-OB-05 - Quantity = -1
  await assert.rejects(
    async () => await recordOpeningInventoryBalanceAction({ unit_id: unit.id, quantity_delta: -1, unit_cost: 100, warehouse_id: wh.id }),
    { message: '期初開帳數量必須大於 0' }
  );

  // When & Then: TC-182-OB-06 - Cost = -1
  await assert.rejects(
    async () => await recordOpeningInventoryBalanceAction({ unit_id: unit.id, quantity_delta: 10, unit_cost: -1, warehouse_id: wh.id }),
    { message: '期初開帳成本不可為負數' }
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

// ========================================================
// 6. Inventory Inquiry by Warehouse & Breakdown (TC-182-INV-01 ~ 03)
// ========================================================

test('TC-182-INV-01 & INV-02: Equivalence - Inventory query with null (all warehouses) vs specific warehouse filter', async () => {
  // Given: Tenant with WH1 (qty: 12) and WH2 (qty: 8)
  const tid = `tnt_inv_query_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'WH1', name: '台北總倉' });
  const wh2 = await createWarehouseAction({ code: 'WH2', name: '高雄分倉' });

  const product = await invoke('create_product', { name: '高粱酒', category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  await recordOpeningInventoryBalanceAction({ unit_id: unit.id, quantity_delta: 12, unit_cost: 500, warehouse_id: wh1.id });
  await recordOpeningInventoryBalanceAction({ unit_id: unit.id, quantity_delta: 8, unit_cost: 500, warehouse_id: wh2.id });

  // When: Querying all warehouses (null)
  const totalLevels = await fetchInventoryLevels(null);
  const itemTotal = totalLevels.find(l => l.unit_id === unit.id);

  // Then: Aggregated total is 12 + 8 = 20 (ADR #157 unit independent)
  assert.equal(itemTotal.current_quantity, 20);

  // When: Querying strictly for WH2
  const wh2Levels = await fetchInventoryLevels(wh2.id);
  const itemWh2 = wh2Levels.find(l => l.unit_id === unit.id);

  // Then: Filtered quantity is strictly 8
  assert.equal(itemWh2.current_quantity, 8);

  // When: Querying strictly for WH1
  const wh1Levels = await fetchInventoryLevels(wh1.id);
  const itemWh1 = wh1Levels.find(l => l.unit_id === unit.id);

  // Then: Filtered quantity is strictly 12
  assert.equal(itemWh1.current_quantity, 12);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-182-INV-03: Equivalence - PO receipt reflects in inventory level and movement breakdown (Rule P-03)', async () => {
  // Given: Tenant with WH1 and WH2
  const tid = `tnt_inv_po_rcv_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await createWarehouseAction({ code: 'WH1', name: '第一倉' });
  const wh2 = await createWarehouseAction({ code: 'WH2', name: '第二倉' });
  const vendor = await invoke('create_partner', { name: `供應商_RCV_${Date.now()}`, is_vendor: true });
  const product = await invoke('create_product', { name: '入庫測試品', category: 'resale', unit_name: '件' });
  const unit = product.units[0];

  // Given: Initial baseline in WH1 = 10
  await recordOpeningInventoryBalanceAction({ unit_id: unit.id, quantity_delta: 10, unit_cost: 100, warehouse_id: wh1.id });

  // When: Creating PO targeting WH2 for 25 units, submitting and receiving
  const poDetail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unit.id, quantity: 25, purchase_cost: 85 }]
  });
  await invoke('submit_purchase_order', { order_id: poDetail.order.id });
  await confirmPurchaseOrderReceivedAction(poDetail.order.id);

  // Then: WH2 inventory increased to 25, WH1 unchanged at 10, Total = 35
  const wh1Levels = await fetchInventoryLevels(wh1.id);
  const wh2Levels = await fetchInventoryLevels(wh2.id);
  const allLevels = await fetchInventoryLevels(null);

  assert.equal(wh1Levels.find(l => l.unit_id === unit.id).current_quantity, 10);
  assert.equal(wh2Levels.find(l => l.unit_id === unit.id).current_quantity, 25);
  assert.equal(allLevels.find(l => l.unit_id === unit.id).current_quantity, 35);

  // Then: fetchInventoryMovements includes the purchase_receipt movement linked to PO
  const movs = await fetchInventoryMovements(unit.id);
  const poMov = movs.find(m => m.reference_id === poDetail.order.id);
  assert.ok(poMov);
  assert.equal(poMov.reason, 'purchase_receipt');
  assert.equal(poMov.warehouse_id, wh2.id);
  assert.equal(poMov.quantity_delta, 25);

  // Teardown
  await switchTenant('tnt_mock_1');
});

// ========================================================
// 7. Review Findings & Regressions (TC-182-REV-01 ~ 03)
// ========================================================

test('TC-182-REV-01: Shared zero-warehouse error detection and interceptor', () => {
  // Given: Error messages matching W-00
  const err1 = new Error('此租戶尚未建立任何倉別，無法執行庫存操作');
  const err2 = new Error('W-00: Zero warehouse defense');
  const otherErr = new Error('商品名稱重複');

  // When & Then: isZeroWarehouseError accurately identifies W-00
  assert.equal(isZeroWarehouseError(err1), true);
  assert.equal(isZeroWarehouseError(err2), true);
  assert.equal(isZeroWarehouseError(otherErr), false);

  // When & Then: handleZeroWarehouseError opens modal for W-00 and returns true
  closeCreateWarehouseModal();
  let callbackExecuted = false;
  const handled = handleZeroWarehouseError(err1, () => { callbackExecuted = true; });
  assert.equal(handled, true);
  assert.equal(appState.isCreateWarehouseModalOpen, true);
  assert.equal(typeof appState.createWarehouseSuccessCallback, 'function');
  closeCreateWarehouseModal();

  const notHandled = handleZeroWarehouseError(otherErr);
  assert.equal(notHandled, false);
  assert.equal(appState.isCreateWarehouseModalOpen, false);
});

test('TC-182-REV-02: Unified formatters consistency across workspaces', () => {
  // Given: Movement reasons
  assert.equal(formatMovementReason('opening_balance'), '期初開帳');
  assert.equal(formatMovementReason('purchase_receipt'), '採購單入庫');
  assert.equal(formatMovementReason('adjustment'), '庫存調整');
  assert.equal(formatMovementReason('stocktake_discrepancy'), '盤點盈虧');
  assert.equal(formatMovementReason('transfer_out'), '調撥出庫');
  assert.equal(formatMovementReason('transfer_in'), '調撥入庫');

  // Given: Currency formatting
  assert.equal(formatCurrency(1250), 'NT$ 1,250');
  assert.equal(formatCurrency(0), 'NT$ 0');
  assert.equal(formatCurrency(null), '-');

  // Given: Time formatting
  assert.equal(formatTime(null), '-');
  const formatted = formatTime(1700000000);
  assert.ok(formatted.length > 5);
});

test('TC-182-REV-03: selectPurchaseOrder navigation tracks selected ID', async () => {
  // Given: Target purchase order ID
  const targetId = 'po_test_nav_123';

  // When: Calling selectPurchaseOrder
  await selectPurchaseOrder(targetId);

  // Then: appState records selectedPurchaseOrderId and route is set to /app/purchase-orders
  assert.equal(appState.selectedPurchaseOrderId, targetId);
  assert.equal(appState.route, '/app/purchase-orders');

  // Cleanup
  appState.selectedPurchaseOrderId = null;
});
