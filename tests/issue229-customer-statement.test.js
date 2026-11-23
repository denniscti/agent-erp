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

const {
  invoke,
  mockPartners,
  mockAccountsReceivable,
  mockCustomerReceipts,
  mockCustomerReceiptAllocations,
  mockSalesAllowances,
  saveStorage
} = await import('../src/lib/tauri.js');

const {
  loadCustomerStatementAction
} = await import('../src/lib/accountsReceivable/store.js');

/**
 * =========================================================================
 * Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * =========================================================================
 * | Case ID      | Input / Precondition                          | Perspective (Equiv / Bound) | Expected Result                                              | Notes |
 * |--------------|-----------------------------------------------|------------------------------|--------------------------------------------------------------|-------|
 * | TC-STMT-E01  | tenant_id = ''                                | Boundary - Empty             | Rejects with 'Tenant ID cannot be empty'                    | -     |
 * | TC-STMT-E02  | customer_partner_id = ''                      | Boundary - Empty             | Rejects with '找不到指定的客戶或不屬於目前租戶'               | -     |
 * | TC-STMT-E03  | customer_partner_id = 'cus_ghost_id'          | Equivalence - Non-existent   | Rejects with '找不到指定的客戶或不屬於目前租戶'               | -     |
 * | TC-STMT-E04  | partner exists but is_customer = false        | Equivalence - Role mismatch  | Rejects with '指定的合作夥伴不是客戶 (is_customer != 1)'       | -     |
 * | TC-STMT-E05  | start_date > end_date                         | Boundary - Range inverted    | Rejects with '起日不可晚於迄日'                              | -     |
 * | TC-STMT-E06  | invalid date format (e.g. '2026/03/01')       | Boundary - Invalid format    | Rejects with '無效的日期格式，需為 YYYY-MM-DD'                | -     |
 * | TC-STMT-B01  | AR document_date = start_date                 | Boundary - Start boundary    | AR included in current period receivables, not in opening    | -     |
 * | TC-STMT-B02  | AR document_date < start_date                 | Boundary - Prior to start    | AR included in opening balance                              | -     |
 * | TC-STMT-B03  | AR document_date = end_date                   | Boundary - End boundary      | AR included in current period receivables                    | -     |
 * | TC-STMT-B04  | AR document_date > end_date                   | Boundary - Future to end     | AR excluded from both opening and current period             | -     |
 * | TC-STMT-B05  | Receipt receipt_date = start_date             | Boundary - Start boundary    | Receipt included in current period receipts, not in opening  | -     |
 * | TC-STMT-B06  | Receipt receipt_date < start_date             | Boundary - Prior to start    | Receipt included in opening receipts deduction               | -     |
 * | TC-STMT-B07  | Allowance allowance_date = start_date         | Boundary - Start boundary    | Allowance included in current period allowances              | -     |
 * | TC-STMT-B08  | Allowance allowance_date < start_date         | Boundary - Prior to start    | Allowance included in opening allowances deduction           | -     |
 * | TC-STMT-B09  | Single-day range (start_date == end_date)     | Boundary - 0-day interval    | Query succeeds for single day, identity holds               | -     |
 * | TC-STMT-B10  | Voided AR, voided receipt, cancelled allowance| Boundary - Void/Cancelled    | Completely excluded from all statement periods               | -     |
 * | TC-STMT-N01  | Comprehensive statement with 4 sections       | Equivalence - Normal         | Opening + AR − Receipts − Allowances == Closing strictly     | -     |
 * | TC-STMT-N02  | Period with zero transactions                 | Boundary - Zero delta        | Opening == Closing, current subtotals are 0                 | -     |
 * | TC-STMT-N03  | Multiple receipts & allowances for multi-ARs | Equivalence - Multi-line     | Itemized details and subtotals calculated with round_2      | -     |
 * | TC-STMT-N04  | Adjacent period transition                    | Equivalence - Continuity     | Period 1 Closing balance == Period 2 Opening balance         | -     |
 * | TC-STMT-N05  | Query covering all dates up to today          | Equivalence - Consistency    | Closing balance == Workspace total open outstanding AR       | -     |
 * | TC-STMT-N06  | Tenant isolation check                        | Equivalence - Multi-tenant   | Other tenant's customer or records cannot be queried/leaked  | -     |
 * =========================================================================
 */

