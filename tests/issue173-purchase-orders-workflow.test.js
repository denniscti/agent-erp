/**
 * @file issue173-purchase-orders-workflow.test.js
 * @description Layer 2 automated test suite for Purchase Orders Task-Driven Workflow and AgentProfile Integration (Issue #173).
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-WF-PO-N-01 | Batch multi-line input via dynamic profile: "跟大同買 5 台螢幕、3 個滑鼠" | Equivalence – Multi-item Draft Creation | Full lines in confirmation card, PO created in draft with task_id, Task remains in_progress | Core multi-item extraction |
 * | TC-WF-PO-N-02 | Submit order input via regex: "可以下單了" | Equivalence – Order Submission Transition | Transitions draft -> ordered, Task remains in_progress | Single intent regex |
 * | TC-WF-PO-N-03 | Full receipt input via regex: "貨到了" | Equivalence – Full Receipt & Task Done | All items marked full receipt, PO -> received, Task mirrors to done | completesTask: true |
 * | TC-WF-PO-N-04 | Quantity discrepancy input: "貨到了，但螢幕只來了 3 台" | Equivalence – Discrepancy Receipt & Task Done | Screen marked received: 3 (diff -2), mouse full, PO -> received, Task mirrors to done | Dynamic profile discrepancy |
 * | TC-WF-PO-N-05 | Cancel order input via regex: "取消這張單" | Equivalence – Order Cancellation & Task Cancelled | PO -> cancelled, Task mirrors to cancelled | cancelsTask: true |
 * | TC-WF-PO-N-06 | Human rejection on pending confirmation card | Equivalence – Confirmation Cancellation | No state change, audit_logs records rejected decision | Audit rejection |
 * | TC-WF-PO-E-01 | Unknown vendor input: "跟台積電買 10 台螢幕" | Error – Unknown Vendor Defense | No pending card, returns clarification with manual form link | Defense against blind guess |
 * | TC-WF-PO-E-02 | Unknown product input: "跟大同買 50 顆火箭發動機" | Error – Unknown Product Defense | No pending card, returns clarification, no blind ID | Defense against blind guess |
 * | TC-WF-PO-E-03 | Highly ambiguous vendor/product input | Error – Ambiguity Clarification | Lists options, requests clarification without tool call | Ambiguity handling |
 * | TC-WF-PO-E-04 | Submit or receive when no purchase order exists in task | Error – Missing Purchase Order | Throws friendly error prompting user to create draft first | Prerequisite check |
 * | TC-WF-PO-E-05 | Cancel already received purchase order | Error – Invalid State Transition | Terminal mutation rejected: received PO cannot be cancelled | State machine defense |
 * | TC-WF-PO-B-01 | Line item with quantity = 0 or negative | Boundary – Invalid Quantity (<= 0) | Validation error: 採購數量必須大於 0 | Boundary <= 0 |
 * | TC-WF-PO-B-02 | Empty or irrelevant chit-chat input: "今天天氣真好" | Boundary – Irrelevant message | Returns fallback text, no tool triggered | Ambient filter |
 * | TC-WF-PO-INT-01 | Create task with vendor.manage_purchase_order skill | Integration – Skill Binding & Profile Lookup | getAgentProfileForTask resolves purchaseOrderAgentProfile | UI/Task integration |
 * | TC-WF-PO-AUD-01 | Audit log verification for approved purchase order lifecycle | Integration – Audit Logging | Each approved action records approved in audit_logs with operator | Audit compliance |
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
  createTaskAction,
  switchActiveTask,
  confirmPendingTaskAction,
  cancelPendingTaskAction,
  fetchAuditLogs,
  filterTasksBySkills
} = await import('../src/lib/store.svelte.js');

const {
  runAgentTurn,
  executeConfirmation,
  executeCancellation,
  assembleSystemPrompt
} = await import('../src/lib/workflow/harness.js');

const {
  purchaseOrderAgentProfile,
  createPurchaseOrderToolHandler,
  submitPurchaseOrderToolHandler,
  confirmPurchaseOrderReceivedToolHandler,
  cancelPurchaseOrderToolHandler,
  buildCatalogContext
} = await import('../src/lib/workflow/purchaseOrders.js');

const {
  getAgentProfileForTask,
  getDeclaredSkills
} = await import('../src/lib/workflow/index.js');

// Standard test fixtures
async function createTestVendor(name = '大同股份有限公司') {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  return await invoke('create_partner', {
    name: `${name}_${ts}`,
    is_vendor: true,
    is_customer: false
  });
}

async function createTestProductWithUnit(name = '4K 護眼螢幕', unitName = '台', price = 4500) {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const detail = await invoke('create_product', {
    name: `${name}_${ts}`,
    category: 'resale',
    unit_name: unitName,
    selling_price: price
  });

  return { product: detail.product, unit: detail.units[0], detail };
}

// ==============================================================================
// Test Suites
// ==============================================================================

test('TC-WF-PO-INT-01: Integration – Task creation with vendor.manage_purchase_order skill and profile resolution', async () => {
  // Given: Preconditions - Registered skill list contains vendor.manage_purchase_order
  const declared = getDeclaredSkills();
  const poSkill = declared.find(s => s.id === 'vendor.manage_purchase_order');
  assert.ok(poSkill, 'Skill vendor.manage_purchase_order must be declared');
  assert.equal(poSkill.domain, 'vendor');

  // When: Operation to execute - User creates a new task selecting vendor.manage_purchase_order
  const task = await createTaskAction(
    '採購 2026 年度資訊耗材',
    'vendor',
    '主管',
    null,
    'vendor.manage_purchase_order'
  );

  // Then: Expected result - getAgentProfileForTask correctly resolves purchaseOrderAgentProfile
  assert.ok(task && task.id);
  const resolvedProfile = getAgentProfileForTask(task);
  assert.ok(resolvedProfile, 'Profile must be resolved for task with skillId');
  assert.equal(resolvedProfile.id, 'vendor.manage_purchase_order');
  assert.equal(resolvedProfile.domain, 'vendor');

  // Also test title fallback for purchase tasks without skillId
  const fallbackTask = { id: 'task_title_only', title: '採購辦公用品設備' };
  const fallbackProfile = getAgentProfileForTask(fallbackTask);
  assert.ok(fallbackProfile);
  assert.equal(fallbackProfile.id, 'vendor.manage_purchase_order');

  // Verify user-created task retention even when effectiveSkills is empty (Reviewer Issue 1)
  const visible = filterTasksBySkills([task], []);
  assert.equal(visible.length, 1, 'User-created task must remain visible to its creator even if effective skills are empty');
});

test('TC-WF-PO-N-01: Multi-item batch draft creation via dynamic profile with task_id binding', async () => {
  // Given: Preconditions - Active vendor and 2 products in catalog, and an active task
  const vendor = await createTestVendor('大同企業');
  const screenItem = await createTestProductWithUnit('27吋螢幕', '台', 4500);
  const mouseItem = await createTestProductWithUnit('靜音滑鼠', '個', 350);

  const task = await createTaskAction('向大同採購電腦耗材', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  // Mock catalog injected into context
  const testCatalog = {
    vendors: [{ partner_id: vendor.id, name: vendor.name }],
    products: [
      {
        product_id: screenItem.product.id,
        name: screenItem.product.name,
        units: [{ unit_id: screenItem.unit.id, name: '台', default_cost: 4500, vendor_partner_id: vendor.id }]
      },
      {
        product_id: mouseItem.product.id,
        name: mouseItem.product.name,
        units: [{ unit_id: mouseItem.unit.id, name: '個', default_cost: 350, vendor_partner_id: vendor.id }]
      }
    ]
  };

  // Mock LLM simulating dynamic profile extraction for batch oral items
  const mockDynamicDetector = async (msg) => {
    if (msg.includes('大同') && msg.includes('螢幕') && msg.includes('滑鼠')) {
      return {
        tool_call: {
          tool: 'create_purchase_order',
          vendor_partner_id: vendor.id,
          items: [
            { unit_id: screenItem.unit.id, quantity: 5, unit_price: 4500 },
            { unit_id: mouseItem.unit.id, quantity: 3, unit_price: 350 }
          ]
        },
        content: null
      };
    }
    return { tool_call: null, content: '請告訴我需要採購的品項與數量。' };
  };

  const context = {
    taskId: task.id,
    activeTask: task,
    catalog: testCatalog
  };

  // When: Operation to execute - User sends oral batch purchase intent
  const turnResult = await runAgentTurn(
    '跟大同買 5 台螢幕、3 個滑鼠',
    purchaseOrderAgentProfile,
    context,
    { llmDetector: mockDynamicDetector }
  );

  // Then: Expected result - Pending confirmation with full lines, item details, and correct grand total
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_purchase_order');
  assert.ok(turnResult.content.includes(vendor.name));
  assert.ok(turnResult.content.includes('5 台'));
  assert.ok(turnResult.content.includes('3 個'));
  assert.ok(turnResult.content.includes('23550'), 'Total should be 5*4500 + 3*350 = 23550');

  // When: User confirms the pending card through store action
  appState.pendingTaskConfirmation = turnResult.confirmation;
  await confirmPendingTaskAction();

  // Then: Draft PO created with task_id written, status is draft, Task status advances to in_progress
  const pos = await invoke('list_purchase_orders');
  const createdOrder = pos.find(p => p.task_id === task.id);
  assert.ok(createdOrder && createdOrder.id);
  assert.equal(createdOrder.status, 'draft');
  assert.equal(createdOrder.task_id, task.id);
  const detail = await invoke('get_purchase_order', { order_id: createdOrder.id });
  const lines = detail.lines || [];
  assert.equal(lines.length, 2);
  assert.equal(createdOrder.total_amount, 23550);

  // Verify task status in store
  const currentTask = appState.tasks.find(t => t.id === task.id);
  assert.equal(currentTask.status, 'in_progress');
});

test('TC-WF-PO-N-02: Submit purchase order via single intent regex', async () => {
  // Given: Preconditions - Existing draft purchase order linked to active task
  const vendor = await createTestVendor('聯強國際');
  const prodItem = await createTestProductWithUnit('機械鍵盤', '把', 1200);

  const task = await createTaskAction('聯強週邊採購', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  // Create initial draft order
  const draftDetail = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    task_id: task.id,
    initial_lines: [{ unit_id: prodItem.unit.id, quantity: 4, purchase_cost: 1200 }]
  });
  const draftOrder = draftDetail.order || draftDetail;

  const context = { taskId: task.id, activeTask: task };

  // When: Operation to execute - User says "可以下單了" without explicit order_id
  const turnResult = await runAgentTurn(
    '可以下單了',
    purchaseOrderAgentProfile,
    context
  );

  // Then: Expected result - ToolHandler automatically resolves linked order and asks confirmation
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'submit_purchase_order');
  assert.ok(turnResult.content.includes(draftOrder.po_number));
  assert.ok(turnResult.content.includes('確認送出下單嗎'));

  // When: Confirm pending card through store action
  appState.pendingTaskConfirmation = turnResult.confirmation;
  await confirmPendingTaskAction();

  // Then: PO status becomes ordered, Task status remains in_progress
  const getRes = await invoke('get_purchase_order', { order_id: draftOrder.id });
  const submitted = getRes.order || getRes;
  assert.equal(submitted.status, 'ordered');
  assert.ok(submitted.ordered_at > 0);

  const currentTask = appState.tasks.find(t => t.id === task.id);
  assert.equal(currentTask.status, 'in_progress');
});

test('TC-WF-PO-N-03: Full receipt confirmation via regex and task done mirroring', async () => {
  // Given: Preconditions - An ordered purchase order linked to active task
  const vendor = await createTestVendor('明碁智能');
  const prodItem = await createTestProductWithUnit('抗藍光螢幕', '台', 3800);

  const task = await createTaskAction('明碁螢幕採購', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  const orderDetail = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    task_id: task.id,
    initial_lines: [{ unit_id: prodItem.unit.id, quantity: 10, purchase_cost: 3800 }]
  });
  const order = orderDetail.order || orderDetail;
  await invoke('submit_purchase_order', { order_id: order.id });

  const context = { taskId: task.id, activeTask: task };

  // When: Operation to execute - User says "貨到了"
  const turnResult = await runAgentTurn(
    '貨到了',
    purchaseOrderAgentProfile,
    context
  );

  // Then: Expected result - ToolHandler detects full receipt confirmation card
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'confirm_purchase_order_received');
  assert.ok(turnResult.content.includes('全數到貨'));
  assert.ok(turnResult.content.includes('10 台'));

  // When: Confirm pending card through store action to verify Task status update
  appState.pendingTaskConfirmation = turnResult.confirmation;
  await confirmPendingTaskAction();

  // Then: PO transitions to received, task status is mirrored to done (completesTask)
  const getRes = await invoke('get_purchase_order', { order_id: order.id });
  const receivedPo = getRes.order ? { ...getRes.order, lines: getRes.lines } : getRes;
  assert.equal(receivedPo.status, 'received');
  assert.equal(receivedPo.lines[0].received_quantity, 10);

  const currentTask = appState.tasks.find(t => t.id === task.id);
  assert.equal(currentTask.status, 'done', 'Task status must mirror to done upon receipt');
});

test('TC-WF-PO-N-04: Quantity discrepancy receipt via dynamic profile and task done mirroring', async () => {
  // Given: Preconditions - An ordered purchase order with 2 items (Screen: 5, Mouse: 3)
  const vendor = await createTestVendor('優質科技');
  const screen = await createTestProductWithUnit('護眼螢幕', '台', 4500);
  const mouse = await createTestProductWithUnit('光學滑鼠', '個', 200);

  const task = await createTaskAction('雙品項採購', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  const orderDetail = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    task_id: task.id,
    initial_lines: [
      { unit_id: screen.unit.id, quantity: 5, purchase_cost: 4500 },
      { unit_id: mouse.unit.id, quantity: 3, purchase_cost: 200 }
    ]
  });
  const order = orderDetail.order || orderDetail;
  await invoke('submit_purchase_order', { order_id: order.id });

  const getDetail = await invoke('get_purchase_order', { order_id: order.id });
  const detail = getDetail.order ? { ...getDetail.order, lines: getDetail.lines } : getDetail;
  const screenLine = detail.lines.find(l => l.unit_id === screen.unit.id);

  // Mock LLM simulating dynamic profile extraction for quantity discrepancy
  const mockDiscrepancyDetector = async (msg) => {
    if (msg.includes('貨到了') && msg.includes('3 台')) {
      return {
        tool_call: {
          tool: 'confirm_purchase_order_received',
          order_id: order.id,
          line_received_quantities: [
            { line_id: screenLine.id, product_name: '螢幕', received_quantity: 3 }
          ]
        },
        content: null
      };
    }
    return { tool_call: null, content: '' };
  };

  const context = { taskId: task.id, activeTask: task };

  // When: Operation to execute - User says "貨到了，但螢幕只來了 3 台"
  const turnResult = await runAgentTurn(
    '貨到了，但螢幕只來了 3 台',
    purchaseOrderAgentProfile,
    context,
    { llmDetector: mockDiscrepancyDetector }
  );

  // Then: Confirmation card clearly highlights discrepancy (-2) for screen and default full receipt for mouse
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.ok(turnResult.content.includes('差異：-2'));
  assert.ok(turnResult.content.includes('全數到貨'));

  // When: Confirm pending card through store action
  appState.pendingTaskConfirmation = turnResult.confirmation;
  await confirmPendingTaskAction();

  // Then: PO received with exact discrepancy recorded, and Task mirrors to done
  const getRes = await invoke('get_purchase_order', { order_id: order.id });
  const receivedPo = getRes.order ? { ...getRes.order, lines: getRes.lines } : getRes;
  assert.equal(receivedPo.status, 'received');

  const sLine = receivedPo.lines.find(l => l.unit_id === screen.unit.id);
  const mLine = receivedPo.lines.find(l => l.unit_id === mouse.unit.id);
  assert.equal(sLine.received_quantity, 3, 'Screen received quantity must be 3');
  assert.equal(mLine.received_quantity, 3, 'Mouse received quantity defaults to ordered 3');

  const currentTask = appState.tasks.find(t => t.id === task.id);
  assert.equal(currentTask.status, 'done', 'Task must be marked done');
});

test('TC-WF-PO-N-05: Order cancellation via regex and task cancelled mirroring', async () => {
  // Given: Preconditions - An ordered purchase order linked to active task
  const vendor = await createTestVendor('缺貨廠商');
  const prodItem = await createTestProductWithUnit('特殊晶片', '顆', 15000);

  const task = await createTaskAction('晶片採購任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  const orderDetail = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    task_id: task.id,
    initial_lines: [{ unit_id: prodItem.unit.id, quantity: 2, purchase_cost: 15000 }]
  });
  const order = orderDetail.order || orderDetail;
  await invoke('submit_purchase_order', { order_id: order.id });

  const context = { taskId: task.id, activeTask: task };

  // When: Operation to execute - User says "供應商說缺貨，取消這張單"
  const turnResult = await runAgentTurn(
    '供應商說缺貨，取消這張單',
    purchaseOrderAgentProfile,
    context
  );

  // Then: Confirmation card asks for cancellation approval
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'cancel_purchase_order');
  assert.ok(turnResult.content.includes('確認要取消這張單嗎'));

  // When: User confirms cancellation through store action
  appState.pendingTaskConfirmation = turnResult.confirmation;
  await confirmPendingTaskAction();

  // Then: PO transitions to cancelled, and Task status mirrors to cancelled (cancelsTask)
  const getRes = await invoke('get_purchase_order', { order_id: order.id });
  const cancelledPo = getRes.order || getRes;
  assert.equal(cancelledPo.status, 'cancelled');
  assert.ok(cancelledPo.cancelled_at > 0);

  const currentTask = appState.tasks.find(t => t.id === task.id);
  assert.equal(currentTask.status, 'cancelled', 'Task status must mirror to cancelled');
});

test('TC-WF-PO-N-06: Human rejection on pending confirmation card records audit log', async () => {
  // Given: Preconditions - Pending card for order cancellation
  const vendor = await createTestVendor('審核測試廠商');
  const prod = await createTestProductWithUnit('備品組', '組', 500);

  const task = await createTaskAction('待取消任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  const orderDetail = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    task_id: task.id,
    initial_lines: [{ unit_id: prod.unit.id, quantity: 1, purchase_cost: 500 }]
  });
  const order = orderDetail.order || orderDetail;

  const turnResult = await runAgentTurn('取消這張單', purchaseOrderAgentProfile, { taskId: task.id, activeTask: task });
  assert.equal(turnResult.type, 'pending_confirmation');

  // When: Operation to execute - User clicks Cancel on the card
  appState.pendingTaskConfirmation = turnResult.confirmation;
  await cancelPendingTaskAction();

  // Then: Expected result - Order and Task remain draft/in_progress, audit_logs records rejected
  const getRes = await invoke('get_purchase_order', { order_id: order.id });
  const po = getRes.order || getRes;
  assert.equal(po.status, 'draft', 'Order status must remain draft');

  const logs = await invoke('get_audit_logs');
  const cancelAudit = (logs || []).find(l => (l.action_type || l.action) === 'cancel_purchase_order' && l.decision === 'rejected');
  assert.ok(cancelAudit, 'Audit log must record rejected decision upon human cancellation');
});

test('TC-WF-PO-E-01 & E-02: Unknown vendor / product defense with manual form link', async () => {
  // Given: Preconditions - Catalog without TSMC or rocket engines
  const task = await createTaskAction('防呆測試任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  const catalog = { vendors: [], products: [] };

  // When: Tool handler receives unknown vendor
  await assert.rejects(
    async () => {
      await createPurchaseOrderToolHandler.prepareConfirmation(
        { vendor_partner_id: 'unknown_vendor_tsmc', items: [{ unit_id: 'u_1', quantity: 1 }] },
        { catalog }
      );
    },
    (err) => {
      // Then: Message explains unknown vendor and points to manual form
      assert.ok(err.message.includes('查無供應商'));
      assert.ok(err.message.includes('/app/purchase-orders'));
      return true;
    }
  );

  // When: Tool handler receives unknown product unit
  const validVendor = await createTestVendor('大同測試');
  await assert.rejects(
    async () => {
      await createPurchaseOrderToolHandler.prepareConfirmation(
        { vendor_partner_id: validVendor.id, items: [{ unit_id: 'unknown_unit_rocket', quantity: 5 }] },
        { catalog: { vendors: [{ partner_id: validVendor.id, name: validVendor.name }], products: [] } }
      );
    },
    (err) => {
      // Then: Message explains unknown unit and points to manual form
      assert.ok(err.message.includes('查無商品單位'));
      assert.ok(err.message.includes('/app/purchase-orders'));
      return true;
    }
  );
});

test('TC-WF-PO-E-03: Ambiguity clarification without blind guesses', async () => {
  // Given: Preconditions - User asks for an ambiguous vendor, model returns text clarification
  const mockAmbiguityDetector = async () => ({
    tool_call: null,
    content: '系統中存在兩家相似供應商：「大同股份有限公司」與「大同世界科技股份有限公司」，請問您指的是哪一家？'
  });

  const task = await createTaskAction('歧義測試任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');

  // When: Operation to execute - User sends ambiguous prompt
  const turnResult = await runAgentTurn(
    '跟大同買 5 台螢幕',
    purchaseOrderAgentProfile,
    { taskId: task.id, activeTask: task },
    { llmDetector: mockAmbiguityDetector }
  );

  // Then: Returns text guidance without triggering tool call
  assert.equal(turnResult.type, 'text');
  assert.ok(turnResult.content.includes('大同世界科技'));
  assert.ok(!turnResult.confirmation, 'No confirmation card should be produced for ambiguous intent');
});

test('TC-WF-PO-E-04: Attempting to submit or confirm receipt before creating purchase order', async () => {
  // Given: Preconditions - New task with no purchase order created yet
  const emptyTask = await createTaskAction('空任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  const context = { taskId: emptyTask.id, activeTask: emptyTask };

  // When & Then: submit_purchase_order fails with clear guidance
  await assert.rejects(
    async () => {
      await submitPurchaseOrderToolHandler.prepareConfirmation({}, context);
    },
    (err) => {
      assert.ok(err.message.includes('尚未建立採購單草稿'));
      assert.ok(err.message.includes('/app/purchase-orders'));
      return true;
    }
  );

  // When & Then: confirm_purchase_order_received fails with clear guidance
  await assert.rejects(
    async () => {
      await confirmPurchaseOrderReceivedToolHandler.prepareConfirmation({}, context);
    },
    (err) => {
      assert.ok(err.message.includes('尚未建立或找到採購單'));
      return true;
    }
  );
});

test('TC-WF-PO-E-05: Terminal state mutation defense (received PO cannot be cancelled)', async () => {
  // Given: Preconditions - A purchase order already received
  const vendor = await createTestVendor('終態廠商');
  const prod = await createTestProductWithUnit('完成品', '件', 100);

  const task = await createTaskAction('終態測試', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  const orderDetail = await invoke('create_purchase_order', {
    vendor_partner_id: vendor.id,
    currency: 'TWD',
    task_id: task.id,
    initial_lines: [{ unit_id: prod.unit.id, quantity: 1, purchase_cost: 100 }]
  });
  const order = orderDetail.order || orderDetail;
  await invoke('submit_purchase_order', { order_id: order.id });
  await invoke('confirm_purchase_order_received', { order_id: order.id });

  const context = { taskId: task.id, activeTask: task };

  // When & Then: Attempting to cancel received PO is rejected
  await assert.rejects(
    async () => {
      await cancelPurchaseOrderToolHandler.prepareConfirmation({}, context);
    },
    (err) => {
      assert.ok(err.message.includes('已經確認到貨入庫，無法取消'));
      return true;
    }
  );
});

test('TC-WF-PO-B-01: Line item quantity <= 0 validation boundary', async () => {
  // Given: Preconditions - Valid vendor, product unit
  const vendor = await createTestVendor('邊界廠商');
  const prod = await createTestProductWithUnit('零數量商品', '件', 100);
  const catalog = {
    vendors: [{ partner_id: vendor.id, name: vendor.name }],
    products: [{ product_id: prod.product.id, name: prod.product.name, units: [{ unit_id: prod.unit.id, default_cost: 100 }] }]
  };

  // When: Quantity is 0
  await assert.rejects(
    async () => {
      await createPurchaseOrderToolHandler.prepareConfirmation(
        { vendor_partner_id: vendor.id, items: [{ unit_id: prod.unit.id, quantity: 0 }] },
        { catalog }
      );
    },
    /採購數量必須大於 0/
  );

  // When: Quantity is negative (-5)
  await assert.rejects(
    async () => {
      await createPurchaseOrderToolHandler.prepareConfirmation(
        { vendor_partner_id: vendor.id, items: [{ unit_id: prod.unit.id, quantity: -5 }] },
        { catalog }
      );
    },
    /採購數量必須大於 0/
  );
});

test('TC-WF-PO-B-02: Irrelevant chit-chat returns fallback guidance without tools', async () => {
  // Given: Preconditions - Active purchase order task
  const task = await createTaskAction('閒聊測試任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');

  // When: User says completely irrelevant phrase with offline detector
  const turnResult = await runAgentTurn(
    '今天天氣真好，吃飽了沒？',
    purchaseOrderAgentProfile,
    { taskId: task.id, activeTask: task },
    { llmDetector: async () => ({ tool_call: null, content: null }) }
  );

  // Then: Returns default fallback message, no confirmation produced
  assert.equal(turnResult.type, 'text');
  assert.ok(turnResult.content.includes('採購單助理'));
  assert.equal(turnResult.confirmation, undefined);
});

test('TC-WF-PO-AUD-01: Full audit logging verification for approved workflow actions', async () => {
  // Given: Preconditions - Fresh purchase order lifecycle
  const vendor = await createTestVendor('稽核全流程廠商');
  const prod = await createTestProductWithUnit('稽核品項', '個', 1000);

  const task = await createTaskAction('稽核驗證任務', 'vendor', '主管', null, 'vendor.manage_purchase_order');
  await switchActiveTask(task.id);

  const testCatalog = {
    vendors: [{ partner_id: vendor.id, name: vendor.name }],
    products: [{ product_id: prod.product.id, name: prod.product.name, units: [{ unit_id: prod.unit.id, name: '個', default_cost: 1000 }] }]
  };

  const context = { taskId: task.id, activeTask: task, catalog: testCatalog };

  // Step 1: Create
  const createTurn = await runAgentTurn(
    '跟廠商買 2 個',
    purchaseOrderAgentProfile,
    context,
    {
      llmDetector: async () => ({
        tool_call: {
          tool: 'create_purchase_order',
          vendor_partner_id: vendor.id,
          items: [{ unit_id: prod.unit.id, quantity: 2, unit_price: 1000 }]
        }
      })
    }
  );
  appState.pendingTaskConfirmation = createTurn.confirmation;
  await confirmPendingTaskAction();

  // Step 2: Submit
  const submitTurn = await runAgentTurn('可以下單了', purchaseOrderAgentProfile, context);
  appState.pendingTaskConfirmation = submitTurn.confirmation;
  await confirmPendingTaskAction();

  // Step 3: Receive
  const receiveTurn = await runAgentTurn('貨到了', purchaseOrderAgentProfile, context);
  appState.pendingTaskConfirmation = receiveTurn.confirmation;
  await confirmPendingTaskAction();

  // Then: Audit logs must contain approved records for all 3 steps
  const logs = await invoke('get_audit_logs');
  const actions = (logs || []).filter(l => l.decision === 'approved').map(l => l.action_type || l.action);

  assert.ok(actions.includes('create_purchase_order'), 'create_purchase_order must be in audit logs');
  assert.ok(actions.includes('submit_purchase_order'), 'submit_purchase_order must be in audit logs');
  assert.ok(actions.includes('confirm_purchase_order_received'), 'confirm_purchase_order_received must be in audit logs');
});
