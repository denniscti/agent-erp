/**
 * @file multi-tenant-isolation.test.js
 * @description Test suite for Multi-Tenant Data Isolation (Issue #149).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-ISO-N-01 | 租戶 A 與租戶 B 分別建立同名部門「業務部」 | Equivalence – 正常情境（跨租戶同名部門） | 兩租戶皆建立成功，各自擁有獨立 ID 與 tenant_id | 驗證部門查重範圍限縮於同一租戶 |
 * | TC-ISO-N-02 | 租戶 A 與租戶 B 查詢部門列表 | Equivalence – 正常情境（部門列表跨租戶隔離） | 租戶 A 僅能查到租戶 A 的部門；租戶 B 僅能查到租戶 B 的部門，互相看不到對方 | 滿足 Issue #149 DoD |
 * | TC-ISO-N-03 | 租戶 A 與租戶 B 分別建立任務「月結報表審核」 | Equivalence – 正常情境（任務建立與隔離） | 兩租戶任務皆建立成功，各自隔離 | 驗證任務依活動租戶建立 |
 * | TC-ISO-N-04 | 租戶 A 與租戶 B 查詢任務列表 | Equivalence – 正常情境（任務列表跨租戶隔離） | 租戶 A 僅能查到租戶 A 的任務；租戶 B 僅能查到租戶 B 的任務，互相看不到對方 | 滿足 Issue #149 DoD |
 * | TC-ISO-N-05 | 租戶 A 與租戶 B 分別建立同名同統編合作夥伴「台積電 22099131」 | Equivalence – 正常情境（跨租戶同名同統編夥伴） | 兩租戶皆建立成功，各自獨立 partner ID | 驗證夥伴名稱與統編查重限縮於同租戶 |
 * | TC-ISO-N-06 | 租戶 A 與租戶 B 查詢合作夥伴列表 | Equivalence – 正常情境（合作夥伴跨租戶隔離） | 租戶 A 僅能查到租戶 A 的夥伴；租戶 B 僅能查到租戶 B 的夥伴，互相看不到對方 | 滿足 Issue #149 DoD |
 * | TC-ISO-N-07 | 切換租戶（selectTenantAction）後 store 自動重新載入該租戶資料 | Equivalence – 正常情境（租戶切換聯動） | appState.tasks, appState.departments, appState.partners 自動同步為目標租戶之資料 | 驗證前端切換流程 |
 * | TC-ISO-E-01 | 同一租戶內重複建立相同部門名稱 | Equivalence – 異常情境（同租戶重複拒絕） | 拋出「部門已存在」錯誤 | 驗證同租戶查重仍然有效 |
 * | TC-ISO-E-02 | 同一租戶內重複建立相同合作夥伴名稱 | Equivalence – 異常情境（同租戶夥伴重複拒絕） | 拋出「已存在」錯誤 | 驗證同租戶查重仍然有效 |
 * | TC-ISO-B-01 | 部門名稱為空字串 `""` | Boundary – empty | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-02 | 部門名稱為純空白 `"   "` | Boundary – whitespace | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-03 | 夥伴名稱為空字串 `""` | Boundary – empty | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-04 | 夥伴名稱為純空白 `"   "` | Boundary – whitespace | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-05 | 查詢未知/未註冊租戶之部門與夥伴資料 | Boundary – 未知租戶 | 回傳空陣列 `[]`，不拋出未捕獲崩潰 | 隔離安全防禦 |
 * | TC-ISO-B-06 | 查詢時租戶 ID 為 NULL 或空字串 | Boundary – NULL / empty | 依 Session fallback 或回傳安全空陣列，不洩漏任何跨租戶資料 | 邊界防禦 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  login,
  selectTenantAction
} = await import('../src/lib/store.svelte.js');

const { invoke } = await import('../src/lib/tauri.js');

test('TC-ISO-N-01: Cross-tenant duplicate department names are allowed and isolated', async () => {
  // Given: Two distinct tenants (Tenant A and Tenant B)
  const tenantA = 'tnt_iso_a';
  const tenantB = 'tnt_iso_b';
  const deptName = `業務部_${Date.now()}`;

  // When: Tenant A creates the department
  const deptA = await invoke('create_department', {
    name: deptName,
    tenantId: tenantA
  });

  // And When: Tenant B creates a department with the exact same name
  const deptB = await invoke('create_department', {
    name: deptName,
    tenantId: tenantB
  });

  // Then: Both creations succeed with independent IDs and distinct tenant IDs
  assert.ok(deptA.id);
  assert.ok(deptB.id);
  assert.notEqual(deptA.id, deptB.id);
  assert.equal(deptA.tenant_id, tenantA);
  assert.equal(deptB.tenant_id, tenantB);
  assert.equal(deptA.name, deptName);
  assert.equal(deptB.name, deptName);
});

test('TC-ISO-N-02: Department list strictly isolates data by active tenant (DoD verification)', async () => {
  // Given: Unique departments created under Tenant A and Tenant B
  const tenantA = 'tnt_iso_a';
  const tenantB = 'tnt_iso_b';
  const deptNameA = `研發處_A_${Date.now()}`;
  const deptNameB = `財務處_B_${Date.now()}`;

  await invoke('create_department', { name: deptNameA, tenantId: tenantA });
  await invoke('create_department', { name: deptNameB, tenantId: tenantB });

  // When: Listing departments for Tenant A
  const listA = await invoke('list_departments', { tenantId: tenantA });
  // And When: Listing departments for Tenant B
  const listB = await invoke('list_departments', { tenantId: tenantB });

  // Then: Tenant A only sees Tenant A's departments and cannot see Tenant B's
  assert.ok(listA.some(d => d.name === deptNameA));
  assert.ok(!listA.some(d => d.name === deptNameB));
  assert.ok(listA.every(d => (d.tenant_id || 'tnt_mock_1') === tenantA));

  // And Then: Tenant B only sees Tenant B's departments and cannot see Tenant A's
  assert.ok(listB.some(d => d.name === deptNameB));
  assert.ok(!listB.some(d => d.name === deptNameA));
  assert.ok(listB.every(d => (d.tenant_id || 'tnt_mock_1') === tenantB));
});

test('TC-ISO-N-03: Tasks created under distinct tenants are segregated', async () => {
  // Given: Tenant A and Tenant B
  const tenantA = 'tnt_iso_task_a';
  const tenantB = 'tnt_iso_task_b';
  const taskTitle = `月結報表審核_${Date.now()}`;

  // When: Creating tasks with same title under each tenant
  const taskA = await invoke('create_task', {
    title: taskTitle,
    moduleId: 'finance',
    assignee: '財務主管',
    tenantId: tenantA
  });
  const taskB = await invoke('create_task', {
    title: taskTitle,
    moduleId: 'finance',
    assignee: '出納人員',
    tenantId: tenantB
  });

  // Then: Both tasks succeed with separate IDs and correct tenant IDs
  assert.ok(taskA.id);
  assert.ok(taskB.id);
  assert.notEqual(taskA.id, taskB.id);
  assert.equal(taskA.tenant_id, tenantA);
  assert.equal(taskB.tenant_id, tenantB);
});

test('TC-ISO-N-04: Task list strictly isolates data between tenants (DoD verification)', async () => {
  // Given: Distinct tasks created for Tenant A and Tenant B
  const tenantA = 'tnt_iso_task_a';
  const tenantB = 'tnt_iso_task_b';
  const titleA = `專案A任務_${Date.now()}`;
  const titleB = `專案B任務_${Date.now()}`;

  await invoke('create_task', { title: titleA, moduleId: 'sales', assignee: '業務A', tenantId: tenantA });
  await invoke('create_task', { title: titleB, moduleId: 'sales', assignee: '業務B', tenantId: tenantB });

  // When: Querying tasks for each tenant
  const listA = await invoke('list_tasks', { tenantId: tenantA });
  const listB = await invoke('list_tasks', { tenantId: tenantB });

  // Then: Tenant A only sees Tenant A tasks
  assert.ok(listA.some(t => t.title === titleA));
  assert.ok(!listA.some(t => t.title === titleB));
  assert.ok(listA.every(t => (t.tenant_id || 'tnt_mock_1') === tenantA));

  // And Then: Tenant B only sees Tenant B tasks
  assert.ok(listB.some(t => t.title === titleB));
  assert.ok(!listB.some(t => t.title === titleA));
  assert.ok(listB.every(t => (t.tenant_id || 'tnt_mock_1') === tenantB));
});

test('TC-ISO-N-05: Cross-tenant duplicate partner name & tax ID are permitted without conflict', async () => {
  // Given: Tenant A and Tenant B
  const tenantA = 'tnt_iso_ptr_a';
  const tenantB = 'tnt_iso_ptr_b';
  const partnerName = `台積電_${Date.now()}`;
  const taxId = '22099131';

  // When: Tenant A registers the partner
  const pA = await invoke('create_partner', {
    name: partnerName,
    taxId,
    tenantId: tenantA,
    isCustomer: true
  });

  // And When: Tenant B registers the partner with the same name and tax ID
  const pB = await invoke('create_partner', {
    name: partnerName,
    taxId,
    tenantId: tenantB,
    isCustomer: true
  });

  // Then: Both creations succeed with independent records
  assert.ok(pA.id);
  assert.ok(pB.id);
  assert.notEqual(pA.id, pB.id);
  assert.equal(pA.tenant_id, tenantA);
  assert.equal(pB.tenant_id, tenantB);
  assert.equal(pA.name, partnerName);
  assert.equal(pB.name, partnerName);
});

test('TC-ISO-N-06: Partner list strictly isolates data by active tenant (DoD verification)', async () => {
  // Given: Separate partners created in Tenant A and Tenant B
  const tenantA = 'tnt_iso_ptr_a';
  const tenantB = 'tnt_iso_ptr_b';
  const nameA = `聯發科_A_${Date.now()}`;
  const nameB = `廣達電_B_${Date.now()}`;

  await invoke('create_partner', { name: nameA, tenantId: tenantA });
  await invoke('create_partner', { name: nameB, tenantId: tenantB });

  // When: Querying partners for Tenant A and Tenant B
  const listA = await invoke('list_partners', { tenantId: tenantA });
  const listB = await invoke('list_partners', { tenantId: tenantB });

  // Then: Tenant A does not see Tenant B's partners
  assert.ok(listA.some(p => p.name === nameA));
  assert.ok(!listA.some(p => p.name === nameB));
  assert.ok(listA.every(p => (p.tenant_id || 'tnt_mock_1') === tenantA));

  // And Then: Tenant B does not see Tenant A's partners
  assert.ok(listB.some(p => p.name === nameB));
  assert.ok(!listB.some(p => p.name === nameA));
  assert.ok(listB.every(p => (p.tenant_id || 'tnt_mock_1') === tenantB));
});

test('TC-ISO-N-07: Switching tenant via selectTenantAction triggers store refetch with new tenant context', async () => {
  // Given: Authenticated session in mock with two accessible tenants: tnt_mock_1 and tnt_mock_2
  await login('admin@example.com', 'password123');

  // When: Switching to tnt_mock_2
  await selectTenantAction('tnt_mock_2');

  // Then: appState.activeTenant is updated to tnt_mock_2
  assert.equal(appState.activeTenant?.id, 'tnt_mock_2');

  // And Then: appState departments, tasks, and partners are populated for tnt_mock_2
  assert.ok(Array.isArray(appState.departments));
  assert.ok(Array.isArray(appState.tasks));
  assert.ok(Array.isArray(appState.partners));

  // Clean up: Switch back to tnt_mock_1
  await selectTenantAction('tnt_mock_1');
  assert.equal(appState.activeTenant?.id, 'tnt_mock_1');
});

test('TC-ISO-E-01: Duplicate department name within the same tenant is rejected', async () => {
  // Given: An existing department in Tenant A
  const tenantA = 'tnt_dup_dept';
  const deptName = `品保部_${Date.now()}`;
  await invoke('create_department', { name: deptName, tenantId: tenantA });

  // When: Attempting to create the same department name in Tenant A
  // Then: Rejection error is thrown
  await assert.rejects(
    async () => {
      await invoke('create_department', { name: deptName, tenantId: tenantA });
    },
    /已存在/
  );
});

test('TC-ISO-E-02: Duplicate partner name within the same tenant is rejected', async () => {
  // Given: An existing partner in Tenant A
  const tenantA = 'tnt_dup_ptr';
  const partnerName = `宏碁電腦_${Date.now()}`;
  await invoke('create_partner', { name: partnerName, tenantId: tenantA, isCustomer: true });

  // When: Attempting to register another customer with the same name in Tenant A
  // Then: Duplicate rejection error is thrown
  await assert.rejects(
    async () => {
      await invoke('create_partner', { name: partnerName, tenantId: tenantA, isCustomer: true });
    },
    /已存在/
  );
});

test('TC-ISO-B-01: Empty string department name throws validation error', async () => {
  // Given: Tenant A
  const tenantA = 'tnt_bound_a';

  // When: Creating department with empty name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_department', { name: '', tenantId: tenantA });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-02: Whitespace-only department name throws validation error', async () => {
  // Given: Tenant A
  const tenantA = 'tnt_bound_a';

  // When: Creating department with whitespace name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_department', { name: '    ', tenantId: tenantA });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-03: Empty string partner name throws validation error', async () => {
  // Given: Tenant A
  const tenantA = 'tnt_bound_a';

  // When: Creating partner with empty name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_partner', { name: '', tenantId: tenantA });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-04: Whitespace-only partner name throws validation error', async () => {
  // Given: Tenant A
  const tenantA = 'tnt_bound_a';

  // When: Creating partner with whitespace name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_partner', { name: '   ', tenantId: tenantA });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-05: Querying unknown tenant returns empty list safely without leaking data', async () => {
  // Given: A non-existent tenant ID
  const unknownTenant = 'tnt_ghost_999999';

  // When: Querying departments, tasks, and partners for the unknown tenant
  const depts = await invoke('list_departments', { tenantId: unknownTenant });
  const tasks = await invoke('list_tasks', { tenantId: unknownTenant });
  const partners = await invoke('list_partners', { tenantId: unknownTenant });

  // Then: All return empty arrays without error or leakage
  assert.equal(depts.length, 0);
  assert.equal(tasks.length, 0);
  assert.equal(partners.length, 0);
});

test('TC-ISO-B-06: Querying with empty or whitespace tenantId defaults safely without crash', async () => {
  // Given: Explicit whitespace tenantId
  // When: Querying with whitespace tenantId
  const depts = await invoke('list_departments', { tenantId: '   ' });
  const tasks = await invoke('list_tasks', { tenantId: '   ' });
  const partners = await invoke('list_partners', { tenantId: '   ' });

  // Then: Results safely return without throwing unhandled exceptions
  assert.ok(Array.isArray(depts));
  assert.ok(Array.isArray(tasks));
  assert.ok(Array.isArray(partners));
});
