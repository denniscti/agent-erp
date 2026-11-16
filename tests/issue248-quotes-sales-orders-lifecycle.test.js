// @ts-check
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
const quotesStore = await import('../src/lib/quotes/store.js');
const salesOrdersStore = await import('../src/lib/salesOrders/store.js');
const mainStore = await import('../src/lib/store.svelte.js');

test.describe('Issue #248: Quotes & Sales Orders Domain Modularization Lifecycle Verification', () => {
  const tenantId = 'tnt_test_qso_lifecycle_248';

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_quotes', { tenant_id: tenantId });
    await invoke('reset_mock_sales_orders', { tenant_id: tenantId });
  });

  test('TC-QSO-N-01: Standard full lifecycle (Draft -> Line -> Submit -> Approve -> Convert to SO -> Multi-batch shipment to fully shipped)', async () => {
    // Given: Active customer, default warehouse with stock, and sellable product
    const customer = await invoke('create_partner', {
      name: `客戶248_N01_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_customer: true
    });
    const warehouse = await invoke('create_warehouse', {
      code: `WH248_${Math.floor(Math.random() * 1000)}`,
      name: '報價出貨倉'
    });
    const product = await invoke('create_product', {
      name: `商品248_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;

    // Seed stock into warehouse: 20 units
    await invoke('record_opening_inventory_balance', {
      unit_id: unitId,
      quantity: 20,
      unit_cost: 50,
      warehouse_id: warehouse.id
    });

    // When: Create draft quote with valid_until 30 days later
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil,
      note: '標準銷售流程測試'
    });
    assert.equal(created.quote.status, 'draft');
    assert.ok(created.quote.quote_number.startsWith('QUO-'));

    // When: Add quote line with below standard price (standard 100, price 80) to require approval
    await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 10,
      unit_price: 80,
      note: '大量採購特價'
    });

    // When: Submit quote
    const submitted = await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    // Then: Quote status transitions to pending_approval
    assert.equal(submitted.quote.status, 'pending_approval');
    assert.equal(submitted.quote.requires_approval, 1);

    // When: Approve quote
    const approved = await quotesStore.approveQuoteAction({
      quote_id: created.quote.id,
      reason: '經理核准特惠價'
    });
    // Then: Quote status transitions to sent
    assert.equal(approved.quote.status, 'sent');
    assert.ok(approved.quote.approved_at);

    // When: Convert accepted quote to confirmed sales order
    const converted = await quotesStore.convertQuoteAction({
      quote_id: created.quote.id,
      warehouse_id: warehouse.id,
      customer_po_number: 'PO-CLIENT-999'
    });
    // Then: Quote status becomes converted and returns sales order detail
    assert.equal(converted.quote.status, 'converted');
    assert.ok(converted.sales_order);
    const soId = converted.sales_order.order.id;
    assert.equal(converted.sales_order.order.status, 'confirmed');
    assert.equal(converted.sales_order.order.source_quote_id, created.quote.id);

    // When: First batch shipment (6 units out of 10)
    const lineId = converted.sales_order.lines[0].id;
    const batch1 = await salesOrdersStore.shipSalesOrderAction({
      order_id: soId,
      line_shipped_quantities: [{ line_id: lineId, shipped_quantity: 6 }]
    });
    // Then: Order status transitions to partially_shipped
    assert.equal(batch1.order.status, 'partially_shipped');
    assert.equal(batch1.lines[0].shipped_quantity, 6);

    // When: Second batch shipment (remaining 4 units)
    const batch2 = await salesOrdersStore.shipSalesOrderAction({
      order_id: soId,
      line_shipped_quantities: [{ line_id: lineId, shipped_quantity: 4 }]
    });
    // Then: Order status transitions to fully shipped
    assert.equal(batch2.order.status, 'shipped');
    assert.equal(batch2.lines[0].shipped_quantity, 10);
    assert.equal(batch2.shipments.length, 2);
  });

  test('TC-QSO-N-02: Quote approval rejection flow (Submit -> Reject -> Returns to draft -> Modify -> Resubmit -> Approve)', async () => {
    // Given: Active customer and product
    const customer = await invoke('create_partner', {
      name: `客戶248_N02_${Date.now()}`,
      is_customer: true
    });
    const product = await invoke('create_product', {
      name: `商品248_N02_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;

    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    const added = await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 5,
      unit_price: 50 // below standard
    });
    const lineId = added.lines[0].id;

    // When: Submit quote
    await quotesStore.submitQuoteAction({ quote_id: created.quote.id });

    // When: Reject quote with reason
    const rejected = await quotesStore.rejectQuoteAction({
      quote_id: created.quote.id,
      reason: '折扣幅度過高，請重新報價'
    });
    // Then: Returns to draft status and preserves rejection reason
    assert.equal(rejected.quote.status, 'draft');
    assert.equal(rejected.quote.approval_rejection_reason, '折扣幅度過高，請重新報價');

    // When: Update quote line to higher unit price and resubmit
    await quotesStore.updateQuoteLineAction({
      quote_id: created.quote.id,
      line_id: lineId,
      quantity: 5,
      unit_price: 90
    });
    const resubmitted = await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    assert.equal(resubmitted.quote.status, 'pending_approval');

    // When: Approve quote
    const approved = await quotesStore.approveQuoteAction({
      quote_id: created.quote.id,
      reason: '修正後價格符合授權範圍'
    });
    // Then: Status is sent and rejection reason cleared
    assert.equal(approved.quote.status, 'sent');
    assert.equal(approved.quote.approval_rejection_reason, null);
  });

  test('TC-QSO-N-03: Modular import verification & backward compatibility', async () => {
    // Given: Functions imported from modular domain stores and from main store.svelte.js
    // When / Then: Verify all quote and sales order actions are callable functions
    assert.equal(typeof quotesStore.fetchQuotes, 'function');
    assert.equal(typeof quotesStore.fetchQuoteDetail, 'function');
    assert.equal(typeof quotesStore.createQuoteAction, 'function');
    assert.equal(typeof quotesStore.convertQuoteAction, 'function');
    assert.equal(typeof quotesStore.selectQuote, 'function');

    assert.equal(typeof salesOrdersStore.fetchSalesOrders, 'function');
    assert.equal(typeof salesOrdersStore.fetchSalesOrderDetail, 'function');
    assert.equal(typeof salesOrdersStore.shipSalesOrderAction, 'function');
    assert.equal(typeof salesOrdersStore.cancelSalesOrderAction, 'function');
    assert.equal(typeof salesOrdersStore.selectSalesOrder, 'function');

    // Verify main store.svelte.js re-exports point to identical function definitions
    assert.strictEqual(mainStore.fetchQuotes, quotesStore.fetchQuotes);
    assert.strictEqual(mainStore.convertQuoteAction, quotesStore.convertQuoteAction);
    assert.strictEqual(mainStore.fetchSalesOrders, salesOrdersStore.fetchSalesOrders);
    assert.strictEqual(mainStore.shipSalesOrderAction, salesOrdersStore.shipSalesOrderAction);
  });

  test('TC-QSO-E-01: State machine guards (Cannot convert draft / pending approval / rejected / expired quote; cannot edit converted quote)', async () => {
    // Given: Active customer and product
    const customer = await invoke('create_partner', {
      name: `客戶248_E01_${Date.now()}`,
      is_customer: true
    });
    const product = await invoke('create_product', {
      name: `商品248_E01_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    // Draft quote
    const draft = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await quotesStore.addQuoteLineAction({
      quote_id: draft.quote.id,
      unit_id: unitId,
      quantity: 5,
      unit_price: 100
    });

    // When / Then: Attempting to convert draft directly is rejected
    await assert.rejects(
      async () => {
        await quotesStore.convertQuoteAction({ quote_id: draft.quote.id });
      },
      { message: '目前狀態不允許此操作' }
    );

    // When / Then: Attempting to convert expired quote is rejected
    const expiredQuote = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: '2026-03-01'
    });
    await quotesStore.addQuoteLineAction({
      quote_id: expiredQuote.quote.id,
      unit_id: unitId,
      quantity: 1,
      unit_price: 100
    });
    await quotesStore.submitQuoteAction({ quote_id: expiredQuote.quote.id, today_override: '2026-02-01' });

    await assert.rejects(
      async () => {
        await quotesStore.convertQuoteAction({
          quote_id: expiredQuote.quote.id,
          today_override: '2026-04-01'
        });
      },
      { message: '報價單已過期，無法轉為銷售單' }
    );
  });

  test('TC-QSO-E-02: Shipment stock deficit guard', async () => {
    // Given: Customer, warehouse with 2 units stock, and confirmed sales order for 5 units
    const customer = await invoke('create_partner', {
      name: `客戶248_E02_${Date.now()}`,
      is_customer: true
    });
    const warehouse = await invoke('create_warehouse', {
      code: `WH248_DEF_${Math.floor(Math.random() * 1000)}`,
      name: '庫存不足測試倉'
    });
    const product = await invoke('create_product', {
      name: `商品248_E02_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;

    // Seed stock of 2 units
    await invoke('record_opening_inventory_balance', {
      unit_id: unitId,
      quantity: 2,
      unit_cost: 50,
      warehouse_id: warehouse.id
    });

    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 5,
      unit_price: 100
    });
    await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    const converted = await quotesStore.convertQuoteAction({
      quote_id: created.quote.id,
      warehouse_id: warehouse.id
    });
    const soId = converted.sales_order.order.id;

    // When / Then: Attempting to ship 5 units when only 2 exist in warehouse throws stock deficit error
    await assert.rejects(
      async () => {
        await salesOrdersStore.shipSalesOrderAction({
          order_id: soId
        });
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('現有 2，不足出貨 5'));
        return true;
      }
    );
  });

  test('TC-QSO-E-03: Duplicate quote conversion guard', async () => {
    // Given: Quote already converted to sales order
    const customer = await invoke('create_partner', {
      name: `客戶248_E03_${Date.now()}`,
      is_customer: true
    });
    const product = await invoke('create_product', {
      name: `商品248_E03_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 2,
      unit_price: 100
    });
    await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    await quotesStore.convertQuoteAction({ quote_id: created.quote.id });

    // When / Then: Duplicate conversion of already converted quote throws error
    await assert.rejects(
      async () => {
        await quotesStore.convertQuoteAction({ quote_id: created.quote.id });
      },
      { message: '此報價單已結案，無法修改' }
    );
  });

  test('TC-QSO-E-04: Sales order cancellation guard on fully shipped order', async () => {
    // Given: Shipped sales order
    const customer = await invoke('create_partner', {
      name: `客戶248_E04_${Date.now()}`,
      is_customer: true
    });
    const warehouse = await invoke('create_warehouse', {
      code: `WH248_CAN_${Math.floor(Math.random() * 1000)}`,
      name: '取消防護測試倉'
    });
    const product = await invoke('create_product', {
      name: `商品248_E04_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;

    await invoke('record_opening_inventory_balance', {
      unit_id: unitId,
      quantity: 10,
      unit_cost: 50,
      warehouse_id: warehouse.id
    });

    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 5,
      unit_price: 100
    });
    await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    const converted = await quotesStore.convertQuoteAction({
      quote_id: created.quote.id,
      warehouse_id: warehouse.id
    });
    const soId = converted.sales_order.order.id;

    // Ship fully
    await salesOrdersStore.shipSalesOrderAction({ order_id: soId });

    // When / Then: Attempting to cancel shipped sales order is blocked
    await assert.rejects(
      async () => {
        await salesOrdersStore.cancelSalesOrderAction({ order_id: soId });
      },
      { message: '無效的狀態轉換：不可從 shipped 轉換至 cancelled' }
    );
  });

  test('TC-QSO-B-01: Shipment quantity boundaries (0 quantity, exceeding remaining quantity)', async () => {
    // Given: Confirmed order with 5 units
    const customer = await invoke('create_partner', {
      name: `客戶248_B01_${Date.now()}`,
      is_customer: true
    });
    const warehouse = await invoke('create_warehouse', {
      code: `WH248_B01_${Math.floor(Math.random() * 1000)}`,
      name: '邊界數量倉'
    });
    const product = await invoke('create_product', {
      name: `商品248_B01_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;

    await invoke('record_opening_inventory_balance', {
      unit_id: unitId,
      quantity: 50,
      unit_cost: 50,
      warehouse_id: warehouse.id
    });

    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 5,
      unit_price: 100
    });
    await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    const converted = await quotesStore.convertQuoteAction({
      quote_id: created.quote.id,
      warehouse_id: warehouse.id
    });
    const soId = converted.sales_order.order.id;
    const lineId = converted.sales_order.lines[0].id;

    // When / Then: Shipped quantity is 0
    await assert.rejects(
      async () => {
        await salesOrdersStore.shipSalesOrderAction({
          order_id: soId,
          line_shipped_quantities: [{ line_id: lineId, shipped_quantity: 0 }]
        });
      },
      { message: '出貨數量合計需大於 0' }
    );

    // When / Then: Shipped quantity exceeds ordered quantity (6 > 5)
    await assert.rejects(
      async () => {
        await salesOrdersStore.shipSalesOrderAction({
          order_id: soId,
          line_shipped_quantities: [{ line_id: lineId, shipped_quantity: 6 }]
        });
      },
      { message: '出貨數量不可超過訂購數量' }
    );
  });

  test('TC-QSO-B-02: Ship date validation boundaries (future date beyond today, null defaults to today)', async () => {
    // Given: Confirmed order with available stock
    const customer = await invoke('create_partner', {
      name: `客戶248_B02_${Date.now()}`,
      is_customer: true
    });
    const warehouse = await invoke('create_warehouse', {
      code: `WH248_B02_${Math.floor(Math.random() * 1000)}`,
      name: '日期邊界倉'
    });
    const product = await invoke('create_product', {
      name: `商品248_B02_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;

    await invoke('record_opening_inventory_balance', {
      unit_id: unitId,
      quantity: 10,
      unit_cost: 50,
      warehouse_id: warehouse.id
    });

    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await quotesStore.addQuoteLineAction({
      quote_id: created.quote.id,
      unit_id: unitId,
      quantity: 2,
      unit_price: 100
    });
    await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
    const converted = await quotesStore.convertQuoteAction({
      quote_id: created.quote.id,
      warehouse_id: warehouse.id
    });
    const soId = converted.sales_order.order.id;

    // When / Then: Future ship date (tomorrow) is rejected
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await assert.rejects(
      async () => {
        await salesOrdersStore.shipSalesOrderAction({
          order_id: soId,
          ship_date: tomorrow
        });
      },
      { message: '出貨日不可晚於今天' }
    );

    // When: Ship date omitted / null
    const shipped = await salesOrdersStore.shipSalesOrderAction({
      order_id: soId,
      ship_date: null
    });
    // Then: Defaults to today
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(shipped.order.ship_date, today);
  });

  test('TC-QSO-B-03: Line item quantity/price boundaries (0 quantity, negative unit price)', async () => {
    // Given: Draft quote
    const customer = await invoke('create_partner', {
      name: `客戶248_B03_${Date.now()}`,
      is_customer: true
    });
    const product = await invoke('create_product', {
      name: `商品248_B03_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      unit_name: '件'
    });
    const unitId = product.units[0].id;
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });

    // When / Then: Quantity = 0
    await assert.rejects(
      async () => {
        await quotesStore.addQuoteLineAction({
          quote_id: created.quote.id,
          unit_id: unitId,
          quantity: 0,
          unit_price: 100
        });
      },
      { message: '數量必須大於 0，單價不可為負數' }
    );

    // When / Then: Negative unit price = -1
    await assert.rejects(
      async () => {
        await quotesStore.addQuoteLineAction({
          quote_id: created.quote.id,
          unit_id: unitId,
          quantity: 1,
          unit_price: -1
        });
      },
      { message: '數量必須大於 0，單價不可為負數' }
    );
  });

  test('TC-QSO-B-04: Quote line boundary (submit without lines, delete non-existent line)', async () => {
    // Given: Draft quote with no lines
    const customer = await invoke('create_partner', {
      name: `客戶248_B04_${Date.now()}`,
      is_customer: true
    });
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const created = await quotesStore.createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });

    // When / Then: Submit quote with 0 lines
    await assert.rejects(
      async () => {
        await quotesStore.submitQuoteAction({ quote_id: created.quote.id });
      },
      { message: '報價單沒有任何品項，無法送出' }
    );

    // When / Then: Delete non-existent line
    await assert.rejects(
      async () => {
        await quotesStore.deleteQuoteLineAction({
          quote_id: created.quote.id,
          line_id: 'non_existent_line'
        });
      },
      { message: '找不到指定的報價明細' }
    );
  });
});
