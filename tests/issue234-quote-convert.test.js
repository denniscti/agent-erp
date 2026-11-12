import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  fetchWarehouses,
  createQuoteAction,
  addQuoteLineAction,
  submitQuoteAction,
  approveQuoteAction,
  declineQuoteAction,
  cancelQuoteAction,
  convertQuoteAction,
  fetchQuoteDetail,
  fetchSalesOrderDetail
} = await import('../src/lib/store.svelte.js');

/**
 * Test Perspective Table (Issue #234: Mark Quote Accepted & Convert to Sales Order)
 *
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-JS-234-N-01 | Sent quote with 2 lines; convertQuoteAction with explicit warehouse_id, customer_po_number, expected_ship_date | Equivalence – Normal | Creates confirmed SalesOrder, copies all 2 lines verbatim, sets quote status=converted + converted_sales_order_id + converted_at + accepted_by, writes 0 audit_logs | Verifies core workflow & SO link |
 * | TC-JS-234-N-02 | Sent quote converted without warehouse_id, customer_po_number, or note (quote had PO & note) | Equivalence – Normal / Defaults | Resolves default warehouse and inherits quote.customer_po_number and quote.note into SO | Verifies fallback defaults |
 * | TC-JS-234-N-03 | Converted SO later cancelled via cancel_sales_order | Equivalence – Lifecycle | SO becomes cancelled while quote remains converted (does not revert to sent) | Verifies no resurrection |
 * | TC-JS-234-B-01 | valid_until == today vs valid_until == today - 1 | Boundary – Expiration ±1 day | Today succeeds; past-due rejects with 報價單已過期，無法轉為銷售單, persists quote status=expired, 0 SO created | Verifies in-tx expiration |
 * | TC-JS-234-B-02 | customer_po_number whitespace-only, empty note (''), & unit_price = 0 + fractional qty 1.5 * 33.33 | Boundary – Empty / Zero / Rounding | Empty PO & empty note clear SO fields to null (while preserving quote note when note is null/omitted); 0 price and rounded subtotal 50.0 preserved | Verifies optional clearing & numeric boundaries |
 * | TC-JS-234-E-01 | Duplicate conversion of already converted quote | Error – Duplicate Conversion | Rejects with 此報價單已結案，無法修改; no second SO created | Verifies idempotency guard |
 * | TC-JS-234-E-02 | Convert draft, pending_approval, declined, cancelled quotes | Error – Invalid Status | Draft/pending reject with 目前狀態不允許此操作; declined/cancelled reject with 此報價單已結案，無法修改 | Verifies state machine |
 * | TC-JS-234-E-03 | Nonexistent / inactive warehouse_id, missing default warehouse, deactivated customer, invalid calendar date | Error – Rollback / Validation | Rejects with expected error; quote remains sent and 0 SO created | Verifies atomicity & rollback |
 * | TC-JS-234-SEC-01 | Cross-tenant conversion attempt | Isolation – Multi-Tenant | Tenant B cannot convert Tenant A quote (找不到報價單或不屬於目前租戶) | Verifies tenant isolation |
 */

async function setupEnv(tid) {
  await invoke('set_mock_active_tenant', { tenant_id: tid });
  await invoke('reset_mock_warehouses', { tenant_id: tid });
  await invoke('reset_mock_quotes', { tenant_id: tid });
  await invoke('reset_mock_sales_orders', { tenant_id: tid });

  const whDefault = await invoke('create_warehouse', { code: 'MAIN', name: '主倉' });
  const whSecond = await invoke('create_warehouse', { code: 'B02', name: '二號倉' });

  const customer = await invoke('create_partner', {
    name: `台達電子_${tid}`,
    isCustomer: true,
    isVendor: false
  });

  const prod1 = await invoke('create_product', {
    name: '變頻器',
    category: 'resale',
    selling_price: 500,
    unit_name: '台'
  });
  const prod2 = await invoke('create_product', {
    name: '控制線組',
    category: 'resale',
    selling_price: 100,
    unit_name: '組'
  });

  return {
    whDefault,
    whSecond,
    customer,
    u1: prod1.units[0].id,
    u2: prod2.units[0].id
  };
}

