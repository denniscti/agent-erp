/**
 * @file onboarding-greeting.test.js
 * @description Test suite for Tenant Onboarding Tasks & Initial Greetings (Issue #118).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-ONB-N-01 | tenantName = '台積電研發中心' | Equivalence – Normal tenant onboarding seed | Creates '新租戶起步' parent task and both '設定部門' & '建立第一個客戶' subtasks with respective guidance messages and main welcome greeting | Main flow |
 * | TC-ONB-N-02 | Call getAgentProfileForTask on '建立第一個客戶' task | Equivalence – Workflow AgentProfile resolution | Resolves to customer.create_basic_profile AgentProfile with customer domain & tools | Skill binding |
 * | TC-ONB-N-03 | Customer subtask execution with runAgentTurn & confirmation | Equivalence – End-to-end customer creation in onboarding task | Triggers create_partner confirmation card, confirmation creates partner and updates store | Workflow loop |
 * | TC-ONB-B-01 | tenantName = 'Acme-Corp 123_Special' | Equivalence – English and special characters in tenant name | Special tenant name is safely embedded in all subtasks and main welcome | Encoding safety |
 * | TC-ONB-B-02 | tenantName = '' (empty string) | Boundary – Empty tenant name | Executed safely without throwing unhandled exceptions | Empty boundary |
 * | TC-ONB-B-03 | tenantName = '   ' (whitespace string) | Boundary – Whitespace tenant name | Executed safely without throwing unhandled exceptions | Whitespace boundary |
 * | TC-ONB-E-01 | Internal error during onboarding task creation | Error – Exception handling & logging | Caught gracefully by try-catch and logged via console.warn | Error resilience |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Shim Svelte 5 $state for Node.js test environment before importing store
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  seedOnboardingTasks,
  fetchPartners
} = await import('../src/lib/store.svelte.js');

const {
  getAgentProfileForTask,
  runAgentTurn,
  executeConfirmation
} = await import('../src/lib/workflow/index.js');

test('TC-ONB-N-01: Normal case - seedOnboardingTasks creates parent and both department & customer subtasks', async () => {
  // Given: Preconditions - Reset appState and mock store data
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const tenantName = '台積電研發中心';

  // When:  Operation to execute - Call seedOnboardingTasks with valid tenant name
  await seedOnboardingTasks(tenantName);

  // Then:  Expected result - Parent task and both subtasks are created
  const parentTasks = appState.tasks.filter(t => t.title === '新租戶起步');
  assert.ok(parentTasks.length > 0, 'Parent task 新租戶起步 should be created');
  const parentTask = parentTasks[parentTasks.length - 1];

  // 1. Verify '設定部門' subtask
  const deptSubTasks = appState.tasks.filter(t => t.title === '設定部門' && t.parent_task_id === parentTask.id);
  assert.ok(deptSubTasks.length > 0, 'Subtask 設定部門 should be created under parent task');
  const deptSubTask = deptSubTasks[deptSubTasks.length - 1];
  const deptMsgs = appState.taskMessages[deptSubTask.id] || [];
  assert.ok(deptMsgs.length > 0, 'Department subtask should have initial guidance message');
  assert.ok(
    deptMsgs[0].content.includes(`新租戶「${tenantName}」建立完成後，首要步驟是建立組織部門`),
    'Department subtask message should contain department setup guidance'
  );

  // 2. Verify '建立第一個客戶' subtask
  const customerSubTasks = appState.tasks.filter(t => t.title === '建立第一個客戶' && t.parent_task_id === parentTask.id);
  assert.ok(customerSubTasks.length > 0, 'Subtask 建立第一個客戶 should be created under parent task');
  const customerSubTask = customerSubTasks[customerSubTasks.length - 1];
  const customerMsgs = appState.taskMessages[customerSubTask.id] || [];
  assert.ok(customerMsgs.length > 0, 'Customer subtask should have initial guidance message');
  assert.ok(
    customerMsgs[0].content.includes(`新租戶「${tenantName}」建立完成後，讓我們來建立第一筆客戶基本資料`),
    'Customer subtask message should contain customer setup guidance'
  );

  // 3. Verify main ambient welcome message
  const mainMsgs = appState.taskMessages['main'] || [];
  assert.ok(mainMsgs.length > 0, 'Main ambient conversation should have messages');
  const mainGreeting = mainMsgs[mainMsgs.length - 1];
  assert.equal(mainGreeting.role, 'assistant');
  assert.equal(
    mainGreeting.content,
    `歡迎建立「${tenantName}」！要開始使用，我可以先幫你新增部門或邀請團隊成員，需要嗎？`,
    'Main chat message should have dedicated onboarding welcome text'
  );

  // Verify chatMessages state is synchronized
  assert.ok(
    appState.chatMessages.some(m => m.content.includes(`歡迎建立「${tenantName}」`)),
    'appState.chatMessages should contain the dedicated welcome message'
  );
});

test('TC-ONB-N-02: Normal case - getAgentProfileForTask resolves customerCreateBasicProfileAgentProfile for 建立第一個客戶', () => {
  // Given: Preconditions - An onboarding subtask with title '建立第一個客戶'
  const task = {
    id: 'task_sub_customer_1',
    title: '建立第一個客戶',
    parent_task_id: 'task_parent_1',
    module_id: 'sales'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Resolves to customerCreateBasicProfileAgentProfile
  assert.ok(resolvedProfile, 'AgentProfile must be resolved');
  assert.equal(resolvedProfile.id, 'customer.create_basic_profile');
  assert.equal(resolvedProfile.domain, 'customer');
  assert.ok(
    resolvedProfile.tools.some(t => t.function.name === 'create_partner'),
    'Profile must include create_partner tool'
  );
  assert.ok(
    resolvedProfile.tools.some(t => t.function.name === 'list_partners'),
    'Profile must include list_partners tool'
  );
});

test('TC-ONB-N-03: Normal case - End-to-end customer creation in 建立第一個客戶 subtask context', async () => {
  // Given: Preconditions - An active task for '建立第一個客戶'
  const task = {
    id: `task_sub_cust_${Date.now()}`,
    title: '建立第一個客戶',
    status: 'pending'
  };
  const profile = getAgentProfileForTask(task);
  assert.ok(profile);

  const uniqueCustomerName = `首位客戶_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const taxId = '88889999';

  // When:  Operation to execute - Run agent turn to create customer with confirmation
  const turnResult = await runAgentTurn(
    `幫我新增客戶 ${uniqueCustomerName} 統編 ${taxId}`,
    profile,
    { taskId: task.id, activeTask: task }
  );

  // Then:  Expected result - Confirmation card is generated
  assert.ok(turnResult.confirmation, 'Should produce a pending confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_partner');
  assert.equal(turnResult.confirmation.args.name, uniqueCustomerName);
  assert.equal(turnResult.confirmation.args.tax_id, taxId);

  // When:  Execute confirmation
  const confirmResult = await executeConfirmation(turnResult.confirmation, {
    taskId: task.id,
    activeTask: task
  });

  // Then:  Verification - Customer created successfully
  assert.ok(confirmResult.content.includes(uniqueCustomerName));
  assert.ok(confirmResult.content.includes(taxId));
  assert.ok(confirmResult.toast.includes(uniqueCustomerName));

  const partners = await fetchPartners();
  const created = partners.find(p => p.name === uniqueCustomerName);
  assert.ok(created, 'Created customer must be in partners list');
  assert.equal(created.is_customer, true);
});

test('TC-ONB-B-01: Equivalence class - English and special characters in tenant name', async () => {
  // Given: Preconditions - Reset appState
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const specialTenantName = 'Acme-Corp 123_Special';

  // When:  Operation to execute - Seed onboarding with special characters
  await seedOnboardingTasks(specialTenantName);

  // Then:  Expected result - Special tenant name is properly embedded in main welcome and subtasks
  const mainMsgs = appState.taskMessages['main'] || [];
  assert.ok(mainMsgs.length > 0);
  assert.equal(
    mainMsgs[mainMsgs.length - 1].content,
    `歡迎建立「${specialTenantName}」！要開始使用，我可以先幫你新增部門或邀請團隊成員，需要嗎？`
  );

  const customerSubTasks = appState.tasks.filter(t => t.title === '建立第一個客戶');
  assert.ok(customerSubTasks.length > 0);
  const customerMsgs = appState.taskMessages[customerSubTasks[customerSubTasks.length - 1].id] || [];
  assert.ok(
    customerMsgs[0].content.includes(`新租戶「${specialTenantName}」建立完成後，讓我們來建立第一筆客戶基本資料`)
  );
});

test('TC-ONB-B-02: Boundary value - Empty string tenant name handled safely', async () => {
  // Given: Preconditions - Reset appState
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const emptyTenantName = '';

  // When:  Operation to execute - Seed onboarding with empty string
  await seedOnboardingTasks(emptyTenantName);

  // Then:  Expected result - Should execute safely without throwing exceptions
  const mainMsgs = appState.taskMessages['main'] || [];
  assert.ok(mainMsgs.length > 0);
  assert.equal(
    mainMsgs[mainMsgs.length - 1].content,
    '歡迎建立「」！要開始使用，我可以先幫你新增部門或邀請團隊成員，需要嗎？'
  );

  const customerSubTasks = appState.tasks.filter(t => t.title === '建立第一個客戶');
  assert.ok(customerSubTasks.length > 0);
});

test('TC-ONB-B-03: Boundary value - Whitespace string tenant name handled safely', async () => {
  // Given: Preconditions - Reset appState
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const whitespaceTenantName = '   ';

  // When:  Operation to execute - Seed onboarding with whitespace string
  await seedOnboardingTasks(whitespaceTenantName);

  // Then:  Expected result - Should execute safely without throwing exceptions
  const customerSubTasks = appState.tasks.filter(t => t.title === '建立第一個客戶');
  assert.ok(customerSubTasks.length > 0);
  const customerMsgs = appState.taskMessages[customerSubTasks[customerSubTasks.length - 1].id] || [];
  assert.ok(customerMsgs.length > 0);
});

test('TC-ONB-E-01: Error case - Failure during onboarding seeding is caught gracefully with warning logged', async () => {
  // Given: Preconditions - Intercept console.warn to verify error logging
  let warnCalled = false;
  let capturedWarnMessage = '';
  let capturedError = null;
  const originalWarn = console.warn;
  console.warn = (message, err) => {
    warnCalled = true;
    capturedWarnMessage = String(message);
    capturedError = err;
  };

  // Fault Injection: Inject object that throws during string interpolation inside seedOnboardingTasks
  const faultyTenant = {
    toString() {
      throw new Error('Database serialization error during onboarding seed');
    }
  };

  // When:  Operation to execute - Call seedOnboardingTasks with fault-injected tenant
  try {
    await assert.doesNotReject(async () => {
      await seedOnboardingTasks(faultyTenant);
    }, 'seedOnboardingTasks should not throw unhandled rejection when an internal error occurs');
  } finally {
    console.warn = originalWarn;
  }

  // Then:  Expected result - Verify error was caught internally and warning was logged
  assert.equal(warnCalled, true, 'console.warn must be called when seedOnboardingTasks encounters an error');
  assert.ok(
    capturedWarnMessage.includes('Failed to create onboarding tasks on tenant creation:'),
    'Warning log should indicate failure to create onboarding tasks'
  );
  assert.equal(
    capturedError?.message,
    'Database serialization error during onboarding seed',
    'Captured error message should match the injected failure'
  );
});
