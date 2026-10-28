import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

/**
 * Test Perspective Table (Issue #179 - Warehouses & Inventory Dimension)
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-179-WH-N-01 | Create first warehouse in new tenant | Equivalence – First Default | is_default = true, is_active = true, id prefixed with 'wh_' | Rule W-06 |
 * | TC-179-WH-N-02 | Create second warehouse in same tenant | Equivalence – Subsequent Non-Default | is_default = false, is_active = true | Rule W-06 |
 * | TC-179-WH-N-03 | set_default_warehouse on second warehouse | Equivalence – Atomic Default Switch | wh2 becomes default, wh1 becomes non-default | Rule W-05 |
 * | TC-179-WH-N-04 | update_warehouse with valid code and name | Equivalence – Master Update | code and name updated, is_default unchanged | - |
 * | TC-179-WH-N-05 | deactivate_warehouse and reactivate_warehouse | Equivalence – Lifecycle | is_active transitions true -> false -> true | Rule W-03 |
 * | TC-179-WH-E-01 | Zero-warehouse tenant calling create_purchase_order | Error – W-00 Zero Warehouse Defense | Rejected with '此租戶尚未建立任何倉別...' | Rule W-00 |
 * | TC-179-WH-E-02 | Zero-warehouse tenant calling record_opening_inventory_balance | Error – W-00 Zero Warehouse Defense | Rejected with '此租戶尚未建立任何倉別...' | Rule W-00 |
 * | TC-179-WH-Q-01 | Zero-warehouse tenant calling list_inventory_levels and list_warehouses | Equivalence – Pure Queries | Returns empty array [] without error | Rule Q-01 |
 * | TC-179-WH-E-03 | create_warehouse with empty code or whitespace | Boundary – Empty Code | Validation error: '倉別代碼不可空白' | Rule W-02 |
 * | TC-179-WH-E-04 | create_warehouse with empty name or whitespace | Boundary – Empty Name | Validation error: '倉別名稱不可空白' | Rule W-02 |
 * | TC-179-WH-E-05 | create_warehouse with duplicate code (case-insensitive) | Error – Unique Code | Validation error: '倉別代碼已存在' | Rule W-02 |
 * | TC-179-WH-E-06 | deactivate_warehouse on default warehouse | Error – W-03 Default Guard | Validation error: '預設倉不可停用' | Rule W-03 |
 * | TC-179-WH-E-07 | deactivate_warehouse on warehouse with non-zero stock | Error – W-03 Stock Guard | Validation error: '此倉仍有庫存，請先調撥或調整歸零' | Rule W-03 |
 * | TC-179-WH-E-08 | deactivate_warehouse on warehouse referenced by draft PO | Error – W-03 PO Reference Guard | Validation error: '此倉仍被未結案單據引用：<PO_NUM>' | Rule W-03 |
 * | TC-179-WH-E-09 | set_default_warehouse on deactivated warehouse | Error – W-05 Inactive Target | Validation error: '停用中的倉別不可設為預設' | Rule W-05 |
 * | TC-179-PO-N-01 | create_purchase_order without warehouse_id | Equivalence – Default Warehouse Fallback | Order warehouse_id defaults to active default warehouse | Rule P-01 |
 * | TC-179-PO-N-02 | create_purchase_order with explicit warehouse_id | Equivalence – Explicit Warehouse | Order warehouse_id saved as specified | Rule P-01 |
 * | TC-179-PO-N-03 | update_purchase_order_header warehouse_id on draft PO | Equivalence – Update Header Warehouse | Order warehouse_id successfully updated | Rule P-02 |
 * | TC-179-PO-N-04 | confirm_purchase_order_received writes movement warehouse_id | Equivalence – Receipt Warehouse Linkage | Inventory movement records order.warehouse_id | Rule P-03 |
 * | TC-179-OB-N-01 | Opening balance on same unit across multiple warehouses | Equivalence – Multi-Warehouse Independence | Same unit can be opened in WH1 and WH2 | Rule O-01 |
 * | TC-179-OB-E-01 | Duplicate opening balance in same warehouse | Error – O-01 Uniqueness Guard | Rejected with formatted message containing warehouse name | Rule O-01 |
 * | TC-179-INV-N-01 | get_inventory_level with warehouse_id filter vs null | Equivalence – Stock Aggregate & Partition | Filtered returns warehouse stock, null returns tenant total | Rule Q-01 |
 */

// Helper to switch active mock tenant
async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

// Reset mock warehouses for a tenant
async function resetMockTenantWarehouses(tenantId) {
  await invoke('reset_mock_warehouses', { tenant_id: tenantId });
}