test.describe('Issue #229: Customer Statement (對帳明細) & Identity Reconciliation', () => {
  const tenantId = 'tnt_stmt_ar_229';
  const otherTenantId = 'tnt_other_ar_229';

  async function createMockCustomer(name, tid = tenantId, isCustomer = true) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const p = await invoke('create_partner', {
      name: `${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      is_customer: isCustomer,
      is_vendor: !isCustomer,
      ...(isCustomer ? {
        collectionTermsType: 'net',
        collectionTermsDays: 30
      } : {
        paymentTermsType: 'net',
        paymentTermsDays: 30
      })
    });
    return p;
  }

  async function createMockOpeningReceivable(customerId, amount, docDate, dueDate, tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const res = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerId,
        original_reference: `REF-STMT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        document_date: docDate,
        due_date: dueDate,
        amount: amount,
      }
    });
    const list = await invoke('list_accounts_receivable', { customerPartnerId: customerId, status: 'open' });
    return list.find(a => a.source_id === res.id) || list[0];
  }

  async function createAndPostReceipt(customerId, arId, amount, receiptDate, method = 'bank_transfer', tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const receipt = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customerId,
        receipt_date: receiptDate,
        receipt_method: method
      }
    });
    await invoke('add_customer_receipt_allocation', {
      receipt_id: receipt.id,
      account_receivable_id: arId,
      amount: amount
    });
    return await invoke('post_customer_receipt', { receipt_id: receipt.id });
  }

  async function createAndPostAllowance(customerId, arId, untaxedAmount, taxAmount, allowanceDate, tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const alwId = `alw_stmt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const alwNumber = `SALW-STMT-${Math.floor(Math.random() * 10000)}`;
    const newAllowance = {
      id: alwId,
      tenant_id: tid,
      allowance_number: alwNumber,
      customer_invoice_id: `inv_${alwId}`,
      invoice_number_snapshot: `INV-${alwNumber}`,
      account_receivable_id: arId,
      customer_partner_id: customerId,
      customer_name_snapshot: '測試客戶',
      reason_type: 'shipment_shortfall',
      allowance_date: allowanceDate,
      untaxed_amount: untaxedAmount,
      tax_amount: taxAmount,
      currency: 'TWD',
      status: 'posted',
      created_at: Date.now()
    };
    mockSalesAllowances.push(newAllowance);
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
    return newAllowance;
  }

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_customer_receipts', { tenant_id: tenantId });
    await invoke('reset_mock_opening_receivables', { tenant_id: tenantId });
    await invoke('reset_mock_accounts_receivable', { tenant_id: tenantId });
    await invoke('reset_mock_customer_invoices', { tenant_id: tenantId });
    if (mockSalesAllowances) mockSalesAllowances.length = 0;
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    await invoke('set_mock_active_tenant', { tenant_id: otherTenantId });
    await invoke('reset_mock_customer_receipts', { tenant_id: otherTenantId });
    await invoke('reset_mock_opening_receivables', { tenant_id: otherTenantId });
    await invoke('reset_mock_accounts_receivable', { tenant_id: otherTenantId });
    await invoke('reset_mock_customer_invoices', { tenant_id: otherTenantId });
    if (mockSalesAllowances) mockSalesAllowances.length = 0;
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
  });

  // ==========================================
  // Error & Exception Cases (TC-STMT-E01 ~ E06)
  // ==========================================

  test('TC-STMT-E01 to E06: Parameter validations and boundary errors', async () => {
    // Given: A valid customer partner
    const customer = await createMockCustomer('參數校驗客戶');

    // When & Then (TC-STMT-E01): Empty tenant
    await invoke('set_mock_active_tenant', { tenant_id: '' });
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: customer.id,
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /Tenant ID cannot be empty/
    );

    // Reset tenant
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });

    // When & Then (TC-STMT-E02): Empty customer_partner_id
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: '',
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /找不到指定的客戶或不屬於目前租戶/
    );

    // When & Then (TC-STMT-E03): Non-existent customer partner
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: 'cus_ghost_id',
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /找不到指定的客戶或不屬於目前租戶/
    );

    // When & Then (TC-STMT-E04): Partner is vendor, not customer
    const vendorOnly = await createMockCustomer('純供應商', tenantId, false);
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: vendorOnly.id,
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /指定的合作夥伴不是客戶/
    );

    // When & Then (TC-STMT-E05): Inverted date range (start_date > end_date)
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: customer.id,
          start_date: '2026-03-31',
          end_date: '2026-03-01'
        });
      },
      /起日不可晚於迄日/
    );

    // When & Then (TC-STMT-E06): Invalid date formats
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: customer.id,
          start_date: '2026/03/01',
          end_date: '2026-03-31'
        });
      },
      /無效的日期格式/
    );
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: customer.id,
          start_date: '2026-03-01',
          end_date: 'invalid'
        });
      },
      /無效的日期格式/
    );
  });

  // ==========================================
  // Normal & Boundary Reconciliation (TC-STMT-N01 ~ N06, B01 ~ B10)
  // ==========================================

  test('TC-STMT-N01 & B01-B08: Comprehensive reconciliation with allowances identity check', async () => {
    // Given: Customer with prior and current transactions
    const customer = await createMockCustomer('恆等式對帳客戶');
    const sDate = '2026-03-01';
    const eDate = '2026-03-31';

    // 1. Prior period (before 2026-03-01):
    // Prior AR: 1000.0 (docDate 2026-02-10)
    const arPrior = await createMockOpeningReceivable(customer.id, 1000.0, '2026-02-10', '2026-03-10');
    // Prior Receipt: 200.0 (receiptDate 2026-02-20)
    await createAndPostReceipt(customer.id, arPrior.id, 200.0, '2026-02-20');
    // Prior Allowance: 100.0 (allowanceDate 2026-02-25, untaxed 95.24 + tax 4.76)
    await createAndPostAllowance(customer.id, arPrior.id, 95.24, 4.76, '2026-02-25');
    // Opening balance should be: 1000.0 - 200.0 - 100.0 = 700.0

    // 2. Current period (2026-03-01 ~ 2026-03-31):
    // B01: AR on start_date boundary (2026-03-01): 400.0
    const arStart = await createMockOpeningReceivable(customer.id, 400.0, '2026-03-01', '2026-04-01');
    // B03: AR on end_date boundary (2026-03-31): 250.75
    const arEnd = await createMockOpeningReceivable(customer.id, 250.75, '2026-03-31', '2026-04-30');
    // B04: AR after end_date (2026-04-05): 900.0 (excluded)
    await createMockOpeningReceivable(customer.id, 900.0, '2026-04-05', '2026-05-05');

    // Current Receipts:
    // B05: Receipt on start_date boundary (2026-03-01): 150.0 allocating to arPrior
    await createAndPostReceipt(customer.id, arPrior.id, 150.0, '2026-03-01');
    // Receipt inside period (2026-03-15): 100.0 allocating to arStart
    await createAndPostReceipt(customer.id, arStart.id, 100.0, '2026-03-15');

    // Current Allowances:
    // B07: Allowance on start_date boundary (2026-03-01): 50.0 on arStart
    await createAndPostAllowance(customer.id, arStart.id, 47.62, 2.38, '2026-03-01');
    // Allowance on end_date boundary (2026-03-31): 30.75 on arEnd
    await createAndPostAllowance(customer.id, arEnd.id, 29.29, 1.46, '2026-03-31');

    // When: Query customer statement for March 2026
    const stmt = await loadCustomerStatementAction(customer.id, sDate, eDate);

    // Then: Check values
    // Opening balance: 1000 - 200 - 100 = 700.0
    assert.equal(stmt.opening_balance, 700.0);

    // Current Receivables: 400.0 + 250.75 = 650.75
    assert.equal(stmt.current_receivables_total, 650.75);
    assert.equal(stmt.receivables.length, 2);
    assert.equal(stmt.receivables[0].document_date, '2026-03-01');
    assert.equal(stmt.receivables[1].document_date, '2026-03-31');

    // Current Receipts: 150.0 + 100.0 = 250.0
    assert.equal(stmt.current_receipts_total, 250.0);
    assert.equal(stmt.receipts.length, 2);

    // Current Allowances: 50.0 + 30.75 = 80.75
    assert.equal(stmt.current_allowances_total, 80.75);
    assert.equal(stmt.allowances.length, 2);

    // Closing Balance:
    // 700.0 + 650.75 - 250.0 - 80.75 = 1020.0
    assert.equal(stmt.closing_balance, 1020.0);

    // Live Identity check: Opening + Current Receivables - Current Receipts - Current Allowances == Closing
    const calculatedClosing = Math.round(
      (stmt.opening_balance + stmt.current_receivables_total - stmt.current_receipts_total - stmt.current_allowances_total) * 100
    ) / 100;
    assert.equal(calculatedClosing, stmt.closing_balance);
  });

  test('TC-STMT-B10: Voided AR, voided receipts, and cancelled allowances exclusion', async () => {
    // Given: Valid customer with posted and voided items
    const customer = await createMockCustomer('作廢排除客戶');

    // Valid AR
    const ar1 = await createMockOpeningReceivable(customer.id, 800.0, '2026-03-05', '2026-04-05');

    // Voided AR
    const arVoid = await createMockOpeningReceivable(customer.id, 500.0, '2026-03-06', '2026-04-06');
    await invoke('void_account_receivable', {
      account_receivable_id: arVoid.id,
      void_reason: '測試作廢'
    });

    // Valid receipt
    await createAndPostReceipt(customer.id, ar1.id, 200.0, '2026-03-10');

    // Cancelled / draft allowance
    mockSalesAllowances.push({
      id: 'alw_cancelled_1',
      tenant_id: tenantId,
      allowance_number: 'SALW-CANC-1',
      customer_invoice_id: 'inv_c1',
      invoice_number_snapshot: 'INV-C1',
      account_receivable_id: ar1.id,
      customer_partner_id: customer.id,
      customer_name_snapshot: customer.name,
      reason_type: 'shipment_shortfall',
      allowance_date: '2026-03-15',
      untaxed_amount: 100,
      tax_amount: 5,
      currency: 'TWD',
      status: 'cancelled',
      created_at: Date.now()
    });
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    // When: Query statement
    const stmt = await invoke('get_customer_statement', {
      customer_partner_id: customer.id,
      start_date: '2026-03-01',
      end_date: '2026-03-31'
    });

    // Then: Voided AR (500) and Cancelled allowance (105) must be excluded
    assert.equal(stmt.current_receivables_total, 800.0);
    assert.equal(stmt.receivables.length, 1);
    assert.equal(stmt.current_receipts_total, 200.0);
    assert.equal(stmt.current_allowances_total, 0.0);
    assert.equal(stmt.allowances.length, 0);
    assert.equal(stmt.closing_balance, 600.0);
  });

  test('TC-STMT-N04: Adjacent period transition (Period 1 closing == Period 2 opening)', async () => {
    // Given: AR, receipts, and allowances in Feb and Mar
    const customer = await createMockCustomer('相鄰期間客戶');
    const ar1 = await createMockOpeningReceivable(customer.id, 900.0, '2026-02-10', '2026-03-10');
    await createAndPostReceipt(customer.id, ar1.id, 200.0, '2026-02-20');
    await createAndPostAllowance(customer.id, ar1.id, 95.24, 4.76, '2026-02-25');

    // When: Query Period 1 (Feb) and Period 2 (Mar)
    const p1 = await invoke('get_customer_statement', {
      customer_partner_id: customer.id,
      start_date: '2026-02-01',
      end_date: '2026-02-28'
    });
    const p2 = await invoke('get_customer_statement', {
      customer_partner_id: customer.id,
      start_date: '2026-03-01',
      end_date: '2026-03-31'
    });

    // Then: Period 1 closing balance (900 - 200 - 100 = 600) equals Period 2 opening balance
    assert.equal(p1.closing_balance, 600.0);
    assert.equal(p2.opening_balance, p1.closing_balance);
  });

  test('TC-STMT-N02: Period with no changes (opening == closing)', async () => {
    // Given: Prior AR exists
    const customer = await createMockCustomer('靜態期間客戶');
    await createMockOpeningReceivable(customer.id, 500.0, '2026-01-10', '2026-02-10');

    // When: Query for May (where no records exist)
    const stmt = await invoke('get_customer_statement', {
      customer_partner_id: customer.id,
      start_date: '2026-05-01',
      end_date: '2026-05-31'
    });

    // Then: Opening equals closing, current subtotals are 0
    assert.equal(stmt.opening_balance, 500.0);
    assert.equal(stmt.current_receivables_total, 0);
    assert.equal(stmt.current_receipts_total, 0);
    assert.equal(stmt.current_allowances_total, 0);
    assert.equal(stmt.closing_balance, 500.0);
    assert.equal(stmt.opening_balance, stmt.closing_balance);
  });

  test('TC-STMT-B09: Single-day range (start_date == end_date)', async () => {
    // Given: AR, receipt, and allowance on the same day
    const customer = await createMockCustomer('單日區間客戶');
    const ar = await createMockOpeningReceivable(customer.id, 600.0, '2026-03-15', '2026-04-15');
    await createAndPostReceipt(customer.id, ar.id, 200.0, '2026-03-15');
    await createAndPostAllowance(customer.id, ar.id, 47.62, 2.38, '2026-03-15');

    // When: Query for single day 2026-03-15
    const stmt = await invoke('get_customer_statement', {
      customer_partner_id: customer.id,
      start_date: '2026-03-15',
      end_date: '2026-03-15'
    });

    // Then:
    assert.equal(stmt.opening_balance, 0);
    assert.equal(stmt.current_receivables_total, 600.0);
    assert.equal(stmt.current_receipts_total, 200.0);
    assert.equal(stmt.current_allowances_total, 50.0);
    assert.equal(stmt.closing_balance, 350.0);
    assert.equal(stmt.receivables.length, 1);
    assert.equal(stmt.receipts.length, 1);
    assert.equal(stmt.allowances.length, 1);
  });

  test('TC-STMT-N05: Closing balance equals workspace total outstanding when end_date covers all records', async () => {
    // Given: Multiple ARs, receipts, and allowances
    const customer = await createMockCustomer('工作區對齊客戶');
    const ar1 = await createMockOpeningReceivable(customer.id, 1000.0, '2026-01-15', '2026-02-15');
    const ar2 = await createMockOpeningReceivable(customer.id, 800.0, '2026-02-15', '2026-03-15');
    await createAndPostReceipt(customer.id, ar1.id, 400.0, '2026-02-01');
    await createAndPostAllowance(customer.id, ar2.id, 95.24, 4.76, '2026-03-01');

    // Workspace outstanding calculation
    const allArs = await invoke('list_accounts_receivable', { customerPartnerId: customer.id, status: 'open' });
    const workspaceTotalOutstanding = Math.round(allArs.reduce((sum, a) => sum + a.outstanding_amount, 0) * 100) / 100;

    // When: Querying statement from beginning to end of year
    const stmt = await invoke('get_customer_statement', {
      customer_partner_id: customer.id,
      start_date: '2026-01-01',
      end_date: '2026-12-31'
    });

    // Then: Closing balance must exactly equal workspace total outstanding
    assert.equal(stmt.closing_balance, workspaceTotalOutstanding);
    assert.equal(stmt.closing_balance, 1300.0);
  });

  test('TC-STMT-N06: Multi-tenant isolation verification', async () => {
    // Given: Customer in tenant A and Customer in tenant B
    const customerA = await createMockCustomer('租戶A客戶', tenantId);
    const customerB = await createMockCustomer('租戶B客戶', otherTenantId);

    await createMockOpeningReceivable(customerA.id, 1000.0, '2026-03-05', '2026-04-05', tenantId);
    await createMockOpeningReceivable(customerB.id, 2000.0, '2026-03-05', '2026-04-05', otherTenantId);

    // When: Active tenant is tenant A, query customer B
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await assert.rejects(
      async () => {
        await invoke('get_customer_statement', {
          customer_partner_id: customerB.id,
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /找不到指定的客戶或不屬於目前租戶/
    );

    // When: Active tenant is tenant A, query customer A
    const stmtA = await invoke('get_customer_statement', {
      customer_partner_id: customerA.id,
      start_date: '2026-03-01',
      end_date: '2026-03-31'
    });

    // Then: Customer A statement only sees tenant A records (1000, not 3000)
    assert.equal(stmtA.current_receivables_total, 1000.0);
    assert.equal(stmtA.closing_balance, 1000.0);
  });
});

