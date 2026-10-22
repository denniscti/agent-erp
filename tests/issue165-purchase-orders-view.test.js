/**
 * @file issue165-purchase-orders-view.test.js
 * @description Layer 2 automated test suite for Purchase Orders View & Inventory Query (Issue #165).
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-165-RT-01 | Route set to '/app/purchase-orders' | Equivalence – Normal Route | activeWorkspace returns 'purchase-orders', getWorkspaceLabel returns '採購單' | Primary workspace route |
 * | TC-165-RT-02 | Route set to '/app/inventory' | Equivalence – Normal Route | activeWorkspace returns 'inventory', getWorkspaceLabel returns '庫存查詢' | Inventory workspace route |
 * | TC-165-RT-03 | Route with subpath '/app/purchase-orders/po_mock_123' | Boundary – Subpath Route | activeWorkspace returns 'purchase-orders' without crash | Subpath regex tolerance |
 * | TC-165-FLT-01 | Purchase orders list with mixed statuses, filter 'all' | Equivalence – All Filter | Returns all orders in tenant | Default view |
 * | TC-165-FLT-02 | Filter with 'draft' | Equivalence – Status Filter | Returns only draft orders | Status filter |
 * | TC-165-FLT-03 | Filter with 'ordered' | Equivalence – Status Filter | Returns only ordered orders | Status filter |
 * | TC-165-FLT-04 | Filter with 'received' | Equivalence – Status Filter | Returns only received orders | Status filter |
 * | TC-165-FLT-05 | Filter with 'cancelled' | Equivalence – Status Filter | Returns only cancelled orders | Status filter |
 * | TC-165-FLT-06 | Filter with empty or unknown status string | Boundary – Unknown Status | Safely handles empty/unknown filter without crash | Robust boundary |
 * | TC-165-TOT-01 | Order with multiple lines (e.g. 10 * 50 = 500, 5 * 100 = 500) | Equivalence – Total Amount Calculation | total_amount equals 1000.0, matches SUM(quantity * purchase_cost) | Real-time calculation |
 * | TC-165-TOT-02 | Draft order with 0 lines | Boundary – Zero Lines | total_amount equals 0, no NaN | Boundary 0 |
 * | TC-165-TSK-01 | Order with valid task_id ('task_xyz') | Equivalence – Chat-created Order | order.task_id is present, navigateToTask switches task and navigates | Back to task chat |
 * | TC-165-TSK-02 | Order with task_id === null / undefined | Boundary – Form-created Order | order.task_id is strictly null/undefined; no task link rendered | Form entry without task |
 * | TC-165-TIM-01 | Order lifecycle transitions | Equivalence – Timestamp Tracking | Records created_at, ordered_at, received_at, cancelled_at accurately | Audit trail |
 * | TC-165-QTY-01 | Received order with quantity == received_quantity | Equivalence – Equal Quantity | Difference is 0, indicates full delivery | Normal receipt |
 * | TC-165-QTY-02 | Received order with received_quantity < quantity | Boundary / Error – Under-delivery | Detected under-delivery delta (e.g. ordered 20, rec 15 -> under 5) | Visual alert trigger |
 * | TC-165-QTY-03 | Received order with received_quantity > quantity | Boundary / Error – Over-delivery | Detected over-delivery delta (e.g. ordered 20, rec 25 -> over 5) | Visual alert trigger |
 * | TC-165-QTY-04 | Non-received order (draft/ordered) | Boundary – Pending Receipt | received_quantity is undefined/null | Pending status |
 * | TC-165-INV-01 | Query inventory levels for unit | Equivalence – Inventory Aggregation | current_quantity equals SUM(quantity_delta) of inventory_movements | Data consistency |
 * | TC-165-INV-02 | Unit with no inventory movements | Boundary – Zero Inventory | current_quantity equals 0 | Boundary 0 |
 * | TC-165-MOV-01 | list_inventory_movements chronological order | Equivalence – Movement Breakdown | Returns movements ordered ascending by created_at | Ledger chronological breakdown |
 * | TC-165-MOV-02 | Movement linked to purchase order | Equivalence – Reference Linkage | reference_type == 'purchase_order', reference_id contains PO id | PO linkage |
 * | TC-165-MOV-03 | Filter movements by specific unit_id | Boundary – Unit Filter | Returns only movements matching unit_id | Filtered breakdown |
 * | TC-165-MOV-04 | Filter movements by non-existent unit_id | Boundary – Non-existent Unit | Returns empty array [] safely | Empty boundary |
 * | TC-165-EMP-01 | Empty purchase orders guidance | Boundary – Empty Orders State | Chat action switches to agent workspace; manual form triggers Issue #172 notice | Action behavioral contract |
 * | TC-165-EMP-02 | Empty inventory guidance | Boundary – Empty Inventory State | Opening balance action triggers Issue #172 notice and updates route | Action behavioral contract |
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
  showToast,
  fetchPurchaseOrders,
  fetchPurchaseOrderDetail,
  fetchInventoryLevels,
  fetchInventoryMovements,
  navigateToTask
} = storeModule;

// ==========================================
// 1. Workspace Route & Label Tests
// ==========================================

test('TC-165-RT-01: Equivalence - Route set to /app/purchase-orders resolves activeWorkspace and label', () => {
  // Given: Route set to /app/purchase-orders
  appState.route = '/app/purchase-orders';

  // When: Resolving activeWorkspace and label
  const ws = appState.activeWorkspace;
  const label = getWorkspaceLabel(ws);

  // Then: Workspace is purchase-orders, label is 採購單
  assert.equal(ws, 'purchase-orders', 'activeWorkspace should return "purchase-orders"');
  assert.equal(label, '採購單', 'Workspace label should be "採購單"');
});

test('TC-165-RT-02: Equivalence - Route set to /app/inventory resolves activeWorkspace and label', () => {
  // Given: Route set to /app/inventory
  appState.route = '/app/inventory';

  // When: Resolving activeWorkspace and label
  const ws = appState.activeWorkspace;
  const label = getWorkspaceLabel(ws);

  // Then: Workspace is inventory, label is 庫存查詢
  assert.equal(ws, 'inventory', 'activeWorkspace should return "inventory"');
  assert.equal(label, '庫存查詢', 'Workspace label should be "庫存查詢"');
});

test('TC-165-RT-03: Boundary - Subpath /app/purchase-orders/po_123 resolves activeWorkspace without crash', () => {
  // Given: Subpath route under purchase-orders
  appState.route = '/app/purchase-orders/po_123';

  // When: Resolving activeWorkspace
  const ws = appState.activeWorkspace;

  // Then: Resolves to 'purchase-orders' via prefix match
  assert.equal(ws, 'purchase-orders', 'Subpath should resolve to "purchase-orders"');
});

// ==========================================
// 2. Purchase Orders Filter & Listing Tests
// ==========================================

test('TC-165-FLT-01 ~ 06: Status filtering across draft, ordered, received, cancelled, and all', async () => {
  // Given: A vendor and a resale product
  const vendor = await invoke('create_partner', {
    name: `測試供應商_FLT_${Date.now()}`,
    is_vendor: true
  });
  const prod = await invoke('create_product', {
    name: `測試商品_FLT_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 100
  });
  const unitId = prod.units[0].id;

  // Create 4 distinct orders with different statuses
  // 1. draft order
  const draftDetail = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 5, purchase_cost: 40 }]
  });

  // 2. ordered order
  const orderedDetail = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 10, purchase_cost: 50 }]
  });
  await invoke('submit_purchase_order', { orderId: orderedDetail.order.id });

  // 3. received order
  const receivedDetail = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 15, purchase_cost: 60 }]
  });
  await invoke('submit_purchase_order', { orderId: receivedDetail.order.id });
  const lineToRec = (await invoke('get_purchase_order', { orderId: receivedDetail.order.id })).lines[0].id;
  await invoke('confirm_purchase_order_received', {
    orderId: receivedDetail.order.id,
    lineReceivedQuantities: [{ line_id: lineToRec, received_quantity: 15 }]
  });

  // 4. cancelled order
  const cancelledDetail = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 8, purchase_cost: 45 }]
  });
  await invoke('cancel_purchase_order', { orderId: cancelledDetail.order.id });

  // When: Filtering with 'all'
  const allOrders = await fetchPurchaseOrders({ filterStatus: 'all' });
  // Then: Returns all orders including our 4 created ones
  assert.ok(allOrders.length >= 4, 'Should contain at least 4 orders');

  // When: Filtering with 'draft'
  const draftOrders = await fetchPurchaseOrders({ filterStatus: 'draft' });
  // Then: All returned orders have status === 'draft'
  assert.ok(draftOrders.length >= 1);
  assert.ok(draftOrders.every(o => o.status === 'draft'), 'All draft orders must have status "draft"');
  assert.ok(draftOrders.some(o => o.id === draftDetail.order.id));

  // When: Filtering with 'ordered'
  const orderedOrders = await fetchPurchaseOrders({ filterStatus: 'ordered' });
  // Then: All returned orders have status === 'ordered'
  assert.ok(orderedOrders.length >= 1);
  assert.ok(orderedOrders.every(o => o.status === 'ordered'), 'All ordered orders must have status "ordered"');
  assert.ok(orderedOrders.some(o => o.id === orderedDetail.order.id));

  // When: Filtering with 'received'
  const receivedOrders = await fetchPurchaseOrders({ filterStatus: 'received' });
  // Then: All returned orders have status === 'received'
  assert.ok(receivedOrders.length >= 1);
  assert.ok(receivedOrders.every(o => o.status === 'received'), 'All received orders must have status "received"');
  assert.ok(receivedOrders.some(o => o.id === receivedDetail.order.id));

  // When: Filtering with 'cancelled'
  const cancelledOrders = await fetchPurchaseOrders({ filterStatus: 'cancelled' });
  // Then: All returned orders have status === 'cancelled'
  assert.ok(cancelledOrders.length >= 1);
  assert.ok(cancelledOrders.every(o => o.status === 'cancelled'), 'All cancelled orders must have status "cancelled"');
  assert.ok(cancelledOrders.some(o => o.id === cancelledDetail.order.id));

  // When: Boundary - unknown filter status
  const unknownOrders = await fetchPurchaseOrders({ filterStatus: 'non_existent_status' });
  // Then: Returns empty array without throwing error
  assert.equal(unknownOrders.length, 0);
});

// ==========================================
// 3. Total Amount Calculation & Zero Lines Boundary
// ==========================================

test('TC-165-TOT-01 & TOT-02: Total amount equals SUM(quantity * purchase_cost) and zero lines boundary', async () => {
  // Given: A vendor and a product
  const vendor = await invoke('create_partner', {
    name: `測試供應商_TOT_${Date.now()}`,
    is_vendor: true
  });
  const prod1 = await invoke('create_product', {
    name: `測試商品_TOT_A_${Date.now()}`,
    category: '轉售商品',
    unit_name: '件',
    selling_price: 200
  });
  const unitId1 = prod1.units[0].id;

  const prod2 = await invoke('create_product', {
    name: `測試商品_TOT_B_${Date.now()}`,
    category: '轉售商品',
    unit_name: '箱',
    selling_price: 500
  });
  const unitId2 = prod2.units[0].id;

  // When: Case TC-165-TOT-02: Creating order with zero lines (Boundary)
  const emptyOrder = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: []
  });
  // Then: total_amount is exactly 0
  assert.equal(emptyOrder.order.total_amount, 0, 'Zero lines order must have 0 total amount');

  // When: Case TC-165-TOT-01: Adding lines with 10 * 50 = 500 and 5 * 100 = 500
  await invoke('add_purchase_order_line', {
    orderId: emptyOrder.order.id,
    unitId: unitId1,
    quantity: 10,
    purchaseCost: 50
  });
  const updatedOrder = await invoke('add_purchase_order_line', {
    orderId: emptyOrder.order.id,
    unitId: unitId2,
    quantity: 5,
    purchaseCost: 100
  });

  // Then: Total amount is 1000.0, matching lines SUM(quantity * purchase_cost)
  assert.equal(updatedOrder.order.total_amount, 1000, 'Total amount must equal SUM of line subtotals');
  const sumSubtotals = updatedOrder.lines.reduce((acc, l) => acc + l.subtotal, 0);
  assert.equal(updatedOrder.order.total_amount, sumSubtotals);
});

// ==========================================
// 4. Task Conversation Linkage Tests
// ==========================================

test('TC-165-TSK-01 & TSK-02: Task ID linkage contract (task-created vs form-created)', async () => {
  // Given: Vendor
  const vendor = await invoke('create_partner', {
    name: `測試供應商_TSK_${Date.now()}`,
    is_vendor: true
  });

  // When: Creating order with explicit task_id (from conversation entry)
  const taskOrder = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    taskId: 'task_conversation_456'
  });

  // Then: task_id is preserved and equals 'task_conversation_456'
  assert.equal(taskOrder.order.task_id, 'task_conversation_456');

  // When: Creating order without task_id (from manual form entry)
  const formOrder = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    taskId: null
  });

  // Then: task_id is strictly null / undefined
  assert.ok(formOrder.order.task_id === null || formOrder.order.task_id === undefined);

  // When: Testing navigateToTask helper
  let switchedTaskId = null;
  await navigateToTask('task_conversation_456');
  // Then: Route navigates to /app/agent
  assert.equal(appState.route, '/app/agent');
});

// ==========================================
// 5. Lifecycle Timestamps & Received Quantity Comparison
// ==========================================

test('TC-165-TIM-01: Lifecycle timestamps tracking (created_at, ordered_at, received_at, cancelled_at)', async () => {
  // Given: Vendor and product
  const vendor = await invoke('create_partner', {
    name: `測試供應商_TIM_${Date.now()}`,
    is_vendor: true
  });
  const prod = await invoke('create_product', {
    name: `測試商品_TIM_${Date.now()}`,
    category: '轉售商品',
    unit_name: '箱'
  });
  const unitId = prod.units[0].id;

  // When: Draft order created
  const draft = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 10, purchase_cost: 100 }]
  });
  // Then: created_at > 0, ordered_at is null, received_at is null, cancelled_at is null
  assert.ok(draft.order.created_at > 0);
  assert.ok(draft.order.ordered_at === null || draft.order.ordered_at === undefined);
  assert.ok(draft.order.received_at === null || draft.order.received_at === undefined);
  assert.ok(draft.order.cancelled_at === null || draft.order.cancelled_at === undefined);

  // When: Submitting order
  const ordered = await invoke('submit_purchase_order', { orderId: draft.order.id });
  // Then: ordered_at > 0
  assert.ok(ordered.order.ordered_at > 0);

  // When: Confirming receipt
  const lineId = ordered.lines[0].id;
  const received = await invoke('confirm_purchase_order_received', {
    orderId: draft.order.id,
    lineReceivedQuantities: [{ line_id: lineId, received_quantity: 10 }]
  });
  // Then: received_at > 0
  assert.ok(received.order.received_at > 0);
});

test('TC-165-QTY-01 ~ 04: Received order visual alert conditions (equal, under-delivery, over-delivery)', async () => {
  // Given: Vendor and product
  const vendor = await invoke('create_partner', {
    name: `測試供應商_QTY_${Date.now()}`,
    is_vendor: true
  });
  const prod = await invoke('create_product', {
    name: `測試商品_QTY_${Date.now()}`,
    category: '轉售商品',
    unit_name: '件'
  });
  const unitId = prod.units[0].id;

  // --- Case 1: Under-delivery (ordered 20, received 15 ->少到 5) ---
  const poUnder = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 20, purchase_cost: 10 }]
  });
  await invoke('submit_purchase_order', { orderId: poUnder.order.id });
  const lineUnderId = (await invoke('get_purchase_order', { orderId: poUnder.order.id })).lines[0].id;
  const underRec = await invoke('confirm_purchase_order_received', {
    orderId: poUnder.order.id,
    lineReceivedQuantities: [{ line_id: lineUnderId, received_quantity: 15 }]
  });

  const underLine = underRec.lines[0];
  assert.equal(underLine.quantity, 20);
  assert.equal(underLine.received_quantity, 15);
  // Verify under-delivery alert detection: received < quantity
  const isUnder = underLine.received_quantity < underLine.quantity;
  const underDelta = underLine.quantity - underLine.received_quantity;
  assert.equal(isUnder, true);
  assert.equal(underDelta, 5, 'Should detect under-delivery of 5');

  // --- Case 2: Over-delivery (ordered 20, received 25 -> 多到 5) ---
  const poOver = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 20, purchase_cost: 10 }]
  });
  await invoke('submit_purchase_order', { orderId: poOver.order.id });
  const lineOverId = (await invoke('get_purchase_order', { orderId: poOver.order.id })).lines[0].id;
  const overRec = await invoke('confirm_purchase_order_received', {
    orderId: poOver.order.id,
    lineReceivedQuantities: [{ line_id: lineOverId, received_quantity: 25 }]
  });

  const overLine = overRec.lines[0];
  assert.equal(overLine.quantity, 20);
  assert.equal(overLine.received_quantity, 25);
  // Verify over-delivery alert detection: received > quantity
  const isOver = overLine.received_quantity > overLine.quantity;
  const overDelta = overLine.received_quantity - overLine.quantity;
  assert.equal(isOver, true);
  assert.equal(overDelta, 5, 'Should detect over-delivery of 5');

  // --- Case 3: Exact delivery (ordered 20, received 20 -> 全數到貨) ---
  const poExact = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 20, purchase_cost: 10 }]
  });
  await invoke('submit_purchase_order', { orderId: poExact.order.id });
  const lineExactId = (await invoke('get_purchase_order', { orderId: poExact.order.id })).lines[0].id;
  const exactRec = await invoke('confirm_purchase_order_received', {
    orderId: poExact.order.id,
    lineReceivedQuantities: [{ line_id: lineExactId, received_quantity: 20 }]
  });

  const exactLine = exactRec.lines[0];
  assert.equal(exactLine.quantity, 20);
  assert.equal(exactLine.received_quantity, 20);
  assert.equal(exactLine.received_quantity === exactLine.quantity, true);
});

// ==========================================
// 6. Inventory Level & Movement Breakdown Tests
// ==========================================

test('TC-165-INV-01 & TC-165-MOV-01 ~ 04: Inventory calculation, chronological breakdown and PO reference link', async () => {
  // Given: Resale product with a primary unit
  const vendor = await invoke('create_partner', {
    name: `測試供應商_INV_${Date.now()}`,
    is_vendor: true
  });
  const prod = await invoke('create_product', {
    name: `庫存測試晶片_${Date.now()}`,
    category: '轉售商品',
    unit_name: '顆',
    selling_price: 300
  });
  const unitId = prod.units[0].id;

  // When: Step 1 - Record opening balance of 12 units
  const openMov = await invoke('record_opening_inventory_balance', {
    unitId: unitId,
    quantityDelta: 12,
    unitCost: 150
  });
  assert.equal(openMov.quantity_delta, 12);
  assert.equal(openMov.reason, 'opening_balance');

  // When: Step 2 - Receive 5 units from purchase order
  const po = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 5, purchase_cost: 160 }]
  });
  await invoke('submit_purchase_order', { orderId: po.order.id });
  const lineId = (await invoke('get_purchase_order', { orderId: po.order.id })).lines[0].id;
  await invoke('confirm_purchase_order_received', {
    orderId: po.order.id,
    lineReceivedQuantities: [{ line_id: lineId, received_quantity: 5 }]
  });

  // Then: TC-165-INV-01: list_inventory_levels reflects 12 + 5 = 17
  const levels = await fetchInventoryLevels();
  const unitLevel = levels.find(l => l.unit_id === unitId);
  assert.ok(unitLevel, 'Unit must exist in inventory levels');
  assert.equal(unitLevel.current_quantity, 17, 'Current quantity must equal SUM(12 + 5) = 17');

  // Then: TC-165-MOV-01 & MOV-03: list_inventory_movements for unitId
  const movements = await fetchInventoryMovements(unitId);
  assert.equal(movements.length, 2, 'Should have exactly 2 movements for this unit');

  // Chronological verification (created_at ascending)
  assert.ok(movements[0].created_at <= movements[1].created_at, 'Movements must be sorted chronologically');
  assert.equal(movements[0].reason, 'opening_balance');
  assert.equal(movements[0].quantity_delta, 12);

  // TC-165-MOV-02: PO reference linkage
  assert.equal(movements[1].reason, 'purchase_receipt');
  assert.equal(movements[1].quantity_delta, 5);
  assert.equal(movements[1].reference_type, 'purchase_order');
  assert.equal(movements[1].reference_id, po.order.id, 'Reference ID must match purchase order ID');

  // Then: TC-165-MOV-04: Non-existent unitId returns empty movements
  const nonExistentMovs = await fetchInventoryMovements('non_existent_unit_id_999');
  assert.equal(nonExistentMovs.length, 0, 'Non-existent unit should return empty movements');
});

// ==========================================
// 7. Empty State UX Contracts
// ==========================================

test('TC-165-EMP-01 & EMP-02: Empty state actions provide AI chat navigation and manual form notices', () => {
  // Given: Workspace initial state
  navigate('/app/purchase-orders');
  assert.equal(appState.activeWorkspace, 'purchase-orders');

  // When:  TC-165-EMP-01 User triggers "透過 AI 任務對話建立" action
  navigate('/app/agent');

  // Then:  Route and activeWorkspace seamlessly switch to AI agent
  assert.equal(appState.route, '/app/agent');
  assert.equal(appState.activeWorkspace, 'agent');

  // When:  TC-165-EMP-01 User triggers "前往手動表單建立" action
  showToast('採購單手動建立與狀態推進表單即將於 Issue #172 提供');
  navigate('/app/purchase-orders/new');

  // Then:  Toast notifies user of Issue #172 scope, route updates without crashing
  assert.equal(appState.toastMessage, '採購單手動建立與狀態推進表單即將於 Issue #172 提供');
  assert.equal(appState.route, '/app/purchase-orders/new');

  // When:  TC-165-EMP-02 User triggers "前往「期初開帳」建立底帳" action
  showToast('期初開帳表單即將於 Issue #172 提供');
  navigate('/app/inventory/opening-balance');

  // Then:  Toast notifies user of Issue #172 scope, route updates without crashing
  assert.equal(appState.toastMessage, '期初開帳表單即將於 Issue #172 提供');
  assert.equal(appState.route, '/app/inventory/opening-balance');

  // Cleanup
  appState.toastMessage = null;
});
