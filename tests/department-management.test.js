/**
 * @file department-management.test.js
 * @description Test suite for Department Management (Issue #113).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-DEPT-N-01 | Name: '研發部', parentId: null | Equivalence – Normal top-level department | Created successfully, parent_id is null, listed in store | Happy path |
 * | TC-DEPT-N-02 | Name: '前端組', parentId: 'dept_dev_1' | Equivalence – Normal sub-department | Created successfully, parent_id equals parent ID | Hierarchy path |
 * | TC-DEPT-N-03 | Call fetchDepartments() | Equivalence – List all departments | Returns full list of departments and updates appState.departments | Store sync |
 * | TC-DEPT-N-04 | Department with parent_id resolved | Equivalence – Hierarchy resolution | Correctly maps parent_id to parent department name | UI resolution |
 * | TC-DEPT-B-01 | Name: "" (empty string) | Boundary – Empty input | Throws validation error: '部門名稱為必填項目' | Required field check |
 * | TC-DEPT-B-02 | Name: "   " (whitespace string) | Boundary – Whitespace input | Throws validation error: '部門名稱為必填項目' | Whitespace prevention |
 * | TC-DEPT-B-03 | Name: "  產品部  " (with spaces) | Boundary – Whitespace trimming | Automatically trimmed to '產品部' | Data normalization |
 * | TC-DEPT-B-04 | parentId: "" or whitespace or undefined | Boundary – Empty parent normalization | Normalized to null in store and mock | Top-level normalization |
 * | TC-DEPT-E-01 | Duplicate department name '行銷部' | Error – Duplicate department name | Rejects creation with error message '部門「行銷部」已存在，請使用不同名稱' | Uniqueness guard |
 * | TC-DEPT-E-02 | Duplicate with leading/trailing spaces '  行銷部  ' | Error – Duplicate after trim | Rejects creation with duplicate error | Strict duplicate guard |
 * | TC-DEPT-E-03 | Nonexistent parentId resolution | Boundary – Nonexistent parent | Fallback gracefully returns parentId without crash | Fault tolerance |
 * | TC-DEPT-ROLE-01 | Active tenant role: 'owner' | Equivalence – Owner role authorization | canManageMembers returns true (Department card rendered) | Role permission |
 * | TC-DEPT-ROLE-02 | Active tenant role: 'admin' | Equivalence – Admin role authorization | canManageMembers returns true (Department card rendered) | Role permission |
 * | TC-DEPT-ROLE-03 | Active tenant role: 'member' | Equivalence – Member role forbidden | canManageMembers returns false (Department card hidden) | Role permission |
 * | TC-DEPT-ROLE-04 | Active tenant is null / undefined | Boundary – Null active tenant | canManageMembers safely returns false | Safety guard |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  fetchDepartments,
  createDepartmentAction,
  canManageMembers
} = await import('../src/lib/store.svelte.js');

// Helper to resolve parent department name from store (same as UI helper)
function getParentDepartmentName(parentId, departments = appState.departments) {
  if (!parentId) return null;
  const parent = departments.find(d => d.id === parentId);
  return parent ? parent.name : parentId;
}

test('TC-DEPT-N-01: Create top-level department successfully with parentId null', async () => {
  // Given: Preconditions - Unique department name and null parentId
  const deptName = `研發部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When:  Operation to execute - Call createDepartmentAction with null parentId
  const result = await createDepartmentAction(deptName, null);

  // Then:  Expected result - Department is created with null parent_id and cached in store
  assert.ok(result.id, 'Department ID should be generated');
  assert.equal(result.name, deptName);
  assert.equal(result.parent_id, null);

  const departments = await fetchDepartments();
  const found = departments.find(d => d.id === result.id);
  assert.ok(found, 'New department must exist in appState.departments');
  assert.equal(found.name, deptName);
  assert.equal(found.parent_id, null);
});

test('TC-DEPT-N-02: Create sub-department with valid parentId', async () => {
  // Given: Preconditions - An existing parent department
  const parentName = `總經理室_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const parentDept = await createDepartmentAction(parentName, null);
  const childName = `特助組_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When:  Operation to execute - Create child department with parent_id
  const childDept = await createDepartmentAction(childName, parentDept.id);

  // Then:  Expected result - Child department links to parent_id
  assert.ok(childDept.id);
  assert.equal(childDept.name, childName);
  assert.equal(childDept.parent_id, parentDept.id);

  const departments = await fetchDepartments();
  const foundChild = departments.find(d => d.id === childDept.id);
  assert.ok(foundChild);
  assert.equal(foundChild.parent_id, parentDept.id);
});

test('TC-DEPT-N-03: fetchDepartments retrieves full list and updates store state', async () => {
  // Given: Preconditions - Existing departments in store
  const testDeptName = `財務部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createDepartmentAction(testDeptName, null);

  // When:  Operation to execute - Call fetchDepartments()
  const list = await fetchDepartments();

  // Then:  Expected result - Returns an array matching appState.departments
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  assert.equal(list, appState.departments);
  assert.ok(list.some(d => d.name === testDeptName));
});

test('TC-DEPT-N-04: Department hierarchy resolution accurately finds parent name', async () => {
  // Given: Preconditions - Parent and child departments
  const headquarterName = `總部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const headquarter = await createDepartmentAction(headquarterName, null);
  const branchName = `台北分部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const branch = await createDepartmentAction(branchName, headquarter.id);

  // When:  Operation to execute - Resolve parent department name
  const resolvedParentName = getParentDepartmentName(branch.parent_id, appState.departments);
  const topLevelParentName = getParentDepartmentName(headquarter.parent_id, appState.departments);

  // Then:  Expected result - Child resolves to parent name, top-level resolves to null
  assert.equal(resolvedParentName, headquarterName);
  assert.equal(topLevelParentName, null);
});

test('TC-DEPT-B-01: Boundary - Empty string department name throws validation error', async () => {
  // Given: Preconditions - Empty string input
  const emptyName = '';

  // When:  Operation to execute & Then: Verification
  await assert.rejects(
    async () => {
      await createDepartmentAction(emptyName, null);
    },
    {
      name: 'Error',
      message: '部門名稱為必填項目'
    }
  );
});

test('TC-DEPT-B-02: Boundary - Whitespace-only department name throws validation error', async () => {
  // Given: Preconditions - Whitespace-only string input
  const whitespaceName = '    ';

  // When:  Operation to execute & Then: Verification
  await assert.rejects(
    async () => {
      await createDepartmentAction(whitespaceName, null);
    },
    {
      name: 'Error',
      message: '部門名稱為必填項目'
    }
  );
});

test('TC-DEPT-B-03: Boundary - Department name with leading/trailing whitespace is trimmed', async () => {
  // Given: Preconditions - Untrimmed department name
  const rawName = `  行銷策劃部_${Date.now()}_${Math.floor(Math.random() * 10000)}  `;
  const expectedName = rawName.trim();

  // When:  Operation to execute - Create department with whitespace in name
  const dept = await createDepartmentAction(rawName, null);

  // Then:  Expected result - Stored name is cleanly trimmed
  assert.equal(dept.name, expectedName);
  const departments = await fetchDepartments();
  const found = departments.find(d => d.id === dept.id);
  assert.equal(found.name, expectedName);
});

test('TC-DEPT-B-04: Boundary - Empty string or whitespace parentId normalizes to null', async () => {
  // Given: Preconditions - Department with empty string parentId
  const deptName = `客服部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When:  Operation to execute - Pass empty string and whitespace for parentId
  const dept1 = await createDepartmentAction(deptName, '');
  const dept2Name = `法務部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const dept2 = await createDepartmentAction(dept2Name, '   ');

  // Then:  Expected result - parent_id is stored as null
  assert.equal(dept1.parent_id, null);
  assert.equal(dept2.parent_id, null);
});

test('TC-DEPT-E-01: Error - Duplicate department name is rejected', async () => {
  // Given: Preconditions - An existing department
  const uniqueName = `人資部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createDepartmentAction(uniqueName, null);

  // When:  Operation to execute - Attempt to create another department with the identical name
  // Then:  Expected result - Duplicate error is thrown
  await assert.rejects(
    async () => {
      await createDepartmentAction(uniqueName, null);
    },
    (err) => {
      assert.ok(err.message.includes('已存在'), `Expected duplicate error message, got: ${err.message}`);
      return true;
    }
  );
});

test('TC-DEPT-E-02: Error - Duplicate department name with whitespace padding is rejected', async () => {
  // Given: Preconditions - An existing department
  const baseName = `品保部_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createDepartmentAction(baseName, null);

  // When:  Operation to execute - Attempt to create with surrounding spaces
  // Then:  Expected result - Duplicate error is thrown after trim
  await assert.rejects(
    async () => {
      await createDepartmentAction(`  ${baseName}  `, null);
    },
    (err) => {
      assert.ok(err.message.includes('已存在'), `Expected duplicate error message, got: ${err.message}`);
      return true;
    }
  );
});

test('TC-DEPT-E-03: Boundary - Nonexistent parentId fallback returns parentId string safely', () => {
  // Given: Preconditions - A department referencing a deleted or unknown parent ID
  const unknownParentId = 'dept_nonexistent_9999';

  // When:  Operation to execute - Resolve parent department name
  const resolved = getParentDepartmentName(unknownParentId, appState.departments);

  // Then:  Expected result - Returns the raw ID without throwing or crashing
  assert.equal(resolved, unknownParentId);
});

test('TC-DEPT-ROLE-01: Owner role has permission to access department management', () => {
  // Given: Preconditions - Active tenant with role 'owner'
  const tenant = { id: 'tnt_1', name: '極致科技', role: 'owner' };

  // When:  Operation to execute - Check permission
  const allowed = canManageMembers(tenant);

  // Then:  Expected result - Owner is permitted (card rendered)
  assert.equal(allowed, true);
});

test('TC-DEPT-ROLE-02: Admin role has permission to access department management', () => {
  // Given: Preconditions - Active tenant with role 'admin'
  const tenant = { id: 'tnt_2', name: '極致科技', role: 'admin' };

  // When:  Operation to execute - Check permission
  const allowed = canManageMembers(tenant);

  // Then:  Expected result - Admin is permitted (card rendered)
  assert.equal(allowed, true);
});

test('TC-DEPT-ROLE-03: Member role is forbidden from accessing department management', () => {
  // Given: Preconditions - Active tenant with role 'member'
  const tenant = { id: 'tnt_3', name: '極致科技', role: 'member' };

  // When:  Operation to execute - Check permission
  const allowed = canManageMembers(tenant);

  // Then:  Expected result - General member is forbidden (card hidden)
  assert.equal(allowed, false);
});

test('TC-DEPT-ROLE-04: Boundary - NULL activeTenant safely denies department management permission', () => {
  // Given: Preconditions - NULL active tenant
  const tenant = null;

  // When:  Operation to execute - Check permission
  const allowed = canManageMembers(tenant);

  // Then:  Expected result - Safely returns false
  assert.equal(allowed, false);
});

