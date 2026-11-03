import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

/**
 * Test Perspective Table (Issue #181 - Stocktakes Core Business Logic)
 *
 * | Case ID | Perspective | Description |
 * |---|---|---|
 * | TC-STK-N-01 | Equivalence | Create draft stocktake |
 * | TC-STK-N-02 | Equivalence | Add lines with snapshots and sequence |
 * | TC-STK-N-03 | Equivalence | One-click add lines from stock (S-04) |
 * | TC-STK-N-04 | Equivalence | Update header (warehouse and note) |
 * | TC-STK-N-05 | Equivalence | Remove line and resequence line_no |
 * | TC-STK-N-06 | Equivalence | Start counting and snapshot system_quantity (S-05) |
 * | TC-STK-N-07 | Equivalence | Set counted quantity (S-06) |
 * | TC-STK-N-08 | Equivalence | Remove line in counting state |
 * | TC-STK-N-09 | Equivalence | Post stocktake: gain (+), loss (-), match (0) |
 * | TC-STK-N-10 | Equivalence | S-07 movement detection and S-08 refresh |
 * | TC-STK-N-11 | Equivalence | Cancel draft stocktake |
 * | TC-STK-N-12 | Equivalence | Cancel counting stocktake |
 * | TC-STK-N-13 | Boundary | Counted quantity = 0 |
 * | TC-STK-N-14 | Boundary | Different warehouse counting independence (S-05) |
 * | TC-STK-N-15 | Equivalence | Warehouse with closed stocktake can be deactivated |
 * | TC-STK-N-16 | Equivalence | Non-purchasable product counted and posted |
 * | TC-STK-E-01 | Boundary | Empty tenant ID |
 * | TC-STK-E-02 | Boundary | Non-existent warehouse ID |
 * | TC-STK-E-03 | Error | Deactivated warehouse ID |
 * | TC-STK-E-04 | Error | Cross-tenant / non-existent unit ID |
 * | TC-STK-E-05 | Error | Duplicate unit in same stocktake |
 * | TC-STK-E-06 | Boundary | Start counting with 0 lines |
 * | TC-STK-E-07 | Error | Same warehouse same unit S-05 mutual exclusion |
 * | TC-STK-E-08 | Error | Set counted quantity in draft state |
 * | TC-STK-E-09 | Boundary | Negative counted quantity (-1, -0.01) |
 * | TC-STK-E-10 | Error | Add line in counting state |
 * | TC-STK-E-11 | Error | Update warehouse in counting state |
 * | TC-STK-E-12 | Boundary | Post with NULL counted quantity |
 * | TC-STK-E-14 | Boundary | Movement in other warehouse does not block post |
 * | TC-STK-E-15 | Idempotency | Double post rejected |
 * | TC-STK-E-16 | Error | Cancel posted stocktake rejected |
 * | TC-STK-E-17 | Error | Post cancelled stocktake rejected |
 * | TC-STK-E-18 | Error | Delete line on posted stocktake rejected |
 * | TC-STK-E-19 | Error | W-03 extension: Deactivate warehouse blocked by draft/counting stocktake |
 * | TC-STK-E-20 | Isolation | Cross-tenant access rejected |
 */

async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

test('TC-STK-N-01: Create draft stocktake', async () => {
  // Given: Active tenant and active warehouse
  const tid = `tnt_stk_${Date.now()}_1`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });

  // When: Creating draft stocktake
  const detail = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    note: '首次定期盤點'
  });

  // Then: Stocktake created in draft status with STK-00001
  assert.ok(detail.stocktake.id.startsWith('stk_'));
  assert.equal(detail.stocktake.stocktake_number, 'STK-00001');
  assert.equal(detail.stocktake.status, 'draft');
  assert.equal(detail.stocktake.warehouse_id, wh.id);
  assert.equal(detail.stocktake.note, '首次定期盤點');
  assert.equal(detail.lines.length, 0);
});

