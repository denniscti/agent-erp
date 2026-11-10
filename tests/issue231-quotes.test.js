import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #231: Quotes Core Business Logic & State Machine', () => {
  let customer;
  let nonCustomer;
  let inactiveCustomer;
  let sellableProduct;
  let nonSellableProduct;

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    await invoke('reset_mock_quotes', { tenant_id: 'tnt_mock_1' });

    // Seed customer partner
    customer = await invoke('create_partner', {
      name: `台積電客戶_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isCustomer: true,
      isVendor: false
    });

    // Seed non-customer partner (vendor only)
    nonCustomer = await invoke('create_partner', {
      name: `欣興供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isCustomer: false,
      isVendor: true
    });

    // Seed inactive customer
    inactiveCustomer = await invoke('create_partner', {
      name: `停用客戶_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isCustomer: true,
      isVendor: false
    });
    await invoke('update_partner', {
      id: inactiveCustomer.id,
      isActive: false
    });

    // Seed sellable product (resale) with selling_price = 100
    sellableProduct = await invoke('create_product', {
      name: `手機主板_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      category: 'resale',
      selling_price: 100.0,
      unit_name: '片'
    });

    // Seed non-sellable product (raw_material)
    nonSellableProduct = await invoke('create_product', {
      name: `工業銅箔_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      category: 'raw_material',
      unit_name: '公斤'
    });
  });

  test('TC-QUO-N-01: create_quote creates draft with sequence QUO-00001 and snapshots customer name', async () => {
    // Given: Active tenant and valid customer
    // When: Creating a quote
    const detail = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31',
        note: '第一筆報價單備註',
        customer_po_number: 'PO-CLIENT-1001'
      }
    });

    // Then: Status is draft, quote_number is QUO-00001, customer name is snapshotted
    assert.equal(detail.quote.status, 'draft');
    assert.equal(detail.quote.quote_number, 'QUO-00001');
    assert.equal(detail.quote.customer_name_snapshot, customer.name);
    assert.equal(detail.quote.currency, 'TWD');
    assert.equal(detail.quote.valid_until, '2026-12-31');
    assert.equal(detail.quote.note, '第一筆報價單備註');
    assert.equal(detail.quote.customer_po_number, 'PO-CLIENT-1001');
    assert.equal(detail.quote.requires_approval, 0);
    assert.equal(detail.quote.total_amount, 0);
    assert.equal(detail.lines.length, 0);

    // When: Creating second quote
    const detail2 = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });

    // Then: Sequence increments to QUO-00002
    assert.equal(detail2.quote.quote_number, 'QUO-00002');
  });

  test('TC-QUO-N-02: add_quote_line, update_quote_line, delete_quote_line lifecycle', async () => {
    // Given: A draft quote
    const created = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    const unitId = sellableProduct.units[0].id;

    // When: Adding quote line
    const withLine = await invoke('add_quote_line', {
      input: {
        quote_id: created.quote.id,
        unit_id: unitId,
        quantity: 10,
        unit_price: 120,
        note: '特惠批發價'
      }
    });

    // Then: Line added with snapshots and derived total amount
    assert.equal(withLine.lines.length, 1);
    assert.equal(withLine.lines[0].line_no, 1);
    assert.equal(withLine.lines[0].unit_id, unitId);
    assert.equal(withLine.lines[0].product_name_snapshot, sellableProduct.product.name);
    assert.equal(withLine.lines[0].quantity, 10);
    assert.equal(withLine.lines[0].unit_price, 120);
    assert.equal(withLine.lines[0].line_amount, 1200);
    assert.equal(withLine.total_amount, 1200);

    // When: Updating quote line
    const lineId = withLine.lines[0].id;
    const updatedLine = await invoke('update_quote_line', {
      input: {
        quote_id: created.quote.id,
        line_id: lineId,
        quantity: 5,
        unit_price: 150,
        note: '修改為5件'
      }
    });

    // Then: Line amount and total amount updated
    assert.equal(updatedLine.lines[0].quantity, 5);
    assert.equal(updatedLine.lines[0].unit_price, 150);
    assert.equal(updatedLine.lines[0].line_amount, 750);
    assert.equal(updatedLine.total_amount, 750);

    // When: Deleting quote line
    const deleted = await invoke('delete_quote_line', {
      quote_id: created.quote.id,
      line_id: lineId
    });

    // Then: Lines array empty, total amount 0
    assert.equal(deleted.lines.length, 0);
    assert.equal(deleted.total_amount, 0);
  });

  test('TC-QUO-N-03 & TC-QUO-B-02: submit_quote without approval needed (unit_price >= standard_price)', async () => {
    // Given: Standard selling price 100.0, line unit price 100.0 (exact match)
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    const unitId = sellableProduct.units[0].id;

    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: unitId,
        quantity: 2,
        unit_price: 100.0
      }
    });

    // When: Submitting quote
    const res = await invoke('submit_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-09'
    });

    // Then: Status becomes sent, requires_approval=0, sent_at is recorded, message is '報價已送出'
    assert.equal(res.quote.status, 'sent');
    assert.equal(res.quote.requires_approval, 0);
    assert.ok(res.quote.sent_at);
    assert.equal(res.message, '報價已送出');
  });

  test('TC-QUO-N-04 & TC-QUO-B-01: submit_quote with approval needed (unit_price < standard_price)', async () => {
    // Given: Standard selling price 100.0, line unit price 99.99 (-0.01 lower)
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    const unitId = sellableProduct.units[0].id;

    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: unitId,
        quantity: 1,
        unit_price: 99.99
      }
    });

    // When: Submitting quote
    const res = await invoke('submit_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-09'
    });

    // Then: Status becomes pending_approval, requires_approval=1, message tells 1 item below standard price
    assert.equal(res.quote.status, 'pending_approval');
    assert.equal(res.quote.requires_approval, 1);
    assert.equal(res.quote.sent_at, null);
    assert.equal(res.message, '已送交核准（1 項低於標準售價）');
  });

  test('TC-QUO-N-05: withdraw_quote_approval returns pending_approval to draft with reason', async () => {
    // Given: Quote in pending_approval
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 80.0
      }
    });
    await invoke('submit_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-09'
    });

    // When: Withdrawing approval
    const withdrawn = await invoke('withdraw_quote_approval', {
      quote_id: quote.quote.id,
      reason: '業務主動撤回調整折讓'
    });

    // Then: Status returns to draft and approval_rejection_reason is recorded
    assert.equal(withdrawn.quote.status, 'draft');
    assert.equal(withdrawn.quote.approval_rejection_reason, '業務主動撤回調整折讓');
  });

  test('TC-QUO-N-06: decline_quote marks sent quote as declined', async () => {
    // Given: Quote in sent status
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 100.0
      }
    });
    await invoke('submit_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-09'
    });

    // When: Customer declines
    const declined = await invoke('decline_quote', {
      quote_id: quote.quote.id,
      reason: '客戶改選同業方案'
    });

    // Then: Status is declined, declined_at and decline_reason recorded
    assert.equal(declined.quote.status, 'declined');
    assert.ok(declined.quote.declined_at);
    assert.equal(declined.quote.decline_reason, '客戶改選同業方案');
  });

  test('TC-QUO-N-07: cancel_quote cancels draft or pending_approval quote', async () => {
    // Given: A draft quote
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });

    // When: Cancelling
    const cancelled = await invoke('cancel_quote', {
      quote_id: quote.quote.id,
      reason: '客戶需求取消'
    });

    // Then: Status is cancelled and cancelled_at is recorded
    assert.equal(cancelled.quote.status, 'cancelled');
    assert.ok(cancelled.quote.cancelled_at);
    assert.equal(cancelled.quote.cancel_reason, '客戶需求取消');
  });

  test('TC-QUO-B-06 & TC-QUO-B-07: valid_until date boundaries on submit', async () => {
    // Case 1: valid_until == today (2026-11-09) -> Allowed
    const qToday = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-11-09'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: qToday.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 100
      }
    });

    const okRes = await invoke('submit_quote', {
      quote_id: qToday.quote.id,
      today_override: '2026-11-09'
    });
    assert.equal(okRes.quote.status, 'sent');

    // Case 2: valid_until == today - 1 (2026-11-08) -> Rejected
    const qYesterday = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-11-08'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: qYesterday.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 100
      }
    });

    await assert.rejects(
      async () => {
        await invoke('submit_quote', {
          quote_id: qYesterday.quote.id,
          today_override: '2026-11-09'
        });
      },
      {
        message: '報價有效期已過，請先修改有效期'
      }
    );
  });

  test('TC-QUO-E-01 to E-03: customer validations (R1)', async () => {
    // Nonexistent customer
    await assert.rejects(
      async () => {
        await invoke('create_quote', {
          input: {
            customer_partner_id: 'nonexistent_customer_id',
            valid_until: '2026-12-31'
          }
        });
      },
      {
        message: '找不到此客戶，或該往來對象未設定為客戶'
      }
    );

    // Vendor partner only (is_customer = false)
    await assert.rejects(
      async () => {
        await invoke('create_quote', {
          input: {
            customer_partner_id: nonCustomer.id,
            valid_until: '2026-12-31'
          }
        });
      },
      {
        message: '找不到此客戶，或該往來對象未設定為客戶'
      }
    );

    // Inactive customer (is_active = false)
    await assert.rejects(
      async () => {
        await invoke('create_quote', {
          input: {
            customer_partner_id: inactiveCustomer.id,
            valid_until: '2026-12-31'
          }
        });
      },
      {
        message: '找不到此客戶，或該往來對象未設定為客戶'
      }
    );
  });

  test('TC-QUO-E-04: non-sellable product is rejected (R2)', async () => {
    // Given: Draft quote and raw_material product
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    const nonSellableUnitId = nonSellableProduct.units[0].id;

    // When / Then: Adding non-sellable unit throws error
    await assert.rejects(
      async () => {
        await invoke('add_quote_line', {
          input: {
            quote_id: quote.quote.id,
            unit_id: nonSellableUnitId,
            quantity: 10,
            unit_price: 50
          }
        });
      },
      {
        message: '此商品不可銷售'
      }
    );
  });

  test('TC-QUO-E-05: duplicate unit_id in same quote is rejected', async () => {
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    const unitId = sellableProduct.units[0].id;

    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: unitId,
        quantity: 1,
        unit_price: 100
      }
    });

    // When / Then: Adding duplicate unit_id throws error
    await assert.rejects(
      async () => {
        await invoke('add_quote_line', {
          input: {
            quote_id: quote.quote.id,
            unit_id: unitId,
            quantity: 2,
            unit_price: 100
          }
        });
      },
      {
        message: '同一報價單內商品單位不可重複'
      }
    );
  });

  test('TC-QUO-E-06 & E-07: non-draft and terminal modification guards (R4, R13)', async () => {
    // Given: Sent quote
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 100
      }
    });
    await invoke('submit_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-09'
    });

    // When / Then: Modifying header in 'sent' status is rejected (R4)
    await assert.rejects(
      async () => {
        await invoke('update_quote_header', {
          input: {
            quote_id: quote.quote.id,
            valid_until: '2027-01-01'
          }
        });
      },
      {
        message: '報價單狀態為 sent，僅草稿可修改'
      }
    );

    // When / Then: Cancelling the quote turns it into terminal state
    await invoke('cancel_quote', { quote_id: quote.quote.id, reason: '作廢結案' });

    // When / Then: Modifying terminal quote is rejected (R13)
    await assert.rejects(
      async () => {
        await invoke('update_quote_header', {
          input: {
            quote_id: quote.quote.id,
            valid_until: '2027-01-01'
          }
        });
      },
      {
        message: '此報價單已結案，無法修改'
      }
    );
  });

  test('TC-QUO-D-02: lazy expiration in transactions automatically marks past-due quotes as expired', async () => {
    // Given: A sent quote valid until 2026-11-10
    const quote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-11-10'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: quote.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 100
      }
    });
    await invoke('submit_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-09'
    });

    // When: Day advances to 2026-11-11 and get_quote is invoked
    const detail = await invoke('get_quote', {
      quote_id: quote.quote.id,
      today_override: '2026-11-11'
    });

    // Then: Status automatically converted to 'expired'
    assert.equal(detail.quote.status, 'expired');
    assert.ok(detail.quote.expired_at);

    // And: Cannot cancel expired quote because it is terminal
    await assert.rejects(
      async () => {
        await invoke('cancel_quote', {
          quote_id: quote.quote.id,
          reason: '嘗試取消過期單',
          today_override: '2026-11-11'
        });
      },
      {
        message: '此報價單已結案，無法修改'
      }
    );
  });

  test('TC-QUO-N-08: list_quotes filters correctly with filterStatus / filterCustomerId and snake_case', async () => {
    // Given: Seed second customer and create 2 quotes with different customers and statuses
    const customer2 = await invoke('create_partner', {
      name: `第二測試客戶_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isCustomer: true
    });

    const q1 = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: q1.quote.id,
        unit_id: sellableProduct.units[0].id,
        quantity: 1,
        unit_price: 100
      }
    });
    await invoke('submit_quote', {
      quote_id: q1.quote.id,
      today_override: '2026-11-09'
    }); // q1 status: 'sent', customer: customer.id

    const q2 = await invoke('create_quote', {
      input: {
        customer_partner_id: customer2.id,
        valid_until: '2026-12-31'
      }
    }); // q2 status: 'draft', customer: customer2.id

    // When: Querying with camelCase filterStatus = 'draft' (real Tauri invoke format)
    const listDraft = await invoke('list_quotes', { filterStatus: 'draft' });
    // Then: Returns only q2
    assert.equal(listDraft.length, 1);
    assert.equal(listDraft[0].id, q2.quote.id);

    // When: Querying with camelCase filterCustomerId = customer.id
    const listCust1 = await invoke('list_quotes', { filterCustomerId: customer.id });
    // Then: Returns only q1
    assert.equal(listCust1.length, 1);
    assert.equal(listCust1[0].id, q1.quote.id);

    // When: Querying with snake_case filter_status and filter_customer_id
    const listSnake = await invoke('list_quotes', {
      filter_status: 'sent',
      filter_customer_id: customer.id
    });
    // Then: Returns only q1
    assert.equal(listSnake.length, 1);
    assert.equal(listSnake[0].id, q1.quote.id);

    // When: Querying with non-matching filter
    const listNone = await invoke('list_quotes', {
      filterStatus: 'cancelled'
    });
    // Then: Returns empty
    assert.equal(listNone.length, 0);
  });
});
