import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #201: Vendor Payments (付款單核心與核銷) Mock IPC & Layer 1 Verification', () => {
  const tenantId = 'tnt_vp_test';

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_payments', { tenant_id: tenantId });
  });

  test('TC-PAY-JS-01: Create vendor payment draft and query details', async () => {
    // Given: Active tenant and valid vendor partner
    const vendor = await invoke('create_partner', {
      name: `VP Vendor ${Date.now()}`,
      is_vendor: true,
      is_customer: false,
    });

    const today = new Date().toISOString().slice(0, 10);

    // When: Creating a vendor payment
    const payment = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer',
        payment_reference: 'REF-888',
        note: 'First payment test',
      },
    });

    // Then: Returns draft payment with PAY-00001, total_amount = 0
    assert.ok(payment.id.startsWith('pay_'));
    assert.equal(payment.payment_number, 'PAY-00001');
    assert.equal(payment.status, 'draft');
    assert.equal(payment.total_amount, 0);
    assert.equal(payment.payment_method, 'bank_transfer');
    assert.equal(payment.payment_reference, 'REF-888');
    assert.equal(payment.allocations.length, 0);

    // When: Querying via get_vendor_payment
    const fetched = await invoke('get_vendor_payment', { payment_id: payment.id });
    // Then: Matches created payment
    assert.equal(fetched.id, payment.id);
    assert.equal(fetched.vendor_partner_id, vendor.id);
  });

  test('TC-PAY-JS-02: P-04 payment_date cannot be in future', async () => {
    // Given: Active vendor
    const vendor = await invoke('create_partner', {
      name: `Future Vendor ${Date.now()}`,
      is_vendor: true,
    });

    // When / Then: payment_date in future throws error
    await assert.rejects(
      async () => {
        await invoke('create_vendor_payment', {
          input: {
            vendor_partner_id: vendor.id,
            payment_date: '2099-12-31',
            payment_method: 'cash',
          },
        });
      },
      {
        message: '付款日不可晚於今天',
      }
    );
  });

  test('TC-PAY-JS-03: Add allocation, P-03 boundaries (full pay vs +0.01 exceed)', async () => {
    // Given: Active vendor and opening payable for 1000 TWD
    const vendor = await invoke('create_partner', {
      name: `Boundary Vendor ${Date.now()}`,
      is_vendor: true,
    });

    const today = new Date().toISOString().slice(0, 10);
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `INV-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 1000.0,
      },
    });
    const apId = oap.account_payable_id;
    assert.ok(apId);

    const payment = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: today,
        payment_method: 'bank_transfer',
      },
    });

    // When: Trying to allocate 1000.01 (+0.01 exceed)
    // Then: Throws AllocationAmountExceedsOutstanding
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: payment.id,
          account_payable_id: apId,
          amount: 1000.01,
        });
      },
      (err) => {
        assert.match(err.message, /超過.*未付餘額/);
        return true;
      }
    );

    // When: Trying to allocate 0 or negative
    await assert.rejects(
      async () => {
        await invoke('add_vendor_payment_allocation', {
          payment_id: payment.id,
          account_payable_id: apId,
          amount: 0,
        });
      },
      { message: '核銷金額必須大於 0' }
    );

    // When: Allocating exactly 1000.0 (full payment)
    const updated = await invoke('add_vendor_payment_allocation', {
      payment_id: payment.id,
      account_payable_id: apId,
      amount: 1000.0,
    });
    // Then: Total amount is 1000
    assert.equal(updated.total_amount, 1000.0);
    assert.equal(updated.allocations.length, 1);
  });

  test('TC-PAY-JS-04: Concurrency - 2 drafts for same AP; first posts, second blocked by P-05', async () => {
    // Given: Active vendor and AP for 500
    const vendor = await invoke('create_partner', {
      name: `Conc Vendor ${Date.now()}`,
      is_vendor: true,
    });

    const today = new Date().toISOString().slice(0, 10);
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `CONC-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 500.0,
      },
    });
    const apId = oap.account_payable_id;

    // Given: Draft 1 and Draft 2 both allocate 500
    const p1 = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: today, payment_method: 'cash' },
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: p1.id,
      account_payable_id: apId,
      amount: 500.0,
    });

    const p2 = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: today, payment_method: 'check' },
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: p2.id,
      account_payable_id: apId,
      amount: 500.0,
    });

    // When: Draft 1 posts
    const posted1 = await invoke('post_vendor_payment', { payment_id: p1.id });
    // Then: Status is posted
    assert.equal(posted1.status, 'posted');

    // When: Draft 2 attempts to post
    // Then: Blocked by P-05 because outstanding has changed to 0
    await assert.rejects(
      async () => {
        await invoke('post_vendor_payment', { payment_id: p2.id });
      },
      (err) => {
        assert.match(err.message, /未付餘額已變為 0，不足核銷 500/);
        return true;
      }
    );
  });

  test('TC-PAY-JS-05: Voiding posted payment restores AP outstanding balance and settlement_status', async () => {
    // Given: Vendor and AP for 800
    const vendor = await invoke('create_partner', {
      name: `Void Rest Vendor ${Date.now()}`,
      is_vendor: true,
    });

    const today = new Date().toISOString().slice(0, 10);
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: `VREST-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 800.0,
      },
    });
    const apId = oap.account_payable_id;

    const p = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: today, payment_method: 'cash' },
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: p.id,
      account_payable_id: apId,
      amount: 500.0,
    });
    await invoke('post_vendor_payment', { payment_id: p.id });

    // Verify AP partially paid
    const apAfterPost = await invoke('get_account_payable', { id: apId });
    assert.equal(apAfterPost.paid_amount, 500.0);
    assert.equal(apAfterPost.outstanding_amount, 300.0);
    assert.equal(apAfterPost.settlement_status, 'partially_paid');

    // When: Voiding without reason
    await assert.rejects(
      async () => {
        await invoke('void_vendor_payment', { payment_id: p.id, void_reason: '' });
      },
      { message: '作廢需填寫原因' }
    );

    // When: Voiding with valid reason
    const voided = await invoke('void_vendor_payment', {
      payment_id: p.id,
      void_reason: '核銷錯誤需作廢',
    });
    // Then: Status is voided
    assert.equal(voided.status, 'voided');
    assert.equal(voided.void_reason, '核銷錯誤需作廢');

    // Verify AP outstanding restored to 800 and unpaid
    const apAfterVoid = await invoke('get_account_payable', { id: apId });
    assert.equal(apAfterVoid.paid_amount, 0.0);
    assert.equal(apAfterVoid.outstanding_amount, 800.0);
    assert.equal(apAfterVoid.settlement_status, 'unpaid');
  });

  test('TC-PAY-JS-06: State machine transitions and idempotency guards', async () => {
    // Given: Draft payment
    const vendor = await invoke('create_partner', {
      name: `State Vendor ${Date.now()}`,
      is_vendor: true,
    });
    const today = new Date().toISOString().slice(0, 10);
    const p = await invoke('create_vendor_payment', {
      input: { vendor_partner_id: vendor.id, payment_date: today, payment_method: 'cash' },
    });

    // When: Illegal transition draft -> voided
    await assert.rejects(
      async () => {
        await invoke('void_vendor_payment', { payment_id: p.id, void_reason: 'test' });
      },
      { message: '無效的狀態轉換：不可從 draft 轉換至 voided' }
    );

    // When: Cancel draft
    const cancelled = await invoke('cancel_vendor_payment', { payment_id: p.id });
    assert.equal(cancelled.status, 'cancelled');

    // When: Double cancel
    await assert.rejects(
      async () => {
        await invoke('cancel_vendor_payment', { payment_id: p.id });
      },
      { message: '無效的狀態轉換：不可從 cancelled 轉換至 cancelled' }
    );
  });
});

