import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  navigate,
  getWorkspaceLabel,
  fetchWarehouses,
  fetchUnitInventoryLevel,
  createQuoteAction,
  addQuoteLineAction,
  submitQuoteAction,
  approveQuoteAction,
  convertQuoteAction,
  fetchSalesOrders,
  fetchSalesOrderDetail,
  getQuoteDetailReadOnly,
  shipSalesOrderAction,
  cancelSalesOrderAction,
  selectQuote,
  selectSalesOrder
} = await import('../src/lib/store.svelte.js');

const {
  getSalesOrderStatusLabel,
  getSalesOrderStatusBadgeClass,
  isSalesOrderTerminal,
  canShipSalesOrder,
  canCancelSalesOrder,
  validateShipDate,
  buildInitialShipLines,
  evaluateShipLines,
  buildShipOrderPayload
} = await import('../src/lib/salesOrdersHelper.js');

/**
 * Test Perspective Table (Issue #221: Sales Orders UI Workspace & Warehouse Shipment Form)
 *
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-221-N-01 | Quote created -> lines added -> submitted -> converted to SO -> shipped via store & helper | Equivalence – Normal (E2E Layer 2) | SO created as confirmed, initial ship qty defaults to ordered qty, stock sufficient, ship succeeds & deducts stock | Verifies full flow |
 * | TC-221-N-02 | Multiple SOs across statuses & customers; filter by status/customer + workspace navigation links | Equivalence – Normal (Filter & Links) | Filters return matching SOs; selectQuote sets pendingQuoteDetailId & /app/quotes; selectSalesOrder sets selectedSalesOrderId & /app/sales-orders | Verifies M13/M14 links |
 * | TC-221-N-03 | Confirmed SO cancelled via cancelSalesOrderAction | Equivalence – Normal (Cancel) | Status becomes cancelled, cancelled_at set, 0 stock movements, UI terminal guards true | Verifies cancel flow |
 * | TC-221-N-04 | Confirmed SO with 2 lines; multi-batch partial ship (batch 1: line1=2, line2=0 -> partially_shipped; batch 2: remaining -> shipped) | Equivalence – Normal / Multi-Batch & Boundary 0 | Batch 1 transitions to partially_shipped, records SHP-00001 with note, skips 0 movement; default next ship lines prefill remaining qty (2, 3); batch 2 closes as shipped with 2 records | Verifies Option A multi-batch shipment |
 * | TC-221-B-01 | Stock = 10 - 5e-10 (pass) vs 9.999 (short by 0.001) | Boundary – 1e-9 Stock Tolerance | 10 - 5e-10 passes pre-submit check & ships; 9.999 triggers pre-submit insufficient warning & blocks ship | Verifies SH-03 tolerance |
 * | TC-221-B-02 | Qty boundaries: 0 single line, all-0 total, max ordered, ordered+1, -1, empty/NaN, null stock, remaining+1 | Boundary – Quantity (0/min/max/±1/empty/NULL) | 0 single ok, all-0 blocked, max ok, +1/-1/empty & remaining+1 blocked with exact messages; null stock defers to backend | Verifies form validation |
 * | TC-221-B-03 | Ship date boundaries: empty/null -> today, today ok, today+1 rejected, 2026-02-29 rejected, 2024-02-29 ok | Boundary – Date (±1 / leap year / NULL) | Valid dates accepted; future & invalid calendar dates rejected with exact Chinese messages | Verifies SH-04 date guard |
 * | TC-221-E-01 | Stock insufficient for line 2; pre-submit evaluateShipLines & shipSalesOrderAction attempt, then adjust qty <= stock | Error – Insufficient Stock & Recovery | Pre-submit banner lists exact shortage message; submit blocked; adjusting qty clears warning & ships partially | Verifies Layer 2 criterion |
 * | TC-221-E-02 | Cancelled SO evaluated by UI guards and mutated by ship/cancel actions | Error – Terminal Immutability (Cancelled) | canShip/canCancel=false, isTerminal=true; ship/cancel reject with 無效的狀態轉換 | Verifies cancelled lock |
 * | TC-221-E-03 | Shipped SO evaluated by UI guards and mutated by ship/cancel actions | Error – Terminal Immutability (Shipped) | canShip/canCancel=false, isTerminal=true; duplicate ship/cancel reject with 無效的狀態轉換 | Verifies shipped lock |
 * | TC-221-E-04 | Empty/NULL orderId, nonexistent orderId, invalid ship date on submit | Error – Input Validation & Not Found | Rejects with exact validation or 找不到銷售單或不屬於目前租戶 error | Verifies error handling |
 * | TC-221-E-05 | Cross-tenant list/get/ship/cancel from Tenant B against Tenant A SO | Isolation – Multi-Tenant | Tenant B sees 0 SOs and cannot read/ship/cancel Tenant A SO | Verifies tenant isolation |
 * | TC-221-E-06 | Partially shipped SO: cancel rejected & shipping > remaining rejected | Error – Partial Shipment Guards | canShip=true, canCancel=false; cancel & over-remaining ship fail with exact error messages | Verifies Option A invariants |
 */

