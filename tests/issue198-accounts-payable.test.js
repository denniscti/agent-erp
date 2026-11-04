import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

test.describe('Issue #198: Accounts Payable Mock IPC & Core Behavior', () => {
  test('TC-AP-JS-01: list_accounts_payable empty returns empty array', async () => {
    // Given: Active tenant
    await invoke('set_mock_active_tenant', { tenant_id: 'tnt_mock_1' });

    // When: Querying list_accounts_payable
    const list = await invoke('list_accounts_payable', {});

    // Then: Returns array
    assert.ok(Array.isArray(list));
  });

  test('TC-AP-JS-02: get_account_payable missing ID throws error', async () => {
    // When / Then: Missing ID throws descriptive error
    await assert.rejects(
      async () => {
        await invoke('get_account_payable', {});
      },
      {
        message: '缺少應付帳款 ID (id 或 ap_id)'
      }
    );
  });

  test('TC-AP-JS-03: get_account_payable nonexistent AP throws not found error', async () => {
    // When / Then: Nonexistent AP throws
    await assert.rejects(
      async () => {
        await invoke('get_account_payable', { id: 'ap_nonexistent' });
      },
      {
        message: '找不到指定的應付帳款或不屬於目前租戶'
      }
    );
  });
});

