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
const vendorBillsStore = await import('../src/lib/vendorBills/store.js');
const openingPayablesStore = await import('../src/lib/openingPayables/store.js');
const accountsPayableStore = await import('../src/lib/accountsPayable/store.js');
const vendorPaymentsStore = await import('../src/lib/vendorPayments/store.js');

test.describe('Issue #247: Payables Domain Modularization & Lifecycle Verification', () => {
  const tenantId = 'tnt_test_payables_lifecycle_247';

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_bills', { tenant_id: tenantId });
    await invoke('reset_mock_opening_payables', { tenant_id: tenantId });
    await invoke('reset_mock_accounts_payable', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_payments', { tenant_id: tenantId });
  });

  test('TC-PAY-LIFE-N-01: End-to-end lifecycle (Bill -> Dispute -> Accept & Post -> Opening Payable -> Payment -> Statement)', async () => {
    // Given: Active vendor with Net 30 terms, a warehouse, and a received purchase order
    const vendor = await invoke('create_partner', {
      name: `供應商247_A_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });

    const warehouse = await invoke('create_warehouse', {
      code: `WH247_${Math.floor(Math.random() * 1000)}`,
      name: '應付測試倉'
    });

    const product = await invoke('create_product', {
      name: `物料247_${Date.now()}`,
      category: 'resale',
      unit_name: '件'
    });
    const variantId = product.variants[0].id;
    const unitId = product.units[0].id;

    // Create PO and mark as received
    const po = await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id,
      warehouseId: warehouse.id,
      orderDate: '2026-03-01'
    });
    await invoke('add_purchase_order_line', {
      orderId: po.order.id,
      unitId: unitId,
      quantity: 10,
      purchaseCost: 100
    });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    // When 1: Register vendor bill with difference (PO received 1000, bill untaxed 1050, tax 50 -> total 1100, diff +50)
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-247-${Date.now()}`,
        bill_date: '2026-03-05',
        untaxed_amount: 1050.0,
        tax_amount: 50.0
      }
    });
    await invoke('add_vendor_bill_order', {
      bill_id: bill.bill.id,
      purchase_order_id: po.order.id
    });

    // Post bill: Difference of 50.0 exceeds tolerance threshold (>= 1.0), so status becomes disputed
    const postedDisputed = await invoke('post_vendor_bill', { bill_id: bill.bill.id });
    assert.equal(postedDisputed.bill.status, 'disputed');
    assert.equal(postedDisputed.bill.basis_amount, 1000.0);
    assert.equal(postedDisputed.bill.difference_amount, 50.0);

    // When 2: Accept difference with justification note and post to establish accounts payable
    const acceptedBill = await invoke('accept_vendor_bill_difference', {
      bill_id: bill.bill.id,
      difference_note: '供應商通知因原物料上漲調整價格，主管已核准'
    });
    assert.equal(acceptedBill.bill.status, 'posted');
    assert.ok(acceptedBill.payable);
    assert.equal(acceptedBill.payable.amount, 1100.0);
    assert.equal(acceptedBill.payable.outstanding_amount, 1100.0);

    // When 3: Register opening payable for vendor (date prior to first PO: 2026-02-20 < 2026-03-01)
    const oapResult = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-OPEN-${Date.now()}`,
        document_date: '2026-02-20',
        due_date: '2026-03-20',
        amount: 500.0
      }
    });
    assert.equal(oapResult.opening_payable.status, 'open');

    // Verify accounts payable list has both APs (1100 + 500 = 1600 total)
    const apList = await invoke('list_accounts_payable', { vendor_partner_id: vendor.id });
    assert.equal(apList.length, 2);
    const billAp = apList.find(a => a.source_type === 'vendor_bill');
    const openAp = apList.find(a => a.source_type === 'opening_balance');
    assert.ok(billAp);
    assert.ok(openAp);

    // When 4: Create vendor payment and settle both APs (1100 full + 300 partial = 1400 total payment)
    const payment = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: '2026-03-10',
        payment_method: 'bank_transfer',
        payment_reference: 'WIRE-20260310-001'
      }
    });

    await invoke('add_vendor_payment_allocation', {
      payment_id: payment.id,
      account_payable_id: billAp.id,
      amount: 1100.0
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: payment.id,
      account_payable_id: openAp.id,
      amount: 300.0
    });

    // Post payment
    const postedPayment = await invoke('post_vendor_payment', { payment_id: payment.id });
    assert.equal(postedPayment.status, 'posted');
    assert.equal(postedPayment.total_amount, 1400.0);

    // Then: Bill AP is fully settled (paid), Opening AP is partially paid (partially_paid)
    const billApAfter = await invoke('get_account_payable', { id: billAp.id });
    assert.equal(billApAfter.settlement_status, 'paid');
    assert.equal(billApAfter.paid_amount, 1100.0);
    assert.equal(billApAfter.outstanding_amount, 0.0);

    const openApAfter = await invoke('get_account_payable', { id: openAp.id });
    assert.equal(openApAfter.settlement_status, 'partially_paid');
    assert.equal(openApAfter.paid_amount, 300.0);
    assert.equal(openApAfter.outstanding_amount, 200.0);

    // When 5: Query vendor statement across period (2026-02-01 to 2026-03-31)
    const statement = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-02-01',
      end_date: '2026-03-31'
    });

    // Then: Statement totals and closing balance reflect exact transactions
    assert.equal(statement.opening_balance, 0.0);
    assert.equal(statement.current_payables_total, 1600.0); // 1100 bill + 500 opening
    assert.equal(statement.current_payments_total, 1400.0);
    assert.equal(statement.closing_balance, 200.0); // 1600 - 1400 = 200 remaining

    // Verify current payables are properly sorted ascending by document_date
    assert.equal(statement.payables.length, 2);
    assert.equal(statement.payables[0].document_date, '2026-02-20');
    assert.equal(statement.payables[1].document_date, '2026-03-05');
  });

  test('TC-PAY-LIFE-N-02: Direct match vendor bill (|difference| < 1.0) posts immediately without dispute', async () => {
    // Given: Active vendor and received PO with 500 TWD total
    const vendor = await invoke('create_partner', {
      name: `供應商247_B_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const warehouse = await invoke('create_warehouse', {
      code: `WH247_B_${Math.floor(Math.random() * 1000)}`,
      name: '直過倉'
    });
    const product = await invoke('create_product', {
      name: `商品247_B_${Date.now()}`,
      category: 'resale',
      unit_name: '個'
    });

    const po = await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id,
      warehouseId: warehouse.id,
      orderDate: '2026-03-01'
    });
    await invoke('add_purchase_order_line', {
      orderId: po.order.id,
      unitId: product.units[0].id,
      quantity: 5,
      purchaseCost: 100
    });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    // When: Create bill with exact match (untaxed 500, tax 25)
    const bill = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-EXACT-${Date.now()}`,
        bill_date: '2026-03-05',
        untaxed_amount: 500.0,
        tax_amount: 25.0
      }
    });
    await invoke('add_vendor_bill_order', {
      bill_id: bill.bill.id,
      purchase_order_id: po.order.id
    });

    const postedBill = await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    // Then: Posts directly to posted and generates AP
    assert.equal(postedBill.bill.status, 'posted');
    assert.equal(postedBill.bill.difference_amount, 0.0);
    assert.ok(postedBill.payable);
    assert.equal(postedBill.payable.amount, 525.0);
  });

  test('TC-PAY-LIFE-N-03: Modular exports verification across all 4 domain modules', () => {
    // Given: The 4 new domain modules
    // When: Inspecting function signatures
    // Then: All expected store actions are properly exported
    assert.equal(typeof vendorBillsStore.fetchVendorBills, 'function');
    assert.equal(typeof vendorBillsStore.createVendorBillAction, 'function');
    assert.equal(typeof vendorBillsStore.postVendorBillAction, 'function');
    assert.equal(typeof vendorBillsStore.acceptVendorBillDifferenceAction, 'function');

    assert.equal(typeof openingPayablesStore.loadOpeningPayablesAction, 'function');
    assert.equal(typeof openingPayablesStore.createOpeningPayableAction, 'function');
    assert.equal(typeof openingPayablesStore.voidOpeningPayableAction, 'function');

    assert.equal(typeof accountsPayableStore.queryAccountsPayableAction, 'function');
    assert.equal(typeof accountsPayableStore.loadAccountsPayableAction, 'function');
    assert.equal(typeof accountsPayableStore.getAccountPayableAction, 'function');
    assert.equal(typeof accountsPayableStore.loadPayablesAgingAction, 'function');
    assert.equal(typeof accountsPayableStore.loadVendorStatementAction, 'function');

    assert.equal(typeof vendorPaymentsStore.loadVendorPaymentsAction, 'function');
    assert.equal(typeof vendorPaymentsStore.createVendorPaymentAction, 'function');
    assert.equal(typeof vendorPaymentsStore.addVendorPaymentAllocationAction, 'function');
    assert.equal(typeof vendorPaymentsStore.postVendorPaymentAction, 'function');
  });

  test('TC-PAY-LIFE-E-01: Voiding vendor bill blocked when AP has posted payment allocation (AP-04 guard)', async () => {
    // Given: Vendor, bill posted with AP, and posted payment allocation
    const vendor = await invoke('create_partner', {
      name: `供應商247_C_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const warehouse = await invoke('create_warehouse', { code: `WH247_C_${Math.floor(Math.random() * 1000)}`, name: '作廢防護倉' });
    const product = await invoke('create_product', { name: `商品247_C_${Date.now()}`, category: 'resale', unit_name: '件' });

    const po = await invoke('create_purchase_order', { vendorPartnerId: vendor.id, warehouseId: warehouse.id, orderDate: '2026-03-01' });
    await invoke('add_purchase_order_line', { orderId: po.order.id, unitId: product.units[0].id, quantity: 1, purchaseCost: 100 });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    const bill = await invoke('create_vendor_bill', {
      input: { vendor_partner_id: vendor.id, vendor_invoice_number: `INV-247-C-${Date.now()}`, bill_date: '2026-03-05', untaxed_amount: 100.0, tax_amount: 5.0 }
    });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po.order.id });
    const postedBill = await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    const payment = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: '2026-03-10', payment_method: 'cash' }
    });
    await invoke('add_vendor_payment_allocation', { payment_id: payment.id, account_payable_id: postedBill.payable.id, amount: 50.0 });
    await invoke('post_vendor_payment', { payment_id: payment.id });

    // When: Attempting to void the vendor bill
    // Then: Rejected because AP has active posted allocation
    await assert.rejects(
      async () => {
        await invoke('void_vendor_bill', { bill_id: bill.bill.id, void_reason: '作廢測試' });
      },
      /此請款單已有付款核銷/
    );
  });

  test('TC-PAY-LIFE-E-02: Voiding opening payable blocked when AP has posted payment allocation', async () => {
    // Given: Vendor and opening payable with a posted payment allocation
    const vendor = await invoke('create_partner', {
      name: `供應商247_D_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-247-D-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-03-01',
        amount: 300.0
      }
    });

    const payment = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: '2026-02-15', payment_method: 'bank_transfer' }
    });
    await invoke('add_vendor_payment_allocation', { payment_id: payment.id, account_payable_id: oap.account_payable_id, amount: 150.0 });
    await invoke('post_vendor_payment', { payment_id: payment.id });

    // When: Attempting to void the opening payable
    // Then: Rejected with posted allocation error
    await assert.rejects(
      async () => {
        await invoke('void_opening_payable', { id: oap.opening_payable.id, void_reason: '期初作廢測試' });
      },
      /此期初應付已有付款核銷/
    );
  });

  test('TC-PAY-LIFE-E-03: P-03 Boundary: Allocation exceeding outstanding by +0.01 is rejected', async () => {
    // Given: Opening payable with outstanding 200.00
    const vendor = await invoke('create_partner', {
      name: `供應商247_E_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-247-E-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-03-01',
        amount: 200.0
      }
    });

    const payment = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: '2026-02-15', payment_method: 'bank_transfer' }
    });

    // When: Attempting allocation of 200.01
    // Then: Throws P-03 rejection
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: payment.id,
          account_payable_id: oap.account_payable_id,
          amount: 200.01
        });
      },
      /超過.*未付餘額/
    );
  });

  test('TC-PAY-LIFE-B-01: Boundary value: Allocation amount = 0.0 is rejected', async () => {
    // Given: Draft payment and open AP
    const vendor = await invoke('create_partner', {
      name: `供應商247_F_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const oap = await invoke('create_opening_payable', {
      input: { vendor_partner_id: vendor.id, original_reference: `REF-F-${Date.now()}`, document_date: '2026-02-01', due_date: '2026-03-01', amount: 100.0 }
    });
    const payment = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: '2026-02-15', payment_method: 'cash' }
    });

    // When: Amount is 0
    // Then: Validation error
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: payment.id,
          account_payable_id: oap.account_payable_id,
          amount: 0.0
        });
      },
      /核銷金額必須大於 0/
    );
  });

  test('TC-PAY-LIFE-B-02: Boundary value: Allocation amount negative (-0.01) is rejected', async () => {
    // Given: Draft payment and open AP
    const vendor = await invoke('create_partner', {
      name: `供應商247_G_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const oap = await invoke('create_opening_payable', {
      input: { vendor_partner_id: vendor.id, original_reference: `REF-G-${Date.now()}`, document_date: '2026-02-01', due_date: '2026-03-01', amount: 100.0 }
    });
    const payment = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: '2026-02-15', payment_method: 'cash' }
    });

    // When: Amount is -0.01
    // Then: Validation error
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: payment.id,
          account_payable_id: oap.account_payable_id,
          amount: -0.01
        });
      },
      /核銷金額必須大於 0/
    );
  });

  test('TC-PAY-LIFE-B-03: Boundary value: Void opening payable with empty or whitespace reason is rejected', async () => {
    // Given: Open opening payable
    const vendor = await invoke('create_partner', {
      name: `供應商247_H_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const oap = await invoke('create_opening_payable', {
      input: { vendor_partner_id: vendor.id, original_reference: `REF-H-${Date.now()}`, document_date: '2026-02-01', due_date: '2026-03-01', amount: 100.0 }
    });

    // When: Void with empty reason
    // Then: Throws reason required error
    await assert.rejects(
      async () => {
        await invoke('void_opening_payable', { id: oap.opening_payable.id, void_reason: '' });
      },
      /原因必填/
    );

    await assert.rejects(
      async () => {
        await invoke('void_opening_payable', { id: oap.opening_payable.id, void_reason: '   ' });
      },
      /原因必填/
    );
  });

  test('TC-PAY-LIFE-B-04: Boundary value: Void vendor bill with empty or whitespace reason is rejected', async () => {
    // Given: Posted vendor bill
    const vendor = await invoke('create_partner', {
      name: `供應商247_I_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });
    const warehouse = await invoke('create_warehouse', { code: `WH247_I_${Math.floor(Math.random() * 1000)}`, name: '驗證倉' });
    const product = await invoke('create_product', { name: `商品247_I_${Date.now()}`, category: 'resale', unit_name: '件' });

    const po = await invoke('create_purchase_order', { vendorPartnerId: vendor.id, warehouseId: warehouse.id, orderDate: '2026-03-01' });
    await invoke('add_purchase_order_line', { orderId: po.order.id, unitId: product.units[0].id, quantity: 1, purchaseCost: 50 });
    await invoke('submit_purchase_order', { orderId: po.order.id });
    await invoke('confirm_purchase_order_received', { orderId: po.order.id });

    const bill = await invoke('create_vendor_bill', {
      input: { vendor_partner_id: vendor.id, vendor_invoice_number: `INV-247-I-${Date.now()}`, bill_date: '2026-03-05', untaxed_amount: 50.0, tax_amount: 0.0 }
    });
    await invoke('add_vendor_bill_order', { bill_id: bill.bill.id, purchase_order_id: po.order.id });
    await invoke('post_vendor_bill', { bill_id: bill.bill.id });

    // When: Void with empty or whitespace reason
    // Then: Throws reason required error
    await assert.rejects(
      async () => {
        await invoke('void_vendor_bill', { bill_id: bill.bill.id, void_reason: '' });
      },
      /作廢原因為必填/
    );

    await assert.rejects(
      async () => {
        await invoke('void_vendor_bill', { bill_id: bill.bill.id, void_reason: '   ' });
      },
      /作廢原因為必填/
    );
  });
});