async function setupEnv(tid) {
  await invoke('set_mock_active_tenant', { tenant_id: tid });
  await invoke('reset_mock_warehouses', { tenant_id: tid });
  await invoke('reset_mock_quotes', { tenant_id: tid });
  await invoke('reset_mock_sales_orders', { tenant_id: tid });

  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const cust1 = await invoke('create_partner', {
    name: `台積客戶_${tid}`,
    isCustomer: true,
    isVendor: false
  });
  const cust2 = await invoke('create_partner', {
    name: `聯發客戶_${tid}`,
    isCustomer: true,
    isVendor: false
  });

  const p1 = await invoke('create_product', {
    name: '工業控制器',
    category: 'resale',
    selling_price: 1000,
    unit_name: '台'
  });
  const p2 = await invoke('create_product', {
    name: '感測模組',
    category: 'resale',
    selling_price: 200,
    unit_name: '顆'
  });

  const u1 = p1.units[0].id;
  const u2 = p2.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: u1,
    quantity: 10,
    unit_cost: 500,
    warehouse_id: wh.id
  });
  await invoke('record_opening_inventory_balance', {
    unit_id: u2,
    quantity: 4,
    unit_cost: 80,
    warehouse_id: wh.id
  });

  await fetchWarehouses();
  return { wh, cust1, cust2, u1, u2 };
}

async function createAndConvertQuote(customerId, warehouseId, today, lines) {
  const created = await createQuoteAction({
    customer_partner_id: customerId,
    valid_until: '2099-12-31',
    note: 'Issue #221 UI 測試報價'
  });
  for (const l of lines) {
    await addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: l.unit_id,
      quantity: l.quantity,
      unit_price: l.unit_price
    });
  }
  const sub = await submitQuoteAction({ quote_id: created.quote.id, today_override: today });
  if (sub.quote.status === 'pending_approval') {
    await approveQuoteAction({ quote_id: created.quote.id, today_override: today });
  }
  return await convertQuoteAction({
    quote_id: created.quote.id,
    warehouse_id: warehouseId,
    expected_ship_date: '2026-11-20',
    today_override: today
  });
}

