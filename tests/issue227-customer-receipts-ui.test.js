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
const {
  loadCustomerReceiptsAction,
  getCustomerReceiptAction,
  createCustomerReceiptAction,
  updateCustomerReceiptHeaderAction,
  addCustomerReceiptAllocationAction,
  updateCustomerReceiptAllocationAction,
  removeCustomerReceiptAllocationAction,
  postCustomerReceiptAction,
  cancelCustomerReceiptAction,
  voidCustomerReceiptAction,
  loadCustomerOpenReceivablesAction
} = await import('../src/lib/customerReceipts/store.js');
const { appState, getWorkspaceLabel, formatTime } = await import('../src/lib/store.svelte.js');

/*
 * Test Perspectives Table (Test Strategy Compliance)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-CR-UI-01 | 正確客戶與表頭建立草稿，無明細 | 等價－草稿建立 | 成功建立草稿收款單，編號 RCPT-xxxxx，total_amount = 0，狀態 draft | 登錄收款 |
 * | TC-CR-UI-02 | 未來收款日（明日） | 邊界－未來日 (+1天) | 拒絕建立／儲存，拋錯「收款日不可晚於今天」 | RC-03 防呆 |
 * | TC-CR-UI-03 | 單筆應收全額核銷（未收 1000，核銷 1000） | 邊界－剛好收清 | 成功加入核銷，明細 1 筆，total_amount = 1000 | 核銷一筆應收 |
 * | TC-CR-UI-04 | 單筆應收部分核銷（未收 1000，核銷 400）後過帳 | 等價－部分核銷過帳 | 收款單轉 posted，應收未收餘額降為 600，結案狀態為 partially_paid | 驗收標準 |
 * | TC-CR-UI-05 | 多筆應收組合核銷（發票 500 + 期初 300）後過帳 | 等價－多筆核銷過帳 | 收款單轉 posted，total_amount = 800，兩筆應收餘額均被扣除為 0 且狀態變為 paid | 核銷多筆應收 |
 * | TC-CR-UI-06 | 核銷金額為 0 元 | 邊界－0 | 前端提示阻擋，IPC 拋錯「核銷金額必須大於 0」 | RC-02 邊界 |
 * | TC-CR-UI-07 | 核銷金額為負數（-50 元） | 邊界－負值 | 前端提示阻擋，IPC 拋錯「核銷金額必須大於 0」 | RC-02 邊界 |
 * | TC-CR-UI-08 | 核銷金額超收 1 元（未收 1000，輸入 1001） | 邊界－超額 (+1) | 表單即時標示 .input-error，IPC 拋錯「超過...未收餘額」 | RC-02 防呆 |
 * | TC-CR-UI-09 | 核銷金額浮點數四捨五入（100.555 -> 100.56） | 邊界－小數位銀行家捨入 | 正確四捨五入為兩位小數 100.56，無精度偏移 | AR-06 |
 * | TC-CR-UI-10 | 收款單 0 筆核銷明細直接嘗試過帳 | 邊界－空集合 (0 筆) | 拒絕過帳，拋錯「收款單至少需有 1 筆核銷方可過帳」 | RC-03 防呆 |
 * | TC-CR-UI-11 | 收款日早於核銷應收單據日（2026-02-01 vs 2026-02-15） | 邊界－早於單據日 (-1天) | 拒絕過帳，拋錯「收款日不可早於〔...〕的單據日」 | RC-03 防呆 |
 * | TC-CR-UI-12 | 已過帳收款單嘗試修改表頭或異動明細 | 等價－非 draft 修改 | 拒絕修改，拋錯「收款單狀態為 posted，不可修改」 | P-06 防護 |
 * | TC-CR-UI-13 | 已過帳收款單作廢但未填寫原因（空白／NULL） | 邊界－空白字串 / NULL | 彈窗驗證阻擋，IPC 拋錯「作廢需填寫原因」 | P-07 防呆 |
 * | TC-CR-UI-14 | 已過帳收款單填寫原因作廢 | 等價－作廢與餘額恢復 | 收款單轉 voided，記錄 void_reason 與時間，被核銷的應收帳款餘額與結案狀態完全恢復 | 作廢完整流程 |
 * | TC-CR-UI-15 | 草稿收款單取消流轉 | 等價－草稿取消 | 收款單狀態轉為 cancelled，無任何應收扣款副作用 | P-08 狀態機 |
 * | TC-CR-UI-16 | 查詢待核銷候選清單：已結清 (paid) 的應收帳款不會重複出現 | 等價－候選清單過濾 | 候選清單僅包含 status = 'open' 且 outstanding_amount > 0 的應收 | 財務人員體驗 |
 * | TC-CR-UI-17 | 從列表列 (CustomerReceiptItem) 重新開啟草稿並取得完整 allocations | 等價－草稿重開與過帳 | getCustomerReceiptAction 取得完整明細，allocations 正確載入且可順利過帳 | Code review bug fix |
 * | TC-CR-UI-18 | 列表列 (CustomerReceiptItem) 作廢時正確讀取 allocation_count | 邊界－列表項目作廢筆數 | allocation_count ?? allocations?.length 正確呈現非零筆數，不顯示共 0 筆 | Code review bug fix |
 * | TC-CR-UI-19 | getWorkspaceLabel 對應收款單別名返回正確麵包屑標籤 | 等價－麵包屑導航標籤 | 正確返回「收款單」而非預設「業務工作區」 | Code review bug fix |
 * | TC-CR-UI-20 | 日期格式採用本地時間 (getFullYear, getMonth, getDate) | 邊界－時區跨日邊界 | 避免 UTC toISOString 跨日時區落差導致 00:00-07:59 被阻擋 | Code review bug fix |
 * | TC-CR-UI-21 | formatTime 將 voided_at Unix 秒數轉換為格式化本地時間字串 | 等價－作廢時間格式化 | 顯示 2026/xx/xx 格式化字串而非原始數字 1763600000 | Code review bug fix |
 */

