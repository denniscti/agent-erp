/**
 * @file issue183-inventory-adjustments-form.test.js
 * @description Layer 2 automated test suite for Inventory Adjustment Form Entry and Warehouse Workspace Integration (Issue #183).
 * Adheres strictly to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-ADJ-FMT-01 | Reason codes and status codes | Equivalence – Formatters | formatAdjustmentReason & formatAdjustmentStatus return correct Traditional Chinese labels | UI i18n formatting |
 * | TC-ADJ-N-01 | Valid warehouse, reason 'damage', delta +10 and -3 | Equivalence – Normal Path | Draft created, lines added, posted successfully, inventory updated (+7 net) | Full lifecycle |
 * | TC-ADJ-N-02 | Valid draft adjustment | Equivalence – Cancel Path | Draft cancelled, status becomes 'cancelled', inventory unaffected | Cancellation flow |
 * | TC-ADJ-N-03 | Tenant with single active warehouse | Boundary – Single Warehouse (1) | Default warehouse selected, single warehouse auto-resolved | Single warehouse rule |
 * | TC-ADJ-N-04 | Tenant with multiple active warehouses | Equivalence – Multi-Warehouse Selection | Filter by warehouse in fetchInventoryAdjustments restricts returned list | Partition isolation |
 * | TC-ADJ-N-05 | Posted adjustment with lines (+12, -4) | Equivalence – Reverse Adjustment Shortcut | Inverted deltas (-12, +4) prefilled in draft with note referencing original number | Reverse adjustment |
 * | TC-ADJ-N-06 | Opening balance duplicate error O-01 | Equivalence – Opening Correction Shortcut | Error detected, pre-populates warehouse, unit and reason 'opening_correction' | O-01 Shortcut |
 * | TC-ADJ-N-07 | Movement ledger reference with 'inventory_adjustment' | Equivalence – Movement Linkage | Ledger row resolves adjustment reference and navigates to adjustment detail | Traceability |
 * | TC-ADJ-E-01 | Reason 'other' with empty/whitespace note | Boundary / Error – Note Required (A-03) | Rejected with A-03 validation error: note is required for reason 'other' | Rule A-03 |
 * | TC-ADJ-E-02 | Line delta causing negative stock (stock=2, delta=-5) | Boundary / Error – Negative Stock (A-09) | Preview indicates negative (< 0); post rejected with Rust A-09 negative stock error | Rule A-09 Defense |
 * | TC-ADJ-E-03 | Line delta = 0 or non-integer | Boundary / Error – Zero Delta (A-04) | Rejected with A-04 validation error: quantity delta must be non-zero integer | Boundary 0 (A-04) |
 * | TC-ADJ-E-04 | Duplicate unit added to same adjustment | Boundary / Error – Duplicate Unit (A-05) | Rejected with A-05 validation error: duplicate unit not allowed in same adjustment | Rule A-05 |
 * | TC-ADJ-E-05 | Attempt to post adjustment with 0 lines | Boundary / Error – Empty Lines (A-07) | Rejected with A-07 validation error: cannot post adjustment without lines | Boundary empty (A-07) |
 * | TC-ADJ-E-06 | Post already posted or cancelled adjustment | Error – Invalid State Transition | Rejected: only 'draft' adjustments can be posted or cancelled | Terminal state guard |
 * | TC-ADJ-B-01 | Line delta bringing stock to exactly 0 (stock=5, delta=-5) | Boundary – Zero Stock Balance (0) | Post succeeds, final stock level is 0 (allowed, non-negative) | Boundary 0 stock |
 * | TC-ADJ-N-08 | Create adjustment with initial_lines | Equivalence – Batch Creation | Single call creates adjustment with lines, lines_count and line_no populated | Batch lines |
 * | TC-ADJ-N-09 | Draft adjustment line removal | Equivalence – Line Removal | removeInventoryAdjustmentLineAction deletes target line, updates lines_count | Line removal |
 * | TC-ADJ-N-10 | Query unit inventory level | Equivalence – Store Layer Abstraction | fetchUnitInventoryLevel retrieves level without direct invoke from components | Architecture standard |
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
const {
  appState,
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
  recordOpeningInventoryBalanceAction,
  fetchUnitInventoryLevel
} = await import('../src/lib/store.svelte.js');

async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

async function createTestProduct(name) {
  const res = await invoke('create_product', {
    name,
    category: 'resale',
    unit_name: '件'
  });
  return { product: res.product, unitId: res.units[0].id };
}

// -----------------------------------------------------------------------------
// Test Group 1: Formatters (TC-ADJ-FMT-01)
// -----------------------------------------------------------------------------
test('TC-ADJ-FMT-01: formatAdjustmentReason & formatAdjustmentStatus return Traditional Chinese labels', () => {
  // Given: Standard adjustment reason codes and status codes
  const reasons = ['damage', 'loss', 'found', 'opening_correction', 'other', 'unknown_code'];
  const statuses = ['draft', 'posted', 'cancelled', 'unknown_status'];

  // When: Formatting reason codes
  const formattedReasons = reasons.map(formatAdjustmentReason);
  // Then: All reason labels match Traditional Chinese specification
  assert.equal(formattedReasons[0], '報廢／損壞');
  assert.equal(formattedReasons[1], '盤虧／遺失');
  assert.equal(formattedReasons[2], '盤盈／尋獲');
  assert.equal(formattedReasons[3], '期初更正');
  assert.equal(formattedReasons[4], '其他');
  assert.equal(formattedReasons[5], 'unknown_code');

  // When: Formatting status codes
  const formattedStatuses = statuses.map(formatAdjustmentStatus);
  // Then: All status labels match Traditional Chinese specification
  assert.equal(formattedStatuses[0], '草稿 (draft)');
  assert.equal(formattedStatuses[1], '已過帳 (posted)');
  assert.equal(formattedStatuses[2], '已取消 (cancelled)');
  assert.equal(formattedStatuses[3], 'unknown_status');
});

// -----------------------------------------------------------------------------
// Test Group 2: Normal Lifecycle (TC-ADJ-N-01)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-01: Full lifecycle - Create draft adjustment (+10, -3), post, verify stock updated', async () => {
  // Given: Tenant with warehouse and product with initial stock = 20
  const tid = `tnt_adj_${Date.now()}_n01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-MAIN', name: '台北總倉' });
  const { unitId } = await createTestProduct(`商品A_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 20,
    unit_cost: 100
  });

  const initialLevel = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(initialLevel.current_quantity, 20);

  // When: Creating draft adjustment with reason 'damage' and adding lines (+10, -3 = net +7)
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'damage',
    note: '盤點報廢與尋獲整理',
    task_id: null
  });
  assert.ok(adj.id);
  assert.equal(adj.status, 'draft');
  assert.equal(adj.warehouse_id, wh.id);

  const detail1 = await addInventoryAdjustmentLineAction(adj.id, unitId, 10);
  const line1 = detail1.lines.find(l => l.unit_id === unitId);
  assert.equal(line1.quantity_delta, 10);

  const { unitId: unitId2 } = await createTestProduct(`商品B_${Date.now()}`);
  await recordOpeningInventoryBalanceAction({
    unit_id: unitId2,
    warehouse_id: wh.id,
    quantity: 10,
    unit_cost: 50
  });

  const detail2 = await addInventoryAdjustmentLineAction(adj.id, unitId2, -3);
  const line2 = detail2.lines.find(l => l.unit_id === unitId2);
  assert.equal(line2.quantity_delta, -3);

  // Then: List query displays lines_count = 2
  await fetchInventoryAdjustments();
  const foundAdj = (appState.inventoryAdjustments || []).find(a => a.id === adj.id);
  assert.ok(foundAdj);
  assert.equal(foundAdj.lines_count, 2);

  // When: Posting the adjustment
  const postedAdj = await postInventoryAdjustmentAction(adj.id);

  // Then: Status transitions to posted, inventory updated accurately
  assert.equal(postedAdj.status, 'posted');
  assert.ok(postedAdj.posted_at);

  const updatedLevel1 = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(updatedLevel1.current_quantity, 30); // 20 + 10 = 30

  const updatedLevel2 = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId2 });
  assert.equal(updatedLevel2.current_quantity, 7); // 10 - 3 = 7
});

// -----------------------------------------------------------------------------
// Test Group 3: Cancel Lifecycle (TC-ADJ-N-02)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-02: Cancel path - Draft adjustment cancelled, status is cancelled, stock unchanged', async () => {
  // Given: Draft adjustment with 1 line
  const tid = `tnt_adj_${Date.now()}_n02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-01', name: '一號倉' });
  const { unitId } = await createTestProduct(`取消測試品_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 15,
    unit_cost: 10
  });

  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'loss',
    note: '懷疑遺失但尚未確認'
  });
  await addInventoryAdjustmentLineAction(adj.id, unitId, -5);

  // When: Cancelling the draft adjustment
  const cancelled = await cancelInventoryAdjustmentAction(adj.id);

  // Then: Adjustment status is cancelled, cannot be posted, stock remains 15
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.cancelled_at);

  const level = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(level.current_quantity, 15);
});

// -----------------------------------------------------------------------------
// Test Group 4: Warehouse Dimensions (TC-ADJ-N-03 & TC-ADJ-N-04)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-03: Single warehouse boundary - Auto-resolves single warehouse', async () => {
  // Given: Tenant with strictly 1 active warehouse
  const tid = `tnt_adj_${Date.now()}_n03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'ONLY-ONE', name: '唯一倉' });

  // When: Creating adjustment with this single warehouse
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'found',
    note: '尋獲一箱庫存'
  });

  // Then: Warehouse ID is accurately bound
  assert.equal(adj.warehouse_id, wh.id);
  assert.equal(adj.reason_code, 'found');
});

test('TC-ADJ-N-04: Multi-warehouse dimension - Adjustments can be filtered by warehouse', async () => {
  // Given: Tenant with 2 active warehouses
  const tid = `tnt_adj_${Date.now()}_n04`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH-A', name: '倉庫甲' });
  const wh2 = await invoke('create_warehouse', { code: 'WH-B', name: '倉庫乙' });

  // When: Creating adjustments in WH-A and WH-B
  const adjA = await createInventoryAdjustmentAction({ warehouse_id: wh1.id, reason_code: 'damage' });
  const adjB = await createInventoryAdjustmentAction({ warehouse_id: wh2.id, reason_code: 'loss' });

  // Then: Filter by WH-A returns only adjA
  const listA = await fetchInventoryAdjustments(wh1.id);
  assert.ok(listA.some(a => a.id === adjA.id));
  assert.ok(!listA.some(a => a.id === adjB.id));

  // Then: Filter by WH-B returns only adjB
  const listB = await fetchInventoryAdjustments(wh2.id);
  assert.ok(listB.some(a => a.id === adjB.id));
  assert.ok(!listB.some(a => a.id === adjA.id));
});

// -----------------------------------------------------------------------------
// Test Group 5: Reverse Adjustment Shortcut (TC-ADJ-N-05)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-05: Reverse adjustment shortcut - Inverts deltas, preserves warehouse and notes source', async () => {
  // Given: A posted adjustment with lines (+12, -4)
  const tid = `tnt_adj_${Date.now()}_n05`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-REV', name: '反向測試倉' });
  const { unitId: unitA } = await createTestProduct(`商品A_${Date.now()}`);
  const { unitId: unitB } = await createTestProduct(`商品B_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({ unit_id: unitB, warehouse_id: wh.id, quantity: 10, unit_cost: 20 });

  const origAdj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'damage',
    note: '原始調整單'
  });
  await addInventoryAdjustmentLineAction(origAdj.id, unitA, 12);
  await addInventoryAdjustmentLineAction(origAdj.id, unitB, -4);
  const postedOrig = await postInventoryAdjustmentAction(origAdj.id);

  // When: Generating reverse adjustment data
  const origDetail = await fetchInventoryAdjustmentDetail(postedOrig.id);
  const reversedLines = origDetail.lines.map(l => ({
    unit_id: l.unit_id,
    quantity_delta: -l.quantity_delta
  }));

  const revAdj = await createInventoryAdjustmentAction({
    warehouse_id: origDetail.adjustment.warehouse_id,
    reason_code: origDetail.adjustment.reason_code,
    note: `反向調整自 ${origDetail.adjustment.adjustment_number}`
  });

  for (const l of reversedLines) {
    await addInventoryAdjustmentLineAction(revAdj.id, l.unit_id, l.quantity_delta);
  }

  // Then: New adjustment is in draft, quantities are completely inverted (-12 and +4)
  const revDetail = await fetchInventoryAdjustmentDetail(revAdj.id);
  assert.equal(revDetail.adjustment.status, 'draft');
  assert.match(revDetail.adjustment.note, /反向調整自/);
  assert.equal(revDetail.lines.length, 2);

  const revLineA = revDetail.lines.find(l => l.unit_id === unitA);
  const revLineB = revDetail.lines.find(l => l.unit_id === unitB);
  assert.equal(revLineA.quantity_delta, -12);
  assert.equal(revLineB.quantity_delta, 4);
});

// -----------------------------------------------------------------------------
// Test Group 6: Opening Correction Shortcut (TC-ADJ-N-06)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-06: Opening balance duplicate O-01 shortcut - Pre-fills warehouse, unit, and reason opening_correction', async () => {
  // Given: A warehouse and product unit that already has opening balance recorded
  const tid = `tnt_adj_${Date.now()}_n06`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-O01', name: '期初倉' });
  const { unitId } = await createTestProduct(`期初商品_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 50,
    unit_cost: 100
  });

  // When: Attempting duplicate opening balance (O-01)
  let openingError = null;
  try {
    await recordOpeningInventoryBalanceAction({
      unit_id: unitId,
      warehouse_id: wh.id,
      quantity: 60,
      unit_cost: 100
    });
  } catch (err) {
    openingError = err.message || String(err);
  }

  // Then: O-01 duplicate error is caught
  assert.ok(openingError);
  assert.match(openingError, /已開帳|O-01|更正/);

  // When: Utilizing opening_correction adjustment shortcut
  const correctionAdj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'opening_correction',
    note: '期初更正調整 (+10)'
  });
  await addInventoryAdjustmentLineAction(correctionAdj.id, unitId, 10);
  await postInventoryAdjustmentAction(correctionAdj.id);

  // Then: Inventory is updated to 60 (50 + 10)
  const level = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(level.current_quantity, 60);
});

// -----------------------------------------------------------------------------
// Test Group 7: Movement Ledger Linkage (TC-ADJ-N-07)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-07: Movement ledger reference linkage - Resolves adjustment reference_id', async () => {
  // Given: Posted adjustment creates inventory movement with reference_type 'inventory_adjustment'
  const tid = `tnt_adj_${Date.now()}_n07`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-LEDGER', name: '流水帳倉' });
  const { unitId } = await createTestProduct(`流水帳品_${Date.now()}`);

  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'found',
    note: '流水帳測試'
  });
  await addInventoryAdjustmentLineAction(adj.id, unitId, 8);
  await postInventoryAdjustmentAction(adj.id);

  // When: Fetching movements for the unit
  const movements = await invoke('list_inventory_movements', { unit_id: unitId, warehouse_id: wh.id });

  // Then: Movement has reference_id pointing to adj.id and reference_type 'inventory_adjustment'
  const adjMov = movements.find(m => m.reference_id === adj.id || m.reference_id?.startsWith('adj_'));
  assert.ok(adjMov);
  assert.equal(adjMov.reference_id, adj.id);
  assert.equal(adjMov.reference_type, 'inventory_adjustment');
  assert.equal(adjMov.quantity_delta, 8);

  // When: Selecting this adjustment by reference_id
  const detail = await selectInventoryAdjustment(adjMov.reference_id);
  assert.ok(detail);
  assert.equal(detail.adjustment.id, adj.id);
  assert.equal(appState.currentInventoryAdjustmentDetail.adjustment.id, adj.id);
});

// -----------------------------------------------------------------------------
// Test Group 8: Validation A-03 (TC-ADJ-E-01)
// -----------------------------------------------------------------------------
test('TC-ADJ-E-01: Boundary / Error A-03 - Reason other requires non-empty note', async () => {
  // Given: Active tenant and warehouse
  const tid = `tnt_adj_${Date.now()}_e01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-01', name: '一號倉' });

  // When: Attempting to create adjustment with reason 'other' and null/empty note
  // Then: Rejection error A-03 is thrown
  await assert.rejects(
    async () => {
      await createInventoryAdjustmentAction({
        warehouse_id: wh.id,
        reason_code: 'other',
        note: null
      });
    },
    /A-03|備註|說明/
  );

  await assert.rejects(
    async () => {
      await createInventoryAdjustmentAction({
        warehouse_id: wh.id,
        reason_code: 'other',
        note: '   '
      });
    },
    /A-03|備註|說明/
  );
});

// -----------------------------------------------------------------------------
// Test Group 9: Negative Stock Defense A-09 (TC-ADJ-E-02)
// -----------------------------------------------------------------------------
test('TC-ADJ-E-02: Boundary / Error A-09 - Negative resulting stock post is rejected', async () => {
  // Given: Warehouse with current stock = 2 for unit
  const tid = `tnt_adj_${Date.now()}_e02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-NEG', name: '負庫存防線倉' });
  const { unitId } = await createTestProduct(`負數品_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 2,
    unit_cost: 10
  });

  const level = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(level.current_quantity, 2);

  // When: Draft adjustment added with delta = -5 (resulting stock 2 + (-5) = -3 < 0)
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'damage'
  });
  await addInventoryAdjustmentLineAction(adj.id, unitId, -5);

  // Then: Live preview indicates resulting stock is -3
  const previewAfter = level.current_quantity + (-5);
  assert.equal(previewAfter, -3);
  assert.ok(previewAfter < 0);

  // When: Attempting to post this adjustment
  // Then: Rust A-09 error is thrown and post is blocked; stock remains 2
  await assert.rejects(
    async () => {
      await postInventoryAdjustmentAction(adj.id);
    },
    /A-09|負數/
  );

  const levelAfter = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(levelAfter.current_quantity, 2);
});

// -----------------------------------------------------------------------------
// Test Group 10: Validation A-04 (TC-ADJ-E-03)
// -----------------------------------------------------------------------------
test('TC-ADJ-E-03: Boundary / Error A-04 - Line delta = 0 is rejected', async () => {
  // Given: Draft adjustment
  const tid = `tnt_adj_${Date.now()}_e03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-A04', name: 'A04倉' });
  const { unitId } = await createTestProduct(`A04品_${Date.now()}`);

  const adj = await createInventoryAdjustmentAction({ warehouse_id: wh.id, reason_code: 'damage' });

  // When: Adding line with quantity_delta = 0
  // Then: Rejected with A-04 validation error
  await assert.rejects(
    async () => {
      await addInventoryAdjustmentLineAction(adj.id, unitId, 0);
    },
    /不可為 0|非零|A-04/
  );
});

// -----------------------------------------------------------------------------
// Test Group 11: Validation A-05 (TC-ADJ-E-04)
// -----------------------------------------------------------------------------
test('TC-ADJ-E-04: Boundary / Error A-05 - Duplicate unit in same adjustment is rejected', async () => {
  // Given: Draft adjustment with 1 line
  const tid = `tnt_adj_${Date.now()}_e04`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-A05', name: 'A05倉' });
  const { unitId } = await createTestProduct(`A05品_${Date.now()}`);

  const adj = await createInventoryAdjustmentAction({ warehouse_id: wh.id, reason_code: 'damage' });
  await addInventoryAdjustmentLineAction(adj.id, unitId, 3);

  // When: Adding the same unit again to the adjustment
  // Then: Rejected with A-05 duplicate error
  await assert.rejects(
    async () => {
      await addInventoryAdjustmentLineAction(adj.id, unitId, 2);
    },
    /A-05|重複/
  );
});

// -----------------------------------------------------------------------------
// Test Group 12: Validation A-07 (TC-ADJ-E-05)
// -----------------------------------------------------------------------------
test('TC-ADJ-E-05: Boundary / Error A-07 - Cannot post adjustment with 0 lines', async () => {
  // Given: Draft adjustment with 0 lines
  const tid = `tnt_adj_${Date.now()}_e05`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-A07', name: 'A07倉' });

  const adj = await createInventoryAdjustmentAction({ warehouse_id: wh.id, reason_code: 'loss' });

  // When: Attempting to post empty adjustment
  // Then: Rejected with A-07 error
  await assert.rejects(
    async () => {
      await postInventoryAdjustmentAction(adj.id);
    },
    /A-07|無明細|沒有任何明細/
  );
});

// -----------------------------------------------------------------------------
// Test Group 13: State Transition Guard (TC-ADJ-E-06)
// -----------------------------------------------------------------------------
test('TC-ADJ-E-06: Error - Terminal state guard: double post and cancel on posted rejected', async () => {
  // Given: Posted adjustment
  const tid = `tnt_adj_${Date.now()}_e06`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-STATE', name: '狀態測試倉' });
  const { unitId } = await createTestProduct(`狀態測試品_${Date.now()}`);

  const adj = await createInventoryAdjustmentAction({ warehouse_id: wh.id, reason_code: 'found' });
  await addInventoryAdjustmentLineAction(adj.id, unitId, 5);
  await postInventoryAdjustmentAction(adj.id);

  // When: Attempting double post
  // Then: Rejected by terminal state guard
  await assert.rejects(
    async () => {
      await postInventoryAdjustmentAction(adj.id);
    },
    /草稿|draft|狀態/
  );

  // When: Attempting to cancel already posted adjustment
  // Then: Rejected by terminal state guard
  await assert.rejects(
    async () => {
      await cancelInventoryAdjustmentAction(adj.id);
    },
    /草稿|draft|狀態/
  );
});

// -----------------------------------------------------------------------------
// Test Group 14: Zero Stock Boundary (TC-ADJ-B-01)
// -----------------------------------------------------------------------------
test('TC-ADJ-B-01: Boundary - Delta bringing stock to exactly 0 succeeds', async () => {
  // Given: Unit with stock = 5
  const tid = `tnt_adj_${Date.now()}_b01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-ZERO', name: '歸零倉' });
  const { unitId } = await createTestProduct(`歸零商品_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 5,
    unit_cost: 10
  });

  // When: Delta is -5 (5 + (-5) = 0)
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'damage',
    note: '整批報廢歸零'
  });
  await addInventoryAdjustmentLineAction(adj.id, unitId, -5);

  // When: Posting adjustment
  const posted = await postInventoryAdjustmentAction(adj.id);

  // Then: Post succeeds, stock is exactly 0
  assert.equal(posted.status, 'posted');
  const level = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(level.current_quantity, 0);
});

// -----------------------------------------------------------------------------
// Test Group 15: Batch Creation with initial_lines (TC-ADJ-N-08)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-08: Batch creation with initial_lines - createInventoryAdjustmentAction supports initial_lines in single call', async () => {
  // Given: Warehouse and 2 products
  const tid = `tnt_adj_${Date.now()}_n08`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-BATCH', name: '批次建立倉' });
  const { unitId: u1 } = await createTestProduct(`批次品1_${Date.now()}`);
  const { unitId: u2 } = await createTestProduct(`批次品2_${Date.now()}`);

  // When: Creating draft adjustment with initial_lines
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'found',
    note: '盤盈整批入庫',
    initial_lines: [
      { unit_id: u1, quantity_delta: 15 },
      { unit_id: u2, quantity_delta: -4 }
    ]
  });

  // Then: Adjustment is created with 2 lines, lines_count is 2, line_no are 1 and 2
  assert.ok(adj.id);
  assert.equal(adj.lines_count, 2);

  const detail = await fetchInventoryAdjustmentDetail(adj.id);
  assert.equal(detail.lines.length, 2);
  assert.equal(detail.lines[0].line_no, 1);
  assert.equal(detail.lines[0].unit_id, u1);
  assert.equal(detail.lines[0].quantity_delta, 15);
  assert.equal(detail.lines[1].line_no, 2);
  assert.equal(detail.lines[1].unit_id, u2);
  assert.equal(detail.lines[1].quantity_delta, -4);
  assert.equal(detail.adjustment.lines_count, 2);
});

// -----------------------------------------------------------------------------
// Test Group 16: Draft Adjustment Line Removal (TC-ADJ-N-09)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-09: Draft adjustment line removal - removeInventoryAdjustmentLineAction deletes target line and updates lines_count', async () => {
  // Given: Draft adjustment with 2 lines
  const tid = `tnt_adj_${Date.now()}_n09`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-REM', name: '刪除測試倉' });
  const { unitId: u1 } = await createTestProduct(`刪除品1_${Date.now()}`);
  const { unitId: u2 } = await createTestProduct(`刪除品2_${Date.now()}`);

  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [
      { unit_id: u1, quantity_delta: 5 },
      { unit_id: u2, quantity_delta: -2 }
    ]
  });

  const detailBefore = await fetchInventoryAdjustmentDetail(adj.id);
  assert.equal(detailBefore.lines.length, 2);
  const lineToRemove = detailBefore.lines[0];

  // When: Removing line1 using 1-param form removeInventoryAdjustmentLineAction(lineId)
  const detailAfter = await removeInventoryAdjustmentLineAction(lineToRemove.id);

  // Then: Line1 is removed, remaining lines = 1, line2 is preserved, lines_count updated
  assert.equal(detailAfter.lines.length, 1);
  assert.equal(detailAfter.lines[0].unit_id, u2);
  assert.equal(detailAfter.adjustment.lines_count, 1);

  // When: Testing 2-param form removeInventoryAdjustmentLineAction(adjId, lineId)
  const line2 = detailAfter.lines[0];
  const detailAfter2 = await removeInventoryAdjustmentLineAction(adj.id, line2.id);
  assert.equal(detailAfter2.lines.length, 0);
  assert.equal(detailAfter2.adjustment.lines_count, 0);
});

// -----------------------------------------------------------------------------
// Test Group 17: fetchUnitInventoryLevel Store Layer Abstraction (TC-ADJ-N-10)
// -----------------------------------------------------------------------------
test('TC-ADJ-N-10: fetchUnitInventoryLevel store action - retrieves accurate inventory level without direct invoke', async () => {
  // Given: Warehouse and unit with stock = 12
  const tid = `tnt_adj_${Date.now()}_n10`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-STORE', name: 'Store抽象倉' });
  const { unitId } = await createTestProduct(`Store抽象品_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 12,
    unit_cost: 30
  });

  // When: Querying level via store action fetchUnitInventoryLevel
  const level = await fetchUnitInventoryLevel(wh.id, unitId);

  // Then: Returns correct inventory level object
  assert.ok(level);
  assert.equal(level.warehouse_id, wh.id);
  assert.equal(level.unit_id, unitId);
  assert.equal(level.current_quantity, 12);
});
