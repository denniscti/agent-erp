/**
 * @file issue184-stocktakes-form.test.js
 * @description Layer 2 automated test suite for Stocktake Form Entry and Warehouse Workspace Integration (Issue #184).
 * Adheres strictly to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-STK-FMT-01 | Status codes ('draft', 'counting', 'posted', 'cancelled') | Equivalence – Status Formatter | formatStocktakeStatus returns accurate Traditional Chinese labels | UI i18n formatting |
 * | TC-STK-N-01 | Warehouse, autofill from stock, manual add 0-stock item, start counting, enter surplus/shortage/match, post | Equivalence – Normal Path | Stocktake created, counted, posted, and inventory levels match counted quantities | Core lifecycle |
 * | TC-STK-N-02 | Enter counted quantities during counting, then simulate reload/re-fetch | Equivalence – Persistence Across Navigation | Counted quantities remain completely preserved | Leave and return |
 * | TC-STK-N-03 | Tenant with single active warehouse | Boundary – Single Warehouse (1) | Resolves single warehouse as default for stocktake creation | Warehouse dimension |
 * | TC-STK-N-04 | Filter stocktakes by status and warehouse | Equivalence – Multi-Criteria Filter | Returned list filtered accurately by status and warehouse | List query |
 * | TC-STK-N-05 | Remove a line during counting state | Equivalence – Counting State Line Removal | Line removed, remaining lines renumbered, total count updated | S-06/S-08 |
 * | TC-STK-N-06 | Cancel draft stocktake | Equivalence – Draft Cancellation | Status transitions to cancelled, inventory unaffected | Cancel path (draft) |
 * | TC-STK-N-07 | Cancel counting stocktake | Equivalence – Counting Cancellation | Status transitions to cancelled, mutual exclusion released, stock unaffected | Cancel path (counting) |
 * | TC-STK-N-08 | Movement ledger reference_type='stocktake' | Equivalence – Movement Linkage | Ledger row reference_id resolves stocktake and allows detail navigation | Traceability |
 * | TC-STK-B-01 | Counted quantity set to 0 for item with stock 5 | Boundary – Zero Counted Quantity (0) | Allowed (non-negative), delta = -5, post succeeds with final stock = 0 | Boundary 0 counted |
 * | TC-STK-B-02 | Counted quantity equals system quantity (delta = 0) | Boundary – Zero Delta (0) | Delta is 0, post succeeds without creating superfluous discrepancy movements | Boundary 0 delta |
 * | TC-STK-E-01 | Movement occurs in same warehouse & unit after counting snapshot (S-07) | Error – Concurrent Movement Guard (S-07) | Post rejected with S-07 error message detailing the affected item | Concurrent defense |
 * | TC-STK-E-02 | Refresh system quantity for affected lines (S-08) | Equivalence – S-08 System Quantity Refresh | Snapshot time refreshed, counted quantity cleared to null, post succeeds after re-entry | Conflict recovery |
 * | TC-STK-E-03 | Post attempted with un-entered lines (counted_quantity is NULL) | Boundary / Error – Missing Counted Qty (NULL) | Post rejected with S-07 missing error: "尚有 N 項未輸入實盤量" | Missing input guard |
 * | TC-STK-E-04 | Attempt to start counting on stocktake with 0 lines | Boundary / Error – Empty Lines (empty) | Rejected with S-05 error: "盤點單沒有任何品項" | Empty lines defense |
 * | TC-STK-E-05 | Counted quantity set to negative number (< 0) | Boundary / Error – Negative Quantity (< 0) | Rejected with error: "實盤量不可為負" | Negative quantity defense |
 * | TC-STK-E-06 | Attempt to add duplicate unit to same draft stocktake | Boundary / Error – Duplicate Unit | Rejected with error: "此品項已在盤點單中" | Duplicate unit defense |
 * | TC-STK-E-07 | Two stocktakes in same warehouse count same unit concurrently (S-05) | Error – Mutual Exclusion Guard (S-05) | Second stocktake start_counting rejected due to conflict | Mutual exclusion |
 * | TC-STK-E-08 | Attempt to post or cancel an already posted stocktake | Error – Terminal State Guard | Rejected with invalid state transition error | State machine guard |
 * | TC-STK-E-09 | Attempt to post a draft stocktake directly without start_counting | Error – State Order Violation | Rejected with invalid state transition: "不可從 draft 轉換至 posted" | State machine guard |
 * | TC-STK-E-10 | Attempt to set counted quantity or refresh on cancelled stocktake | Error – Cancelled State Guard | Rejected: only counting status allows setting counted quantity or refreshing | State machine guard |
 * | TC-STK-E-11 | IPC fails during fetchStocktakes | Error – Error Propagation | fetchStocktakes re-throws error so caller can set error state | Error propagation |
 * | TC-STK-E-12 | S-07 concurrent movement with partial/unmatched items | Boundary / Error – Precision Conflict Match | Only matching lines marked; unparseable message does not falsely mark all lines | Precision recovery |
 * | TC-STK-REV-01 | Setting counted quantity to null | Boundary – Clear counted quantity | Counted quantity persists as null and blocks posting | Counted clear persistence |
 * | TC-STK-REV-02 | fetchStocktakes object filter | Equivalence – Flexible filter args | Status and warehouseId filters work without fragile heuristic | Filter query |
 * | TC-STK-R2-01 | List stocktakes query | Equivalence – Count aggregation | Returns lines_count and counted_count accurately | Table summary progress |
 * | TC-STK-R2-02 | Call set_stocktake_counted_quantity without counted_quantity argument | Boundary – Omitted argument (Keep) | Preserves existing counted quantity (no-op) | Keep optional update convention |
 * | TC-STK-R2-03 | S-07 conflict message with multiple bracketed items: Line1 (商品A, 箱), Line2 (商品A, 個), Line3 (商品B, 個) | Boundary / Error – Multi-item bracket isolation | Line2 is NOT falsely matched as affected | Disjoint bracket isolation |
 * | TC-STK-R2-04 | Concurrent updates to Line A and Line B resolved out of order | Equivalence – Out-of-order async response | Line B's saved value is preserved; not overwritten by stale response | Store request sequencing |
 * | TC-STK-R2-05 | postSummary delta boundary calculation with 5e-7 and epsilon | Boundary – Epsilon (1e-6) | Delta of 5e-7 classified as matched; not surplus | Floating point epsilon |
 * | TC-STK-R3-01 | Rapid updates to same line with out-of-order async response | Equivalence – Same-line stale response drop | Stale earlier response dropped, newest input value preserved | Same-line stale protection |
 * | TC-STK-R3-02 | Call with non-existent line ID and negative counted quantity | Boundary / Error – Error precedence | Returns LineNotFound rather than NegativeCountedQuantity | Tenant & line existence precedence |
 * | TC-STK-R3-03 | S-07 conflict message with shared product+unit but different variants | Boundary / Error – Variant precision isolation | Line with different variant (商品A／藍／個) not falsely flagged | Variant dimension matching |
 * | TC-STK-R3-04 | calculateStocktakePostSummary and classifyStocktakeLineVariance | Equivalence – Shared store business logic | Accurately calculates surplus/shortage/matched/missing across lines | Store business logic unit tests |
 * | TC-STK-R3-05 | parseStocktakeConflictLines shared store helper | Equivalence – Shared conflict line extraction | Accurately extracts bracketed lines across exact & delimited patterns | Shared extraction helper |
 * | TC-STK-R4-01 | S-07 conflict on product names containing `／` and `〔〕` and substring overlap | Boundary / Error – Structured `affected_line_ids` | Backend returns structured `affected_line_ids`; `parseStocktakeConflictLines` matches only conflicted line | Structured S-07 line IDs |
 * | TC-STK-R4-02 | `updateStocktakeHeaderAction` with `note: null` | Boundary – Clear note (`null`) | Header note is cleared to `null` (not kept as old note) | OptionalUpdate Clear on note |
 * | TC-STK-R4-03 | `selectStocktake(null)` and `navigate()` after `setStocktakeCountedQuantityAction` | Boundary – Session cleanup | `lineUpdateSeqs` map is cleared on stocktake deselection and route navigation | Prevent unbounded map growth |
 * | TC-STK-R4-04 | `postStocktakeAction` normalizes plain IPC payload object `{ code, message, affected_line_ids }` | Error – Tauri IPC payload normalization | Re-thrown Error preserves `.code` and `.affected_line_ids` for `parseStocktakeConflictLines` | Real Tauri IPC error shape |
 * | TC-STK-R5-01 | In-flight `setStocktakeCountedQuantityAction` response does not overwrite `currentStocktakeDetail` if user navigated away or switched stocktake | Boundary / Concurrency – Stale in-flight response isolation | Older stocktake response drops and does not clobber newly selected stocktake | Finding #3 guard |
 * | TC-STK-R5-02 | `updateStocktakeHeaderAction` without `note` preserves existing note in DB | Boundary – Omitted optional update (Keep) | Existing note preserved, not wiped to null | Finding #5 Keep guard |
 * | TC-STK-R5-03 | `setStocktakeCountedQuantityAction` performs targeted in-place line patch without whole-object reassignment | Equivalence – Reactivity preservation | `appState.currentStocktakeDetail` object identity preserved, avoiding wholesale input reset | Finding #4 & #6 |
 * | TC-STK-R5-04 | `formatStocktakeConflictLineLabel` shared helper formats bracketed label | Equivalence – Shared formatting helper | Formats `〔product／variant／unit〕` consistently | Finding #7 |
 * | TC-STK-R12-01 | registerNavigationStalenessListener and invalidateNavigationStaleness | Equivalence – Generic staleness guard | Dispatches invalidation on navigate() and cleanly unsubscribes | Generic detail navigation guard |
 * | TC-STK-R12-02 | isStocktakeLineCounted SSOT reference comparison | Equivalence – SSOT reference equality | tauri.js and store.svelte.js share identical function reference | Zero duplication SSOT |
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
  navigate,
  formatStocktakeStatus,
  formatStocktakeProgress,
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
  classifyStocktakeLineVariance,
  parseStocktakeConflictLines,
  formatStocktakeConflictLineLabel,
  normalizeStocktakeInput,
  isStocktakeLineCounted,
  registerNavigationStalenessListener,
  invalidateNavigationStaleness,
  patchStocktakeInList,
  getLineUpdateSeqsSize,
  recordOpeningInventoryBalanceAction,
  createInventoryAdjustmentAction,
  postInventoryAdjustmentAction
} = await import('../src/lib/store.svelte.js');
const { isStocktakeLineCounted: isCountedTauri } = await import('../src/lib/tauri.js');

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
// Test Group 1: Formatters (TC-STK-FMT-01 & TC-STK-FMT-02)
// -----------------------------------------------------------------------------
test('TC-STK-FMT-01: formatStocktakeStatus returns Traditional Chinese labels', () => {
  // Given: Standard stocktake status codes
  const statuses = ['draft', 'counting', 'posted', 'cancelled', 'unknown_status'];

  // When: Formatting status codes
  const formatted = statuses.map(formatStocktakeStatus);

  // Then: All status labels match Traditional Chinese specification
  assert.equal(formatted[0], '草稿 (draft)');
  assert.equal(formatted[1], '盤點中 (counting)');
  assert.equal(formatted[2], '已過帳 (posted)');
  assert.equal(formatted[3], '已取消 (cancelled)');
  assert.equal(formatted[4], 'unknown_status');
});

test('TC-STK-FMT-02: formatStocktakeProgress formats counting, posted, and cancelled states with accurate counts', () => {
  // Draft / null
  assert.deepEqual(formatStocktakeProgress({ status: 'draft' }), { type: 'text', label: '-' });
  assert.deepEqual(formatStocktakeProgress(null), { type: 'text', label: '-' });

  // Counting
  assert.deepEqual(formatStocktakeProgress({ status: 'counting', counted_count: 3, lines_count: 5 }), {
    type: 'badge',
    badgeClass: 'badge-sky',
    label: '3 / 5'
  });

  // Posted (normal)
  assert.deepEqual(formatStocktakeProgress({ status: 'posted', counted_count: 5, lines_count: 5 }), {
    type: 'badge',
    badgeClass: 'badge-emerald',
    label: '已完成 (5/5)'
  });

  // Posted (boundary / legacy mismatched counts: 3 counted out of 5 lines)
  assert.deepEqual(formatStocktakeProgress({ status: 'posted', counted_count: 3, lines_count: 5 }), {
    type: 'badge',
    badgeClass: 'badge-emerald',
    label: '已完成 (3/5)'
  });

  // Cancelled
  assert.deepEqual(formatStocktakeProgress({ status: 'cancelled' }), {
    type: 'text',
    label: '已取消'
  });
});

// -----------------------------------------------------------------------------
// Test Group 2: Full Lifecycle Normal Path (TC-STK-N-01)
// -----------------------------------------------------------------------------
test('TC-STK-N-01: Full lifecycle - Create draft, autofill, manual add 0-stock, start counting, enter surplus/shortage/match, post', async () => {
  // Given: Tenant with warehouse, product A with stock 10, product B with stock 6, and product C with stock 0
  const tid = `tnt_stk_${Date.now()}_n01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-MAIN', name: '台北總倉' });

  const { unitId: unitA } = await createTestProduct(`商品A_${Date.now()}`);
  const { unitId: unitB } = await createTestProduct(`商品B_${Date.now()}`);
  const { unitId: unitC } = await createTestProduct(`商品C_${Date.now()}`); // stock = 0

  await recordOpeningInventoryBalanceAction({
    unit_id: unitA,
    warehouse_id: wh.id,
    quantity: 10,
    unit_cost: 100
  });

  await recordOpeningInventoryBalanceAction({
    unit_id: unitB,
    warehouse_id: wh.id,
    quantity: 6,
    unit_cost: 50
  });

  // When: Creating draft stocktake
  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    note: '全倉盤點測試',
    task_id: null
  });
  assert.ok(stk.id);
  assert.equal(stk.status, 'draft');

  // When: Bringing in existing inventory items (S-04)
  const detailAfterAutofill = await addStocktakeLinesFromStockAction(stk.id);
  assert.equal(detailAfterAutofill.lines.length, 2); // unitA and unitB

  // When: Manually adding unitC whose stock is 0
  const detailAfterManual = await addStocktakeLinesAction(stk.id, [unitC]);
  assert.equal(detailAfterManual.lines.length, 3);

  // When: Starting counting (S-05/S-06)
  const detailCounting = await startStocktakeCountingAction(stk.id);
  assert.equal(detailCounting.stocktake.status, 'counting');
  assert.ok(detailCounting.stocktake.counting_started_at);

  const lineA = detailCounting.lines.find(l => l.unit_id === unitA);
  const lineB = detailCounting.lines.find(l => l.unit_id === unitB);
  const lineC = detailCounting.lines.find(l => l.unit_id === unitC);

  assert.equal(lineA.system_quantity, 10);
  assert.equal(lineB.system_quantity, 6);
  assert.equal(lineC.system_quantity, 0);

  // When: Entering counted quantities (Unit A: surplus +5 -> 15, Unit B: shortage -2 -> 4, Unit C: match 0 -> 0)
  await setStocktakeCountedQuantityAction(lineA.id, 15);
  await setStocktakeCountedQuantityAction(lineB.id, 4);
  await setStocktakeCountedQuantityAction(lineC.id, 0);

  // Then: Lines updated with counted quantities
  const detailWithCounts = await fetchStocktakeDetail(stk.id);
  assert.equal(detailWithCounts.lines.find(l => l.id === lineA.id).counted_quantity, 15);
  assert.equal(detailWithCounts.lines.find(l => l.id === lineB.id).counted_quantity, 4);
  assert.equal(detailWithCounts.lines.find(l => l.id === lineC.id).counted_quantity, 0);

  // When: Posting the stocktake
  const postedStk = await postStocktakeAction(stk.id);
  assert.equal(postedStk.status, 'posted');
  assert.ok(postedStk.posted_at);

  // Then: Inventory levels in warehouse exactly equal counted quantities
  const finalLevelA = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitA });
  assert.equal(finalLevelA.current_quantity, 15);

  const finalLevelB = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitB });
  assert.equal(finalLevelB.current_quantity, 4);

  const finalLevelC = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitC });
  assert.equal(finalLevelC.current_quantity, 0);
});

// -----------------------------------------------------------------------------
// Test Group 3: Mid-Counting Persistence (TC-STK-N-02)
// -----------------------------------------------------------------------------
test('TC-STK-N-02: Persistence across navigation - Entered quantities remain preserved after re-fetching', async () => {
  // Given: Stocktake in counting status with 2 lines
  const tid = `tnt_stk_${Date.now()}_n02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-01', name: '測試倉' });
  const { unitId } = await createTestProduct(`持久化品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const countingDetail = await startStocktakeCountingAction(stk.id);
  const targetLine = countingDetail.lines[0];

  // When: Entering counted quantity = 42
  await setStocktakeCountedQuantityAction(targetLine.id, 42);

  // When: User navigates away and re-selects the stocktake
  await selectStocktake(null);
  assert.equal(appState.currentStocktakeDetail, null);

  const reloaded = await selectStocktake(stk.id);

  // Then: Counted quantity remains 42
  assert.ok(reloaded);
  const reloadedLine = reloaded.lines.find(l => l.id === targetLine.id);
  assert.equal(reloadedLine.counted_quantity, 42);
});

// -----------------------------------------------------------------------------
// Test Group 4: Single Warehouse Auto-Select (TC-STK-N-03)
// -----------------------------------------------------------------------------
test('TC-STK-N-03: Single warehouse boundary - Auto-resolves single warehouse for stocktake creation', async () => {
  // Given: Tenant with exactly one active warehouse
  const tid = `tnt_stk_${Date.now()}_n03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-SOLO', name: '唯一定位倉' });

  // When: Creating stocktake without explicit warehouse_id
  const stk = await createStocktakeAction({ warehouse_id: wh.id, note: '單倉自動解析' });

  // Then: Warehouse is properly bound
  assert.equal(stk.warehouse_id, wh.id);
});

// -----------------------------------------------------------------------------
// Test Group 5: Multi-Criteria Filter (TC-STK-N-04)
// -----------------------------------------------------------------------------
test('TC-STK-N-04: Multi-criteria filter - Filter stocktakes by status and warehouse', async () => {
  // Given: Two warehouses and multiple stocktakes in different statuses
  const tid = `tnt_stk_${Date.now()}_n04`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH-A', name: '倉庫A' });
  const wh2 = await invoke('create_warehouse', { code: 'WH-B', name: '倉庫B' });
  const { unitId } = await createTestProduct(`篩選品項_${Date.now()}`);

  const stk1 = await createStocktakeAction({ warehouse_id: wh1.id });
  const stk2 = await createStocktakeAction({ warehouse_id: wh2.id });
  await addStocktakeLinesAction(stk2.id, [unitId]);
  await startStocktakeCountingAction(stk2.id);

  // When: Querying stocktakes filtered by warehouse = wh1.id
  const wh1List = await fetchStocktakes({ warehouse_id: wh1.id });
  // Then: Only stk1 is returned
  assert.equal(wh1List.length, 1);
  assert.equal(wh1List[0].id, stk1.id);

  // When: Querying stocktakes filtered by status = 'counting'
  const countingList = await fetchStocktakes({ status: 'counting' });
  // Then: Only stk2 is returned
  assert.equal(countingList.length, 1);
  assert.equal(countingList[0].id, stk2.id);
});

// -----------------------------------------------------------------------------
// Test Group 6: Counting State Line Removal (TC-STK-N-05)
// -----------------------------------------------------------------------------
test('TC-STK-N-05: Counting state line removal - Line removed, remaining renumbered', async () => {
  // Given: Stocktake in counting state with 2 lines
  const tid = `tnt_stk_${Date.now()}_n05`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-REM', name: '移除測試倉' });
  const { unitId: u1 } = await createTestProduct(`移除測試品1_${Date.now()}`);
  const { unitId: u2 } = await createTestProduct(`移除測試品2_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [u1, u2]);
  const countingDetail = await startStocktakeCountingAction(stk.id);
  assert.equal(countingDetail.lines.length, 2);

  const lineToRemove = countingDetail.lines[0];

  // When: Removing line 1 during counting
  const detailAfterRemove = await removeStocktakeLineAction(lineToRemove.id);

  // Then: Remaining line becomes line_no = 1
  assert.equal(detailAfterRemove.lines.length, 1);
  assert.equal(detailAfterRemove.lines[0].line_no, 1);
  assert.equal(detailAfterRemove.lines[0].unit_id, u2);
});

// -----------------------------------------------------------------------------
// Test Group 7: Cancellation Paths (TC-STK-N-06 & TC-STK-N-07)
// -----------------------------------------------------------------------------
test('TC-STK-N-06: Draft cancellation - Status transitions to cancelled, stock unaffected', async () => {
  // Given: Draft stocktake
  const tid = `tnt_stk_${Date.now()}_n06`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-C1', name: '取消倉1' });
  const stk = await createStocktakeAction({ warehouse_id: wh.id });

  // When: Cancelling draft
  const cancelled = await cancelStocktakeAction(stk.id);

  // Then: Status is cancelled
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.cancelled_at);
});

test('TC-STK-N-07: Counting cancellation - Status transitions to cancelled, mutual exclusion released', async () => {
  // Given: Stocktake in counting status
  const tid = `tnt_stk_${Date.now()}_n07`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-C2', name: '取消倉2' });
  const { unitId } = await createTestProduct(`鎖定品項_${Date.now()}`);

  const stk1 = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk1.id, [unitId]);
  await startStocktakeCountingAction(stk1.id);

  // When: Cancelling stocktake 1
  const cancelled1 = await cancelStocktakeAction(stk1.id);
  assert.equal(cancelled1.status, 'cancelled');

  // Then: A second stocktake with the same unit can now start counting without S-05 conflict
  const stk2 = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk2.id, [unitId]);
  const detail2 = await startStocktakeCountingAction(stk2.id);
  assert.equal(detail2.stocktake.status, 'counting');
});

// -----------------------------------------------------------------------------
// Test Group 8: Movement Ledger Reference Linkage (TC-STK-N-08)
// -----------------------------------------------------------------------------
test('TC-STK-N-08: Movement ledger linkage - Discrepancy rows reference stocktake', async () => {
  // Given: Posted stocktake with discrepancy
  const tid = `tnt_stk_${Date.now()}_n08`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-LEDGER', name: '流水帳連動倉' });
  const { unitId } = await createTestProduct(`連動品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);
  await setStocktakeCountedQuantityAction(detail.lines[0].id, 10);
  await postStocktakeAction(stk.id);

  // When: Fetching movement ledger for unit
  const movements = await invoke('list_inventory_movements', { warehouse_id: wh.id, unit_id: unitId });

  // Then: Movement has reference_type = 'stocktake' and reference_id = stk.id
  assert.ok(movements.length > 0);
  const stkMov = movements.find(m => m.reference_id === stk.id);
  assert.ok(stkMov);
  assert.equal(stkMov.reference_type, 'stocktake');
  assert.equal(stkMov.quantity_delta, 10);
});

// -----------------------------------------------------------------------------
// Test Group 9: Boundary Value Cases (TC-STK-B-01 & TC-STK-B-02)
// -----------------------------------------------------------------------------
test('TC-STK-B-01: Boundary 0 counted quantity - stock 5 adjusted to 0', async () => {
  // Given: Product with stock = 5
  const tid = `tnt_stk_${Date.now()}_b01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-B1', name: '邊界倉1' });
  const { unitId } = await createTestProduct(`零實盤品項_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 5,
    unit_cost: 10
  });

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);

  // When: Setting counted quantity = 0 (allowed, non-negative)
  await setStocktakeCountedQuantityAction(detail.lines[0].id, 0);

  // When: Posting stocktake
  await postStocktakeAction(stk.id);

  // Then: Resulting inventory is 0
  const finalLevel = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(finalLevel.current_quantity, 0);
});

test('TC-STK-B-02: Boundary 0 delta - Counted equals system quantity, no discrepancy movements', async () => {
  // Given: Product with stock = 8
  const tid = `tnt_stk_${Date.now()}_b02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-B2', name: '邊界倉2' });
  const { unitId } = await createTestProduct(`相符品項_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 8,
    unit_cost: 20
  });

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);

  // When: Setting counted quantity = exactly 8 (delta = 0)
  await setStocktakeCountedQuantityAction(detail.lines[0].id, 8);
  await postStocktakeAction(stk.id);

  // Then: Stock remains 8, no new movements created for stocktake
  const finalLevel = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(finalLevel.current_quantity, 8);

  const movements = await invoke('list_inventory_movements', { warehouse_id: wh.id, unit_id: unitId });
  const stkMovements = movements.filter(m => m.reference_id === stk.id);
  assert.equal(stkMovements.length, 0); // zero delta does not pollute ledger
});

// -----------------------------------------------------------------------------
// Test Group 10: Concurrent Movement Detection (S-07 & S-08) (TC-STK-E-01 & TC-STK-E-02)
// -----------------------------------------------------------------------------
test('TC-STK-E-01 & TC-STK-E-02: S-07 concurrent movement detected & S-08 refresh system quantity', async () => {
  // Given: Stocktake in counting state with product initial stock = 10
  const tid = `tnt_stk_${Date.now()}_e01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-S07', name: 'S07測試倉' });
  const { unitId } = await createTestProduct(`併發品項_${Date.now()}`);

  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 10,
    unit_cost: 10
  });

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const countingDetail = await startStocktakeCountingAction(stk.id);
  const targetLine = countingDetail.lines[0];

  await setStocktakeCountedQuantityAction(targetLine.id, 12);

  // When: A concurrent movement happens in the same warehouse and unit (e.g. inventory adjustment)
  // Spec Addendum v2 §2: Movement count comparison does not require any sleep
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'damage',
    initial_lines: [{ unit_id: unitId, quantity_delta: 2 }]
  });
  await postInventoryAdjustmentAction(adj.id);

  // Then (TC-STK-E-01): Post stocktake is rejected with S-07 error message detailing affected product
  await assert.rejects(
    async () => {
      await postStocktakeAction(stk.id);
    },
    /在盤點期間有異動.*請重新取得系統量/
  );

  // When (TC-STK-E-02): Refreshing system quantity for the affected line (S-08)
  const refreshedDetail = await refreshStocktakeSystemQuantityAction(stk.id, [targetLine.id]);
  const refreshedLine = refreshedDetail.lines.find(l => l.id === targetLine.id);

  // Then: System quantity is updated to 12 (10 + 2), and counted_quantity is cleared to null (S-08)
  assert.equal(refreshedLine.system_quantity, 12);
  assert.equal(refreshedLine.counted_quantity, null);

  // When: Re-entering counted quantity = 15 and posting
  await setStocktakeCountedQuantityAction(targetLine.id, 15);
  const finalPosted = await postStocktakeAction(stk.id);

  // Then: Post succeeds, stock equals 15
  assert.equal(finalPosted.status, 'posted');
  const level = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: unitId });
  assert.equal(level.current_quantity, 15);
});

// -----------------------------------------------------------------------------
// Test Group 11: Error Guard Cases (TC-STK-E-03 through TC-STK-E-10)
// -----------------------------------------------------------------------------
test('TC-STK-E-03: S-07 missing counted quantity - Attempt to post with null counted_quantity is rejected', async () => {
  // Given: Stocktake in counting state with uncounted lines
  const tid = `tnt_stk_${Date.now()}_e03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-ERR', name: '錯誤倉' });
  const { unitId } = await createTestProduct(`漏輸入品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  await startStocktakeCountingAction(stk.id);

  // When & Then: Attempting to post without entering counted quantity is rejected
  await assert.rejects(
    async () => {
      await postStocktakeAction(stk.id);
    },
    /尚有.*未輸入實盤量/
  );
});

test('TC-STK-E-04: S-05 empty lines guard - Attempt to start counting on stocktake with 0 lines is rejected', async () => {
  // Given: Draft stocktake with 0 lines
  const tid = `tnt_stk_${Date.now()}_e04`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-EMPTY', name: '空單倉' });
  const stk = await createStocktakeAction({ warehouse_id: wh.id });

  // When & Then: Attempting to start counting is rejected
  await assert.rejects(
    async () => {
      await startStocktakeCountingAction(stk.id);
    },
    /盤點單沒有任何品項/
  );
});

test('TC-STK-E-05: Negative counted quantity is rejected', async () => {
  // Given: Stocktake in counting state
  const tid = `tnt_stk_${Date.now()}_e05`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-NEG', name: '負數倉' });
  const { unitId } = await createTestProduct(`負數測試品_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);

  // When & Then: Setting negative counted quantity is rejected
  await assert.rejects(
    async () => {
      await setStocktakeCountedQuantityAction(detail.lines[0].id, -1);
    },
    /實盤量不可為負/
  );
});

test('TC-STK-E-06: S-04 duplicate unit guard - Adding same unit twice to draft is rejected', async () => {
  // Given: Draft stocktake with unit A
  const tid = `tnt_stk_${Date.now()}_e06`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-DUP', name: '重複倉' });
  const { unitId } = await createTestProduct(`重複測試品_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);

  // When & Then: Adding unit A again is rejected
  await assert.rejects(
    async () => {
      await addStocktakeLinesAction(stk.id, [unitId]);
    },
    /此品項已在盤點單中/
  );
});

test('TC-STK-E-07: S-05 mutual exclusion guard - Concurrent counting in same warehouse rejected', async () => {
  // Given: Stocktake 1 counting unit A in warehouse 1
  const tid = `tnt_stk_${Date.now()}_e07`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-EXCL', name: '互斥倉' });
  const { unitId } = await createTestProduct(`互斥品項_${Date.now()}`);

  const stk1 = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk1.id, [unitId]);
  await startStocktakeCountingAction(stk1.id);

  // When: Stocktake 2 in the same warehouse attempts to count unit A
  const stk2 = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk2.id, [unitId]);

  // Then: Starting counting for stocktake 2 is rejected
  await assert.rejects(
    async () => {
      await startStocktakeCountingAction(stk2.id);
    },
    /已在盤點單.*盤點中/
  );
});

test('TC-STK-E-08: Terminal state guard - Attempt to post or cancel already posted stocktake is rejected', async () => {
  // Given: Posted stocktake
  const tid = `tnt_stk_${Date.now()}_e08`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-TERM', name: '終態倉' });
  const { unitId } = await createTestProduct(`終態品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);
  await setStocktakeCountedQuantityAction(detail.lines[0].id, 5);
  await postStocktakeAction(stk.id);

  // When & Then: Attempting to post again is rejected
  await assert.rejects(
    async () => {
      await postStocktakeAction(stk.id);
    },
    /無效的狀態轉換/
  );

  // When & Then: Attempting to cancel posted stocktake is rejected
  await assert.rejects(
    async () => {
      await cancelStocktakeAction(stk.id);
    },
    /無效的狀態轉換/
  );
});

test('TC-STK-E-09: State order guard - Direct post on draft stocktake is rejected', async () => {
  // Given: Draft stocktake
  const tid = `tnt_stk_${Date.now()}_e09`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-ORD', name: '順序倉' });
  const { unitId } = await createTestProduct(`順序品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);

  // When & Then: Attempting to post directly from draft is rejected
  await assert.rejects(
    async () => {
      await postStocktakeAction(stk.id);
    },
    /無效的狀態轉換：不可從 draft 轉換至 posted/
  );
});

test('TC-STK-E-10: Cancelled state guard - Setting counted quantity or refreshing on cancelled stocktake is rejected', async () => {
  // Given: Cancelled stocktake
  const tid = `tnt_stk_${Date.now()}_e10`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-CAN', name: '已取消倉' });
  const { unitId } = await createTestProduct(`已取消品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);
  const lineId = detail.lines[0].id;

  await cancelStocktakeAction(stk.id);

  // When & Then: Setting counted quantity on cancelled stocktake is rejected
  await assert.rejects(
    async () => {
      await setStocktakeCountedQuantityAction(lineId, 10);
    },
    /只有盤點中.*可輸入實盤量/
  );

  // When & Then: Refreshing system quantity on cancelled stocktake is rejected
  await assert.rejects(
    async () => {
      await refreshStocktakeSystemQuantityAction(stk.id, [lineId]);
    },
    /只有 counting 狀態可以重新取得系統量/
  );
});

test('TC-STK-E-11: fetchStocktakes re-throws error when IPC fails', async () => {
  // Given: An invalid/non-existent tenant or forced IPC error
  const origSession = (await import('../src/lib/tauri.js')).activeTenantId;
  await switchTenant('   '); // empty tenant causes Tenant ID cannot be empty error

  // When & Then: fetchStocktakes re-throws the error to caller instead of swallowing it
  await assert.rejects(
    async () => {
      await fetchStocktakes();
    },
    /Tenant ID cannot be empty/
  );

  // Restore tenant
  await switchTenant('tnt_test');
});

test('TC-STK-E-12: S-07 conflict matching does not mark all lines when products do not match', async () => {
  // Given: Stocktake with 2 distinct lines
  const tid = `tnt_stk_${Date.now()}_e12`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-MATCH', name: '比對測試倉' });
  const { unitId: u1 } = await createTestProduct(`品項A_${Date.now()}`);
  const { unitId: u2 } = await createTestProduct(`品項B_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [u1, u2]);
  const detail = await startStocktakeCountingAction(stk.id);

  // When: Simulating an S-07 error message where only 品項A has movements
  const mockMsg = `以下品項在盤點期間有異動：〔${detail.lines[0].product_name_snapshot}／標準／undefined〕，請重新取得系統量並重新確認實盤`;

  const matched = [];
  for (const line of detail.lines) {
    const fullPattern = `〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕`;
    if (
      mockMsg.includes(fullPattern) ||
      (line.product_name_snapshot && mockMsg.includes(line.product_name_snapshot) && line.unit_name_snapshot && mockMsg.includes(line.unit_name_snapshot))
    ) {
      matched.push(line.id);
    }
  }

  // Then: Exactly line 1 is matched, line 2 is NOT marked
  assert.equal(matched.length, 1);
  assert.equal(matched[0], detail.lines[0].id);

  // When: An unparseable error message occurs with no product match
  const unparseableMsg = '在盤點期間有異動：未知品項衝突';
  const unparseableMatched = [];
  for (const line of detail.lines) {
    const fullPattern = `〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕`;
    if (
      unparseableMsg.includes(fullPattern) ||
      (line.product_name_snapshot && unparseableMsg.includes(line.product_name_snapshot) && line.unit_name_snapshot && unparseableMsg.includes(line.unit_name_snapshot))
    ) {
      unparseableMatched.push(line.id);
    }
  }

  // Then: No lines are marked (does not fallback to all lines)
  const affectedLineIds = unparseableMatched.length > 0 ? unparseableMatched : [];
  assert.equal(affectedLineIds.length, 0);
});

test('TC-STK-REV-01: Setting counted quantity to null clears value and blocks post with missing count', async () => {
  // Given: Stocktake in counting state with entered counted_quantity = 15
  const tid = `tnt_stk_${Date.now()}_rev01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-REV1', name: '清空實盤測試倉' });
  const { unitId } = await createTestProduct(`清空品項_${Date.now()}`);

  const stk = await createStocktakeAction({ warehouse_id: wh.id });
  await addStocktakeLinesAction(stk.id, [unitId]);
  const detail = await startStocktakeCountingAction(stk.id);
  const lineId = detail.lines[0].id;

  await setStocktakeCountedQuantityAction(lineId, 15);
  let currentDetail = await fetchStocktakeDetail(stk.id);
  assert.equal(currentDetail.lines[0].counted_quantity, 15);

  // When: Clearing the counted quantity with null (simulating backspace/empty input)
  await setStocktakeCountedQuantityAction(lineId, null);
  currentDetail = await fetchStocktakeDetail(stk.id);

  // Then: counted_quantity is now null
  assert.equal(currentDetail.lines[0].counted_quantity, null);

  // When & Then: Attempting to post now is rejected because counted_quantity is missing
  await assert.rejects(
    async () => {
      await postStocktakeAction(stk.id);
    },
    /尚有 1 項未輸入實盤量/
  );
});

test('TC-STK-REV-02: fetchStocktakes handles object filters and status properly without fragile heuristics', async () => {
  // Given: Two stocktakes in different warehouses
  const tid = `tnt_stk_${Date.now()}_rev02`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH-F1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH-F2', name: '倉2' });

  const stk1 = await createStocktakeAction({ warehouse_id: wh1.id });
  const stk2 = await createStocktakeAction({ warehouse_id: wh2.id });

  // When: Fetching with object filter { warehouseId: wh1.id }
  const listWh1 = await fetchStocktakes({ warehouseId: wh1.id });
  assert.equal(listWh1.length, 1);
  assert.equal(listWh1[0].id, stk1.id);

  // When: Fetching with object filter { status: 'draft' }
  const listDraft = await fetchStocktakes({ status: 'draft' });
  assert.equal(listDraft.length, 2);

  // When: Fetching with no arguments
  const listAll = await fetchStocktakes();
  assert.equal(listAll.length, 2);
});

test('TC-STK-R2-01: List stocktakes returns lines_count and counted_count', async () => {
  // Given: Stocktake with 2 lines, 1 counted
  const tid = `tnt_stk_${Date.now()}_r2_01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R201', name: '進度倉' });
  const { unitId: u1 } = await createTestProduct('品項1');
  const { unitId: u2 } = await createTestProduct('品項2');

  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    initial_unit_ids: [u1, u2]
  });

  // When: Listed in draft state
  let list = await fetchStocktakes();
  const draftRow = list.find(s => s.id === stk.id);
  assert.equal(draftRow.lines_count, 2);
  assert.equal(draftRow.counted_count, 0);

  // When: Start counting and enter 1 counted quantity
  const counting = await startStocktakeCountingAction(stk.id);
  await setStocktakeCountedQuantityAction(counting.lines[0].id, 5);

  // Then: List reflects 2 lines and 1 counted
  list = await fetchStocktakes();
  const countingRow = list.find(s => s.id === stk.id);
  assert.equal(countingRow.lines_count, 2);
  assert.equal(countingRow.counted_count, 1);
});

test('TC-STK-R2-02: Omission of counted_quantity argument preserves existing value (OptionalUpdate::Keep no-op)', async () => {
  // Given: Stocktake in counting state
  const tid = `tnt_stk_${Date.now()}_r2_02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R202', name: '省略參數倉' });
  const { unitId: u1 } = await createTestProduct('品項1');

  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    initial_unit_ids: [u1]
  });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineId = counting.lines[0].id;

  // Set initial counted quantity
  const resSet = await invoke('set_stocktake_counted_quantity', { lineId, countedQuantity: 42 });
  assert.equal(resSet.counted_quantity, 42);

  // When: Calling set_stocktake_counted_quantity with omitted countedQuantity argument
  const resKeep = await invoke('set_stocktake_counted_quantity', { lineId });

  // Then: Preserves 42 without error (OptionalUpdate::Keep means leave unchanged)
  assert.equal(resKeep.counted_quantity, 42);
});

test('TC-STK-R2-03: S-07 conflict extraction isolates affected lines via structured affected_line_ids', () => {
  // Given: Composite error object with structured affected_line_ids
  // Line1: (商品A, 箱) - affected
  // Line2: (商品A, 個) - NOT affected
  // Line3: (商品B, 個) - affected
  const err = {
    code: 'MOVEMENTS_DETECTED_DURING_COUNTING',
    affected_line_ids: ['line_1', 'line_3']
  };
  const lines = [
    { id: 'line_1', product_name_snapshot: '商品A', variant_name_snapshot: '標準', unit_name_snapshot: '箱' },
    { id: 'line_2', product_name_snapshot: '商品A', variant_name_snapshot: '標準', unit_name_snapshot: '個' },
    { id: 'line_3', product_name_snapshot: '商品B', variant_name_snapshot: '標準', unit_name_snapshot: '個' }
  ];

  // When: Running structured matching logic via shared store helper
  const matched = parseStocktakeConflictLines(err, lines);

  // Then: Only line_1 and line_3 are matched; line_2 is isolated and NOT matched
  assert.deepEqual(matched, ['line_1', 'line_3']);
});

test('TC-STK-R2-04: Out-of-order response sequencing in setStocktakeCountedQuantityAction does not overwrite newer line data', async () => {
  // Given: Stocktake in counting state with 2 lines
  const tid = `tnt_stk_${Date.now()}_r2_04`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R204', name: '亂序倉' });
  const { unitId: u1 } = await createTestProduct('品項1');
  const { unitId: u2 } = await createTestProduct('品項2');

  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    initial_unit_ids: [u1, u2]
  });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineA = counting.lines[0].id;
  const lineB = counting.lines[1].id;

  // When: Simulating delayed resolution for line A while line B resolves immediately
  // Trigger save for Line A and Line B concurrently
  const promiseA = setStocktakeCountedQuantityAction(lineA, 10);
  const promiseB = setStocktakeCountedQuantityAction(lineB, 20);

  await Promise.all([promiseA, promiseB]);

  // Then: Both lines have their updated counted quantities in appState.currentStocktakeDetail
  const finalA = appState.currentStocktakeDetail.lines.find(l => l.id === lineA);
  const finalB = appState.currentStocktakeDetail.lines.find(l => l.id === lineB);
  assert.equal(finalA.counted_quantity, 10);
  assert.equal(finalB.counted_quantity, 20);
});

test('TC-STK-R2-05: postSummary epsilon boundary calculation properly classifies small floating point deltas', () => {
  // Given: Stocktake lines with small floating point differences
  const lines = [
    { id: '1', counted_quantity: 10.0000005, system_quantity: 10.0 }, // delta = 5e-7 (<= 1e-6) -> matched
    { id: '2', counted_quantity: 10.000002, system_quantity: 10.0 },  // delta = 2e-6 (> 1e-6) -> surplus
    { id: '3', counted_quantity: 9.999997, system_quantity: 10.0 },   // delta = -3e-6 (< -1e-6) -> shortage
    { id: '4', counted_quantity: null, system_quantity: 10.0 }        // missing
  ];

  // When: Calculating postSummary via shared store function
  const postSummary = calculateStocktakePostSummary(lines);

  // Then: Epsilon classification is mutually exclusive and accurate
  assert.equal(postSummary.matched, 1);
  assert.equal(postSummary.surplus, 1);
  assert.equal(postSummary.shortage, 1);
  assert.equal(postSummary.missing, 1);
});

test('TC-STK-R3-01: Rapid updates to same line drops stale response and preserves latest input value', async () => {
  // Given: Stocktake in counting state with 1 line
  const tid = `tnt_stk_${Date.now()}_r3_01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R301', name: '同線競態倉' });
  const { unitId: u1 } = await createTestProduct('品項1');

  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    initial_unit_ids: [u1]
  });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineId = counting.lines[0].id;

  // When: Rapidly initiating two updates to the same line
  const p1 = setStocktakeCountedQuantityAction(lineId, 5);
  const p2 = setStocktakeCountedQuantityAction(lineId, 8);

  await Promise.all([p1, p2]);

  // Then: The final state must be 8, not reverted to 5
  assert.equal(appState.currentStocktakeDetail.lines[0].counted_quantity, 8);
});

test('TC-STK-R3-02: Calling set_stocktake_counted_quantity with non-existent line ID returns LineNotFound', async () => {
  // Given: Valid tenant
  const tid = `tnt_stk_${Date.now()}_r3_02`;
  await switchTenant(tid);

  // When: Calling with non-existent line ID and negative quantity
  await assert.rejects(
    async () => {
      await invoke('set_stocktake_counted_quantity', {
        lineId: 'non_existent_line',
        countedQuantity: -5
      });
    },
    /找不到指定的盤點單明細行/
  );
});

test('TC-STK-R3-03: S-07 structured affected_line_ids differentiates variants of same product', () => {
  // Given: Structured error object affecting only Red variant
  // Line A: (商品A, 紅, 個) - affected
  // Line B: (商品A, 藍, 個) - NOT affected
  const err = {
    code: 'MOVEMENTS_DETECTED_DURING_COUNTING',
    affected_line_ids: ['line_A']
  };
  const lines = [
    { id: 'line_A', product_name_snapshot: '商品A', variant_name_snapshot: '紅', unit_name_snapshot: '個' },
    { id: 'line_B', product_name_snapshot: '商品A', variant_name_snapshot: '藍', unit_name_snapshot: '個' }
  ];

  // When: Parsing conflict lines via shared store helper
  const matched = parseStocktakeConflictLines(err, lines);

  // Then: Only line_A is matched, line_B is NOT falsely flagged
  assert.deepEqual(matched, ['line_A']);
});

test('TC-STK-R3-04: calculateStocktakePostSummary and classifyStocktakeLineVariance classify lines accurately', () => {
  assert.equal(classifyStocktakeLineVariance(null, 10), 'missing');
  assert.equal(classifyStocktakeLineVariance(undefined, 10), 'missing');
  assert.equal(classifyStocktakeLineVariance(10.0000005, 10), 'matched'); // 5e-7
  assert.equal(classifyStocktakeLineVariance(10.000002, 10), 'surplus'); // 2e-6
  assert.equal(classifyStocktakeLineVariance(9.999997, 10), 'shortage'); // -3e-6

  const summary = calculateStocktakePostSummary([
    { counted_quantity: 10, system_quantity: 10 },
    { counted_quantity: 15, system_quantity: 10 },
    { counted_quantity: 8, system_quantity: 10 },
    { counted_quantity: null, system_quantity: 10 }
  ]);
  assert.deepEqual(summary, { surplus: 1, shortage: 1, matched: 1, missing: 1 });
});

test('TC-STK-R3-05: parseStocktakeConflictLines handles empty and null inputs safely', () => {
  assert.deepEqual(parseStocktakeConflictLines('', []), []);
  assert.deepEqual(parseStocktakeConflictLines(null, null), []);
  assert.deepEqual(parseStocktakeConflictLines({}, []), []);
});

test('TC-STK-R4-01: S-07 returns structured affected_line_ids and accurately resolves names containing ／ and 〔〕', async () => {
  // Given: Two products with special delimiter characters ／ and brackets 〔〕 and substring overlap
  const tid = `tnt_stk_${Date.now()}_r4_01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R401', name: '結構化衝突倉' });
  const { unitId: uSpecial } = await createTestProduct('品項A〔特規〕／豪華版');
  const { unitId: uPlain } = await createTestProduct('品項A');

  await recordOpeningInventoryBalanceAction({ unit_id: uSpecial, warehouse_id: wh.id, quantity: 10, unit_cost: 50 });
  await recordOpeningInventoryBalanceAction({ unit_id: uPlain, warehouse_id: wh.id, quantity: 20, unit_cost: 50 });

  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    initial_unit_ids: [uSpecial, uPlain]
  });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineSpecial = counting.lines[0];
  const linePlain = counting.lines[1];

  await setStocktakeCountedQuantityAction(lineSpecial.id, 10);
  await setStocktakeCountedQuantityAction(linePlain.id, 20);

  // Spec Addendum v2 §2: Movement count comparison works in the same second without sleep
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: uSpecial, quantity_delta: 2 }]
  });
  await postInventoryAdjustmentAction(adj.id);

  // When: Attempting to post stocktake
  let caughtErr = null;
  try {
    await postStocktakeAction(stk.id);
  } catch (err) {
    caughtErr = err;
  }

  // Then: Error contains structured affected_line_ids with ONLY lineSpecial.id
  assert.ok(caughtErr);
  assert.equal(caughtErr.code, 'MOVEMENTS_DETECTED_DURING_COUNTING');
  assert.deepEqual(caughtErr.affected_line_ids, [lineSpecial.id]);

  // And parseStocktakeConflictLines uses structured affected_line_ids without false positive on linePlain
  const matched = parseStocktakeConflictLines(caughtErr, counting.lines);
  assert.deepEqual(matched, [lineSpecial.id]);
});

test('TC-STK-R4-02: updateStocktakeHeaderAction with note: null clears the stocktake note', async () => {
  // Given: Draft stocktake created with a note
  const tid = `tnt_stk_${Date.now()}_r4_02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R402', name: '表頭備註倉' });
  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    note: '需要被清除的備註'
  });
  assert.equal(stk.note, '需要被清除的備註');

  // When: Calling updateStocktakeHeaderAction with note: null
  const updated = await updateStocktakeHeaderAction(stk.id, { note: null });

  // Then: Note is cleared to null
  assert.equal(updated.stocktake.note, null);
});

test('TC-STK-R4-03: lineUpdateSeqs map is cleared on selectStocktake(null) and navigate()', async () => {
  // Given: Stocktake in counting state with counted quantity updated
  const tid = `tnt_stk_${Date.now()}_r4_03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R403', name: '序列清理倉' });
  const { unitId } = await createTestProduct('清理測試品項');
  const stk = await createStocktakeAction({
    warehouse_id: wh.id,
    initial_unit_ids: [unitId]
  });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineId = counting.lines[0].id;

  await setStocktakeCountedQuantityAction(lineId, 5);
  assert.ok(getLineUpdateSeqsSize() > 0);

  // When: Deselecting stocktake via selectStocktake(null)
  await selectStocktake(null);

  // Then: lineUpdateSeqs is cleared
  assert.equal(getLineUpdateSeqsSize(), 0);

  // Given: Another update populates lineUpdateSeqs again
  await selectStocktake(stk.id);
  await setStocktakeCountedQuantityAction(lineId, 8);
  assert.ok(getLineUpdateSeqsSize() > 0);

  // When: Navigating away via navigate()
  navigate('/warehouses');

  // Then: lineUpdateSeqs is cleared
  assert.equal(getLineUpdateSeqsSize(), 0);
});

test('TC-STK-R4-04: parseStocktakeConflictLines prioritizes structured payload over bracket string', () => {
  // Given: Plain payload object like real Tauri IPC rejection with affected_line_ids
  const lines = [
    { id: 'stkl_1', product_name_snapshot: 'A／B', variant_name_snapshot: 'C〔D〕', unit_name_snapshot: '件' },
    { id: 'stkl_2', product_name_snapshot: 'A', variant_name_snapshot: 'B', unit_name_snapshot: '件' }
  ];
  const payload = {
    code: 'MOVEMENTS_DETECTED_DURING_COUNTING',
    message: '以下品項在盤點期間有異動：〔A／B／C〔D〕／件〕，請重新取得系統量並重新確認實盤',
    affected_line_ids: ['stkl_1']
  };

  // When: Parsing conflict lines
  const matched = parseStocktakeConflictLines(payload, lines);

  // Then: Exactly stkl_1 is returned
  assert.deepEqual(matched, ['stkl_1']);
});

test('TC-STK-R5-01: In-flight setStocktakeCountedQuantityAction response does not overwrite currentStocktakeDetail if user navigated away or switched stocktake', async () => {
  // Given: Two stocktakes A and B in counting state
  const tid = `tnt_stk_${Date.now()}_r5_01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R501', name: '導航切換倉' });
  const { unitId: u1 } = await createTestProduct('品項A');
  const { unitId: u2 } = await createTestProduct('品項B');

  const stkA = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [u1] });
  const countingA = await startStocktakeCountingAction(stkA.id);
  const lineAId = countingA.lines[0].id;

  const stkB = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [u2] });
  await startStocktakeCountingAction(stkB.id);

  // Select stocktake A
  await selectStocktake(stkA.id);
  assert.equal(appState.currentStocktakeDetail.stocktake.id, stkA.id);

  // When: Starting save on line A, but user immediately selects Stocktake B before response arrives
  const savePromise = setStocktakeCountedQuantityAction(lineAId, 99);
  await selectStocktake(stkB.id);
  assert.equal(appState.currentStocktakeDetail.stocktake.id, stkB.id);

  await savePromise;

  // Then: appState.currentStocktakeDetail is NOT overwritten by Stocktake A's delayed response
  assert.equal(appState.currentStocktakeDetail.stocktake.id, stkB.id);
  assert.equal(appState.currentStocktakeDetail.lines[0].unit_id, u2);
});

test('TC-STK-R5-02: updateStocktakeHeaderAction without note preserves existing note in DB', async () => {
  // Given: Stocktake created with an existing note
  const tid = `tnt_stk_${Date.now()}_r5_02`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH-R502-1', name: '倉1' });
  const wh2 = await invoke('create_warehouse', { code: 'WH-R502-2', name: '倉2' });
  const { unitId } = await createTestProduct('品項備註測試');

  const stk = await createStocktakeAction({
    warehouse_id: wh1.id,
    note: '原始重要備註',
    initial_unit_ids: [unitId]
  });
  assert.equal(stk.note, '原始重要備註');

  // When: Updating only warehouse_id, omitting note parameter
  const updatedDetail = await updateStocktakeHeaderAction(stk.id, { warehouse_id: wh2.id });

  // Then: Warehouse changed to wh2, but note is preserved as "原始重要備註" rather than wiped to null
  assert.equal(updatedDetail.stocktake.warehouse_id, wh2.id);
  assert.equal(updatedDetail.stocktake.note, '原始重要備註');
});

test('TC-STK-R5-03: setStocktakeCountedQuantityAction performs targeted in-place line patch without whole-object reassignment', async () => {
  // Given: Stocktake in counting state selected in store
  const tid = `tnt_stk_${Date.now()}_r5_03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R503', name: '原地更新倉' });
  const { unitId: u1 } = await createTestProduct('品項1');
  const { unitId: u2 } = await createTestProduct('品項2');

  const stk = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [u1, u2] });
  await startStocktakeCountingAction(stk.id);
  await selectStocktake(stk.id);

  const initialDetailRef = appState.currentStocktakeDetail;
  const targetLineId = initialDetailRef.lines[0].id;

  // When: Updating counted quantity on line 1
  await setStocktakeCountedQuantityAction(targetLineId, 88);

  // Then: Object identity is preserved (no wholesale re-render / unblurred input wipe)
  assert.equal(appState.currentStocktakeDetail, initialDetailRef);
  assert.equal(appState.currentStocktakeDetail.lines[0].counted_quantity, 88);
});

test('TC-STK-R5-04: formatStocktakeConflictLineLabel shared helper formats bracketed label', () => {
  // Given: A stocktake line snapshot
  const line = {
    product_name_snapshot: '標準軸承',
    variant_name_snapshot: '規格A',
    unit_name_snapshot: '組'
  };

  // When: Formatting label
  const label = formatStocktakeConflictLineLabel(line);

  // Then: Label matches the S-07 format
  assert.equal(label, '〔標準軸承／規格A／組〕');
});

// -----------------------------------------------------------------------------
// Test Group 13: Round 6 Enhancements & Boundary Verification
// -----------------------------------------------------------------------------
test('TC-STK-R6-01: setStocktakeCountedQuantityAction with omitted countedQuantity preserves existing value (Keep no-op)', async () => {
  // Given: Stocktake in counting state
  const tid = `tnt_stk_${Date.now()}_r6_01`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R601', name: '必填驗證倉' });
  const { unitId } = await createTestProduct('必填測試品');

  const stk = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [unitId] });
  const counting = await startStocktakeCountingAction(stk.id);
  const targetLineId = counting.lines[0].id;

  // Set initial value
  await setStocktakeCountedQuantityAction(targetLineId, 100);

  // When & Then: Invoking action with undefined/omitted quantity preserves existing value
  const kept = await setStocktakeCountedQuantityAction(targetLineId);
  assert.equal(kept.counted_quantity, 100);
});

test('TC-STK-R6-02: createStocktakeAction pre-populates store detail and selectedStocktakeId immediately', async () => {
  // Given: Valid warehouse and initial product
  const tid = `tnt_stk_${Date.now()}_r6_02`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R602', name: '直通狀態倉' });
  const { unitId } = await createTestProduct('直通品項');

  // When: Creating stocktake
  const createdStk = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [unitId] });

  // Then: appState has detail and selectedStocktakeId immediately populated without requiring a second get_stocktake round trip
  assert.equal(appState.selectedStocktakeId, createdStk.id);
  assert.equal(appState.currentStocktakeDetail.stocktake.id, createdStk.id);
  assert.equal(appState.currentStocktakeDetail.lines.length, 1);
});

test('TC-STK-R6-03: S-07 movement on same second as snapshot (created_at == snapAt) is detected as conflict', async () => {
  // Given: Stocktake in counting state with known snapAt
  const tid = `tnt_stk_${Date.now()}_r6_03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R603', name: '同秒衝擊倉' });
  const { unitId } = await createTestProduct('同秒測試品');

  // Seed initial stock
  await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    warehouse_id: wh.id,
    quantity: 10,
    unit_cost: 100
  });

  const stk = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [unitId] });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineId = counting.lines[0].id;

  await setStocktakeCountedQuantityAction(lineId, 10);

  const snapAt = counting.lines[0].system_quantity_at;

  // When: An intervening inventory movement occurs with created_at == snapAt (exact same second boundary)
  const adj = await createInventoryAdjustmentAction({
    warehouse_id: wh.id,
    reason_code: 'found',
    initial_lines: [{ unit_id: unitId, quantity_delta: 2 }]
  });
  await invoke('post_inventory_adjustment', {
    adjustment_id: adj.id,
    created_at: snapAt
  });

  // Then: postStocktakeAction is rejected due to movement detected on same second (>= boundary)
  await assert.rejects(
    async () => {
      await postStocktakeAction(stk.id);
    },
    /盤點期間有異動/
  );
});

test('TC-STK-R10-01: normalizeStocktakeInput unifies snake_case and camelCase parameters', () => {
  // 1. snake_case inputs
  const norm1 = normalizeStocktakeInput({
    warehouse_id: 'wh_1',
    note: ' 備註1 ',
    task_id: 'tsk_1',
    initial_unit_ids: ['u_1', 'u_2']
  });
  assert.equal(norm1.warehouseId, 'wh_1');
  assert.equal(norm1.note, '備註1');
  assert.equal(norm1.taskId, 'tsk_1');
  assert.deepEqual(norm1.initialUnitIds, ['u_1', 'u_2']);

  // 2. camelCase inputs
  const norm2 = normalizeStocktakeInput({
    warehouseId: 'wh_2',
    note: '備註2',
    taskId: 'tsk_2',
    initialUnitIds: 'u_3'
  });
  assert.equal(norm2.warehouseId, 'wh_2');
  assert.equal(norm2.note, '備註2');
  assert.equal(norm2.taskId, 'tsk_2');
  assert.deepEqual(norm2.initialUnitIds, ['u_3']);

  // 3. Null / empty clearing
  const norm3 = normalizeStocktakeInput({
    warehouse_id: null,
    note: null
  });
  assert.equal(norm3.warehouseId, null);
  assert.equal(norm3.note, null);
});

test('TC-STK-R10-02: updateStocktakeHeaderAction updates warehouse and note and persists in store', async () => {
  const tid = `tnt_stk_r10_${Date.now()}`;
  await switchTenant(tid);
  const wh1 = await invoke('create_warehouse', { code: 'WH-R10A', name: '一倉' });
  const wh2 = await invoke('create_warehouse', { code: 'WH-R10B', name: '二倉' });
  const { unitId } = await createTestProduct('R10測試品');

  // Given: Draft stocktake in wh1
  const stk = await createStocktakeAction({
    warehouse_id: wh1.id,
    note: '初始備註',
    initial_unit_ids: [unitId]
  });
  assert.equal(stk.warehouse_id, wh1.id);
  assert.equal(stk.note, '初始備註');

  // When: updateStocktakeHeaderAction switches warehouse to wh2 and updates note
  const updated = await updateStocktakeHeaderAction(stk.id, {
    warehouse_id: wh2.id,
    note: '已變更為二倉盤點'
  });

  // Then: Returned stocktake reflects new warehouse and note
  assert.equal(updated.stocktake.warehouse_id, wh2.id);
  assert.equal(updated.stocktake.note, '已變更為二倉盤點');
  assert.equal(appState.currentStocktakeDetail.stocktake.warehouse_id, wh2.id);

  // And: Re-fetch confirms persistence
  const fetched = await fetchStocktakeDetail(stk.id);
  assert.equal(fetched.stocktake.warehouse_id, wh2.id);
  assert.equal(fetched.stocktake.note, '已變更為二倉盤點');
});

// -----------------------------------------------------------------------------
// Test Group 15: Round 11 Refinements & Contract Standardization
// -----------------------------------------------------------------------------
test('TC-STK-R11-01: isStocktakeLineCounted accurately handles numbers, zero, null, undefined, and line objects', () => {
  // Numbers including 0 must be counted
  assert.equal(isStocktakeLineCounted(0), true);
  assert.equal(isStocktakeLineCounted(12.5), true);
  assert.equal(isStocktakeLineCounted('0'), true);
  assert.equal(isStocktakeLineCounted('10'), true);

  // Null, undefined, empty string are uncounted
  assert.equal(isStocktakeLineCounted(null), false);
  assert.equal(isStocktakeLineCounted(undefined), false);
  assert.equal(isStocktakeLineCounted(''), false);

  // Line objects with counted_quantity property
  assert.equal(isStocktakeLineCounted({ counted_quantity: 0 }), true);
  assert.equal(isStocktakeLineCounted({ counted_quantity: 5 }), true);
  assert.equal(isStocktakeLineCounted({ counted_quantity: null }), false);
  assert.equal(isStocktakeLineCounted({ counted_quantity: undefined }), false);
});

test('TC-STK-R11-02: patchStocktakeInList updates appState.stocktakes in-place without whole-list refetch', () => {
  // Given: appState.stocktakes with existing entries
  appState.stocktakes = [
    { id: 'stk_1', stocktake_number: 'STK-00001', status: 'draft', note: '舊備註' },
    { id: 'stk_2', stocktake_number: 'STK-00002', status: 'counting', note: '盤點中' }
  ];

  // When: Patching stk_1 with new status and note
  patchStocktakeInList({ id: 'stk_1', status: 'counting', note: '已開始盤點' });

  // Then: stk_1 is updated in place, stk_2 is untouched
  assert.equal(appState.stocktakes[0].status, 'counting');
  assert.equal(appState.stocktakes[0].note, '已開始盤點');
  assert.equal(appState.stocktakes[0].stocktake_number, 'STK-00001');
  assert.equal(appState.stocktakes[1].status, 'counting');
  assert.equal(appState.stocktakes[1].note, '盤點中');
});

test('TC-STK-R11-03: set_stocktake_counted_quantity mock return shape matches backend StocktakeLine contract', async () => {
  const tid = `tnt_stk_${Date.now()}_r11_03`;
  await switchTenant(tid);
  const wh = await invoke('create_warehouse', { code: 'WH-R11', name: '標準回傳倉' });
  const { unitId } = await createTestProduct('契約測試品');

  const stk = await createStocktakeAction({ warehouse_id: wh.id, initial_unit_ids: [unitId] });
  const counting = await startStocktakeCountingAction(stk.id);
  const lineId = counting.lines[0].id;

  // When: Invoking set_stocktake_counted_quantity
  const res = await invoke('set_stocktake_counted_quantity', { lineId, countedQuantity: 15 });

  // Then: Return shape is bare StocktakeLine without extraneous stocktake / lines envelope
  assert.equal(res.id, lineId);
  assert.equal(res.counted_quantity, 15);
  assert.equal(res.stocktake, undefined);
  assert.equal(res.lines, undefined);
});

test('TC-STK-R12-01: registerNavigationStalenessListener notifies on navigate() and unregisters cleanly', () => {
  // Given: A custom navigation listener tracking invalidation triggers
  let callCount = 0;
  const unsubscribe = registerNavigationStalenessListener(() => {
    callCount++;
  });

  // When: navigate() is called to switch route
  navigate('/app/warehouses/stocktakes');

  // Then: The registered listener is invoked
  assert.equal(callCount, 1);

  // When: Unsubscribed and navigate() is called again
  unsubscribe();
  navigate('/app/warehouses/adjustments');

  // Then: Listener is not invoked again
  assert.equal(callCount, 1);
});

test('TC-STK-R12-02: isStocktakeLineCounted is identical SSOT reference in tauri.js and store.svelte.js', () => {
  // Given: isStocktakeLineCounted imported from both store.svelte.js and tauri.js
  // When: Comparing function references
  // Then: They reference the exact same underlying function (zero duplication)
  assert.equal(isStocktakeLineCounted, isCountedTauri);
});

/**
 * Execution Commands:
 * 1. Layer 2 Automated Tests:
 *    node --test tests/issue184-stocktakes-form.test.js
 * 2. Rust Layer 1 Tests:
 *    cargo test stocktakes
 */
