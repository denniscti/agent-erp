import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invoke,
  mockCustomerInvoices,
  mockCustomerInvoiceOrders,
  mockSalesOrders,
  mockSalesOrderLines,
  mockPartners,
  mockAccountsReceivable,
  mockCustomerReceipts,
  mockCustomerReceiptAllocations,
  saveStorage
} from '../src/lib/tauri.js';

test.describe('Issue #223: Customer Invoices & Accounts Receivable Creation', () => {
  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    await invoke('reset_mock_customer_invoices', { tenant_id: 'tnt_mock_1' });

    // Clear and seed test partners
    mockPartners.length = 0;
    mockPartners.push({
      id: 'cus_001',
      tenant_id: 'tnt_mock_1',
      name: '台積電',
      isCustomer: true,
      isVendor: false,
      collection_terms_type: 'net',
      collection_terms_days: 30,
      invoice_issuance_mode: 'per_order'
    });
    mockPartners.push({
      id: 'cus_monthly',
      tenant_id: 'tnt_mock_1',
      name: '聯發科',
      isCustomer: true,
      isVendor: false,
      collection_terms_type: 'month_end',
      collection_terms_days: 0,
      invoice_issuance_mode: 'monthly_consolidated'
    });
    saveStorage('agent_erp_mock_partners', mockPartners);

    // Clear and seed test sales orders
    mockSalesOrders.length = 0;
    mockSalesOrderLines.length = 0;
    if (mockCustomerReceipts) mockCustomerReceipts.length = 0;
    if (mockCustomerReceiptAllocations) mockCustomerReceiptAllocations.length = 0;

    mockSalesOrders.push({
      id: 'so_1',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-00001',
      customer_partner_id: 'cus_001',
      customer_name_snapshot: '台積電',
      status: 'confirmed',
      ship_date: null,
      total_amount: 1000.0,
      shipped_amount: 0.0,
      created_at: 1000,
      confirmed_at: 1000
    });

    mockSalesOrders.push({
      id: 'so_2',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-00002',
      customer_partner_id: 'cus_001',
      customer_name_snapshot: '台積電',
      status: 'confirmed',
      ship_date: null,
      total_amount: 1500.0,
      shipped_amount: 0.0,
      created_at: 1010,
      confirmed_at: 1010
    });

    mockSalesOrders.push({
      id: 'so_m1',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-M0001',
      customer_partner_id: 'cus_monthly',
      customer_name_snapshot: '聯發科',
      status: 'shipped',
      ship_date: '2026-11-10',
      total_amount: 500.0,
      shipped_amount: 500.0,
      created_at: 1020,
      confirmed_at: 1020,
      shipped_at: 1030
    });

    mockSalesOrders.push({
      id: 'so_m2',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-M0002',
      customer_partner_id: 'cus_monthly',
      customer_name_snapshot: '聯發科',
      status: 'shipped',
      ship_date: '2026-11-15',
      total_amount: 400.0,
      shipped_amount: 400.0,
      created_at: 1040,
      confirmed_at: 1040,
      shipped_at: 1050
    });

    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
  });

  test('TC-CI-01-N1 & N2: per_order & monthly_consolidated creation and derived revenue status', async () => {
    // Given: Seeded customer and orders
    // When: Creating per_order invoice with so_1
    const inv1 = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        sales_order_ids: ['so_1'],
        tax_amount: 50.0
      }
    });

    // Then: untaxed defaulted to basis (1000.0), total = 1050, revenue_status = deferred
    assert.strictEqual(inv1.invoice.invoice_number, 'SINV-00001');
    assert.strictEqual(inv1.invoice.issuance_mode, 'per_order');
    assert.strictEqual(inv1.invoice.untaxed_amount, 1000.0);
    assert.strictEqual(inv1.invoice.total_amount, 1050.0);
    assert.strictEqual(inv1.revenue_status, 'deferred');
    assert.strictEqual(inv1.revenue_recognized_date, null);

    // When: Creating monthly_consolidated invoice with so_m1 and so_m2
    const inv2 = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_monthly',
        issuance_mode: 'monthly_consolidated',
        invoice_date: '2026-11-16',
        sales_order_ids: ['so_m1', 'so_m2'],
        tax_amount: 45.0
      }
    });

    // Then: untaxed = 900.0, total = 945, revenue_status = recognized, recognized_date = 2026-11-15
    assert.strictEqual(inv2.invoice.invoice_number, 'SINV-00002');
    assert.strictEqual(inv2.invoice.untaxed_amount, 900.0);
    assert.strictEqual(inv2.revenue_status, 'recognized');
    assert.strictEqual(inv2.revenue_recognized_date, '2026-11-15');
  });

  test('TC-CI-01-E1 to E4: order attachment guards', async () => {
    // When / Then: TC-CI-01-E1: per_order limit (max 1)
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2026-11-10',
            sales_order_ids: ['so_1', 'so_2'],
            untaxed_amount: 2500.0
          }
        });
      },
      { message: '逐單開立僅能涵蓋一張銷售單' }
    );

    // When / Then: TC-CI-01-E2: monthly_consolidated with confirmed order
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            issuance_mode: 'monthly_consolidated',
            invoice_date: '2026-11-10',
            sales_order_ids: ['so_1'],
            untaxed_amount: 1000.0
          }
        });
      },
      { message: '月結彙開僅能涵蓋已出貨的銷售單' }
    );

    // When / Then: TC-CI-01-E3: wrong customer
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2026-11-10',
            sales_order_ids: ['so_m1'],
            untaxed_amount: 500.0
          }
        });
      },
      { message: '僅能為同一客戶、已確認或已出貨的銷售單開立發票' }
    );

    // When: Creating invoice 1 covering so_1
    const inv1 = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        sales_order_ids: ['so_1'],
        untaxed_amount: 1000.0
      }
    });

    // When / Then: TC-CI-01-E4: duplicate coverage across active invoices
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2026-11-10',
            sales_order_ids: ['so_1'],
            untaxed_amount: 1000.0
          }
        });
      },
      { message: '銷售單 SO-00001 已在發票 SINV-00001 中' }
    );

    // When: TC-CI-01-N3: Cancelling inv1 allows re-covering so_1
    await invoke('cancel_customer_invoice', { invoice_id: inv1.invoice.id });
    const inv_re = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        sales_order_ids: ['so_1'],
        untaxed_amount: 1000.0
      }
    });
    assert.ok(inv_re.invoice.id);
  });

  test('TC-CI-02 to 04: validation boundaries', async () => {
    // When / Then: CI-02: invoice_date in future
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2099-01-01',
            untaxed_amount: 100.0
          }
        });
      },
      { message: '發票日期不可晚於今天' }
    );

    // When / Then: CI-03: due_date earlier than invoice_date
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2026-11-10',
            due_date: '2026-11-09',
            untaxed_amount: 100.0
          }
        });
      },
      { message: '到期日不可早於發票日期' }
    );

    // When / Then: CI-04: untaxed_amount <= 0
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2026-11-10',
            untaxed_amount: 0.0
          }
        });
      },
      { message: '未稅金額必須大於 0' }
    );

    // When / Then: CI-04: tax_amount < 0
    await assert.rejects(
      async () => {
        await invoke('create_customer_invoice', {
          input: {
            customer_partner_id: 'cus_001',
            invoice_date: '2026-11-10',
            untaxed_amount: 100.0,
            tax_amount: -0.01
          }
        });
      },
      { message: '銷項稅額不可小於 0' }
    );
  });

  test('TC-CI-05 to 07: post difference, tax invoice validation, and AR creation', async () => {
    // Given: Draft invoice with untaxed = 1001.0, basis = 1000.0 (diff = 1.0)
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        untaxed_amount: 1001.0,
        tax_amount: 50.0,
        sales_order_ids: ['so_1']
      }
    });

    // When / Then: TC-CI-05-B2: post diff >= 1.0 without difference_note
    await assert.rejects(
      async () => {
        await invoke('post_customer_invoice', {
          input: {
            invoice_id: inv.invoice.id,
            tax_invoice_number: 'AB-12345678'
          }
        });
      },
      { message: '發票未稅金額與比對基準差 1，需填寫差異說明' }
    );

    // When / Then: TC-CI-06-B1: neither tax invoice number nor exemption reason
    await assert.rejects(
      async () => {
        await invoke('post_customer_invoice', {
          input: {
            invoice_id: inv.invoice.id,
            difference_note: '客戶議價調整'
          }
        });
      },
      { message: '請登錄統一發票號碼，或選擇免開立原因' }
    );

    // When / Then: TC-CI-06-B3: exemption reason "other" without note
    await assert.rejects(
      async () => {
        await invoke('post_customer_invoice', {
          input: {
            invoice_id: inv.invoice.id,
            tax_invoice_exemption_reason: 'other',
            difference_note: '客戶議價調整'
          }
        });
      },
      { message: '選擇其他免開立原因時備註為必填' }
    );

    // When: TC-CI-07-N1: Post invoice with difference_note and tax_invoice_number
    const posted = await invoke('post_customer_invoice', {
      input: {
        invoice_id: inv.invoice.id,
        tax_invoice_number: 'AB-12345678',
        difference_note: '客戶議價調整'
      }
    });

    // Then: Invoice is posted, AR is created in same tenant
    assert.strictEqual(posted.invoice.status, 'posted');
    assert.strictEqual(posted.invoice.basis_amount, 1000.0);
    assert.strictEqual(posted.invoice.difference_amount, 1.0);
    assert.ok(posted.receivable);
    assert.strictEqual(posted.receivable.amount, 1051.0); // 1001 + 50
    assert.strictEqual(posted.receivable.source_type, 'customer_invoice');
    assert.strictEqual(posted.receivable.external_reference, 'AB-12345678');

    // When / Then: TC-CI-06-E1: Duplicate tax invoice number in same tenant
    const inv2 = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        untaxed_amount: 1500.0,
        tax_amount: 75.0,
        sales_order_ids: ['so_2']
      }
    });

    await assert.rejects(
      async () => {
        await invoke('post_customer_invoice', {
          input: {
            invoice_id: inv2.invoice.id,
            tax_invoice_number: 'AB-12345678'
          }
        });
      },
      { message: '發票號碼 AB-12345678 已登錄於 SINV-00001' }
    );
  });

  test('TC-CI-08: void guards and AR synchronization', async () => {
    // Given: Posted invoice
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        untaxed_amount: 1000.0,
        tax_amount: 50.0,
        sales_order_ids: ['so_1']
      }
    });

    await invoke('post_customer_invoice', {
      input: {
        invoice_id: inv.invoice.id,
        tax_invoice_number: 'AB-88889999'
      }
    });

    // When / Then: TC-CI-08-B1: void_reason empty
    await assert.rejects(
      async () => {
        await invoke('void_customer_invoice', {
          invoice_id: inv.invoice.id,
          void_reason: '   '
        });
      },
      { message: '作廢原因為必填' }
    );

    // When: TC-CI-08-N1: Void posted invoice
    const voided = await invoke('void_customer_invoice', {
      invoice_id: inv.invoice.id,
      void_reason: '客戶開票資料填寫錯誤'
    });

    // Then: Invoice status is voided, AR status is voided
    assert.strictEqual(voided.invoice.status, 'voided');
    assert.strictEqual(voided.invoice.void_reason, '客戶開票資料填寫錯誤');

    const ar = mockAccountsReceivable.find(a => a.source_id === inv.invoice.id);
    assert.ok(ar);
    assert.strictEqual(ar.status, 'voided');
    assert.strictEqual(ar.void_reason, '客戶開票資料填寫錯誤');

    // Given: Another posted invoice with AR having receipt allocations
    const inv2 = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        untaxed_amount: 1500.0,
        tax_amount: 75.0,
        sales_order_ids: ['so_2']
      }
    });
    await invoke('post_customer_invoice', {
      input: {
        invoice_id: inv2.invoice.id,
        tax_invoice_number: 'AB-77778888'
      }
    });
    const ar2 = mockAccountsReceivable.find(a => a.source_id === inv2.invoice.id);
    assert.ok(ar2);

    // Given: A receipt with status 'posted' and allocation
    mockCustomerReceipts.push({
      id: 'rec_42',
      tenant_id: 'tnt_mock_1',
      receipt_number: 'REC-00042',
      status: 'posted',
      receipt_date: '2026-11-12'
    });
    mockCustomerReceiptAllocations.push({
      id: 'ra_1',
      tenant_id: 'tnt_mock_1',
      receipt_id: 'rec_42',
      account_receivable_id: ar2.id,
      amount: 500.0,
      created_at: 1060
    });

    // When / Then: TC-CI-08-E1: Attempting to void invoice with posted receipt is blocked with dynamic receipt_number
    await assert.rejects(
      async () => {
        await invoke('void_customer_invoice', {
          invoice_id: inv2.invoice.id,
          void_reason: '測試作廢'
        });
      },
      { message: '此發票已有收款核銷：REC-00042，請先作廢收款單' }
    );

    // When / Then: TC-CI-08-E2: Once receipt is voided, voiding customer invoice succeeds
    mockCustomerReceipts.find(r => r.id === 'rec_42').status = 'voided';
    const voided2 = await invoke('void_customer_invoice', {
      invoice_id: inv2.invoice.id,
      void_reason: '作廢收款後成功作廢發票'
    });
    assert.strictEqual(voided2.invoice.status, 'voided');
    assert.strictEqual(voided2.invoice.void_reason, '作廢收款後成功作廢發票');
  });

  test('TC-SO-14: cancel_sales_order blocked by active invoice', async () => {
    // Given: so_1 covered by draft invoice
    const inv = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        untaxed_amount: 1000.0,
        tax_amount: 50.0,
        sales_order_ids: ['so_1']
      }
    });

    // When / Then: Cancelling so_1 is blocked with SO-14 error
    await assert.rejects(
      async () => {
        await invoke('cancel_sales_order', { order_id: 'so_1' });
      },
      { message: '銷售單 SO-00001 已開立發票 SINV-00001，請先作廢或取消發票' }
    );

    // When: Invoice is cancelled
    await invoke('cancel_customer_invoice', { invoice_id: inv.invoice.id });

    // Then: Cancel sales order now succeeds
    const cancelledSo = await invoke('cancel_sales_order', { order_id: 'so_1' });
    assert.strictEqual(cancelledSo.order.status, 'cancelled');
  });

  test('TC-CI-REVIEW: sales order with mock lines correctly calculates basis amount in mock', async () => {
    // Given: Sales order without total_amount on raw object, only lines in mockSalesOrderLines (5 x 450 = 2250)
    mockSalesOrders.push({
      id: 'so_review_lines',
      tenant_id: 'tnt_mock_1',
      so_number: 'SO-REVIEW-001',
      customer_partner_id: 'cus_001',
      customer_name_snapshot: '台積電',
      status: 'confirmed',
      ship_date: null,
      created_at: 1050,
      confirmed_at: 1050
    });
    mockSalesOrderLines.push({
      id: 'sol_review_1',
      sales_order_id: 'so_review_lines',
      line_no: 1,
      quantity: 5,
      shipped_quantity: null,
      unit_price: 450.0
    });

    // When: Query uninvoiced sales orders
    const uninvoiced = await invoke('list_uninvoiced_sales_orders', {
      customer_partner_id: 'cus_001',
      issuance_mode: 'per_order'
    });
    const found = uninvoiced.find(o => o.sales_order_id === 'so_review_lines');

    // Then: Total amount is computed from lines (2250)
    assert.ok(found);
    assert.strictEqual(found.total_amount, 2250.0);

    // When: Create customer invoice without explicit untaxed_amount
    const created = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_001',
        invoice_date: '2026-11-10',
        sales_order_ids: ['so_review_lines']
      }
    });

    // Then: untaxed_amount defaults to basis_amount (2250)
    assert.strictEqual(created.invoice.untaxed_amount, 2250.0);
    assert.strictEqual(created.orders[0].total_amount, 2250.0);

    // When: Post customer invoice
    const posted = await invoke('post_customer_invoice', {
      input: {
        invoice_id: created.invoice.id,
        tax_invoice_number: 'ZZ-99887766'
      }
    });

    // Then: Invoice is posted, basis_amount is 2250, difference is 0, AR created with 2250 + tax
    assert.strictEqual(posted.invoice.status, 'posted');
    assert.strictEqual(posted.invoice.basis_amount, 2250.0);
    assert.strictEqual(posted.invoice.difference_amount, 0.0);
  });
});
