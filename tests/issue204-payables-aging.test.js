import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #204: Accounts Payable Aging Report & Workspace Integration', () => {
  const tenantId = 'tnt_aging_test_204';
  const otherTenantId = 'tnt_other_204';

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
    const oap = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorId,
        original_reference: `REF-AGING-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        document_date: docDate,
        due_date: dueDate,
        amount: amount,
      }
    });
    const list = await invoke('list_accounts_payable', { vendorPartnerId: vendorId, status: 'open' });
    return list.find(a => a.source_id === oap.id) || list[0];
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
  // Layer 1: Boundary values (TC-AGING-B01 ~ B12)
  // ==========================================

  test('TC-AGING-B01 to B09: Aging bucket boundaries relative to as_of_date', async () => {
    // Given: A fixed as_of_date "2026-03-02" and vendor
    const asOf = '2026-03-02';
    const vendor = await createMockVendor('邊界供應商');

    // B01: due_date = today (2026-03-02) -> overdue_days = 0 -> current
    await createMockOpeningPayable(vendor.id, 100, '2026-02-01', '2026-03-02');

    // B02: due_date = tomorrow (2026-03-03) -> overdue_days = -1 -> current
    await createMockOpeningPayable(vendor.id, 200, '2026-02-01', '2026-03-03');

    // B03: due_date = 1 day ago (2026-03-01) -> overdue_days = 1 -> 1-30
    await createMockOpeningPayable(vendor.id, 300, '2026-02-01', '2026-03-01');

    // B04: due_date = 30 days ago (2026-01-31) -> overdue_days = 30 -> 1-30
    await createMockOpeningPayable(vendor.id, 400, '2026-01-01', '2026-01-31');

    // B05: due_date = 31 days ago (2026-01-30) -> overdue_days = 31 -> 31-60
    await createMockOpeningPayable(vendor.id, 500, '2026-01-01', '2026-01-30');

    // B06: due_date = 60 days ago (2026-01-01) -> overdue_days = 60 -> 31-60
    await createMockOpeningPayable(vendor.id, 600, '2025-12-01', '2026-01-01');

    // B07: due_date = 61 days ago (2025-12-31) -> overdue_days = 61 -> 61-90
    await createMockOpeningPayable(vendor.id, 700, '2025-11-01', '2025-12-31');

    // B08: due_date = 90 days ago (2025-12-02) -> overdue_days = 90 -> 61-90
    await createMockOpeningPayable(vendor.id, 800, '2025-11-01', '2025-12-02');

    // B09: due_date = 91 days ago (2025-12-01) -> overdue_days = 91 -> 90+
    await createMockOpeningPayable(vendor.id, 900, '2025-10-01', '2025-12-01');

    // When: Requesting payables aging with as_of_date
    const report = await invoke('get_payables_aging', { as_of_date: asOf });

    // Then: Check vendor bucket classification
    assert.equal(report.vendors.length, 1);
    const v = report.vendors[0];
    assert.equal(v.vendor_partner_id, vendor.id);

    // Current = 100 + 200 = 300
    assert.equal(v.current, 300);
    // 1-30 = 300 + 400 = 700
    assert.equal(v.overdue_1_30, 700);
    // 31-60 = 500 + 600 = 1100
    assert.equal(v.overdue_31_60, 1100);
    // 61-90 = 700 + 800 = 1500
    assert.equal(v.overdue_61_90, 1500);
    // 90+ = 900
    assert.equal(v.overdue_90_plus, 900);

    // Total outstanding = 300 + 700 + 1100 + 1500 + 900 = 4500
    assert.equal(v.total_outstanding, 4500);
    assert.equal(report.totals.total_outstanding, 4500);
  });

  test('TC-AGING-B10 to B11: Cross-month and cross-year pure integer calendar calculation', async () => {
    // Given: Fixed as_of_date "2026-03-02"
    const asOf = '2026-03-02';
    const vendor = await createMockVendor('曆法供應商');

    // 2026-01-31 to 2026-03-02 in non-leap year (Feb has 28 days): 28 + 2 = 30 days
    await createMockOpeningPayable(vendor.id, 150, '2026-01-01', '2026-01-31');

    // When: Querying aging
    const report = await invoke('get_payables_aging', { as_of_date: asOf });
    const item = report.vendors[0].items.find(i => i.due_date === '2026-01-31');

    // Then: overdue_days is exactly 30, bucket is '1-30'
    assert.equal(item.overdue_days, 30);
    assert.equal(item.bucket, '1-30');
  });

  test('TC-AGING-B12: Partial payment boundary - minimal positive remainder 0.01', async () => {
    // Given: AP of 1000.0 with 999.99 paid
    const asOf = '2026-03-02';
    const vendor = await createMockVendor('部分付款邊界供應商');
    const ap = await createMockOpeningPayable(vendor.id, 1000.0, '2026-02-01', '2026-03-02');

    // Make partial payment of 999.99
    const pay = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendor.id,
        payment_date: '2026-02-15',
        payment_method: 'bank_transfer'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: pay.id,
      account_payable_id: ap.id,
      amount: 999.99
    });
    await invoke('post_vendor_payment', { payment_id: pay.id });

    // When: Querying aging
    const report = await invoke('get_payables_aging', { as_of_date: asOf });

    // Then: Outstanding is exactly 0.01, placed in current bucket
    const v = report.vendors[0];
    assert.equal(v.current, 0.01);
    assert.equal(v.total_outstanding, 0.01);
    assert.equal(v.items[0].paid_amount, 999.99);
    assert.equal(v.items[0].outstanding_amount, 0.01);
    assert.equal(v.items[0].settlement_status, 'partially_paid');
  });

  // ==========================================
  // Layer 1 & 2: Normal cases & Consistency (TC-AGING-N01 ~ N08)
  // ==========================================

  test('TC-AGING-N01 to N03: Multi-vendor aggregation and total consistency', async () => {
    // Given: Two vendors with distinct payables
    const asOf = '2026-03-02';
    const vendorA = await createMockVendor('供應商A');
    const vendorB = await createMockVendor('供應商B');

    await createMockOpeningPayable(vendorA.id, 1000, '2026-02-01', '2026-03-02'); // Current: 1000
    await createMockOpeningPayable(vendorA.id, 2000, '2026-01-01', '2026-02-15'); // 1-30: 2000
    await createMockOpeningPayable(vendorB.id, 3000, '2026-01-01', '2026-01-15'); // 31-60: 3000

    // When: Querying aging
    const report = await invoke('get_payables_aging', { as_of_date: asOf });

    // Then (TC-AGING-N01 & N02): Check vendor sums
    const vA = report.vendors.find(v => v.vendor_partner_id === vendorA.id);
    const vB = report.vendors.find(v => v.vendor_partner_id === vendorB.id);

    assert.ok(vA);
    assert.equal(vA.current, 1000);
    assert.equal(vA.overdue_1_30, 2000);
    assert.equal(vA.total_outstanding, 3000);

    assert.ok(vB);
    assert.equal(vB.overdue_31_60, 3000);
    assert.equal(vB.total_outstanding, 3000);

    // Then (TC-AGING-N03): Grand totals match sum of vendors
    assert.equal(report.totals.current, 1000);
    assert.equal(report.totals.overdue_1_30, 2000);
    assert.equal(report.totals.overdue_31_60, 3000);
    assert.equal(report.totals.total_outstanding, 6000);
  });

  test('TC-AGING-N04 to N07: Unbilled received purchase order reference column and transitions', async () => {
    // Given: Vendor with unbilled received order and no open AP yet
    const asOf = '2026-03-02';
    const vendor = await createMockVendor('進貨未請款供應商');

    // Create a product and purchase order
    await invoke('create_warehouse', { code: `WH_${Date.now()}`, name: '預設倉庫' });
    const prd = await invoke('create_product', {
      name: `進貨商品_${Date.now()}`,
      category: '轉售商品',
      unit_name: '件',
      selling_price: 300
    });
    const unitId = prd.units[0].id;

    const poDetail = await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id,
      initialLines: [
        { unit_id: unitId, quantity: 10, purchase_cost: 250 }
      ]
    });
    await invoke('submit_purchase_order', { orderId: poDetail.order.id });
    await invoke('confirm_purchase_order_received', {
      orderId: poDetail.order.id
    });

    // When (TC-AGING-N04 & N06): Vendor has 0 outstanding AP but unbilled received > 0
    let report = await invoke('get_payables_aging', { as_of_date: asOf });
    let v = report.vendors.find(x => x.vendor_partner_id === vendor.id);

    // Then: Vendor is listed, total_outstanding is 0, reference column is 2500
    assert.ok(v);
    assert.equal(v.total_outstanding, 0);
    assert.equal(v.unbilled_received_amount, 2500); // 10 * 250 = 2500
    assert.equal(report.totals.total_outstanding, 0);
    assert.equal(report.totals.unbilled_received_amount, 2500);

    // When (TC-AGING-N05): Post a vendor bill covering this PO
    const billRes = await invoke('create_vendor_bill', {
      input: {
        vendor_partner_id: vendor.id,
        vendor_invoice_number: `INV-REC-${Date.now()}`,
        bill_date: '2026-02-20',
        due_date: '2026-03-02',
        currency: 'TWD',
        tax_type: 'tax_exclusive',
        untaxed_amount: 2500,
        tax_amount: 125,
      }
    });
    const billId = billRes.id || billRes.bill?.id;
    await invoke('add_vendor_bill_order', {
      bill_id: billId,
      purchase_order_id: poDetail.order.id
    });
    await invoke('post_vendor_bill', { bill_id: billId });

    // When: Querying aging after bill posted
    report = await invoke('get_payables_aging', { as_of_date: asOf });
    v = report.vendors.find(x => x.vendor_partner_id === vendor.id);

    // Then: Unbilled received drops to 0, and open AP of 2625 (2500 + 125 tax) enters 'current' bucket
    assert.equal(v.unbilled_received_amount, 0);
    assert.equal(v.current, 2625);
    assert.equal(v.total_outstanding, 2625);
  });

  test('TC-AGING-N08: Vendor drilldown items metadata and linkability', async () => {
    // Given: Open payable with external reference
    const asOf = '2026-03-02';
    const vendor = await createMockVendor('明細驗證供應商');
    await createMockOpeningPayable(vendor.id, 1200, '2026-01-15', '2026-02-15');

    // When: Querying aging
    const report = await invoke('get_payables_aging', { as_of_date: asOf });
    const v = report.vendors.find(x => x.vendor_partner_id === vendor.id);

    // Then: Detailed metadata is available
    assert.equal(v.items.length, 1);
    const item = v.items[0];
    assert.ok(item.account_payable_id);
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
  // Layer 1: Errors & Exclusions (TC-AGING-E01 ~ E06)
  // ==========================================

  test('TC-AGING-E01 to E02: Empty and whitespace tenant rejection', async () => {
    // Given & When & Then: Empty tenant throws
    await invoke('set_mock_active_tenant', { tenant_id: '' });
    await assert.rejects(async () => {
      await invoke('get_payables_aging', {});
    }, /Tenant ID cannot be empty/i);

    await invoke('set_mock_active_tenant', { tenant_id: '   ' });
    await assert.rejects(async () => {
      await invoke('get_payables_aging', {});
    }, /Tenant ID cannot be empty/i);
  });

  test('TC-AGING-E03 to E05: Voided and paid AP exclusions & clean list filtering', async () => {
    // Given: Database with paid AP and voided AP
    const asOf = '2026-03-02';
    const vendorA = await createMockVendor('已結清供應商');
    const apA = await createMockOpeningPayable(vendorA.id, 500, '2026-01-01', '2026-02-01');

    // Pay AP A completely
    const payA = await invoke('create_vendor_payment', {
      input: {
        vendor_partner_id: vendorA.id,
        payment_date: '2026-02-01',
        payment_method: 'bank_transfer'
      }
    });
    await invoke('add_vendor_payment_allocation', {
      payment_id: payA.id,
      account_payable_id: apA.id,
      amount: 500
    });
    await invoke('post_vendor_payment', { payment_id: payA.id });

    // Vendor B has voided AP
    const vendorB = await createMockVendor('已作廢供應商');
    const apB = await createMockOpeningPayable(vendorB.id, 800, '2026-01-01', '2026-02-01');
    await invoke('void_opening_payable', {
      id: apB.source_id,
      void_reason: '作廢測試'
    });

    // When: Querying aging
    const report = await invoke('get_payables_aging', { as_of_date: asOf });

    // Then (TC-AGING-E03, E04, E05):
    // Both vendorA and vendorB have outstanding = 0 and unbilled = 0, so they must be completely filtered out!
    const foundA = report.vendors.find(x => x.vendor_partner_id === vendorA.id);
    const foundB = report.vendors.find(x => x.vendor_partner_id === vendorB.id);

    assert.equal(foundA, undefined);
    assert.equal(foundB, undefined);
  });

  test('TC-AGING-E06: Cross-tenant isolation', async () => {
    // Given: AP in otherTenantId
    const asOf = '2026-03-02';
    const otherVendor = await createMockVendor('隔壁租戶供應商', otherTenantId);
    await createMockOpeningPayable(otherVendor.id, 9999, '2026-01-01', '2026-02-01', otherTenantId);

    // When: Querying current tenantId
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    const report = await invoke('get_payables_aging', { as_of_date: asOf });

    // Then: otherVendor must not appear in current tenant report
    const found = report.vendors.find(x => x.vendor_partner_id === otherVendor.id);
    assert.equal(found, undefined);
  });
});
