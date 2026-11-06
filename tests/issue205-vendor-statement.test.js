import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #205: Vendor Statement (對帳明細)', () => {
  const tenantId = 'tnt_stmt_test_205';
  const otherTenantId = 'tnt_other_205';

  async function createMockVendor(name, tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    return await invoke('create_partner', {
      name: `${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      is_vendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });
  }

  async function createMockOpeningPayable(vendorId, amount, docDate, dueDate, tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const res = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorId,
        original_reference: `REF-STMT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        document_date: docDate,
        due_date: dueDate,
        amount: amount,
      }
    });
    const oapId = res.opening_payable?.id || res.id;
    const apId = res.account_payable_id;
    if (apId) {
      const ap = await invoke('get_account_payable', { id: apId });
      return ap;
    }
    const list = await invoke('list_accounts_payable', { vendorPartnerId: vendorId, status: 'open' });
    return list.find(a => a.source_id === oapId) || list[0];
  }

  async function createAndPostPayment(vendorId, apId, amount, paymentDate, method = 'bank_transfer', tid = tenantId) {
    await invoke('set_mock_active_tenant', { tenant_id: tid });
    const payment = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendorId,
        payment_date: paymentDate,
        payment_method: method
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: payment.id,
      account_payable_id: apId,
      amount: amount
    });
    return await invoke('post_vendor_payment', { payment_id: payment.id });
  }

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_payments', { tenant_id: tenantId });
    await invoke('reset_mock_opening_payables', { tenant_id: tenantId });
    await invoke('reset_mock_accounts_payable', { tenant_id: tenantId });
    await invoke('reset_mock_vendor_bills', { tenant_id: tenantId });

    await invoke('set_mock_active_tenant', { tenant_id: otherTenantId });
    await invoke('reset_mock_vendor_payments', { tenant_id: otherTenantId });
    await invoke('reset_mock_opening_payables', { tenant_id: otherTenantId });
    await invoke('reset_mock_accounts_payable', { tenant_id: otherTenantId });
    await invoke('reset_mock_vendor_bills', { tenant_id: otherTenantId });

    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
  });

  // ==========================================
  // Error & Exception Cases (TC-STMT-E01 ~ E06)
  // ==========================================

  test('TC-STMT-E01 to E06: Parameter validations and boundary errors', async () => {
    // Given: A valid vendor
    const vendor = await createMockVendor('參數校驗供應商');

    // When & Then (TC-STMT-E01): Empty tenant
    await invoke('set_mock_active_tenant', { tenant_id: '' });
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: vendor.id,
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /Tenant ID cannot be empty/
    );

    // Reset tenant
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });

    // When & Then (TC-STMT-E02): Empty vendor_partner_id
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: '',
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /找不到指定的供應商或不屬於目前租戶/
    );

    // When & Then (TC-STMT-E03): Non-existent vendor partner
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: 'vnd_ghost_id',
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /找不到指定的供應商或不屬於目前租戶/
    );

    // When & Then (TC-STMT-E04): Partner is not a vendor (is_customer only)
    const customer = await invoke('create_partner', {
      name: '純客戶合作夥伴',
      is_vendor: false,
      is_customer: true
    });
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: customer.id,
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        });
      },
      /指定的合作夥伴不是供應商/
    );

    // When & Then (TC-STMT-E05): start_date > end_date
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: vendor.id,
          start_date: '2026-03-31',
          end_date: '2026-03-01'
        });
      },
      /起日不可晚於迄日/
    );

    // When & Then (TC-STMT-E06): Invalid date formats
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: vendor.id,
          start_date: '2026/03/01',
          end_date: '2026-03-31'
        });
      },
      /無效的日期格式，需為 YYYY-MM-DD/
    );
    await assert.rejects(
      async () => {
        await invoke('get_vendor_statement', {
          vendor_partner_id: vendor.id,
          start_date: '2026-03-01',
          end_date: 'not-a-date'
        });
      },
      /無效的日期格式，需為 YYYY-MM-DD/
    );
  });

  // ==========================================
  // Normal & Boundary Cases (TC-STMT-N01 ~ N06, B01 ~ B09)
  // ==========================================

  test('TC-STMT-N03: Brand new vendor with 0 transactions', async () => {
    // Given: A new vendor with no AP or payments
    const vendor = await createMockVendor('新建立供應商');

    // When: Querying statement
    const stmt = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-03-01',
      end_date: '2026-03-31'
    });

    // Then: All amounts are 0 and lists are empty
    assert.equal(stmt.opening_balance, 0);
    assert.equal(stmt.current_payables_total, 0);
    assert.equal(stmt.current_payments_total, 0);
    assert.equal(stmt.closing_balance, 0);
    assert.equal(stmt.payables.length, 0);
    assert.equal(stmt.payments.length, 0);
  });

  test('TC-STMT-N01, B01-B07, B09, E07-E10: Standard statement, boundaries and exclusions', async () => {
    // Given:
    const vendor = await createMockVendor('核心對帳測試供應商');
    const sDate = '2026-03-01';
    const eDate = '2026-03-31';

    // B02: AP prior to start_date (2026-02-20) -> 1000.0
    const apPrior = await createMockOpeningPayable(vendor.id, 1000.0, '2026-02-20', '2026-03-20');

    // B06: Payment prior to start_date (2026-02-25) -> 300.0
    await createAndPostPayment(vendor.id, apPrior.id, 300.0, '2026-02-25');
    // Net opening = 1000.0 - 300.0 = 700.0

    // B01: AP on start_date (2026-03-01) -> 400.0
    const apSDate = await createMockOpeningPayable(vendor.id, 400.0, '2026-03-01', '2026-03-31');

    // B03 & B09: AP on end_date (2026-03-31) with 0.01 precision -> 250.75
    const apEDate = await createMockOpeningPayable(vendor.id, 250.75, '2026-03-31', '2026-04-30');

    // B04: AP after end_date (2026-04-01) -> 888.0 (should not be in this period)
    await createMockOpeningPayable(vendor.id, 888.0, '2026-04-01', '2026-04-30');

    // B05 & TC-STMT-N06: Payment on start_date (2026-03-01) allocating to multiple APs (200 on apPrior, 100 on apSDate) -> 300.0
    const multiPay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: '2026-03-01',
        payment_method: 'bank_transfer',
        payment_reference: 'MULTI-ALLOC'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: multiPay.id,
      account_payable_id: apPrior.id,
      amount: 200.0
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: multiPay.id,
      account_payable_id: apSDate.id,
      amount: 100.0
    });
    await invoke('post_vendor_payment', { payment_id: multiPay.id });

    // B07: Payment on end_date (2026-03-31) -> 50.75
    await createAndPostPayment(vendor.id, apEDate.id, 50.75, '2026-03-31', 'cash');

    // TC-STMT-E07: Voided AP in period -> 999.0
    const voidAp = await createMockOpeningPayable(vendor.id, 999.0, '2026-03-15', '2026-04-15');
    await invoke('void_opening_payable', { id: voidAp.source_id, void_reason: '作廢測試' });

    // TC-STMT-E08: Voided payment in period
    const voidPay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: '2026-03-20',
        payment_method: 'check'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: voidPay.id,
      account_payable_id: apSDate.id,
      amount: 50.0
    });
    await invoke('post_vendor_payment', { payment_id: voidPay.id });
    await invoke('void_vendor_payment', { id: voidPay.id, void_reason: '作廢付款單' });

    // TC-STMT-E09: Draft payment in period
    const draftPay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: '2026-03-25',
        payment_method: 'bank_transfer'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: draftPay.id,
      account_payable_id: apSDate.id,
      amount: 50.0
    });
    // Not posted

    // TC-STMT-E10: Other tenant records in period
    await invoke('set_mock_active_tenant', { tenant_id: otherTenantId });
    const otherVendor = await createMockVendor('其他租戶供應商', otherTenantId);
    await createMockOpeningPayable(otherVendor.id, 5555.0, '2026-03-10', '2026-04-10', otherTenantId);
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });

    // When: Querying statement for [2026-03-01, 2026-03-31]
    const stmt = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: sDate,
      end_date: eDate
    });

    // Then: Check values
    // Opening balance: 1000 - 300 = 700.0
    assert.equal(stmt.opening_balance, 700.0);

    // Current payables: 400.0 (apSDate) + 250.75 (apEDate) = 650.75 (voidAp & future Ap excluded)
    assert.equal(stmt.current_payables_total, 650.75);
    assert.equal(stmt.payables.length, 2);
    assert.equal(stmt.payables[0].document_date, '2026-03-01');
    assert.equal(stmt.payables[1].document_date, '2026-03-31');

    // Current payments: 300.0 (multiPay) + 50.75 = 350.75 (voidPay & draftPay excluded)
    assert.equal(stmt.current_payments_total, 350.75);
    assert.equal(stmt.payments.length, 2);
    assert.equal(stmt.payments[0].allocations.length, 2);
    assert.equal(stmt.payments[0].amount, 300.0);
    assert.equal(stmt.payments[1].amount, 50.75);

    // Closing balance: 700.0 + 650.75 - 350.75 = 1000.00
    assert.equal(stmt.closing_balance, 1000.0);

    // Identity check: opening + current AP - current payment == closing
    assert.equal(
      Math.round((stmt.opening_balance + stmt.current_payables_total - stmt.current_payments_total) * 100) / 100,
      stmt.closing_balance
    );
  });

  test('TC-STMT-N04: Adjacent period transition (Period 1 closing == Period 2 opening)', async () => {
    // Given: AP and payments in Feb and Mar
    const vendor = await createMockVendor('相鄰期間供應商');
    const ap1 = await createMockOpeningPayable(vendor.id, 500.0, '2026-02-10', '2026-03-10');
    await createAndPostPayment(vendor.id, ap1.id, 100.0, '2026-02-20');

    // When: Query Period 1 (Feb) and Period 2 (Mar)
    const p1 = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-02-01',
      end_date: '2026-02-28'
    });
    const p2 = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-03-01',
      end_date: '2026-03-31'
    });

    // Then: Period 1 closing balance equals Period 2 opening balance
    assert.equal(p1.closing_balance, 400.0);
    assert.equal(p2.opening_balance, p1.closing_balance);
  });

  test('TC-STMT-N02: Period with no changes (opening == closing)', async () => {
    // Given: Prior AP exists
    const vendor = await createMockVendor('靜態期間供應商');
    await createMockOpeningPayable(vendor.id, 500.0, '2026-01-10', '2026-02-10');

    // When: Query for May (where no records exist)
    const stmt = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-05-01',
      end_date: '2026-05-31'
    });

    // Then:
    assert.equal(stmt.opening_balance, 500.0);
    assert.equal(stmt.current_payables_total, 0);
    assert.equal(stmt.current_payments_total, 0);
    assert.equal(stmt.closing_balance, 500.0);
    assert.equal(stmt.opening_balance, stmt.closing_balance);
  });

  test('TC-STMT-B08: Single-day range (start_date == end_date)', async () => {
    // Given: AP and payment on the same day
    const vendor = await createMockVendor('單日區間供應商');
    const ap = await createMockOpeningPayable(vendor.id, 600.0, '2026-03-15', '2026-04-15');
    await createAndPostPayment(vendor.id, ap.id, 200.0, '2026-03-15');

    // When: Query for single day 2026-03-15
    const stmt = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-03-15',
      end_date: '2026-03-15'
    });

    // Then:
    assert.equal(stmt.opening_balance, 0);
    assert.equal(stmt.current_payables_total, 600.0);
    assert.equal(stmt.current_payments_total, 200.0);
    assert.equal(stmt.closing_balance, 400.0);
    assert.equal(stmt.payables.length, 1);
    assert.equal(stmt.payments.length, 1);
  });

  test('TC-STMT-N05: Closing balance equals workspace total outstanding when end_date covers all records', async () => {
    // Given: Multiple APs and payments
    const vendor = await createMockVendor('工作區對齊供應商');
    const ap1 = await createMockOpeningPayable(vendor.id, 1000.0, '2026-01-15', '2026-02-15');
    const ap2 = await createMockOpeningPayable(vendor.id, 800.0, '2026-02-15', '2026-03-15');
    await createAndPostPayment(vendor.id, ap1.id, 400.0, '2026-02-01');
    await createAndPostPayment(vendor.id, ap2.id, 300.0, '2026-03-01');

    // Workspace outstanding calculation
    const allAps = await invoke('list_accounts_payable', { vendorPartnerId: vendor.id, status: 'open' });
    const workspaceTotalOutstanding = Math.round(allAps.reduce((sum, a) => sum + a.outstanding_amount, 0) * 100) / 100;

    // When: Querying statement from beginning to end
    const stmt = await invoke('get_vendor_statement', {
      vendor_partner_id: vendor.id,
      start_date: '2026-01-01',
      end_date: '2026-12-31'
    });

    // Then: Closing balance must exactly equal workspace total outstanding
    assert.equal(stmt.closing_balance, workspaceTotalOutstanding);
  });
});
