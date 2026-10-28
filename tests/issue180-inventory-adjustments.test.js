import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

/**
 * Test Perspective Table (Issue #180 - Inventory Adjustments Core)
 *
 * | Case ID | Perspective | Description |
 * |---|---|---|
 * | TC-ADJ-N-01 | Equivalence | Create draft adjustment with reason 'damage' |
 * | TC-ADJ-N-02 | Equivalence | Create draft with initial lines |
 * | TC-ADJ-N-03 | Equivalence | Reason 'other' with required note |
 * | TC-ADJ-N-04 | Equivalence | Add line to draft adjustment with snapshots |
 * | TC-ADJ-N-05 | Equivalence | Update line quantity |
 * | TC-ADJ-N-06 | Equivalence | Remove line and resequence line_no |
 * | TC-ADJ-N-07 | Equivalence | Update header (warehouse, reason, note) |
 * | TC-ADJ-N-08 | Equivalence | Post adjustment increases inventory in warehouse |
 * | TC-ADJ-N-09 | Boundary | Post adjustment where stock delta results in exactly 0 |
 * | TC-ADJ-N-10 | Equivalence | Cancel draft adjustment |
 * | TC-ADJ-N-11 | Equivalence | List adjustments filtered by status and warehouse |
 * | TC-ADJ-N-12 | Equivalence | Unit independence (adjusting two units separately) |
 * | TC-ADJ-N-13 | Equivalence | Opening balance + opening_correction scenario |
 * | TC-ADJ-N-14 | Equivalence | Warehouse with posted/cancelled adjustments can be deactivated |
 * | TC-ADJ-N-15 | Equivalence | Non-purchasable product can be adjusted |
 * | TC-ADJ-E-01 | Boundary | Empty tenant ID |
 * | TC-ADJ-E-03 | Boundary | Non-existent warehouse ID |
 * | TC-ADJ-E-04 | Error | Deactivated warehouse ID |
 * | TC-ADJ-E-05 | Boundary | Invalid reason code |
 * | TC-ADJ-E-06 | Boundary | Reason 'other' with empty note |
 * | TC-ADJ-E-07 | Error | Invalid / cross-tenant unit ID |
 * | TC-ADJ-E-08 | Boundary | Add line with quantity_delta = 0 |
 * | TC-ADJ-E-09 | Boundary | Update line with quantity_delta = 0 |
 * | TC-ADJ-E-10 | Error | Duplicate unit in same adjustment |
 * | TC-ADJ-E-11 | Boundary | Post adjustment with 0 lines |
 * | TC-ADJ-E-12 | Boundary | Negative stock boundary (-0.01) |
 * | TC-ADJ-E-13 | Atomicity | Multi-line adjustment failure rolls back entirely |
 * | TC-ADJ-E-14 | Idempotency | Double post rejected |
 * | TC-ADJ-E-15 | Error | posted -> cancelled rejected |
 * | TC-ADJ-E-16 | Error | cancelled -> posted rejected |
 * | TC-ADJ-E-17 | Error | Edit header/lines on posted adjustment |
 * | TC-ADJ-E-18 | Error | Edit header/lines on cancelled adjustment |
 * | TC-ADJ-E-19 | Isolation | Cross-tenant access rejected |
 * | TC-ADJ-E-20 | Error | W-03 extension: Deactivate warehouse blocked by draft adjustment |
 */

async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

test('TC-ADJ-N-01: Create draft adjustment with reason damage', async () => {
  // Given: Active tenant and active warehouse
  const tid = `tnt_adj_${Date.now()}_1`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });

  // When: Creating draft adjustment
  const detail = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage'
  });

  // Then: Adjustment created with ADJ-00001 in draft status
  assert.ok(detail.adjustment.id.startsWith('adj_'));
  assert.equal(detail.adjustment.adjustment_number, 'ADJ-00001');
  assert.equal(detail.adjustment.status, 'draft');
  assert.equal(detail.adjustment.warehouse_id, wh.id);
  assert.equal(detail.adjustment.reason_code, 'damage');
  assert.equal(detail.lines.length, 0);
});

