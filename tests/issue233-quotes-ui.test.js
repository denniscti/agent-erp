import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  fetchQuotes,
  fetchQuoteDetail,
  createQuoteAction,
  updateQuoteHeaderAction,
  addQuoteLineAction,
  updateQuoteLineAction,
  deleteQuoteLineAction,
  submitQuoteAction,
  withdrawQuoteApprovalAction,
  approveQuoteAction,
  rejectQuoteAction,
  declineQuoteAction,
  convertQuoteAction,
  cancelQuoteAction
} = await import('../src/lib/store.svelte.js');

test.describe('Issue #233: Quotes UI Workspace & Layer 2 End-to-End Workflow Verification', () => {
  const tenantId = 'tnt_mock_1';
  let customer;
  let vendorOnly;
  let testProduct;
  let unitId;
  let unit2Id;

  test.beforeEach(async () => {
    // Given: Active tenant and clean mock state
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_quotes', { tenant_id: tenantId });

    // Setup active customer
    customer = await invoke('create_partner', {
      name: `報價專用客戶_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      isCustomer: true,
      isVendor: false
    });

    // Setup vendor-only partner
    vendorOnly = await invoke('create_partner', {
      name: `非客戶廠商_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      isCustomer: false,
      isVendor: true
    });

    // Setup sellable product with standard selling price = 100.00
    testProduct = await invoke('create_product', {
      name: `銷售商品_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    unitId = testProduct.units[0].id;

    // Update standard selling price to 100.00
    await invoke('update_product_unit', {
      unit_id: unitId,
      selling_price: 100.0
    });

    // Add a second unit for testing
    const variantId = testProduct.variants[0].id;
    const addedUnit = await invoke('add_product_unit', {
      variant_id: variantId,
      unit_name: '箱',
      conversion_ratio: 10.0,
      selling_price: 900.0
    });
    unit2Id = addedUnit.id;
  });

  // ==========================================
  // Normal Cases (TC-UI-N-01 to TC-UI-N-12)
  // ==========================================

  test('TC-UI-N-01: Create new draft quote with valid customer and default date', async () => {
    // Given: An active customer and future valid_until date
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);

    // When: Creating a new quote via createQuoteAction
    const res = await createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil,
      note: '標準建立測試',
      customer_po_number: 'PO-2026-N01'
    });

    // Then: Draft quote is created with formatted QUO number and default draft status
    assert.ok(res.quote.id);
    assert.match(res.quote.quote_number, /^QUO-\d{5}$/);
    assert.equal(res.quote.customer_partner_id, customer.id);
    assert.equal(res.quote.status, 'draft');
    assert.equal(res.quote.valid_until, validUntil);
    assert.equal(res.quote.note, '標準建立測試');
    assert.equal(res.quote.customer_po_number, 'PO-2026-N01');
    assert.equal(res.lines.length, 0);
    assert.equal(res.total_amount, 0);
  });

  test('TC-UI-N-02: Add quote line with price >= standard price (above standard price)', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });

    // When: Adding a line with unit_price = 150 (standard = 100)
    const detail = await addQuoteLineAction({
      quote_id: draft.quote.id,
      unit_id: unitId,
      quantity: 5,
      unit_price: 150.0,
      notes: '溢價販售'
    });

    // Then: Line is added with standard price snapshot and positive diff
    assert.equal(detail.lines.length, 1);
    const line = detail.lines[0];
    assert.equal(line.quantity, 5);
    assert.equal(line.unit_price, 150.0);
    assert.equal(line.standard_price_snapshot, 100.0);
    assert.equal(line.line_amount, 750.0);
    assert.equal(detail.total_amount, 750.0);
  });

  test('TC-UI-N-03: Add quote line with price < standard price (below standard price comparison)', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });

    // When: Adding a line with unit_price = 80 (standard = 100)
    const detail = await addQuoteLineAction({
      quote_id: draft.quote.id,
      unit_id: unitId,
      quantity: 10,
      unit_price: 80.0,
      notes: '大宗折扣'
    });

    // Then: Line item records standard price snapshot 100 and diff is -20.00
    assert.equal(detail.lines.length, 1);
    const line = detail.lines[0];
    assert.equal(line.unit_price, 80.0);
    assert.equal(line.standard_price_snapshot, 100.0);
    const diff = line.unit_price - line.standard_price_snapshot;
    assert.equal(diff, -20.0);
    assert.equal(line.line_amount, 800.0);
  });

  test('TC-UI-N-04: Submit quote containing below-standard item transitions to pending_approval', async () => {
    // Given: A draft quote with an item below standard price
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({
      customer_partner_id: customer.id,
      valid_until: validUntil
    });
    await addQuoteLineAction({
      quote_id: draft.quote.id,
      unit_id: unitId,
      quantity: 2,
      unit_price: 70.0
    });

    // When: Submitting the quote
    const submitted = await submitQuoteAction({
      quote_id: draft.quote.id
    });

    // Then: Status becomes pending_approval and requires_approval is true
    assert.equal(submitted.quote.status, 'pending_approval');
    assert.equal(submitted.quote.requires_approval, 1);
    assert.ok(submitted.quote.submitted_at);
  });

  test('TC-UI-N-05: Reject pending quote records rejection reason and returns status to draft', async () => {
    // Given: A quote in pending_approval
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 50.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });

    // When: Manager rejects the quote with reason "折讓過大，請調整至至少 85 元"
    const rejectionReason = '折讓過大，請調整至至少 85 元';
    const rejected = await rejectQuoteAction({
      quote_id: draft.quote.id,
      reason: rejectionReason
    });

    // Then: Status returns to draft and approval_rejection_reason is displayed
    assert.equal(rejected.quote.status, 'draft');
    assert.equal(rejected.quote.approval_rejection_reason, rejectionReason);

    // Verify detail query also retains the rejection reason
    const fetched = await fetchQuoteDetail(draft.quote.id);
    assert.equal(fetched.quote.status, 'draft');
    assert.equal(fetched.quote.approval_rejection_reason, rejectionReason);
  });

  test('TC-UI-N-06: Resubmit rejected draft quote after updating line item price', async () => {
    // Given: A draft quote previously rejected
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    const lineRes = await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 50.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });
    await rejectQuoteAction({ quote_id: draft.quote.id, reason: '單價過低' });

    // When: Sales rep updates line price to 85.00 and resubmits
    const lineId = lineRes.lines[0].id;
    await updateQuoteLineAction({
      quote_id: draft.quote.id,
      line_id: lineId,
      quantity: 1,
      unit_price: 85.0
    });
    const resubmitted = await submitQuoteAction({ quote_id: draft.quote.id });

    // Then: Quote is back in pending_approval
    assert.equal(resubmitted.quote.status, 'pending_approval');
    const detail = await fetchQuoteDetail(draft.quote.id);
    assert.equal(detail.lines[0].unit_price, 85.0);
  });

  test('TC-UI-N-07: Approve pending quote transitions status to sent', async () => {
    // Given: A quote in pending_approval
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 85.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });

    // When: Manager approves the quote
    const approved = await approveQuoteAction({
      quote_id: draft.quote.id,
      reason: '特別核准'
    });

    // Then: Status becomes sent
    assert.equal(approved.quote.status, 'sent');
    assert.ok(approved.quote.approved_at);
    assert.ok(approved.quote.sent_at);
    assert.equal(approved.quote.approval_rejection_reason, null);
  });

  test('TC-UI-N-08: Decline sent quote transitions status to declined (terminal)', async () => {
    // Given: An approved / sent quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });
    await submitQuoteAction({ quote_id: draft.quote.id }); // Directly sent because unit_price >= standard

    // When: Customer declines quote with reason
    const declined = await declineQuoteAction({
      quote_id: draft.quote.id,
      reason: '客戶預算不足'
    });

    // Then: Status becomes declined
    assert.equal(declined.quote.status, 'declined');
    assert.equal(declined.quote.decline_reason, '客戶預算不足');
    assert.ok(declined.quote.declined_at);
  });

  test('TC-UI-N-09: Convert sent quote to sales order transitions status to converted (terminal)', async () => {
    // Given: A sent quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 2, unit_price: 100.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });

    // When: Sales rep converts quote to sales order SO-2026-001
    const converted = await convertQuoteAction({
      quote_id: draft.quote.id,
      sales_order_id: 'SO-2026-001'
    });

    // Then: Status becomes converted with sales order link
    assert.equal(converted.quote.status, 'converted');
    assert.equal(converted.quote.converted_sales_order_id, 'SO-2026-001');
    assert.ok(converted.quote.converted_at);
  });

  test('TC-UI-N-10: Withdraw quote from pending_approval back to draft', async () => {
    // Given: A quote in pending_approval
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 60.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });

    // When: Sales rep withdraws approval
    const withdrawn = await withdrawQuoteApprovalAction({
      quote_id: draft.quote.id,
      reason: '需要補充規格'
    });

    // Then: Status returns to draft
    assert.equal(withdrawn.quote.status, 'draft');
  });

  test('TC-UI-N-11: Cancel quote from draft marks status as cancelled (terminal)', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When: Cancelling the quote with reason
    const cancelled = await cancelQuoteAction({
      quote_id: draft.quote.id,
      reason: '客戶需求變更，取消重開'
    });

    // Then: Status becomes cancelled and cancel_reason is recorded
    assert.equal(cancelled.quote.status, 'cancelled');
    assert.ok(cancelled.quote.cancelled_at);
    assert.equal(cancelled.quote.cancel_reason, '客戶需求變更，取消重開');
  });

  test('TC-UI-N-12: Filter quotes list by each status correctly', async () => {
    // Given: Multiple quotes in different statuses
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);

    // Quote 1: draft
    const q1 = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // Quote 2: sent
    const q2 = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: q2.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });
    await submitQuoteAction({ quote_id: q2.quote.id });

    // When: Querying with filterStatus = 'draft'
    const draftList = await fetchQuotes({ status: 'draft' });
    assert.ok(draftList.some(q => q.id === q1.quote.id));
    assert.ok(!draftList.some(q => q.id === q2.quote.id));

    // When: Querying with filterStatus = 'sent'
    const sentList = await fetchQuotes({ status: 'sent' });
    assert.ok(sentList.some(q => q.id === q2.quote.id));
    assert.ok(!sentList.some(q => q.id === q1.quote.id));
  });

  // ==========================================
  // Boundary Cases (TC-UI-B-01 to TC-UI-B-07)
  // ==========================================

  test('TC-UI-B-01: Boundary value - unit_price equals standard_price (diff = 0) bypasses approval', async () => {
    // Given: Standard selling price = 100.00, line unit_price = 100.00
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });

    // When: Submitting quote
    const res = await submitQuoteAction({ quote_id: draft.quote.id });

    // Then: Transitions directly to sent without approval
    assert.equal(res.quote.status, 'sent');
    assert.equal(res.quote.requires_approval, 0);
  });

  test('TC-UI-B-02: Boundary value - unit_price is 0.01 below standard_price (99.99 vs 100.00) triggers approval', async () => {
    // Given: Standard selling price = 100.00, line unit_price = 99.99
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 99.99 });

    // When: Submitting quote
    const res = await submitQuoteAction({ quote_id: draft.quote.id });

    // Then: Triggers pending_approval because 99.99 < 100.00
    assert.equal(res.quote.status, 'pending_approval');
    assert.equal(res.quote.requires_approval, 1);
  });

  test('TC-UI-B-03: Boundary value - unit_price is 0.01 above standard_price (100.01 vs 100.00) bypasses approval', async () => {
    // Given: Standard selling price = 100.00, line unit_price = 100.01
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.01 });

    // When: Submitting quote
    const res = await submitQuoteAction({ quote_id: draft.quote.id });

    // Then: Transitions directly to sent
    assert.equal(res.quote.status, 'sent');
    assert.equal(res.quote.requires_approval, 0);
  });

  test('TC-UI-B-04: Boundary value - valid_until is today (exact boundary)', async () => {
    // Given: valid_until set to today
    const today = new Date().toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: today });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });

    // When: Submitting quote today
    const res = await submitQuoteAction({ quote_id: draft.quote.id, today_override: today });

    // Then: Submission is accepted (today is still valid)
    assert.equal(res.quote.status, 'sent');
  });

  test('TC-UI-B-05: Boundary value - rejection reason is empty or pure whitespace is rejected', async () => {
    // Given: A quote in pending_approval
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 50.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });

    // When & Then: Empty string rejection reason throws error
    await assert.rejects(
      async () => {
        await rejectQuoteAction({ quote_id: draft.quote.id, reason: '' });
      },
      (err) => err.message.includes('駁回理由為必填')
    );

    // When & Then: Whitespace string rejection reason throws error
    await assert.rejects(
      async () => {
        await rejectQuoteAction({ quote_id: draft.quote.id, reason: '   \t  ' });
      },
      (err) => err.message.includes('駁回理由為必填')
    );
  });

  test('TC-UI-B-06: Boundary value - line quantity 0 or negative is rejected', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When & Then: Quantity = 0 is rejected
    await assert.rejects(
      async () => {
        await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 0, unit_price: 100.0 });
      },
      (err) => err.message.includes('數量必須大於 0')
    );

    // When & Then: Quantity = -1 is rejected
    await assert.rejects(
      async () => {
        await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: -1, unit_price: 100.0 });
      },
      (err) => err.message.includes('數量必須大於 0')
    );
  });

  test('TC-UI-B-07: Boundary value - line unit_price negative (-0.01) is rejected', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When & Then: Unit price = -0.01 is rejected
    await assert.rejects(
      async () => {
        await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: -0.01 });
      },
      (err) => err.message.includes('單價不可為負數')
    );
  });

  test('TC-UI-B-08: Boundary value - cancel reason empty, pure whitespace, or null is rejected', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When & Then: Empty string cancel reason throws error
    await assert.rejects(
      async () => {
        await cancelQuoteAction({ quote_id: draft.quote.id, reason: '' });
      },
      (err) => err.message.includes('取消理由為必填')
    );

    // When & Then: Pure whitespace cancel reason throws error
    await assert.rejects(
      async () => {
        await cancelQuoteAction({ quote_id: draft.quote.id, reason: '    ' });
      },
      (err) => err.message.includes('取消理由為必填')
    );

    // When & Then: Null/omitted reason throws error
    await assert.rejects(
      async () => {
        await cancelQuoteAction({ quote_id: draft.quote.id });
      },
      (err) => err.message.includes('取消理由為必填')
    );
  });

  test('TC-UI-B-09: Boundary value - cancel reason with leading/trailing whitespace is trimmed', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When: Cancelling with leading and trailing whitespaces
    const res = await cancelQuoteAction({
      quote_id: draft.quote.id,
      reason: '   品項數量有誤，作廢重開   '
    });

    // Then: Trimmed string is saved
    assert.equal(res.quote.cancel_reason, '品項數量有誤，作廢重開');
  });

  // ==========================================
  // Error Cases (TC-UI-E-01 to TC-UI-E-08)
  // ==========================================

  test('TC-UI-E-01: Modification of quote lines when not in draft is rejected (R4)', async () => {
    // Given: A sent quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    const lineRes = await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });

    // When & Then: Attempting to add line to sent quote throws NotDraftForModification
    await assert.rejects(
      async () => {
        await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unit2Id, quantity: 1, unit_price: 900.0 });
      },
      (err) => err.message.includes('僅草稿可修改')
    );

    // When & Then: Attempting to delete line throws NotDraftForModification
    await assert.rejects(
      async () => {
        await deleteQuoteLineAction({ quote_id: draft.quote.id, line_id: lineRes.lines[0].id });
      },
      (err) => err.message.includes('僅草稿可修改')
    );
  });

  test('TC-UI-E-02: Terminal state immutability rejects all mutations (R13)', async () => {
    // Given: A converted quote (terminal state)
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });
    await submitQuoteAction({ quote_id: draft.quote.id });
    await convertQuoteAction({ quote_id: draft.quote.id, sales_order_id: 'SO-101' });

    // When & Then: Attempting to update header on terminal quote is rejected
    await assert.rejects(
      async () => {
        await updateQuoteHeaderAction({ quote_id: draft.quote.id, customer_partner_id: customer.id, valid_until: validUntil });
      },
      (err) => err.message.includes('此報價單已結案，無法修改')
    );

    // When & Then: Attempting to submit terminal quote is rejected
    await assert.rejects(
      async () => {
        await submitQuoteAction({ quote_id: draft.quote.id });
      },
      (err) => err.message.includes('此報價單已結案，無法修改')
    );

    // When & Then: Attempting to cancel already terminal quote is rejected
    await assert.rejects(
      async () => {
        await cancelQuoteAction({ quote_id: draft.quote.id, reason: '再次取消已結案報價單' });
      },
      (err) => err.message.includes('此報價單已結案，無法修改')
    );
  });

  test('TC-UI-E-03: Submitting quote with no line items is rejected (R5)', async () => {
    // Given: An empty draft quote with 0 lines
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When & Then: Submit is rejected
    await assert.rejects(
      async () => {
        await submitQuoteAction({ quote_id: draft.quote.id });
      },
      (err) => err.message.includes('報價單沒有任何品項，無法送出')
    );
  });

  test('TC-UI-E-04: Submitting quote with expired valid_until is rejected (R6)', async () => {
    // Given: A draft quote with valid_until in the past
    const pastDate = '2020-01-01';
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: pastDate });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });

    // When & Then: Submit is rejected with expired valid_until error
    await assert.rejects(
      async () => {
        await submitQuoteAction({ quote_id: draft.quote.id, today_override: '2026-03-01' });
      },
      (err) => err.message.includes('報價有效期已過')
    );
  });

  test('TC-UI-E-05: Duplicate unit_id in same quote is rejected', async () => {
    // Given: A draft quote with unitId already added
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });
    await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 1, unit_price: 100.0 });

    // When & Then: Adding the same unitId again throws duplicate error
    await assert.rejects(
      async () => {
        await addQuoteLineAction({ quote_id: draft.quote.id, unit_id: unitId, quantity: 2, unit_price: 100.0 });
      },
      (err) => err.message.includes('同一報價單內商品單位不可重複')
    );
  });

  test('TC-UI-E-06: Partner not a customer or inactive is rejected (R1)', async () => {
    // Given: A vendor partner that is not a customer
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);

    // When & Then: Creating quote with vendorOnly partner fails
    await assert.rejects(
      async () => {
        await createQuoteAction({ customer_partner_id: vendorOnly.id, valid_until: validUntil });
      },
      (err) => err.message.includes('找不到此客戶，或該往來對象未設定為客戶')
    );
  });

  test('TC-UI-E-07: Invalid status transitions for decline and convert when not sent', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When & Then: Attempting to decline a draft quote is rejected
    await assert.rejects(
      async () => {
        await declineQuoteAction({ quote_id: draft.quote.id, reason: 'draft不能直接拒絕' });
      },
      (err) => err.message.includes('目前狀態不允許此操作')
    );

    // When & Then: Attempting to convert a draft quote is rejected
    await assert.rejects(
      async () => {
        await convertQuoteAction({ quote_id: draft.quote.id });
      },
      (err) => err.message.includes('目前狀態不允許此操作')
    );
  });

  test('TC-UI-E-08: Invalid status transitions for approval operations when not pending_approval', async () => {
    // Given: A draft quote
    const validUntil = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    const draft = await createQuoteAction({ customer_partner_id: customer.id, valid_until: validUntil });

    // When & Then: Approve draft quote is rejected
    await assert.rejects(
      async () => {
        await approveQuoteAction({ quote_id: draft.quote.id });
      },
      (err) => err.message.includes('目前狀態不允許此操作')
    );

    // When & Then: Reject draft quote is rejected
    await assert.rejects(
      async () => {
        await rejectQuoteAction({ quote_id: draft.quote.id, reason: '不可駁回草稿' });
      },
      (err) => err.message.includes('目前狀態不允許此操作')
    );
  });
});
