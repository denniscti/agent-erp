/**
 * @file onboarding-greeting.test.js
 * @description Test suite for Tenant Onboarding Tasks & Initial Greetings (Issue #118, Issue #120, Issue #133).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-ONB-N-01 | tenantName = '台積電研發中心' | Equivalence – Normal tenant onboarding seed | Creates '新租戶起步' parent task and '設定部門', '建立第一個客戶', '建立第一個供應商' subtasks with respective skillId, guidance messages and main welcome greeting | Main flow |
 * | TC-ONB-N-02 | Call getAgentProfileForTask on '建立第一個客戶' task with skillId | Equivalence – Workflow AgentProfile resolution via skillId | Resolves to customer.create_basic_profile AgentProfile with customer domain & tools | Skill binding |
 * | TC-ONB-N-03 | Customer subtask execution with runAgentTurn & confirmation | Equivalence – End-to-end customer creation in onboarding task | Triggers create_partner confirmation card, confirmation creates partner and updates store | Workflow loop |
 * | TC-ONB-N-04 | Call getAgentProfileForTask on '建立第一個供應商' task with skillId | Equivalence – Workflow AgentProfile resolution via skillId | Resolves to vendor.create_basic_profile AgentProfile with vendor domain & tools | Vendor skill binding |
 * | TC-ONB-N-05 | Vendor subtask execution with runAgentTurn & confirmation | Equivalence – End-to-end vendor creation in onboarding task | Triggers create_vendor confirmation card, confirmation creates partner (is_vendor: true) and updates store | Vendor workflow loop |
 * | TC-SKILL-N-01 | task.skillId = 'customer.create_basic_profile', non-keyword title | Equivalence – skillId resolution without relying on title | Resolves to customerCreateBasicProfileAgentProfile | Skill decoupling |
 * | TC-SKILL-N-02 | task.skillId = 'department.manage', non-keyword title | Equivalence – skillId resolution for department | Resolves to departmentAgentProfile | Skill decoupling |
 * | TC-SKILL-N-03 | task.skillId = 'vendor.create_basic_profile', non-keyword title | Equivalence – skillId resolution for vendor | Resolves to vendorCreateBasicProfileAgentProfile | Skill decoupling |
 * | TC-SKILL-N-04 | task.skill_id = 'customer.create_basic_profile' (snake_case) | Equivalence – snake_case skill_id resolution | Resolves to customerCreateBasicProfileAgentProfile | DB/Rust compatibility |
 * | TC-SKILL-N-05 | task.skillId = 'customer.create_basic_profile', title = '設定部門' | Equivalence – Priority: skillId precedes title matching | Resolves to customerCreateBasicProfileAgentProfile | Precedence check |
 * | TC-SKILL-N-06 | Custom registered profile with custom skillId | Equivalence – Custom skill registration and resolution | Resolves to custom profile | Extensibility |
 * | TC-SKILL-FB-01 | task without skillId, title = '設定部門' | Boundary – Fallback to title matching (department) | Resolves to departmentAgentProfile | Backward compatibility |
 * | TC-SKILL-FB-02 | task without skillId, title = '建立第一個供應商' | Boundary – Fallback to title matching (vendor) | Resolves to vendorCreateBasicProfileAgentProfile | Backward compatibility |
 * | TC-SKILL-FB-03 | task without skillId, title = '新增客戶基本資料' | Boundary – Fallback to title matching (customer) | Resolves to customerCreateBasicProfileAgentProfile | Backward compatibility |
 * | TC-SKILL-B-01 | task is null or undefined | Boundary – Null task input | Returns null | Null safety |
 * | TC-SKILL-B-02 | task with empty/whitespace skillId and non-matching title | Boundary – Empty/whitespace skillId | Returns null | Whitespace normalization |
 * | TC-SKILL-B-03 | task with unknown skillId and non-matching title | Boundary – Unknown skillId | Returns null | Unrecognized skill |
 * | TC-SKILL-B-04 | task with unknown skillId but matching fallback title | Boundary – Unknown skillId fallbacks to title match | Resolves to matching profile via fallback | Fallback resilience |
 * | TC-ONB-STEPS-01 | Inspect ONBOARDING_STEPS export array | Equivalence – Declarative onboarding steps configuration | Contains 3 steps with title, skillId, moduleId, assignee, and guidanceMessage function | Declarative schema |
 * | TC-ONB-ACT-01 | createTaskAction with skillId parameter | Equivalence – createTaskAction stores skill_id | Task object contains skill_id and skillId | Action parameter |
 * | TC-ONB-ACT-02 | createTaskAction without skillId parameter | Boundary – createTaskAction with default null skillId | Task object contains skill_id == null | Default parameter |
 * | TC-ONB-B-01 | tenantName = 'Acme-Corp 123_Special' | Equivalence – English and special characters in tenant name | Special tenant name is safely embedded in all subtasks (dept, customer, vendor) and main welcome | Encoding safety |
 * | TC-ONB-B-02 | tenantName = '' (empty string) | Boundary – Empty tenant name | Executed safely without throwing unhandled exceptions, all 3 subtasks created | Empty boundary |
 * | TC-ONB-B-03 | tenantName = '   ' (whitespace string) | Boundary – Whitespace tenant name | Executed safely without throwing unhandled exceptions, all 3 subtasks created | Whitespace boundary |
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
  ONBOARDING_STEPS,
  createTaskAction,
  fetchPartners,
  fetchVendors
} = await import('../src/lib/store.svelte.js');

const {
  getAgentProfileForTask,
  registerAgentProfile,
  departmentAgentProfile,
  customerCreateBasicProfileAgentProfile,
  vendorCreateBasicProfileAgentProfile,
  runAgentTurn,
  executeConfirmation
} = await import('../src/lib/workflow/index.js');

test('TC-ONB-N-01: Normal case - seedOnboardingTasks creates parent and department, customer, vendor subtasks with skillIds', async () => {
  // Given: Preconditions - Reset appState and mock store data
  appState.tasks = [];
  appState.taskMessages = {};
  appState.chatMessages = [];
  const tenantName = '台積電研發中心';

  // When:  Operation to execute - Call seedOnboardingTasks with valid tenant name
  await seedOnboardingTasks(tenantName);

  // Then:  Expected result - Parent task and all three subtasks are created with corresponding skillIds
  const parentTasks = appState.tasks.filter(t => t.title === '新租戶起步');
  assert.ok(parentTasks.length > 0, 'Parent task 新租戶起步 should be created');
  const parentTask = parentTasks[parentTasks.length - 1];

  // 1. Verify '設定部門' subtask
  const deptSubTasks = appState.tasks.filter(t => t.title === '設定部門' && t.parent_task_id === parentTask.id);
  assert.ok(deptSubTasks.length > 0, 'Subtask 設定部門 should be created under parent task');
  const deptSubTask = deptSubTasks[deptSubTasks.length - 1];
  assert.equal(deptSubTask.skill_id, 'department.manage', 'Department subtask must have skill_id set');
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
  assert.equal(customerSubTask.skill_id, 'customer.create_basic_profile', 'Customer subtask must have skill_id set');
  const customerMsgs = appState.taskMessages[customerSubTask.id] || [];
  assert.ok(customerMsgs.length > 0, 'Customer subtask should have initial guidance message');
  assert.ok(
    customerMsgs[0].content.includes(`新租戶「${tenantName}」建立完成後，讓我們來建立第一筆客戶基本資料`),
    'Customer subtask message should contain customer setup guidance'
  );

  // 3. Verify '建立第一個供應商' subtask (Issue #120)
  const vendorSubTasks = appState.tasks.filter(t => t.title === '建立第一個供應商' && t.parent_task_id === parentTask.id);
  assert.ok(vendorSubTasks.length > 0, 'Subtask 建立第一個供應商 should be created under parent task');
  const vendorSubTask = vendorSubTasks[vendorSubTasks.length - 1];
  assert.equal(vendorSubTask.skill_id, 'vendor.create_basic_profile', 'Vendor subtask must have skill_id set');
  const vendorMsgs = appState.taskMessages[vendorSubTask.id] || [];
  assert.ok(vendorMsgs.length > 0, 'Vendor subtask should have initial guidance message');
  assert.ok(
    vendorMsgs[0].content.includes(`新租戶「${tenantName}」建立完成後，讓我們來建立第一筆供應商基本資料`),
    'Vendor subtask message should contain vendor setup guidance'
  );
  assert.ok(
    vendorMsgs[0].content.includes('例如：「我想新增欣興電子 統編 11223344」'),
    'Vendor subtask message should include example guidance text'
  );

  // 4. Verify main ambient welcome message
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
  // Given: Preconditions - An onboarding subtask with skillId 'customer.create_basic_profile'
  const task = {
    id: 'task_sub_customer_1',
    title: '建立第一個客戶',
    skillId: 'customer.create_basic_profile',
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

test('TC-ONB-N-04: Normal case - getAgentProfileForTask resolves vendorCreateBasicProfileAgentProfile for 建立第一個供應商', () => {
  // Given: Preconditions - An onboarding subtask with skillId 'vendor.create_basic_profile'
  const task = {
    id: 'task_sub_vendor_1',
    title: '建立第一個供應商',
    skillId: 'vendor.create_basic_profile',
    parent_task_id: 'task_parent_1',
    module_id: 'sales'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Resolves to vendorCreateBasicProfileAgentProfile
  assert.ok(resolvedProfile, 'AgentProfile must be resolved');
  assert.equal(resolvedProfile.id, 'vendor.create_basic_profile');
  assert.equal(resolvedProfile.domain, 'vendor');
  assert.ok(
    resolvedProfile.tools.some(t => t.function.name === 'create_vendor'),
    'Profile must include create_vendor tool'
  );
  assert.ok(
    resolvedProfile.tools.some(t => t.function.name === 'list_vendors'),
    'Profile must include list_vendors tool'
  );
});

test('TC-ONB-N-05: Normal case - End-to-end vendor creation in 建立第一個供應商 subtask context', async () => {
  // Given: Preconditions - An active task for '建立第一個供應商'
  const task = {
    id: `task_sub_vnd_${Date.now()}`,
    title: '建立第一個供應商',
    skillId: 'vendor.create_basic_profile',
    status: 'pending'
  };
  const profile = getAgentProfileForTask(task);
  assert.ok(profile, 'Profile for 建立第一個供應商 must exist');

  const uniqueVendorName = `首位供應商_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const taxId = '11223344';

  // When:  Operation to execute - Run agent turn to create vendor with natural language
  const turnResult = await runAgentTurn(
    `幫我新增供應商 ${uniqueVendorName} 統編 ${taxId}`,
    profile,
    { taskId: task.id, activeTask: task }
  );

  // Then:  Expected result - Confirmation card is generated for create_vendor
  assert.ok(turnResult.confirmation, 'Should produce a pending confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_vendor');
  assert.equal(turnResult.confirmation.args.name, uniqueVendorName);
  assert.equal(turnResult.confirmation.args.tax_id, taxId);

  // When:  Execute confirmation
  const confirmResult = await executeConfirmation(turnResult.confirmation, {
    taskId: task.id,
    activeTask: task
  });

  // Then:  Verification - Vendor created successfully
  assert.ok(confirmResult.content.includes(uniqueVendorName), 'Confirmation content must include vendor name');
  assert.ok(confirmResult.content.includes(taxId), 'Confirmation content must include tax ID');
  assert.ok(confirmResult.toast.includes(uniqueVendorName), 'Toast must include vendor name');

  const vendors = await fetchVendors();
  const created = vendors.find(v => v.name === uniqueVendorName);
  assert.ok(created, 'Created vendor must be in vendors list');
  assert.equal(created.is_vendor, true, 'is_vendor flag must be true');
});

// ==========================================
// Issue #133: skillId Binding & Fallback Tests
// ==========================================

test('TC-SKILL-N-01: Normal case - skillId resolves customer profile with non-keyword title', () => {
  // Given: Preconditions - A task with customer skillId but modified non-keyword title
  const task = {
    id: 'task_custom_title_1',
    title: '錄入主要合作夥伴檔案',
    skillId: 'customer.create_basic_profile'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Directly resolves to customerCreateBasicProfileAgentProfile without keyword title matching
  assert.equal(resolvedProfile, customerCreateBasicProfileAgentProfile);
  assert.equal(resolvedProfile.id, 'customer.create_basic_profile');
});

test('TC-SKILL-N-02: Normal case - skillId resolves department profile with non-keyword title', () => {
  // Given: Preconditions - A task with department.manage skillId
  const task = {
    id: 'task_dept_custom_1',
    title: '維護企業事業群組織結構',
    skillId: 'department.manage'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Directly resolves to departmentAgentProfile
  assert.equal(resolvedProfile, departmentAgentProfile);
  assert.equal(resolvedProfile.id, 'department.manage');
});

test('TC-SKILL-N-03: Normal case - skillId resolves vendor profile with non-keyword title', () => {
  // Given: Preconditions - A task with vendor skillId
  const task = {
    id: 'task_vnd_custom_1',
    title: '登記物料供應方基本資料',
    skillId: 'vendor.create_basic_profile'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Directly resolves to vendorCreateBasicProfileAgentProfile
  assert.equal(resolvedProfile, vendorCreateBasicProfileAgentProfile);
  assert.equal(resolvedProfile.id, 'vendor.create_basic_profile');
});

test('TC-SKILL-N-04: Normal case - snake_case skill_id resolves AgentProfile', () => {
  // Given: Preconditions - A task from SQLite/Rust backend with snake_case skill_id
  const task = {
    id: 'task_snake_1',
    title: '任意標題',
    skill_id: 'customer.create_basic_profile'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Correctly resolves using snake_case skill_id
  assert.equal(resolvedProfile, customerCreateBasicProfileAgentProfile);
});

test('TC-SKILL-N-05: Normal case - skillId has precedence over title keyword matching', () => {
  // Given: Preconditions - Task title mentions '設定部門' but skillId is 'customer.create_basic_profile'
  const task = {
    id: 'task_conflict_1',
    title: '設定部門相關的新客戶資料',
    skillId: 'customer.create_basic_profile'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - skillId takes precedence and resolves customer profile
  assert.equal(resolvedProfile, customerCreateBasicProfileAgentProfile);
});

test('TC-SKILL-N-06: Normal case - Custom declared skillId registered in workflow registry', () => {
  // Given: Preconditions - A custom AgentProfile registered with custom skillId
  const customProfile = {
    id: 'crm.lead_nurture',
    domain: 'customer',
    systemPrompt: '潛在商機跟進助理',
    tools: [],
    toolHandlers: []
  };
  registerAgentProfile('crm.lead_nurture', customProfile);

  const task = {
    id: 'task_crm_1',
    title: '跟進潛在客戶名單',
    skillId: 'crm.lead_nurture'
  };

  // When:  Operation to execute - Resolve AgentProfile for task
  const resolvedProfile = getAgentProfileForTask(task);

  // Then:  Expected result - Resolves custom profile seamlessly
  assert.equal(resolvedProfile, customProfile);
});

test('TC-SKILL-FB-01 to FB-03: Boundary - Fallback to title matching when skillId is absent', () => {
  // Given: Preconditions - Legacy tasks without skillId
  const deptTask = { id: 't_legacy_1', title: '設定部門' };
  const vendorTask = { id: 't_legacy_2', title: '建立第一個供應商' };
  const customerTask = { id: 't_legacy_3', title: '新增客戶基本資料' };

  // When:  Operation to execute - Resolve profiles
  const deptResolved = getAgentProfileForTask(deptTask);
  const vendorResolved = getAgentProfileForTask(vendorTask);
  const customerResolved = getAgentProfileForTask(customerTask);

  // Then:  Expected result - All legacy tasks successfully resolve via fallback
  assert.equal(deptResolved, departmentAgentProfile);
  assert.equal(vendorResolved, vendorCreateBasicProfileAgentProfile);
  assert.equal(customerResolved, customerCreateBasicProfileAgentProfile);
});

test('TC-SKILL-B-01 to B-04: Boundary values - Null, whitespace, and unknown skillIds', () => {
  // Given: Preconditions - Various boundary inputs
  // When & Then:
  // B-01: Null or undefined task
  assert.equal(getAgentProfileForTask(null), null);
  assert.equal(getAgentProfileForTask(undefined), null);

  // B-02: Whitespace skillId with non-matching title
  assert.equal(getAgentProfileForTask({ skillId: '   ', title: '日常例行會議' }), null);

  // B-03: Unknown skillId with non-matching title
  assert.equal(getAgentProfileForTask({ skillId: 'nonexistent.skill', title: '日常例行會議' }), null);

  // B-04: Unknown skillId with title matching department keyword fallbacks to title match
  assert.equal(
    getAgentProfileForTask({ skillId: 'nonexistent.skill', title: '設定部門' }),
    departmentAgentProfile
  );
});

test('TC-ONB-STEPS-01: Declarative ONBOARDING_STEPS schema and guidance generation', () => {
  // Given: Preconditions - ONBOARDING_STEPS exported array
  assert.ok(Array.isArray(ONBOARDING_STEPS), 'ONBOARDING_STEPS must be an array');
  assert.equal(ONBOARDING_STEPS.length, 3, 'Must define exactly 3 initial onboarding steps');

  // When & Then: Check step definitions
  const [step1, step2, step3] = ONBOARDING_STEPS;

  assert.equal(step1.title, '設定部門');
  assert.equal(step1.skillId, 'department.manage');
  assert.equal(step1.moduleId, 'sales');
  assert.equal(typeof step1.guidanceMessage, 'function');
  assert.ok(step1.guidanceMessage('測試租戶').includes('測試租戶'));

  assert.equal(step2.title, '建立第一個客戶');
  assert.equal(step2.skillId, 'customer.create_basic_profile');
  assert.equal(step2.moduleId, 'sales');
  assert.equal(typeof step2.guidanceMessage, 'function');
  assert.ok(step2.guidanceMessage('測試租戶').includes('測試租戶'));

  assert.equal(step3.title, '建立第一個供應商');
  assert.equal(step3.skillId, 'vendor.create_basic_profile');
  assert.equal(step3.moduleId, 'sales');
  assert.equal(typeof step3.guidanceMessage, 'function');
  assert.ok(step3.guidanceMessage('測試租戶').includes('測試租戶'));
});

test('TC-ONB-ACT-01 & ACT-02: createTaskAction with and without skillId parameter', async () => {
  // Given: Preconditions - Reset appState
  appState.tasks = [];

  // When:  ACT-01 - Create task with skillId
  const taskWithSkill = await createTaskAction('建立自訂客戶', 'sales', '主管', null, 'customer.create_basic_profile');

  // Then:  skill_id is stored
  assert.equal(taskWithSkill.skill_id, 'customer.create_basic_profile');
  assert.equal(taskWithSkill.skillId, 'customer.create_basic_profile');

  // When:  ACT-02 - Create task without skillId
  const taskWithoutSkill = await createTaskAction('一般代辦事項', 'sales', '主管', null);

  // Then:  skill_id is null
  assert.equal(taskWithoutSkill.skill_id, null);
  assert.equal(taskWithoutSkill.skillId, null);
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

  const vendorSubTasks = appState.tasks.filter(t => t.title === '建立第一個供應商');
  assert.ok(vendorSubTasks.length > 0);
  const vendorMsgs = appState.taskMessages[vendorSubTasks[vendorSubTasks.length - 1].id] || [];
  assert.ok(
    vendorMsgs[0].content.includes(`新租戶「${specialTenantName}」建立完成後，讓我們來建立第一筆供應商基本資料`)
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

  const deptSubTasks = appState.tasks.filter(t => t.title === '設定部門');
  assert.ok(deptSubTasks.length > 0, 'Department subtask created');
  const customerSubTasks = appState.tasks.filter(t => t.title === '建立第一個客戶');
  assert.ok(customerSubTasks.length > 0, 'Customer subtask created');
  const vendorSubTasks = appState.tasks.filter(t => t.title === '建立第一個供應商');
  assert.ok(vendorSubTasks.length > 0, 'Vendor subtask created');
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
  const deptSubTasks = appState.tasks.filter(t => t.title === '設定部門');
  assert.ok(deptSubTasks.length > 0, 'Department subtask created');
  const customerSubTasks = appState.tasks.filter(t => t.title === '建立第一個客戶');
  assert.ok(customerSubTasks.length > 0, 'Customer subtask created');
  const vendorSubTasks = appState.tasks.filter(t => t.title === '建立第一個供應商');
  assert.ok(vendorSubTasks.length > 0, 'Vendor subtask created');
  const vendorMsgs = appState.taskMessages[vendorSubTasks[vendorSubTasks.length - 1].id] || [];
  assert.ok(vendorMsgs.length > 0);
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