test('TC-ADJ-N-02: Create draft adjustment with initial lines', async () => {
  // Given: Active warehouse and sample product
  const tid = `tnt_adj_${Date.now()}_2`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', {
    name: '品項A',
    category: 'resale',
    unit_name: '件'
  });
  const unitId = prod.units[0].id;

  // When: Creating adjustment with initial lines
  const detail = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [
      { unit_id: unitId, quantity_delta: 12.0 }
    ]
  });

  // Then: Adjustment lines populated with snapshots
  assert.equal(detail.lines.length, 1);
  assert.equal(detail.lines[0].line_no, 1);
  assert.equal(detail.lines[0].unit_id, unitId);
  assert.equal(detail.lines[0].quantity_delta, 12.0);
  assert.equal(detail.lines[0].product_name_snapshot, '品項A');
});

test('TC-ADJ-N-03: Reason other with valid note', async () => {
  // Given: Active warehouse
  const tid = `tnt_adj_${Date.now()}_3`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });

  // When: Reason is 'other' and note is provided
  const detail = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'other',
    note: '盤盈尋獲說明'
  });

  // Then: Adjustment created with note preserved
  assert.equal(detail.adjustment.reason_code, 'other');
  assert.equal(detail.adjustment.note, '盤盈尋獲說明');
});

test('TC-ADJ-N-04 ~ N-06: Add, update and remove lines lifecycle', async () => {
  // Given: Draft adjustment
  const tid = `tnt_adj_${Date.now()}_4`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const p1 = await invoke('create_product', { name: '品項1', category: 'resale', unit_name: '件' });
  const p2 = await invoke('create_product', { name: '品項2', category: 'resale', unit_name: '個' });

  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage'
  });

  // When: Adding line 1 and line 2 (TC-ADJ-N-04)
  const d1 = await invoke('add_inventory_adjustment_line', {
    adjustment_id: adj.adjustment.id,
    unit_id: p1.units[0].id,
    quantity_delta: 5.0
  });
  assert.equal(d1.lines.length, 1);
  const l1Id = d1.lines[0].id;

  const d2 = await invoke('add_inventory_adjustment_line', {
    adjustment_id: adj.adjustment.id,
    unit_id: p2.units[0].id,
    quantity_delta: -3.0
  });
  assert.equal(d2.lines.length, 2);
  const l2Id = d2.lines[1].id;

  // When: Updating line 1 quantity (TC-ADJ-N-05)
  const d3 = await invoke('update_inventory_adjustment_line', {
    line_id: l1Id,
    quantity_delta: 7.5
  });
  assert.equal(d3.lines[0].quantity_delta, 7.5);

  // When: Removing line 1 (TC-ADJ-N-06)
  const d4 = await invoke('remove_inventory_adjustment_line', { line_id: l1Id });
  // Then: Line 2 becomes line_no 1
  assert.equal(d4.lines.length, 1);
  assert.equal(d4.lines[0].id, l2Id);
  assert.equal(d4.lines[0].line_no, 1);
});

test('TC-ADJ-N-07: Update adjustment header', async () => {
  // Given: Draft adjustment and second warehouse
  const tid = `tnt_adj_${Date.now()}_5`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const wh2 = await invoke('create_warehouse', { code: 'SEC', name: '二倉' });

  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh1.id,
    reason_code: 'loss'
  });

  // When: Updating header to wh2, found, note
  const updated = await invoke('update_inventory_adjustment_header', {
    adjustment_id: adj.adjustment.id,
    warehouse_id: wh2.id,
    reason_code: 'found',
    note: '更改為尋獲'
  });

  // Then: Header updated
  assert.equal(updated.adjustment.warehouse_id, wh2.id);
  assert.equal(updated.adjustment.reason_code, 'found');
  assert.equal(updated.adjustment.note, '更改為尋獲');
});

