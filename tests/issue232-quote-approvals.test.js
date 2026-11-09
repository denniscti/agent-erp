import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #232: Quote Approval & Rejection with Audit Logs & Pending Approval List', () => {
  let customer;
  let sellableProduct100;
  let sellableProduct200;

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    await invoke('reset_mock_quotes', { tenant_id: 'tnt_mock_1' });

    // Seed customer partner
    customer = await invoke('create_partner', {
      name: `核准測試客戶_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      isCustomer: true,
      isVendor: false
    });

    // Seed sellable products
    sellableProduct100 = await invoke('create_product', {
      name: `晶片模組100_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      category: 'resale',
      selling_price: 100.0,
      unit_name: '片'
    });

    sellableProduct200 = await invoke('create_product', {
      name: `伺服器主板200_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      category: 'resale',
      selling_price: 200.0,
      unit_name: '片'
    });
  });

  test('TC-APP-N-01: approve_quote with optional reason sets status to sent and records audit log', async () => {
    // Given: A quote with line below standard price submitted to pending_approval
    const created = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31',
        note: '待核准報價單'
      }
    });

    await invoke('add_quote_line', {
      input: {
        quote_id: created.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 10.0,
        unit_price: 80.0 // 80 < standard 100
      }
    });

    const submitRes = await invoke('submit_quote', { quote_id: created.quote.id });
    assert.equal(submitRes.quote.status, 'pending_approval');
    assert.equal(submitRes.quote.requires_approval, 1);

    // When: Approving quote with optional reason
    const approved = await invoke('approve_quote', {
      quote_id: created.quote.id,
      reason: '大客戶專案折扣核准'
    });

    // Then: Quote status becomes 'sent', approved_by and approved_at are populated, rejection reason is null
    assert.equal(approved.quote.status, 'sent');
    assert.ok(approved.quote.approved_by);
    assert.ok(approved.quote.approved_at);
    assert.ok(approved.quote.sent_at);
    assert.equal(approved.quote.approval_rejection_reason, null);

    // And: Audit logs record action_type='quote_approval', decision='approved'
    const auditLogs = await invoke('get_audit_logs');
    const approvalLog = auditLogs.find(l => l.action_type === 'quote_approval');
    assert.ok(approvalLog, 'Audit log for quote_approval should exist');
    assert.equal(approvalLog.decision, 'approved');
    assert.ok(approvalLog.operator);

    const parsedArgs = typeof approvalLog.arguments === 'string' ? JSON.parse(approvalLog.arguments) : approvalLog.arguments;
    assert.equal(parsedArgs.quote_id, created.quote.id);
    assert.equal(parsedArgs.quote_number, created.quote.quote_number);
    assert.equal(parsedArgs.total_amount, 800.0);
    assert.equal(parsedArgs.reason, '大客戶專案折扣核准');
    assert.equal(parsedArgs.below_standard_lines.length, 1);
    assert.equal(parsedArgs.below_standard_lines[0].difference, 20.0);
    assert.equal(parsedArgs.below_standard_lines[0].unit_price, 80.0);
    assert.equal(parsedArgs.below_standard_lines[0].standard_price, 100.0);
  });

  test('TC-APP-N-02: approve_quote without reason sets reason to null in audit log', async () => {
    // Given: A quote in pending_approval
    const created = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });

    await invoke('add_quote_line', {
      input: {
        quote_id: created.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 5.0,
        unit_price: 90.0
      }
    });

    await invoke('submit_quote', { quote_id: created.quote.id });

    // When: Approving quote without reason
    const approved = await invoke('approve_quote', { quote_id: created.quote.id });

    // Then: Quote status becomes 'sent'
    assert.equal(approved.quote.status, 'sent');

    // And: Audit log has reason null
    const auditLogs = await invoke('get_audit_logs');
    const log = auditLogs.find(l => {
      const args = typeof l.arguments === 'string' ? JSON.parse(l.arguments) : l.arguments;
      return args.quote_id === created.quote.id;
    });
    assert.ok(log);
    assert.equal(log.decision, 'approved');
    const parsedArgs = typeof log.arguments === 'string' ? JSON.parse(log.arguments) : log.arguments;
    assert.equal(parsedArgs.reason, null);
  });

  test('TC-APP-N-03: reject_quote with valid reason returns status to draft and displays rejection reason', async () => {
    // Given: A quote in pending_approval
    const created = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });

    await invoke('add_quote_line', {
      input: {
        quote_id: created.quote.id,
        unit_id: sellableProduct200.units[0].id,
        quantity: 2.0,
        unit_price: 150.0 // 150 < 200
      }
    });

    await invoke('submit_quote', { quote_id: created.quote.id });

    // When: Rejecting quote with required reason
    const rejected = await invoke('reject_quote', {
      quote_id: created.quote.id,
      reason: '折扣過多，毛利率低於標準'
    });

    // Then: Quote status reverts to draft, rejection reason is displayed
    assert.equal(rejected.quote.status, 'draft');
    assert.equal(rejected.quote.approval_rejection_reason, '折扣過多，毛利率低於標準');

    // And: Audit logs record decision='rejected'
    const auditLogs = await invoke('get_audit_logs');
    const log = auditLogs.find(l => {
      const args = typeof l.arguments === 'string' ? JSON.parse(l.arguments) : l.arguments;
      return args.quote_id === created.quote.id;
    });
    assert.ok(log);
    assert.equal(log.decision, 'rejected');
    const parsedArgs = typeof log.arguments === 'string' ? JSON.parse(log.arguments) : log.arguments;
    assert.equal(parsedArgs.reason, '折扣過多，毛利率低於標準');
    assert.equal(parsedArgs.below_standard_lines.length, 1);
    assert.equal(parsedArgs.below_standard_lines[0].difference, 50.0);
  });

  test('TC-APP-N-04: list_pending_approval_quotes returns pending quotes with below-standard lines and differences', async () => {
    // Given: One quote pending approval, one quote sent directly
    const qPending = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: qPending.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 3.0,
        unit_price: 75.0 // diff = 25
      }
    });
    await invoke('submit_quote', { quote_id: qPending.quote.id });

    const qSent = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: qSent.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 1.0,
        unit_price: 100.0 // no discount
      }
    });
    await invoke('submit_quote', { quote_id: qSent.quote.id });

    // When: Querying pending approval list
    const pendingList = await invoke('list_pending_approval_quotes');

    // Then: Returns pending quote with below_standard_lines
    assert.ok(Array.isArray(pendingList));
    const found = pendingList.find(item => item.quote.id === qPending.quote.id);
    assert.ok(found, 'Pending quote should be in list_pending_approval_quotes');
    assert.equal(found.quote.status, 'pending_approval');
    assert.equal(found.quote.quote_number, qPending.quote.quote_number);
    assert.equal(found.quote.customer_name_snapshot, customer.name);
    assert.equal(found.below_standard_lines.length, 1);
    assert.equal(found.below_standard_lines[0].difference, 25.0);

    const sentInList = pendingList.find(item => item.quote.id === qSent.quote.id);
    assert.equal(sentInList, undefined, 'Sent quote should not be in pending list');
  });

  test('TC-APP-B-01 & TC-APP-B-02: reject_quote with empty or whitespace reason is blocked', async () => {
    // Given: A quote in pending_approval
    const created = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: created.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 1.0,
        unit_price: 50.0
      }
    });
    await invoke('submit_quote', { quote_id: created.quote.id });

    // When & Then: TC-APP-B-01: Rejection with empty reason fails
    await assert.rejects(
      async () => {
        await invoke('reject_quote', { quote_id: created.quote.id, reason: '' });
      },
      /駁回理由為必填/
    );

    // When & Then: TC-APP-B-02: Rejection with whitespace-only reason fails
    await assert.rejects(
      async () => {
        await invoke('reject_quote', { quote_id: created.quote.id, reason: '    ' });
      },
      /駁回理由為必填/
    );

    // And: Status remains pending_approval
    const quote = await invoke('get_quote', { quote_id: created.quote.id });
    assert.equal(quote.quote.status, 'pending_approval');
  });

  test('TC-APP-E-01 to TC-APP-E-06: Status validation prevents approval or rejection when not in pending_approval', async () => {
    // Given: A draft quote
    const draftQuote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: draftQuote.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 1.0,
        unit_price: 80.0
      }
    });

    // When & Then: TC-APP-E-01: Cannot approve draft quote
    await assert.rejects(
      async () => {
        await invoke('approve_quote', { quote_id: draftQuote.quote.id });
      },
      /目前狀態不允許此操作/
    );

    // When & Then: TC-APP-E-04: Cannot reject draft quote
    await assert.rejects(
      async () => {
        await invoke('reject_quote', { quote_id: draftQuote.quote.id, reason: '理由' });
      },
      /目前狀態不允許此操作/
    );

    // Given: A sent quote
    const sentQuote = await invoke('create_quote', {
      input: {
        customer_partner_id: customer.id,
        valid_until: '2026-12-31'
      }
    });
    await invoke('add_quote_line', {
      input: {
        quote_id: sentQuote.quote.id,
        unit_id: sellableProduct100.units[0].id,
        quantity: 1.0,
        unit_price: 100.0
      }
    });
    await invoke('submit_quote', { quote_id: sentQuote.quote.id });

    // When & Then: TC-APP-E-02: Cannot approve sent quote
    await assert.rejects(
      async () => {
        await invoke('approve_quote', { quote_id: sentQuote.quote.id });
      },
      /目前狀態不允許此操作/
    );

    // When & Then: TC-APP-E-05: Cannot reject sent quote
    await assert.rejects(
      async () => {
        await invoke('reject_quote', { quote_id: sentQuote.quote.id, reason: '理由' });
      },
      /目前狀態不允許此操作/
    );

    // Given: A cancelled quote (terminal)
    await invoke('cancel_quote', { quote_id: sentQuote.quote.id });

    // When & Then: TC-APP-E-03: Cannot approve terminal quote
    await assert.rejects(
      async () => {
        await invoke('approve_quote', { quote_id: sentQuote.quote.id });
      },
      /此報價單已結案，無法修改/
    );

    // When & Then: TC-APP-E-06: Cannot reject terminal quote
    await assert.rejects(
      async () => {
        await invoke('reject_quote', { quote_id: sentQuote.quote.id, reason: '理由' });
      },
      /此報價單已結案，無法修改/
    );
  });
});

