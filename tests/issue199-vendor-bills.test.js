import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #199: Vendor Bills Mock IPC & Core Behavior', () => {
  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    await invoke('reset_mock_vendor_bills', { tenant_id: 'tnt_mock_1' });
  });

  test('TC-VB-JS-01: list_vendor_bills empty returns empty array', async () => {
    // Given: Active tenant with reset bills
    // When: Querying list_vendor_bills
    const list = await invoke('list_vendor_bills', {});

    // Then: Returns empty array
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 0);
  });

  test('TC-VB-JS-02: get_vendor_bill missing ID throws error', async () => {
    // When / Then: Missing ID throws descriptive error
    await assert.rejects(
      async () => {
        await invoke('get_vendor_bill', {});
      },
      {
        message: '缺少請款單 ID (id 或 bill_id)'
      }
    );
  });

  test('TC-VB-JS-03: get_vendor_bill nonexistent bill throws not found error', async () => {
    // When / Then: Nonexistent bill throws
    await assert.rejects(
      async () => {
        await invoke('get_vendor_bill', { id: 'bill_nonexistent' });
      },
      {
        message: '找不到指定的請款單'
      }
    );
  });

  test('TC-VB-JS-04: create_vendor_bill creates draft bill and auto-calculates due date', async () => {
    // Given: Seeded vendor with payment terms Net 30
    const vendor = await invoke('create_partner', {
      name: `宏碁電腦供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });

    // When: Creating a vendor bill without manual due date
    const detail = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: 'INV-ACER-001',
        bill_date: '2026-01-10',
        untaxed_amount: 10000,
        tax_amount: 500,
        note: '採購伺服器請款'
      }
    });

    // Then: Bill is created in draft, total_amount derived, due_date calculated as 2026-02-09
    assert.equal(detail.bill.status, 'draft');
    assert.equal(detail.bill.bill_number, 'BILL-00001');
    assert.equal(detail.bill.vendor_partner_id, vendor.id);
    assert.equal(detail.bill.vendor_invoice_number, 'INV-ACER-001');
    assert.equal(detail.bill.untaxed_amount, 10000);
    assert.equal(detail.bill.tax_amount, 500);
    assert.equal(detail.bill.total_amount, 10500);
    assert.equal(detail.bill.due_date, '2026-02-09');
    assert.equal(detail.orders.length, 0);
  });

  test('TC-VB-JS-05: update_vendor_bill_header updates fields in draft', async () => {
    // Given: A draft bill
    const vendor = await invoke('create_partner', {
      name: `華碩電腦供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const created = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: 'INV-ASUS-ORIG',
        bill_date: '2026-01-01',
        due_date: '2026-01-31',
        untaxed_amount: 5000,
        tax_amount: 250
      }
    });

    // When: Updating header
    const updated = await invoke('update_vendor_bill_header', {
      input: {
        bill_id: created.bill.id,
        vendor_invoice_number: 'INV-ASUS-NEW',
        bill_date: '2026-01-05',
        due_date: '2026-02-15',
        untaxed_amount: 6000,
        tax_amount: 300,
        note: '金額修正'
      }
    });

    // Then: Fields updated
    assert.equal(updated.bill.vendor_invoice_number, 'INV-ASUS-NEW');
    assert.equal(updated.bill.untaxed_amount, 6000);
    assert.equal(updated.bill.tax_amount, 300);
    assert.equal(updated.bill.total_amount, 6300);
    assert.equal(updated.bill.due_date, '2026-02-15');
    assert.equal(updated.bill.note, '金額修正');
  });

  test('TC-VB-JS-06: post_vendor_bill matching diff < 1.0 creates accounts_payable', async () => {
    // Given: Vendor and received purchase order
    const vendor = await invoke('create_partner', {
      name: `聯想供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const po = await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id
    });
    // Add line: 10 * 100 = 1000
    await invoke('add_purchase_order_line', {
      orderId: po.order.id,
      unitId: 'unit_mock_1',
      quantity: 10,
      purchaseCost: 100
    });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    // When: Bill has untaxed = 1000.50 (diff = 0.50 < 1.0)
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: 'INV-MATCH-JS',
        bill_date: '2026-01-10',
        due_date: '2026-02-10',
        untaxed_amount: 1000.50,
        tax_amount: 50
      }
    });
    await invoke('add_vendor_bill_order', {
      bill_id: bill.bill.id,
      purchase_order_id: po.order.id
    });
    const posted = await invoke('post_vendor_bill', {
      bill_id: bill.bill.id
    });

    // Then: Bill status is posted, difference is 0.5
    assert.equal(posted.bill.status, 'posted');
    assert.equal(posted.bill.basis_amount, 1000);
    assert.equal(posted.bill.difference_amount, 0.5);

    // And: Accounts payable is created with amount 1050.5
    const apList = await invoke('list_accounts_payable', {
      vendor_partner_id: vendor.id
    });
    assert.equal(apList.length, 1);
    assert.equal(apList[0].amount, 1050.5);
    assert.equal(apList[0].external_reference, 'INV-MATCH-JS');
  });

  test('TC-VB-JS-07: post_vendor_bill mismatch >= 1.0 turns disputed, accept difference posts', async () => {
    // Given: Vendor and received purchase order with total 1000
    const vendor = await invoke('create_partner', {
      name: `技嘉供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const po = await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id
    });
    await invoke('add_purchase_order_line', {
      orderId: po.order.id,
      unitId: 'unit_mock_1',
      quantity: 10,
      purchaseCost: 100
    });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    // When: Bill untaxed = 1100 (diff = 100 >= 1.0)
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: 'INV-DISP-JS',
        bill_date: '2026-01-10',
        due_date: '2026-02-10',
        untaxed_amount: 1100,
        tax_amount: 55
      }
    });
    await invoke('add_vendor_bill_order', {
      bill_id: bill.bill.id,
      purchase_order_id: po.order.id
    });
    const disputed = await invoke('post_vendor_bill', {
      bill_id: bill.bill.id
    });

    // Then: Bill is disputed, no AP created yet
    assert.equal(disputed.bill.status, 'disputed');
    assert.equal(disputed.bill.basis_amount, 1000);
    assert.equal(disputed.bill.difference_amount, 100);

    const apListBefore = await invoke('list_accounts_payable', {
      vendor_partner_id: vendor.id
    });
    assert.equal(apListBefore.length, 0);

    // When: Accepting difference
    const accepted = await invoke('accept_vendor_bill_difference', {
      bill_id: bill.bill.id,
      difference_note: '同意補貼運費 100 元'
    });

    // Then: Bill becomes posted, records note, AP created with total 1155
    assert.equal(accepted.bill.status, 'posted');
    assert.equal(accepted.bill.difference_note, '同意補貼運費 100 元');

    const apListAfter = await invoke('list_accounts_payable', {
      vendor_partner_id: vendor.id
    });
    assert.equal(apListAfter.length, 1);
    assert.equal(apListAfter[0].amount, 1155);
  });

  test('TC-VB-JS-08: void_vendor_bill voids bill and AP, frees up PO', async () => {
    // Given: Posted bill
    const vendor = await invoke('create_partner', {
      name: `微星供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isVendor: true
    });
    const po = await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id
    });
    await invoke('add_purchase_order_line', {
      orderId: po.order.id,
      unitId: 'unit_mock_1',
      quantity: 5,
      purchaseCost: 200
    });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: 'INV-VOID-JS',
        bill_date: '2026-01-10',
        due_date: '2026-02-10',
        untaxed_amount: 1000,
        tax_amount: 50
      }
    });
    await invoke('add_vendor_bill_order', {
      bill_id: bill.bill.id,
      purchase_order_id: po.order.id
    });
    await invoke('post_vendor_bill', {
      bill_id: bill.bill.id
    });

    // When: Voiding the posted bill
    const voided = await invoke('void_vendor_bill', {
      bill_id: bill.bill.id,
      void_reason: '發票作廢重開'
    });

    // Then: Bill status is voided
    assert.equal(voided.bill.status, 'voided');
    assert.equal(voided.bill.void_reason, '發票作廢重開');

    // And: AP status is voided
    const apList = await invoke('list_accounts_payable', {
      vendor_partner_id: vendor.id
    });
    assert.equal(apList[0].status, 'voided');

    // And: PO is unbilled again
    const unbilled = await invoke('list_unbilled_received_orders', {
      vendor_partner_id: vendor.id
    });
    assert.equal(unbilled.length, 1);
    assert.equal(unbilled[0].purchase_order_id, po.order.id);
  });
});