test('TC-ADJ-N-08 & N-09: Post adjustment, increase stock and exactly zero boundary', async () => {
  // Given: Opening balance = 10 in WH1
  const tid = `tnt_adj_${Date.now()}_6`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '品項X', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 10.0,
    unit_cost: 20.0,
    warehouse_id: wh.id
  });

  // When: Posting adjustment with delta = -10 (TC-ADJ-N-09: exactly zero boundary)
  const adjZero = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [{ unit_id: unitId, quantity_delta: -10.0 }]
  });
  const postedZero = await invoke('post_inventory_adjustment', { adjustment_id: adjZero.adjustment.id });
  assert.equal(postedZero.adjustment.status, 'posted');

  const lvlZero = await invoke('get_inventory_level', { unit_id: unitId, warehouse_id: wh.id });
  assert.equal(lvlZero.current_quantity, 0.0);

  // When: Posting adjustment with delta = +25 (TC-ADJ-N-08: normal positive increase)
  const adjPos = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: unitId, quantity_delta: 25.0 }]
  });
  const postedPos = await invoke('post_inventory_adjustment', { adjustment_id: adjPos.adjustment.id });
  assert.equal(postedPos.adjustment.status, 'posted');

  const lvlPos = await invoke('get_inventory_level', { unit_id: unitId, warehouse_id: wh.id });
  assert.equal(lvlPos.current_quantity, 25.0);

  // Verify movement attributes
  const movements = await invoke('list_inventory_movements', { unit_id: unitId, warehouse_id: wh.id });
  const adjMov = movements.find(m => m.reference_id === adjPos.adjustment.id);
  assert.ok(adjMov);
  assert.equal(adjMov.reason, 'adjustment');
  assert.equal(adjMov.reference_type, 'inventory_adjustment');
  assert.equal(adjMov.unit_cost, null);
});

test('TC-ADJ-N-10: Cancel draft adjustment', async () => {
  // Given: Draft adjustment
  const tid = `tnt_adj_${Date.now()}_7`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage'
  });

  // When: Cancelling adjustment
  const cancelled = await invoke('cancel_inventory_adjustment', { adjustment_id: adj.adjustment.id });

  // Then: Status becomes cancelled
  assert.equal(cancelled.adjustment.status, 'cancelled');
  assert.ok(cancelled.adjustment.cancelled_at);
});

test('TC-ADJ-N-11: List adjustments filtered by status and warehouse', async () => {
  // Given: Two adjustments in different warehouses and statuses
  const tid = `tnt_adj_${Date.now()}_8`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const wh2 = await invoke('create_warehouse', { code: 'SEC', name: '二倉' });
  const prod = await invoke('create_product', { name: '品項', category: 'resale', unit_name: '件' });

  const a1 = await invoke('create_inventory_adjustment', {
    warehouse_id: wh1.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: prod.units[0].id, quantity_delta: 5.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: a1.adjustment.id });

  const a2 = await invoke('create_inventory_adjustment', {
    warehouse_id: wh2.id,
    reason_code: 'loss'
  });

  // When: Filtering by status = posted
  const postedList = await invoke('list_inventory_adjustments', { status: 'posted' });
  assert.equal(postedList.length, 1);
  assert.equal(postedList[0].id, a1.adjustment.id);

  // When: Filtering by warehouse_id = wh2.id
  const wh2List = await invoke('list_inventory_adjustments', { warehouse_id: wh2.id });
  assert.equal(wh2List.length, 1);
  assert.equal(wh2List[0].id, a2.adjustment.id);
});

test('TC-ADJ-N-12: Unit independence across adjustments', async () => {
  // Given: Warehouse and two separate units
  const tid = `tnt_adj_${Date.now()}_9`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const p1 = await invoke('create_product', { name: '產品1', category: 'resale', unit_name: '件' });
  const p2 = await invoke('create_product', { name: '產品2', category: 'resale', unit_name: '條' });

  // When: Adjusting p1 +10 and p2 +30
  const a1 = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: p1.units[0].id, quantity_delta: 10.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: a1.adjustment.id });

  const a2 = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: p2.units[0].id, quantity_delta: 30.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: a2.adjustment.id });

  // Then: Distinct inventory levels
  const l1 = await invoke('get_inventory_level', { unit_id: p1.units[0].id, warehouse_id: wh.id });
  const l2 = await invoke('get_inventory_level', { unit_id: p2.units[0].id, warehouse_id: wh.id });
  assert.equal(l1.current_quantity, 10.0);
  assert.equal(l2.current_quantity, 30.0);
});

test('TC-ADJ-N-13: Opening correction scenario', async () => {
  // Given: Opening balance = 80
  const tid = `tnt_adj_${Date.now()}_10`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '期初商品', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 80.0,
    unit_cost: 10.0,
    warehouse_id: wh.id
  });

  // When: Opening correction delta = -25
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'opening_correction',
    initial_lines: [{ unit_id: unitId, quantity_delta: -25.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id });

  // Then: Current stock is 55
  const lvl = await invoke('get_inventory_level', { unit_id: unitId, warehouse_id: wh.id });
  assert.equal(lvl.current_quantity, 55.0);
});