test('TC-STK-N-02: Add lines with snapshots and sequence', async () => {
  // Given: Warehouse and two products
  const tid = `tnt_stk_${Date.now()}_2`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prodA = await invoke('create_product', { name: '品項A', category: 'resale', unit_name: '件' });
  const prodB = await invoke('create_product', { name: '品項B', category: 'resale', unit_name: '箱' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id });

  // When: Adding lines
  const updated = await invoke('add_stocktake_lines', {
    stocktake_id: detail.stocktake.id,
    unit_ids: [prodA.units[0].id, prodB.units[0].id]
  });

  // Then: Lines added with snapshot and line_no
  assert.equal(updated.lines.length, 2);
  assert.equal(updated.lines[0].line_no, 1);
  assert.equal(updated.lines[0].unit_id, prodA.units[0].id);
  assert.equal(updated.lines[0].product_name_snapshot, '品項A');
  assert.equal(updated.lines[0].system_quantity, null);
  assert.equal(updated.lines[0].counted_quantity, null);

  assert.equal(updated.lines[1].line_no, 2);
  assert.equal(updated.lines[1].unit_id, prodB.units[0].id);
  assert.equal(updated.lines[1].product_name_snapshot, '品項B');
});

test('TC-STK-N-03: Add lines from active stock (S-04)', async () => {
  // Given: Warehouse with stock for unitA and unitB, but 0 for unitC
  const tid = `tnt_stk_${Date.now()}_3`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prodA = await invoke('create_product', { name: '品項A', category: 'resale', unit_name: '件' });
  const prodB = await invoke('create_product', { name: '品項B', category: 'resale', unit_name: '個' });
  const prodC = await invoke('create_product', { name: '品項C', category: 'resale', unit_name: '支' });

  await invoke('record_opening_inventory_balance', {
    unit_id: prodA.units[0].id,
    warehouse_id: wh.id,
    quantity_delta: 10.0,
    unit_cost: 5.0
  });
  await invoke('record_opening_inventory_balance', {
    unit_id: prodB.units[0].id,
    warehouse_id: wh.id,
    quantity_delta: 5.0,
    unit_cost: 2.0
  });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id });

  // When: Adding from stock
  const updated = await invoke('add_stocktake_lines_from_stock', {
    stocktake_id: detail.stocktake.id
  });

  // Then: Exactly unitA and unitB brought in, unitC excluded
  assert.equal(updated.lines.length, 2);
  const uids = updated.lines.map(l => l.unit_id);
  assert.ok(uids.includes(prodA.units[0].id));
  assert.ok(uids.includes(prodB.units[0].id));
  assert.ok(!uids.includes(prodC.units[0].id));
});

test('TC-STK-N-04: Update header (warehouse and note)', async () => {
  // Given: Draft stocktake with WH1
  const tid = `tnt_stk_${Date.now()}_4`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉2' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh1.id, note: '舊備註' });

  // When: Updating to WH2 and new note
  const updated = await invoke('update_stocktake_header', {
    stocktake_id: detail.stocktake.id,
    warehouse_id: wh2.id,
    note: '新備註'
  });

  // Then: Header updated
  assert.equal(updated.stocktake.warehouse_id, wh2.id);
  assert.equal(updated.stocktake.note, '新備註');

  // When: Clearing note with null
  const cleared = await invoke('update_stocktake_header', {
    stocktake_id: detail.stocktake.id,
    note: null
  });

  // Then: Note is cleared to null
  assert.equal(cleared.stocktake.note, null);
});

test('TC-STK-N-05: Remove line and resequence line_no', async () => {
  // Given: Draft stocktake with 3 lines
  const tid = `tnt_stk_${Date.now()}_5`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });
  const pB = await invoke('create_product', { name: 'B', category: 'resale', unit_name: '件' });
  const pC = await invoke('create_product', { name: 'C', category: 'resale', unit_name: '件' });

  const detail = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [pA.units[0].id, pB.units[0].id, pC.units[0].id]
  });

  const line2Id = detail.lines[1].id;

  // When: Removing line 2
  const updated = await invoke('remove_stocktake_line', { line_id: line2Id });

  // Then: Remaining 2 lines are resequenced to 1 and 2
  assert.equal(updated.lines.length, 2);
  assert.equal(updated.lines[0].line_no, 1);
  assert.equal(updated.lines[1].line_no, 2);
});