test.describe('Issue #221: Sales Orders UI Workspace & Warehouse Shipment Form', () => {
  test('TC-221-N-01: Full E2E flow (create quote -> add lines -> convert -> ship via store & helper)', async () => {
    // Given: Active tenant with warehouse, customer, and sufficient stock (u1=10, u2=4)
    const tid = `tnt_221_n1_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1, u2 } = await setupEnv(tid);

    // When: Creating quote, adding lines, submitting, and converting to confirmed sales order
    const converted = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 3, unit_price: 1000 },
      { unit_id: u2, quantity: 2, unit_price: 200 }
    ]);
    const soId = converted.sales_order.order.id;

    // Then: Sales order appears in list and detail view with read-only metadata
    const list = await fetchSalesOrders({});
    assert.equal(list.length, 1);
    assert.equal(list[0].id, soId);
    assert.equal(list[0].status, 'confirmed');
    assert.equal(getSalesOrderStatusLabel(list[0].status), '已確認');
    assert.equal(getSalesOrderStatusBadgeClass(list[0].status), 'badge-so-confirmed');

    const detail = await fetchSalesOrderDetail(soId);
    assert.equal(appState.currentSalesOrderDetail.order.id, soId);
    assert.equal(detail.order.source_quote_id, converted.quote.id);
    assert.equal(canShipSalesOrder(detail.order), true);
    assert.equal(canCancelSalesOrder(detail.order), true);
    assert.equal(isSalesOrderTerminal(detail.order), false);

    // And: Opening shipment form fetches stock and defaults shipped_quantity = ordered quantity
    const lvl1 = await fetchUnitInventoryLevel(wh.id, u1);
    const lvl2 = await fetchUnitInventoryLevel(wh.id, u2);
    const shipLines = buildInitialShipLines(detail.lines, {
      [u1]: lvl1.current_quantity,
      [u2]: lvl2.current_quantity
    });
    assert.equal(shipLines[0].shipped_quantity, 3);
    assert.equal(shipLines[1].shipped_quantity, 2);

    const evalRes = evaluateShipLines(shipLines, wh.name);
    assert.equal(evalRes.hasInsufficientStock, false);
    assert.equal(evalRes.canSubmit, true);

    // When: Submitting shipment via shipSalesOrderAction
    const payload = buildShipOrderPayload(soId, today, shipLines, today);
    const shipped = await shipSalesOrderAction(payload);

    // Then: SO status is shipped, inventory deducted, and UI state refreshed
    assert.equal(shipped.order.status, 'shipped');
    assert.equal(shipped.order.ship_date, today);
    assert.equal(shipped.order.shipped_amount, 3400);
    assert.equal(appState.currentSalesOrderDetail.order.status, 'shipped');
    assert.equal(appState.salesOrders[0].status, 'shipped');

    const after1 = await fetchUnitInventoryLevel(wh.id, u1);
    const after2 = await fetchUnitInventoryLevel(wh.id, u2);
    assert.equal(after1.current_quantity, 7);
    assert.equal(after2.current_quantity, 2);
  });

  test('TC-221-N-02: Filter sales orders by status & customer and verify M13/M14 workspace navigation links', async () => {
    // Given: Two customers with confirmed, shipped, and cancelled sales orders
    const tid = `tnt_221_n2_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, cust2, u1 } = await setupEnv(tid);

    const conv1 = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 2, unit_price: 1000 }
    ]);
    const conv2 = await createAndConvertQuote(cust2.id, wh.id, today, [
      { unit_id: u1, quantity: 1, unit_price: 1000 }
    ]);
    const conv3 = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 1, unit_price: 1000 }
    ]);

    await shipSalesOrderAction({ order_id: conv1.sales_order.order.id, today_override: today });
    await cancelSalesOrderAction(conv3.sales_order.order.id);

    // When: Filtering by status and customer
    const onlyConfirmed = await fetchSalesOrders({ status: 'confirmed' });
    const onlyCust1 = await fetchSalesOrders({ customer_partner_id: cust1.id });
    const cust1Shipped = await fetchSalesOrders({ status: 'shipped', customer_partner_id: cust1.id });
    const emptyFiltered = await fetchSalesOrders({ status: 'shipped', customer_partner_id: cust2.id });

    // Then: Exact matching subsets returned
    assert.equal(onlyConfirmed.length, 1);
    assert.equal(onlyConfirmed[0].id, conv2.sales_order.order.id);
    assert.equal(onlyCust1.length, 2);
    assert.equal(cust1Shipped.length, 1);
    assert.equal(cust1Shipped[0].id, conv1.sales_order.order.id);
    assert.equal(emptyFiltered.length, 0);

    // When / Then: Workspace labels and cross-workspace navigation helpers work properly
    assert.equal(getWorkspaceLabel('sales-orders'), '銷售單');
    assert.equal(getWorkspaceLabel('sales-order'), '銷售單');

    navigate('/app/quotes');
    assert.equal(appState.activeWorkspace, 'quotes');

    selectSalesOrder(conv2.sales_order.order.id);
    assert.equal(appState.selectedSalesOrderId, conv2.sales_order.order.id);
    assert.equal(appState.activeWorkspace, 'sales-orders');

    selectQuote(conv2.quote.id);
    assert.equal(appState.pendingQuoteDetailId, conv2.quote.id);
    assert.equal(appState.activeWorkspace, 'quotes');

    const prevSelectedQuoteId = appState.selectedQuoteId;
    const prevQuoteDetail = appState.currentQuoteDetail;
    const readOnlyQuote = await getQuoteDetailReadOnly(conv1.quote.id);
    assert.equal(readOnlyQuote.quote.quote_number, conv1.quote.quote_number);
    assert.equal(appState.selectedQuoteId, prevSelectedQuoteId);
    assert.equal(appState.currentQuoteDetail, prevQuoteDetail);
  });

  test('TC-221-N-03: Cancel confirmed sales order transitions to cancelled without touching stock', async () => {
    // Given: Confirmed sales order
    const tid = `tnt_221_n3_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1 } = await setupEnv(tid);
    const conv = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 5, unit_price: 1000 }
    ]);
    const soId = conv.sales_order.order.id;

    // When: Cancelling via cancelSalesOrderAction
    const cancelled = await cancelSalesOrderAction(soId);

    // Then: Status is cancelled, stock remains 10, terminal UI guards apply
    assert.equal(cancelled.order.status, 'cancelled');
    assert.ok(cancelled.order.cancelled_at);
    assert.equal(getSalesOrderStatusLabel(cancelled.order.status), '已取消');
    assert.equal(getSalesOrderStatusBadgeClass(cancelled.order.status), 'badge-so-cancelled');
    assert.equal(isSalesOrderTerminal(cancelled.order), true);
    assert.equal(canShipSalesOrder(cancelled.order), false);
    assert.equal(canCancelSalesOrder(cancelled.order), false);

    const lvl = await fetchUnitInventoryLevel(wh.id, u1);
    assert.equal(lvl.current_quantity, 10);
  });

  test('TC-221-N-04: Multi-batch partial shipment records history, skips 0 movement, and completes to shipped', async () => {
    // Given: Confirmed 2-line SO
    const tid = `tnt_221_n4_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1, u2 } = await setupEnv(tid);
    const conv = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 4, unit_price: 1000 },
      { unit_id: u2, quantity: 3, unit_price: 200 }
    ]);
    const detail = await fetchSalesOrderDetail(conv.sales_order.order.id);
    const shipLines1 = buildInitialShipLines(detail.lines, { [u1]: 10, [u2]: 4 });
    shipLines1[0].shipped_quantity = 2;
    shipLines1[1].shipped_quantity = 0;

    // When: Evaluating & submitting batch 1 partial shipment with note
    const evalRes = evaluateShipLines(shipLines1, wh.name);
    assert.equal(evalRes.canSubmit, true);

    const partial = await shipSalesOrderAction(
      buildShipOrderPayload(detail.order.id, today, shipLines1, today, '第一批出貨')
    );

    // Then: Order enters partially_shipped, UI shows 部分出貨, 1 shipment record created, u1 stock = 8, u2 stock unchanged = 4
    assert.equal(partial.order.status, 'partially_shipped');
    assert.equal(getSalesOrderStatusLabel(partial.order.status), '部分出貨');
    assert.equal(getSalesOrderStatusBadgeClass(partial.order.status), 'badge-so-partial');
    assert.equal(canShipSalesOrder(partial.order), true);
    assert.equal(canCancelSalesOrder(partial.order), false);
    assert.equal(isSalesOrderTerminal(partial.order), false);
    assert.equal(partial.order.shipped_amount, 2000);
    assert.equal(partial.lines[0].shipped_quantity, 2);
    assert.equal(partial.lines[1].shipped_quantity, 0);
    assert.equal(partial.shipments.length, 1);
    assert.equal(partial.shipments[0].shipment_number, 'SHP-00001');
    assert.equal(partial.shipments[0].note, '第一批出貨');
    assert.equal(partial.shipments[0].lines.length, 1);
    assert.equal((await fetchUnitInventoryLevel(wh.id, u1)).current_quantity, 8);
    assert.equal((await fetchUnitInventoryLevel(wh.id, u2)).current_quantity, 4);

    // When: Opening ship form again defaults to remaining quantities (2 and 3) and submits batch 2
    const shipLines2 = buildInitialShipLines(partial.lines, { [u1]: 8, [u2]: 4 });
    assert.equal(shipLines2[0].already_shipped, 2);
    assert.equal(shipLines2[0].remaining_quantity, 2);
    assert.equal(shipLines2[0].shipped_quantity, 2);
    assert.equal(shipLines2[1].already_shipped, 0);
    assert.equal(shipLines2[1].remaining_quantity, 3);
    assert.equal(shipLines2[1].shipped_quantity, 3);

    const completed = await shipSalesOrderAction(
      buildShipOrderPayload(detail.order.id, today, shipLines2, today, '尾批補齊')
    );

    // Then: Cumulative quantities reach ordered amounts, status closes as shipped, 2 shipment records exist
    assert.equal(completed.order.status, 'shipped');
    assert.equal(completed.order.shipped_amount, 4600);
    assert.equal(completed.lines[0].shipped_quantity, 4);
    assert.equal(completed.lines[1].shipped_quantity, 3);
    assert.equal(completed.shipments.length, 2);
    assert.equal(completed.shipments[1].shipment_number, 'SHP-00002');
    assert.equal(completed.shipments[1].note, '尾批補齊');
    assert.equal(completed.shipments[1].lines.length, 2);
    assert.equal((await fetchUnitInventoryLevel(wh.id, u1)).current_quantity, 6);
    assert.equal((await fetchUnitInventoryLevel(wh.id, u2)).current_quantity, 1);
  });

  test('TC-221-B-01: Stock 1e-9 tolerance boundary in pre-submit check and shipment execution', async () => {
    // Given: Two units with 10 - 5e-10 (tolerance pass) vs 9.999 (shortage)
    const tid = `tnt_221_b1_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1 } = await setupEnv(tid);
    const pTol = await invoke('create_product', { name: '容差品', category: 'resale', selling_price: 100, unit_name: '個' });
    const pShort = await invoke('create_product', { name: '不足品', category: 'resale', selling_price: 100, unit_name: '個' });
    const uTol = pTol.units[0].id;
    const uShort = pShort.units[0].id;

    await invoke('record_opening_inventory_balance', { unit_id: uTol, quantity: 10 - 5e-10, unit_cost: 50, warehouse_id: wh.id });
    await invoke('record_opening_inventory_balance', { unit_id: uShort, quantity: 9.999, unit_cost: 50, warehouse_id: wh.id });

    const convTol = await createAndConvertQuote(cust1.id, wh.id, today, [{ unit_id: uTol, quantity: 10, unit_price: 100 }]);
    const convShort = await createAndConvertQuote(cust1.id, wh.id, today, [{ unit_id: uShort, quantity: 10, unit_price: 100 }]);

    // When / Then: Tolerance item passes pre-submit evaluation & ships
    const tolShipLines = buildInitialShipLines(convTol.sales_order.lines, { [uTol]: 10 - 5e-10 });
    assert.equal(evaluateShipLines(tolShipLines, wh.name).hasInsufficientStock, false);
    const shippedTol = await shipSalesOrderAction(buildShipOrderPayload(convTol.sales_order.order.id, today, tolShipLines, today));
    assert.equal(shippedTol.order.status, 'shipped');

    // When / Then: 9.999 triggers immediate pre-submit warning & backend block
    const shortShipLines = buildInitialShipLines(convShort.sales_order.lines, { [uShort]: 9.999 });
    const shortEval = evaluateShipLines(shortShipLines, wh.name);
    assert.equal(shortEval.hasInsufficientStock, true);
    assert.equal(shortEval.insufficientLines[0].message, '〔不足品／標準／個〕在〔主倉〕現有 9.999，不足出貨 10');

    await assert.rejects(
      () => shipSalesOrderAction(buildShipOrderPayload(convShort.sales_order.order.id, today, shortShipLines, today)),
      { message: '〔不足品／標準／個〕在〔主倉〕現有 9.999，不足出貨 10' }
    );
  });

  test('TC-221-B-02: Quantity boundaries (0, all-0, ordered max, ordered+1, -1, empty/NaN, null stock)', () => {
    // Given: Sample 2-line shipment state
    const baseLines = [
      {
        id: 'sol_1',
        line_no: 1,
        unit_id: 'u1',
        product_name_snapshot: '主機',
        variant_name_snapshot: '標準',
        unit_name_snapshot: '台',
        quantity: 5
      },
      {
        id: 'sol_2',
        line_no: 2,
        unit_id: 'u2',
        product_name_snapshot: '線材',
        variant_name_snapshot: '1m',
        unit_name_snapshot: '條',
        quantity: 3
      }
    ];

    // When / Then: Default max ordered quantity -> valid
    const maxLines = buildInitialShipLines(baseLines, { u1: 5, u2: 3 });
    assert.equal(evaluateShipLines(maxLines, '主倉').canSubmit, true);

    // When / Then: Single line 0, other line 1 -> valid (0 line ignores stock)
    const zeroOneLines = buildInitialShipLines(baseLines, { u1: 5, u2: 0 });
    zeroOneLines[1].shipped_quantity = 0;
    assert.equal(evaluateShipLines(zeroOneLines, '主倉').canSubmit, true);

    // When / Then: All lines 0 -> blocked
    const allZero = buildInitialShipLines(baseLines, { u1: 5, u2: 3 });
    allZero[0].shipped_quantity = 0;
    allZero[1].shipped_quantity = 0;
    const allZeroEval = evaluateShipLines(allZero, '主倉');
    assert.equal(allZeroEval.canSubmit, false);
    assert.equal(allZeroEval.hasZeroTotal, true);
    assert.equal(allZeroEval.blockingError, '出貨數量合計需大於 0');

    // When / Then: ordered + 1 -> blocked
    const overLines = buildInitialShipLines(baseLines, { u1: 10, u2: 10 });
    overLines[0].shipped_quantity = 6;
    const overEval = evaluateShipLines(overLines, '主倉');
    assert.equal(overEval.canSubmit, false);
    assert.equal(overEval.blockingError, '出貨數量不可超過訂購數量');

    // When / Then: -1 -> blocked
    const negLines = buildInitialShipLines(baseLines, { u1: 10, u2: 10 });
    negLines[0].shipped_quantity = -1;
    const negEval = evaluateShipLines(negLines, '主倉');
    assert.equal(negEval.canSubmit, false);
    assert.equal(negEval.blockingError, '出貨數量不可小於 0');

    // When / Then: empty string / null -> blocked as invalid number
    const emptyLines = buildInitialShipLines(baseLines, { u1: 10, u2: 10 });
    emptyLines[0].shipped_quantity = '';
    const emptyEval = evaluateShipLines(emptyLines, '主倉');
    assert.equal(emptyEval.canSubmit, false);
    assert.equal(emptyEval.blockingError, '請輸入有效數量');

    // When / Then: null stock (stock lookup unavailable) does not cause false-positive pre-submit block
    const nullStockLines = buildInitialShipLines(baseLines, {});
    const nullStockEval = evaluateShipLines(nullStockLines, '主倉');
    assert.equal(nullStockLines[0].available_stock, null);
    assert.equal(nullStockEval.hasInsufficientStock, false);
    assert.equal(nullStockEval.canSubmit, true);
  });

  test('TC-221-B-03: Ship date validation boundaries (null/empty, today, today+1, leap year)', () => {
    // Given: Today = 2026-11-12
    const today = '2026-11-12';

    // When / Then: Empty/null defaults to today
    assert.deepEqual(validateShipDate(null, today), { valid: true, resolvedDate: today, error: null });
    assert.deepEqual(validateShipDate('   ', today), { valid: true, resolvedDate: today, error: null });
    assert.deepEqual(validateShipDate(today, today), { valid: true, resolvedDate: today, error: null });

    // When / Then: Future (+1 day) rejected
    assert.equal(validateShipDate('2026-11-13', today).valid, false);
    assert.equal(validateShipDate('2026-11-13', today).error, '出貨日不可晚於今天');

    // When / Then: Non-leap Feb 29 rejected, leap Feb 29 accepted, bad format rejected
    assert.equal(validateShipDate('2026-02-29', today).error, '日期超出該月份天數');
    assert.equal(validateShipDate('2024-02-29', today).valid, true);
    assert.equal(validateShipDate('2026/11/12', today).error, '日期格式需為 YYYY-MM-DD');
  });

  test('TC-221-E-01: Insufficient stock blocks shipment with exact message & updates cleanly on qty adjustment', async () => {
    // Given: Confirmed SO ordering 5 of u1 (stock 10) and 6 of u2 (stock 4 -> short by 2)
    const tid = `tnt_221_e1_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1, u2 } = await setupEnv(tid);
    const conv = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 5, unit_price: 1000 },
      { unit_id: u2, quantity: 6, unit_price: 200 }
    ]);
    const detail = await fetchSalesOrderDetail(conv.sales_order.order.id);
    const lvl1 = await fetchUnitInventoryLevel(wh.id, u1);
    const lvl2 = await fetchUnitInventoryLevel(wh.id, u2);
    const shipLines = buildInitialShipLines(detail.lines, {
      [u1]: lvl1.current_quantity,
      [u2]: lvl2.current_quantity
    });

    // When: Evaluating shipment form BEFORE submission
    const preEval = evaluateShipLines(shipLines, wh.name);

    // Then: Immediately flags line 2 as insufficient before submit
    assert.equal(preEval.hasInsufficientStock, true);
    assert.equal(preEval.canSubmit, false);
    assert.equal(preEval.insufficientLines.length, 1);
    assert.equal(
      preEval.insufficientLines[0].message,
      '〔感測模組／標準／顆〕在〔主倉〕現有 4，不足出貨 6'
    );

    // When: Attempting submission anyway
    await assert.rejects(
      () => shipSalesOrderAction(buildShipOrderPayload(detail.order.id, today, shipLines, today)),
      { message: '〔感測模組／標準／顆〕在〔主倉〕現有 4，不足出貨 6' }
    );

    // Then: Order remains confirmed and u1 stock was NOT deducted (atomic rollback)
    const reloaded = await fetchSalesOrderDetail(detail.order.id);
    assert.equal(reloaded.order.status, 'confirmed');
    assert.equal((await fetchUnitInventoryLevel(wh.id, u1)).current_quantity, 10);

    // When: Warehouse operator adjusts line 2 shipped_quantity down to available stock (4)
    shipLines[1].shipped_quantity = 4;
    const adjustedEval = evaluateShipLines(shipLines, wh.name);

    // Then: Warning disappears and shipment succeeds (partially_shipped with remaining 2 on line 2)
    assert.equal(adjustedEval.hasInsufficientStock, false);
    assert.equal(adjustedEval.canSubmit, true);
    const shipped = await shipSalesOrderAction(buildShipOrderPayload(detail.order.id, today, shipLines, today));
    assert.equal(shipped.order.status, 'partially_shipped');
    assert.equal((await fetchUnitInventoryLevel(wh.id, u1)).current_quantity, 5);
    assert.equal((await fetchUnitInventoryLevel(wh.id, u2)).current_quantity, 0);
  });

  test('TC-221-E-02 & E-03: Cancelled and shipped sales orders cannot be modified or transitioned again', async () => {
    // Given: One cancelled SO and one shipped SO
    const tid = `tnt_221_e2_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1 } = await setupEnv(tid);

    const convCancel = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 2, unit_price: 1000 }
    ]);
    const convShip = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 2, unit_price: 1000 }
    ]);

    const cancelled = await cancelSalesOrderAction(convCancel.sales_order.order.id);
    const shipped = await shipSalesOrderAction({
      order_id: convShip.sales_order.order.id,
      today_override: today
    });

    // Then: UI terminal guards disable ship/cancel controls
    assert.equal(isSalesOrderTerminal(cancelled.order), true);
    assert.equal(canShipSalesOrder(cancelled.order), false);
    assert.equal(canCancelSalesOrder(cancelled.order), false);

    assert.equal(isSalesOrderTerminal(shipped.order), true);
    assert.equal(canShipSalesOrder(shipped.order), false);
    assert.equal(canCancelSalesOrder(shipped.order), false);

    // When / Then: Backend also rejects shipping or cancelling terminal orders
    await assert.rejects(
      () => shipSalesOrderAction({ order_id: cancelled.order.id, today_override: today }),
      { message: '無效的狀態轉換：不可從 cancelled 轉換至 shipped' }
    );
    await assert.rejects(
      () => cancelSalesOrderAction(cancelled.order.id),
      { message: '無效的狀態轉換：不可從 cancelled 轉換至 cancelled' }
    );
    await assert.rejects(
      () => shipSalesOrderAction({ order_id: shipped.order.id, today_override: today }),
      { message: '無效的狀態轉換：不可從 shipped 轉換至 shipped' }
    );
    await assert.rejects(
      () => cancelSalesOrderAction(shipped.order.id),
      { message: '無效的狀態轉換：不可從 shipped 轉換至 cancelled' }
    );
  });

  test('TC-221-E-04 & E-05: Validation errors, not-found handling, future ship date, and multi-tenant isolation', async () => {
    // Given: Active tenant A with a confirmed SO, and Tenant B
    const tidA = `tnt_221_a_${Date.now()}`;
    const tidB = `tnt_221_b_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1 } = await setupEnv(tidA);
    const conv = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 2, unit_price: 1000 }
    ]);
    const soId = conv.sales_order.order.id;

    // When / Then (E-04): Empty IDs rejected cleanly
    await assert.rejects(() => fetchSalesOrderDetail(''), { message: '銷售單 ID 為必填項目' });
    await assert.rejects(() => shipSalesOrderAction({}), { message: '銷售單 ID 為必填項目' });
    await assert.rejects(() => cancelSalesOrderAction(''), { message: '銷售單 ID 為必填項目' });

    // When / Then (E-04): Future ship date rejected
    await assert.rejects(
      () => shipSalesOrderAction({ order_id: soId, ship_date: '2026-11-13', today_override: today }),
      { message: '出貨日不可晚於今天' }
    );

    // When / Then (E-05): Tenant B isolated from Tenant A sales order
    await invoke('set_mock_active_tenant', { tenant_id: tidB });
    const listB = await fetchSalesOrders({});
    assert.equal(listB.length, 0);

    await assert.rejects(() => fetchSalesOrderDetail(soId), {
      message: '找不到銷售單或不屬於目前租戶'
    });
    await assert.rejects(
      () => shipSalesOrderAction({ order_id: soId, today_override: today }),
      { message: '找不到銷售單或不屬於目前租戶' }
    );
    await assert.rejects(() => cancelSalesOrderAction(soId), {
      message: '找不到銷售單或不屬於目前租戶'
    });
  });

  test('TC-221-E-06: Partially shipped order blocks cancel and rejects exceeding remaining quantity', async () => {
    // Given: Confirmed SO with qty 10 (u1 already has opening balance 10), partially shipped 4 in batch 1
    const tid = `tnt_221_e6_${Date.now()}`;
    const today = '2026-11-12';
    const { wh, cust1, u1 } = await setupEnv(tid);
    const conv = await createAndConvertQuote(cust1.id, wh.id, today, [
      { unit_id: u1, quantity: 10, unit_price: 1000 }
    ]);
    const soId = conv.sales_order.order.id;
    const partial = await shipSalesOrderAction({
      order_id: soId,
      today_override: today,
      line_shipped_quantities: [{ line_id: conv.sales_order.lines[0].id, shipped_quantity: 4 }]
    });
    assert.equal(partial.order.status, 'partially_shipped');

    // When / Then: Cancel is blocked once partially shipped
    await assert.rejects(() => cancelSalesOrderAction(soId), {
      message: '無效的狀態轉換：不可從 partially_shipped 轉換至 cancelled'
    });

    // When / Then: UI evaluation and backend both reject shipping 7 (> remaining 6)
    const shipLines = buildInitialShipLines(partial.lines, { [u1]: 6 });
    assert.equal(shipLines[0].remaining_quantity, 6);
    shipLines[0].shipped_quantity = 7;
    const overEval = evaluateShipLines(shipLines, wh.name);
    assert.equal(overEval.canSubmit, false);
    assert.equal(overEval.blockingError, '出貨數量不可超過剩餘可出貨數量');

    await assert.rejects(
      () => shipSalesOrderAction(buildShipOrderPayload(soId, today, shipLines, today)),
      { message: '出貨數量不可超過剩餘可出貨數量' }
    );
  });
});