test('TC-ADJ-N-14: Warehouse deactivation allowed when adjustment is posted or cancelled', async () => {
  // Given: Non-default warehouse WH2 with stock returned to 0
  const tid = `tnt_adj_${Date.now()}_11`;
  await switchTenant(tid);
  const _wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const wh2 = await invoke('create_warehouse', { code: 'WH-02', name: '二倉' });
  const prod = await invoke('create_product', { name: '品項', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  // Balance +10 then -10
  const a1 = await invoke('create_inventory_adjustment', {
    warehouse_id: wh2.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: unitId, quantity_delta: 10.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: a1.adjustment.id });

  const a2 = await invoke('create_inventory_adjustment', {
    warehouse_id: wh2.id,
    reason_code: 'damage',
    initial_lines: [{ unit_id: unitId, quantity_delta: -10.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: a2.adjustment.id });

  // When: Deactivating warehouse WH-02
  const deact = await invoke('deactivate_warehouse', { id: wh2.id });

  // Then: Deactivation succeeds
  assert.equal(deact.is_active, false);
});

test('TC-ADJ-N-15: Non-purchasable product can be adjusted', async () => {
  // Given: Manufactured product (is_purchasable = 0)
  const tid = `tnt_adj_${Date.now()}_12`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '自製成品A', category: 'manufactured', unit_name: '件' });
  const unitId = prod.units[0].id;

  // When: Creating and posting adjustment
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: unitId, quantity_delta: 40.0 }]
  });
  const posted = await invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id });

  // Then: Allowed and posted
  assert.equal(posted.adjustment.status, 'posted');
  const lvl = await invoke('get_inventory_level', { unit_id: unitId, warehouse_id: wh.id });
  assert.equal(lvl.current_quantity, 40.0);
});

// ==========================================
// Error and Boundary Cases
// ==========================================

test('TC-ADJ-E-01: Empty tenant ID rejected', async () => {
  // Given: Whitespace tenant
  await switchTenant('   ');

  // When / Then: create_inventory_adjustment rejects
  await assert.rejects(
    invoke('create_inventory_adjustment', { warehouse_id: 'wh_1', reason_code: 'damage' }),
    { message: 'Tenant ID cannot be empty' }
  );
});

test('TC-ADJ-E-03 & E-04: Non-existent or deactivated warehouse rejected', async () => {
  // Given: Active tenant and deactivated warehouse
  const tid = `tnt_adj_${Date.now()}_13`;
  await switchTenant(tid);
  const _wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const wh2 = await invoke('create_warehouse', { code: 'SUB', name: '二倉' });
  await invoke('deactivate_warehouse', { id: wh2.id });

  // When / Then: Non-existent warehouse rejected (TC-ADJ-E-03)
  await assert.rejects(
    invoke('create_inventory_adjustment', { warehouse_id: 'wh_fake', reason_code: 'damage' }),
    { message: '找不到倉別或倉別已停用' }
  );

  // When / Then: Deactivated warehouse rejected (TC-ADJ-E-04)
  await assert.rejects(
    invoke('create_inventory_adjustment', { warehouse_id: wh2.id, reason_code: 'damage' }),
    { message: '找不到倉別或倉別已停用' }
  );
});

test('TC-ADJ-E-05 & E-06: Reason code validation and other requires note', async () => {
  // Given: Active warehouse
  const tid = `tnt_adj_${Date.now()}_14`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });

  // When / Then: Invalid reason rejected (TC-ADJ-E-05)
  await assert.rejects(
    invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'not_valid' }),
    { message: '請選擇調整原因' }
  );

  // When / Then: Reason 'other' with empty note rejected (TC-ADJ-E-06)
  await assert.rejects(
    invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'other', note: '   ' }),
    { message: '原因為其他時須填寫說明' }
  );
});

test('TC-ADJ-E-07: Invalid or cross-tenant unit rejected', async () => {
  // Given: Product in other tenant
  const tid1 = `tnt_adj_${Date.now()}_15_1`;
  const tid2 = `tnt_adj_${Date.now()}_15_2`;
  await switchTenant(tid2);
  const prodOther = await invoke('create_product', { name: '其他租戶產品', category: 'resale', unit_name: '件' });

  await switchTenant(tid1);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const adj = await invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'damage' });

  // When / Then: Adding cross-tenant unit rejected
  await assert.rejects(
    invoke('add_inventory_adjustment_line', {
      adjustment_id: adj.adjustment.id,
      unit_id: prodOther.units[0].id,
      quantity_delta: 5.0
    }),
    { message: '找不到指定的商品單位 (unit_id) 或不屬於目前租戶' }
  );
});

