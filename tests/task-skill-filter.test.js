/**
 * @file task-skill-filter.test.js
 * @description Comprehensive test suite for Dynamic Task Filtering by User Department Effective Skills (Issue #132).
 * Conforms to docs/standards/authoring/agent-skill-authoring.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-FLT-N-01 | Single skill 'customer.create_basic_profile', 3 onboarding subtasks | Equivalence – Single skill authorization | Only '建立第一個客戶' subtask is visible; '設定部門' & '建立第一個供應商' filtered out | Core verification scenario |
 * | TC-FLT-N-02 | Skills ['customer.create_basic_profile', 'vendor.create_basic_profile'] | Equivalence – Multi-skill authorization | Customer and vendor subtasks visible; department subtask filtered out | Multi-skill filtering |
 * | TC-FLT-N-03 | User across 2 departments (Dept A: department.manage, Dept B: customer.create_basic_profile) | Equivalence – Multi-department union | Department & customer subtasks visible; vendor subtask filtered out | Union semantics (#114, #115) |
 * | TC-FLT-N-04 | All 3 skills granted (department.manage, customer.create_basic_profile, vendor.create_basic_profile) | Equivalence – Full skill authorization | All 3 onboarding subtasks visible | Full authorization |
 * | TC-FLT-N-05 | Tasks without skillId (parent task '新租戶起步' or general tasks) | Equivalence – Unrestricted tasks | Preserved regardless of user's effective skill set | Task compatibility |
 * | TC-FLT-N-06 | Tasks using snake_case `skill_id` vs camelCase `skillId` | Equivalence – Field name compatibility | Both formats parsed and filtered without relying on title matching | Robust field mapping |
 * | TC-FLT-B-01 | User effective skills is empty [] (0 skills) | Boundary – 0 / Empty skill set | All subtasks requiring skill are filtered; tasks without skillId preserved | Zero-permission boundary |
 * | TC-FLT-B-02 | tasks array is empty [] | Boundary – Empty tasks input | Returns empty array [] | Empty input boundary |
 * | TC-FLT-B-03 | tasks is null / undefined / non-array | Boundary – NULL / Invalid tasks input | Returns empty array [] without unhandled exception | Defensive boundary |
 * | TC-FLT-B-04 | effectiveSkills is null / undefined | Boundary – NULL effectiveSkills | Treated as empty set; filters tasks requiring skill | Defensive boundary |
 * | TC-FLT-B-05 | effectiveSkills provided as Set instance | Boundary – Set type compatibility | Correctly filters and matches tasks | Type flexibility |
 * | TC-FLT-B-06 | task.skillId or effectiveSkills with leading/trailing whitespaces | Boundary – Whitespace normalization | Cleanly trimmed and matched | Sanitization |
 * | TC-FLT-B-07 | tasks array contains invalid elements (null, undefined, non-objects) | Boundary – Corrupted array elements | Safely skips invalid entries and filters valid tasks | Array robustness |
 * | TC-FLT-USR-01 | getCurrentUserEffectiveSkills: authUser matching member across multiple departments | Equivalence – Active member union resolution | Correctly returns deduplicated union of department skills | Member state resolution |
 * | TC-FLT-USR-02 | getCurrentUserEffectiveSkills: authUser is null or member has no departments | Boundary – Unauthenticated / No departments | Returns empty array [] | Unauthenticated boundary |
 * | TC-FLT-USR-03 | getCurrentUserEffectiveSkills: authUser has direct department_ids property | Equivalence – Direct authUser department mapping | Resolves skills via getEffectiveSkills | Direct property resolution |
 * | TC-FLT-USR-04 | getCurrentUserEffectiveSkills: state has explicit currentUserSkills override | Equivalence – Explicit skill override | Returns exact override skills array | Override support |
 * | TC-PANEL-INT-01 | TaskPanel sidebar hierarchy logic with filtered tasks (customer skill only) | Integration – Sidebar rendering hierarchy | Parent card rendered, getChildrenOf returns only customer subtask, pendingCount updated | Component integration |
 * | TC-PANEL-INT-02 | TaskPanel sidebar empty state when all tasks are filtered out | Integration – Sidebar empty state | visibleTasks length is 0, empty-tasks-box triggers | UI empty state |
 * | TC-PANEL-INT-03 | Parent task without skillId preserved while all subtasks filtered out (unmatched skills) | Boundary / Integration – Parent persistence with empty subtasks | visibleTasks.length is 1, parentTasks has parent, getChildrenOf returns [], no false empty state | Boundary coverage (#146) |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Shim Svelte 5 $state for Node.js test environment
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  filterTasksBySkills,
  getCurrentUserEffectiveSkills,
  getEffectiveSkills,
  seedOnboardingTasks,
  createTaskAction,
  apiCall
} = await import('../src/lib/store.svelte.js');

// Helper to build realistic 3-step onboarding tasks for testing
function createMockOnboardingTasks(parentTaskId = 'task-parent-001') {
  return [
    {
      id: parentTaskId,
      title: '新租戶起步',
      module_id: 'sales',
      assignee: '主管',
      parent_task_id: null,
      status: 'in_progress',
      skillId: null,
      skill_id: null
    },
    {
      id: 'subtask-dept-001',
      title: '設定部門',
      module_id: 'sales',
      assignee: '主管',
      parent_task_id: parentTaskId,
      status: 'pending',
      skillId: 'department.manage',
      skill_id: 'department.manage'
    },
    {
      id: 'subtask-cust-002',
      title: '建立第一個客戶',
      module_id: 'sales',
      assignee: '主管',
      parent_task_id: parentTaskId,
      status: 'pending',
      skillId: 'customer.create_basic_profile',
      skill_id: 'customer.create_basic_profile'
    },
    {
      id: 'subtask-vnd-003',
      title: '建立第一個供應商',
      module_id: 'sales',
      assignee: '主管',
      parent_task_id: parentTaskId,
      status: 'pending',
      skillId: 'vendor.create_basic_profile',
      skill_id: 'vendor.create_basic_profile'
    },
    {
      id: 'subtask-prod-004',
      title: '建立第一個商品',
      module_id: 'sales',
      assignee: '主管',
      parent_task_id: parentTaskId,
      status: 'pending',
      skillId: 'product.create_basic_profile',
      skill_id: 'product.create_basic_profile',
      skills: ['product.create_basic_profile', 'product.manage']
    }
  ];
}

test('TC-FLT-N-01: Equivalence - Department granted only customer.create_basic_profile filters to customer subtask only', () => {
  // Given: Preconditions - Onboarding tasks and user having only customer creation skill
  const tasks = createMockOnboardingTasks();
  const userEffectiveSkills = ['customer.create_basic_profile'];

  // When:  Operation to execute - Filter tasks by user effective skills
  const filtered = filterTasksBySkills(tasks, userEffectiveSkills);

  // Then:  Expected result - Parent task and customer subtask are kept; department, vendor and product subtasks are excluded
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'), 'Parent task without skillId must be preserved');
  assert.ok(titles.includes('建立第一個客戶'), 'Customer subtask with granted skillId must be preserved');
  assert.equal(titles.includes('設定部門'), false, 'Department subtask must be filtered out when skill not granted');
  assert.equal(titles.includes('建立第一個供應商'), false, 'Vendor subtask must be filtered out when skill not granted');
  assert.equal(titles.includes('建立第一個商品'), false, 'Product subtask must be filtered out when skill not granted');
  assert.equal(filtered.length, 2, 'Total visible tasks should be 2 (parent + customer)');
});

test('TC-FLT-N-02: Equivalence - User with customer and vendor skills retains both subtasks', () => {
  // Given: Preconditions - User with customer and vendor skills
  const tasks = createMockOnboardingTasks();
  const userEffectiveSkills = ['customer.create_basic_profile', 'vendor.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userEffectiveSkills);

  // Then:  Expected result - Customer and vendor subtasks visible; department and product subtasks filtered out
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'));
  assert.ok(titles.includes('建立第一個客戶'));
  assert.ok(titles.includes('建立第一個供應商'));
  assert.equal(titles.includes('設定部門'), false);
  assert.equal(titles.includes('建立第一個商品'), false);
  assert.equal(filtered.length, 3);
});

test('TC-FLT-N-03: Equivalence - Cross-department union of skills preserves respective subtasks', () => {
  // Given: Preconditions - Department A has department.manage, Department B has customer.create_basic_profile
  const mockDepartments = [
    { id: 'dept-sales', name: '業務部', skills: ['customer.create_basic_profile'] },
    { id: 'dept-admin', name: '管理部', skills: ['department.manage'] },
    { id: 'dept-procure', name: '採購部', skills: ['vendor.create_basic_profile'] }
  ];
  // User belongs to dept-sales and dept-admin
  const userDeptIds = ['dept-sales', 'dept-admin'];
  const effectiveSkills = getEffectiveSkills(userDeptIds, mockDepartments);
  assert.deepEqual(effectiveSkills.sort(), ['customer.create_basic_profile', 'department.manage'].sort());

  const tasks = createMockOnboardingTasks();

  // When:  Operation to execute - Filter tasks with cross-department union
  const filtered = filterTasksBySkills(tasks, effectiveSkills);

  // Then:  Expected result - Parent task, department subtask and customer subtask visible; vendor and product subtasks filtered
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'));
  assert.ok(titles.includes('設定部門'));
  assert.ok(titles.includes('建立第一個客戶'));
  assert.equal(titles.includes('建立第一個供應商'), false);
  assert.equal(titles.includes('建立第一個商品'), false);
  assert.equal(filtered.length, 3);
});

test('TC-FLT-N-04: Equivalence - Full skill authorization preserves all onboarding subtasks', () => {
  // Given: Preconditions - User granted all 4 system skills
  const tasks = createMockOnboardingTasks();
  const allSkills = ['department.manage', 'customer.create_basic_profile', 'vendor.create_basic_profile', 'product.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, allSkills);

  // Then:  Expected result - All 5 tasks (parent + 4 subtasks) are retained
  assert.equal(filtered.length, 5);
  const subtasks = filtered.filter(t => t.parent_task_id !== null);
  assert.equal(subtasks.length, 4);
});

test('TC-FLT-N-05: Equivalence - General tasks without skillId are always preserved', () => {
  // Given: Preconditions - Tasks without skillId or with empty skillId
  const tasks = [
    { id: 't-1', title: '日常待辦事項', skillId: null },
    { id: 't-2', title: '全體公告確認', skill_id: undefined },
    { id: 't-3', title: '未設定技能任務', skillId: '' },
    { id: 't-4', title: '限制技能任務', skillId: 'finance.audit' }
  ];
  const userSkills = ['customer.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userSkills);

  // Then:  Expected result - t-1, t-2, t-3 are preserved; t-4 is filtered
  assert.equal(filtered.length, 3);
  assert.deepEqual(filtered.map(t => t.id), ['t-1', 't-2', 't-3']);
});

test('TC-FLT-N-06: Equivalence - Field compatibility with snake_case skill_id and camelCase skillId', () => {
  // Given: Preconditions - Tasks using snake_case skill_id or camelCase skillId
  const tasks = [
    { id: 't-snake', title: '自訂標題 A', skill_id: 'customer.create_basic_profile' },
    { id: 't-camel', title: '自訂標題 B', skillId: 'vendor.create_basic_profile' },
    { id: 't-other', title: '自訂標題 C', skill_id: 'unauthorized.skill' }
  ];
  const userSkills = ['customer.create_basic_profile', 'vendor.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userSkills);

  // Then:  Expected result - t-snake and t-camel matched and preserved based on skillId, not title
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(t => t.id), ['t-snake', 't-camel']);
});

test('TC-FLT-B-01: Boundary - Empty effective skills array [] filters all tasks requiring skills', () => {
  // Given: Preconditions - User with 0 granted skills
  const tasks = createMockOnboardingTasks();

  // When:  Operation to execute - Filter tasks with empty skills []
  const filtered = filterTasksBySkills(tasks, []);

  // Then:  Expected result - All 3 subtasks filtered out; only parent task without skillId remains
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, '新租戶起步');
});

test('TC-FLT-B-02: Boundary - Empty tasks array returns empty array []', () => {
  // Given: Preconditions - Empty tasks list
  // When:  Operation to execute - Filter empty list
  const filtered = filterTasksBySkills([], ['customer.create_basic_profile']);

  // Then:  Expected result - Returns []
  assert.deepEqual(filtered, []);
});

test('TC-FLT-B-03: Boundary - NULL / undefined / non-array tasks returns []', () => {
  // Given: Preconditions - Null or invalid tasks inputs
  // When & Then: Operation to execute - Filter null/undefined/string/number
  assert.deepEqual(filterTasksBySkills(null, ['customer.create_basic_profile']), []);
  assert.deepEqual(filterTasksBySkills(undefined, ['customer.create_basic_profile']), []);
  assert.deepEqual(filterTasksBySkills('not an array', ['customer.create_basic_profile']), []);
  assert.deepEqual(filterTasksBySkills(12345, ['customer.create_basic_profile']), []);
});

test('TC-FLT-B-04: Boundary - NULL / undefined effectiveSkills behaves as empty set', () => {
  // Given: Preconditions - Null / undefined effectiveSkills
  const tasks = createMockOnboardingTasks();

  // When:  Operation to execute - Filter with null and undefined effectiveSkills
  const filteredNull = filterTasksBySkills(tasks, null);
  const filteredUndef = filterTasksBySkills(tasks, undefined);

  // Then:  Expected result - Subtasks filtered; parent task preserved
  assert.equal(filteredNull.length, 1);
  assert.equal(filteredNull[0].title, '新租戶起步');
  assert.equal(filteredUndef.length, 1);
  assert.equal(filteredUndef[0].title, '新租戶起步');
});

test('TC-FLT-B-05: Boundary - effectiveSkills provided as Set instance', () => {
  // Given: Preconditions - effectiveSkills as Set
  const tasks = createMockOnboardingTasks();
  const skillSet = new Set(['vendor.create_basic_profile']);

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, skillSet);

  // Then:  Expected result - Parent task and vendor subtask kept
  assert.equal(filtered.length, 2);
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'));
  assert.ok(titles.includes('建立第一個供應商'));
});

test('TC-FLT-B-06: Boundary - Whitespace normalization in skillId and effectiveSkills', () => {
  // Given: Preconditions - Skill IDs with whitespace
  const tasks = [
    { id: 't-ws-1', title: '客戶任務', skillId: '  customer.create_basic_profile  ' },
    { id: 't-ws-2', title: '無技能空白', skillId: '   ' }
  ];
  const userSkills = ['  customer.create_basic_profile\n'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userSkills);

  // Then:  Expected result - Both tasks matched and preserved appropriately
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, 't-ws-1');
  assert.equal(filtered[1].id, 't-ws-2');
});

test('TC-FLT-B-07: Boundary - tasks array containing null, undefined, or non-object entries', () => {
  // Given: Preconditions - Corrupted tasks array with non-objects
  const corruptedTasks = [
    null,
    undefined,
    'string_task',
    100,
    { id: 'valid-1', title: '有效任務', skillId: 'customer.create_basic_profile' }
  ];

  // When:  Operation to execute - Filter corrupted tasks array
  const filtered = filterTasksBySkills(corruptedTasks, ['customer.create_basic_profile']);

  // Then:  Expected result - Only valid object is returned
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'valid-1');
});

test('TC-FLT-USR-01: Equivalence - getCurrentUserEffectiveSkills resolves active member union across departments', () => {
  // Given: Preconditions - Mock app state with authUser, members and departments
  const mockState = {
    authUser: { id: 'u_101', email: 'alice@example.com', display_name: 'Alice' },
    members: [
      {
        id: 'u_101',
        user_id: 'u_101',
        email: 'alice@example.com',
        name: 'Alice',
        department_ids: ['d_sales', 'd_hr']
      },
      {
        id: 'u_102',
        user_id: 'u_102',
        email: 'bob@example.com',
        name: 'Bob',
        department_ids: ['d_procure']
      }
    ],
    departments: [
      { id: 'd_sales', name: '業務部', skills: ['customer.create_basic_profile'] },
      { id: 'd_hr', name: '人事部', skills: ['department.manage'] },
      { id: 'd_procure', name: '採購部', skills: ['vendor.create_basic_profile'] }
    ]
  };

  // When:  Operation to execute - Get current user effective skills
  const skills = getCurrentUserEffectiveSkills(mockState);

  // Then:  Expected result - Returns union of d_sales and d_hr skills
  assert.deepEqual(skills.sort(), ['customer.create_basic_profile', 'department.manage'].sort());
});

test('TC-FLT-USR-02: Boundary - getCurrentUserEffectiveSkills returns [] when unauthenticated or no departments', () => {
  // Given: Preconditions - State with null authUser or empty members
  const unauthState = { authUser: null, members: [], departments: [] };
  const noDeptState = {
    authUser: { id: 'u_999', email: 'guest@example.com' },
    members: [{ id: 'u_999', user_id: 'u_999', email: 'guest@example.com', department_ids: [] }],
    departments: [{ id: 'd_1', skills: ['department.manage'] }]
  };

  // When & Then: Operation to execute - Query skills
  assert.deepEqual(getCurrentUserEffectiveSkills(unauthState), []);
  assert.deepEqual(getCurrentUserEffectiveSkills(noDeptState), []);
  assert.deepEqual(getCurrentUserEffectiveSkills(null), []);
});

test('TC-FLT-USR-03: Equivalence - getCurrentUserEffectiveSkills with direct authUser department_ids', () => {
  // Given: Preconditions - authUser directly having department_ids
  const state = {
    authUser: { id: 'u_direct', email: 'direct@example.com', department_ids: ['d_direct'] },
    members: [],
    departments: [{ id: 'd_direct', skills: ['vendor.create_basic_profile'] }]
  };

  // When:  Operation to execute - Query skills
  const skills = getCurrentUserEffectiveSkills(state);

  // Then:  Expected result - Resolves skills from authUser.department_ids
  assert.deepEqual(skills, ['vendor.create_basic_profile']);
});

test('TC-FLT-USR-04: Equivalence - getCurrentUserEffectiveSkills with explicit currentUserSkills override', () => {
  // Given: Preconditions - State with explicit currentUserSkills array or Set
  const stateArray = { currentUserSkills: ['customer.create_basic_profile', 'custom.skill'] };
  const stateSet = { currentUserSkills: new Set(['vendor.create_basic_profile']) };

  // When & Then: Query skills with overrides
  assert.deepEqual(getCurrentUserEffectiveSkills(stateArray), ['customer.create_basic_profile', 'custom.skill']);
  assert.deepEqual(getCurrentUserEffectiveSkills(stateSet), ['vendor.create_basic_profile']);
});

test('TC-PANEL-INT-01: Integration - TaskPanel hierarchy derives only visible subtasks for member with customer skill', () => {
  // Given: Preconditions - Seed realistic onboarding tasks in appState
  appState.tasks = createMockOnboardingTasks('task-parent-active');

  const parentTask = appState.tasks.find(t => t.title === '新租戶起步');
  assert.ok(parentTask, 'Parent task must exist');

  // When: User only has customer creation skill
  const userSkills = ['customer.create_basic_profile'];
  const visibleTasks = filterTasksBySkills(appState.tasks, userSkills);

  // Hierarchy derivation matching TaskPanel.svelte
  const parentTasks = visibleTasks.filter(t => !t.parent_task_id);
  const getChildrenOf = (parentId) => visibleTasks.filter(t => t.parent_task_id === parentId);
  const orphanTasks = visibleTasks.filter(t => t.parent_task_id && !visibleTasks.some(p => p.id === t.parent_task_id));
  const pendingCount = visibleTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;

  // Then: Expected result -
  // 1. Parent card is present in parentTasks
  assert.equal(parentTasks.length, 1);
  assert.equal(parentTasks[0].id, parentTask.id);

  // 2. getChildrenOf under parent returns ONLY '建立第一個客戶'
  const children = getChildrenOf(parentTask.id);
  assert.equal(children.length, 1, 'Only 1 child subtask should be visible');
  assert.equal(children[0].title, '建立第一個客戶');
  assert.equal(children[0].skill_id, 'customer.create_basic_profile');

  // 3. No orphan tasks
  assert.equal(orphanTasks.length, 0);

  // 4. pendingCount equals 2 (parent in_progress + customer subtask pending)
  assert.equal(pendingCount, 2);
});

test('TC-PANEL-INT-02: Integration - TaskPanel empty state when all tasks are filtered out', () => {
  // Given: Preconditions - Tasks all require skills not possessed by the user
  const restrictedTasks = [
    { id: 't-1', title: '財務核准', parent_task_id: null, skillId: 'finance.approve', status: 'pending' },
    { id: 't-2', title: '資產盤點', parent_task_id: null, skillId: 'asset.manage', status: 'pending' }
  ];
  const userSkills = ['customer.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const visibleTasks = filterTasksBySkills(restrictedTasks, userSkills);

  // Then:  Expected result - visibleTasks length is 0 (triggers empty-tasks-box in TaskPanel.svelte)
  assert.equal(visibleTasks.length, 0);
});

test('TC-PANEL-INT-03: Boundary / Integration - Parent task preserved while all subtasks filtered out by unmatched skills (Issue #146)', () => {
  // Given: Preconditions - Onboarding parent task without skillId ('新租戶起步') and 3 subtasks requiring distinct skills
  appState.tasks = createMockOnboardingTasks('task-parent-active');

  const parentTask = appState.tasks.find(t => t.title === '新租戶起步');
  assert.ok(parentTask, 'Parent task must exist in initial task list');

  // User effective skills do not match any onboarding subtask (e.g. admin in depts without onboarding skills)
  const userSkills = ['unrelated.skill'];

  // When:  Operation to execute - Filter tasks and compute TaskPanel hierarchy
  const visibleTasks = filterTasksBySkills(appState.tasks, userSkills);

  const parentTasks = visibleTasks.filter(t => !t.parent_task_id);
  const getChildrenOf = (parentId) => visibleTasks.filter(t => t.parent_task_id === parentId);
  const orphanTasks = visibleTasks.filter(t => t.parent_task_id && !visibleTasks.some(p => p.id === t.parent_task_id));
  const pendingCount = visibleTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const isFalseEmptyStateTriggered = visibleTasks.length === 0;

  // Then:  Expected result -
  // 1. visibleTasks.length is 1 (contains only the parent task)
  assert.equal(visibleTasks.length, 1, 'visibleTasks must contain exactly 1 task');
  assert.equal(visibleTasks[0].id, parentTask.id, 'visibleTasks must be the parent task');

  // 2. parentTasks retains the parent task
  assert.equal(parentTasks.length, 1, 'parentTasks must still contain the parent task');
  assert.equal(parentTasks[0].id, parentTask.id);
  assert.equal(parentTasks[0].title, '新租戶起步');

  // 3. getChildrenOf(parentId) returns an empty array []
  const children = getChildrenOf(parentTask.id);
  assert.ok(Array.isArray(children), 'getChildrenOf must return an array');
  assert.equal(children.length, 0, 'getChildrenOf must return empty array when all subtasks are filtered');
  assert.deepEqual(children, []);

  // 4. No orphan tasks exist
  assert.equal(orphanTasks.length, 0, 'orphanTasks must be empty');

  // 5. Does not mistakenly trigger TaskPanel empty state (empty-tasks-box)
  assert.equal(isFalseEmptyStateTriggered, false, 'Must not falsely trigger empty-tasks-box');

  // 6. pendingCount equals 1 (parent task status is in_progress)
  assert.equal(pendingCount, 1, 'pendingCount must reflect the remaining parent task');

  // Additional boundary verification with empty array [] effective skills
  const visibleTasksEmpty = filterTasksBySkills(appState.tasks, []);
  const parentTasksEmpty = visibleTasksEmpty.filter(t => !t.parent_task_id);
  const childrenEmpty = visibleTasksEmpty.filter(t => t.parent_task_id === parentTask.id);
  assert.equal(visibleTasksEmpty.length, 1);
  assert.equal(parentTasksEmpty.length, 1);
  assert.deepEqual(childrenEmpty, []);
});

test('TC-FLT-N-07: Equivalence - Department granted only product.create_basic_profile filters to product subtask only', () => {
  // Given: Preconditions - User granted only product.create_basic_profile
  const tasks = createMockOnboardingTasks();
  const userEffectiveSkills = ['product.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userEffectiveSkills);

  // Then:  Expected result - Parent task and product subtask preserved; department, customer, vendor filtered out
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'));
  assert.ok(titles.includes('建立第一個商品'), 'Product subtask must be visible when product.create_basic_profile is granted');
  assert.equal(titles.includes('設定部門'), false);
  assert.equal(titles.includes('建立第一個客戶'), false);
  assert.equal(titles.includes('建立第一個供應商'), false);
  assert.equal(filtered.length, 2);
});

test('TC-FLT-N-08: Equivalence - Department granted product.manage preserves product subtask via multi-skill / task.skills support', () => {
  // Given: Preconditions - User granted only product.manage
  const tasks = createMockOnboardingTasks();
  const userEffectiveSkills = ['product.manage'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userEffectiveSkills);

  // Then:  Expected result - Product subtask is visible when product.manage is granted
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'));
  assert.ok(titles.includes('建立第一個商品'), 'Product subtask must be visible when product.manage is granted');
  assert.equal(titles.includes('設定部門'), false);
  assert.equal(titles.includes('建立第一個客戶'), false);
  assert.equal(titles.includes('建立第一個供應商'), false);
  assert.equal(filtered.length, 2);
});

test('TC-FLT-N-09: Equivalence - Department granted customer and product skills preserves both customer and product subtasks', () => {
  // Given: Preconditions - User granted customer and product skills
  const tasks = createMockOnboardingTasks();
  const userEffectiveSkills = ['customer.create_basic_profile', 'product.create_basic_profile'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(tasks, userEffectiveSkills);

  // Then:  Expected result - Customer and product subtasks are visible
  const titles = filtered.map(t => t.title);
  assert.ok(titles.includes('新租戶起步'));
  assert.ok(titles.includes('建立第一個客戶'));
  assert.ok(titles.includes('建立第一個商品'));
  assert.equal(titles.includes('設定部門'), false);
  assert.equal(titles.includes('建立第一個供應商'), false);
  assert.equal(filtered.length, 3);
});

test('TC-FLT-E-01: Error / Boundary - Corrupted task.skills array elements handled safely without crashing', () => {
  // Given: Preconditions - Tasks with corrupted skills array elements (null, undefined, numbers, objects)
  const corruptedTasks = [
    { id: 'corrupt-1', title: '異常商品任務 1', skills: [null, undefined, 'product.create_basic_profile'] },
    { id: 'corrupt-2', title: '異常商品任務 2', skills: [123, { bad: 'obj' }, 'vendor.create_basic_profile'] },
    { id: 'corrupt-3', title: '異常任務 3', skills: 'not-an-array-string' }
  ];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(corruptedTasks, ['product.create_basic_profile']);

  // Then:  Expected result - Corrupted entries safely sanitized and matched without throwing exception
  assert.ok(Array.isArray(filtered));
  assert.equal(filtered.some(t => t.id === 'corrupt-1'), true);
  assert.equal(filtered.some(t => t.id === 'corrupt-2'), false);
});

test('TC-FLT-SEC-01: Security - Task requiring ungranted product domain skill (e.g. product.view_cost) is NOT visible even when user has product.manage', () => {
  // Given: Preconditions - User has only product.manage, and task specifically requires sensitive product.view_cost
  const sensitiveTask = [
    { id: 'task-sec-1', title: '檢視商品進貨成本', skillId: 'product.view_cost' },
    { id: 'task-sec-2', title: '刪除商品資料', skills: ['product.delete'] },
    { id: 'task-sec-3', title: '一般商品維護', skills: ['product.manage'] }
  ];
  const userEffectiveSkills = ['product.manage'];

  // When:  Operation to execute - Filter tasks
  const filtered = filterTasksBySkills(sensitiveTask, userEffectiveSkills);

  // Then:  Expected result - Only task explicitly granting product.manage is visible; ungranted product.* tasks are filtered out
  const ids = filtered.map(t => t.id);
  assert.equal(ids.includes('task-sec-1'), false, 'product.view_cost must not be visible via product.manage');
  assert.equal(ids.includes('task-sec-2'), false, 'product.delete must not be visible via product.manage');
  assert.equal(ids.includes('task-sec-3'), true, 'product.manage task must be visible');
  assert.equal(filtered.length, 1);
});

