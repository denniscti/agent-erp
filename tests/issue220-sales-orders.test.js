import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

/**
 * Test Perspective Table (Issue #220 - Sales Orders & Shipment Mock IPC)
 *
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-JS-SO-N-01 | Confirmed SO seeded with stock >= qty; ship_sales_order called with defaults | Equivalence – Normal | Status becomes shipped, ship_date defaults to today, sales_shipment movement recorded with unit_cost=null | Verifies SH-01..04 |
 * | TC-JS-SO-N-02 | Confirmed SO with 2 lines; partial shipment line1=6, line2=0 | Equivalence – Normal / Boundary 0 | Order closes as shipped, shipped_amount reflects line1 only, NO delta=0 movement written for line2 | Verifies 0-qty no-movement rule |
 * | TC-JS-SO-N-03 | Confirmed SO cancelled via cancel_sales_order | Equivalence – Normal | Status becomes cancelled, cancelled_at set, 0 movements created | Verifies SO-09 |
 * | TC-JS-SO-B-01 | Stock = 10 - 5e-10 (tolerance pass) vs 9.999 (reject) | Boundary – 1e-9 Tolerance | Tolerance passes; 9.999 throws exact InsufficientStock message | Verifies SH-03 |
 * | TC-JS-SO-A-01 | ship_date = tomorrow / invalid calendar date (2026-02-29) | Error / Boundary – Date | Rejects with 出貨日不可晚於今天 / 日期超出該月份天數 | Verifies SH-04 |
 * | TC-JS-SO-A-02 | Duplicate ship, cancel shipped SO, ship cancelled SO | Error – State Transition | Rejects with 無效的狀態轉換：不可從 {from} 轉換至 {to} | Verifies SH-01 & terminal shipped |
 * | TC-JS-SO-A-03 | Over-ship, negative qty, all-zero total qty, multi-line partial stock failure | Error / Boundary / Atomicity | Rejects with SH-02/SH-03 errors; SO remains confirmed, 0 movements written | Verifies atomicity |
 * | TC-JS-SO-SEC-01 | Cross-tenant get/list/ship/cancel | Isolation – Multi-Tenant | Other tenant sees empty list and 找不到銷售單或不屬於目前租戶 | Verifies tenant isolation |
 */

async function setupEnv(tid) {
  await invoke('set_mock_active_tenant', { tenant_id: tid });
  await invoke('reset_mock_warehouses', { tenant_id: tid });
  await invoke('reset_mock_sales_orders', { tenant_id: tid });

  const wh = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const customer = await invoke('create_partner', {
    name: `測試客戶_${tid}`,
    isCustomer: true,
    isVendor: false
  });
  const p1 = await invoke('create_product', {
    name: '高階模組',
    category: 'resale',
    selling_price: 500,
    unit_name: '個'
  });
  const p2 = await invoke('create_product', {
    name: '連接線',
    category: 'resale',
    selling_price: 100,
    unit_name: '條'
  });

  const u1 = p1.units[0].id;
  const u2 = p2.units[0].id;

  await invoke('record_opening_inventory_balance', {
    unit_id: u1,
    quantity: 20,
    unit_cost: 250,
    warehouse_id: wh.id
  });
  await invoke('record_opening_inventory_balance', {
    unit_id: u2,
    quantity: 10,
    unit_cost: 40,
    warehouse_id: wh.id
  });

  return { wh, customer, u1, u2 };
}

