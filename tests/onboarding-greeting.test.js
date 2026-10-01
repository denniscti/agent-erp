import test from 'node:test';
import assert from 'node:assert/strict';

// Shim Svelte 5 $state for Node.js test environment before importing store
globalThis['$state'] = (v) => v;

const {
  appState,
  seedOnboardingTasks,
  appendTaskMessageAction,
  createTaskAction,
  fetchTasks
} = await import('../src/lib/store.svelte.js');

test('TC-ONBOARD-01: Normal case - seedOnboardingTasks creates onboarding tasks and seeds main welcome greeting', async () => {
  // Given: Preconditions - Reset appState and mock store data
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const tenantName = '台積電研發中心';

  // When:  Operation to execute - Call seedOnboardingTasks with valid tenant name
  await seedOnboardingTasks(tenantName);

  // Then:  Expected result - Tasks are created and both subtask & main messages are seeded
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

  // Verify child task message
  const subTasks = appState.tasks.filter(t => t.title === '設定部門');
  const createdSubTask = subTasks[subTasks.length - 1];
  assert.ok(createdSubTask, 'Subtask 設定部門 should be created');
  const subTaskMsgs = appState.taskMessages[createdSubTask.id] || [];
  assert.ok(subTaskMsgs.length > 0, 'Subtask conversation should have initial guidance message');
  assert.ok(
    subTaskMsgs[0].content.includes(`新租戶「${tenantName}」建立完成後，首要步驟是建立組織部門`),
    'Subtask message should contain department setup guidance'
  );
});

test('TC-ONBOARD-02: Equivalence class - English and special characters in tenant name', async () => {
  // Given: Preconditions - Reset appState
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const specialTenantName = 'Acme-Corp 123_Special';

  // When:  Operation to execute - Seed onboarding with special characters
  await seedOnboardingTasks(specialTenantName);

  // Then:  Expected result - Special tenant name is properly embedded in main welcome message
  const mainMsgs = appState.taskMessages['main'] || [];
  assert.ok(mainMsgs.length > 0);
  const mainGreeting = mainMsgs[mainMsgs.length - 1];
  assert.equal(
    mainGreeting.content,
    `歡迎建立「${specialTenantName}」！要開始使用，我可以先幫你新增部門或邀請團隊成員，需要嗎？`
  );
});

test('TC-ONBOARD-03: Boundary value - Empty string tenant name handled safely', async () => {
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
});

test('TC-ONBOARD-04: Error case - Failure during onboarding seeding is caught gracefully with warning logged', async () => {
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