test('TC-STK-N-06: Start counting and snapshot system_quantity (S-05)', async () => {
  // Given: Active warehouse with unit balance 20
  const tid = `tnt_stk_${Date.now()}_6`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  await invoke('record_opening_inventory_balance', {
    unit_id: pA.units[0].id,
    warehouse_id: wh.id,
    quantity_delta: 20.0,
    unit_cost: 10.0
  });

  const detail = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [pA.units[0].id]
  });

  // When: Starting counting
  const updated = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });

  // Then: Status transitions to counting, system_quantity is 20, counted_quantity is null
  assert.equal(updated.stocktake.status, 'counting');
  assert.ok(updated.stocktake.counting_started_at > 0);
  assert.equal(updated.lines[0].system_quantity, 20.0);
  assert.ok(updated.lines[0].system_quantity_at > 0);
  assert.equal(updated.lines[0].counted_quantity, null);
});

test('TC-STK-N-07 & 08: Set counted quantity and remove line in counting', async () => {
  // Given: Stocktake in counting state with 2 lines
  const tid = `tnt_stk_${Date.now()}_7`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });
  const pB = await invoke('create_product', { name: 'B', category: 'resale', unit_name: '件' });

  const detail = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [pA.units[0].id, pB.units[0].id]
  });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });

  // When: Setting counted quantity on line 1 (TC-STK-N-07)
  const afterSet = await invoke('set_stocktake_counted_quantity', {
    line_id: counting.lines[0].id,
    counted_quantity: 18.0
  });
  assert.equal(afterSet.counted_quantity, 18.0);

  // When: Removing line 2 in counting state (TC-STK-N-08)
  const afterRemove = await invoke('remove_stocktake_line', { line_id: counting.lines[1].id });
  assert.equal(afterRemove.lines.length, 1);
  assert.equal(afterRemove.lines[0].counted_quantity, 18.0);
});

test('TC-STK-N-09: Post stocktake: gain (+), loss (-), match (0)', async () => {
  // Given: 3 lines in counting state
  const tid = `tnt_stk_${Date.now()}_9`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });
  const pB = await invoke('create_product', { name: 'B', category: 'resale', unit_name: '件' });
  const pC = await invoke('create_product', { name: 'C', category: 'resale', unit_name: '件' });

  await invoke('record_opening_inventory_balance', { unit_id: pA.units[0].id, warehouse_id: wh.id, quantity_delta: 10.0, unit_cost: 10.0 });
  await invoke('record_opening_inventory_balance', { unit_id: pB.units[0].id, warehouse_id: wh.id, quantity_delta: 10.0, unit_cost: 10.0 });
  await invoke('record_opening_inventory_balance', { unit_id: pC.units[0].id, warehouse_id: wh.id, quantity_delta: 10.0, unit_cost: 10.0 });

  const detail = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [pA.units[0].id, pB.units[0].id, pC.units[0].id]
  });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });

  // unitA: sys=10, counted=15 (gain +5)
  // unitB: sys=10, counted=8  (loss -2)
  // unitC: sys=10, counted=10 (match 0)
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[0].id, counted_quantity: 15.0 });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[1].id, counted_quantity: 8.0 });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[2].id, counted_quantity: 10.0 });

  // When: Posting stocktake
  const posted = await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });

  // Then: Status is posted
  assert.equal(posted.stocktake.status, 'posted');
  assert.ok(posted.stocktake.posted_at > 0);

  // Then: Ledger balances equal counted quantities
  const lvlA = await invoke('get_inventory_level', { unit_id: pA.units[0].id, warehouse_id: wh.id });
  assert.equal(lvlA.current_quantity, 15.0);

  const lvlB = await invoke('get_inventory_level', { unit_id: pB.units[0].id, warehouse_id: wh.id });
  assert.equal(lvlB.current_quantity, 8.0);

  const lvlC = await invoke('get_inventory_level', { unit_id: pC.units[0].id, warehouse_id: wh.id });
  assert.equal(lvlC.current_quantity, 10.0);
});

