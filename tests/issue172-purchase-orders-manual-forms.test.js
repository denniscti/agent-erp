/**
 * @file issue172-purchase-orders-manual-forms.test.js
 * @description Layer 2 automated test suite for Purchase Orders Manual Forms & Status Transitions (Issue #172).
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-172-PO-N-01 | Create draft order via manual form (vendor, TWD, expected_date, note) | Equivalence – Normal Draft Creation | Draft PO created, task_id strictly null, total_amount = 0 | Form entry without task |
 * | TC-172-PO-N-02 | Add line item with existing supply source for vendor | Equivalence – R-07 Prefill | Auto-populates purchase_cost from supply source, sets supply_source_id | R-07 Prefill |
 * | TC-172-PO-N-03 | Add line item without supply source, manual cost 150.0 | Equivalence – Manual Cost Input | Line added, purchase_cost = 150.0, supply_source_id is null | Manual cost entry |
 * | TC-172-PO-N-04 | Update draft order line quantity and purchase cost | Equivalence – Line Modification | Quantity and cost updated, recalculates subtotal and total_amount | Line update |
 * | TC-172-PO-N-05 | Delete draft order line item | Equivalence – Line Deletion | Line removed, remaining lines renumbered, total_amount reduced | Line deletion |
 * | TC-172-PO-N-06 | Update draft order header (expected_date, note) | Equivalence – Header Update | Order header updated successfully | Header update |
 * | TC-172-PO-N-07 | Submit draft order with valid lines | Equivalence – Submit Order | Order status transitions to ordered, records ordered_at timestamp | State transition |
 * | TC-172-PO-N-08 | Confirm order receipt with equal quantity (full receipt) | Equivalence – Full Receipt | Order status transitions to received, records received_at, creates purchase_receipt inventory movement | Terminal receipt |
 * | TC-172-PO-N-09 | Confirm order receipt with short/excess quantities | Equivalence – Short/Excess Delivery | Records custom received_quantity on line and inventory movements | Delivery discrepancy |
 * | TC-172-PO-N-10 | Cancel draft order | Equivalence – Draft Cancellation | Transitions draft -> cancelled, records cancelled_at | Draft cancellation |
 * | TC-172-PO-N-11 | Cancel ordered order | Equivalence – Ordered Cancellation | Transitions ordered -> cancelled, records cancelled_at | Ordered cancellation |
 * | TC-172-OB-N-01 | Record opening inventory balance (valid unit, qty 50, cost 80.0) | Equivalence – Opening Balance | Creates opening_balance movement, immediately reflected in list_inventory_levels | Ledger baseline |
 * | TC-172-PO-N-12 | End-to-end sequential status transitions (draft -> ordered -> received & draft -> cancelled) | Equivalence – Sequential Status Lifecycle | Order status correctly transitions through full sequential paths | Lifecycle sequence |
 * | TC-172-PO-E-01 | Create order with empty/whitespace vendor ID | Boundary – Empty Vendor | Validation error: '供應商為必填項目' (R-01) | Required check |
 * | TC-172-PO-E-02 | Create order with non-existent vendor ID | Error – Non-existent Vendor | Validation error: '找不到指定的供應商' (R-01) | Foreign key check |
 * | TC-172-PO-E-03 | Add line item to non-draft order (ordered status) | Error – Non-draft Mutation | Validation error: '僅草稿狀態可新增明細' (R-06) | State defense |
 * | TC-172-PO-E-04 | Add line item to received order | Error – Non-draft Mutation | Validation error: '僅草稿狀態可新增明細' (R-06) | State defense |
 * | TC-172-PO-E-05 | Add line item with non-purchasable product (is_purchasable = 0) | Error – Non-purchasable Product | Validation error: '設定為不可採購' (R-03) | Product rule |
 * | TC-172-PO-B-01 | Add line item with quantity = 0 | Boundary – Zero Quantity | Validation error: '採購數量必須大於 0' (R-04) | Boundary 0 |
 * | TC-172-PO-B-02 | Add line item with quantity = -5 (negative) | Boundary – Negative Quantity | Validation error: '採購數量必須大於 0' (R-04) | Boundary <0 |
 * | TC-172-PO-B-03 | Add line item with purchase_cost = -10 (negative) | Boundary – Negative Cost | Validation error: '採購單價不可為負數' (R-05) | Boundary <0 |
 * | TC-172-PO-B-04 | Add line item with purchase_cost = 0 (free sample) | Boundary – Zero Cost | Succeeds with 0 cost | Boundary 0 |
 * | TC-172-PO-E-06 | Add line item without supply source and cost omitted | Error – Missing Cost & Source | Validation error: '查無此供應商的預設供應來源成本，請手動指定單價' (R-07) | R-07 Defense |
 * | TC-172-PO-E-07 | Add duplicate unit_id in same purchase order | Error – Duplicate Unit in Order | Validation error: '同一採購單內商品單位不可重複...' (R-07) | Unique unit check |
 * | TC-172-PO-E-08 | Update line item on non-draft order | Error – Non-draft Line Update | Validation error: '僅草稿狀態可修改明細' | State defense |
 * | TC-172-PO-B-05 | Update line item with quantity <= 0 | Boundary – Invalid Update Qty | Validation error: '採購數量必須大於 0' | Boundary <=0 |
 * | TC-172-PO-B-06 | Update line item with purchase_cost < 0 | Boundary – Negative Update Cost | Validation error: '採購單價不可為負數' | Boundary <0 |
 * | TC-172-PO-E-09 | Remove line item on non-draft order | Error – Non-draft Line Deletion | Validation error: '僅草稿狀態可刪除明細' | State defense |
 * | TC-172-PO-E-10 | Remove non-existent line item ID | Error – Missing Line Item | Validation error: '找不到明細項目' | ID check |
 * | TC-172-PO-E-11 | Submit draft order with 0 line items | Boundary – Empty Order Submit | Validation error: '採購單至少需有 1 筆明細方可下單' (R-08) | Boundary 0 lines |
 * | TC-172-PO-E-12 | Submit ordered purchase order | Error – Invalid State Transition | Validation error: '無效的狀態轉換：不可從 ordered 轉換至 ordered' (R-11) | State machine |
 * | TC-172-PO-E-13 | Submit received purchase order | Error – Terminal State Mutation | Validation error: '無效的狀態轉換：不可從 received 轉換至 ordered' | State machine |
 * | TC-172-PO-E-14 | Confirm receipt on draft purchase order | Error – Premature Confirmation | Validation error: '無效的狀態轉換：不可從 draft 轉換至 received' (R-13) | State machine |
 * | TC-172-PO-E-15 | Confirm receipt on received purchase order | Error – Terminal State Mutation | Validation error: '無效的狀態轉換：不可從 received 轉換至 received' | State machine |
 * | TC-172-PO-B-07 | Confirm receipt with received_quantity = -1 | Boundary – Negative Received Qty | Validation error: '實到數量不可為負數' (R-14) | Boundary <0 |
 * | TC-172-PO-B-08 | Confirm receipt with received_quantity = 0 | Boundary – Zero Received Qty | Allowed, records 0 delivery without crash | Boundary 0 |
 * | TC-172-PO-E-16 | Cancel received purchase order | Error – Terminal State Mutation | Validation error: '無效的狀態轉換：不可從 received 轉換至 cancelled' (R-16) | State machine |
 * | TC-172-PO-E-17 | Cancel already cancelled purchase order | Error – Terminal State Mutation | Validation error: '無效的狀態轉換：不可從 cancelled 轉換至 cancelled' | State machine |
 * | TC-172-OB-E-01 | Record opening balance with empty unit_id | Boundary – Empty Unit ID | Validation error: '商品單位 ID 為必填項目' | Required check |
 * | TC-172-OB-B-01 | Record opening balance with quantity_delta = 0 | Boundary – Zero Quantity | Validation error: '期初開帳數量必須大於 0' (R-17) | Boundary 0 |
 * | TC-172-OB-B-02 | Record opening balance with quantity_delta = -10 | Boundary – Negative Quantity | Validation error: '期初開帳數量必須大於 0' (R-17) | Boundary <0 |
 * | TC-172-OB-B-03 | Record opening balance with unit_cost = -1 | Boundary – Negative Cost | Validation error: '期初開帳成本不可為負數' (R-17) | Boundary <0 |
 * | TC-172-OB-B-04 | Record opening balance with unit_cost = 0 | Boundary – Zero Cost | Allowed, records 0 cost asset | Boundary 0 |
 * | TC-172-OB-E-02 | Record duplicate opening balance on same unit | Error – Duplicate Opening Balance | Validation error: '期初已開帳，更正請待庫存調整功能（M12）' (R-17) | Duplicate defense |
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
  fetchPurchaseOrders,
  fetchPurchaseOrderDetail,
  fetchInventoryLevels,
  fetchInventoryMovements,
  createPurchaseOrderAction,
  updatePurchaseOrderHeaderAction,
  addPurchaseOrderLineAction,
  updatePurchaseOrderLineAction,
  removePurchaseOrderLineAction,
  submitPurchaseOrderAction,
  confirmPurchaseOrderReceivedAction,
  cancelPurchaseOrderAction,
  recordOpeningInventoryBalanceAction
} = storeModule;

// Helper to create test vendor without conflicting tax_id
async function createTestVendor(prefix = 'vendor') {
  return invoke('create_partner', {
    name: `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    is_vendor: true,
    is_customer: false
  });
}

// Helper to create test product with unit
async function createTestProduct(prefix = 'prod', unitName = '件', price = 100) {
  return invoke('create_product', {
    name: `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    category: 'resale',
    unit_name: unitName,
    selling_price: price
  });
}

// ==========================================
// 1. Normal Cases (TC-172-PO-N-*)
// ==========================================

test('TC-172-PO-N-01: Equivalence - Create draft purchase order via manual form with null task_id', async () => {
  // Given: Valid vendor and manual form input fields
  const vendor = await createTestVendor('N01_供應商');
  const expDate = Math.floor(Date.now() / 1000) + 86400 * 7;
  const note = '手動備援表單採購';

  // When: Calling createPurchaseOrderAction
  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    expected_date: expDate,
    note,
    task_id: null
  });

  // Then: Order created in draft status with null task_id and 0 total_amount
  assert.ok(detail.order.id, 'Order ID must exist');
  assert.equal(detail.order.status, 'draft', 'Initial status must be draft');
  assert.equal(detail.order.vendor_partner_id, vendor.id);
  assert.equal(detail.order.task_id, null, 'Manual form order task_id must be null');
  assert.equal(detail.order.total_amount, 0, 'Total amount must start at 0');
  assert.equal(detail.order.note, note);
  assert.equal(detail.lines.length, 0);
  assert.ok(appState.purchaseOrders.some(o => o.id === detail.order.id), 'Reflected in appState.purchaseOrders');
});

test('TC-172-PO-N-02: Equivalence - Add line item with existing supply source auto-prefills cost (R-07)', async () => {
  // Given: Vendor, product unit, and an active supply source
  const vendor = await createTestVendor('N02_供應商');
  const prod = await createTestProduct('N02_商品', '箱', 500);
  const unitId = prod.units[0].id;

  const src = await invoke('add_supply_source', {
    unit_id: unitId,
    vendor_partner_id: vendor.id,
    purchase_cost: 320.5,
    currency: 'TWD',
    is_primary: true
  });

  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id
  });

  // When: Adding line without providing purchase_cost
  const updated = await addPurchaseOrderLineAction(detail.order.id, {
    unit_id: unitId,
    quantity: 10
  });

  // Then: Cost auto-prefilled from supply source and supply_source_id recorded
  assert.equal(updated.lines.length, 1);
  const line = updated.lines[0];
  assert.equal(line.unit_id, unitId);
  assert.equal(line.quantity, 10);
  assert.equal(line.purchase_cost, 320.5, 'Cost must be auto-prefilled from supply source');
  assert.equal(line.supply_source_id, src.id, 'supply_source_id must match');
  assert.equal(line.subtotal, 3205.0);
  assert.equal(updated.order.total_amount, 3205.0);
});

test('TC-172-PO-N-03: Equivalence - Add line item without supply source by manually entering purchase_cost', async () => {
  // Given: Vendor and product unit without any registered supply sources
  const vendor = await createTestVendor('N03_供應商');
  const prod = await createTestProduct('N03_商品', '個', 200);
  const unitId = prod.units[0].id;

  const detail = await createPurchaseOrderAction({
    vendor_partner_id: vendor.id
  });

  // When: Adding line with manual cost 150.0
  const updated = await addPurchaseOrderLineAction(detail.order.id, {
    unit_id: unitId,
    quantity: 5,
    purchase_cost: 150.0
  });

  // Then: Line created with manual cost and null supply_source_id
  assert.equal(updated.lines.length, 1);
  const line = updated.lines[0];
  assert.equal(line.purchase_cost, 150.0);
  assert.equal(line.supply_source_id, null, 'Manual cost line has null supply_source_id');
  assert.equal(line.subtotal, 750.0);
  assert.equal(updated.order.total_amount, 750.0);
});

test('TC-172-PO-N-04: Equivalence - Update draft order line quantity and purchase cost', async () => {
  // Given: Draft order with one line (qty 5, cost 150 -> 750)
  const vendor = await createTestVendor('N04_供應商');
  const prod = await createTestProduct('N04_商品', '支', 300);
  const unitId = prod.units[0].id;

  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, {
    unit_id: unitId,
    quantity: 5,
    purchase_cost: 150.0
  });
  const lineId = withLine.lines[0].id;

  // When: Modifying quantity to 8 and cost to 160.0
  const updated = await updatePurchaseOrderLineAction(lineId, {
    quantity: 8,
    purchase_cost: 160.0
  });

  // Then: Line quantity, cost, subtotal, and order total updated
  const modifiedLine = updated.lines.find(l => l.id === lineId);
  assert.equal(modifiedLine.quantity, 8);
  assert.equal(modifiedLine.purchase_cost, 160.0);
  assert.equal(modifiedLine.subtotal, 1280.0);
  assert.equal(updated.order.total_amount, 1280.0);
});

test('TC-172-PO-N-05: Equivalence - Delete draft order line item and verify re-indexing', async () => {
  // Given: Draft order with two line items
  const vendor = await createTestVendor('N05_供應商');
  const prod1 = await createTestProduct('N05_品項1', '件', 100);
  const prod2 = await createTestProduct('N05_品項2', '件', 200);

  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod1.units[0].id, quantity: 2, purchase_cost: 50.0 });
  const withTwoLines = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod2.units[0].id, quantity: 3, purchase_cost: 80.0 });
  assert.equal(withTwoLines.lines.length, 2);

  const firstLineId = withTwoLines.lines[0].id;

  // When: Removing the first line item
  const afterRemove = await removePurchaseOrderLineAction(firstLineId);

  // Then: Exactly one line item remains, line_no re-indexed to 1, total_amount reduced
  assert.equal(afterRemove.lines.length, 1);
  assert.equal(afterRemove.lines[0].line_no, 1);
  assert.equal(afterRemove.order.total_amount, 240.0);
});

test('TC-172-PO-N-06: Equivalence - Update draft purchase order header', async () => {
  // Given: Draft order
  const vendor = await createTestVendor('N06_供應商');
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id, note: '舊備註' });

  // When: Updating header fields
  const updated = await updatePurchaseOrderHeaderAction(detail.order.id, {
    expected_date: 1800000000,
    note: '新備註：優先處理'
  });

  // Then: Header fields updated successfully
  assert.equal(updated.order.note, '新備註：優先處理');
  assert.equal(updated.order.expected_date, 1800000000);
});

test('TC-172-PO-N-07: Equivalence - Submit purchase order with lines (draft -> ordered)', async () => {
  // Given: Draft order with one line item
  const vendor = await createTestVendor('N07_供應商');
  const prod = await createTestProduct('N07_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 10, purchase_cost: 80.0 });

  // When: Submitting order
  const submitted = await submitPurchaseOrderAction(detail.order.id);

  // Then: Order transitions to ordered, ordered_at is recorded
  assert.equal(submitted.order.status, 'ordered');
  assert.ok(submitted.order.ordered_at > 0, 'ordered_at timestamp must be recorded');
});

test('TC-172-PO-N-08: Equivalence - Confirm receipt with exact quantities and verify inventory movement (ordered -> received)', async () => {
  // Given: Ordered purchase order with 15 units
  const vendor = await createTestVendor('N08_供應商');
  const prod = await createTestProduct('N08_商品', '包', 100);
  const unitId = prod.units[0].id;

  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: unitId, quantity: 15, purchase_cost: 45.0 });
  const lineId = withLine.lines[0].id;
  await submitPurchaseOrderAction(detail.order.id);

  // When: Confirming receipt with exact ordered quantity 15
  const received = await confirmPurchaseOrderReceivedAction(detail.order.id, [
    { line_id: lineId, received_quantity: 15 }
  ]);

  // Then: Transitions to received, line received_quantity set to 15, inventory movement recorded
  assert.equal(received.order.status, 'received');
  assert.ok(received.order.received_at > 0);
  assert.equal(received.lines[0].received_quantity, 15);

  const movements = await fetchInventoryMovements(unitId);
  const matchedMov = movements.find(m => m.reference_id === detail.order.id && m.reason === 'purchase_receipt');
  assert.ok(matchedMov, 'Inventory movement for purchase receipt must exist');
  assert.equal(matchedMov.quantity_delta, 15);
  assert.equal(matchedMov.unit_cost, 45.0);
});

test('TC-172-PO-N-09: Equivalence - Confirm receipt with short delivery (12 vs 15) and excess delivery (18 vs 15)', async () => {
  // Given: Ordered purchase order with two lines
  const vendor = await createTestVendor('N09_供應商');
  const prod1 = await createTestProduct('N09_短交品項', '件', 100);
  const prod2 = await createTestProduct('N09_超交品項', '件', 100);

  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const o1 = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod1.units[0].id, quantity: 15, purchase_cost: 60.0 });
  const o2 = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod2.units[0].id, quantity: 15, purchase_cost: 70.0 });
  const line1Id = o2.lines[0].id;
  const line2Id = o2.lines[1].id;
  await submitPurchaseOrderAction(detail.order.id);

  // When: Confirming with line 1 = 12 (short) and line 2 = 18 (excess)
  const received = await confirmPurchaseOrderReceivedAction(detail.order.id, [
    { line_id: line1Id, received_quantity: 12 },
    { line_id: line2Id, received_quantity: 18 }
  ]);

  // Then: Order received, lines record actual received quantities, inventory movements reflect 12 and 18
  assert.equal(received.order.status, 'received');
  const rLine1 = received.lines.find(l => l.id === line1Id);
  const rLine2 = received.lines.find(l => l.id === line2Id);
  assert.equal(rLine1.received_quantity, 12);
  assert.equal(rLine2.received_quantity, 18);

  const mov1 = await fetchInventoryMovements(prod1.units[0].id);
  const mov2 = await fetchInventoryMovements(prod2.units[0].id);
  const p1Mov = mov1.find(m => m.reference_id === detail.order.id);
  const p2Mov = mov2.find(m => m.reference_id === detail.order.id);
  assert.equal(p1Mov.quantity_delta, 12, 'Inventory movement should record actual short received quantity');
  assert.equal(p2Mov.quantity_delta, 18, 'Inventory movement should record actual excess received quantity');
});

test('TC-172-PO-N-10: Equivalence - Cancel purchase order from draft status', async () => {
  // Given: Draft purchase order
  const vendor = await createTestVendor('N10_供應商');
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When: Cancelling order
  const cancelled = await cancelPurchaseOrderAction(detail.order.id);

  // Then: Status becomes cancelled, cancelled_at timestamp recorded
  assert.equal(cancelled.order.status, 'cancelled');
  assert.ok(cancelled.order.cancelled_at > 0);
});

test('TC-172-PO-N-11: Equivalence - Cancel purchase order from ordered status', async () => {
  // Given: Ordered purchase order
  const vendor = await createTestVendor('N11_供應商');
  const prod = await createTestProduct('N11_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 5, purchase_cost: 50.0 });
  await submitPurchaseOrderAction(detail.order.id);

  // When: Cancelling from ordered status
  const cancelled = await cancelPurchaseOrderAction(detail.order.id);

  // Then: Status becomes cancelled, cancelled_at timestamp recorded
  assert.equal(cancelled.order.status, 'cancelled');
  assert.ok(cancelled.order.cancelled_at > 0);
});

test('TC-172-OB-N-01: Equivalence - Record opening inventory balance and verify query immediate update (R-17)', async () => {
  // Given: A fresh product unit with 0 initial inventory
  const prod = await createTestProduct('OB_N01_商品', '袋', 120);
  const unitId = prod.units[0].id;

  // When: Recording opening balance of quantity 50, unit cost 80.0
  const mov = await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    quantity_delta: 50,
    unit_cost: 80.0
  });

  // Then: Movement created with reason opening_balance, list_inventory_levels reflects 50
  assert.ok(mov.id);
  assert.equal(mov.reason, 'opening_balance');
  assert.equal(mov.quantity_delta, 50);
  assert.equal(mov.unit_cost, 80.0);

  const levels = await fetchInventoryLevels();
  const unitLevel = levels.find(l => l.unit_id === unitId);
  assert.ok(unitLevel, 'Unit must appear in inventory levels');
  assert.equal(unitLevel.current_quantity, 50, 'Inventory quantity must immediately reflect 50');
});

test('TC-172-PO-N-12: Equivalence - End-to-end sequential status transitions (draft -> ordered -> received & draft -> cancelled)', async () => {
  // Given: Test vendor and product
  const vendor = await createTestVendor('N12_供應商');
  const prod = await createTestProduct('N12_商品', '件', 100);

  // When & Then (Sequence 1): draft -> ordered -> received
  const draftDetail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(draftDetail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 10.0 });
  assert.equal(draftDetail.order.status, 'draft', 'Initial order status must be draft');

  const orderedDetail = await submitPurchaseOrderAction(draftDetail.order.id);
  assert.equal(orderedDetail.order.status, 'ordered', 'Submitted order status must transition to ordered');

  const receivedDetail = await confirmPurchaseOrderReceivedAction(orderedDetail.order.id, [
    { line_id: orderedDetail.lines[0].id, received_quantity: 2 }
  ]);
  assert.equal(receivedDetail.order.status, 'received', 'Received order status must transition to received');

  // When & Then (Sequence 2): draft -> cancelled
  const anotherDraft = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  assert.equal(anotherDraft.order.status, 'draft', 'New order status must be draft');

  const cancelledDetail = await cancelPurchaseOrderAction(anotherDraft.order.id);
  assert.equal(cancelledDetail.order.status, 'cancelled', 'Cancelled order status must transition to cancelled');
});

// ==========================================
// 2. Boundary & Error Cases (TC-172-PO-E-* / B-*)
// ==========================================

test('TC-172-PO-E-01: Boundary - Create purchase order with empty vendor ID throws required error', async () => {
  // Given: Empty vendor_partner_id
  // When & Then: Throws required error
  await assert.rejects(
    async () => {
      await createPurchaseOrderAction({ vendor_partner_id: '' });
    },
    /供應商為必填項目/
  );
});

test('TC-172-PO-E-02: Error - Create purchase order with non-existent vendor ID', async () => {
  // Given: Non-existent vendor ID
  // When & Then: Rejection from backend
  await assert.rejects(
    async () => {
      await createPurchaseOrderAction({ vendor_partner_id: 'non_existent_vendor_999' });
    },
    /找不到指定的供應商/
  );
});

test('TC-172-PO-E-03: Error - Add line item to non-draft order (ordered status) is rejected', async () => {
  // Given: Ordered purchase order
  const vendor = await createTestVendor('E03_供應商');
  const prod = await createTestProduct('E03_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 1, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);

  // When & Then: Trying to add another line to ordered order is rejected
  const prod2 = await createTestProduct('E03_商品2', '件', 100);
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod2.units[0].id, quantity: 2, purchase_cost: 20.0 });
    },
    /僅草稿狀態可新增明細/
  );
});

test('TC-172-PO-E-04: Error - Add line item to received order is rejected', async () => {
  // Given: Received purchase order
  const vendor = await createTestVendor('E04_供應商');
  const prod = await createTestProduct('E04_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 1, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);
  await confirmPurchaseOrderReceivedAction(detail.order.id, [{ line_id: withLine.lines[0].id, received_quantity: 1 }]);

  // When & Then: Adding line to received order throws
  const prod2 = await createTestProduct('E04_商品2', '件', 100);
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod2.units[0].id, quantity: 1, purchase_cost: 10.0 });
    },
    /僅草稿狀態可新增明細/
  );
});

test('TC-172-PO-E-05: Error - Add line item with non-purchasable product (is_purchasable = 0) is rejected', async () => {
  // Given: A product with category 'manufactured' (is_purchasable = false)
  const vendor = await createTestVendor('E05_供應商');
  const nonPurchasableProd = await invoke('create_product', {
    name: `不可採購商品_${Date.now()}`,
    category: 'manufactured',
    unit_name: '件'
  });

  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When & Then: Adding non-purchasable product line throws
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, {
        unit_id: nonPurchasableProd.units[0].id,
        quantity: 1,
        purchase_cost: 50.0
      });
    },
    /設定為不可採購/
  );
});

test('TC-172-PO-B-01: Boundary - Add line item with quantity = 0 is rejected (R-04)', async () => {
  // Given: Draft order and product
  const vendor = await createTestVendor('B01_供應商');
  const prod = await createTestProduct('B01_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When & Then: Quantity 0 throws
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, {
        unit_id: prod.units[0].id,
        quantity: 0,
        purchase_cost: 50.0
      });
    },
    /採購數量必須大於 0/
  );
});

test('TC-172-PO-B-02: Boundary - Add line item with quantity = -5 (negative) is rejected (R-04)', async () => {
  // Given: Draft order and product
  const vendor = await createTestVendor('B02_供應商');
  const prod = await createTestProduct('B02_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When & Then: Negative quantity throws
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, {
        unit_id: prod.units[0].id,
        quantity: -5,
        purchase_cost: 50.0
      });
    },
    /採購數量必須大於 0/
  );
});

test('TC-172-PO-B-03: Boundary - Add line item with purchase_cost = -10 (negative) is rejected (R-05)', async () => {
  // Given: Draft order and product
  const vendor = await createTestVendor('B03_供應商');
  const prod = await createTestProduct('B03_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When & Then: Negative purchase cost throws
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, {
        unit_id: prod.units[0].id,
        quantity: 5,
        purchase_cost: -10.0
      });
    },
    /採購單價不可為負數/
  );
});

test('TC-172-PO-B-04: Boundary - Add line item with purchase_cost = 0 (free sample) is accepted', async () => {
  // Given: Draft order and product
  const vendor = await createTestVendor('B04_供應商');
  const prod = await createTestProduct('B04_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When: Adding line with cost = 0
  const updated = await addPurchaseOrderLineAction(detail.order.id, {
    unit_id: prod.units[0].id,
    quantity: 5,
    purchase_cost: 0
  });

  // Then: Accepted, subtotal = 0, total_amount = 0
  assert.equal(updated.lines[0].purchase_cost, 0);
  assert.equal(updated.lines[0].subtotal, 0);
  assert.equal(updated.order.total_amount, 0);
});

test('TC-172-PO-E-06: Error - Add line item without supply source and cost omitted throws R-07 guidance', async () => {
  // Given: Draft order and product unit with no supply source
  const vendor = await createTestVendor('E06_供應商');
  const prod = await createTestProduct('E06_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When & Then: Omitting cost when no supply source exists throws
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, {
        unit_id: prod.units[0].id,
        quantity: 5
      });
    },
    /查無此供應商的預設供應來源成本，請手動指定單價/
  );
});

test('TC-172-PO-E-07: Error - Add duplicate unit_id in the same purchase order is rejected', async () => {
  // Given: Draft order with unit A
  const vendor = await createTestVendor('E07_供應商');
  const prod = await createTestProduct('E07_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 50.0 });

  // When & Then: Adding the same unit_id again is rejected
  await assert.rejects(
    async () => {
      await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 3, purchase_cost: 50.0 });
    },
    /同一採購單內商品單位不可重複/
  );
});

test('TC-172-PO-E-08: Error - Update line item on non-draft order is rejected', async () => {
  // Given: Ordered purchase order
  const vendor = await createTestVendor('E08_供應商');
  const prod = await createTestProduct('E08_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 50.0 });
  const lineId = withLine.lines[0].id;
  await submitPurchaseOrderAction(detail.order.id);

  // When & Then: Modifying line on ordered order throws
  await assert.rejects(
    async () => {
      await updatePurchaseOrderLineAction(lineId, { quantity: 10 });
    },
    /僅草稿狀態可修改明細/
  );
});

test('TC-172-PO-B-05: Boundary - Update line item with quantity <= 0 is rejected', async () => {
  // Given: Draft order with line
  const vendor = await createTestVendor('B05_供應商');
  const prod = await createTestProduct('B05_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 50.0 });
  const lineId = withLine.lines[0].id;

  // When & Then: Quantity 0 throws
  await assert.rejects(
    async () => {
      await updatePurchaseOrderLineAction(lineId, { quantity: 0 });
    },
    /採購數量必須大於 0/
  );
});

test('TC-172-PO-B-06: Boundary - Update line item with purchase_cost < 0 is rejected', async () => {
  // Given: Draft order with line
  const vendor = await createTestVendor('B06_供應商');
  const prod = await createTestProduct('B06_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 50.0 });
  const lineId = withLine.lines[0].id;

  // When & Then: Negative cost throws
  await assert.rejects(
    async () => {
      await updatePurchaseOrderLineAction(lineId, { purchase_cost: -5.0 });
    },
    /採購單價不可為負數/
  );
});

test('TC-172-PO-E-09: Error - Remove line item on non-draft order is rejected', async () => {
  // Given: Ordered purchase order
  const vendor = await createTestVendor('E09_供應商');
  const prod = await createTestProduct('E09_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 50.0 });
  const lineId = withLine.lines[0].id;
  await submitPurchaseOrderAction(detail.order.id);

  // When & Then: Removing line throws
  await assert.rejects(
    async () => {
      await removePurchaseOrderLineAction(lineId);
    },
    /僅草稿狀態可刪除明細/
  );
});

test('TC-172-PO-E-10: Error - Remove non-existent line item ID is rejected', async () => {
  // Given: Non-existent line ID
  // When & Then: Throws line not found
  await assert.rejects(
    async () => {
      await removePurchaseOrderLineAction('non_existent_line_999');
    },
    /找不到明細項目/
  );
});

test('TC-172-PO-E-11: Boundary - Submit draft order with 0 lines is rejected (R-08)', async () => {
  // Given: Draft order with 0 lines
  const vendor = await createTestVendor('E11_供應商');
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });

  // When & Then: Submitting 0 lines order throws
  await assert.rejects(
    async () => {
      await submitPurchaseOrderAction(detail.order.id);
    },
    /採購單至少需有 1 筆明細方可下單/
  );
});

test('TC-172-PO-E-12: Error - Submit already ordered purchase order is rejected (R-11)', async () => {
  // Given: Ordered order
  const vendor = await createTestVendor('E12_供應商');
  const prod = await createTestProduct('E12_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);

  // When & Then: Submitting again throws invalid state transition
  await assert.rejects(
    async () => {
      await submitPurchaseOrderAction(detail.order.id);
    },
    /無效的狀態轉換：不可從 ordered 轉換至 ordered/
  );
});

test('TC-172-PO-E-13: Error - Submit received purchase order is rejected', async () => {
  // Given: Received order
  const vendor = await createTestVendor('E13_供應商');
  const prod = await createTestProduct('E13_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);
  await confirmPurchaseOrderReceivedAction(detail.order.id, [{ line_id: withLine.lines[0].id, received_quantity: 2 }]);

  // When & Then: Submitting received order throws
  await assert.rejects(
    async () => {
      await submitPurchaseOrderAction(detail.order.id);
    },
    /無效的狀態轉換：不可從 received 轉換至 ordered/
  );
});

test('TC-172-PO-E-14: Error - Confirm receipt on draft purchase order is rejected (R-13)', async () => {
  // Given: Draft order
  const vendor = await createTestVendor('E14_供應商');
  const prod = await createTestProduct('E14_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 10.0 });

  // When & Then: Confirming receipt on draft throws
  await assert.rejects(
    async () => {
      await confirmPurchaseOrderReceivedAction(detail.order.id, [{ line_id: withLine.lines[0].id, received_quantity: 2 }]);
    },
    /無效的狀態轉換：不可從 draft 轉換至 received/
  );
});

test('TC-172-PO-E-15: Error - Confirm receipt on already received order is rejected', async () => {
  // Given: Received order
  const vendor = await createTestVendor('E15_供應商');
  const prod = await createTestProduct('E15_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);
  await confirmPurchaseOrderReceivedAction(detail.order.id, [{ line_id: withLine.lines[0].id, received_quantity: 2 }]);

  // When & Then: Confirming again throws
  await assert.rejects(
    async () => {
      await confirmPurchaseOrderReceivedAction(detail.order.id, [{ line_id: withLine.lines[0].id, received_quantity: 2 }]);
    },
    /無效的狀態轉換：不可從 received 轉換至 received/
  );
});

test('TC-172-PO-B-07: Boundary - Confirm receipt with negative received_quantity is rejected (R-14)', async () => {
  // Given: Ordered purchase order
  const vendor = await createTestVendor('B07_供應商');
  const prod = await createTestProduct('B07_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 5, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);

  // When & Then: Negative received quantity throws
  await assert.rejects(
    async () => {
      await confirmPurchaseOrderReceivedAction(detail.order.id, [
        { line_id: withLine.lines[0].id, received_quantity: -1 }
      ]);
    },
    /實到數量不可為負數/
  );
});

test('TC-172-PO-B-08: Boundary - Confirm receipt with received_quantity = 0 (zero delivery) is accepted', async () => {
  // Given: Ordered purchase order
  const vendor = await createTestVendor('B08_供應商');
  const prod = await createTestProduct('B08_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 5, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);

  // When: Confirming receipt with 0 received quantity
  const received = await confirmPurchaseOrderReceivedAction(detail.order.id, [
    { line_id: withLine.lines[0].id, received_quantity: 0 }
  ]);

  // Then: Order status becomes received, line received_quantity is 0, movement recorded as 0 delta
  assert.equal(received.order.status, 'received');
  assert.equal(received.lines[0].received_quantity, 0);

  const movements = await fetchInventoryMovements(prod.units[0].id);
  const matchedMov = movements.find(m => m.reference_id === detail.order.id);
  assert.equal(matchedMov.quantity_delta, 0);
});

test('TC-172-PO-E-16: Error - Cancel received purchase order is rejected (R-16)', async () => {
  // Given: Received purchase order
  const vendor = await createTestVendor('E16_供應商');
  const prod = await createTestProduct('E16_商品', '件', 100);
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  const withLine = await addPurchaseOrderLineAction(detail.order.id, { unit_id: prod.units[0].id, quantity: 2, purchase_cost: 10.0 });
  await submitPurchaseOrderAction(detail.order.id);
  await confirmPurchaseOrderReceivedAction(detail.order.id, [{ line_id: withLine.lines[0].id, received_quantity: 2 }]);

  // When & Then: Cancelling received order throws
  await assert.rejects(
    async () => {
      await cancelPurchaseOrderAction(detail.order.id);
    },
    /無效的狀態轉換：不可從 received 轉換至 cancelled/
  );
});

test('TC-172-PO-E-17: Error - Cancel already cancelled purchase order is rejected', async () => {
  // Given: Cancelled purchase order
  const vendor = await createTestVendor('E17_供應商');
  const detail = await createPurchaseOrderAction({ vendor_partner_id: vendor.id });
  await cancelPurchaseOrderAction(detail.order.id);

  // When & Then: Cancelling again throws
  await assert.rejects(
    async () => {
      await cancelPurchaseOrderAction(detail.order.id);
    },
    /無效的狀態轉換：不可從 cancelled 轉換至 cancelled/
  );
});

test('TC-172-OB-E-01: Boundary - Record opening balance with empty unit_id is rejected', async () => {
  // Given: Empty unit_id
  // When & Then: Throws required check
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({ unit_id: '', quantity_delta: 10, unit_cost: 50 });
    },
    /商品單位 ID 為必填項目/
  );
});

test('TC-172-OB-B-01: Boundary - Record opening balance with quantity_delta = 0 is rejected (R-17)', async () => {
  // Given: Valid unit
  const prod = await createTestProduct('OB_B01_商品', '件', 100);
  const unitId = prod.units[0].id;

  // When & Then: Quantity 0 throws
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({ unit_id: unitId, quantity_delta: 0, unit_cost: 50 });
    },
    /期初開帳數量必須大於 0/
  );
});

test('TC-172-OB-B-02: Boundary - Record opening balance with quantity_delta = -10 (negative) is rejected (R-17)', async () => {
  // Given: Valid unit
  const prod = await createTestProduct('OB_B02_商品', '件', 100);
  const unitId = prod.units[0].id;

  // When & Then: Negative quantity throws
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({ unit_id: unitId, quantity_delta: -10, unit_cost: 50 });
    },
    /期初開帳數量必須大於 0/
  );
});

test('TC-172-OB-B-03: Boundary - Record opening balance with unit_cost = -1 (negative) is rejected (R-17)', async () => {
  // Given: Valid unit
  const prod = await createTestProduct('OB_B03_商品', '件', 100);
  const unitId = prod.units[0].id;

  // When & Then: Negative cost throws
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({ unit_id: unitId, quantity_delta: 10, unit_cost: -1.0 });
    },
    /期初開帳成本不可為負數/
  );
});

test('TC-172-OB-B-04: Boundary - Record opening balance with unit_cost = 0 (zero cost) is accepted', async () => {
  // Given: Valid unit
  const prod = await createTestProduct('OB_B04_商品', '件', 100);
  const unitId = prod.units[0].id;

  // When: Recording opening balance with 0 cost
  const mov = await recordOpeningInventoryBalanceAction({
    unit_id: unitId,
    quantity_delta: 25,
    unit_cost: 0
  });

  // Then: Accepted, records unit_cost 0
  assert.equal(mov.quantity_delta, 25);
  assert.equal(mov.unit_cost, 0);
});

test('TC-172-OB-E-02: Error - Duplicate opening balance on the same unit is rejected (R-17)', async () => {
  // Given: Unit with existing opening balance
  const prod = await createTestProduct('OB_E02_商品', '件', 100);
  const unitId = prod.units[0].id;
  await recordOpeningInventoryBalanceAction({ unit_id: unitId, quantity_delta: 10, unit_cost: 50.0 });

  // When & Then: Attempting a second opening balance on the same unit throws
  await assert.rejects(
    async () => {
      await recordOpeningInventoryBalanceAction({ unit_id: unitId, quantity_delta: 20, unit_cost: 60.0 });
    },
    /(?:期初已開帳|此商品單位在〔.*〕已開帳，數量更正請用庫存調整（原因：期初更正）)/
  );
});