async function createSentQuote(customerId, validUntil, today, lines, quotePo = null) {
  const created = await createQuoteAction({
    customer_partner_id: customerId,
    valid_until: validUntil,
    note: '測試報價備註',
    customer_po_number: quotePo
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
  return await invoke('get_quote', { quote_id: created.quote.id, today_override: today });
}

test.describe('Issue #234: Mark Quote Accepted & Convert to Sales Order', () => {
  test('TC-JS-234-N-01 & N-02: Convert sent quote to confirmed SO with exact lines, link, and no audit logs', async () => {
    // Given: Active tenant with two warehouses, customer, and a sent 2-line quote
    const tid = `tnt_234_n1_${Date.now()}`;
    const { whDefault, whSecond, customer, u1, u2 } = await setupEnv(tid);
    const today = '2026-11-12';
    const sent = await createSentQuote(
      customer.id,
      '2026-12-31',
      today,
      [
        { unit_id: u1, quantity: 3, unit_price: 480 },
        { unit_id: u2, quantity: 5, unit_price: 110 }
      ],
      'PO-QUOTE-OLD'
    );
    const auditLogsBefore = (await invoke('get_audit_logs', {})).length;

    // When: Converting via store action with explicit warehouse, customer_po_number, expected_ship_date
    const res = await convertQuoteAction({
      quote_id: sent.quote.id,
      warehouse_id: whSecond.id,
      customer_po_number: 'PO-CUST-999',
      expected_ship_date: '2026-11-25',
      today_override: today
    });

    // Then: Quote is converted with link, accepted_by, converted_at; SO is confirmed with copied lines
    assert.equal(res.quote.status, 'converted');
    assert.ok(res.quote.converted_at);
    assert.ok(res.quote.accepted_by);
    assert.equal(res.quote.converted_sales_order_id, res.sales_order.order.id);
    assert.equal(appState.currentQuoteDetail.quote.converted_sales_order_id, res.sales_order.order.id);

    const so = res.sales_order.order;
    assert.equal(so.status, 'confirmed');
    assert.equal(so.so_number, 'SO-00001');
    assert.equal(so.source_quote_id, sent.quote.id);
    assert.equal(so.customer_partner_id, customer.id);
    assert.equal(so.customer_reference, 'PO-CUST-999');
    assert.equal(so.warehouse_id, whSecond.id);
    assert.equal(so.currency, 'TWD');
    assert.equal(so.expected_ship_date, '2026-11-25');
    assert.equal(so.total_amount, res.total_amount);

    assert.equal(res.sales_order.lines.length, 2);
    assert.equal(res.sales_order.lines[0].unit_id, u1);
    assert.equal(res.sales_order.lines[0].quantity, 3);
    assert.equal(res.sales_order.lines[0].unit_price, 480);
    assert.equal(res.sales_order.lines[0].subtotal, 1440);
    assert.equal(res.sales_order.lines[1].unit_id, u2);
    assert.equal(res.sales_order.lines[1].quantity, 5);
    assert.equal(res.sales_order.lines[1].unit_price, 110);
    assert.equal(res.sales_order.lines[1].subtotal, 550);

    // And: Fetchable via fetchSalesOrderDetail (UI link target) and 0 audit_logs added
    const fetchedSo = await fetchSalesOrderDetail(res.quote.converted_sales_order_id);
    assert.equal(fetchedSo.order.id, so.id);
    assert.equal(fetchedSo.order.so_number, 'SO-00001');
    const auditLogsAfter = (await invoke('get_audit_logs', {})).length;
    assert.equal(auditLogsAfter, auditLogsBefore);

    // When (TC-JS-234-N-02): Converting a second quote without warehouse_id or customer_po_number
    const sent2 = await createSentQuote(
      customer.id,
      '2026-12-31',
      today,
      [{ unit_id: u1, quantity: 1, unit_price: 500 }],
      'PO-INHERITED'
    );
    const res2 = await convertQuoteAction({
      quote_id: sent2.quote.id,
      note: null,
      today_override: today
    });

    // Then: Uses default warehouse and inherits quote's PO number and note (null/omitted matches Rust None => quote.note)
    assert.equal(res2.sales_order.order.warehouse_id, whDefault.id);
    assert.equal(res2.sales_order.order.customer_reference, 'PO-INHERITED');
    assert.equal(res2.sales_order.order.note, '測試報價備註');
  });

  test('TC-JS-234-N-03: Cancelling converted sales order keeps quote in converted status', async () => {
    // Given: A converted quote and confirmed SO
    const tid = `tnt_234_n3_${Date.now()}`;
    const { whDefault, customer, u1 } = await setupEnv(tid);
    const today = '2026-11-12';
    const sent = await createSentQuote(customer.id, '2026-12-31', today, [
      { unit_id: u1, quantity: 2, unit_price: 500 }
    ]);
    const converted = await convertQuoteAction({
      quote_id: sent.quote.id,
      warehouse_id: whDefault.id,
      today_override: today
    });

    // When: Cancelling the sales order
    const cancelledSo = await invoke('cancel_sales_order', { order_id: converted.sales_order.order.id });
    assert.equal(cancelledSo.order.status, 'cancelled');

    // Then: Quote stays 'converted'
    const reloaded = await fetchQuoteDetail(sent.quote.id);
    assert.equal(reloaded.quote.status, 'converted');
    assert.equal(reloaded.quote.converted_sales_order_id, converted.sales_order.order.id);
  });

  test('TC-JS-234-B-01: Expiration boundary rejects past-due quote and persists expired status', async () => {
    // Given: Two sent quotes valid until 2099-11-10
    const tid = `tnt_234_b1_${Date.now()}`;
    const { whDefault, customer, u1 } = await setupEnv(tid);
    const qExact = await createSentQuote(customer.id, '2099-11-10', '2099-11-09', [
      { unit_id: u1, quantity: 1, unit_price: 500 }
    ]);
    const qExpired = await createSentQuote(customer.id, '2099-11-10', '2099-11-09', [
      { unit_id: u1, quantity: 1, unit_price: 500 }
    ]);

    // When: Converting qExact on 2099-11-10 (exact valid_until boundary)
    const okRes = await convertQuoteAction({
      quote_id: qExact.quote.id,
      warehouse_id: whDefault.id,
      today_override: '2099-11-10'
    });
    assert.equal(okRes.quote.status, 'converted');

    // When: Converting qExpired on 2099-11-11 (past due by 1 day)
    await assert.rejects(
      () =>
        convertQuoteAction({
          quote_id: qExpired.quote.id,
          warehouse_id: whDefault.id,
          today_override: '2099-11-11'
        }),
      { message: '報價單已過期，無法轉為銷售單' }
    );

    // Then: Quote status persisted as expired and 0 sales orders created for it
    const reloaded = await invoke('get_quote', {
      quote_id: qExpired.quote.id,
      today_override: '2099-11-11'
    });
    assert.equal(reloaded.quote.status, 'expired');
    assert.ok(reloaded.quote.expired_at);
    const sos = await invoke('list_sales_orders', {});
    assert.equal(sos.filter(o => o.source_quote_id === qExpired.quote.id).length, 0);
  });

  test('TC-JS-234-B-02: Whitespace PO clears reference, zero price and fractional rounding preserved', async () => {
    // Given: Sent quote with 0-price item and fractional qty 1.5 * 33.33
    const tid = `tnt_234_b2_${Date.now()}`;
    const { whDefault, customer, u1, u2 } = await setupEnv(tid);
    const today = '2026-11-12';
    const sent = await createSentQuote(
      customer.id,
      '2026-12-31',
      today,
      [
        { unit_id: u1, quantity: 2, unit_price: 0 },
        { unit_id: u2, quantity: 1.5, unit_price: 33.33 }
      ],
      'PO-OLD'
    );

    // When: Converting with whitespace-only PO and cleared empty note ('')
    const res = await convertQuoteAction({
      quote_id: sent.quote.id,
      warehouse_id: whDefault.id,
      customer_po_number: '   \t  ',
      note: '',
      today_override: today
    });

    // Then: PO & note cleared to null; 0 price and rounded subtotal 50.0 preserved
    assert.equal(res.sales_order.order.customer_reference, null);
    assert.equal(res.sales_order.order.note, null);
    assert.equal(res.sales_order.lines[0].unit_price, 0);
    assert.equal(res.sales_order.lines[0].subtotal, 0);
    assert.equal(res.sales_order.lines[1].quantity, 1.5);
    assert.equal(res.sales_order.lines[1].unit_price, 33.33);
    assert.equal(res.sales_order.lines[1].subtotal, 50);
    assert.equal(res.sales_order.order.total_amount, res.total_amount);
  });

  test('TC-JS-234-E-01 & E-02: Duplicate conversion and invalid status transitions rejected', async () => {
    // Given: Converted, draft, pending_approval, declined, and cancelled quotes
    const tid = `tnt_234_e1_${Date.now()}`;
    const { whDefault, customer, u1 } = await setupEnv(tid);
    const today = '2026-11-12';

    const sent = await createSentQuote(customer.id, '2026-12-31', today, [
      { unit_id: u1, quantity: 1, unit_price: 500 }
    ]);
    await convertQuoteAction({ quote_id: sent.quote.id, warehouse_id: whDefault.id, today_override: today });

    // When / Then (E-01): Second conversion rejected
    await assert.rejects(
      () => convertQuoteAction({ quote_id: sent.quote.id, warehouse_id: whDefault.id, today_override: today }),
      { message: '此報價單已結案，無法修改' }
    );
    const sos = await invoke('list_sales_orders', {});
    assert.equal(sos.filter(o => o.source_quote_id === sent.quote.id).length, 1);

    // Draft & pending_approval rejected
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: '2026-12-31' });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: u1, quantity: 1, unit_price: 400 });
    await assert.rejects(
      () => convertQuoteAction({ quote_id: draft.quote.id, warehouse_id: whDefault.id, today_override: today }),
      { message: '目前狀態不允許此操作' }
    );
    await submitQuoteAction({ quote_id: draft.quote.id, today_override: today });
    await assert.rejects(
      () => convertQuoteAction({ quote_id: draft.quote.id, warehouse_id: whDefault.id, today_override: today }),
      { message: '目前狀態不允許此操作' }
    );

    // Declined & cancelled rejected
    const qDec = await createSentQuote(customer.id, '2026-12-31', today, [{ unit_id: u1, quantity: 1, unit_price: 500 }]);
    await declineQuoteAction({ quote_id: qDec.quote.id, reason: '拒絕' });
    await assert.rejects(
      () => convertQuoteAction({ quote_id: qDec.quote.id, warehouse_id: whDefault.id, today_override: today }),
      { message: '此報價單已結案，無法修改' }
    );

    const qCan = await createSentQuote(customer.id, '2026-12-31', today, [{ unit_id: u1, quantity: 1, unit_price: 500 }]);
    await cancelQuoteAction({ quote_id: qCan.quote.id, reason: '取消' });
    await assert.rejects(
      () => convertQuoteAction({ quote_id: qCan.quote.id, warehouse_id: whDefault.id, today_override: today }),
      { message: '此報價單已結案，無法修改' }
    );
  });

  test('TC-JS-234-E-03 & SEC-01: Rollback on invalid warehouse/date/customer and tenant isolation', async () => {
    // Given: Sent quote in Tenant A with active & deactivated warehouse
    const tidA = `tnt_234_ea_${Date.now()}`;
    const tidB = `tnt_234_eb_${Date.now()}`;
    const { whDefault, whSecond, customer, u1 } = await setupEnv(tidA);
    const today = '2026-11-12';
    const sent = await createSentQuote(customer.id, '2026-12-31', today, [
      { unit_id: u1, quantity: 2, unit_price: 500 }
    ]);

    await invoke('deactivate_warehouse', { id: whSecond.id });

    // When / Then: Inactive warehouse rejected and quote remains sent
    await assert.rejects(
      () => convertQuoteAction({ quote_id: sent.quote.id, warehouse_id: whSecond.id, today_override: today }),
      { message: '找不到倉別或倉別已停用' }
    );
    assert.equal((await fetchQuoteDetail(sent.quote.id)).quote.status, 'sent');

    // When / Then: Invalid calendar date rejected and quote remains sent
    await assert.rejects(
      () =>
        convertQuoteAction({
          quote_id: sent.quote.id,
          warehouse_id: whDefault.id,
          expected_ship_date: '2026-02-29',
          today_override: today
        }),
      { message: '日期超出該月份天數' }
    );
    assert.equal((await fetchQuoteDetail(sent.quote.id)).quote.status, 'sent');

    // When / Then (SEC-01): Tenant B cannot convert Tenant A's quote
    await invoke('set_mock_active_tenant', { tenant_id: tidB });
    await assert.rejects(
      () => convertQuoteAction({ quote_id: sent.quote.id, today_override: today }),
      { message: '找不到報價單或不屬於目前租戶' }
    );

    // When / Then: Deactivated customer rejected and quote remains sent
    await invoke('set_mock_active_tenant', { tenant_id: tidA });
    await invoke('update_partner', { id: customer.id, isActive: false });
    await assert.rejects(
      () => convertQuoteAction({ quote_id: sent.quote.id, warehouse_id: whDefault.id, today_override: today }),
      { message: '找不到此客戶，或該往來對象未設定為客戶' }
    );
    assert.equal((await fetchQuoteDetail(sent.quote.id)).quote.status, 'sent');
    assert.equal((await invoke('list_sales_orders', {})).length, 0);

    // Also verify fetchWarehouses populates active warehouses for UI convert modal
    const whs = await fetchWarehouses(false);
    assert.equal(whs.length, 1);
    assert.equal(whs[0].id, whDefault.id);
  });
});