test('TC-STK-N-10 & E-13: S-07 movement detection and S-08 refresh', async () => {
  // Given: Stocktake in counting state
  const tid = `tnt_stk_${Date.now()}_10`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: '品項A', category: 'resale', unit_name: '件' });

  await invoke('record_opening_inventory_balance', { unit_id: pA.units[0].id, warehouse_id: wh.id, quantity_delta: 10.0, unit_cost: 10.0 });

  const detail = await invoke('create_stocktake', {
    warehouse_id: wh.id,
    initial_unit_ids: [pA.units[0].id]
  });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  const lineId = counting.lines[0].id;
  await invoke('set_stocktake_counted_quantity', { line_id: lineId, counted_quantity: 12.0 });

  // Simulate snapshot was taken earlier so subsequent movement has created_at > snapshot
  const snapAt = counting.lines[0].system_quantity_at;
  await invoke('set_mock_stocktake_line_snap_at', { line_id: lineId, system_quantity_at: snapAt - 100 });
  // Inject mock movement after snapAt
  const vendor = await invoke('create_partner', { name: `V_${Date.now()}_${Math.random()}`, is_vendor: true });
  const po = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    warehouse_id: wh.id,
    initial_lines: [{ unit_id: pA.units[0].id, quantity: 5.0, purchase_cost: 10.0 }]
  });
  await invoke('submit_purchase_order', { order_id: po.order.id });
  await invoke('confirm_purchase_order_received', {
    order_id: po.order.id,
    line_received_quantities: [{ line_id: po.lines[0].id, received_quantity: 5.0 }]
  });

  // When: Attempting to post stocktake (TC-STK-E-13)
  await assert.rejects(
    async () => {
      await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });
    },
    /以下品項在盤點期間有異動：〔品項A.*請重新取得系統量/
  );

  // When: S-08: Calling refresh_stocktake_system_quantity
  const refreshed = await invoke('refresh_stocktake_system_quantity', {
    stocktake_id: detail.stocktake.id,
    line_ids: [lineId]
  });

  // Then: system_quantity updated to 15 (10 + 5), and counted_quantity is cleared to null
  assert.equal(refreshed.lines[0].system_quantity, 15.0);
  assert.equal(refreshed.lines[0].counted_quantity, null);

  // When: Re-entering counted quantity and posting
  await invoke('set_stocktake_counted_quantity', { line_id: lineId, counted_quantity: 15.0 });
  const posted = await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });

  // Then: Post succeeds
  assert.equal(posted.stocktake.status, 'posted');
});

test('TC-STK-N-11 & 12: Cancel draft and counting stocktake', async () => {
  // Given: Draft and counting stocktakes
  const tid = `tnt_stk_${Date.now()}_11`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  // When: Cancelling draft (N-11)
  const stk1 = await invoke('create_stocktake', { warehouse_id: wh.id });
  const c1 = await invoke('cancel_stocktake', { stocktake_id: stk1.stocktake.id });
  assert.equal(c1.stocktake.status, 'cancelled');

  // When: Cancelling counting (N-12)
  const stk2 = await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pA.units[0].id] });
  await invoke('start_stocktake_counting', { stocktake_id: stk2.stocktake.id });
  const c2 = await invoke('cancel_stocktake', { stocktake_id: stk2.stocktake.id });
  assert.equal(c2.stocktake.status, 'cancelled');
});

