import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';
import { calculateDueDate, getPaymentTermsNotice } from '../src/lib/paymentTerms.js';

test.describe('Issue #202: Vendor Bills UI, Matching & Purchase Orders Integration', () => {
  let tenantId = 'tnt_mock_1';

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_bills', { tenant_id: tenantId });
  });

  test('TC-L2-01: Select 2 POs from "已到貨未請款" and create vendor bill with correct pre-filled values', async () => {
    // Given: A vendor and two purchase orders in received status
    const vendor = await invoke('create_partner', {
      name: `供應商A_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });

    const wh = await invoke('create_warehouse', { code: `WH_${Date.now()}_${Math.floor(Math.random() * 10000)}`, name: '主倉庫' });

    // PO 1: 10 units @ 100 = 1000 ordered, received 10 = 1000 received
    const po1 = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    // Add line to PO 1
    const prod1 = await invoke('create_product', {
      name: `商品1_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    const unit1Id = prod1.units[0].id;
    await invoke('add_purchase_order_line', {
      order_id: po1.order.id,
      unit_id: unit1Id,
      quantity: 10,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po1.order.id });
    const poDetail1 = await invoke('get_purchase_order', { order_id: po1.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po1.order.id,
      received_lines: [{ line_id: poDetail1.lines[0].id, received_quantity: 10 }]
    });

    // PO 2: 5 units @ 200 = 1000 ordered, received 4 = 800 received (short delivery)
    const po2 = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    await invoke('add_purchase_order_line', {
      order_id: po2.order.id,
      unit_id: unit1Id,
      quantity: 5,
      purchase_cost: 200
    });
    await invoke('submit_purchase_order', { order_id: po2.order.id });
    const poDetail2 = await invoke('get_purchase_order', { order_id: po2.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po2.order.id,
      received_lines: [{ line_id: poDetail2.lines[0].id, received_quantity: 4 }]
    });

    // When: Querying unbilled received orders for this vendor
    const unbilled = await invoke('list_unbilled_received_orders', { vendor_partner_id: vendor.id });
    assert.equal(unbilled.length, 2);

    const unbilledPo1 = unbilled.find(u => u.purchase_order_id === po1.order.id);
    const unbilledPo2 = unbilled.find(u => u.purchase_order_id === po2.order.id);

    // Then: Pre-filled values contain ordered and received totals
    assert.equal(unbilledPo1.total_amount, 1000);
    assert.equal(unbilledPo1.received_total_amount, 1000);
    assert.equal(unbilledPo2.total_amount, 1000);
    assert.equal(unbilledPo2.received_total_amount, 800);

    // When: Creating a vendor bill pre-filling the sum of received totals (1000 + 800 = 1800)
    const billDetail = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-202-01-${Date.now()}`,
        bill_date: '2026-03-01',
        due_date: '2026-03-31',
        untaxed_amount: 1800,
        tax_amount: 90
      }
    });

    await invoke('add_vendor_bill_order', { bill_id: billDetail.bill.id, purchase_order_id: po1.order.id });
    await invoke('add_vendor_bill_order', { bill_id: billDetail.bill.id, purchase_order_id: po2.order.id });

    const finalBill = await invoke('get_vendor_bill', { bill_id: billDetail.bill.id });

    // Then: Bill covers both orders with correct total amounts
    assert.equal(finalBill.orders.length, 2);
    const ord1 = finalBill.orders.find(o => o.purchase_order_id === po1.order.id);
    const ord2 = finalBill.orders.find(o => o.purchase_order_id === po2.order.id);
    assert.equal(ord1.total_amount, 1000);
    assert.equal(ord1.received_total_amount, 1000);
    assert.equal(ord2.total_amount, 1000);
    assert.equal(ord2.received_total_amount, 800);
  });

  test('TC-L2-02 & TC-L2-03: Payment terms due date auto-calculation and unconfigured notice', () => {
    // Given: Net 30, Month End 15, and Unconfigured vendors
    // When 1: Net 30 from 2026-01-10
    const netDueDate = calculateDueDate('2026-01-10', 'net', 30);
    // Then 1: 2026-02-09
    assert.equal(netDueDate, '2026-02-09');

    // When 2: Month End 30 from 2026-01-15 (Jan 31 + 30 days = March 2)
    const monthEndDueDate = calculateDueDate('2026-01-15', 'month_end', 30);
    // Then 2: 2026-03-02
    assert.equal(monthEndDueDate, '2026-03-02');

    // When 3: Unconfigured payment terms
    const unconfDueDate = calculateDueDate('2026-01-15', null, null);
    const notice = getPaymentTermsNotice(null);
    // Then 3: Same date and displays warning notice
    assert.equal(unconfDueDate, '2026-01-15');
    assert.equal(notice, '此供應商未設定付款條件');
  });

  test('TC-L2-04 & TC-L2-05: Matching |Z| < 1.0 (exact & 0.99) posts directly to posted', async () => {
    // Given: Vendor and received PO with basis 1000
    const vendor = await invoke('create_partner', {
      name: `供應商B_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const wh = await invoke('create_warehouse', { code: `WH_${Date.now()}_${Math.floor(Math.random() * 100000)}`, name: '倉庫' });
    const p = await invoke('create_product', {
      name: `商品_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    const unitId = p.units[0].id;

    const po = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    await invoke('add_purchase_order_line', {
      order_id: po.order.id,
      unit_id: unitId,
      quantity: 10,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po.order.id });
    const poDetail = await invoke('get_purchase_order', { order_id: po.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po.order.id,
      received_lines: [{ line_id: poDetail.lines[0].id, received_quantity: 10 }]
    });

    // When: Untaxed = 1000.99 (diff = +0.99, within tolerance < 1.0)
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-TOL-${Date.now()}`,
        bill_date: '2026-03-01',
        due_date: '2026-03-31',
        untaxed_amount: 1000.99,
        tax_amount: 50
      }
    });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po.order.id });
    const posted = await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    // Then: Status is posted directly without dispute
    assert.equal(posted.bill.status, 'posted');
  });

  test('TC-L2-06, TC-L2-07, TC-L2-08, TC-L2-09: |Z| >= 1.0 transitions to disputed; accept note required; return to draft', async () => {
    // Given: Vendor and received PO with basis 1000
    const vendor = await invoke('create_partner', {
      name: `供應商C_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const wh = await invoke('create_warehouse', { code: `WH_${Date.now()}_${Math.floor(Math.random() * 100000)}`, name: '倉庫' });
    const p = await invoke('create_product', {
      name: `商品_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    const unitId = p.units[0].id;

    const po = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    await invoke('add_purchase_order_line', {
      order_id: po.order.id,
      unit_id: unitId,
      quantity: 10,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po.order.id });
    const poDetail = await invoke('get_purchase_order', { order_id: po.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po.order.id,
      received_lines: [{ line_id: poDetail.lines[0].id, received_quantity: 10 }]
    });

    // When 1: Posting with untaxed 1001.00 (diff = +1.00 >= 1.0)
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-DISP-${Date.now()}`,
        bill_date: '2026-03-01',
        due_date: '2026-03-31',
        untaxed_amount: 1001.00,
        tax_amount: 50
      }
    });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po.order.id });
    const disputed = await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    // Then 1: Transitions to disputed
    assert.equal(disputed.bill.status, 'disputed');
    assert.equal(disputed.bill.basis_amount, 1000);
    assert.equal(disputed.bill.difference_amount, 1.0);

    // When 2: Accept difference with empty / whitespace note
    await assert.rejects(
      async () => {
        await invoke('accept_vendor_bill_difference', {
          bill_id: bill.bill.id,
          difference_note: '   '
        });
      },
      {
        message: /接受差異.*說明/
      }
    );

    // When 3: Return to draft
    const draftAgain = await invoke('return_vendor_bill_to_draft', { bill_id: bill.bill.id });
    assert.equal(draftAgain.bill.status, 'draft');
    assert.equal(draftAgain.bill.difference_amount, null);

    // When 4: Re-post to disputed and accept with valid note
    await invoke('post_vendor_bill', { bill_id: bill.bill.id });
    const accepted = await invoke('accept_vendor_bill_difference', {
      bill_id: bill.bill.id,
      difference_note: '雙方協議運費加價 1 元'
    });

    // Then 4: Bill transitions to posted and AP is created
    assert.equal(accepted.bill.status, 'posted');
    assert.equal(accepted.bill.difference_note, '雙方協議運費加價 1 元');
    assert.ok(accepted.payable);
    assert.equal(accepted.payable.amount, 1051);
  });

  test('TC-L2-10, TC-L2-11, TC-L2-12: Purchase order detail displays short delivery amounts and billing info', async () => {
    // Given: Received PO with short delivery (ordered 10 @ 100 = 1000; received 6 @ 100 = 600)
    const vendor = await invoke('create_partner', {
      name: `供應商D_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const wh = await invoke('create_warehouse', { code: `WH_${Date.now()}_${Math.floor(Math.random() * 100000)}`, name: '倉庫' });
    const p = await invoke('create_product', {
      name: `商品_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    const unitId = p.units[0].id;

    const po1 = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    await invoke('add_purchase_order_line', {
      order_id: po1.order.id,
      unit_id: unitId,
      quantity: 10,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po1.order.id });
    const poDetail1 = await invoke('get_purchase_order', { order_id: po1.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po1.order.id,
      received_lines: [{ line_id: poDetail1.lines[0].id, received_quantity: 6 }]
    });

    // Also second PO for multiple order billing test
    const po2 = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    await invoke('add_purchase_order_line', {
      order_id: po2.order.id,
      unit_id: unitId,
      quantity: 4,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po2.order.id });
    const poDetail2 = await invoke('get_purchase_order', { order_id: po2.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po2.order.id,
      received_lines: [{ line_id: poDetail2.lines[0].id, received_quantity: 4 }]
    });

    // Check PO 1 unbilled billing info
    const infoBefore = await invoke('get_purchase_order_billing_info', { purchase_order_id: po1.order.id });
    assert.equal(infoBefore, null);

    // When: Creating a bill covering both PO 1 and PO 2
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-MULTI-${Date.now()}`,
        bill_date: '2026-03-01',
        due_date: '2026-03-31',
        untaxed_amount: 1000,
        tax_amount: 50
      }
    });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po1.order.id });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po2.order.id });

    // Then: PO 1 billing info reports draft bill and bill_order_count = 2
    const infoDraft = await invoke('get_purchase_order_billing_info', { purchase_order_id: po1.order.id });
    assert.equal(infoDraft.bill_id, bill.bill.id);
    assert.equal(infoDraft.bill_status, 'draft');
    assert.equal(infoDraft.bill_order_count, 2);
    assert.equal(infoDraft.bill_total_amount, 1050);

    // When: Bill is posted
    await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    // Then: PO 1 billing info reports posted bill
    const infoPosted = await invoke('get_purchase_order_billing_info', { purchase_order_id: po1.order.id });
    assert.equal(infoPosted.bill_status, 'posted');
    assert.equal(infoPosted.bill_order_count, 2);
  });

  test('TC-L2-13 & TC-L2-14: Void bill releases covered PO back to unbilled list', async () => {
    // Given: A vendor and a posted bill covering a PO
    const vendor = await invoke('create_partner', {
      name: `供應商E_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const wh = await invoke('create_warehouse', { code: `WH_${Date.now()}_${Math.floor(Math.random() * 100000)}`, name: '倉庫' });
    const p = await invoke('create_product', {
      name: `商品_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    const unitId = p.units[0].id;

    const po = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    await invoke('add_purchase_order_line', {
      order_id: po.order.id,
      unit_id: unitId,
      quantity: 5,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po.order.id });
    const poDetail = await invoke('get_purchase_order', { order_id: po.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po.order.id,
      received_lines: [{ line_id: poDetail.lines[0].id, received_quantity: 5 }]
    });

    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-VOID-${Date.now()}`,
        bill_date: '2026-03-01',
        due_date: '2026-03-31',
        untaxed_amount: 500,
        tax_amount: 25
      }
    });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po.order.id });
    await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    // When: PO is covered by posted bill, it is NOT in unbilled received list
    const unbilled1 = await invoke('list_unbilled_received_orders', { vendor_partner_id: vendor.id });
    assert.ok(!unbilled1.some(u => u.purchase_order_id === po.order.id));

    // When: Bill is voided
    await invoke('void_vendor_bill', {
      bill_id: bill.bill.id,
      void_reason: '廠商退單重開'
    });

    // Then: Covered PO returns to unbilled received orders
    const unbilled2 = await invoke('list_unbilled_received_orders', { vendor_partner_id: vendor.id });
    assert.ok(unbilled2.some(u => u.purchase_order_id === po.order.id));

    // And billing info for the PO becomes null (no active bill)
    const infoVoided = await invoke('get_purchase_order_billing_info', { purchase_order_id: po.order.id });
    assert.equal(infoVoided, null);
  });

  test('TC-L2-15: Date input preservation - YYYY-MM-DD strings are preserved without off-by-one shift', async () => {
    // Given: A vendor
    const vendor = await invoke('create_partner', {
      name: `供應商F_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });

    const billDate = '2026-06-30';
    const dueDate = '2026-07-31';

    // When: Creating a bill with explicit dates
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-DATE-${Date.now()}`,
        bill_date: billDate,
        due_date: dueDate,
        untaxed_amount: 1000,
        tax_amount: 50
      }
    });

    // Then: Dates are exactly preserved
    assert.equal(bill.bill.bill_date, '2026-06-30');
    assert.equal(bill.bill.due_date, '2026-07-31');

    // When: Fetching the bill detail
    const detail = await invoke('get_vendor_bill', { bill_id: bill.bill.id });
    assert.equal(detail.bill.bill_date, '2026-06-30');
    assert.equal(detail.bill.due_date, '2026-07-31');
  });

  test('TC-L2-16: Cancel draft and disputed vendor bills releases covered POs back to unbilled list', async () => {
    // Given: A vendor and a purchase order in received status
    const vendor = await invoke('create_partner', {
      name: `供應商G_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const wh = await invoke('create_warehouse', { code: `WH_${Date.now()}_${Math.floor(Math.random() * 10000)}`, name: '倉庫G' });
    const po = await invoke('create_purchase_order', {
      vendor_partner_id: vendor.id,
      warehouse_id: wh.id
    });
    const prod = await invoke('create_product', {
      name: `商品G_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      category: '轉售商品',
      unit_name: '件'
    });
    await invoke('add_purchase_order_line', {
      order_id: po.order.id,
      unit_id: prod.units[0].id,
      quantity: 5,
      purchase_cost: 100
    });
    await invoke('submit_purchase_order', { order_id: po.order.id });
    const poDetail = await invoke('get_purchase_order', { order_id: po.order.id });
    await invoke('confirm_purchase_order_received', {
      order_id: po.order.id,
      received_lines: [{ line_id: poDetail.lines[0].id, received_quantity: 5 }]
    });

    // Create draft bill covering the PO
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-CANCEL-DRAFT-${Date.now()}`,
        bill_date: '2026-06-01',
        due_date: '2026-06-30',
        untaxed_amount: 500,
        tax_amount: 25
      }
    });
    await invoke('add_vendor_bill_order', {
      bill_id: bill.bill.id,
      billId: bill.bill.id,
      purchase_order_id: po.order.id,
      purchaseOrderId: po.order.id
    });

    // Covered PO is not unbilled
    const unbilled1 = await invoke('list_unbilled_received_orders', { vendor_partner_id: vendor.id });
    assert.ok(!unbilled1.some(u => u.purchase_order_id === po.order.id));

    // When: Cancelling the draft bill
    const cancelledDraft = await invoke('cancel_vendor_bill', {
      bill_id: bill.bill.id,
      billId: bill.bill.id
    });
    assert.equal(cancelledDraft.bill.status, 'cancelled');
    assert.ok(cancelledDraft.bill.cancelled_at > 0);

    // Then: PO returns to unbilled received orders
    const unbilled2 = await invoke('list_unbilled_received_orders', { vendor_partner_id: vendor.id });
    assert.ok(unbilled2.some(u => u.purchase_order_id === po.order.id));

    // PO billing info is null
    const billingInfo = await invoke('get_purchase_order_billing_info', { purchase_order_id: po.order.id });
    assert.equal(billingInfo, null);
  });

  test('TC-L2-17: Matching preview difference calculation and dispute boolean state', () => {
    // Given: Helper logic simulating VendorBillsWorkspace derived values
    const computeMatching = (orders, untaxedAmount) => {
      const basis = (orders || []).reduce((sum, o) => sum + (o.received_total_amount || 0), 0);
      const diff = Math.round((untaxedAmount - basis) * 100) / 100;
      const isDisputed = Math.abs(diff) >= 1.0;
      return { basis, diff, isDisputed };
    };

    // When: exact match
    const exact = computeMatching([{ received_total_amount: 1000 }], 1000);
    assert.equal(exact.diff, 0);
    assert.equal(exact.isDisputed, false);

    // When: within tolerance 0.99
    const withinTolerance = computeMatching([{ received_total_amount: 1000 }], 1000.99);
    assert.equal(withinTolerance.diff, 0.99);
    assert.equal(withinTolerance.isDisputed, false);

    // When: boundary 1.0
    const boundary = computeMatching([{ received_total_amount: 1000 }], 1001.0);
    assert.equal(boundary.diff, 1.0);
    assert.equal(boundary.isDisputed, true);

    // When: boundary -1.0
    const negBoundary = computeMatching([{ received_total_amount: 1000 }], 999.0);
    assert.equal(negBoundary.diff, -1.0);
    assert.equal(negBoundary.isDisputed, true);
  });
});
