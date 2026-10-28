/**
 * @file purchase-order-inventory.test.js
 * @description Layer 2 test suite for Purchase Orders & Inventory Ledger (Issue #164).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { invoke } = await import('../src/lib/tauri.js');

test('TC-PO-N-01: Create draft purchase order with sequential PO number and zero total amount', async () => {
  // Given: Authenticated tenant and a vendor
  const vendorName = `欣興供應商_${Date.now()}`;
  const vendor = await invoke('create_partner', {
    name: vendorName,
    is_vendor: true,
    is_customer: false,
    tax_id: '12345678'
  });

  // When: Creating a new purchase order
  const detail1 = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    currency: 'TWD',
    expectedDate: 1750000000,
    note: '首次測試備註',
    taskId: 'task_mock_1'
  });

  // Then: Draft purchase order created with sequential PO number and snapshots
  assert.ok(detail1.order.id, 'PO ID should be generated');
  assert.equal(detail1.order.status, 'draft');
  assert.equal(detail1.order.vendor_name_snapshot, vendorName);
  assert.equal(detail1.order.currency, 'TWD');
  assert.equal(detail1.order.total_amount, 0);
  assert.equal(detail1.order.task_id, 'task_mock_1');
  assert.equal(detail1.lines.length, 0);

  // When: Creating a second purchase order in the same tenant
  const detail2 = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id
  });

  // Then: PO number increments sequentially
  assert.ok(detail2.order.po_number > detail1.order.po_number, 'Sequential PO numbers');
});

test('TC-PO-N-02 & N-03: Add lines, verify supply source auto-lookup and master data snapshot isolation', async () => {
  // Given: A resale product and vendor with supply source
  const vendor = await invoke('create_partner', {
    name: `日月光供應商_${Date.now()}`,
    is_vendor: true
  });

  const prod = await invoke('create_product', {
    name: `測試晶片_${Date.now()}`,
    category: '轉售商品',
    sku: 'CHIP-MOCK-01',
    unit_name: '顆',
    selling_price: 150
  });
  const unitId = prod.units[0].id;

  // Link supply source at cost 88.5 TWD
  const src = await invoke('add_supply_source', {
    unit_id: unitId,
    vendor_partner_id: vendor.id,
    purchase_cost: 88.5,
    currency: 'TWD',
    is_primary: true
  });

  const orderDetail = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id
  });

  // When: Adding line without specifying purchase_cost (auto-prefill)
  const updated = await invoke('add_purchase_order_line', {
    orderId: orderDetail.order.id,
    unitId: unitId,
    quantity: 20
  });

  // Then: Cost prefilled from supply source, supply_source_id recorded, subtotal calculated
  assert.equal(updated.lines.length, 1);
  const line = updated.lines[0];
  assert.equal(line.purchase_cost, 88.5);
  assert.equal(line.supply_source_id, src.id);
  assert.equal(line.quantity, 20);
  assert.equal(line.subtotal, 1770);
  assert.equal(updated.order.total_amount, 1770);
  assert.equal(line.product_name_snapshot, prod.product.name);
  assert.equal(line.unit_name_snapshot, '顆');
});

test('TC-PO-N-04, N-05 & N-06: Order submission, receipt confirmation with differing quantities and inventory update', async () => {
  // Given: Draft order with two lines
  const vendor = await invoke('create_partner', {
    name: `超微半導體_${Date.now()}`,
    is_vendor: true
  });

  const prod1 = await invoke('create_product', {
    name: `品項A_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 50
  });
  const prod2 = await invoke('create_product', {
    name: `品項B_${Date.now()}`,
    category: '轉售商品',
    unit_name: '組',
    selling_price: 100
  });

  const u1 = prod1.units[0].id;
  const u2 = prod2.units[0].id;

  const orderDetail = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [
      { unit_id: u1, quantity: 50, purchase_cost: 30 },
      { unit_id: u2, quantity: 10, purchase_cost: 70 }
    ]
  });

  // When: Submitting order (draft -> ordered)
  const submitted = await invoke('submit_purchase_order', {
    orderId: orderDetail.order.id
  });

  // Then: Order is in 'ordered' state, ordered_at is set
  assert.equal(submitted.order.status, 'ordered');
  assert.ok(submitted.order.ordered_at > 0);

  // When: Confirming receipt where line 1 received 45 (under-delivery) and line 2 defaults to 10
  const line1Id = submitted.lines[0].id;
  const received = await invoke('confirm_purchase_order_received', {
    orderId: submitted.order.id,
    lineReceivedQuantities: [
      { line_id: line1Id, received_quantity: 45 }
    ]
  });

  // Then: Order is 'received', lines record received_quantity
  assert.equal(received.order.status, 'received');
  assert.ok(received.order.received_at > 0);
  assert.equal(received.lines[0].received_quantity, 45);
  assert.equal(received.lines[1].received_quantity, 10);

  // Then: Inventory levels reflect the received quantities
  const inv1 = await invoke('get_inventory_level', { unitId: u1 });
  assert.equal(inv1.current_quantity, 45);

  const inv2 = await invoke('get_inventory_level', { unitId: u2 });
  assert.equal(inv2.current_quantity, 10);
});

test('TC-PO-N-07: Cancel purchase order in draft and ordered states', async () => {
  const vendor = await invoke('create_partner', {
    name: `取消測試供應商_${Date.now()}`,
    is_vendor: true
  });

  const prod = await invoke('create_product', {
    name: `取消測試品項_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 100
  });
  const unitId = prod.units[0].id;

  // --- Scenario 1: Cancel draft order ---
  // Given: Draft order
  const draftOrder = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id
  });

  // When: Cancelling draft order
  const cancelledDraft = await invoke('cancel_purchase_order', {
    orderId: draftOrder.order.id
  });

  // Then: Order status is cancelled
  assert.equal(cancelledDraft.order.status, 'cancelled');
  assert.ok(cancelledDraft.order.cancelled_at > 0);

  // --- Scenario 2: Cancel ordered order ---
  // Given: Purchase order submitted to 'ordered' status
  const draftOrder2 = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [
      { unit_id: unitId, quantity: 15, purchase_cost: 60 }
    ]
  });
  const ordered = await invoke('submit_purchase_order', {
    orderId: draftOrder2.order.id
  });
  assert.equal(ordered.order.status, 'ordered');

  // When: Cancelling ordered order
  const cancelledOrdered = await invoke('cancel_purchase_order', {
    orderId: ordered.order.id
  });

  // Then: Order status is cancelled
  assert.equal(cancelledOrdered.order.status, 'cancelled');
  assert.ok(cancelledOrdered.order.cancelled_at > 0);
});

test('TC-PO-N-08 & E-11: Opening inventory balance and duplicate prevention', async () => {
  // Given: A raw material product
  const prod = await invoke('create_product', {
    name: `期初物料_${Date.now()}`,
    category: '原物料',
    unit_name: '公斤'
  });
  const unitId = prod.units[0].id;

  // When: Recording opening balance
  const movement = await invoke('record_opening_inventory_balance', {
    unitId: unitId,
    quantityDelta: 200,
    unitCost: 15.5
  });

  // Then: Opening balance movement recorded and inventory level updated
  assert.equal(movement.quantity_delta, 200);
  assert.equal(movement.unit_cost, 15.5);
  assert.equal(movement.reason, 'opening_balance');

  const level = await invoke('get_inventory_level', { unitId: unitId });
  assert.equal(level.current_quantity, 200);

  // When: Calling opening balance again for the same unit (TC-PO-E-11)
  await assert.rejects(
    async () => {
      await invoke('record_opening_inventory_balance', {
        unitId: unitId,
        quantityDelta: 50,
        unitCost: 15.5
      });
    },
    /(?:期初已開帳|此商品單位在〔.*〕已開帳，數量更正請用庫存調整（原因：期初更正）)/
  );
});

test('TC-PO-B & E: Boundary and validation errors', async () => {
  const vendor = await invoke('create_partner', {
    name: `邊界供應商_${Date.now()}`,
    is_vendor: true
  });
  const customer = await invoke('create_partner', {
    name: `非供應商客戶_${Date.now()}`,
    is_customer: true,
    is_vendor: false
  });

  const resaleProd = await invoke('create_product', {
    name: `轉售品項_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 100
  });
  const mfgProd = await invoke('create_product', {
    name: `自製不可採購品項_${Date.now()}`,
    category: '自製成品',
    unit_name: '組',
    selling_price: 500
  });

  const validUnitId = resaleProd.units[0].id;
  const mfgUnitId = mfgProd.units[0].id;

  // TC-PO-E-01: Non-TWD currency rejected (R-18)
  await assert.rejects(
    async () => {
      await invoke('create_purchase_order', {
        vendorPartnerId: vendor.id,
        currency: 'USD'
      });
    },
    /幣別僅支援 'TWD'/
  );

  // TC-PO-E-02: Non-vendor partner rejected (R-02)
  await assert.rejects(
    async () => {
      await invoke('create_purchase_order', {
        vendorPartnerId: customer.id
      });
    },
    /不是供應商/
  );

  const order = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id
  });

  // TC-PO-B-01: Quantity <= 0 rejected (R-05)
  await assert.rejects(
    async () => {
      await invoke('add_purchase_order_line', {
        orderId: order.order.id,
        unitId: validUnitId,
        quantity: 0,
        purchaseCost: 10
      });
    },
    /採購數量必須大於 0/
  );

  // TC-PO-B-03: Negative purchase cost rejected (R-06)
  await assert.rejects(
    async () => {
      await invoke('add_purchase_order_line', {
        orderId: order.order.id,
        unitId: validUnitId,
        quantity: 1,
        purchaseCost: -10
      });
    },
    /採購單價不可為負數/
  );

  // TC-PO-E-04: Non-purchasable product rejected (R-04)
  await assert.rejects(
    async () => {
      await invoke('add_purchase_order_line', {
        orderId: order.order.id,
        unitId: mfgUnitId,
        quantity: 1,
        purchaseCost: 10
      });
    },
    /設定為不可採購/
  );

  // TC-PO-E-03: Invalid unit_id rejected (R-03)
  await assert.rejects(
    async () => {
      await invoke('add_purchase_order_line', {
        orderId: order.order.id,
        unitId: 'non_existent_unit',
        quantity: 1,
        purchaseCost: 10
      });
    },
    /找不到指定的商品單位/
  );

  // Add a valid line
  await invoke('add_purchase_order_line', {
    orderId: order.order.id,
    unitId: validUnitId,
    quantity: 5,
    purchaseCost: 20
  });

  // TC-PO-E-05: Duplicate unit_id in same purchase order rejected (R-09)
  await assert.rejects(
    async () => {
      await invoke('add_purchase_order_line', {
        orderId: order.order.id,
        unitId: validUnitId,
        quantity: 2,
        purchaseCost: 20
      });
    },
    /同一採購單內商品單位不可重複/
  );

  // TC-PO-E-06: Changing vendor when lines exist is rejected (R-10)
  const vendor2 = await invoke('create_partner', {
    name: `次要供應商_${Date.now()}`,
    is_vendor: true
  });
  await assert.rejects(
    async () => {
      await invoke('update_purchase_order_header', {
        orderId: order.order.id,
        vendorPartnerId: vendor2.id
      });
    },
    /採購單已有明細，不可修改供應商/
  );
});

test('TC-PO-E-09 & E-10: Empty order submit and illegal state transitions', async () => {
  const vendor = await invoke('create_partner', {
    name: `狀態轉移供應商_${Date.now()}`,
    is_vendor: true
  });

  const emptyOrder = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id
  });

  // TC-PO-E-09: Empty order submit rejected
  // Given: Empty purchase order without lines
  // When: Submitting empty draft order
  // Then: Rejected with validation error
  await assert.rejects(
    async () => {
      await invoke('submit_purchase_order', {
        orderId: emptyOrder.order.id
      });
    },
    /採購單至少需有 1 筆明細方可下單/
  );

  // TC-PO-E-10: Jump draft -> received directly rejected
  // Given: Draft order
  // When: Calling confirm_received directly
  // Then: Rejected with invalid state transition error
  await assert.rejects(
    async () => {
      await invoke('confirm_purchase_order_received', {
        orderId: emptyOrder.order.id
      });
    },
    /無效的狀態轉換/
  );

  // TC-PO-E-13: Jump received -> cancelled rejected (terminal state)
  // Given: An order that is received
  const prodR = await invoke('create_product', {
    name: `到貨終態品項_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 100
  });
  const unitIdR = prodR.units[0].id;
  const orderToReceive = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitIdR, quantity: 5, purchase_cost: 20 }]
  });
  await invoke('submit_purchase_order', { orderId: orderToReceive.order.id });
  const receivedOrder = await invoke('confirm_purchase_order_received', {
    orderId: orderToReceive.order.id
  });
  assert.equal(receivedOrder.order.status, 'received');

  // When: Attempting to cancel an already received order
  // Then: Rejected because 'received' is a terminal state
  await assert.rejects(
    async () => {
      await invoke('cancel_purchase_order', {
        orderId: receivedOrder.order.id
      });
    },
    /無效的狀態轉換：不可從 received 轉換至 cancelled/
  );
});

test('TC-PO-IDEM: Idempotency protection for submit, receive, and cancel commands', async () => {
  const vendor = await invoke('create_partner', {
    name: `冪等性供應商_${Date.now()}`,
    is_vendor: true
  });
  const prod = await invoke('create_product', {
    name: `冪等性測試商品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 100
  });
  const unitId = prod.units[0].id;

  // --- 1. submit_purchase_order idempotency ---
  // Given: Draft order with lines
  const orderForSubmit = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id,
    initialLines: [{ unit_id: unitId, quantity: 10, purchase_cost: 30 }]
  });
  // When: First submit
  const sub1 = await invoke('submit_purchase_order', { orderId: orderForSubmit.order.id });
  // Then: First submit succeeds, status is ordered
  assert.equal(sub1.order.status, 'ordered');
  // When: Second submit (retry simulation)
  // Then: Rejected with invalid state transition error
  await assert.rejects(
    async () => {
      await invoke('submit_purchase_order', { orderId: orderForSubmit.order.id });
    },
    /無效的狀態轉換|下單失敗/
  );

  // --- 2. confirm_purchase_order_received idempotency ---
  // When: First confirm receive
  const rec1 = await invoke('confirm_purchase_order_received', { orderId: orderForSubmit.order.id });
  // Then: First confirm succeeds, status is received
  assert.equal(rec1.order.status, 'received');
  const invLevel1 = await invoke('get_inventory_level', { unitId: unitId });
  assert.equal(invLevel1.current_quantity, 10);
  // When: Second confirm receive (retry simulation)
  // Then: Rejected with invalid state transition error, inventory does not double
  await assert.rejects(
    async () => {
      await invoke('confirm_purchase_order_received', { orderId: orderForSubmit.order.id });
    },
    /無效的狀態轉換|確認到貨失敗/
  );
  const invLevel2 = await invoke('get_inventory_level', { unitId: unitId });
  assert.equal(invLevel2.current_quantity, 10);

  // --- 3. cancel_purchase_order idempotency ---
  // Given: A new draft order
  const orderForCancel = await invoke('create_purchase_order', {
    vendorPartnerId: vendor.id
  });
  // When: First cancel
  const canc1 = await invoke('cancel_purchase_order', { orderId: orderForCancel.order.id });
  // Then: First cancel succeeds, status is cancelled
  assert.equal(canc1.order.status, 'cancelled');
  // When: Second cancel (retry simulation)
  // Then: Rejected with invalid state transition error
  await assert.rejects(
    async () => {
      await invoke('cancel_purchase_order', { orderId: orderForCancel.order.id });
    },
    /無效的狀態轉換|取消採購單失敗/
  );
});