test('TC-STK-N-13: Counted quantity = 0 boundary', async () => {
  // Given: Stock 10, counted 0
  const tid = `tnt_stk_${Date.now()}_13`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });
  await invoke('record_opening_inventory_balance', { unit_id: pA.units[0].id, warehouse_id: wh.id, quantity_delta: 10.0, unit_cost: 10.0 });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pA.units[0].id] });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[0].id, counted_quantity: 0.0 });

  // When: Posting stocktake
  const posted = await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });
  assert.equal(posted.stocktake.status, 'posted');

  // Then: Final balance is exactly 0
  const lvl = await invoke('get_inventory_level', { unit_id: pA.units[0].id, warehouse_id: wh.id });
  assert.equal(lvl.current_quantity, 0.0);
});

test('TC-STK-N-14 & E-07: S-05 mutual exclusion vs cross-warehouse independence', async () => {
  // Given: Two warehouses WH1 and WH2
  const tid = `tnt_stk_${Date.now()}_14`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉2' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  // STK1 in WH1 counting
  const stk1 = await invoke('create_stocktake', { warehouse_id: wh1.id, initial_unit_ids: [pA.units[0].id] });
  await invoke('start_stocktake_counting', { stocktake_id: stk1.stocktake.id });

  // When: STK2 in DIFFERENT warehouse WH2 counting (TC-STK-N-14)
  const stk2 = await invoke('create_stocktake', { warehouse_id: wh2.id, initial_unit_ids: [pA.units[0].id] });
  const counting2 = await invoke('start_stocktake_counting', { stocktake_id: stk2.stocktake.id });
  assert.equal(counting2.stocktake.status, 'counting');

  // When: STK3 in SAME warehouse WH1 tries to start counting (TC-STK-E-07)
  const stk3 = await invoke('create_stocktake', { warehouse_id: wh1.id, initial_unit_ids: [pA.units[0].id] });
  await assert.rejects(
    async () => {
      await invoke('start_stocktake_counting', { stocktake_id: stk3.stocktake.id });
    },
    /已在盤點單 STK-00001 盤點中/
  );
});

test('TC-STK-N-15 & E-19: W-03 extension: Deactivate warehouse blocked by draft/counting', async () => {
  // Given: Warehouse with draft stocktake
  const tid = `tnt_stk_${Date.now()}_15`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉2' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh2.id });

  // When: Attempting to deactivate WH2 (TC-STK-E-19)
  await assert.rejects(
    async () => {
      await invoke('deactivate_warehouse', { id: wh2.id });
    },
    new RegExp(`此倉仍被未結案單據引用：${detail.stocktake.stocktake_number}`)
  );

  // When: Cancelling stocktake
  await invoke('cancel_stocktake', { stocktake_id: detail.stocktake.id });

  // When: Deactivating WH2 (TC-STK-N-15)
  const deactivated = await invoke('deactivate_warehouse', { id: wh2.id });
  assert.equal(deactivated.is_active, false);
});

test('TC-STK-N-16: Non-purchasable product counted and posted', async () => {
  // Given: Manufactured product
  const tid = `tnt_stk_${Date.now()}_16`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pM = await invoke('create_product', { name: '自製成品', category: 'manufactured', unit_name: '件' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pM.units[0].id] });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[0].id, counted_quantity: 8.0 });
  const posted = await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });

  assert.equal(posted.stocktake.status, 'posted');
  const lvl = await invoke('get_inventory_level', { unit_id: pM.units[0].id, warehouse_id: wh.id });
  assert.equal(lvl.current_quantity, 8.0);
});

test('TC-STK-E-01: Empty tenant ID rejected', async () => {
  // Given: Empty tenant ID
  await switchTenant('');

  // When: Creating stocktake
  await assert.rejects(
    async () => {
      await invoke('create_stocktake', { warehouse_id: 'wh_1' });
    },
    /Tenant ID cannot be empty/
  );
});

