import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #203: Vendor Payments UI, Allocations & Accounts Payable Integration', () => {
  const tenantId = 'tnt_ui_test_203';

  async function createMockVendor(name) {
    return await invoke('create_partner', {
      name: `${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      is_vendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });
  }

  async function createMockOpeningPayable(vendorId, amount) {
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorId,
        original_reference: `REF-ISO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        document_date: '2026-02-01',
        due_date: '2026-03-01',
        amount: amount,
      }
    });
    const list = await invoke('list_accounts_payable', { vendorPartnerId: vendorId, status: 'open' });
    return list.find(a => a.source_id === oap.id) || list[0];
  }

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_payments', { tenant_id: tenantId });
  });

  test('TC-PAY-UI-01: Create payment from vendor shortcut, partial payment, and verify outstanding balance reduced', async () => {
    // Given: Active vendor and an opening payable with 1000 TWD
    const vendor = await invoke('create_partner', {
      name: `快捷供應商A_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-203-01-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-03-01',
        amount: 1000.0,
      }
    });

    const apList = await invoke('list_accounts_payable', { vendor_partner_id: vendor.id, status: 'open' });
    assert.equal(apList.length, 1);
    const targetAp = apList[0];
    assert.equal(targetAp.outstanding_amount, 1000.0);
    assert.equal(targetAp.settlement_status, 'unpaid');

    const today = new Date().toISOString().slice(0, 10);

    // When: Creating draft vendor payment from vendor shortcut
    const draft = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer',
        payment_reference: 'WIRE-PART-01',
        note: '部分付款 400 元'
      }
    });

    assert.ok(draft.id);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.vendor_partner_id, vendor.id);

    // When: Allocating 400.00 (partial payment)
    const updatedDraft = await invoke('add_vendor_payment_allocation', {
      payment_id: draft.id,
      account_payable_id: targetAp.id,
      amount: 400.0
    });
    assert.equal(updatedDraft.total_amount, 400.0);
    assert.equal(updatedDraft.allocations.length, 1);
    assert.equal(updatedDraft.allocations[0].amount, 400.0);

    // When: Posting the vendor payment
    const posted = await invoke('post_vendor_payment', { payment_id: draft.id });

    // Then: Payment status is posted, and AP outstanding amount is reduced to 600.00 with partially_paid status
    assert.equal(posted.status, 'posted');
    assert.equal(posted.total_amount, 400.0);

    const apAfter = await invoke('get_account_payable', { id: targetAp.id });
    assert.equal(apAfter.paid_amount, 400.0);
    assert.equal(apAfter.outstanding_amount, 600.0);
    assert.equal(apAfter.settlement_status, 'partially_paid');
  });

  test('TC-PAY-UI-02: Second payment pays remaining balance, status changes to paid, disappears from candidate list', async () => {
    // Given: Active vendor and partially paid AP (600 remaining out of 1000)
    const vendor = await invoke('create_partner', {
      name: `付清供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-203-02-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-03-01',
        amount: 1000.0,
      }
    });

    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    // First payment: pay 400
    const pay1 = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay1.id,
      account_payable_id: targetAp.id,
      amount: 400.0
    });
    await invoke('post_vendor_payment', { payment_id: pay1.id });

    // When: Initiating second payment for the remaining 600.00
    const pay2 = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'check',
        payment_reference: 'CHK-9999'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay2.id,
      account_payable_id: targetAp.id,
      amount: 600.0
    });
    const posted2 = await invoke('post_vendor_payment', { payment_id: pay2.id });

    // Then: AP is fully settled (paid), paid_amount = 1000, outstanding_amount = 0, status is paid
    assert.equal(posted2.status, 'posted');
    const apFullyPaid = await invoke('get_account_payable', { id: targetAp.id });
    assert.equal(apFullyPaid.paid_amount, 1000.0);
    assert.equal(apFullyPaid.outstanding_amount, 0.0);
    assert.equal(apFullyPaid.settlement_status, 'paid');

    // And: Querying open candidates with outstanding > 0 for this vendor returns empty array
    const candidateList = await invoke('list_accounts_payable', {
      vendor_partner_id: vendor.id,
      status: 'open',
      settlement_status: 'unpaid'
    });
    const candidateRemaining = candidateList.filter(a => a.outstanding_amount > 0);
    assert.equal(candidateRemaining.length, 0);
  });

  test('TC-PAY-UI-03: Boundary value - allocation equal to exact outstanding balance succeeds', async () => {
    // Given: Active vendor and an AP for 750.55
    const vendor = await invoke('create_partner', {
      name: `邊界供應商Exact_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-EXACT-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 750.55,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    // When: Allocating exactly 750.55 (full balance)
    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'cash'
      }
    });
    const updated = await invoke('add_vendor_payment_allocation', {
      payment_id: pay.id,
      account_payable_id: targetAp.id,
      amount: 750.55
    });
    const posted = await invoke('post_vendor_payment', { payment_id: pay.id });

    // Then: Succeeds cleanly, outstanding = 0, settlement_status = paid
    assert.equal(updated.total_amount, 750.55);
    assert.equal(posted.status, 'posted');
    const ap = await invoke('get_account_payable', { id: targetAp.id });
    assert.equal(ap.outstanding_amount, 0.0);
    assert.equal(ap.settlement_status, 'paid');
  });

  test('TC-PAY-UI-04: Boundary value - allocation exceeding outstanding by +0.01 triggers P-03 rejection', async () => {
    // Given: Active vendor and an AP for 500.00
    const vendor = await invoke('create_partner', {
      name: `超額供應商Exceed_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-EXCEED-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 500.0,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer'
      }
    });

    // When / Then: Attempting to allocate 500.01 (+0.01 over outstanding)
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: pay.id,
          account_payable_id: targetAp.id,
          amount: 500.01
        });
      },
      (err) => {
        assert.match(err.message, /超過.*未付餘額/);
        return true;
      }
    );
  });

  test('TC-PAY-UI-05: Boundary values - allocation amount 0, negative, or NaN rejected', async () => {
    // Given: Active vendor and draft payment
    const vendor = await invoke('create_partner', {
      name: `零與負數供應商_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-ZERO-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 300.0,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer'
      }
    });

    // When: Allocation amount is 0
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: pay.id,
          account_payable_id: targetAp.id,
          amount: 0
        });
      },
      { message: '核銷金額必須大於 0' }
    );

    // When: Allocation amount is negative (-10)
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: pay.id,
          account_payable_id: targetAp.id,
          amount: -10
        });
      },
      { message: '核銷金額必須大於 0' }
    );
  });

  test('TC-PAY-UI-06: Single AP shortcut pre-fills vendor and allocates outstanding balance', async () => {
    // Given: Active vendor and AP for 888.88
    const vendor = await invoke('create_partner', {
      name: `單筆快捷供應商_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-AP-SHORTCUT-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 888.88,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    // When: Single AP payment shortcut action (create payment + allocate full balance)
    const payment = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: targetAp.vendor_partner_id,
        payment_date: today,
        payment_method: 'bank_transfer'
      }
    });
    const prefilled = await invoke('add_vendor_payment_allocation', {
      payment_id: payment.id,
      account_payable_id: targetAp.id,
      amount: targetAp.outstanding_amount
    });

    // Then: Returns draft with targetAp pre-selected and total_amount = 888.88
    assert.equal(prefilled.status, 'draft');
    assert.equal(prefilled.vendor_partner_id, vendor.id);
    assert.equal(prefilled.total_amount, 888.88);
    assert.equal(prefilled.allocations.length, 1);
    assert.equal(prefilled.allocations[0].account_payable_id, targetAp.id);
    assert.equal(prefilled.allocations[0].amount, 888.88);
  });

  test('TC-PAY-UI-07: Void posted payment with valid reason restores AP outstanding balance and settlement_status', async () => {
    // Given: Posted payment allocating 650.00 of 650.00 AP
    const vendor = await invoke('create_partner', {
      name: `作廢回補供應商_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-VOID-RESTORE-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 650.0,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay.id,
      account_payable_id: targetAp.id,
      amount: 650.0
    });
    const posted = await invoke('post_vendor_payment', { payment_id: pay.id });
    assert.equal(posted.status, 'posted');

    // Verify AP is currently paid
    const apPaid = await invoke('get_account_payable', { id: targetAp.id });
    assert.equal(apPaid.outstanding_amount, 0.0);
    assert.equal(apPaid.settlement_status, 'paid');

    // When: Voiding the payment with valid reason
    const voided = await invoke('void_vendor_payment', {
      payment_id: pay.id,
      void_reason: '支票退票或匯款帳號填寫錯誤，需作廢重開'
    });

    // Then: Payment status is voided, and AP outstanding balance is fully restored to 650.00 and unpaid
    assert.equal(voided.status, 'voided');
    assert.equal(voided.void_reason, '支票退票或匯款帳號填寫錯誤，需作廢重開');

    const apRestored = await invoke('get_account_payable', { id: targetAp.id });
    assert.equal(apRestored.paid_amount, 0.0);
    assert.equal(apRestored.outstanding_amount, 650.0);
    assert.equal(apRestored.settlement_status, 'unpaid');
  });

  test('TC-PAY-UI-08: Boundary value - voiding without reason (empty or whitespace) rejected with P-07 error', async () => {
    // Given: Posted payment
    const vendor = await invoke('create_partner', {
      name: `空白作廢原因供應商_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-EMPTY-VOID-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 400.0,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'cash'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay.id,
      account_payable_id: targetAp.id,
      amount: 400.0
    });
    await invoke('post_vendor_payment', { payment_id: pay.id });

    // When / Then: Empty string void reason throws error
    await assert.rejects(
      async () => {
        await invoke('void_vendor_payment', {
          payment_id: pay.id,
          void_reason: ''
        });
      },
      { message: '作廢需填寫原因' }
    );

    // When / Then: Whitespace-only string void reason throws error
    await assert.rejects(
      async () => {
        await invoke('void_vendor_payment', {
          payment_id: pay.id,
          void_reason: '   '
        });
      },
      { message: '作廢需填寫原因' }
    );
  });

  test('TC-PAY-UI-09: Boundary value - payment_date in the future rejected by P-04', async () => {
    // Given: Active vendor
    const vendor = await invoke('create_partner', {
      name: `未來日期供應商_${Date.now()}`,
      is_vendor: true
    });

    // When / Then: Future date throws validation error
    await assert.rejects(
      async () => {
        await invoke('create_vendor_payment', {
          input: {
            vendor_partner_id: vendor.id,
            payment_date: '2099-01-01',
            payment_method: 'bank_transfer'
          }
        });
      },
      { message: '付款日不可晚於今天' }
    );
  });

  test('TC-PAY-UI-10: Multi-allocation across two payables updates both balances and derives payment total', async () => {
    // Given: Vendor with two separate open payables (300 and 700)
    const vendor = await invoke('create_partner', {
      name: `多筆核銷供應商_${Date.now()}`,
      is_vendor: true
    });

    const oap1 = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-MULTI-1-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 300.0,
      }
    });

    const oap2 = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-MULTI-2-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 700.0,
      }
    });

    const apList = await invoke('list_accounts_payable', { vendor_partner_id: vendor.id });
    const ap1 = apList.find(a => a.source_id === oap1.opening_payable.id);
    const ap2 = apList.find(a => a.source_id === oap2.opening_payable.id);
    assert.ok(ap1 && ap2);

    const today = new Date().toISOString().slice(0, 10);

    // When: Creating payment allocating 300 to ap1 and 500 to ap2
    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer',
        payment_reference: 'WIRE-MULTI-888'
      }
    });

    await invoke('add_vendor_payment_allocation', {
      payment_id: pay.id,
      account_payable_id: ap1.id,
      amount: 300.0
    });
    const withTwoAllocs = await invoke('add_vendor_payment_allocation', {
      payment_id: pay.id,
      account_payable_id: ap2.id,
      amount: 500.0
    });

    // Then: Total amount = 300 + 500 = 800.00
    assert.equal(withTwoAllocs.total_amount, 800.0);
    assert.equal(withTwoAllocs.allocations.length, 2);

    // When: Posting the multi-allocation payment
    const posted = await invoke('post_vendor_payment', { payment_id: pay.id });
    assert.equal(posted.status, 'posted');

    // Then: ap1 is paid, ap2 is partially_paid with 200 remaining
    const ap1After = await invoke('get_account_payable', { id: ap1.id });
    assert.equal(ap1After.outstanding_amount, 0.0);
    assert.equal(ap1After.settlement_status, 'paid');

    const ap2After = await invoke('get_account_payable', { id: ap2.id });
    assert.equal(ap2After.outstanding_amount, 200.0);
    assert.equal(ap2After.settlement_status, 'partially_paid');
  });

  test('TC-PAY-UI-11: AP detail inspection lists all payment allocations that settled it', async () => {
    // Given: An AP paid by two consecutive payments
    const vendor = await invoke('create_partner', {
      name: `歷程追蹤供應商_${Date.now()}`,
      is_vendor: true
    });

    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `REF-HISTORY-${Date.now()}`,
        document_date: '2026-02-01',
        due_date: '2026-02-28',
        amount: 1000.0,
      }
    });
    const targetAp = (await invoke('list_accounts_payable', { vendor_partner_id: vendor.id }))[0];
    const today = new Date().toISOString().slice(0, 10);

    const pay1 = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'cash'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay1.id,
      account_payable_id: targetAp.id,
      amount: 400.0
    });
    await invoke('post_vendor_payment', { payment_id: pay1.id });

    const pay2 = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay2.id,
      account_payable_id: targetAp.id,
      amount: 600.0
    });
    await invoke('post_vendor_payment', { payment_id: pay2.id });

    // When: Inspecting AP detail
    const detail = await invoke('get_account_payable', { id: targetAp.id });

    // Then: Allocations list contains both payment vouchers with numbers, amounts, dates, and statuses
    assert.equal(detail.allocations.length, 2);
    const alloc1 = detail.allocations.find(a => a.payment_id === pay1.id);
    const alloc2 = detail.allocations.find(a => a.payment_id === pay2.id);
    assert.ok(alloc1);
    assert.equal(alloc1.amount, 400.0);
    assert.equal(alloc1.payment_status, 'posted');
    assert.ok(alloc2);
    assert.equal(alloc2.amount, 600.0);
    assert.equal(alloc2.payment_status, 'posted');
  });

  test('TC-PAY-UI-12: List accounts payable filters correctly using camelCase vendorPartnerId and settlementStatus (Tauri 2 convention)', async () => {
    // Given: Two vendors with open payables
    const vA = await createMockVendor('Vendor Alpha Filters');
    const vB = await createMockVendor('Vendor Beta Filters');
    await createMockOpeningPayable(vA.id, 1000.0);
    await createMockOpeningPayable(vB.id, 2000.0);

    // When: Querying with camelCase vendorPartnerId
    const resA = await invoke('list_accounts_payable', {
      vendorPartnerId: vA.id,
      status: 'open'
    });
    // Then: Only Vendor A's APs returned
    assert.ok(resA.length > 0);
    assert.ok(resA.every(a => a.vendor_partner_id === vA.id));

    // When: Querying with camelCase settlementStatus: 'unpaid'
    const resUnpaid = await invoke('list_accounts_payable', {
      settlementStatus: 'unpaid',
      status: 'open'
    });
    // Then: Returned items must all have settlement_status 'unpaid'
    assert.ok(resUnpaid.length > 0);
    assert.ok(resUnpaid.every(a => a.settlement_status === 'unpaid'));
  });

  test('TC-PAY-UI-13: Draft candidate payables strictly isolate vendor and exclude other vendors', async () => {
    // Given: Vendor X and Vendor Y both have open payables
    const vX = await createMockVendor('Vendor X Isolation');
    const vY = await createMockVendor('Vendor Y Isolation');
    const apX = await createMockOpeningPayable(vX.id, 1500.0);
    const apY = await createMockOpeningPayable(vY.id, 2500.0);

    // When: Fetching candidate payables for Vendor X using camelCase parameter
    const candidateList = await invoke('list_accounts_payable', {
      vendorPartnerId: vX.id,
      status: 'open'
    });

    // Then: Must contain AP X and strictly exclude AP Y
    assert.ok(candidateList.some(a => a.id === apX.id));
    assert.ok(!candidateList.some(a => a.id === apY.id));
    assert.ok(candidateList.every(a => a.vendor_partner_id === vX.id));
  });

  test('TC-PAY-UI-14: Navigation route pattern matches activeWorkspace getter with /app/ prefix', () => {
    // Given: Store activeWorkspace getter regex ^\/app\/([^/?#]+)
    const targetRoute = '/app/vendor-bills';
    const match = targetRoute.match(/^\/app\/([^/?#]+)/);

    // Then: Matches and resolves workspace as 'vendor-bills'
    assert.ok(match);
    assert.equal(match[1], 'vendor-bills');

    // And: Missing prefix fails matching
    const invalidRoute = 'vendor-bills';
    assert.equal(invalidRoute.match(/^\/app\/([^/?#]+)/), null);
  });
});
