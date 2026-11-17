import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke, mockAccountsReceivable, saveStorage } from '../src/lib/tauri.js';

test.describe('Issue #222: Accounts Receivable Mock IPC & Core Behavior', () => {
  test('TC-AR-JS-01: list_accounts_receivable empty returns empty array', async () => {
    // Given: Active tenant with cleared mock accounts receivable
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    mockAccountsReceivable.length = 0;
    saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);

    // When: Querying list_accounts_receivable
    const list = await invoke('list_accounts_receivable', {});

    // Then: Returns empty array
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 0);
  });

  test('TC-AR-JS-02: get_account_receivable missing ID throws error', async () => {
    // When / Then: Missing ID throws descriptive error
    await assert.rejects(
      async () => {
        await invoke('get_account_receivable', {});
      },
      {
        message: '缺少應收帳款 ID (id 或 ar_id)'
      }
    );
  });

  test('TC-AR-JS-03: get_account_receivable nonexistent AR throws not found error', async () => {
    // When / Then: Nonexistent AR throws not found error
    await assert.rejects(
      async () => {
        await invoke('get_account_receivable', { id: 'ar_nonexistent' });
      },
      {
        message: '找不到指定的應收帳款或不屬於目前租戶'
      }
    );
  });

  test('TC-AR-JS-04: list and get accounts receivable with derived amounts', async () => {
    // Given: Seeded mock AR record in tenant tnt_mock_1
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });
    mockAccountsReceivable.length = 0;
    mockAccountsReceivable.push({
      id: 'ar_mock_001',
      tenant_id: 'tnt_mock_1',
      customer_partner_id: 'cus_001',
      customer_name_snapshot: '測試客戶股份有限公司',
      source_type: 'customer_invoice',
      source_id: 'inv_001',
      source_number: 'INV-202611001',
      external_reference: 'AB-12345678',
      document_date: '2026-11-10',
      due_date: '2026-12-10',
      amount: 5250.0,
      currency: 'TWD',
      status: 'open',
      created_by: 'usr_admin',
      created_at: 1000,
      voided_by: null,
      voided_at: null,
      void_reason: null
    });
    saveStorage('agent_erp_mock_accounts_receivable', mockAccountsReceivable);

    // When: Querying list_accounts_receivable
    const list = await invoke('list_accounts_receivable', { customer_partner_id: 'cus_001' });

    // Then: Returns seeded item with derived outstanding amount
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'ar_mock_001');
    assert.strictEqual(list[0].amount, 5250.0);
    assert.strictEqual(list[0].received_amount, 0);
    assert.strictEqual(list[0].allowance_amount, 0);
    assert.strictEqual(list[0].outstanding_amount, 5250.0);
    assert.strictEqual(list[0].settlement_status, 'unpaid');

    // When: Querying get_account_receivable
    const detail = await invoke('get_account_receivable', { id: 'ar_mock_001' });

    // Then: Returns detail matching item derived properties
    assert.strictEqual(detail.id, 'ar_mock_001');
    assert.strictEqual(detail.customer_name_snapshot, '測試客戶股份有限公司');
    assert.strictEqual(detail.outstanding_amount, 5250.0);
    assert.strictEqual(detail.settlement_status, 'unpaid');
    assert.ok(Array.isArray(detail.allocations));
  });
});