test('TC-STK-E-02 & 03: Non-existent or deactivated warehouse', async () => {
  // Given: Active and deactivated warehouse
  const tid = `tnt_stk_${Date.now()}_e02`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉2' });
  await invoke('deactivate_warehouse', { id: wh2.id });

  // When: Non-existent warehouse (E-02)
  await assert.rejects(
    async () => {
      await invoke('create_stocktake', { warehouse_id: 'wh_nonexistent' });
    },
    /找不到倉別或倉別已停用/
  );

  // When: Deactivated warehouse (E-03)
  await assert.rejects(
    async () => {
      await invoke('create_stocktake', { warehouse_id: wh2.id });
    },
    /找不到倉別或倉別已停用/
  );
});

test('TC-STK-E-04 & 05: Unit validation errors', async () => {
  // Given: Warehouse and product
  const tid = `tnt_stk_${Date.now()}_e04`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  // When: Non-existent unit ID (E-04)
  await assert.rejects(
    async () => {
      await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: ['unit_nonexistent'] });
    },
    /找不到指定的商品單位/
  );

  // When: Duplicate unit in same stocktake (E-05)
  await assert.rejects(
    async () => {
      await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pA.units[0].id, pA.units[0].id] });
    },
    /此品項已在盤點單中/
  );
});

test('TC-STK-E-06: Start counting with empty lines rejected', async () => {
  // Given: Draft stocktake with 0 lines
  const tid = `tnt_stk_${Date.now()}_e06`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const detail = await invoke('create_stocktake', { warehouse_id: wh.id });

  // When: Starting counting
  await assert.rejects(
    async () => {
      await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
    },
    /盤點單沒有任何品項/
  );
});

test('TC-STK-E-08 & 09: Counted quantity validations', async () => {
  // Given: Draft stocktake and counting stocktake
  const tid = `tnt_stk_${Date.now()}_e08`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pA.units[0].id] });
  const lineId = detail.lines[0].id;

  // When: Setting counted quantity in draft (E-08)
  await assert.rejects(
    async () => {
      await invoke('set_stocktake_counted_quantity', { line_id: lineId, counted_quantity: 10.0 });
    },
    /只有盤點中 \(counting\) 狀態可輸入實盤量/
  );

  // When: Negative counted quantity in counting (E-09)
  await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  await assert.rejects(
    async () => {
      await invoke('set_stocktake_counted_quantity', { line_id: lineId, counted_quantity: -1.0 });
    },
    /實盤量不可為負/
  );

  // When: NaN counted quantity in counting
  await assert.rejects(
    async () => {
      await invoke('set_stocktake_counted_quantity', { line_id: lineId, counted_quantity: NaN });
    },
    /實盤量不可為負/
  );
});

test('TC-STK-E-10 & 11: Counting state restrictions', async () => {
  // Given: Stocktake in counting state
  const tid = `tnt_stk_${Date.now()}_e10`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉2' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });
  const pB = await invoke('create_product', { name: 'B', category: 'resale', unit_name: '件' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh1.id, initial_unit_ids: [pA.units[0].id] });
  await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });

  // When: Adding line in counting state (E-10)
  await assert.rejects(
    async () => {
      await invoke('add_stocktake_lines', { stocktake_id: detail.stocktake.id, unit_ids: [pB.units[0].id] });
    },
    /盤點單狀態為 counting，僅草稿狀態可新增品項/
  );

  // When: Updating header in counting state (E-11)
  await assert.rejects(
    async () => {
      await invoke('update_stocktake_header', { stocktake_id: detail.stocktake.id, warehouse_id: wh2.id });
    },
    /盤點單狀態為 counting，僅草稿狀態可修改表頭/
  );
});

test('TC-STK-E-12: Post with missing counted quantity rejected', async () => {
  // Given: Counting stocktake with 2 lines, only 1 counted
  const tid = `tnt_stk_${Date.now()}_e12`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });
  const pB = await invoke('create_product', { name: 'B', category: 'resale', unit_name: '件' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pA.units[0].id, pB.units[0].id] });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[0].id, counted_quantity: 10.0 });

  // When: Posting with line 2 uncounted
  await assert.rejects(
    async () => {
      await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });
    },
    /尚有 1 項未輸入實盤量/
  );
});