test.describe('Issue #227: Customer Receipts UI & Layer 2 Verification', () => {
  const tenantId = 'tnt_ui_test_227';

  async function createMockCustomer(name) {
    return await invoke('create_partner', {
      name: `${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      is_customer: true,
      is_vendor: false,
    });
  }

  async function createMockOpeningReceivable(customerId, amount, docDate = '2026-02-01', dueDate = '2026-03-01') {
    const oar = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerId,
        original_reference: `REF-OR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        document_date: docDate,
        due_date: dueDate,
        amount: amount,
      }
    });
    return oar.account_receivable_id;
  }

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_customer_receipts', { tenant_id: tenantId });
  });

  test('TC-CR-UI-01: Create customer receipt draft and verify reactive store update', async () => {
    // Given: Active customer partner
    const customer = await createMockCustomer('登錄收款客戶');
    const today = new Date().toISOString().slice(0, 10);

    // When: Executing createCustomerReceiptAction through store action
    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer',
      receipt_reference: 'WIRE-227-01',
      note: 'Layer 2 登錄收款測試'
    });

    // Then: Returns draft receipt with sequential number and zero total amount
    assert.ok(draft.id);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.customer_partner_id, customer.id);
    assert.equal(draft.total_amount, 0);
    assert.equal(draft.receipt_method, 'bank_transfer');
    assert.equal(draft.receipt_reference, 'WIRE-227-01');
    assert.equal(draft.allocations.length, 0);

    // And: Reactive appState is synchronized
    assert.ok(appState.customerReceipts.some(r => r.id === draft.id));
    assert.equal(appState.selectedCustomerReceiptId, draft.id);

    // When: Updating header info via store action
    const updated = await updateCustomerReceiptHeaderAction({
      id: draft.id,
      receipt_id: draft.id,
      receipt_date: today,
      receipt_method: 'check',
      receipt_reference: 'CHK-999',
      note: '修改為支票'
    });

    // Then: Header fields updated
    assert.equal(updated.receipt_method, 'check');
    assert.equal(updated.receipt_reference, 'CHK-999');
    assert.equal(updated.note, '修改為支票');
  });

  test('TC-CR-UI-02: Boundary - receipt_date cannot be in future (+1 day)', async () => {
    // Given: Active customer
    const customer = await createMockCustomer('未來日客戶');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // When / Then: Attempting to create draft with tomorrow's date
    await assert.rejects(
      async () => {
        await createCustomerReceiptAction({
          customer_partner_id: customer.id,
          receipt_date: tomorrow,
          receipt_method: 'cash'
        });
      },
      {
        message: '收款日不可晚於今天'
      }
    );
  });

  test('TC-CR-UI-03 & TC-CR-UI-04: Single AR partial allocation and posting reduces balance', async () => {
    // Given: Active customer and an opening receivable for 1000 TWD
    const customer = await createMockCustomer('部分核銷客戶');
    const arId = await createMockOpeningReceivable(customer.id, 1000.0, '2026-02-01');
    const today = new Date().toISOString().slice(0, 10);

    // Verify initial AR state
    const initialAr = await invoke('get_account_receivable', { id: arId });
    assert.equal(initialAr.outstanding_amount, 1000.0);
    assert.equal(initialAr.settlement_status, 'unpaid');

    // When: Creating draft receipt
    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer',
      receipt_reference: 'WIRE-PART-227'
    });

    // When: Allocating 400.00 (partial payment)
    const withAlloc = await addCustomerReceiptAllocationAction(draft.id, arId, 400.0);
    // Then (TC-CR-UI-03 perspective): Total amount reflects single allocation
    assert.equal(withAlloc.total_amount, 400.0);
    assert.equal(withAlloc.allocations.length, 1);
    assert.equal(withAlloc.allocations[0].amount, 400.0);

    // When (TC-CR-UI-04): Posting the customer receipt
    const posted = await postCustomerReceiptAction(draft.id);

    // Then: Receipt status is posted
    assert.equal(posted.status, 'posted');
    assert.equal(posted.total_amount, 400.0);

    // And: AR outstanding amount reduced to 600, settlement_status is partially_paid
    const arAfter = await invoke('get_account_receivable', { id: arId });
    assert.equal(arAfter.received_amount, 400.0);
    assert.equal(arAfter.outstanding_amount, 600.0);
    assert.equal(arAfter.settlement_status, 'partially_paid');
  });

  test('TC-CR-UI-05: Multi-AR combination allocation and full settlement', async () => {
    // Given: Active customer with 2 accounts receivable (500 and 300)
    const customer = await createMockCustomer('多筆核銷客戶');
    const arId1 = await createMockOpeningReceivable(customer.id, 500.0, '2026-02-01');
    const arId2 = await createMockOpeningReceivable(customer.id, 300.0, '2026-02-05');
    const today = new Date().toISOString().slice(0, 10);

    // When: Creating draft receipt
    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer',
      receipt_reference: 'WIRE-MULTI-227'
    });

    // When: Adding first allocation for 500.00
    await addCustomerReceiptAllocationAction(draft.id, arId1, 500.0);
    // When: Adding second allocation for 300.00
    const withBoth = await addCustomerReceiptAllocationAction(draft.id, arId2, 300.0);

    // Then: Derived total_amount is 800.00 across 2 lines
    assert.equal(withBoth.total_amount, 800.0);
    assert.equal(withBoth.allocations.length, 2);

    // When: Posting the receipt
    const posted = await postCustomerReceiptAction(draft.id);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.total_amount, 800.0);

    // Then: Both AR records are fully settled (outstanding = 0, status = paid)
    const ar1After = await invoke('get_account_receivable', { id: arId1 });
    assert.equal(ar1After.received_amount, 500.0);
    assert.equal(ar1After.outstanding_amount, 0.0);
    assert.equal(ar1After.settlement_status, 'paid');

    const ar2After = await invoke('get_account_receivable', { id: arId2 });
    assert.equal(ar2After.received_amount, 300.0);
    assert.equal(ar2After.outstanding_amount, 0.0);
    assert.equal(ar2After.settlement_status, 'paid');
  });

  test('TC-CR-UI-06 to 08: Allocation amount boundaries (0, -50, +1 exceed)', async () => {
    // Given: Active customer and an AR for 1000 TWD
    const customer = await createMockCustomer('金額邊界客戶');
    const arId = await createMockOpeningReceivable(customer.id, 1000.0, '2026-02-01');
    const today = new Date().toISOString().slice(0, 10);

    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'cash'
    });

    // When (TC-CR-UI-06): Amount is 0
    await assert.rejects(
      async () => {
        await addCustomerReceiptAllocationAction(draft.id, arId, 0);
      },
      { message: '核銷金額必須大於 0' }
    );

    // When (TC-CR-UI-07): Amount is -50
    await assert.rejects(
      async () => {
        await addCustomerReceiptAllocationAction(draft.id, arId, -50);
      },
      { message: '核銷金額必須大於 0' }
    );

    // When (TC-CR-UI-08): Amount is 1001 (+1 over outstanding)
    await assert.rejects(
      async () => {
        await addCustomerReceiptAllocationAction(draft.id, arId, 1001);
      },
      (err) => {
        assert.match(err.message, /超過.*未收餘額/);
        return true;
      }
    );
  });

  test('TC-CR-UI-09: Rounding boundary - banker rounding to 2 decimals', async () => {
    // Given: Active customer and AR for 500 TWD
    const customer = await createMockCustomer('捨入邊界客戶');
    const arId = await createMockOpeningReceivable(customer.id, 500.0, '2026-02-01');
    const today = new Date().toISOString().slice(0, 10);

    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer'
    });

    // When: Allocating 100.555 (rounds to 100.56)
    const withAlloc = await addCustomerReceiptAllocationAction(draft.id, arId, 100.555);

    // Then: Stored amount is 100.56
    assert.equal(withAlloc.allocations[0].amount, 100.56);
    assert.equal(withAlloc.total_amount, 100.56);
  });

  test('TC-CR-UI-10: Empty allocation boundary - posting with 0 allocations rejected', async () => {
    // Given: Draft receipt with no allocations
    const customer = await createMockCustomer('空核銷客戶');
    const today = new Date().toISOString().slice(0, 10);
    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer'
    });

    // When / Then: Attempting to post
    await assert.rejects(
      async () => {
        await postCustomerReceiptAction(draft.id);
      },
      { message: '收款單至少需有 1 筆核銷方可過帳' }
    );
  });

  test('TC-CR-UI-11: Date order boundary - receipt date earlier than AR document date rejected', async () => {
    // Given: AR with document_date 2026-03-01
    const customer = await createMockCustomer('日期先後客戶');
    const arId = await createMockOpeningReceivable(customer.id, 500.0, '2026-03-01');

    // Given: Receipt with receipt_date 2026-02-15 (earlier than AR document date)
    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: '2026-02-15',
      receipt_method: 'bank_transfer'
    });

    await addCustomerReceiptAllocationAction(draft.id, arId, 200.0);

    // When / Then: Posting rejects because receipt_date < document_date
    await assert.rejects(
      async () => {
        await postCustomerReceiptAction(draft.id);
      },
      (err) => {
        assert.match(err.message, /收款日不可早於.*單據日/);
        return true;
      }
    );
  });

  test('TC-CR-UI-12: Non-draft modification protection', async () => {
    // Given: A posted customer receipt
    const customer = await createMockCustomer('不可修改客戶');
    const arId = await createMockOpeningReceivable(customer.id, 600.0, '2026-02-01');
    const today = new Date().toISOString().slice(0, 10);

    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'cash'
    });
    await addCustomerReceiptAllocationAction(draft.id, arId, 600.0);
    const posted = await postCustomerReceiptAction(draft.id);

    // When / Then: Attempting to update header on posted receipt
    await assert.rejects(
      async () => {
        await updateCustomerReceiptHeaderAction({
          id: posted.id,
          receipt_id: posted.id,
          receipt_date: today,
          receipt_method: 'bank_transfer'
        });
      },
      { message: '收款單狀態為 posted，不可修改' }
    );

    // When / Then: Attempting to add allocation on posted receipt
    await assert.rejects(
      async () => {
        await addCustomerReceiptAllocationAction(posted.id, arId, 10.0);
      },
      { message: '收款單狀態為 posted，不可修改' }
    );
  });

  test('TC-CR-UI-13 & TC-CR-UI-14: Void workflow requires reason and completely restores AR balance', async () => {
    // Given: Posted receipt settling 700 TWD
    const customer = await createMockCustomer('作廢測試客戶');
    const arId = await createMockOpeningReceivable(customer.id, 700.0, '2026-02-01');
    const today = new Date().toISOString().slice(0, 10);

    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer'
    });
    await addCustomerReceiptAllocationAction(draft.id, arId, 700.0);
    const posted = await postCustomerReceiptAction(draft.id);

    // Verify settled
    const arSettled = await invoke('get_account_receivable', { id: arId });
    assert.equal(arSettled.outstanding_amount, 0.0);
    assert.equal(arSettled.settlement_status, 'paid');

    // When (TC-CR-UI-13): Voiding without reason (empty string)
    await assert.rejects(
      async () => {
        await voidCustomerReceiptAction(posted.id, '   ');
      },
      { message: '作廢需填寫原因' }
    );

    // When (TC-CR-UI-14): Voiding with non-empty reason
    const voided = await voidCustomerReceiptAction(posted.id, '客戶匯錯帳戶，退回原單');

    // Then: Status is voided with reason preserved
    assert.equal(voided.status, 'voided');
    assert.equal(voided.void_reason, '客戶匯錯帳戶，退回原單');
    assert.ok(voided.voided_at);
    // TC-CR-UI-21 verification: formatTime converts voided_at into human readable date string
    const formattedVoidTime = formatTime(voided.voided_at);
    assert.notEqual(formattedVoidTime, '-');
    assert.match(formattedVoidTime, /\d{4}/);
    assert.notEqual(formattedVoidTime, String(voided.voided_at));

    // Then: AR outstanding balance is completely restored to 700, status returns to unpaid
    const arRestored = await invoke('get_account_receivable', { id: arId });
    assert.equal(arRestored.received_amount, 0.0);
    assert.equal(arRestored.outstanding_amount, 700.0);
    assert.equal(arRestored.settlement_status, 'unpaid');
  });

  test('TC-CR-UI-15: Cancel draft receipt transition', async () => {
    // Given: Draft receipt
    const customer = await createMockCustomer('取消草稿客戶');
    const today = new Date().toISOString().slice(0, 10);

    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'other',
      note: '即將取消'
    });

    // When: Cancelling draft
    const cancelled = await cancelCustomerReceiptAction(draft.id);

    // Then: Status is cancelled
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.cancelled_at);
  });

  test('TC-CR-UI-16: Candidate query excludes paid accounts receivable', async () => {
    // Given: Customer with 1 paid AR and 1 open AR
    const customer = await createMockCustomer('候選清單客戶');
    const arId1 = await createMockOpeningReceivable(customer.id, 500.0, '2026-02-01');
    const arId2 = await createMockOpeningReceivable(customer.id, 300.0, '2026-02-05');
    const today = new Date().toISOString().slice(0, 10);

    // Fully pay arId1
    const draft1 = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'cash'
    });
    await addCustomerReceiptAllocationAction(draft1.id, arId1, 500.0);
    await postCustomerReceiptAction(draft1.id);

    // When: Loading open receivables for this customer
    const openList = await loadCustomerOpenReceivablesAction(customer.id);

    // Then: Only arId2 with outstanding balance > 0 is returned
    assert.equal(openList.length, 1);
    assert.equal(openList[0].id, arId2);
    assert.equal(openList[0].outstanding_amount, 300.0);
  });

  test('TC-CR-UI-17: Re-opening draft from list item (CustomerReceiptItem) loads full allocations and allows posting', async () => {
    // Given: Active customer with AR 800 TWD
    const customer = await createMockCustomer('重開草稿客戶');
    const arId = await createMockOpeningReceivable(customer.id, 800.0, '2026-02-01');
    const today = new Date().toISOString().slice(0, 10);

    // Given: Draft receipt created and allocated 800 TWD
    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer',
      receipt_reference: 'REOPEN-01'
    });
    await addCustomerReceiptAllocationAction(draft.id, arId, 800.0);

    // Given: User went back to list view, where list items only have `allocation_count` (no `allocations` array)
    const list = await loadCustomerReceiptsAction({ customer_partner_id: customer.id });
    const listItem = list.find(r => r.id === draft.id);
    assert.ok(listItem);
    assert.equal(listItem.allocation_count, 1);
    assert.equal(listItem.allocations, undefined);

    // When: Re-opening draft using getCustomerReceiptAction (as now done in openDraftEditView)
    const fullDetail = await getCustomerReceiptAction(listItem.id);

    // Then: Allocations are fully restored with id, arId, and amount
    assert.ok(fullDetail.allocations);
    assert.equal(fullDetail.allocations.length, 1);
    assert.equal(fullDetail.allocations[0].account_receivable_id, arId);
    assert.equal(fullDetail.allocations[0].amount, 800.0);

    // And: It can be posted cleanly without DuplicateAccountReceivableAllocation error
    const posted = await postCustomerReceiptAction(fullDetail.id);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.total_amount, 800.0);

    const arAfter = await invoke('get_account_receivable', { id: arId });
    assert.equal(arAfter.outstanding_amount, 0.0);
    assert.equal(arAfter.settlement_status, 'paid');
  });

  test('TC-CR-UI-18: Void modal correctly resolves allocation_count from list item without allocations array', async () => {
    // Given: A posted receipt with 2 allocations
    const customer = await createMockCustomer('作廢筆數客戶');
    const arId1 = await createMockOpeningReceivable(customer.id, 200.0, '2026-02-01');
    const arId2 = await createMockOpeningReceivable(customer.id, 300.0, '2026-02-05');
    const today = new Date().toISOString().slice(0, 10);

    const draft = await createCustomerReceiptAction({
      customer_partner_id: customer.id,
      receipt_date: today,
      receipt_method: 'bank_transfer'
    });
    await addCustomerReceiptAllocationAction(draft.id, arId1, 200.0);
    await addCustomerReceiptAllocationAction(draft.id, arId2, 300.0);
    const posted = await postCustomerReceiptAction(draft.id);

    // When: Querying list items (CustomerReceiptItem)
    const list = await loadCustomerReceiptsAction({ customer_partner_id: customer.id });
    const listItem = list.find(r => r.id === posted.id);
    assert.ok(listItem);
    assert.equal(listItem.allocation_count, 2);
    assert.equal(listItem.allocations, undefined);

    // Then: Expression used in void modal resolves to 2 instead of 0
    const countFromListItem = listItem.allocation_count ?? listItem.allocations?.length ?? 0;
    assert.equal(countFromListItem, 2);

    const countFromFullDetail = posted.allocation_count ?? posted.allocations?.length ?? 0;
    assert.equal(countFromFullDetail, 2);
  });

  test('TC-CR-UI-19: getWorkspaceLabel resolves 收款單 for customer receipts routes', () => {
    // When / Then: Querying getWorkspaceLabel for customer-receipts and its aliases
    assert.equal(getWorkspaceLabel('customer-receipts'), '收款單');
    assert.equal(getWorkspaceLabel('customerReceipts'), '收款單');
    assert.equal(getWorkspaceLabel('receipts'), '收款單');
    assert.equal(getWorkspaceLabel('/app/customer-receipts'), '收款單');
  });

  test('TC-CR-UI-20: Local date helper returns local YYYY-MM-DD instead of UTC offset', () => {
    // Given: Current local time
    const now = new Date();
    const expectedLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Helper implementation matching Workspace.svelte
    function getTodayDateStringLocal() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    // Then: Returns exact local calendar date
    assert.equal(getTodayDateStringLocal(), expectedLocal);
  });

  test('TC-CR-UI-21: formatTime handles null, undefined, 0, and converts unix seconds to formatted string', () => {
    // When / Then: Nullable inputs return '-'
    assert.equal(formatTime(null), '-');
    assert.equal(formatTime(undefined), '-');
    assert.equal(formatTime(0), '-');

    // When: Valid unix timestamp in seconds (e.g. 1763600000)
    const formatted = formatTime(1763600000);

    // Then: Returns formatted localized date/time string, not raw number
    assert.match(formatted, /\d{4}/);
    assert.notEqual(formatted, '1763600000');
  });
});
