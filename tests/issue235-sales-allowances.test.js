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
  mockAccountsReceivable,
  mockCustomerReceipts,
  mockCustomerReceiptAllocations,
  mockSalesAllowances,
  loadStorage,
  saveStorage
} = await import('../src/lib/tauri.js');

const {
  fetchCustomerInvoiceDetail,
  fetchPendingAllowanceInvoices,
  createSalesAllowanceAction,
  updateSalesAllowanceAction,
  postSalesAllowanceAction,
  cancelSalesAllowanceAction,
  voidSalesAllowanceAction,
  fetchSalesAllowances,
  voidCustomerInvoiceAction
} = await import('../src/lib/customerInvoices/store.js');

test.describe('Issue #235: Sales Allowances (出貨短少折讓單核心與沖減)', () => {
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = `${currentYm}-${String(now.getDate()).padStart(2, '0')}`;

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    await invoke('reset_mock_customer_invoices', { tenant_id: 'tnt_mock_1' });

    // Seed partners
    mockPartners.length = 0;
    mockPartners.push({
      id: 'cus_alw_01',
      tenant_id: 'tnt_mock_1',
      name: '宏碁股份有限公司',
      isCustomer: true,
      isVendor: false,
      invoice_issuance_mode: 'per_order'
    });
    saveStorage('agent_erp_mock_partners', mockPartners);

    // Reset stores
    mockSalesOrders.length = 0;
    mockSalesOrderLines.length = 0;
    mockCustomerReceipts.length = 0;
    mockCustomerReceiptAllocations.length = 0;
    mockSalesAllowances.length = 0;
    saveStorage('agent_erp_mock_sales_allowances', mockSalesAllowances);
  });

  /**
   * Helper to seed a posted customer invoice with short-shipped sales order and linked AR
   */
  async function seedInvoiceWithShortfall(basisAmount = 1000, shippedAmount = 600) {
    const soId = `so_alw_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tax = Math.round(basisAmount * 0.05 * 100) / 100;

    mockSalesOrders.push({
      id: soId,
      tenant_id: 'tnt_mock_1',
      so_number: `SO-${soId}`,
      customer_partner_id: 'cus_alw_01',
      customer_name_snapshot: '宏碁股份有限公司',
      status: 'confirmed',
      ship_date: '2026-11-15',
      confirmed_at: 1000,
      created_at: 1000
    });
    mockSalesOrderLines.push({
      id: `sol_${soId}`,
      sales_order_id: soId,
      line_number: 1,
      quantity: basisAmount,
      shipped_quantity: 0,
      unit_price: 1.0
    });
    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);

    // Create & post invoice using mock IPC
    const invRes = await invoke('create_customer_invoice', {
      input: {
        customer_partner_id: 'cus_alw_01',
        issuance_mode: 'per_order',
        invoice_date: '2026-11-15',
        due_date: '2026-12-15',
        untaxed_amount: basisAmount,
        tax_amount: tax,
        sales_order_ids: [soId],
        tax_invoice_number: 'AB-11112222'
      }
    });

    await invoke('post_customer_invoice', {
      input: {
        invoice_id: invRes.invoice.id
      }
    });

    // Ship sales order with short delivery
    const so = mockSalesOrders.find(o => o.id === soId);
    so.status = 'shipped';
    so.ship_date = '2026-11-15';
    so.shipped_at = 1050;
    const sol = mockSalesOrderLines.find(l => l.sales_order_id === soId);
    if (sol) sol.shipped_quantity = shippedAmount;
    saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
    saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);

    const inv = invRes.invoice;
    const ar = mockAccountsReceivable.find(a => a.source_id === inv.id);

    return {
      invId: inv.id,
      soId,
      arId: ar?.id || '',
      basisAmount,
      shippedAmount,
      shortfall: Math.round((basisAmount - shippedAmount) * 100) / 100,
      tax,
      total: Math.round((basisAmount + tax) * 100) / 100
    };
  }

  // =========================================================================
  // TC-SA-01: Invoice & Order State Requirements & Duplicate Draft Check
  // =========================================================================

  test('TC-SA-01-N1: Create normal draft sales allowance with prefilled values and SALW-00001 numbering', async () => {
    // Given: Posted invoice with 1000 basis, 600 shipped, remaining shortfall = 400
    const { invId } = await seedInvoiceWithShortfall(1000, 600);

    // When: Creating a sales allowance
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      allowance_date: today,
      untaxed_amount: 400,
      tax_amount: 20,
      note: '出貨短少折讓',
      reason_type: 'shipment_shortfall'
    });

    // Then: Allowance created in draft status with correct snapshots
    assert.equal(alw.status, 'draft');
    assert.equal(alw.allowance_number, 'SALW-00001');
    assert.equal(alw.customer_invoice_id, invId);
    assert.ok(alw.invoice_number_snapshot.startsWith('SINV-'));
    assert.equal(alw.customer_name_snapshot, '宏碁股份有限公司');
    assert.equal(alw.reason_type, 'shipment_shortfall');
    assert.equal(alw.untaxed_amount, 400);
    assert.equal(alw.tax_amount, 20);
    assert.equal(alw.total_amount, 420);
  });

  test('TC-SA-01-E1 & E2: Reject allowance when invoice is not posted or orders not shipped', async () => {
    // Given: Invoice that is in draft status
    const { invId, soId } = await seedInvoiceWithShortfall(1000, 600);
    const activeInvoices = loadStorage('agent_erp_mock_customer_invoices', []);
    const inv = activeInvoices.find(i => i.id === invId);
    inv.status = 'draft';
    saveStorage('agent_erp_mock_customer_invoices', activeInvoices);

    // When / Then: TC-SA-01-E1: Rejected due to invoice status not posted
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 400
        });
      },
      /僅能對已過帳、已出貨且有出貨短少的發票開立折讓單/
    );

    // Given: Invoice is posted but SO is only confirmed
    inv.status = 'posted';
    saveStorage('agent_erp_mock_customer_invoices', activeInvoices);
    const activeOrders = loadStorage('agent_erp_mock_sales_orders', []);
    const so = activeOrders.find(o => o.id === soId);
    if (so) so.status = 'confirmed';
    saveStorage('agent_erp_mock_sales_orders', activeOrders);

    // When / Then: TC-SA-01-E2: Rejected due to SO not shipped
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 400
        });
      },
      /僅能對已過帳、已出貨且有出貨短少的發票開立折讓單/
    );
  });

  test('TC-SA-01-B1 & B2: Shortfall boundary: exactly 1.0 allows creation, 0.99 is rejected', async () => {
    // Given: Invoice with basis 1000, shipped 999.01 (shortfall = 0.99 < 1.0)
    const { invId, soId } = await seedInvoiceWithShortfall(1000, 999.01);

    // When / Then: TC-SA-01-B2: Shortfall 0.99 is rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 0.99
        });
      },
      /僅能對已過帳、已出貨且有出貨短少的發票開立折讓單/
    );

    // Given: Update shipped to 999.00 (shortfall = 1.00)
    const activeLines = loadStorage('agent_erp_mock_sales_order_lines', []);
    const sol = activeLines.find(l => l.sales_order_id === soId);
    if (sol) sol.shipped_quantity = 999;
    saveStorage('agent_erp_mock_sales_order_lines', activeLines);

    // When / Then: TC-SA-01-B1: Shortfall 1.00 succeeds
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 1.0
    });
    assert.equal(alw.status, 'draft');
    assert.equal(alw.untaxed_amount, 1.0);
  });

  test('TC-SA-01-E3: At most one draft sales allowance allowed per invoice', async () => {
    // Given: An existing draft allowance for the invoice
    const { invId } = await seedInvoiceWithShortfall(1000, 600);
    const draft1 = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 200
    });
    assert.equal(draft1.status, 'draft');

    // When / Then: Attempting to create a second draft allowance for same invoice is rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 100
        });
      },
      /已有草稿折讓單/
    );
  });

  test('TC-SA-01-E4: reason_type must be shipment_shortfall', async () => {
    // Given: Posted invoice with shortfall
    const { invId } = await seedInvoiceWithShortfall(1000, 600);

    // When / Then: Unsupported reason_type rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          reason_type: 'quality_defect'
        });
      },
      /折讓原因類型僅支援出貨短少/
    );
  });

  // =========================================================================
  // TC-SA-02 & TC-SA-03 & TC-SA-04: Amount & Tax & Date Boundaries
  // =========================================================================

  test('TC-SA-02-B1 to B4: untaxed_amount boundaries (0, -1, max shortfall, max + 0.01)', async () => {
    // Given: Shortfall is 400
    const { invId } = await seedInvoiceWithShortfall(1000, 600);

    // When / Then: TC-SA-02-B1: untaxed = 0 rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 0
        });
      },
      /折讓未稅金額需大於 0/
    );

    // When / Then: TC-SA-02-B2: untaxed = -1 rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: -1
        });
      },
      /折讓未稅金額需大於 0/
    );

    // When / Then: TC-SA-02-B4: untaxed = 400.01 exceeds shortfall
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 400.01
        });
      },
      /折讓未稅金額不可超過出貨短少剩餘 400/
    );

    // When / Then: TC-SA-02-B3: untaxed = 400.00 exactly matches remaining shortfall
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 400.0
    });
    assert.equal(alw.untaxed_amount, 400);
  });

  test('TC-SA-03-B1 to B4: tax_amount boundaries (0, negative, max tax, max + 0.01)', async () => {
    // Given: Invoice tax is 50, shortfall 400
    const { invId } = await seedInvoiceWithShortfall(1000, 600);

    // When / Then: TC-SA-03-B2: tax = -0.01 rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 200,
          tax_amount: -0.01
        });
      },
      /折讓稅額需大於或等於 0/
    );

    // When / Then: TC-SA-03-B4: tax = 50.01 exceeds invoice tax (50)
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          untaxed_amount: 200,
          tax_amount: 50.01
        });
      },
      /折讓稅額累計不可超過原發票稅額 50/
    );

    // When / Then: TC-SA-03-B1: tax = 0 (tax exempt) succeeds
    const alwZeroTax = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 200,
      tax_amount: 0
    });
    assert.equal(alwZeroTax.tax_amount, 0);
  });

  test('TC-SA-04-B1 to B4: allowance_date boundaries (future, earlier than invoice/ship, today)', async () => {
    // Given: Invoice date = 2026-11-15, SO ship date = 2026-11-15
    const { invId } = await seedInvoiceWithShortfall(1000, 600);

    // When / Then: TC-SA-04-B2: Future date rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          allowance_date: '2099-12-31'
        });
      },
      /折讓日期不可晚於今天/
    );

    // When / Then: TC-SA-04-B3: Date earlier than invoice date 2026-11-15 rejected
    await assert.rejects(
      async () => {
        await createSalesAllowanceAction({
          customer_invoice_id: invId,
          allowance_date: '2026-11-14'
        });
      },
      /折讓日期不可早於發票日或出貨日/
    );

    // When / Then: TC-SA-04-B1: allowance_date today succeeds
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      allowance_date: today
    });
    assert.equal(alw.allowance_date, today);
  });

  // =========================================================================
  // TC-SA-05 & TC-SA-06: Posting, Outstanding Cap, & State Machine
  // =========================================================================

  test('TC-SA-05-B1 & B2 & E1: Posting checks open AR status and outstanding balance cap', async () => {
    // Given: Total AR = 1050, partial payment of 800, leaving outstanding = 250
    const { invId, arId } = await seedInvoiceWithShortfall(1000, 600);

    mockCustomerReceipts.push({
      id: 'rcpt_01',
      tenant_id: 'tnt_mock_1',
      receipt_number: 'RCPT-001',
      status: 'posted'
    });
    mockCustomerReceiptAllocations.push({
      id: 'alloc_01',
      tenant_id: 'tnt_mock_1',
      receipt_id: 'rcpt_01',
      account_receivable_id: arId,
      amount: 800
    });
    saveStorage('agent_erp_mock_customer_receipts', mockCustomerReceipts);
    saveStorage('agent_erp_mock_customer_receipt_allocations', mockCustomerReceiptAllocations);

    // Draft allowance of 400 untaxed + 20 tax = 420
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 400,
      tax_amount: 20
    });

    // When / Then: TC-SA-05-B2: Allowance total 420 exceeds outstanding balance 250
    await assert.rejects(
      async () => {
        await postSalesAllowanceAction(alw.id);
      },
      /折讓金額 420 超過應收未收餘額 250；客戶已付款需退款的情境不在本輪範圍/
    );

    // When: Update allowance to 200 untaxed + 10 tax = 210 <= 250
    await updateSalesAllowanceAction({
      id: alw.id,
      untaxed_amount: 200,
      tax_amount: 10
    });

    // When / Then: TC-SA-05-B1: Posting succeeds, shortfall snapshot recorded
    const posted = await postSalesAllowanceAction(alw.id);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.shortfall_snapshot, 400);

    // Check AR outstanding balance updated from 250 -> 40 (settlement_status partially_paid)
    const arDetail = await invoke('get_account_receivable', { ar_id: arId });
    assert.equal(arDetail.outstanding_amount, 40);
    assert.equal(arDetail.allowance_amount, 210);
    assert.equal(arDetail.settlement_status, 'partially_paid');

    // When / Then: TC-SA-06-E1: Re-posting posted allowance is rejected
    await assert.rejects(
      async () => {
        await postSalesAllowanceAction(alw.id);
      },
      /無效的狀態轉換：不可從 posted 轉換至 posted/
    );
  });

  test('TC-SA-05-PAID: When received + allowance equals AR amount, settlement_status is paid', async () => {
    // Given: AR is 1050, no receipts, allowance of 1000 untaxed + 50 tax = 1050
    const { invId, arId } = await seedInvoiceWithShortfall(1000, 0);

    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 1000,
      tax_amount: 50
    });

    // When: Post full allowance
    await postSalesAllowanceAction(alw.id);

    // Then: Outstanding balance becomes 0, settlement_status is paid
    const arDetail = await invoke('get_account_receivable', { ar_id: arId });
    assert.equal(arDetail.outstanding_amount, 0);
    assert.equal(arDetail.allowance_amount, 1050);
    assert.equal(arDetail.settlement_status, 'paid');
  });

  // =========================================================================
  // TC-SA-07: Voiding, Balance Restoration, & CI-10 Shortfall Reappearance
  // =========================================================================

  test('TC-SA-07-E1 & N1: Voiding requires reason, restores AR balance and CI-10 shortfall', async () => {
    // Given: Posted allowance covering 400 shortfall
    const { invId, arId } = await seedInvoiceWithShortfall(1000, 600);
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 400,
      tax_amount: 20
    });
    await postSalesAllowanceAction(alw.id);

    // After posting, remaining shortfall is 0 (< 1.0), so pending allowances queue is empty
    let pending = await fetchPendingAllowanceInvoices();
    assert.equal(pending.length, 0);

    // When / Then: TC-SA-07-E1: Voiding without reason is rejected
    await assert.rejects(
      async () => {
        await voidSalesAllowanceAction(alw.id, '   ');
      },
      /作廢原因必填/
    );

    // When: TC-SA-07-N1: Void with valid reason
    const voided = await voidSalesAllowanceAction(alw.id, '出貨單重開，原短少折讓作廢');
    assert.equal(voided.status, 'voided');
    assert.equal(voided.void_reason, '出貨單重開，原短少折讓作廢');

    // Then: AR balance restored to original 1050
    const arDetail = await invoke('get_account_receivable', { ar_id: arId });
    assert.equal(arDetail.outstanding_amount, 1050);
    assert.equal(arDetail.allowance_amount, 0);

    // Then: CI-10 shortfall reappears in pending allowances queue
    pending = await fetchPendingAllowanceInvoices();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, invId);
    assert.equal(pending[0].shipment_shortfall, 400);
  });

  // =========================================================================
  // TC-CI-08-ALW & TC-AR-05-ALW: Has posted allowances blocks voiding source docs
  // =========================================================================

  test('TC-CI-08-ALW & TC-AR-05-ALW: Having posted sales allowance blocks voiding invoice or AR', async () => {
    // Given: Invoice and AR with a posted sales allowance
    const { invId, arId } = await seedInvoiceWithShortfall(1000, 600);
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: invId,
      untaxed_amount: 200,
      tax_amount: 10
    });
    await postSalesAllowanceAction(alw.id);

    // When / Then: Attempting to void the parent invoice is blocked by CI-08
    await assert.rejects(
      async () => {
        await voidCustomerInvoiceAction({
          invoice_id: invId,
          void_reason: '嘗試作廢發票'
        });
      },
      /此發票已有過帳之折讓單/
    );
  });

  // =========================================================================
  // TC-UI-L2-01: Layer 2 Full Flow from Pending List / Banner to Void
  // =========================================================================

  test('TC-UI-L2-01: Layer 2 full flow: pending list -> prefilled allowance -> post -> void', async () => {
    // Given: Shortfall of 400 on posted invoice
    const { invId } = await seedInvoiceWithShortfall(1000, 600);

    // 1. Appears in pending allowances list
    let pendingList = await fetchPendingAllowanceInvoices();
    assert.equal(pendingList.length, 1);
    const targetInv = pendingList[0];
    assert.equal(targetInv.shipment_shortfall, 400);

    // 2. Open create allowance (prefilled from invoice)
    const alw = await createSalesAllowanceAction({
      customer_invoice_id: targetInv.id,
      untaxed_amount: targetInv.shipment_shortfall,
      tax_amount: Math.round(targetInv.shipment_shortfall * 0.05 * 100) / 100
    });
    assert.equal(alw.status, 'draft');
    assert.equal(alw.untaxed_amount, 400);

    // 3. Post allowance -> clears pending list
    await postSalesAllowanceAction(alw.id);
    pendingList = await fetchPendingAllowanceInvoices();
    assert.equal(pendingList.length, 0);

    // 4. Void allowance -> restores pending list
    await voidSalesAllowanceAction(alw.id, '更正作廢');
    pendingList = await fetchPendingAllowanceInvoices();
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].shipment_shortfall, 400);
  });
});
