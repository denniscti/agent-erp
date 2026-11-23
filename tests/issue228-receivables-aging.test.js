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
  mockSalesAllowances,
  mockAccountsReceivable,
  mockSalesOrders,
  mockSalesOrderLines,
  saveStorage
} = await import('../src/lib/tauri.js');
const {
  loadReceivablesAgingAction,
  queryAccountsReceivableAction
} = await import('../src/lib/accountsReceivable/store.js');

test.describe('Issue #228: Accounts Receivable Aging Report & Workspace Integration', () => {
  const tenantId = 'tnt_ar_aging_test_228';
  const otherTenantId = 'tnt_other_228';

  async function createMockCustomer(name, tid = tenantId, issuanceMode = 'per_order') {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const p = await invoke('create_partner', {
      name: `${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      is_customer: true,
      collectionTermsType: 'net',
      collectionTermsDays: 30
    });
    if (issuanceMode !== 'per_order') {
      await invoke('update_partner', {
        id: p.id,
        invoice_issuance_mode: issuanceMode
      });
    }
    return p;
  }

  async function createMockOpeningReceivable(customerId, amount, docDate, dueDate, tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const oar = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerId,
        original_reference: `REF-AR-AGING-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        document_date: docDate,
        due_date: dueDate,
        amount: amount,
      }
    });
    const list = await invoke('list_accounts_receivable', { customerPartnerId: customerId, status: 'open' });
    return list.find(a => a.source_id === oar.id) || list[0];
  }

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_customer_receipts', { tenant_id: tenantId });
    await invoke('reset_mock_opening_receivables', { tenant_id: tenantId });
    await invoke('reset_mock_accounts_receivable', { tenant_id: tenantId });
    await invoke('reset_mock_customer_invoices', { tenant_id: tenantId });
    await invoke('reset_mock_sales_orders', { tenant_id: tenantId });
    if (mockSalesAllowances) mockSalesAllowances.length = 0;
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    await invoke('set_mock_active_tenant', { tenant_id: otherTenantId });
    await invoke('reset_mock_customer_receipts', { tenant_id: otherTenantId });
    await invoke('reset_mock_opening_receivables', { tenant_id: otherTenantId });
    await invoke('reset_mock_accounts_receivable', { tenant_id: otherTenantId });
    await invoke('reset_mock_customer_invoices', { tenant_id: otherTenantId });
    await invoke('reset_mock_sales_orders', { tenant_id: otherTenantId });
    if (mockSalesAllowances) mockSalesAllowances.length = 0;
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
  });

  // ==========================================
  // Layer 1: Boundary values (TC-228-B01 ~ B12)
  // ==========================================

  test('TC-228-B01 to B09: Aging bucket boundaries relative to as_of_date', async () => {
    // Given: A fixed as_of_date "2026-03-02" and customer
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('邊界客戶');

    // B01: due_date = today (2026-03-02) -> overdue_days = 0 -> current
    await createMockOpeningReceivable(customer.id, 100, '2026-02-01', '2026-03-02');

    // B02: due_date = tomorrow (2026-03-03) -> overdue_days = -1 -> current
    await createMockOpeningReceivable(customer.id, 200, '2026-02-01', '2026-03-03');

    // B03: due_date = 1 day ago (2026-03-01) -> overdue_days = 1 -> 1-30
    await createMockOpeningReceivable(customer.id, 300, '2026-02-01', '2026-03-01');

    // B04: due_date = 30 days ago (2026-01-31) -> overdue_days = 30 -> 1-30
    await createMockOpeningReceivable(customer.id, 400, '2026-01-01', '2026-01-31');

    // B05: due_date = 31 days ago (2026-01-30) -> overdue_days = 31 -> 31-60
    await createMockOpeningReceivable(customer.id, 500, '2026-01-01', '2026-01-30');

    // B06: due_date = 60 days ago (2026-01-01) -> overdue_days = 60 -> 31-60
    await createMockOpeningReceivable(customer.id, 600, '2025-12-01', '2026-01-01');

    // B07: due_date = 61 days ago (2025-12-31) -> overdue_days = 61 -> 61-90
    await createMockOpeningReceivable(customer.id, 700, '2025-11-01', '2025-12-31');

    // B08: due_date = 90 days ago (2025-12-02) -> overdue_days = 90 -> 61-90
    await createMockOpeningReceivable(customer.id, 800, '2025-11-01', '2025-12-02');

    // B09: due_date = 91 days ago (2025-12-01) -> overdue_days = 91 -> 90+
    await createMockOpeningReceivable(customer.id, 900, '2025-10-01', '2025-12-01');

    // When: Requesting receivables aging with as_of_date
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });

    // Then: Check customer bucket classification
    assert.equal(report.customers.length, 1);
    const c = report.customers[0];
    assert.equal(c.customer_partner_id, customer.id);

    // Current = 100 + 200 = 300
    assert.equal(c.current, 300);
    // 1-30 = 300 + 400 = 700
    assert.equal(c.overdue_1_30, 700);
    // 31-60 = 500 + 600 = 1100
    assert.equal(c.overdue_31_60, 1100);
    // 61-90 = 700 + 800 = 1500
    assert.equal(c.overdue_61_90, 1500);
    // 90+ = 900
    assert.equal(c.overdue_90_plus, 900);

    // Total outstanding = 300 + 700 + 1100 + 1500 + 900 = 4500
    assert.equal(c.total_outstanding, 4500);
    assert.equal(report.totals.total_outstanding, 4500);
  });

  test('TC-228-B10 to B11: Cross-month and default as_of_date handling', async () => {
    // Given: Fixed as_of_date "2026-03-02"
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('曆法客戶');

    // 2026-01-31 to 2026-03-02 in non-leap year (Feb has 28 days): 28 + 2 = 30 days
    await createMockOpeningReceivable(customer.id, 150, '2026-01-01', '2026-01-31');

    // When: Querying aging
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });
    const item = report.customers[0].items.find(i => i.due_date === '2026-01-31');

    // Then: overdue_days is exactly 30, bucket is '1-30'
    assert.equal(item.overdue_days, 30);
    assert.equal(item.bucket, '1-30');

    // When: Querying with null/empty as_of_date
    const reportDefault = await invoke('get_receivables_aging', {});
    assert.ok(reportDefault.as_of_date);
    assert.match(reportDefault.as_of_date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('TC-228-B12: Minimal positive balance boundary after collection', async () => {
    // Given: AR of 1000.0 with 999.99 received
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('最小餘額客戶');
    const ar = await createMockOpeningReceivable(customer.id, 1000.0, '2026-02-01', '2026-03-02');

    // Make partial receipt of 999.99
    const rec = await invoke('create_customer_receipt', {
      input: {
        customer_partner_id: customer.id,
        receipt_date: '2026-02-15',
        receipt_method: 'bank_transfer'
      }
    });
    await invoke('add_customer_receipt_allocation', {
      receipt_id: rec.id,
      account_receivable_id: ar.id,
      amount: 999.99
    });
    await invoke('post_customer_receipt', { receipt_id: rec.id });

    // When: Querying aging
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });

    // Then: Outstanding is exactly 0.01, placed in current bucket
    const c = report.customers[0];
    assert.equal(c.current, 0.01);
    assert.equal(c.total_outstanding, 0.01);
    assert.equal(c.items[0].received_amount, 999.99);
    assert.equal(c.items[0].outstanding_amount, 0.01);
    assert.equal(c.items[0].settlement_status, 'partially_paid');
  });

  // ==========================================
  // Layer 1: Normal cases & Allowance equality (TC-228-N01 ~ N08)
  // ==========================================

  test('TC-228-N01 to N03: Multi-customer aggregation and total consistency', async () => {
    // Given: Two customers with distinct receivables
    const asOf = '2026-03-02';
    const customerA = await createMockCustomer('客戶A');
    const customerB = await createMockCustomer('客戶B');

    await createMockOpeningReceivable(customerA.id, 1000, '2026-02-01', '2026-03-02'); // Current: 1000
    await createMockOpeningReceivable(customerA.id, 2000, '2026-01-01', '2026-02-15'); // 1-30: 2000
    await createMockOpeningReceivable(customerB.id, 3000, '2026-01-01', '2026-01-15'); // 31-60: 3000

    // When: Querying aging
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });

    // Then (TC-228-N01 & N02): Check customer sums
    const cA = report.customers.find(c => c.customer_partner_id === customerA.id);
    const cB = report.customers.find(c => c.customer_partner_id === customerB.id);

    assert.ok(cA);
    assert.equal(cA.current, 1000);
    assert.equal(cA.overdue_1_30, 2000);
    assert.equal(cA.total_outstanding, 3000);

    assert.ok(cB);
    assert.equal(cB.overdue_31_60, 3000);
    assert.equal(cB.total_outstanding, 3000);

    // Then (TC-228-N03): Grand totals match sum of customers
    assert.equal(report.totals.current, 1000);
    assert.equal(report.totals.overdue_1_30, 2000);
    assert.equal(report.totals.overdue_31_60, 3000);
    assert.equal(report.totals.total_outstanding, 6000);
  });

  test('TC-228-N02: Acceptance criteria - Aging buckets sum exactly equals outstanding balance when allowances exist', async () => {
    // Given: Customer with multiple receivables and posted sales allowance (折讓)
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('折讓驗證客戶');

    // AR 1: 5000 in overdue 90+ (due 2025-11-01)
    const ar1 = await createMockOpeningReceivable(customer.id, 5000, '2025-10-01', '2025-11-01');
    // AR 2: 3000 in current (due 2026-03-02)
    await createMockOpeningReceivable(customer.id, 3000, '2026-02-01', '2026-03-02');

    // Add a posted sales allowance of 1050 (1000 untaxed + 50 tax) for ar1
    mockSalesAllowances.push({
      id: `alw_${Date.now()}`,
      tenant_id: tenantId,
      allowance_number: `ALW-${Date.now()}`,
      account_receivable_id: ar1.id,
      customer_invoice_id: ar1.source_id,
      untaxed_amount: 1000,
      tax_amount: 50,
      status: 'posted',
      created_at: Date.now()
    });
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    // When: Generating receivables aging
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });
    const c = report.customers.find(x => x.customer_partner_id === customer.id);

    // Then: Check that allowance was deducted from overdue 90+
    assert.ok(c);
    assert.equal(c.current, 3000);
    // Overdue 90+ = 5000 - 1050 = 3950
    assert.equal(c.overdue_90_plus, 3950);
    // Total outstanding = 3000 + 3950 = 6950 (8000 - 1050)
    assert.equal(c.total_outstanding, 6950);

    // CRITICAL ACCEPTANCE CRITERIA:
    // 有折讓時帳齡合計等於未收餘額
    const bucketSum = Math.round((c.current + c.overdue_1_30 + c.overdue_31_60 + c.overdue_61_90 + c.overdue_90_plus) * 100) / 100;
    assert.equal(bucketSum, c.total_outstanding);

    // Item drilldown also reflects allowance
    const item1 = c.items.find(i => i.account_receivable_id === ar1.id);
    assert.equal(item1.amount, 5000);
    assert.equal(item1.allowance_amount, 1050);
    assert.equal(item1.outstanding_amount, 3950);
    assert.equal(item1.settlement_status, 'partially_paid');
  });

  test('TC-228-N04 to N07: Uninvoiced sales orders in 3 groups independent of AR aging', async () => {
    // Given: Customer with uninvoiced sales orders and no initial open AR
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('未開票專用客戶');

    // Create confirmed sales order (Group a: per_order_confirmed)
    const soId = `so_a_${Date.now()}`;
    mockSalesOrders.push({
      id: soId,
      tenant_id: tenantId,
      so_number: `SO-A-${Date.now()}`,
      customer_partner_id: customer.id,
      customer_name_snapshot: customer.name,
      status: 'confirmed',
      ship_date: null,
      total_amount: 5000.0,
      shipped_amount: 0.0,
      created_at: 1000,
      confirmed_at: 1000
    });
    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);

    // When (TC-228-N04 & N06): Querying aging
    let report = await invoke('get_receivables_aging', { as_of_date: asOf });
    let c = report.customers.find(x => x.customer_partner_id === customer.id);

    // Then: Customer is listed, total_outstanding is 0, uninvoiced reference column shows 5000 in Group A
    assert.ok(c);
    assert.equal(c.total_outstanding, 0);
    assert.equal(c.uninvoiced_amount, 5000);
    assert.equal(c.uninvoiced_group_a, 5000);
    assert.equal(c.uninvoiced_group_b, 0);
    assert.equal(c.uninvoiced_group_c, 0);

    // Uninvoiced amount is NOT included in AR aging total
    assert.equal(c.current, 0);
    assert.equal(report.totals.total_outstanding, 0);
    assert.equal(report.totals.uninvoiced_amount, 5000);

    // When (TC-228-N05): Post an invoice for this sales order
    const invRes = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: customer.id,
        invoice_date: '2026-02-25',
        due_date: '2026-03-02',
        tax_invoice_number: `TX-${Date.now()}`,
        untaxed_amount: 5000,
        tax_amount: 250,
        sales_order_ids: [soId]
      }
    });
    const invId = invRes.invoice?.id || invRes.id;
    await invoke('post_customer_invoice', { input: { invoice_id: invId } });

    // When: Querying aging after invoice posted
    report = await invoke('get_receivables_aging', { as_of_date: asOf });
    c = report.customers.find(x => x.customer_partner_id === customer.id);

    // Then: Uninvoiced drops to 0, open AR of 5250 (5000 + 250 tax) enters 'current' bucket
    assert.equal(c.uninvoiced_amount, 0);
    assert.equal(c.current, 5250);
    assert.equal(c.total_outstanding, 5250);
    assert.equal(report.totals.total_outstanding, 5250);
  });

  test('TC-228-N08: Customer drilldown items metadata and action linkability', async () => {
    // Given: Customer with open AR
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('明細檢視客戶');
    await createMockOpeningReceivable(customer.id, 1200, '2026-01-15', '2026-02-15');

    // When: Querying aging
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });
    const c = report.customers.find(x => x.customer_partner_id === customer.id);

    // Then: Detailed metadata is available
    assert.equal(c.items.length, 1);
    const item = c.items[0];
    assert.ok(item.account_receivable_id);
    assert.ok(item.source_number);
    assert.equal(item.source_type, 'opening_balance');
    assert.equal(item.document_date, '2026-01-15');
    assert.equal(item.due_date, '2026-02-15');
    assert.equal(item.amount, 1200);
    assert.equal(item.outstanding_amount, 1200);
    assert.equal(item.settlement_status, 'unpaid');
    assert.equal(item.bucket, '1-30');
  });

  // ==========================================
  // Layer 1: Errors & Exclusions (TC-228-E01 ~ E04)
  // ==========================================

  test('TC-228-E01 to E02: Empty and whitespace tenant rejection', async () => {
    // Given & When & Then: Empty tenant throws
    await invoke('set_mock_active_tenant', { tenant_id: '' });
    await assert.rejects(async () => {
      await invoke('get_receivables_aging', {});
    }, /Tenant ID cannot be empty/i);

    await invoke('set_mock_active_tenant', { tenant_id: '   ' });
    await assert.rejects(async () => {
      await invoke('get_receivables_aging', {});
    }, /Tenant ID cannot be empty/i);
  });

  test('TC-228-E03 to E04: Voided receivables and cross-tenant data strictly isolated', async () => {
    // Given: AR in other tenant and voided AR in current tenant
    const asOf = '2026-03-02';
    const otherCustomer = await createMockCustomer('其他租戶客戶', otherTenantId);
    await createMockOpeningReceivable(otherCustomer.id, 8000, '2026-01-01', '2026-01-30', otherTenantId);

    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    const currentCustomer = await createMockCustomer('作廢帳款客戶', tenantId);
    const arVoid = await createMockOpeningReceivable(currentCustomer.id, 9999, '2026-01-01', '2026-01-30', tenantId);
    await invoke('void_opening_receivable', { id: arVoid.source_id, void_reason: '測試作廢' });

    // When: Querying aging for current tenant
    const report = await invoke('get_receivables_aging', { as_of_date: asOf });

    // Then: Other tenant customer and voided AR are completely excluded
    assert.equal(report.customers.find(c => c.customer_partner_id === otherCustomer.id), undefined);
    const currC = report.customers.find(c => c.customer_partner_id === currentCustomer.id);
    assert.equal(currC, undefined);
    assert.equal(report.totals.total_outstanding, 0);
  });

  // ==========================================
  // Layer 2: Frontend Store & Calculation Consistency (TC-228-UI01 ~ UI02)
  // ==========================================

  test('TC-228-UI01 & UI02: Store action returns identical figures and UI calculation consistency', async () => {
    // Given: Customer with receivables and allowances
    const asOf = '2026-03-02';
    const customer = await createMockCustomer('UI一致性客戶');
    const ar = await createMockOpeningReceivable(customer.id, 2000, '2026-02-01', '2026-03-02');

    // Add allowance
    mockSalesAllowances.push({
      id: `alw_ui_${Date.now()}`,
      tenant_id: tenantId,
      allowance_number: `ALW-UI-${Date.now()}`,
      account_receivable_id: ar.id,
      customer_invoice_id: ar.source_id,
      untaxed_amount: 500,
      tax_amount: 25,
      status: 'posted',
      created_at: Date.now()
    });
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    // When: Calling store action
    const report = await loadReceivablesAgingAction(asOf);

    // Then: Store action populates exactly
    assert.ok(report);
    assert.equal(report.customers.length, 1);
    const c = report.customers[0];
    assert.equal(c.total_outstanding, 1475); // 2000 - 525
    assert.equal(c.current, 1475);
    assert.equal(report.totals.total_outstanding, 1475);

    // Query AR action also reflects identical outstanding amount
    const queryList = await queryAccountsReceivableAction({ customer_partner_id: customer.id });
    assert.equal(queryList.length, 1);
    assert.equal(queryList[0].outstanding_amount, 1475);
    assert.equal(queryList[0].allowance_amount, 525);
  });
});
