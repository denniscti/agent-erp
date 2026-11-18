import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

/*
 * Test Perspectives Table (Test Strategy Compliance)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-RC-JS-01 | 正確客戶與表頭參數 | 等價－正常草稿建立與查詢 | 成功建立草稿收款單，編號 RCPT-00001，total_amount = 0 | 正常情境 |
 * | TC-RC-JS-02 | 未來收款日 (2099-12-31) | 邊界－未來日 (+1 天以上) | 拋錯：收款日不可晚於今天 | RC-03 |
 * | TC-RC-JS-03 | 跨客戶應收單核銷 | 等價－跨客戶異常 | 拋錯：僅能核銷同一客戶的未作廢應收 | RC-01 |
 * | TC-RC-JS-04 | 重複加入相同應收單 | 邊界－重複值 | 拋錯：同一張收款單內同一筆應收只能出現一次 | RC-01 |
 * | TC-RC-JS-05 | 核銷金額 0 元 | 邊界－0 | 拋錯：核銷金額必須大於 0 | RC-02 |
 * | TC-RC-JS-06 | 核銷金額負數 (-1 元) | 邊界－負值 | 拋錯：核銷金額必須大於 0 | RC-02 |
 * | TC-RC-JS-07 | 核銷金額超收 1 元 (未收 1000，核銷 1001) | 邊界－超收 1 元 (+1) | 拋錯：核銷金額 1001 超過〔...〕未收餘額 1000 | RC-02 邊界 |
 * | TC-RC-JS-08 | 剛好收清 (未收 1000，核銷 1000) | 邊界－剛好收清 | 成功加入核銷，total_amount = 1000 | RC-02 邊界 |
 * | TC-RC-JS-09 | 0 筆核銷明細直接嘗試過帳 | 邊界－空集合 (0 筆) | 拋錯：收款單至少需有 1 筆核銷方可過帳 | RC-03 |
 * | TC-RC-JS-10 | 收款日早於應收單據日 (2026-01-01 vs 2026-01-10) | 邊界－早於單據日 (-1 天以上) | 拋錯：收款日不可早於〔...〕的單據日 | RC-03 |
 * | TC-RC-JS-11 | 並行草稿情境：兩張草稿均核銷 500 元，草稿 1 過帳後，草稿 2 過帳時因餘額不足被阻擋 | 等價－並行過帳搶單 | 拋錯：〔...〕未收餘額已變為 0，不足核銷 500 | RC-02 事務一致性 |
 * | TC-RC-JS-12 | 已過帳收款單嘗試修改表頭或異動明細 | 等價－非 draft 修改 | 拋錯：收款單狀態為 posted，不可修改 | P-06 |
 * | TC-RC-JS-13 | 已過帳收款單作廢但未填寫原因 (空白) | 邊界－空白字串 | 拋錯：作廢需填寫原因 | P-07 |
 * | TC-RC-JS-14 | 已過帳收款單填寫原因作廢，驗證應收帳款餘額與結案狀態即時恢復 | 等價－作廢恢復 | 狀態轉為 voided，應收帳款 outstanding_amount 完全恢復，settlement_status 變回 unpaid | 驗收標準 |
 */

