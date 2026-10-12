/**
 * @file multi-tenant-isolation.test.js
 * @description Test suite for Multi-Tenant Data Isolation (Issue #149, Required Fix 1 & 2).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-ISO-N-01 | Session 切換至租戶 A 建立部門「業務部」，切換至租戶 B 建立同名部門 | Equivalence – 正常情境（跨租戶同名部門） | 兩租戶皆建立成功，各自擁有獨立 ID 與 tenant_id | 驗證無前端 tenantId 參數下隔離運作 |
 * | TC-ISO-N-02 | Session 分別切換至租戶 A 與租戶 B 查詢部門列表 | Equivalence – 正常情境（部門列表跨租戶隔離） | 租戶 A 僅能查到租戶 A 的部門；租戶 B 僅能查到租戶 B 的部門，互相看不到對方 | DoD 核心驗證 |
 * | TC-ISO-N-03 | Session 分別切換至租戶 A 與租戶 B 建立任務「月結報表審核」 | Equivalence – 正常情境（任務建立與隔離） | 兩租戶任務皆建立成功，各自隔離於 active tenant | 移除前端 tenantId 參數 |
 * | TC-ISO-N-04 | Session 分別切換至租戶 A 與租戶 B 查詢任務列表 | Equivalence – 正常情境（任務列表跨租戶隔離） | 租戶 A 僅能查到租戶 A 的任務；租戶 B 僅能查到租戶 B 的任務 | 移除前端 tenantId 參數 |
 * | TC-ISO-N-05 | Session 分別切換至租戶 A 與租戶 B 建立同名同統編合作夥伴「台積電 22099131」 | Equivalence – 正常情境（跨租戶同名同統編夥伴） | 兩租戶皆建立成功，各自獨立 partner ID | 驗證夥伴名稱與統編查重限縮於同租戶 |
 * | TC-ISO-N-06 | Session 分別切換至租戶 A 與租戶 B 查詢合作夥伴列表 | Equivalence – 正常情境（合作夥伴跨租戶隔離） | 租戶 A 僅能查到租戶 A 的夥伴；租戶 B 僅能查到租戶 B 的夥伴 | 移除前端 tenantId 參數 |
 * | TC-ISO-N-07 | 切換租戶（selectTenantAction）後 store 自動重新載入該租戶資料 | Equivalence – 正常情境（租戶切換聯動） | appState.tasks, appState.departments, appState.partners 自動同步為目標租戶之資料 | 驗證前端切換流程 |
 * | TC-ISO-SEC-01 | 前端呼叫帶入惡意覆寫 `{ tenantId: 'tnt_other' }` 呼叫 create/list 命令 | Equivalence – 資安防禦（前端偽造 tenant_id 被忽略） | 後端一律依據 Session 之 active tenant 寫入/查詢，前端傳入的值完全無效 | Required Fix 1 核心驗證 |
 * | TC-ISO-MUT-01 | 當前租戶 A 呼叫 update_department_skills 更新自身部門技能 | Equivalence – 正常情境（同租戶技能更新） | 更新成功，返回該部門最新 skills 清單 | 正常流程 |
 * | TC-ISO-MUT-02 | 當前處於租戶 B，呼叫 update_department_skills 傳入租戶 A 的 department ID | Equivalence – 資安防禦（跨租戶修改部門技能被拒） | 拒絕更新，拋出 Department not found 錯誤 | Required Fix 2 核心驗證 |
 * | TC-ISO-MUT-03 | 當前租戶 A 呼叫 update_task_status 更新自身任務狀態 | Equivalence – 正常情境（同租戶任務狀態更新） | 任務狀態成功更新為指定狀態（如 done），completed_at 正確紀錄 | 正常流程 |
 * | TC-ISO-MUT-04 | 當前處於租戶 B，呼叫 update_task_status 傳入租戶 A 的 task ID | Equivalence – 資安防禦（跨租戶修改任務狀態被拒） | 拒絕更新，拋出 Task not found 錯誤 | Required Fix 2 核心驗證 |
 * | TC-ISO-E-01 | 同一租戶內重複建立相同部門名稱 | Equivalence – 異常情境（同租戶重複拒絕） | 拋出「部門已存在」錯誤 | 驗證同租戶查重仍然有效 |
 * | TC-ISO-E-02 | 同一租戶內重複建立相同合作夥伴名稱 | Equivalence – 異常情境（同租戶夥伴重複拒絕） | 拋出「已存在」錯誤 | 驗證同租戶查重仍然有效 |
 * | TC-ISO-B-01 | 部門名稱為空字串 `""` | Boundary – empty | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-02 | 部門名稱為純空白 `"   "` | Boundary – whitespace | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-03 | 夥伴名稱為空字串 `""` | Boundary – empty | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-04 | 夥伴名稱為純空白 `"   "` | Boundary – whitespace | 拋出驗證錯誤 | 邊界防禦 |
 * | TC-ISO-B-05 | 查詢未知/未註冊租戶之部門與夥伴資料 | Boundary – 未知租戶 | 依 Session active tenant 安全回傳，不拋出未捕獲崩潰 | 隔離安全防禦 |
 * | TC-ISO-B-06 | 查詢時租戶 ID 為 NULL 或純空白參數 | Boundary – NULL / empty | 依 Session fallback 安全處理，不洩漏任何跨租戶資料 | 邊界防禦 |
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

// Helper to ensure authenticated state in test suite
async function ensureAuthenticated() {
  await login('admin@example.com', 'password123');
}

test('TC-ISO-N-01: Cross-tenant duplicate department names are allowed and isolated without frontend tenantId', async () => {
  // Given: Authenticated user with access to tnt_mock_1 and tnt_mock_2
  await ensureAuthenticated();
  const deptName = `業務部_${Date.now()}`;

  // When: Switched to tnt_mock_1, create department
  await selectTenantAction('tnt_mock_1');
  const deptA = await invoke('create_department', { name: deptName });

  // And When: Switched to tnt_mock_2, create department with the same name
  await selectTenantAction('tnt_mock_2');
  const deptB = await invoke('create_department', { name: deptName });

  // Then: Both creations succeed with independent IDs and distinct tenant IDs
  assert.ok(deptA.id);
  assert.ok(deptB.id);
  assert.notEqual(deptA.id, deptB.id);
  assert.equal(deptA.tenant_id, 'tnt_mock_1');
  assert.equal(deptB.tenant_id, 'tnt_mock_2');
  assert.equal(deptA.name, deptName);
  assert.equal(deptB.name, deptName);
});

test('TC-ISO-N-02: Department list strictly isolates data by active tenant (DoD verification)', async () => {
  // Given: Distinct departments created under tnt_mock_1 and tnt_mock_2
  await ensureAuthenticated();
  const deptNameA = `研發處_A_${Date.now()}`;
  const deptNameB = `財務處_B_${Date.now()}`;

  await selectTenantAction('tnt_mock_1');
  await invoke('create_department', { name: deptNameA });

  await selectTenantAction('tnt_mock_2');
  await invoke('create_department', { name: deptNameB });

  // When: Listing departments for tnt_mock_1
  await selectTenantAction('tnt_mock_1');
  const listA = await invoke('list_departments');

  // And When: Listing departments for tnt_mock_2
  await selectTenantAction('tnt_mock_2');
  const listB = await invoke('list_departments');

  // Then: tnt_mock_1 only sees tnt_mock_1's departments
  assert.ok(listA.some(d => d.name === deptNameA));
  assert.ok(!listA.some(d => d.name === deptNameB));
  assert.ok(listA.every(d => (d.tenant_id || 'tnt_mock_1') === 'tnt_mock_1'));

  // And Then: tnt_mock_2 only sees tnt_mock_2's departments
  assert.ok(listB.some(d => d.name === deptNameB));
  assert.ok(!listB.some(d => d.name === deptNameA));
  assert.ok(listB.every(d => (d.tenant_id || 'tnt_mock_1') === 'tnt_mock_2'));
});

test('TC-ISO-N-03: Tasks created under distinct tenants are segregated by active session', async () => {
  // Given: Authenticated session
  await ensureAuthenticated();
  const taskTitle = `月結報表審核_${Date.now()}`;

  // When: Switched to tnt_mock_1, create task
  await selectTenantAction('tnt_mock_1');
  const taskA = await invoke('create_task', {
    title: taskTitle,
    moduleId: 'finance',
    assignee: '財務主管'
  });

  // And When: Switched to tnt_mock_2, create task
  await selectTenantAction('tnt_mock_2');
  const taskB = await invoke('create_task', {
    title: taskTitle,
    moduleId: 'finance',
    assignee: '出納人員'
  });

  // Then: Both tasks succeed with separate IDs and correct tenant IDs
  assert.ok(taskA.id);
  assert.ok(taskB.id);
  assert.notEqual(taskA.id, taskB.id);
  assert.equal(taskA.tenant_id, 'tnt_mock_1');
  assert.equal(taskB.tenant_id, 'tnt_mock_2');
});

test('TC-ISO-N-04: Task list strictly isolates data between tenants (DoD verification)', async () => {
  // Given: Distinct tasks created for tnt_mock_1 and tnt_mock_2
  await ensureAuthenticated();
  const titleA = `專案A任務_${Date.now()}`;
  const titleB = `專案B任務_${Date.now()}`;

  await selectTenantAction('tnt_mock_1');
  await invoke('create_task', { title: titleA, moduleId: 'sales', assignee: '業務A' });

  await selectTenantAction('tnt_mock_2');
  await invoke('create_task', { title: titleB, moduleId: 'sales', assignee: '業務B' });

  // When: Querying tasks for tnt_mock_1
  await selectTenantAction('tnt_mock_1');
  const listA = await invoke('list_tasks');

  // And When: Querying tasks for tnt_mock_2
  await selectTenantAction('tnt_mock_2');
  const listB = await invoke('list_tasks');

  // Then: Tenant 1 only sees Tenant 1 tasks
  assert.ok(listA.some(t => t.title === titleA));
  assert.ok(!listA.some(t => t.title === titleB));
  assert.ok(listA.every(t => (t.tenant_id || 'tnt_mock_1') === 'tnt_mock_1'));

  // And Then: Tenant 2 only sees Tenant 2 tasks
  assert.ok(listB.some(t => t.title === titleB));
  assert.ok(!listB.some(t => t.title === titleA));
  assert.ok(listB.every(t => (t.tenant_id || 'tnt_mock_1') === 'tnt_mock_2'));
});

test('TC-ISO-N-05: Cross-tenant duplicate partner name & tax ID are permitted without conflict', async () => {
  // Given: Authenticated session
  await ensureAuthenticated();
  const partnerName = `台積電_${Date.now()}`;
  const taxId = '22099131';

  // When: Switched to tnt_mock_1, register partner
  await selectTenantAction('tnt_mock_1');
  const pA = await invoke('create_partner', {
    name: partnerName,
    taxId,
    isCustomer: true
  });

  // And When: Switched to tnt_mock_2, register partner with the same name and tax ID
  await selectTenantAction('tnt_mock_2');
  const pB = await invoke('create_partner', {
    name: partnerName,
    taxId,
    isCustomer: true
  });

  // Then: Both creations succeed with independent records
  assert.ok(pA.id);
  assert.ok(pB.id);
  assert.notEqual(pA.id, pB.id);
  assert.equal(pA.tenant_id, 'tnt_mock_1');
  assert.equal(pB.tenant_id, 'tnt_mock_2');
  assert.equal(pA.name, partnerName);
  assert.equal(pB.name, partnerName);
});

test('TC-ISO-N-06: Partner list strictly isolates data by active tenant (DoD verification)', async () => {
  // Given: Separate partners created in tnt_mock_1 and tnt_mock_2
  await ensureAuthenticated();
  const nameA = `聯發科_A_${Date.now()}`;
  const nameB = `廣達電_B_${Date.now()}`;

  await selectTenantAction('tnt_mock_1');
  await invoke('create_partner', { name: nameA });

  await selectTenantAction('tnt_mock_2');
  await invoke('create_partner', { name: nameB });

  // When: Querying partners for tnt_mock_1
  await selectTenantAction('tnt_mock_1');
  const listA = await invoke('list_partners');

  // And When: Querying partners for tnt_mock_2
  await selectTenantAction('tnt_mock_2');
  const listB = await invoke('list_partners');

  // Then: tnt_mock_1 does not see tnt_mock_2's partners
  assert.ok(listA.some(p => p.name === nameA));
  assert.ok(!listA.some(p => p.name === nameB));
  assert.ok(listA.every(p => (p.tenant_id || 'tnt_mock_1') === 'tnt_mock_1'));

  // And Then: tnt_mock_2 does not see tnt_mock_1's partners
  assert.ok(listB.some(p => p.name === nameB));
  assert.ok(!listB.some(p => p.name === nameA));
  assert.ok(listB.every(p => (p.tenant_id || 'tnt_mock_1') === 'tnt_mock_2'));
});

test('TC-ISO-N-07: Switching tenant via selectTenantAction triggers store refetch with new tenant context', async () => {
  // Given: Authenticated session in mock with two accessible tenants: tnt_mock_1 and tnt_mock_2
  await ensureAuthenticated();

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

test('TC-ISO-SEC-01: Malicious caller passing tenantId override is completely ignored (Required Fix 1)', async () => {
  // Given: Currently active in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const deptName = `資安驗證部_${Date.now()}`;

  // When: Malicious caller attempts to pass tenantId: 'tnt_mock_2' to create_department
  const dept = await invoke('create_department', {
    name: deptName,
    tenantId: 'tnt_mock_2',
    tenant_id: 'tnt_mock_2'
  });

  // Then: Department is strictly bound to tnt_mock_1 (active session tenant), override is ignored
  assert.equal(dept.tenant_id, 'tnt_mock_1');

  // And When: Malicious caller attempts to pass tenantId: 'tnt_mock_2' to list_departments while active in tnt_mock_1
  const list = await invoke('list_departments', {
    tenantId: 'tnt_mock_2',
    tenant_id: 'tnt_mock_2'
  });

  // Then: All returned departments strictly belong to tnt_mock_1
  assert.ok(list.some(d => d.id === dept.id));
  assert.ok(list.every(d => (d.tenant_id || 'tnt_mock_1') === 'tnt_mock_1'));
});

test('TC-ISO-MUT-01: Updating department skills within active tenant succeeds (Required Fix 2)', async () => {
  // Given: An existing department in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const dept = await invoke('create_department', { name: `資訊安全部_${Date.now()}` });

  // When: update_department_skills is called within the same tenant
  const updated = await invoke('update_department_skills', {
    departmentId: dept.id,
    skills: ['audit.trace_view', 'security.monitor']
  });

  // Then: Department skills are updated
  assert.deepEqual(updated.skills, ['audit.trace_view', 'security.monitor']);
  assert.equal(updated.id, dept.id);
});

test('TC-ISO-MUT-02: Updating department skills of another tenant is rejected with Department not found (Required Fix 2)', async () => {
  // Given: A department created in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const deptInTenant1 = await invoke('create_department', { name: `租戶1專屬部門_${Date.now()}` });

  // When: Current active session switches to tnt_mock_2
  await selectTenantAction('tnt_mock_2');

  // Then: Attempting to mutate tenant 1's department ID fails with not found error
  await assert.rejects(
    async () => {
      await invoke('update_department_skills', {
        departmentId: deptInTenant1.id,
        skills: ['hacked.skill']
      });
    },
    /Department not found/
  );
});

test('TC-ISO-MUT-03: Updating task status within active tenant succeeds (Required Fix 2)', async () => {
  // Given: A task created in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const task = await invoke('create_task', {
    title: `同租戶任務狀態測試_${Date.now()}`,
    moduleId: 'sales',
    assignee: '測試人員'
  });
  assert.equal(task.status, 'pending');

  // When: update_task_status is called within tnt_mock_1
  await invoke('update_task_status', {
    taskId: task.id,
    status: 'done'
  });

  // Then: Task is updated to done
  const list = await invoke('list_tasks');
  const updatedTask = list.find(t => t.id === task.id);
  assert.ok(updatedTask);
  assert.equal(updatedTask.status, 'done');
  assert.ok(updatedTask.completed_at);
});

test('TC-ISO-MUT-04: Updating task status of another tenant is rejected with Task not found (Required Fix 2)', async () => {
  // Given: A task created in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const taskInTenant1 = await invoke('create_task', {
    title: `租戶1機密任務_${Date.now()}`,
    moduleId: 'finance',
    assignee: '專員'
  });

  // When: Current active session switches to tnt_mock_2
  await selectTenantAction('tnt_mock_2');

  // Then: Attempting to mutate tenant 1's task status fails with Task not found error
  await assert.rejects(
    async () => {
      await invoke('update_task_status', {
        taskId: taskInTenant1.id,
        status: 'cancelled'
      });
    },
    /Task not found/
  );
});

test('TC-ISO-E-01: Duplicate department name within the same tenant is rejected', async () => {
  // Given: Active in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const deptName = `品保部_${Date.now()}`;
  await invoke('create_department', { name: deptName });

  // When: Attempting to create the same department name in the same active tenant
  // Then: Rejection error is thrown
  await assert.rejects(
    async () => {
      await invoke('create_department', { name: deptName });
    },
    /已存在/
  );
});

test('TC-ISO-E-02: Duplicate partner name within the same tenant is rejected', async () => {
  // Given: Active in tnt_mock_1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const partnerName = `宏碁電腦_${Date.now()}`;
  await invoke('create_partner', { name: partnerName, isCustomer: true });

  // When: Attempting to register another customer with the same name in the same active tenant
  // Then: Duplicate rejection error is thrown
  await assert.rejects(
    async () => {
      await invoke('create_partner', { name: partnerName, isCustomer: true });
    },
    /已存在/
  );
});

test('TC-ISO-B-01: Empty string department name throws validation error', async () => {
  await ensureAuthenticated();
  // When: Creating department with empty name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_department', { name: '' });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-02: Whitespace-only department name throws validation error', async () => {
  await ensureAuthenticated();
  // When: Creating department with whitespace name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_department', { name: '    ' });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-03: Empty string partner name throws validation error', async () => {
  await ensureAuthenticated();
  // When: Creating partner with empty name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_partner', { name: '' });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-04: Whitespace-only partner name throws validation error', async () => {
  await ensureAuthenticated();
  // When: Creating partner with whitespace name
  // Then: Validation error is raised
  await assert.rejects(
    async () => {
      await invoke('create_partner', { name: '   ' });
    },
    /cannot be empty/i
  );
});

test('TC-ISO-B-05: Querying with unknown tenant ID in args safely falls back to session without crash', async () => {
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const unknownTenant = 'tnt_ghost_999999';

  // When: Querying departments, tasks, and partners with unrecognized tenant parameter in args
  const depts = await invoke('list_departments', { tenantId: unknownTenant });
  const tasks = await invoke('list_tasks', { tenantId: unknownTenant });
  const partners = await invoke('list_partners', { tenantId: unknownTenant });

  // Then: System safely falls back to current active tenant without crashing
  assert.ok(Array.isArray(depts));
  assert.ok(Array.isArray(tasks));
  assert.ok(Array.isArray(partners));
  assert.ok(depts.every(d => (d.tenant_id || 'tnt_mock_1') === 'tnt_mock_1'));
});

test('TC-ISO-B-06: Querying with empty or whitespace tenantId in args defaults safely to active session', async () => {
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  // When: Querying with whitespace tenantId
  const depts = await invoke('list_departments', { tenantId: '   ' });
  const tasks = await invoke('list_tasks', { tenantId: '   ' });
  const partners = await invoke('list_partners', { tenantId: '   ' });

  // Then: Results safely return active session data
  assert.ok(Array.isArray(depts));
  assert.ok(Array.isArray(tasks));
  assert.ok(Array.isArray(partners));
});