test('TC-179-WH-N-01 & N-02: Create first warehouse becomes default, second warehouse is non-default', async () => {
  // Given: Unique test tenant with no prior warehouses
  const tid = `tnt_wh_test_${Date.now()}`;
  await switchTenant(tid);

  // When: Creating the first warehouse in the tenant (W-06)
  const wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });

  // Then: First warehouse automatically receives is_default = true and is_active = true
  assert.ok(wh1.id.startsWith('wh_'));
  assert.equal(wh1.code, 'MAIN');
  assert.equal(wh1.name, '主倉');
  assert.equal(wh1.is_default, true);
  assert.equal(wh1.is_active, true);

  // When: Creating the second warehouse in the same tenant
  const wh2 = await invoke('create_warehouse', { code: 'SUB', name: '二倉' });

  // Then: Second warehouse is created as non-default (is_default = false)
  assert.ok(wh2.id.startsWith('wh_'));
  assert.equal(wh2.code, 'SUB');
  assert.equal(wh2.name, '二倉');
  assert.equal(wh2.is_default, false);
  assert.equal(wh2.is_active, true);

  // Then: list_warehouses orders default first
  const list = await invoke('list_warehouses');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, wh1.id);
  assert.equal(list[1].id, wh2.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-WH-N-03: Switching default warehouse operates atomically', async () => {
  // Given: Tenant with wh1 (default) and wh2 (non-default)
  const tid = `tnt_atomic_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉庫一' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉庫二' });
  assert.equal(wh1.is_default, true);
  assert.equal(wh2.is_default, false);

  // When: Setting wh2 as default
  const updatedWh2 = await invoke('set_default_warehouse', { id: wh2.id });

  // Then: wh2 is now default
  assert.equal(updatedWh2.id, wh2.id);
  assert.equal(updatedWh2.is_default, true);

  // Then: Querying list_warehouses confirms exactly one default exists
  const list = await invoke('list_warehouses');
  const defaults = list.filter(w => w.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, wh2.id);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-WH-N-04: Update warehouse code and name', async () => {
  // Given: Existing warehouse
  const tid = `tnt_upd_${Date.now()}`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'OLD_CODE', name: '舊倉庫' });

  // When: Updating code and name
  const updated = await invoke('update_warehouse', { id: wh.id, code: 'NEW_CODE', name: '新倉庫' });

  // Then: Fields updated successfully while preserving is_default and is_active
  assert.equal(updated.id, wh.id);
  assert.equal(updated.code, 'NEW_CODE');
  assert.equal(updated.name, '新倉庫');
  assert.equal(updated.is_default, true);
  assert.equal(updated.is_active, true);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-WH-N-05: Deactivate and reactivate warehouse lifecycle', async () => {
  // Given: Tenant with wh1 (default) and wh2 (secondary)
  const tid = `tnt_deact_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'DEF', name: '預設倉' });
  const wh2 = await invoke('create_warehouse', { code: 'AUX', name: '輔助倉' });

  // When: Deactivating secondary warehouse wh2
  const deactivated = await invoke('deactivate_warehouse', { id: wh2.id });

  // Then: is_active is false
  assert.equal(deactivated.is_active, false);

  // Then: list_warehouses without flag returns only active wh1
  const activeOnly = await invoke('list_warehouses');
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0].id, wh1.id);

  // Then: list_warehouses with include_inactive: true returns both
  const all = await invoke('list_warehouses', { include_inactive: true });
  assert.equal(all.length, 2);

  // When: Reactivating wh2
  const reactivated = await invoke('reactivate_warehouse', { id: wh2.id });

  // Then: is_active is true again
  assert.equal(reactivated.is_active, true);
  const activeAfter = await invoke('list_warehouses');
  assert.equal(activeAfter.length, 2);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-WH-E-01 & E-02 & Q-01: W-00 zero warehouse rejection on writes, pure queries return []', async () => {
  // Given: Tenant with 0 warehouses
  const tid = `tnt_zero_${Date.now()}`;
  await switchTenant(tid);
  await resetMockTenantWarehouses(tid);

  // Setup vendor and product
  const vendor = await invoke('create_partner', { name: `供應商_${Date.now()}`, is_vendor: true });
  const prod = await invoke('create_product', { name: `商品_${Date.now()}`, category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  // When & Then: create_purchase_order rejected with Rule W-00
  await assert.rejects(
    async () => {
      await invoke('create_purchase_order', { vendor_partner_id: vendor.id });
    },
    /此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別/
  );

  // When & Then: record_opening_inventory_balance rejected with Rule W-00
  await assert.rejects(
    async () => {
      await invoke('record_opening_inventory_balance', { unit_id: unitId, quantity_delta: 10, unit_cost: 50 });
    },
    /此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別/
  );

  // When & Then: Pure queries list_inventory_levels, list_inventory_movements, get_inventory_level and list_warehouses (Q-01)
  const levels = await invoke('list_inventory_levels');
  assert.deepEqual(levels, []);

  const movements = await invoke('list_inventory_movements');
  assert.deepEqual(movements, []);

  const level = await invoke('get_inventory_level', { unit_id: unitId });
  assert.equal(level.current_quantity, 0);

  const whs = await invoke('list_warehouses');
  assert.deepEqual(whs, []);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-WH-E-03 ~ E-05: Code & Name validations, case-insensitive duplicate defense', async () => {
  // Given: Active tenant with warehouse 'NORTH'
  const tid = `tnt_val_${Date.now()}`;
  await switchTenant(tid);
  await invoke('create_warehouse', { code: 'NORTH', name: '北部倉' });

  // When & Then: Empty code throws
  await assert.rejects(
    async () => {
      await invoke('create_warehouse', { code: '   ', name: '無代碼倉' });
    },
    /倉別代碼不可空白/
  );

  // When & Then: Empty name throws
  await assert.rejects(
    async () => {
      await invoke('create_warehouse', { code: 'SOUTH', name: '   ' });
    },
    /倉別名稱不可空白/
  );

  // When & Then: Duplicate code in lowercase 'north' throws
  await assert.rejects(
    async () => {
      await invoke('create_warehouse', { code: 'north', name: '重複倉' });
    },
    /倉別代碼已存在/
  );

  // When & Then: Duplicate code with spaces throws
  await assert.rejects(
    async () => {
      await invoke('create_warehouse', { code: '  NORTH  ', name: '重複倉2' });
    },
    /倉別代碼已存在/
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-WH-E-06 ~ E-09: Deactivate guards (default, non-zero stock, pending PO) and deactivated default switch', async () => {
  // Given: Tenant with default wh1 and secondary wh2
  const tid = `tnt_guards_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const wh2 = await invoke('create_warehouse', { code: 'SUB', name: '二倉' });
  const vendor = await invoke('create_partner', { name: `防護廠商_${Date.now()}`, is_vendor: true });
  const prod = await invoke('create_product', { name: `防護商品_${Date.now()}`, category: 'resale', unit_name: '個' });
  const unitId = prod.units[0].id;

  // --- Guard 1: Cannot deactivate default warehouse ---
  await assert.rejects(
    async () => {
      await invoke('deactivate_warehouse', { id: wh1.id });
    },
    /預設倉不可停用/
  );

  // --- Guard 2: Cannot deactivate warehouse with non-zero stock ---
  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 25,
    unit_cost: 100,
    warehouse_id: wh2.id
  });

  await assert.rejects(
    async () => {
      await invoke('deactivate_warehouse', { id: wh2.id });
    },
    /此倉仍有庫存，請先調撥或調整歸零/
  );

  // --- Guard 3: Cannot deactivate warehouse referenced by pending draft PO ---
  const wh3 = await invoke('create_warehouse', { code: 'PO_WH', name: '採購倉' });
  const poDraft = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    warehouse_id: wh3.id
  });

  await assert.rejects(
    async () => {
      await invoke('deactivate_warehouse', { id: wh3.id });
    },
    new RegExp(`此倉仍被未結案單據引用：${poDraft.order.po_number}`)
  );

  // --- Guard 4: Cannot set deactivated warehouse as default ---
  const wh4 = await invoke('create_warehouse', { code: 'TEMP', name: '臨時倉' });
  await invoke('deactivate_warehouse', { id: wh4.id });

  await assert.rejects(
    async () => {
      await invoke('set_default_warehouse', { id: wh4.id });
    },
    /停用中的倉別不可設為預設/
  );

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-PO-N-01 ~ N-04: PO warehouse resolution, header updates, and receipt movement linking', async () => {
  // Given: Tenant with default wh1 and secondary wh2
  const tid = `tnt_po_dim_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '總倉' });
  const wh2 = await invoke('create_warehouse', { code: 'BRANCH', name: '分倉' });
  const vendor = await invoke('create_partner', { name: `採購維度廠商_${Date.now()}`, is_vendor: true });
  const prod = await invoke('create_product', { name: `維度商品_${Date.now()}`, category: 'resale', unit_name: '台' });
  const unitId = prod.units[0].id;

  // When: Creating PO without warehouse_id (P-01 fallback to default)
  const po1 = await invoke('create_purchase_order', { vendor_partner_id: vendor.id });
  // Then: Defaults to wh1
  assert.equal(po1.order.warehouse_id, wh1.id);

  // When: Creating PO with explicit warehouse_id wh2
  const po2 = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId, quantity: 12, purchase_cost: 500 }]
  });
  // Then: Saved as wh2
  assert.equal(po2.order.warehouse_id, wh2.id);

  // When: Updating PO header warehouse on draft PO (P-02)
  const updatedPo2 = await invoke('update_purchase_order_header', {
    order_id: po2.order.id,
    warehouse_id: wh1.id
  });
  // Then: Updated to wh1
  assert.equal(updatedPo2.order.warehouse_id, wh1.id);

  // When: Submitting and receiving PO into wh1 (P-03)
  await invoke('submit_purchase_order', { order_id: updatedPo2.order.id });
  const receivedPo = await invoke('confirm_purchase_order_received', { order_id: updatedPo2.order.id });
  assert.equal(receivedPo.order.status, 'received');

  // Then: Inventory movement has warehouse_id = wh1.id
  const movements = await invoke('list_inventory_movements', { unit_id: unitId });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].warehouse_id, wh1.id);
  assert.equal(movements[0].quantity_delta, 12);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-OB-N-01 & E-01 & INV-N-01: Multi-warehouse opening balance and inventory levels partition', async () => {
  // Given: Tenant with wh1 and wh2, product with base unit
  const tid = `tnt_ob_dim_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'W1', name: '一倉' });
  const wh2 = await invoke('create_warehouse', { code: 'W2', name: '二倉' });
  const prod = await invoke('create_product', { name: `開帳商品_${Date.now()}`, category: 'resale', unit_name: '箱' });
  const unitId = prod.units[0].id;

  // When: Recording opening balance in wh1 (quantity: 30)
  const mov1 = await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 30,
    unit_cost: 120,
    warehouse_id: wh1.id
  });
  assert.equal(mov1.warehouse_id, wh1.id);
  assert.equal(mov1.quantity_delta, 30);

  // When: Recording opening balance in wh2 for same unit (quantity: 50) (Rule O-01)
  const mov2 = await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 50,
    unit_cost: 120,
    warehouse_id: wh2.id
  });
  assert.equal(mov2.warehouse_id, wh2.id);
  assert.equal(mov2.quantity_delta, 50);

  // When & Then: Attempting duplicate opening balance in wh2 rejected with exact rule O-01 message
  await assert.rejects(
    async () => {
      await invoke('record_opening_inventory_balance', {
        unit_id: unitId,
        quantity_delta: 10,
        unit_cost: 120,
        warehouse_id: wh2.id
      });
    },
    /此商品單位在〔二倉〕已開帳，數量更正請用庫存調整（原因：期初更正）/
  );

  // When: Querying level for wh1
  const levelWh1 = await invoke('get_inventory_level', { unit_id: unitId, warehouse_id: wh1.id });
  // Then: Quantity is 30 and warehouse_id is wh1.id
  assert.equal(levelWh1.current_quantity, 30);
  assert.equal(levelWh1.warehouse_id, wh1.id);

  // When: Querying level for wh2
  const levelWh2 = await invoke('get_inventory_level', { unit_id: unitId, warehouse_id: wh2.id });
  // Then: Quantity is 50 and warehouse_id is wh2.id
  assert.equal(levelWh2.current_quantity, 50);
  assert.equal(levelWh2.warehouse_id, wh2.id);

  // When: Querying all-warehouse level (warehouse_id omitted)
  const levelAll = await invoke('get_inventory_level', { unit_id: unitId });
  // Then: Quantity is aggregate sum (30 + 50 = 80) and warehouse_id is null
  assert.equal(levelAll.current_quantity, 80);
  assert.equal(levelAll.warehouse_id, null);

  // Teardown
  await switchTenant('tnt_mock_1');
});

test('TC-179-INV-ORDER: list_inventory_movements returns movements sorted oldest-first (created_at ASC)', async () => {
  // Given: Tenant with warehouse and two products
  const tid = `tnt_order_${Date.now()}`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'SORT', name: '排序倉' });
  const prodA = await invoke('create_product', { name: `A品_${Date.now()}`, category: 'resale', unit_name: '件' });
  const prodB = await invoke('create_product', { name: `B品_${Date.now()}`, category: 'resale', unit_name: '件' });

  // When: Creating two opening movements sequentially
  await invoke('record_opening_inventory_balance', {
    unit_id: prodA.units[0].id,
    quantity_delta: 10,
    unit_cost: 100,
    warehouse_id: wh.id
  });
  await invoke('record_opening_inventory_balance', {
    unit_id: prodB.units[0].id,
    quantity_delta: 20,
    unit_cost: 200,
    warehouse_id: wh.id
  });

  // Then: list_inventory_movements returns movements in chronological order (created_at ASC)
  const movs = await invoke('list_inventory_movements');
  assert.equal(movs.length, 2);
  assert.ok(movs[0].created_at <= movs[1].created_at);
  assert.equal(movs[0].unit_id, prodA.units[0].id);
  assert.equal(movs[1].unit_id, prodB.units[0].id);

  // Teardown
  await switchTenant('tnt_mock_1');
});