test.describe('Issue #225: Customer Receipts (客戶收款單與核銷) Mock IPC & Layer 1 Verification', () => {
  const tenantId = 'tnt_rcpt_test';

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_customer_receipts', { tenant_id: tenantId });
  });

  test('TC-RC-JS-01: Create customer receipt draft and query details', async () => {
    // Given: Active customer partner
    const customer = await invoke('create_partner', {
      name: `RC Customer ${Date.now()}`,
      is_customer: true,
      is_vendor: false,
    });

    const today = new Date().toISOString().slice(0, 10);

    // When: Creating a customer receipt draft
    const receipt = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customer.id,
        receipt_date: today,
        receipt_method: 'bank_transfer',
        receipt_reference: 'WIRE-888',
        note: 'First receipt test',
      },
    });

    // Then: Returns draft receipt with RCPT-00001, total_amount = 0
    assert.ok(receipt.id.startsWith('rcpt_'));
    assert.equal(receipt.receipt_number, 'RCPT-00001');
    assert.equal(receipt.status, 'draft');
    assert.equal(receipt.total_amount, 0);
    assert.equal(receipt.receipt_method, 'bank_transfer');
    assert.equal(receipt.receipt_reference, 'WIRE-888');
    assert.equal(receipt.allocations.length, 0);

    // When: Querying via get_customer_receipt
    const fetched = await invoke('get_customer_receipt', { receipt_id: receipt.id });
    // Then: Matches created receipt
    assert.equal(fetched.id, receipt.id);
    assert.equal(fetched.customer_partner_id, customer.id);
  });

  test('TC-RC-JS-02: RC-03 receipt_date cannot be in future', async () => {
    // Given: Active customer
    const customer = await invoke('create_partner', {
      name: `Future Customer ${Date.now()}`,
      is_customer: true,
    });

    // When / Then: receipt_date in future throws error
    await assert.rejects(
      async () => {
        await invoke('create_customer_receipt', {
          input: {
            customer_partner_id: customer.id,
            receipt_date: '2099-12-31',
            receipt_method: 'cash',
          },
        });
      },
      {
        message: '收款日不可晚於今天',
      }
    );
  });

  test('TC-RC-JS-03 & 04: RC-01 partner mismatch and duplicate allocation guards', async () => {
    // Given: Customer A and Customer B
    const customerA = await invoke('create_partner', {
      name: `Customer A ${Date.now()}`,
      is_customer: true,
    });
    const customerB = await invoke('create_partner', {
      name: `Customer B ${Date.now()}`,
      is_customer: true,
    });

    const today = new Date().toISOString().slice(0, 10);

    // Given: AR belonging to Customer B
    const oarB = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerB.id,
        original_reference: `REF-B-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 800.0,
      },
    });
    const arIdB = oarB.account_receivable_id;

    // Given: AR belonging to Customer A
    const oarA = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerA.id,
        original_reference: `REF-A-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 500.0,
      },
    });
    const arIdA = oarA.account_receivable_id;

    // Given: Receipt for Customer A
    const rcpt = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customerA.id,
        receipt_date: today,
        receipt_method: 'bank_transfer',
      },
    });

    // When (TC-RC-JS-03): Attempting to allocate Customer B's AR to Customer A's receipt
    // Then: Throws RC-01 error
    await assert.rejects(
      async () => {
        await invoke('add_customer_receipt_allocation', {
          receipt_id: rcpt.id,
          account_receivable_id: arIdB,
          amount: 200.0,
        });
      },
      {
        message: '僅能核銷同一客戶的未作廢應收',
      }
    );

    // When: Allocating Customer A's AR
    await invoke('add_customer_receipt_allocation', {
      receipt_id: rcpt.id,
      account_receivable_id: arIdA,
      amount: 200.0,
    });

    // When (TC-RC-JS-04): Attempting to allocate Customer A's AR again to the same receipt
    // Then: Throws DuplicateAccountReceivableAllocation error
    await assert.rejects(
      async () => {
        await invoke('add_customer_receipt_allocation', {
          receipt_id: rcpt.id,
          account_receivable_id: arIdA,
          amount: 100.0,
        });
      },
      {
        message: '同一張收款單內同一筆應收只能出現一次',
      }
    );
  });

  test('TC-RC-JS-05 to 08: RC-02 amount boundaries (0, -1, +1 exceed, exact full pay)', async () => {
    // Given: Customer and opening receivable for 1000 TWD
    const customer = await invoke('create_partner', {
      name: `Boundary Customer ${Date.now()}`,
      is_customer: true,
    });

    const today = new Date().toISOString().slice(0, 10);
    const oar = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customer.id,
        original_reference: `INV-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 1000.0,
      },
    });
    const arId = oar.account_receivable_id;
    assert.ok(arId);

    const receipt = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customer.id,
        receipt_date: today,
        receipt_method: 'bank_transfer',
      },
    });

    // When (TC-RC-JS-05): Allocating 0 amount
    // Then: Rejected with InvalidAllocationAmount
    await assert.rejects(
      async () => {
        await invoke('add_customer_receipt_allocation', {
          receipt_id: receipt.id,
          account_receivable_id: arId,
          amount: 0,
        });
      },
      { message: '核銷金額必須大於 0' }
    );

    // When (TC-RC-JS-06): Allocating -1 amount
    // Then: Rejected with InvalidAllocationAmount
    await assert.rejects(
      async () => {
        await invoke('add_customer_receipt_allocation', {
          receipt_id: receipt.id,
          account_receivable_id: arId,
          amount: -1,
        });
      },
      { message: '核銷金額必須大於 0' }
    );

    // When (TC-RC-JS-07): Allocating 1001 (+1 exceed)
    // Then: Throws AllocationAmountExceedsOutstanding
    await assert.rejects(
      async () => {
        await invoke('add_customer_receipt_allocation', {
          receipt_id: receipt.id,
          account_receivable_id: arId,
          amount: 1001.0,
        });
      },
      (err) => {
        assert.match(err.message, /超過.*未收餘額/);
        return true;
      }
    );

    // When (TC-RC-JS-08): Allocating exactly 1000.0 (full payment)
    const updated = await invoke('add_customer_receipt_allocation', {
      receipt_id: receipt.id,
      account_receivable_id: arId,
      amount: 1000.0,
    });
    // Then: Total amount is 1000
    assert.equal(updated.total_amount, 1000.0);
    assert.equal(updated.allocations.length, 1);
  });

  test('TC-RC-JS-09 & 10: RC-03 zero allocations check and earlier document date guard', async () => {
    // Given: Customer and AR with document_date = 2026-06-15
    const customer = await invoke('create_partner', {
      name: `Date Guard Customer ${Date.now()}`,
      is_customer: true,
    });

    const oar = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customer.id,
        original_reference: `INV-DATE-${Date.now()}`,
        document_date: '2026-06-15',
        due_date: '2026-06-30',
        amount: 600.0,
      },
    });
    const arId = oar.account_receivable_id;

    // Given: Receipt with no allocations
    const emptyReceipt = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customer.id,
        receipt_date: '2026-06-20',
        receipt_method: 'cash',
      },
    });

    // When (TC-RC-JS-09): Attempting to post empty receipt
    // Then: Rejected with NoAllocationsToPost
    await assert.rejects(
      async () => {
        await invoke('post_customer_receipt', { receipt_id: emptyReceipt.id });
      },
      {
        message: '收款單至少需有 1 筆核銷方可過帳',
      }
    );

    // Given: Receipt with receipt_date earlier than AR document date (2026-06-10 vs 2026-06-15)
    const earlyReceipt = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customer.id,
        receipt_date: '2026-06-10',
        receipt_method: 'cash',
      },
    });
    await invoke('add_customer_receipt_allocation', {
      receipt_id: earlyReceipt.id,
      account_receivable_id: arId,
      amount: 300.0,
    });

    // When (TC-RC-JS-10): Attempting to post early receipt
    // Then: Rejected with ReceiptDateEarlierThanDocumentDate
    await assert.rejects(
      async () => {
        await invoke('post_customer_receipt', { receipt_id: earlyReceipt.id });
      },
      (err) => {
        assert.match(err.message, /收款日不可早於.*單據日/);
        return true;
      }
    );
  });

  test('TC-RC-JS-11: Concurrency - 2 drafts for same AR; first posts, second blocked by RC-02', async () => {
    // Given: Active customer and AR for 500
    const customer = await invoke('create_partner', {
      name: `Conc Customer ${Date.now()}`,
      is_customer: true,
    });

    const today = new Date().toISOString().slice(0, 10);
    const oar = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customer.id,
        original_reference: `CONC-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 500.0,
      },
    });
    const arId = oar.account_receivable_id;

    // Given: Draft 1 and Draft 2 both allocate 500
    const r1 = await invoke('create_customer_receipt', {
      input: { customer_partner_id: customer.id, receipt_date: today, receipt_method: 'cash' },
    });
    await invoke('add_customer_receipt_allocation', {
      receipt_id: r1.id,
      account_receivable_id: arId,
      amount: 500.0,
    });

    const r2 = await invoke('create_customer_receipt', {
      input: { customer_partner_id: customer.id, receipt_date: today, receipt_method: 'check' },
    });
    await invoke('add_customer_receipt_allocation', {
      receipt_id: r2.id,
      account_receivable_id: arId,
      amount: 500.0,
    });

    // When: Draft 1 posts
    const posted1 = await invoke('post_customer_receipt', { receipt_id: r1.id });
    // Then: Status is posted
    assert.equal(posted1.status, 'posted');

    // When (TC-RC-JS-11): Draft 2 attempts to post
    // Then: Blocked by RC-02 because outstanding has changed to 0
    await assert.rejects(
      async () => {
        await invoke('post_customer_receipt', { receipt_id: r2.id });
      },
      (err) => {
        assert.match(err.message, /未收餘額已變為 0，不足核銷 500/);
        return true;
      }
    );
  });

  test('TC-RC-JS-12 to 14: Modify guard, void reason validation, and balance restoration', async () => {
    // Given: Customer and AR for 800
    const customer = await invoke('create_partner', {
      name: `Void Rest Customer ${Date.now()}`,
      is_customer: true,
    });

    const today = new Date().toISOString().slice(0, 10);
    const oar = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customer.id,
        original_reference: `VREST-${Date.now()}`,
        document_date: '2026-01-01',
        due_date: '2026-01-10',
        amount: 800.0,
      },
    });
    const arId = oar.account_receivable_id;

    const r = await invoke('create_customer_receipt', {
      input: { customer_partner_id: customer.id, receipt_date: today, receipt_method: 'cash' },
    });
    await invoke('add_customer_receipt_allocation', {
      receipt_id: r.id,
      account_receivable_id: arId,
      amount: 800.0,
    });

    // When: Posting receipt
    await invoke('post_customer_receipt', { receipt_id: r.id });

    // Then: AR is fully paid
    const arPaid = await invoke('get_account_receivable', { id: arId });
    assert.equal(arPaid.received_amount, 800.0);
    assert.equal(arPaid.outstanding_amount, 0.0);
    assert.equal(arPaid.settlement_status, 'paid');

    // When (TC-RC-JS-12): Attempting to modify posted receipt
    // Then: Blocked by P-06
    await assert.rejects(
      async () => {
        await invoke('update_customer_receipt_header', {
          input: {
            id: r.id,
            receipt_date: today,
            receipt_method: 'bank_transfer',
          },
        });
      },
      {
        message: '收款單狀態為 posted，不可修改',
      }
    );

    // When (TC-RC-JS-13): Voiding without reason
    // Then: Blocked by P-07
    await assert.rejects(
      async () => {
        await invoke('void_customer_receipt', {
          receipt_id: r.id,
          void_reason: '   ',
        });
      },
      {
        message: '作廢需填寫原因',
      }
    );

    // When (TC-RC-JS-14): Voiding with reason
    const voided = await invoke('void_customer_receipt', {
      receipt_id: r.id,
      void_reason: '客戶支票退票作廢',
    });
    // Then: Receipt status is voided
    assert.equal(voided.status, 'voided');
    assert.equal(voided.void_reason, '客戶支票退票作廢');

    // Then: AR balance is fully restored to 800 outstanding, settlement_status unpaid
    const arRestored = await invoke('get_account_receivable', { id: arId });
    assert.equal(arRestored.received_amount, 0.0);
    assert.equal(arRestored.outstanding_amount, 800.0);
    assert.equal(arRestored.settlement_status, 'unpaid');
  });
});