test('TC-ADJ-E-08 & E-09: Delta cannot be 0 in add or update line', async () => {
  // Given: Draft adjustment
  const tid = `tnt_adj_${Date.now()}_16`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '商品', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  const adj = await invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'damage' });

  // When / Then: Add line with delta 0 (TC-ADJ-E-08)
  await assert.rejects(
    invoke('add_inventory_adjustment_line', { adjustment_id: adj.adjustment.id, unit_id: unitId, quantity_delta: 0 }),
    { message: '調整數量不可為 0' }
  );

  // When / Then: Update line with delta 0 (TC-ADJ-E-09)
  const d = await invoke('add_inventory_adjustment_line', { adjustment_id: adj.adjustment.id, unit_id: unitId, quantity_delta: 4.0 });
  await assert.rejects(
    invoke('update_inventory_adjustment_line', { line_id: d.lines[0].id, quantity_delta: 0 }),
    { message: '調整數量不可為 0' }
  );
});

test('TC-ADJ-E-10: Duplicate unit in same adjustment rejected', async () => {
  // Given: Draft adjustment with unitId
  const tid = `tnt_adj_${Date.now()}_17`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '商品', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [{ unit_id: unitId, quantity_delta: 5.0 }]
  });

  // When / Then: Adding unitId again
  await assert.rejects(
    invoke('add_inventory_adjustment_line', { adjustment_id: adj.adjustment.id, unit_id: unitId, quantity_delta: 3.0 }),
    { message: '同一調整單內商品單位不可重複，請修改既有明細' }
  );
});

test('TC-ADJ-E-11: Post adjustment with 0 lines rejected', async () => {
  // Given: Draft adjustment without lines
  const tid = `tnt_adj_${Date.now()}_18`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const adj = await invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'damage' });

  // When / Then: Post with 0 lines
  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: '調整單沒有任何明細' }
  );
});

test('TC-ADJ-E-12: Negative stock boundary (-0.01) rejected with formatted message', async () => {
  // Given: Stock is 10
  const tid = `tnt_adj_${Date.now()}_19`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '商品A', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 10.0,
    unit_cost: 10.0,
    warehouse_id: wh.id
  });

  // When: Delta is -10.01 (would result in -0.01)
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [{ unit_id: unitId, quantity_delta: -10.01 }]
  });

  // Then: Rejected with exact message
  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: `〔商品A／標準／件〕在〔主倉〕現有 10，調整後將為 -0.01（負數），無法過帳` }
  );
});

test('TC-ADJ-E-12b: Negative stock sub-epsilon boundary (-1.0000011 with current 1.0) rejected consistently', async () => {
  // Given: Stock is 1.0
  const tid = `tnt_adj_${Date.now()}_19b`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '商品A', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: unitId,
    quantity_delta: 1.0,
    unit_cost: 10.0,
    warehouse_id: wh.id
  });

  // When: Delta is -1.0000011 (would result in -0.0000011 < -1e-6)
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [{ unit_id: unitId, quantity_delta: -1.0000011 }]
  });

  // Then: Rejected with formatted message
  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: `〔商品A／標準／件〕在〔主倉〕現有 1，調整後將為 -0.000001（負數），無法過帳` }
  );
});