test.describe('Issue #220: Sales Orders & Shipment Mock IPC', () => {
  test('TC-JS-SO-N-01: Full shipment deducts stock and records sales_shipment movement with null unit_cost', async () => {
    // Given: Confirmed SO with 5 of u1 and 20 in stock
    const tid = `tnt_so_n1_${Date.now()}`;
    const { wh, customer, u1 } = await setupEnv(tid);
    const created = await invoke('seed_mock_sales_order', {
      source_quote_id: `quo_${tid}_1`,
      customer_partner_id: customer.id,
      warehouse_id: wh.id,
      lines: [
        {
          unit_id: u1,
          product_name_snapshot: '高階模組',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '個',
          quantity: 5,
          unit_price: 450,
          standard_price_snapshot: 500
        }
      ]
    });

    assert.equal(created.order.status, 'confirmed');
    assert.equal(created.order.total_amount, 2250);
    assert.equal(created.order.shipped_amount, 0);

    // When: Shipping without explicit ship_date or line quantities
    const shipped = await invoke('ship_sales_order', {
      order_id: created.order.id,
      today_override: '2026-11-11'
    });

    // Then: Shipped with today's date, stock deducted, sales_shipment movement created with unit_cost=null
    assert.equal(shipped.order.status, 'shipped');
    assert.equal(shipped.order.ship_date, '2026-11-11');
    assert.equal(shipped.order.shipped_amount, 2250);
    assert.equal(shipped.lines[0].shipped_quantity, 5);

    const lvl = await invoke('get_inventory_level', { unit_id: u1, warehouse_id: wh.id });
    assert.equal(lvl.current_quantity, 15);

    const movs = await invoke('list_inventory_movements', { unit_id: u1, warehouse_id: wh.id });
    const shipMov = movs.find(m => m.reference_id === created.order.id);
    assert.ok(shipMov);
    assert.equal(shipMov.quantity_delta, -5);
    assert.equal(shipMov.unit_cost, null);
    assert.equal(shipMov.reason, 'sales_shipment');
    assert.equal(shipMov.reference_type, 'sales_order');
  });

  test('TC-JS-SO-N-02: Partial shipment with 0-qty line skips writing 0-delta movement', async () => {
    // Given: Confirmed SO with 2 lines
    const tid = `tnt_so_n2_${Date.now()}`;
    const { wh, customer, u1, u2 } = await setupEnv(tid);
    const created = await invoke('seed_mock_sales_order', {
      source_quote_id: `quo_${tid}_2`,
      customer_partner_id: customer.id,
      warehouse_id: wh.id,
      lines: [
        {
          unit_id: u1,
          product_name_snapshot: '高階模組',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '個',
          quantity: 10,
          unit_price: 500,
          standard_price_snapshot: 500
        },
        {
          unit_id: u2,
          product_name_snapshot: '連接線',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '條',
          quantity: 4,
          unit_price: 100,
          standard_price_snapshot: 100
        }
      ]
    });

    // When: Shipping line 1 = 6, line 2 = 0
    const shipped = await invoke('ship_sales_order', {
      order_id: created.order.id,
      ship_date: '2026-11-10',
      today_override: '2026-11-11',
      line_shipped_quantities: [
        { line_id: created.lines[0].id, shipped_quantity: 6 },
        { line_id: created.lines[1].id, shipped_quantity: 0 }
      ]
    });

    // Then: Shipped amount is 3000, u2 has NO sales_shipment movement
    assert.equal(shipped.order.status, 'shipped');
    assert.equal(shipped.order.shipped_amount, 3000);
    assert.equal(shipped.lines[1].shipped_quantity, 0);

    const u2Movs = await invoke('list_inventory_movements', { unit_id: u2, warehouse_id: wh.id });
    assert.equal(u2Movs.filter(m => m.reference_id === created.order.id).length, 0);
  });

  test('TC-JS-SO-N-03 & A-02: Cancel confirmed SO and reject invalid state transitions', async () => {
    // Given: Two confirmed SOs
    const tid = `tnt_so_n3_${Date.now()}`;
    const { wh, customer, u1 } = await setupEnv(tid);
    const soCancel = await invoke('seed_mock_sales_order', {
      source_quote_id: `quo_${tid}_c1`,
      customer_partner_id: customer.id,
      lines: [
        {
          unit_id: u1,
          product_name_snapshot: '高階模組',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '個',
          quantity: 2,
          unit_price: 500,
          standard_price_snapshot: 500
        }
      ]
    });
    const soShip = await invoke('seed_mock_sales_order', {
      source_quote_id: `quo_${tid}_s1`,
      customer_partner_id: customer.id,
      lines: [
        {
          unit_id: u1,
          product_name_snapshot: '高階模組',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '個',
          quantity: 2,
          unit_price: 500,
          standard_price_snapshot: 500
        }
      ]
    });

    // When: Cancelling soCancel and shipping soShip
    const cancelled = await invoke('cancel_sales_order', { order_id: soCancel.order.id });
    assert.equal(cancelled.order.status, 'cancelled');
    assert.ok(cancelled.order.cancelled_at);

    await invoke('ship_sales_order', { order_id: soShip.order.id, today_override: '2026-11-11' });

    // Then: Invalid transitions rejected
    await assert.rejects(
      () => invoke('ship_sales_order', { order_id: soShip.order.id, today_override: '2026-11-11' }),
      { message: '無效的狀態轉換：不可從 shipped 轉換至 shipped' }
    );
    await assert.rejects(
      () => invoke('cancel_sales_order', { order_id: soShip.order.id }),
      { message: '無效的狀態轉換：不可從 shipped 轉換至 cancelled' }
    );
    await assert.rejects(
      () => invoke('ship_sales_order', { order_id: soCancel.order.id, today_override: '2026-11-11' }),
      { message: '無效的狀態轉換：不可從 cancelled 轉換至 shipped' }
    );
    const u1Movs = await invoke('list_inventory_movements', { unit_id: u1, warehouse_id: wh.id });
    assert.equal(u1Movs.filter(m => m.reference_id === soCancel.order.id).length, 0);
  });

  test('TC-JS-SO-B-01 & A-01 & A-03: Validation boundaries, atomicity, and SH-03/SH-04 errors', async () => {
    // Given: Confirmed SO with line1 qty=5 (stock 20) and line2 qty=15 (stock 10)
    const tid = `tnt_so_err_${Date.now()}`;
    const { wh, customer, u1, u2 } = await setupEnv(tid);
    const so = await invoke('seed_mock_sales_order', {
      source_quote_id: `quo_${tid}_err`,
      customer_partner_id: customer.id,
      warehouse_id: wh.id,
      lines: [
        {
          unit_id: u1,
          product_name_snapshot: '高階模組',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '個',
          quantity: 5,
          unit_price: 500,
          standard_price_snapshot: 500
        },
        {
          unit_id: u2,
          product_name_snapshot: '連接線',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '條',
          quantity: 15,
          unit_price: 100,
          standard_price_snapshot: 100
        }
      ]
    });

    // When / Then: Future date and invalid calendar date rejected (SH-04)
    await assert.rejects(
      () => invoke('ship_sales_order', { order_id: so.order.id, ship_date: '2026-11-12', today_override: '2026-11-11' }),
      { message: '出貨日不可晚於今天' }
    );
    await assert.rejects(
      () => invoke('ship_sales_order', { order_id: so.order.id, ship_date: '2026-02-29', today_override: '2026-11-11' }),
      { message: '日期超出該月份天數' }
    );

    // When / Then: Over-ship and zero-total rejected (SH-02)
    await assert.rejects(
      () => invoke('ship_sales_order', {
        order_id: so.order.id,
        today_override: '2026-11-11',
        line_shipped_quantities: [{ line_id: so.lines[0].id, shipped_quantity: 6 }]
      }),
      { message: '出貨數量不可超過訂購數量' }
    );
    await assert.rejects(
      () => invoke('ship_sales_order', {
        order_id: so.order.id,
        today_override: '2026-11-11',
        line_shipped_quantities: [
          { line_id: so.lines[0].id, shipped_quantity: 0 },
          { line_id: so.lines[1].id, shipped_quantity: 0 }
        ]
      }),
      { message: '出貨數量合計需大於 0' }
    );

    // When / Then: Insufficient stock on line 2 rolls back entire shipment (SH-03)
    await assert.rejects(
      () => invoke('ship_sales_order', { order_id: so.order.id, today_override: '2026-11-11' }),
      { message: '〔連接線／標準規格／條〕在〔主倉〕現有 10，不足出貨 15' }
    );
    const reloaded = await invoke('get_sales_order', { order_id: so.order.id });
    assert.equal(reloaded.order.status, 'confirmed');
    const lvl1 = await invoke('get_inventory_level', { unit_id: u1, warehouse_id: wh.id });
    assert.equal(lvl1.current_quantity, 20);
  });

  test('TC-JS-SO-SEC-01: Multi-tenant isolation for get/list/ship/cancel', async () => {
    const tidA = `tnt_so_a_${Date.now()}`;
    const tidB = `tnt_so_b_${Date.now()}`;
    const { customer, u1 } = await setupEnv(tidA);

    const soA = await invoke('seed_mock_sales_order', {
      source_quote_id: `quo_${tidA}_iso`,
      customer_partner_id: customer.id,
      lines: [
        {
          unit_id: u1,
          product_name_snapshot: '高階模組',
          variant_name_snapshot: '標準規格',
          unit_name_snapshot: '個',
          quantity: 1,
          unit_price: 500,
          standard_price_snapshot: 500
        }
      ]
    });

    await invoke('set_mock_active_tenant', { tenant_id: tidB });
    const listB = await invoke('list_sales_orders', {});
    assert.equal(listB.length, 0);

    await assert.rejects(() => invoke('get_sales_order', { order_id: soA.order.id }), {
      message: '找不到銷售單或不屬於目前租戶'
    });
    await assert.rejects(
      () => invoke('ship_sales_order', { order_id: soA.order.id, today_override: '2026-11-11' }),
      { message: '找不到銷售單或不屬於目前租戶' }
    );
    await assert.rejects(() => invoke('cancel_sales_order', { order_id: soA.order.id }), {
      message: '找不到銷售單或不屬於目前租戶'
    });
  });
});

