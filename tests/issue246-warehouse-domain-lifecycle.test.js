/**
 * Issue #246: Warehouse Management Modularization End-to-End Lifecycle & S-07 Guard Test
 *
 * Test Perspectives Table:
 * | Case ID     | Input / Precondition                                      | Perspective (Equivalence / Boundary) | Expected Result                                                          | Notes                                  |
 * |-------------|-----------------------------------------------------------|---------------------------------------|--------------------------------------------------------------------------|----------------------------------------|
 * | TC-WDL-N-01 | Create WHs -> Adj post (+20) -> Transfer post (5) -> STK | Equivalence - Normal Lifecycle        | All steps succeed, WH2 qty is 6, WH1 qty is 15                          | Complete multi-domain lifecycle       |
 * | TC-WDL-E-01 | Movement occurs in WH2 after STK snapshot (S-07)          | Boundary / Error - Concurrent guard   | Post rejected with S-07 error message detailing affected items           | S-07 conflict interception             |
 * | TC-WDL-N-02 | Refresh system qty after S-07 conflict, recount, post     | Equivalence - Recovery (S-08)         | Refreshes system qty, clears counted_quantity, reposts successfully      | S-08 recovery flow                     |
 * | TC-WDL-E-02 | Post STK with un-entered lines (counted_quantity is NULL) | Boundary - NULL counted quantity      | Post rejected with "尚有 1 項未輸入實盤量"                                 | S-07 missing input guard               |
 * | TC-WDL-E-03 | Inventory adjustment delta causes negative stock balance  | Boundary - Negative stock (< 0)       | Adjustment post rejected with formatted negative stock message           | Negative stock protection              |
 * | TC-WDL-N-03 | Component and mock module exports resolution              | Equivalence - Modular integration     | All 4 domain modules export {mocks, store, Workspace} with compatibility | Modular structure verification         |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 runes for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}
if (typeof globalThis.$derived === 'undefined') {
  globalThis.$derived = (fn) => (typeof fn === 'function' ? fn() : fn);
}

const { invoke } = await import('../src/lib/tauri.js');

// Import domain stores to verify re-exports and module definitions
const warehousesStore = await import('../src/lib/warehouses/store.js');
const inventoryAdjustmentsStore = await import('../src/lib/inventoryAdjustments/store.js');
const stockTransfersStore = await import('../src/lib/stockTransfers/store.js');
const stocktakesStore = await import('../src/lib/stocktakes/store.js');

async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

test('TC-WDL-N-03: Modular exports and store functions availability', () => {
  // Given: Four domain stores
  // When: Checking required actions and symbols
  // Then: All modules export expected functions
  assert.equal(typeof warehousesStore.fetchWarehouses, 'function');
  assert.equal(typeof warehousesStore.createWarehouseAction, 'function');

  assert.equal(typeof inventoryAdjustmentsStore.fetchInventoryAdjustments, 'function');
  assert.equal(typeof inventoryAdjustmentsStore.createInventoryAdjustmentAction, 'function');

  assert.equal(typeof stockTransfersStore.fetchStockTransfers, 'function');
  assert.equal(typeof stockTransfersStore.createStockTransferAction, 'function');

  assert.equal(typeof stocktakesStore.fetchStocktakes, 'function');
  assert.equal(typeof stocktakesStore.createStocktakeAction, 'function');
  assert.equal(typeof stocktakesStore.isStocktakeLineCounted, 'function');
});

test('TC-WDL-N-01: End-to-end lifecycle: Create WH -> Adjust -> Transfer -> Stocktake lifecycle', async () => {
  // Given: Unique tenant and product
  const tid = `tnt_wdl_${Date.now()}_01`;
  await switchTenant(tid);

  const product = await invoke('create_product', {
    name: `測試商品_${Date.now()}`,
    category: 'resale',
    unit_name: '件'
  });
  const unitId = product.units[0].id;

  // 1. Create two warehouses (主倉 WH1, 門市倉 WH2)
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '台北總倉' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '台中門市倉' });
  assert.equal(wh1.code, 'WH1');
  assert.equal(wh2.code, 'WH2');

  // 2. Inventory Adjustment: Stock in +20 to WH1
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh1.id,
    reason_code: 'opening_correction',
    note: '期初入庫'
  });
  await invoke('add_inventory_adjustment_line', {
    adjustment_id: adj.adjustment.id,
    unit_id: unitId,
    quantity_delta: 20.0
  });
  const postedAdj = await invoke('post_inventory_adjustment', {
    adjustment_id: adj.adjustment.id
  });
  assert.equal(postedAdj.adjustment.status, 'posted');

  const lvl1AfterAdj = await invoke('get_inventory_level', {
    unit_id: unitId,
    warehouse_id: wh1.id
  });
  assert.equal(lvl1AfterAdj.current_quantity, 20.0);

  // 3. Stock Transfer: Transfer 5 units from WH1 to WH2
  const transfer = await invoke('create_stock_transfer', {
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    note: '門市撥補'
  });
  await invoke('add_stock_transfer_line', {
    transfer_id: transfer.transfer.id,
    unit_id: unitId,
    quantity: 5.0
  });
  const postedTransfer = await invoke('post_stock_transfer', {
    transfer_id: transfer.transfer.id
  });
  assert.equal(postedTransfer.transfer.status, 'posted');

  const lvl1AfterTransfer = await invoke('get_inventory_level', {
    unit_id: unitId,
    warehouse_id: wh1.id
  });
  const lvl2AfterTransfer = await invoke('get_inventory_level', {
    unit_id: unitId,
    warehouse_id: wh2.id
  });
  assert.equal(lvl1AfterTransfer.current_quantity, 15.0);
  assert.equal(lvl2AfterTransfer.current_quantity, 5.0);

  // 4. Stocktake: Create stocktake for WH2 with unit
  const stk = await invoke('create_stocktake', {
    warehouse_id: wh2.id,
    initial_unit_ids: [unitId],
    note: '例行盤點'
  });
  assert.equal(stk.stocktake.status, 'draft');
  assert.equal(stk.lines[0].system_quantity, null);

  // 5. Start counting
  const counting = await invoke('start_stocktake_counting', {
    stocktake_id: stk.stocktake.id
  });
  assert.equal(counting.stocktake.status, 'counting');
  assert.equal(counting.lines[0].system_quantity, 5.0);

  // 6. Enter counted quantity (6.0 - 盤盈 1 件)
  const lineId = counting.lines[0].id;
  await invoke('set_stocktake_counted_quantity', {
    line_id: lineId,
    counted_quantity: 6.0
  });

  // 7. Post stocktake
  const postedStk = await invoke('post_stocktake', {
    stocktake_id: stk.stocktake.id
  });
  assert.equal(postedStk.stocktake.status, 'posted');

  // Verify final inventory levels
  const lvl2Final = await invoke('get_inventory_level', {
    unit_id: unitId,
    warehouse_id: wh2.id
  });
  const lvl1Final = await invoke('get_inventory_level', {
    unit_id: unitId,
    warehouse_id: wh1.id
  });
  assert.equal(lvl2Final.current_quantity, 6.0);
  assert.equal(lvl1Final.current_quantity, 15.0);
});

test('TC-WDL-E-01 & TC-WDL-N-02: S-07 concurrent movement defense and S-08 refresh recovery', async () => {
  // Given: Warehouse WH, product with 10 units
  const tid = `tnt_wdl_${Date.now()}_02`;
  await switchTenant(tid);

  const product = await invoke('create_product', {
    name: `S07防呆品項_${Date.now()}`,
    category: 'resale',
    unit_name: '件'
  });
  const unitId = product.units[0].id;
  const wh = await invoke('create_warehouse', { code: 'WH_GUARD', name: '防呆測試倉' });

  // Record opening balance 10.0
  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity_delta: 10.0,
    unit_cost: 50.0
  });

  // Create stocktake and start counting
  const stk = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [unitId]
  });
  const counting = await invoke('start_stocktake_counting', {
    stocktake_id: stk.stocktake.id
  });
  const lineId = counting.lines[0].id;

  // Enter counted quantity
  await invoke('set_stocktake_counted_quantity', {
    line_id: lineId,
    counted_quantity: 10.0
  });

  // When: Concurrently a movement occurs after snapshot (simulate snapAt in past)
  const snapAt = counting.lines[0].system_quantity_at;
  await invoke('set_mock_stocktake_line_snap_at', {
    line_id: lineId,
    system_quantity_at: snapAt - 500
  });

  // Another inventory movement occurs in WH (+3.0 units)
  const adjConcurrent = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    note: '盤點中途發現'
  });
  await invoke('add_inventory_adjustment_line', {
    adjustment_id: adjConcurrent.adjustment.id,
    unit_id: unitId,
    quantity_delta: 3.0
  });
  await invoke('post_inventory_adjustment', {
    adjustment_id: adjConcurrent.adjustment.id
  });

  // Then (TC-WDL-E-01): Post stocktake is rejected with S-07 error
  await assert.rejects(
    async () => {
      await invoke('post_stocktake', { stocktake_id: stk.stocktake.id });
    },
    /以下品項在盤點期間有異動：.*請重新取得系統量/
  );

  // When (TC-WDL-N-02): Perform S-08 refresh
  const refreshed = await invoke('refresh_stocktake_system_quantity', {
    stocktake_id: stk.stocktake.id,
    line_ids: [lineId]
  });

  // Then: System quantity is updated to 13 (10 + 3), and counted_quantity is reset to null
  assert.equal(refreshed.lines[0].system_quantity, 13.0);
  assert.equal(refreshed.lines[0].counted_quantity, null);

  // Recount with new actual count 13.0
  await invoke('set_stocktake_counted_quantity', {
    line_id: lineId,
    counted_quantity: 13.0
  });

  // Then: Post succeeds
  const posted = await invoke('post_stocktake', {
    stocktake_id: stk.stocktake.id
  });
  assert.equal(posted.stocktake.status, 'posted');

  const lvlFinal = await invoke('get_inventory_level', {
    unit_id: unitId,
    warehouse_id: wh.id
  });
  assert.equal(lvlFinal.current_quantity, 13.0);
});

test('TC-WDL-E-02: Missing counted quantity guard (NULL boundary)', async () => {
  // Given: Stocktake in counting state with 2 lines, only 1 filled
  const tid = `tnt_wdl_${Date.now()}_03`;
  await switchTenant(tid);

  const wh = await invoke('create_warehouse', { code: 'WH_NULL', name: '空值測試倉' });
  const p1 = await invoke('create_product', { name: '品項1', category: 'resale', unit_name: '件' });
  const p2 = await invoke('create_product', { name: '品項2', category: 'resale', unit_name: '件' });

  const stk = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [p1.units[0].id, p2.units[0].id]
  });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: stk.stocktake.id });

  // Only fill first line
  await invoke('set_stocktake_counted_quantity', {
    line_id: counting.lines[0].id,
    counted_quantity: 5.0
  });

  // When: Attempting to post with 1 uncounted line
  // Then: Rejection with missing count message
  await assert.rejects(
    async () => {
      await invoke('post_stocktake', { stocktake_id: stk.stocktake.id });
    },
    /尚有 1 項未輸入實盤量/
  );
});

test('TC-WDL-E-03: Negative stock boundary rejected on inventory adjustment post', async () => {
  // Given: Warehouse with 5 units
  const tid = `tnt_wdl_${Date.now()}_04`;
  await switchTenant(tid);

  const wh = await invoke('create_warehouse', { code: 'WH_NEG', name: '負庫存測試倉' });
  const p = await invoke('create_product', { name: '品項N', category: 'resale', unit_name: '件' });
  const unitId = p.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity_delta: 5.0,
    unit_cost: 10.0
  });

  // When: Adjustment attempts to reduce by 5.01 (result -0.01)
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage',
    note: '損壞扣減過量'
  });
  await invoke('add_inventory_adjustment_line', {
    adjustment_id: adj.adjustment.id,
    unit_id: unitId,
    quantity_delta: -5.01
  });

  // Then: Post rejected due to negative balance boundary
  await assert.rejects(
    async () => {
      await invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id });
    },
    /調整後將為.*負數.*無法過帳/
  );
});