test('TC-ADJ-E-13: Multi-line atomicity and partial failure rollback', async () => {
  // Given: Unit1 stock 10, Unit2 stock 2
  const tid = `tnt_adj_${Date.now()}_20`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const p1 = await invoke('create_product', { name: 'P1', category: 'resale', unit_name: '件' });
  const p2 = await invoke('create_product', { name: 'P2', category: 'resale', unit_name: '件' });
  const u1 = p1.units[0].id;
  const u2 = p2.units[0].id;

  await invoke('record_opening_inventory_balance', { unit_id: u1, quantity_delta: 10.0, unit_cost: 10.0, warehouse_id: wh.id });
  await invoke('record_opening_inventory_balance', { unit_id: u2, quantity_delta: 2.0, unit_cost: 10.0, warehouse_id: wh.id });

  // When: Line 1 (+5) valid, Line 2 (-5) exceeds stock (2 - 5 = -3)
  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [
      { unit_id: u1, quantity_delta: 5.0 },
      { unit_id: u2, quantity_delta: -5.0 }
    ]
  });

  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    err => err.message.includes('負數')
  );

  // Then: Status remains draft, no movements inserted
  const reloaded = await invoke('get_inventory_adjustment', { adjustment_id: adj.adjustment.id });
  assert.equal(reloaded.adjustment.status, 'draft');

  const lvl1 = await invoke('get_inventory_level', { unit_id: u1, warehouse_id: wh.id });
  assert.equal(lvl1.current_quantity, 10.0);
});

test('TC-ADJ-E-14 ~ E-18: State machine guards and terminal state protection', async () => {
  // Given: Posted adjustment
  const tid = `tnt_adj_${Date.now()}_21`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const prod = await invoke('create_product', { name: '品項', category: 'resale', unit_name: '件' });
  const unitId = prod.units[0].id;

  const adj = await invoke('create_inventory_adjustment', {
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: unitId, quantity_delta: 10.0 }]
  });
  await invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id });

  // TC-ADJ-E-14: Double post rejected
  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: '無效的狀態轉換：不可從 posted 轉換至 posted' }
  );

  // TC-ADJ-E-15: posted -> cancelled rejected
  await assert.rejects(
    invoke('cancel_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: '無效的狀態轉換：不可從 posted 轉換至 cancelled' }
  );

  // TC-ADJ-E-17: Modify posted adjustment rejected
  await assert.rejects(
    invoke('update_inventory_adjustment_header', { adjustment_id: adj.adjustment.id, reason_code: 'damage' }),
    { message: '調整單狀態為 posted，不允許修改表頭' }
  );
  await assert.rejects(
    invoke('add_inventory_adjustment_line', { adjustment_id: adj.adjustment.id, unit_id: unitId, quantity_delta: 2.0 }),
    { message: '調整單狀態為 posted，僅草稿狀態可新增明細' }
  );

  // Given: Cancelled adjustment
  const adj2 = await invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'damage' });
  await invoke('cancel_inventory_adjustment', { adjustment_id: adj2.adjustment.id });

  // TC-ADJ-E-16: cancelled -> posted rejected
  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj2.adjustment.id }),
    { message: '無效的狀態轉換：不可從 cancelled 轉換至 posted' }
  );

  // TC-ADJ-E-18: Modify cancelled adjustment rejected
  await assert.rejects(
    invoke('update_inventory_adjustment_header', { adjustment_id: adj2.adjustment.id, reason_code: 'loss' }),
    { message: '調整單狀態為 cancelled，不允許修改表頭' }
  );
});

test('TC-ADJ-E-19: Tenant isolation', async () => {
  // Given: Adjustment in tenant 1
  const tid1 = `tnt_adj_${Date.now()}_22_1`;
  const tid2 = `tnt_adj_${Date.now()}_22_2`;
  await switchTenant(tid1);
  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const adj = await invoke('create_inventory_adjustment', { warehouse_id: wh.id, reason_code: 'damage' });

  // When / Then: Tenant 2 cannot access
  await switchTenant(tid2);
  await assert.rejects(
    invoke('get_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: '找不到調整單或不屬於目前租戶' }
  );
  await assert.rejects(
    invoke('post_inventory_adjustment', { adjustment_id: adj.adjustment.id }),
    { message: '找不到調整單或不屬於目前租戶' }
  );
});

test('TC-ADJ-E-20: W-03 extension: Deactivate warehouse blocked by draft adjustment', async () => {
  // Given: WH2 referenced by draft adjustment
  const tid = `tnt_adj_${Date.now()}_23`;
  await switchTenant(tid);
  const _wh1 = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const wh2 = await invoke('create_warehouse', { code: 'SUB', name: '二倉' });

  const adj = await invoke('create_inventory_adjustment', { warehouse_id: wh2.id, reason_code: 'damage' });

  // When / Then: Attempting to deactivate WH2
  await assert.rejects(
    invoke('deactivate_warehouse', { id: wh2.id }),
    { message: `此倉仍被未結案單據引用：${adj.adjustment.adjustment_number}` }
  );
});
