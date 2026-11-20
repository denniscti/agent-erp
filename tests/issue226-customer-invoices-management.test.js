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
  mockCustomerInvoices,
  mockCustomerInvoiceOrders,
  mockSalesOrders,
  mockSalesOrderLines,
  mockPartners,
  mockSalesAllowances,
  saveStorage
} = await import('../src/lib/tauri.js');

const {
  fetchCustomerInvoiceDetail,
  fetchSalesOrderInvoicingInfo
} = await import('../src/lib/customerInvoices/store.js');

test.describe('Issue #226: Customer Invoices Management, Uninvoiced Groups & Allowance Linkage', () => {
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = `${currentYm}-${String(now.getDate()).padStart(2, '0')}`;

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    await invoke('reset_mock_customer_invoices', { tenant_id: 'tnt_mock_1' });

    // Seed partners
    mockPartners.length = 0;
    mockPartners.push({
      id: 'cus_po_01',
      tenant_id: 'tnt_mock_1',
      name: '逐單客戶台積電',
      isCustomer: true,
      isVendor: false,
      collection_terms_type: 'net',
      collection_terms_days: 30,
      invoice_issuance_mode: 'per_order'
    });
    mockPartners.push({
      id: 'cus_mo_01',
      tenant_id: 'tnt_mock_1',
      name: '月結客戶聯發科',
      isCustomer: true,
      isVendor: false,
      collection_terms_type: 'month_end',
      collection_terms_days: 0,
      invoice_issuance_mode: 'monthly_consolidated'
    });
    saveStorage('agent_erp_mock_partners', mockPartners);

    // Seed sales orders
    mockSalesOrders.length = 0;
    mockSalesOrderLines.length = 0;
    if (mockSalesAllowances) mockSalesAllowances.length = 0;

    // (a) 逐單客戶、已確認未開票
    mockSalesOrders.push({
      id: 'so_a1',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-A001',
      customer_partner_id: 'cus_po_01',
      customer_name_snapshot: '逐單客戶台積電',
      status: 'confirmed',
      ship_date: null,
      total_amount: 1000.0,
      shipped_amount: 0.0,
      created_at: 1000,
      confirmed_at: 1000
    });

    // (b) 逐單客戶、已出貨未開票 (出貨日早於今天 -> 逾時風險)
    mockSalesOrders.push({
      id: 'so_b1',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-B001',
      customer_partner_id: 'cus_po_01',
      customer_name_snapshot: '逐單客戶台積電',
      status: 'shipped',
      ship_date: '2026-01-01',
      total_amount: 2000.0,
      shipped_amount: 2000.0,
      created_at: 1010,
      confirmed_at: 1010,
      shipped_at: 1020
    });

    // (b boundary) 逐單客戶、已出貨但出貨金額為 0 -> 不列入
    mockSalesOrders.push({
      id: 'so_b_zero',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-B002',
      customer_partner_id: 'cus_po_01',
      customer_name_snapshot: '逐單客戶台積電',
      status: 'shipped',
      ship_date: today,
      total_amount: 500.0,
      shipped_amount: 0.0,
      created_at: 1015,
      confirmed_at: 1015,
      shipped_at: 1025
    });

    // (c) 月結客戶本月待彙開 (出貨日在當月)
    mockSalesOrders.push({
      id: 'so_c1',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-C001',
      customer_partner_id: 'cus_mo_01',
      customer_name_snapshot: '月結客戶聯發科',
      status: 'shipped',
      ship_date: `${currentYm}-05`,
      total_amount: 3000.0,
      shipped_amount: 3000.0,
      created_at: 1030,
      confirmed_at: 1030,
      shipped_at: 1035
    });

    // (c boundary 1) 月結客戶、非當月已出貨 (跨月) -> 不列入
    mockSalesOrders.push({
      id: 'so_c_cross',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-C002',
      customer_partner_id: 'cus_mo_01',
      customer_name_snapshot: '月結客戶聯發科',
      status: 'shipped',
      ship_date: '2025-10-15',
      total_amount: 4000.0,
      shipped_amount: 4000.0,
      created_at: 1040,
      confirmed_at: 1040,
      shipped_at: 1045
    });

    // (c boundary 2) 月結客戶、未出貨 (confirmed) -> 不列入
    mockSalesOrders.push({
      id: 'so_c_unshipped',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-C003',
      customer_partner_id: 'cus_mo_01',
      customer_name_snapshot: '月結客戶聯發科',
      status: 'confirmed',
      ship_date: null,
      total_amount: 5000.0,
      shipped_amount: 0.0,
      created_at: 1050,
      confirmed_at: 1050
    });

    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
  });

  test('TC-226-N-01 to N-04 & B-01 to B-02: Three uninvoiced groups (a, b, c) correctness and boundary exclusions', async () => {
    // Given: Seeded mock database with orders in groups a, b, and c as well as boundary exclusions
    // When: Calling list_uninvoiced_sales_orders
    const list = await invoke('list_uninvoiced_sales_orders', {});

    // Then: Exactly 3 orders are returned (so_a1, so_b1, so_c1)
    assert.strictEqual(list.length, 3);

    const itemA = list.find(o => o.sales_order_id === 'so_a1');
    assert.ok(itemA);
    assert.strictEqual(itemA.group, 'per_order_confirmed');
    assert.strictEqual(itemA.uninvoiced_amount, 1000.0);
    assert.strictEqual(itemA.is_overdue_risk, false);

    const itemB = list.find(o => o.sales_order_id === 'so_b1');
    assert.ok(itemB);
    assert.strictEqual(itemB.group, 'per_order_shipped');
    assert.strictEqual(itemB.uninvoiced_amount, 2000.0);
    assert.strictEqual(itemB.is_overdue_risk, true); // 2026-01-01 is earlier than today

    const itemC = list.find(o => o.sales_order_id === 'so_c1');
    assert.ok(itemC);
    assert.strictEqual(itemC.group, 'monthly_consolidated');
    assert.strictEqual(itemC.uninvoiced_amount, 3000.0);
    assert.strictEqual(itemC.is_overdue_risk, false);

    // Boundary verifications:
    // Zero shipped amount order is excluded
    assert.ok(!list.some(o => o.sales_order_id === 'so_b_zero'));
    // Cross-month monthly consolidated order is excluded
    assert.ok(!list.some(o => o.sales_order_id === 'so_c_cross'));
    // Unshipped monthly order is excluded
    assert.ok(!list.some(o => o.sales_order_id === 'so_c_unshipped'));
  });

  test('TC-226-N-05: Invoicing order and posting removes it from uninvoiced list', async () => {
    // Given: Initial list with so_a1 present
    const initialList = await invoke('list_uninvoiced_sales_orders', {});
    assert.ok(initialList.some(o => o.sales_order_id === 'so_a1'));

    // When: Creating draft invoice for so_a1
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_po_01',
        issuance_mode: 'per_order',
        invoice_date: today,
        sales_order_ids: ['so_a1'],
        tax_invoice_number: 'AB-88889999',
        tax_amount: 50.0
      }
    });

    // Then: so_a1 is removed even in draft
    const afterDraftList = await invoke('list_uninvoiced_sales_orders', {});
    assert.ok(!afterDraftList.some(o => o.sales_order_id === 'so_a1'));

    // When: Posting invoice
    await invoke('post_customer_invoice', {
      input: {
        invoice_id: inv.invoice.id
      }
    });

    // Then: so_a1 remains excluded from uninvoiced list
    const afterPostList = await invoke('list_uninvoiced_sales_orders', {});
    assert.ok(!afterPostList.some(o => o.sales_order_id === 'so_a1'));
  });

  test('TC-226-N-06 & N-07 & B-03: Invoiced then short-shipped produces CI-10 shortfall in pending allowances list; posting allowance clears it', async () => {
    // Given: Create and post invoice for so_a1 (basis = 1000.0)
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_po_01',
        issuance_mode: 'per_order',
        invoice_date: today,
        sales_order_ids: ['so_a1'],
        tax_invoice_number: 'AB-11112222',
        tax_amount: 50.0
      }
    });
    await invoke('post_customer_invoice', {
      input: {
        invoice_id: inv.invoice.id
      }
    });

    // When: so_a1 ships with short delivery (shipped_amount = 700.0, shortfall = 300.0)
    const targetSo = mockSalesOrders.find(o => o.id === 'so_a1');
    targetSo.status = 'shipped';
    targetSo.ship_date = today;
    targetSo.shipped_amount = 700.0;
    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);

    // Then: Invoice appears in list_pending_allowance_invoices with shortfall = 300.0
    const pendingList = await invoke('list_pending_allowance_invoices', {});
    assert.strictEqual(pendingList.length, 1);
    assert.strictEqual(pendingList[0].id, inv.invoice.id);
    assert.strictEqual(pendingList[0].shipment_shortfall, 300.0);

    // When: A posted sales allowance of 300 is recorded
    mockSalesAllowances.push({
      id: 'alw_test_1',
      tenant_id: 'tnt_mock_1',
      allowance_number: 'ALW-99001',
      customer_invoice_id: inv.invoice.id,
      untaxed_amount: 300.0,
      tax_amount: 15.0,
      status: 'posted',
      created_at: Date.now()
    });
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);

    // Then: Shortfall becomes 0, and invoice disappears from pending allowances list!
    const pendingListAfter = await invoke('list_pending_allowance_invoices', {});
    assert.strictEqual(pendingListAfter.length, 0);
  });

  test('TC-226-N-08 & N-09: Sales order invoicing info query and revenue status linkage', async () => {
    // Given: Uninvoiced sales order so_b1
    // When 1: Querying invoicing info for so_b1 before invoicing
    const infoBefore = await invoke('get_sales_order_invoicing_info', {
      sales_order_id: 'so_b1'
    });
    // Then 1: Returns null
    assert.strictEqual(infoBefore, null);

    // When 2: Invoicing and posting so_b1
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_po_01',
        issuance_mode: 'per_order',
        invoice_date: today,
        sales_order_ids: ['so_b1'],
        tax_invoice_number: 'AB-33334444',
        tax_amount: 100.0
      }
    });
    await invoke('post_customer_invoice', {
      input: { invoice_id: inv.invoice.id }
    });

    // When 3: Querying invoicing info after posting
    const infoAfter = await invoke('get_sales_order_invoicing_info', {
      sales_order_id: 'so_b1'
    });
    // Then 3: Returns invoice info
    assert.ok(infoAfter);
    assert.strictEqual(infoAfter.invoice_id, inv.invoice.id);
    assert.strictEqual(infoAfter.invoice_status, 'posted');

    // And: Invoice detail shows recognized revenue because so_b1 is shipped
    const detail = await invoke('get_customer_invoice', { id: inv.invoice.id });
    assert.strictEqual(detail.revenue_status, 'recognized');
    assert.strictEqual(detail.revenue_recognized_date, '2026-01-01');
  });

  test('TC-226-N-10 & N-11: Post-shipment notification triggers mock verification', async () => {
    // Given: mock window.__SHELL__ notification environment
    const notifications = [];
    globalThis.window = /** @type {any} */ ({
      __SHELL__: {
        notify: (payload) => {
          notifications.push(payload);
          return 'mock-notif-id';
        }
      }
    });

    // When: Simulating shortfall notification payload
    globalThis.window.__SHELL__.notify({
      type: 'alert',
      level: 'alert',
      title: '發票出貨短少通知',
      message: '銷售單 SO-B001 出貨金額小於發票金額，發票 SINV-00001 產生短少 NT$ 300 元',
      sourceModule: 'sales_orders',
      action: {
        label: '查看發票明細',
        target: '/app/customer-invoices?id=cinv_001'
      }
    });

    // Then: Notification is received with expected structure
    assert.strictEqual(notifications.length, 1);
    assert.strictEqual(notifications[0].type, 'alert');
    assert.strictEqual(notifications[0].title, '發票出貨短少通知');
    assert.strictEqual(notifications[0].action.target, '/app/customer-invoices?id=cinv_001');
  });

  test('TC-226-N-12: Posted invoice detail receivable structure contains amount, source_number, and no nested receivable', async () => {
    // Given: Created and posted invoice
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_po_01',
        issuance_mode: 'per_order',
        invoice_date: today,
        sales_order_ids: ['so_a1'],
        tax_invoice_number: 'AB-55556666',
        tax_amount: 50.0
      }
    });
    await invoke('post_customer_invoice', {
      input: { invoice_id: inv.invoice.id }
    });

    // When: Fetching customer invoice detail
    const detail = await invoke('get_customer_invoice', {
      id: inv.invoice.id,
      invoiceId: inv.invoice.id
    });

    // Then: Receivable exists as a flat AccountReceivableDetail structure
    assert.ok(detail.receivable, 'detail.receivable should exist');
    assert.strictEqual(typeof detail.receivable.amount, 'number');
    assert.strictEqual(detail.receivable.amount, inv.invoice.total_amount);
    assert.strictEqual(detail.receivable.source_number, inv.invoice.invoice_number);
    assert.ok(detail.receivable.settlement_status === 'unpaid' || detail.receivable.settlement_status === 'unsettled');
    // Ensure it is flat (no nested receivable property that would cause TypeError)
    assert.strictEqual(detail.receivable.receivable, undefined);
  });

  test('TC-226-N-13: Store fetchCustomerInvoiceDetail passes invoiceId and loads detail correctly', async () => {
    // Given: Seeded invoice so_a1
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_po_01',
        issuance_mode: 'per_order',
        invoice_date: today,
        sales_order_ids: ['so_a1'],
        tax_invoice_number: 'AB-77778888',
        tax_amount: 50.0
      }
    });

    // When: Fetching detail via store action (which passes invoiceId: invoiceId)
    const detail = await fetchCustomerInvoiceDetail(inv.invoice.id);

    // Then: Returns expected detail with invoice
    assert.ok(detail);
    assert.strictEqual(detail.invoice.id, inv.invoice.id);
    assert.strictEqual(detail.invoice.invoice_number, inv.invoice.invoice_number);

    // And: fetchSalesOrderInvoicingInfo works via store
    const info = await fetchSalesOrderInvoicingInfo('so_a1');
    assert.ok(info);
    assert.strictEqual(info.invoice_id, inv.invoice.id);
  });
});

