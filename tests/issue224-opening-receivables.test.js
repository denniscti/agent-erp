import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';
import { calculateDueDate } from '../src/lib/paymentTerms.js';

test.describe('Issue #224: Opening Receivables (期初應收帳款) Automated Tests', () => {
  const tenantId = 'tnt_mock_1';
  let testCustomer;
  let customerWithTermsNet30;
  let customerWithTermsMonthEnd15;
  let inactiveCustomer;
  let vendorPartner;
  let seq = 0;

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_opening_receivables', { tenant_id: tenantId });
    await invoke('reset_mock_sales_orders', { tenant_id: tenantId });

    seq++;
    const randomSuffix = `${Date.now()}_${seq}_${Math.floor(Math.random() * 100000)}`;

    testCustomer = await invoke('create_partner', {
      name: `期初測試客戶_${randomSuffix}`,
      isCustomer: true
    });

    customerWithTermsNet30 = await invoke('create_partner', {
      name: `條件客戶_Net30_${randomSuffix}`,
      isCustomer: true,
      collectionTermsType: 'net',
      collectionTermsDays: 30
    });

    customerWithTermsMonthEnd15 = await invoke('create_partner', {
      name: `條件客戶_MonthEnd15_${randomSuffix}`,
      isCustomer: true,
      collectionTermsType: 'month_end',
      collectionTermsDays: 15
    });

    inactiveCustomer = await invoke('create_partner', {
      name: `停用測試客戶_${randomSuffix}`,
      isCustomer: true
    });
    await invoke('update_partner', {
      id: inactiveCustomer.id,
      name: inactiveCustomer.name,
      isCustomer: true,
      isActive: false
    });

    vendorPartner = await invoke('create_partner', {
      name: `供應商夥伴_${randomSuffix}`,
      isVendor: true,
      isCustomer: false
    });
  });

  // ==========================================
  // Normal Cases (TC-OAR-N-01 to TC-OAR-N-06)
  // ==========================================

  test('TC-OAR-N-01: create opening receivable for customer without SO generates OAR number, status open, and creates AR (Layer 2)', async () => {
    // Given: Active customer without sales orders
    const input = {
      customer_partner_id: testCustomer.id,
      original_reference: 'INV-OLD-REC-001',
      document_date: '2026-01-10',
      due_date: '2026-02-10',
      amount: 18000,
      note: '導入前客戶舊欠款'
    };

    // When: Creating opening receivable
    const detail = await invoke('create_opening_receivable', { input });

    // Then: Returns opening receivable with OAR-00001, status open, and linked AR
    assert.ok(detail);
    assert.equal(detail.opening_receivable.opening_number, 'OAR-00001');
    assert.equal(detail.opening_receivable.status, 'open');
    assert.equal(detail.opening_receivable.customer_partner_id, testCustomer.id);
    assert.equal(detail.opening_receivable.amount, 18000);
    assert.ok(detail.account_receivable_id);

    // Verify Layer 2: AR exists in list_accounts_receivable
    const arList = await invoke('list_accounts_receivable', { customer_partner_id: testCustomer.id });
    const ar = arList.find(a => a.source_number === 'OAR-00001');
    assert.ok(ar, 'Opening receivable must appear in list_accounts_receivable');
    assert.equal(ar.source_type, 'opening_balance');
    assert.equal(ar.amount, 18000);
    assert.equal(ar.outstanding_amount, 18000);
    assert.equal(ar.status, 'open');
  });

  test('TC-OAR-N-02: create opening receivable for customer with SO when document_date is earlier than earliest SO date', async () => {
    // Given: Customer has a sales order created on 2026-11-02
    const customerWithSo = await invoke('create_partner', {
      name: `SO客戶_${Date.now()}`,
      isCustomer: true
    });
    await invoke('create_mock_sales_order', {
      tenant_id: tenantId,
      customer_partner_id: customerWithSo.id,
      so_number: 'SO-20261102-001',
      created_at: 1793613600 // 2026-11-02
    });

    // When: Creating opening receivable with document_date = 2026-10-15 (< 2026-11-02)
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerWithSo.id,
        original_reference: 'OLD-SO-REF-01',
        document_date: '2026-10-15',
        due_date: '2026-11-15',
        amount: 9500
      }
    });

    // Then: Created successfully
    assert.ok(detail);
    assert.equal(detail.opening_receivable.status, 'open');
    assert.equal(detail.opening_receivable.amount, 9500);
  });

  test('TC-OAR-N-03: customer payment terms Net 30 automatically calculates prefilled due date', async () => {
    // Given: Customer with Net 30 terms
    const docDate = '2026-01-10';

    // When: Calculating due date using paymentTerms helper
    const calculatedDueDate = calculateDueDate(
      docDate,
      customerWithTermsNet30.collection_terms_type,
      customerWithTermsNet30.collection_terms_days
    );

    // Then: 2026-01-10 + 30 days = 2026-02-09
    assert.equal(calculatedDueDate, '2026-02-09');

    // When: Creating opening receivable with calculated due date
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerWithTermsNet30.id,
        original_reference: 'INV-REC-NET-30',
        document_date: docDate,
        due_date: calculatedDueDate,
        amount: 7200
      }
    });

    // Then: Success
    assert.equal(detail.opening_receivable.due_date, '2026-02-09');
  });

  test('TC-OAR-N-04: customer payment terms Month End 15 automatically calculates prefilled due date', async () => {
    // Given: Customer with Month End 15 terms
    const docDate = '2026-01-10';

    // When: Calculating due date using paymentTerms helper
    const calculatedDueDate = calculateDueDate(
      docDate,
      customerWithTermsMonthEnd15.collection_terms_type,
      customerWithTermsMonthEnd15.collection_terms_days
    );

    // Then: 2026-01-31 + 15 days = 2026-02-15
    assert.equal(calculatedDueDate, '2026-02-15');

    // When: Creating opening receivable
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerWithTermsMonthEnd15.id,
        original_reference: 'INV-REC-ME-15',
        document_date: docDate,
        due_date: calculatedDueDate,
        amount: 8800
      }
    });

    // Then: Success
    assert.equal(detail.opening_receivable.due_date, '2026-02-15');
  });

  test('TC-OAR-N-05: list_opening_receivables with customer filter returns only matching customer records', async () => {
    // Given: Two customers with opening receivables
    const oar1 = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-FILT-1',
        document_date: '2026-01-10',
        due_date: '2026-02-10',
        amount: 3000
      }
    });

    const oar2 = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerWithTermsNet30.id,
        original_reference: 'INV-FILT-2',
        document_date: '2026-01-10',
        due_date: '2026-02-10',
        amount: 4000
      }
    });

    // When: Querying with customer_partner_id filter via { filter: { ... } } structure (same as store.js)
    const listWithFilter = await invoke('list_opening_receivables', {
      filter: { customer_partner_id: testCustomer.id }
    });

    // Then: Only oar1 is returned
    assert.equal(listWithFilter.length, 1);
    assert.equal(listWithFilter[0].id, oar1.opening_receivable.id);
    assert.equal(listWithFilter[0].customer_partner_id, testCustomer.id);

    // When: Querying with direct customer_partner_id arg (backward compatibility)
    const listDirect = await invoke('list_opening_receivables', {
      customer_partner_id: testCustomer.id
    });
    assert.equal(listDirect.length, 1);
    assert.equal(listDirect[0].id, oar1.opening_receivable.id);
  });

  test('TC-OAR-N-06: void opening receivable sets status to voided and synchronizes AR status to voided', async () => {
    // Given: An open opening receivable
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-VOID-TEST-01',
        document_date: '2026-01-10',
        due_date: '2026-02-10',
        amount: 15000
      }
    });
    const oarId = detail.opening_receivable.id;
    const arId = detail.account_receivable_id;

    // When: Voiding with valid reason
    const voided = await invoke('void_opening_receivable', {
      id: oarId,
      void_reason: '客戶帳款輸入錯誤，重新開立'
    });

    // Then: opening_receivable status is voided
    assert.equal(voided.opening_receivable.status, 'voided');
    assert.equal(voided.opening_receivable.void_reason, '客戶帳款輸入錯誤，重新開立');

    // And AR is synchronized to voided
    const arDetail = await invoke('get_account_receivable', { id: arId });
    assert.equal(arDetail.status, 'voided');
    assert.equal(arDetail.void_reason, '客戶帳款輸入錯誤，重新開立');
  });

  // ==========================================
  // Boundary Cases (TC-OAR-B-01 to TC-OAR-B-09)
  // Layer 1 Acceptance Criteria
  // ==========================================

  test('TC-OAR-B-01: OR-01 boundary: document_date exactly 1 day before earliest SO is allowed', async () => {
    // Given: Customer has SO created on 2026-11-05
    const customerSo = await invoke('create_partner', {
      name: `SO_邊界客戶_${Date.now()}`,
      isCustomer: true
    });
    await invoke('create_mock_sales_order', {
      tenant_id: tenantId,
      customer_partner_id: customerSo.id,
      so_number: 'SO-20261105-001',
      created_at: 1793872800 // 2026-11-05
    });

    // When: Creating with document_date = 2026-11-04 (1 day before)
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerSo.id,
        original_reference: 'OLD-SO-B01',
        document_date: '2026-11-04',
        due_date: '2026-12-04',
        amount: 5000
      }
    });

    // Then: Allowed
    assert.ok(detail);
    assert.equal(detail.opening_receivable.status, 'open');
  });

  test('TC-OAR-B-02: OR-01 boundary: document_date on exact same day as earliest SO is rejected (Layer 1)', async () => {
    // Given: Customer has SO created on 2026-11-05
    const customerSo = await invoke('create_partner', {
      name: `SO_同日拒絕客戶_${Date.now()}`,
      isCustomer: true
    });
    await invoke('create_mock_sales_order', {
      tenant_id: tenantId,
      customer_partner_id: customerSo.id,
      so_number: 'SO-20261105-002',
      created_at: 1793872800 // 2026-11-05
    });

    // When & Then: Creating with document_date = 2026-11-05 is strictly rejected
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: customerSo.id,
            original_reference: 'OLD-SO-B02',
            document_date: '2026-11-05',
            due_date: '2026-12-05',
            amount: 5000
          }
        });
      },
      (err) => {
        assert.match(err.message, /期初應收的單據日須早於此客戶在系統中的第一張銷售單/);
        assert.match(err.message, /客戶帳單/);
        return true;
      }
    );
  });

  test('TC-OAR-B-03: OR-01 boundary: document_date after earliest SO date is rejected', async () => {
    // Given: Customer has SO on 2026-11-05
    const customerSo = await invoke('create_partner', {
      name: `SO_晚於拒絕客戶_${Date.now()}`,
      isCustomer: true
    });
    await invoke('create_mock_sales_order', {
      tenant_id: tenantId,
      customer_partner_id: customerSo.id,
      so_number: 'SO-20261105-003',
      created_at: 1793872800 // 2026-11-05
    });

    // When & Then: Creating with document_date = 2026-11-06 is rejected
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: customerSo.id,
            original_reference: 'OLD-SO-B03',
            document_date: '2026-11-06',
            due_date: '2026-12-06',
            amount: 5000
          }
        });
      },
      (err) => {
        assert.match(err.message, /期初應收的單據日須早於此客戶在系統中的第一張銷售單/);
        return true;
      }
    );
  });

  test('TC-OAR-B-04: document_date is today is allowed', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-TODAY',
        document_date: today,
        due_date: today,
        amount: 1000
      }
    });
    assert.ok(detail);
    assert.equal(detail.opening_receivable.document_date, today);
  });

  test('TC-OAR-B-05: document_date is tomorrow (+1 day) is rejected', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: 'INV-FUTURE',
            document_date: tomorrow,
            due_date: tomorrow,
            amount: 1000
          }
        });
      },
      /單據日不可晚於今天/
    );
  });

  test('TC-OAR-B-06: due_date equals document_date is allowed', async () => {
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-SAME-DAY',
        document_date: '2026-01-15',
        due_date: '2026-01-15',
        amount: 2500
      }
    });
    assert.ok(detail);
    assert.equal(detail.opening_receivable.due_date, '2026-01-15');
  });

  test('TC-OAR-B-07: due_date earlier than document_date (-1 day) is rejected', async () => {
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: 'INV-EARLIER-DUE',
            document_date: '2026-01-15',
            due_date: '2026-01-14',
            amount: 2500
          }
        });
      },
      /到期日不可早於單據日/
    );
  });

  test('TC-OAR-B-08: amount = 0.0 is rejected', async () => {
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: 'INV-ZERO',
            document_date: '2026-01-10',
            due_date: '2026-01-20',
            amount: 0.0
          }
        });
      },
      /未付金額必須大於 0/
    );
  });

  test('TC-OAR-B-09: amount = 0.01 is allowed', async () => {
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-MIN',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 0.01
      }
    });
    assert.ok(detail);
    assert.equal(detail.opening_receivable.amount, 0.01);
  });

  // ==========================================
  // Error Cases (TC-OAR-E-02 to TC-OAR-E-12)
  // ==========================================

  test('TC-OAR-E-02: amount < 0 is rejected', async () => {
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: 'INV-NEG',
            document_date: '2026-01-10',
            due_date: '2026-01-20',
            amount: -100
          }
        });
      },
      /未付金額必須大於 0/
    );
  });

  test('TC-OAR-E-03: original_reference is empty or pure spaces is rejected', async () => {
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: '   ',
            document_date: '2026-01-10',
            due_date: '2026-01-20',
            amount: 1000
          }
        });
      },
      /原單號或發票號不可為空/
    );
  });

  test('TC-OAR-E-04: partner is vendor or inactive customer is rejected', async () => {
    // Partner is only vendor
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: vendorPartner.id,
            original_reference: 'INV-VEND-ONLY',
            document_date: '2026-01-10',
            due_date: '2026-01-20',
            amount: 1000
          }
        });
      },
      /指定夥伴不是客戶/
    );

    // Inactive customer
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: inactiveCustomer.id,
            original_reference: 'INV-INACTIVE-CUST',
            document_date: '2026-01-10',
            due_date: '2026-01-20',
            amount: 1000
          }
        });
      },
      /指定客戶已停用/
    );
  });

  test('TC-OAR-E-05 & E-06: duplicate original_reference for same customer is rejected (case-insensitive & trimmed)', async () => {
    await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-DUP-TEST',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 1000
      }
    });

    // Exact duplicate
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: 'INV-DUP-TEST',
            document_date: '2026-01-11',
            due_date: '2026-01-21',
            amount: 2000
          }
        });
      },
      /此客戶的期初單號 INV-DUP-TEST 已登錄於 OAR-/
    );

    // Case-insensitive & trimmed duplicate
    await assert.rejects(
      async () => {
        await invoke('create_opening_receivable', {
          input: {
            customer_partner_id: testCustomer.id,
            original_reference: '  inv-dup-test  ',
            document_date: '2026-01-12',
            due_date: '2026-01-22',
            amount: 3000
          }
        });
      },
      /此客戶的期初單號 inv-dup-test 已登錄於 OAR-/
    );
  });

  test('TC-OAR-E-07: different customer using same original_reference is allowed', async () => {
    await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-SHARED-REF',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 1000
      }
    });

    // Different customer using same ref succeeds
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: customerWithTermsNet30.id,
        original_reference: 'INV-SHARED-REF',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 2000
      }
    });
    assert.ok(detail);
    assert.equal(detail.opening_receivable.original_reference, 'INV-SHARED-REF');
  });

  test('TC-OAR-E-08: re-using original_reference after previous record was voided is allowed', async () => {
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-REUSE-REF',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 1000
      }
    });

    await invoke('void_opening_receivable', {
      id: detail.opening_receivable.id,
      void_reason: '測試作廢重用'
    });

    // Re-use same reference succeeds
    const detail2 = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-REUSE-REF',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 1500
      }
    });
    assert.ok(detail2);
    assert.equal(detail2.opening_receivable.amount, 1500);
  });

  test('TC-OAR-E-09: void with empty reason is rejected', async () => {
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-EMPTY-REASON',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 1000
      }
    });

    await assert.rejects(
      async () => {
        await invoke('void_opening_receivable', {
          id: detail.opening_receivable.id,
          void_reason: '   '
        });
      },
      /原因必填/
    );
  });

  test('TC-OAR-E-12: double void of already voided opening receivable is rejected', async () => {
    const detail = await invoke('create_opening_receivable', {
      input: {
        customer_partner_id: testCustomer.id,
        original_reference: 'INV-DOUBLE-VOID',
        document_date: '2026-01-10',
        due_date: '2026-01-20',
        amount: 1000
      }
    });

    await invoke('void_opening_receivable', {
      id: detail.opening_receivable.id,
      void_reason: '第一次作廢'
    });

    await assert.rejects(
      async () => {
        await invoke('void_opening_receivable', {
          id: detail.opening_receivable.id,
          void_reason: '第二次作廢'
        });
      },
      /無效的狀態轉換/
    );
  });
});
