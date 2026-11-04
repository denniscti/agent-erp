import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';
import { calculateDueDate } from '../src/lib/paymentTerms.js';

test.describe('Issue #200: Opening Payables (期初應付帳款) Automated Tests', () => {
  const tenantId = 'tnt_mock_1';
  let testVendor;
  let vendorWithTermsNet30;
  let vendorWithTermsMonthEnd15;
  let inactiveVendor;
  let customerPartner;
  let seq = 0;

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_opening_payables', { tenant_id: tenantId });

    // Seed partners
    seq++;
    const randomSuffix = `${Date.now()}_${seq}_${Math.floor(Math.random() * 100000)}`;

    testVendor = await invoke('create_partner', {
      name: `期初測試供應商_${randomSuffix}`,
      isVendor: true
    });

    vendorWithTermsNet30 = await invoke('create_partner', {
      name: `條件供應商_Net30_${randomSuffix}`,
      isVendor: true,
      paymentTermsType: 'net',
      paymentTermsDays: 30
    });

    vendorWithTermsMonthEnd15 = await invoke('create_partner', {
      name: `條件供應商_MonthEnd15_${randomSuffix}`,
      isVendor: true,
      paymentTermsType: 'month_end',
      paymentTermsDays: 15
    });

    inactiveVendor = await invoke('create_partner', {
      name: `停用測試供應商_${randomSuffix}`,
      isVendor: true
    });
    await invoke('update_partner', {
      id: inactiveVendor.id,
      name: inactiveVendor.name,
      isVendor: true,
      isActive: false
    });

    customerPartner = await invoke('create_partner', {
      name: `客戶夥伴_${randomSuffix}`,
      isCustomer: true,
      isVendor: false
    });
  });

  // ==========================================
  // Normal Cases (TC-OAP-N-01 to TC-OAP-N-06)
  // ==========================================

  test('TC-OAP-N-01: create opening payable for vendor without PO generates OAP number, status open, and creates AP', async () => {
    // Given: Active tenant and active vendor without purchase orders
    const input = {
      vendor_partner_id: testVendor.id,
      original_reference: 'INV-OLD-001',
      document_date: '2026-01-10',
      due_date: '2026-02-10',
      amount: 15000,
      note: '導入前舊系統未付款項'
    };

    // When: Creating opening payable
    const detail = await invoke('create_opening_payable', { input });

    // Then: Returns opening payable with OAP-00001, status open, and linked AP
    assert.ok(detail);
    assert.equal(detail.opening_payable.opening_number, 'OAP-00001');
    assert.equal(detail.opening_payable.status, 'open');
    assert.equal(detail.opening_payable.vendor_partner_id, testVendor.id);
    assert.equal(detail.opening_payable.amount, 15000);
    assert.ok(detail.account_payable_id);

    // Verify AP exists in list_accounts_payable
    const apList = await invoke('list_accounts_payable', { vendor_partner_id: testVendor.id });
    const ap = apList.find(a => a.source_number === 'OAP-00001');
    assert.ok(ap);
    assert.equal(ap.source_type, 'opening_balance');
    assert.equal(ap.amount, 15000);
    assert.equal(ap.status, 'open');
  });

  test('TC-OAP-N-02: create opening payable for vendor with PO when document_date is earlier than earliest PO date', async () => {
    // Given: Vendor has a purchase order created on 2026-11-02
    const vendorWithPo = await invoke('create_partner', {
      name: `PO供應商_${Date.now()}`,
      isVendor: true
    });
    const po = await invoke('create_purchase_order', {
      vendorPartnerId: vendorWithPo.id,
      currency: 'TWD',
      created_at: 1793613600 // 2026-11-02
    });

    // When: Creating opening payable with document_date = 2026-10-15 (< 2026-11-02)
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorWithPo.id,
        original_reference: 'OLD-PO-REF-01',
        document_date: '2026-10-15',
        due_date: '2026-11-15',
        amount: 8000
      }
    });

    // Then: Created successfully
    assert.ok(detail);
    assert.equal(detail.opening_payable.status, 'open');
    assert.equal(detail.opening_payable.amount, 8000);
  });

  test('TC-OAP-N-03: vendor payment terms Net 30 automatically calculates prefilled due date', async () => {
    // Given: Vendor with Net 30 terms
    const docDate = '2026-01-10';

    // When: Calculating due date using paymentTerms helper
    const calculatedDueDate = calculateDueDate(
      docDate,
      vendorWithTermsNet30.payment_terms_type,
      vendorWithTermsNet30.payment_terms_days
    );

    // Then: 2026-01-10 + 30 days = 2026-02-09
    assert.equal(calculatedDueDate, '2026-02-09');

    // When: Creating opening payable with the calculated due date
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorWithTermsNet30.id,
        original_reference: 'INV-NET-30',
        document_date: docDate,
        due_date: calculatedDueDate,
        amount: 5000
      }
    });

    // Then: Success
    assert.equal(detail.opening_payable.due_date, '2026-02-09');
  });

  test('TC-OAP-N-04: vendor payment terms Month End 15 automatically calculates prefilled due date', async () => {
    // Given: Vendor with Month End 15 terms
    const docDate = '2026-01-10';

    // When: Calculating due date using paymentTerms helper
    const calculatedDueDate = calculateDueDate(
      docDate,
      vendorWithTermsMonthEnd15.payment_terms_type,
      vendorWithTermsMonthEnd15.payment_terms_days
    );

    // Then: 2026-01-31 + 15 days = 2026-02-15
    assert.equal(calculatedDueDate, '2026-02-15');

    // When: Creating opening payable with the calculated due date
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorWithTermsMonthEnd15.id,
        original_reference: 'INV-ME-15',
        document_date: docDate,
        due_date: calculatedDueDate,
        amount: 6000
      }
    });

    // Then: Success
    assert.equal(detail.opening_payable.due_date, '2026-02-15');
  });

  test('TC-OAP-N-05: list_opening_payables with vendor filter returns only matching vendor records', async () => {
    // Given: Two opening payables for two different vendors
    await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-V1-01',
        document_date: '2026-01-10',
        due_date: '2026-02-10',
        amount: 1000
      }
    });
    await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorWithTermsNet30.id,
        original_reference: 'REF-V2-01',
        document_date: '2026-01-10',
        due_date: '2026-02-10',
        amount: 2000
      }
    });

    // When: Listing with filter for testVendor
    const list = await invoke('list_opening_payables', {
      vendor_partner_id: testVendor.id
    });

    // Then: Only 1 record returned
    assert.equal(list.length, 1);
    assert.equal(list[0].vendor_partner_id, testVendor.id);
    assert.equal(list[0].original_reference, 'REF-V1-01');
  });

  test('TC-OAP-N-06: void opening payable sets status to voided and synchronizes AP status to voided', async () => {
    // Given: An open opening payable
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-TO-VOID',
        document_date: '2026-01-10',
        due_date: '2026-02-10',
        amount: 3000
      }
    });

    // When: Voiding with valid reason
    const voided = await invoke('void_opening_payable', {
      id: detail.opening_payable.id,
      void_reason: '金額輸入錯誤作廢重開'
    });

    // Then: Opening payable and AP both updated to voided
    assert.equal(voided.opening_payable.status, 'voided');
    assert.equal(voided.opening_payable.void_reason, '金額輸入錯誤作廢重開');

    const apList = await invoke('list_accounts_payable', { vendor_partner_id: testVendor.id });
    const ap = apList.find(a => a.source_number === voided.opening_payable.opening_number);
    assert.ok(ap);
    assert.equal(ap.status, 'voided');
  });

  // ==========================================
  // Boundary Cases (TC-OAP-B-01 to TC-OAP-B-07)
  // ==========================================

  test('TC-OAP-B-01: OB-03 boundary: document_date exactly 1 day before earliest PO is allowed', async () => {
    // Given: Vendor with earliest PO on 2026-11-02
    const vendor = await invoke('create_partner', {
      name: `PO邊界供應商_${Date.now()}`,
      isVendor: true
    });
    await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id,
      currency: 'TWD',
      created_at: 1793613600 // 2026-11-02
    });

    // When: document_date is 2026-11-01 (-1 day before PO)
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendor.id,
        original_reference: 'REF-B01',
        document_date: '2026-11-01',
        due_date: '2026-12-01',
        amount: 1000
      }
    });

    // Then: Allowed
    assert.ok(detail);
    assert.equal(detail.opening_payable.document_date, '2026-11-01');
  });

  test('TC-OAP-B-02: OB-03 boundary: document_date on the exact same day as earliest PO is rejected with specific message', async () => {
    // Given: Vendor with earliest PO on 2026-11-02 (PO-XXXXX)
    const vendor = await invoke('create_partner', {
      name: `PO同日供應商_${Date.now()}`,
      isVendor: true
    });
    await invoke('create_purchase_order', {
      vendorPartnerId: vendor.id,
      currency: 'TWD',
      created_at: 1793613600 // 2026-11-02
    });

    // When / Then: document_date is 2026-11-02 (same day) -> rejected with OB-03 message
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: vendor.id,
            original_reference: 'REF-B02',
            document_date: '2026-11-02',
            due_date: '2026-12-02',
            amount: 1000
          }
        });
      },
      (err) => {
        assert.match(
          err.message,
          /期初應付的單據日須早於此供應商在系統中的第一張採購單.*2026-11-02.*導入後的欠款請走請款單/
        );
        return true;
      }
    );
  });

  test('TC-OAP-B-03: OB-02 boundary: document_date is today is allowed', async () => {
    // Given: Today's date
    const today = new Date().toISOString().slice(0, 10);

    // When: Creating with document_date = today
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-TODAY',
        document_date: today,
        due_date: today,
        amount: 1000
      }
    });

    // Then: Success
    assert.ok(detail);
    assert.equal(detail.opening_payable.document_date, today);
  });

  test('TC-OAP-B-04: OB-02 boundary: document_date is tomorrow (+1 day) is rejected', async () => {
    // Given: Tomorrow's date
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = d.toISOString().slice(0, 10);

    // When / Then: document_date = tomorrow is rejected
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: 'REF-TOMORROW',
            document_date: tomorrow,
            due_date: tomorrow,
            amount: 1000
          }
        });
      },
      {
        message: '單據日不可晚於今天'
      }
    );
  });

  test('TC-OAP-B-05: OB-02 boundary: due_date equals document_date is allowed', async () => {
    // When: due_date == document_date
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-DUE-EQUAL',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1000
      }
    });

    // Then: Allowed
    assert.ok(detail);
    assert.equal(detail.opening_payable.due_date, '2026-01-10');
  });

  test('TC-OAP-B-06: OB-02 boundary: due_date earlier than document_date (-1 day) is rejected', async () => {
    // When / Then: due_date (2026-01-09) < document_date (2026-01-10) is rejected
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: 'REF-DUE-EARLIER',
            document_date: '2026-01-10',
            due_date: '2026-01-09',
            amount: 1000
          }
        });
      },
      {
        message: '到期日不可早於單據日'
      }
    );
  });

  test('TC-OAP-B-07: OB-02 boundary: amount = 0.0 is rejected', async () => {
    // When / Then: amount = 0 is rejected
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: 'REF-AMT-ZERO',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: 0
          }
        });
      },
      {
        message: '未付金額必須大於 0'
      }
    );
  });

  // ==========================================
  // Error Cases (TC-OAP-E-01 to TC-OAP-E-12)
  // ==========================================

  test('TC-OAP-E-02: amount < 0 is rejected', async () => {
    // When / Then: Negative amount
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: 'REF-AMT-NEG',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: -100
          }
        });
      },
      {
        message: '未付金額必須大於 0'
      }
    );
  });

  test('TC-OAP-E-03: original_reference is empty or pure spaces is rejected', async () => {
    // When / Then: Whitespace reference
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: '   ',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: 1000
          }
        });
      },
      {
        message: '原單號或發票號不可為空'
      }
    );
  });

  test('TC-OAP-E-04: vendor partner is customer or inactive is rejected', async () => {
    // When / Then: Customer partner specified
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: customerPartner.id,
            original_reference: 'REF-CUS',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: 1000
          }
        });
      },
      {
        message: '指定夥伴不是供應商'
      }
    );

    // When / Then: Inactive vendor specified
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: inactiveVendor.id,
            original_reference: 'REF-INACT',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: 1000
          }
        });
      },
      {
        message: '指定供應商已停用'
      }
    );
  });

  test('TC-OAP-E-05 & E-06: duplicate original_reference for same vendor is rejected (case-insensitive & trimmed)', async () => {
    // Given: Existing opening payable
    await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'INV-DUP-01',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 2000
      }
    });

    // When / Then (TC-OAP-E-05): Same exact reference
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: 'INV-DUP-01',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: 3000
          }
        });
      },
      (err) => {
        assert.match(err.message, /此供應商的期初單號 INV-DUP-01 已登錄於 OAP-00001/);
        return true;
      }
    );

    // When / Then (TC-OAP-E-06): Trimmed and lower-case variation (" inv-dup-01  ")
    await assert.rejects(
      async () => {
        await invoke('create_opening_payable', {
          input: {
            vendor_partner_id: testVendor.id,
            original_reference: ' inv-dup-01  ',
            document_date: '2026-01-10',
            due_date: '2026-01-10',
            amount: 3000
          }
        });
      },
      (err) => {
        assert.match(err.message, /此供應商的期初單號 inv-dup-01 已登錄於 OAP-00001/);
        return true;
      }
    );
  });

  test('TC-OAP-E-07: different vendor using same original_reference is allowed', async () => {
    // Given: First vendor uses REF-COMMON-01
    await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-COMMON-01',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1000
      }
    });

    // When: Second vendor uses same REF-COMMON-01
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: vendorWithTermsNet30.id,
        original_reference: 'REF-COMMON-01',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1500
      }
    });

    // Then: Allowed
    assert.ok(detail);
    assert.equal(detail.opening_payable.vendor_partner_id, vendorWithTermsNet30.id);
  });

  test('TC-OAP-E-08: re-using original_reference after previous record was voided is allowed', async () => {
    // Given: Created and then voided opening payable
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-REUSE-01',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1000
      }
    });
    await invoke('void_opening_payable', {
      id: detail.opening_payable.id,
      void_reason: '作廢'
    });

    // When: Re-creating opening payable with same reference
    const newDetail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-REUSE-01',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1200
      }
    });

    // Then: Allowed
    assert.ok(newDetail);
    assert.equal(newDetail.opening_payable.status, 'open');
  });

  test('TC-OAP-E-09: void with empty reason is rejected', async () => {
    // Given: Open opening payable
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-NO-REASON',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1000
      }
    });

    // When / Then: Voiding with whitespace reason
    await assert.rejects(
      async () => {
        await invoke('void_opening_payable', {
          id: detail.opening_payable.id,
          void_reason: '   '
        });
      },
      {
        message: '原因必填'
      }
    );
  });

  test('TC-OAP-E-11: void blocked when AP has posted payment allocation', async () => {
    // Given: Opening payable with linked AP
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-HAS-PAYMENT',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 5000
      }
    });
    const apId = detail.account_payable_id;

    // Inject posted payment and allocation via mock helper
    await invoke('inject_mock_payment_allocation', {
      payment: {
        id: 'pay_mock_1',
        payment_number: 'PAY-00001',
        tenant_id: tenantId,
        status: 'posted'
      },
      allocation: {
        id: 'pa_mock_1',
        tenant_id: tenantId,
        payment_id: 'pay_mock_1',
        account_payable_id: apId,
        amount: 5000
      }
    });

    // When / Then: Voiding is blocked by AP-04 / OB-05
    await assert.rejects(
      async () => {
        await invoke('void_opening_payable', {
          id: detail.opening_payable.id,
          void_reason: '嘗試作廢已付款項'
        });
      },
      (err) => {
        assert.match(err.message, /此期初應付已有付款核銷：PAY-00001，請先作廢付款單/);
        return true;
      }
    );
  });

  test('TC-OAP-E-12: double void of already voided opening payable is rejected', async () => {
    // Given: Voided opening payable
    const detail = await invoke('create_opening_payable', {
      input: {
        vendor_partner_id: testVendor.id,
        original_reference: 'REF-DBL-VOID',
        document_date: '2026-01-10',
        due_date: '2026-01-10',
        amount: 1000
      }
    });
    await invoke('void_opening_payable', {
      id: detail.opening_payable.id,
      void_reason: '初次作廢'
    });

    // When / Then: Second void attempt is rejected
    await assert.rejects(
      async () => {
        await invoke('void_opening_payable', {
          id: detail.opening_payable.id,
          void_reason: '再次作廢'
        });
      },
      (err) => {
        assert.match(err.message, /無效的狀態轉換/);
        return true;
      }
    );
  });
});