test('TC-STK-E-14: Movement in other warehouse does not block post', async () => {
  // Given: Stocktake in WH1, movement in WH2
  const tid = `tnt_stk_${Date.now()}_e14`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH2', name: '倉2' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  await invoke('record_opening_inventory_balance', { unit_id: pA.units[0].id, warehouse_id: wh1.id, quantity_delta: 10.0, unit_cost: 10.0 });

  const detail = await invoke('create_stocktake', { warehouse_id: wh1.id, initial_unit_ids: [pA.units[0].id] });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[0].id, counted_quantity: 10.0 });

  // Receipt in WH2 (OTHER warehouse)
  const vendor = await invoke('create_partner', { name: `V_${Date.now()}_${Math.random()}`, is_vendor: true });
  const po = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    warehouse_id: wh2.id,
    initial_lines: [{ unit_id: pA.units[0].id, quantity: 5.0, purchase_cost: 10.0 }]
  });
  await invoke('submit_purchase_order', { order_id: po.order.id });
  await invoke('confirm_purchase_order_received', {
    order_id: po.order.id,
    line_received_quantities: [{ line_id: po.lines[0].id, received_quantity: 5.0 }]
  });

  // When: Posting WH1 stocktake
  const posted = await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });

  // Then: Post succeeds
  assert.equal(posted.stocktake.status, 'posted');
});

test('TC-STK-E-15 to 18: Terminal state protections', async () => {
  // Given: Posted stocktake
  const tid = `tnt_stk_${Date.now()}_e15`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const pA = await invoke('create_product', { name: 'A', category: 'resale', unit_name: '件' });

  const detail = await invoke('create_stocktake', { warehouse_id: wh.id, initial_unit_ids: [pA.units[0].id] });
  const counting = await invoke('start_stocktake_counting', { stocktake_id: detail.stocktake.id });
  await invoke('set_stocktake_counted_quantity', { line_id: counting.lines[0].id, counted_quantity: 5.0 });
  const posted = await invoke('post_stocktake', { stocktake_id: detail.stocktake.id });

  // When: Trying to post again (E-15 Idempotency)
  await assert.rejects(
    async () => {
      await invoke('post_stocktake', { stocktake_id: posted.stocktake.id });
    },
    /無效的狀態轉換：不可從 posted 轉換至 posted/
  );

  // When: Trying to cancel posted (E-16)
  await assert.rejects(
    async () => {
      await invoke('cancel_stocktake', { stocktake_id: posted.stocktake.id });
    },
    /無效的狀態轉換：不可從 posted 轉換至 cancelled/
  );

  // When: Trying to delete line on posted (E-18)
  await assert.rejects(
    async () => {
      await invoke('remove_stocktake_line', { line_id: posted.lines[0].id });
    },
    /盤點單狀態為 posted，不可刪除明細/
  );

  // When: Trying to post cancelled (E-17)
  const stkCancel = await invoke('create_stocktake', { warehouse_id: wh.id });
  await invoke('cancel_stocktake', { stocktake_id: stkCancel.stocktake.id });
  await assert.rejects(
    async () => {
      await invoke('post_stocktake', { stocktake_id: stkCancel.stocktake.id });
    },
    /無效的狀態轉換：不可從 cancelled 轉換至 posted/
  );
});

test('TC-STK-E-20: Cross-tenant isolation (S-11)', async () => {
  // Given: Stocktake in tenant A
  const tidA = `tnt_stk_${Date.now()}_a`;
  const tidB = `tnt_stk_${Date.now()}_b`;
  await switchTenant(tidA);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const detail = await invoke('create_stocktake', { warehouse_id: wh.id });

  // When: Switching to tenant B and querying stocktake
  await switchTenant(tidB);
  await assert.rejects(
    async () => {
      await invoke('get_stocktake', { stocktake_id: detail.stocktake.id });
    },
    /找不到盤點單或不屬於目前租戶/
  );

  // When: Listing in tenant B
  const listB = await invoke('list_stocktakes');
  assert.equal(listB.length, 0);
});
