import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  fetchMembers,
  onboardMemberAction,
  assignMemberRoleAction,
  assignMemberDepartmentsAction,
  getEffectiveSkills,
  computeSkillDiff,
  fetchDepartments,
  canManageMembers,
  apiCall
} = await import('../src/lib/store.svelte.js');

let counter = 1000;

async function setupTestTenant() {
  counter++;
  const uniqueCode = `tnt_test_${Date.now()}_${counter}`;
  const uniqueEmail = `admin_${Date.now()}_${counter}@example.com`;
  await apiCall('POST', '/v1/auth/register-tenant', {
    admin_name: '測試管理員',
    tenant_name: '極致科技',
    company_name: '極致科技股份有限公司',
    admin_email: uniqueEmail,
    admin_password: 'password123',
    tenant_code: uniqueCode
  });
}

test('TC-MBR-N-01: Onboard member normal path with default member role', async () => {
  // Given: Preconditions - Authenticated tenant and member payload
  await setupTestTenant();
  const memberName = '王小明';
  const memberEmail = `wang_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Operation to execute - Onboard member with default role
  const res = await onboardMemberAction({
    name: memberName,
    email: memberEmail,
    role: 'member'
  });

  // Then: Expected result - Member is created and store cache is updated
  assert.equal(res.name, memberName);
  assert.equal(res.email, memberEmail);
  assert.equal(res.role, 'member');

  const members = await fetchMembers();
  const found = members.find(m => m.email === memberEmail);
  assert.ok(found, 'New member should be in fetched member list');
  assert.equal(found.role, 'member');
  assert.equal(found.name, memberName);
});

test('TC-MBR-N-02: Onboard member with admin and owner roles', async () => {
  // Given: Preconditions - Admin and Owner payloads
  await setupTestTenant();
  const adminEmail = `admin_user_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
  const ownerEmail = `owner_user_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Operation to execute - Onboard admin and owner
  const adminRes = await onboardMemberAction({
    name: '林主管',
    email: adminEmail,
    role: 'admin'
  });
  const ownerRes = await onboardMemberAction({
    name: '陳董事',
    email: ownerEmail,
    role: 'owner'
  });

  // Then: Expected result - Roles are correctly assigned
  assert.equal(adminRes.role, 'admin');
  assert.equal(ownerRes.role, 'owner');

  const members = await fetchMembers();
  const adminFound = members.find(m => m.email === adminEmail);
  const ownerFound = members.find(m => m.email === ownerEmail);
  assert.equal(adminFound.role, 'admin');
  assert.equal(ownerFound.role, 'owner');
});

test('TC-MBR-N-03: Assign member role and sync state reactively', async () => {
  // Given: Preconditions - An existing member with role 'member'
  await setupTestTenant();
  const targetEmail = `sync_user_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
  const created = await onboardMemberAction({
    name: '張組長',
    email: targetEmail,
    role: 'member'
  });
  const targetUserId = created.user_id || created.id;

  // When: Operation to execute - Upgrade to admin, then owner, then back to member
  const resAdmin = await assignMemberRoleAction(targetUserId, 'admin');
  assert.equal(resAdmin.role, 'admin');

  let members = await fetchMembers();
  let found = members.find(m => m.user_id === targetUserId || m.id === targetUserId);
  assert.equal(found.role, 'admin', 'Store should immediately reflect admin role');

  const resOwner = await assignMemberRoleAction(targetUserId, 'owner');
  assert.equal(resOwner.role, 'owner');

  members = await fetchMembers();
  found = members.find(m => m.user_id === targetUserId || m.id === targetUserId);
  assert.equal(found.role, 'owner', 'Store should immediately reflect owner role');

  const resMember = await assignMemberRoleAction(targetUserId, 'member');
  assert.equal(resMember.role, 'member');

  members = await fetchMembers();
  found = members.find(m => m.user_id === targetUserId || m.id === targetUserId);
  assert.equal(found.role, 'member', 'Store should immediately reflect member role');
});

test('TC-MBR-N-04: List members isolates by active tenant', async () => {
  // Given: Preconditions - Current active tenant members
  await setupTestTenant();
  const currentMembers = await fetchMembers();
  assert.ok(currentMembers.length > 0, 'Current tenant should have members');

  // Then: All returned members belong to current tenant query
  for (const m of currentMembers) {
    assert.ok(m.user_id || m.id);
    assert.ok(m.email);
    assert.ok(['owner', 'admin', 'member'].includes(m.role));
  }
});

test('TC-MBR-B-01: Boundary - Empty or whitespace email throws validation error', async () => {
  // Given: Preconditions - Member with empty or whitespace email
  await setupTestTenant();
  // When: Operation to execute - Attempt to onboard
  // Then: Expected result - Throws validation error
  await assert.rejects(
    async () => {
      await onboardMemberAction({
        name: '測試人員',
        email: '   ',
        role: 'member'
      });
    },
    /姓名與電子郵件為必填項目/
  );
});

test('TC-MBR-B-02: Boundary - Empty or whitespace name throws validation error', async () => {
  // Given: Preconditions - Member with empty or whitespace name
  await setupTestTenant();
  // When: Operation to execute - Attempt to onboard
  // Then: Expected result - Throws validation error
  await assert.rejects(
    async () => {
      await onboardMemberAction({
        name: '   ',
        email: 'valid@example.com',
        role: 'member'
      });
    },
    /姓名與電子郵件為必填項目/
  );
});

test('TC-MBR-B-03: Boundary - Trim whitespace on name and email', async () => {
  // Given: Preconditions - Member payload with extra whitespace padding
  await setupTestTenant();
  const rawEmail = `  padded_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com  `;
  const rawName = '  李工程師  ';

  // When: Operation to execute - Onboard member
  const res = await onboardMemberAction({
    name: rawName,
    email: rawEmail,
    role: 'member'
  });

  // Then: Expected result - Name and email are trimmed
  assert.equal(res.name, '李工程師');
  assert.equal(res.email, rawEmail.trim());
});

test('TC-MBR-E-01: Error - Duplicate member on same tenant is rejected', async () => {
  // Given: Preconditions - An already onboarded member
  await setupTestTenant();
  const dupEmail = `dup_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
  await onboardMemberAction({
    name: '初代成員',
    email: dupEmail,
    role: 'member'
  });

  // When: Operation to execute - Attempt to onboard with duplicate email
  // Then: Expected result - Rejected with duplicate error
  await assert.rejects(
    async () => {
      await onboardMemberAction({
        name: '複製人',
        email: dupEmail,
        role: 'admin'
      });
    },
    (err) => err?.code === 'IAM_ERR_ALREADY_EXISTS' || String(err?.message).includes('already exists')
  );
});

test('TC-MBR-E-02: Error - Invalid role name is rejected', async () => {
  // Given: Preconditions - Invalid role 'superadmin'
  await setupTestTenant();
  // When: Operation to execute - Attempt to onboard with invalid role
  // Then: Expected result - Rejected with invalid role error
  await assert.rejects(
    async () => {
      await onboardMemberAction({
        name: '超管',
        email: `invalid_role_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`,
        role: 'superadmin'
      });
    },
    (err) => err?.code === 'IAM_ERR_INVALID_ARGUMENT' || String(err?.message).includes('invalid role')
  );
});

test('TC-MBR-E-03: Error - Assign role to non-existent user is rejected', async () => {
  // Given: Preconditions - Non-existent user ID
  await setupTestTenant();
  // When: Operation to execute - Attempt to assign role
  // Then: Expected result - Rejected with not found error
  await assert.rejects(
    async () => {
      await assignMemberRoleAction('usr_non_existent_99999', 'admin');
    },
    (err) => err?.code === 'IAM_ERR_INVALID_ARGUMENT' || String(err?.message).includes('not found')
  );
});

// ==========================================
// Issue 105: Role-based dynamic permissions
// ==========================================

test('TC-ROLE-N-01: Owner role has member management permission', () => {
  // Given: Preconditions - Tenant with role 'owner'
  const ownerTenant = { id: 'tnt_1', code: 'TNT1', name: 'Test Tenant', role: 'owner' };
  appState.activeTenant = ownerTenant;

  // When: Operation to execute - Check member management permission
  const allowedDirect = canManageMembers(ownerTenant);
  const allowedDefault = canManageMembers();

  // Then: Expected result - Both return true for owner
  assert.equal(allowedDirect, true, 'canManageMembers with owner tenant should be true');
  assert.equal(allowedDefault, true, 'canManageMembers with default activeTenant owner should be true');
});

test('TC-ROLE-N-02: Admin role has member management permission', () => {
  // Given: Preconditions - Tenant with role 'admin'
  const adminTenant = { id: 'tnt_2', code: 'TNT2', name: 'Test Tenant', role: 'admin' };
  appState.activeTenant = adminTenant;

  // When: Operation to execute - Check member management permission
  const allowed = canManageMembers();

  // Then: Expected result - Returns true for admin
  assert.equal(allowed, true, 'canManageMembers with admin role should be true');
});

test('TC-ROLE-N-03: Member role is forbidden from member management', () => {
  // Given: Preconditions - Tenant with role 'member'
  const memberTenant = { id: 'tnt_3', code: 'TNT3', name: 'Test Tenant', role: 'member' };
  appState.activeTenant = memberTenant;

  // When: Operation to execute - Check member management permission
  const allowed = canManageMembers();

  // Then: Expected result - Returns false for member role (card will not be rendered)
  assert.equal(allowed, false, 'canManageMembers with member role should be false');
});

test('TC-ROLE-N-04: Role badge formatting for owner, admin, and member', () => {
  // Given: Preconditions - Different role names
  const getBadgeLabel = (role) => (role === 'owner' ? '擁有者' : role === 'admin' ? '管理者' : '成員');

  // When & Then: Verify expected badge mappings
  assert.equal(getBadgeLabel('owner'), '擁有者');
  assert.equal(getBadgeLabel('admin'), '管理者');
  assert.equal(getBadgeLabel('member'), '成員');
  assert.equal(getBadgeLabel('other'), '成員');
});

test('TC-ROLE-B-01: Boundary - NULL activeTenant safely returns false', () => {
  // Given: Preconditions - NULL activeTenant
  appState.activeTenant = null;

  // When: Operation to execute - Check permission
  const allowedDirect = canManageMembers(null);
  const allowedDefault = canManageMembers();

  // Then: Expected result - Safely returns false without throwing TypeError
  assert.equal(allowedDirect, false);
  assert.equal(allowedDefault, false);
});

test('TC-ROLE-B-02: Boundary - Empty string role returns false', () => {
  // Given: Preconditions - Tenant with empty string role
  const emptyRoleTenant = { id: 'tnt_empty', code: 'TNT_EMPTY', name: 'Empty Role', role: '' };

  // When: Operation to execute - Check permission
  const allowed = canManageMembers(emptyRoleTenant);

  // Then: Expected result - Returns false
  assert.equal(allowed, false);
});

test('TC-ROLE-B-03: Boundary - Case insensitivity and whitespace tolerance', () => {
  // Given: Preconditions - Roles with uppercase and extra whitespace
  const upperAdmin = { id: 'tnt_up1', code: 'T1', name: 'T1', role: '  ADMIN  ' };
  const upperOwner = { id: 'tnt_up2', code: 'T2', name: 'T2', role: ' Owner ' };
  const upperMember = { id: 'tnt_up3', code: 'T3', name: 'T3', role: ' MEMBER ' };

  // When: Operation to execute - Check permissions
  const isAdmin = canManageMembers(upperAdmin);
  const isOwner = canManageMembers(upperOwner);
  const isMember = canManageMembers(upperMember);

  // Then: Expected result - Properly trimmed and lowercased
  assert.equal(isAdmin, true);
  assert.equal(isOwner, true);
  assert.equal(isMember, false);
});

test('TC-ROLE-B-04: Boundary - Undefined role attribute safely returns false', () => {
  // Given: Preconditions - Tenant object without role property
  /** @type {any} */
  const undefinedRoleTenant = { id: 'tnt_undef', code: 'T_UNDEF', name: 'Undef' };

  // When: Operation to execute - Check permission
  const allowed = canManageMembers(undefinedRoleTenant);

  // Then: Expected result - Safely returns false
  assert.equal(allowed, false);
});

test('TC-ROLE-E-01: Error/Unknown - Unauthorized roles (operator, guest, etc.) return false', () => {
  // Given: Preconditions - Non-standard or unauthorized roles
  const operatorTenant = { id: 'tnt_op', code: 'TOP', name: 'Op Tenant', role: 'operator' };
  const guestTenant = { id: 'tnt_guest', code: 'TGUEST', name: 'Guest Tenant', role: 'guest' };

  // When: Operation to execute - Check permissions
  // Then: Expected result - Rejected
  assert.equal(canManageMembers(operatorTenant), false);
  assert.equal(canManageMembers(guestTenant), false);
});

test('TC-ROLE-E-02: Flow Guard - Member role should be prevented from member management actions', async () => {
  // Given: Preconditions - Tenant state configured as member
  const memberTenant = { id: 'tnt_mbr', code: 'TMBR', name: 'Mbr Tenant', role: 'member' };
  appState.activeTenant = memberTenant;

  // When: Guard logic evaluation
  const shouldFetch = canManageMembers(appState.activeTenant);

  // Then: Member is not allowed to trigger member management fetch
  assert.equal(shouldFetch, false);
});

// =========================================================================
// Issue 114: Multi-department assignment and skill union & diff calculation
// =========================================================================

test('TC-MDEP-N-01: Onboard member with zero departments (optional field)', async () => {
  // Given: Authenticated tenant and member payload without departments
  await setupTestTenant();
  const testEmail = `nodept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Onboarding member with empty department_ids
  const res = await onboardMemberAction({
    name: '無部門成員',
    email: testEmail,
    role: 'member',
    department_ids: []
  });

  // Then: Member is created with empty department list and empty effective skills
  assert.deepEqual(res.department_ids, []);
  const members = await fetchMembers();
  const found = members.find(m => m.email === testEmail);
  assert.ok(found);
  assert.deepEqual(found.department_ids, []);

  const skills = getEffectiveSkills(found.department_ids, appState.departments);
  assert.deepEqual(skills, []);
});

test('TC-MDEP-N-02: Onboard member with single department', async () => {
  // Given: Authenticated tenant and departments cached in store
  await setupTestTenant();
  await fetchDepartments();
  const testEmail = `singledept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Onboarding member with single department 'dept_mock_1'
  const res = await onboardMemberAction({
    name: '總經理秘書',
    email: testEmail,
    role: 'member',
    department_ids: ['dept_mock_1']
  });

  // Then: Member has dept_mock_1 and effective skills from dept_mock_1
  assert.deepEqual(res.department_ids, ['dept_mock_1']);
  const members = await fetchMembers();
  const found = members.find(m => m.email === testEmail);
  assert.ok(found);
  assert.deepEqual(found.department_ids, ['dept_mock_1']);

  const skills = getEffectiveSkills(found.department_ids, appState.departments);
  assert.ok(skills.includes('org.manage'));
  assert.ok(skills.includes('audit.trace_view'));
});

test('TC-MDEP-N-03: Onboard member with multiple departments (skill union)', async () => {
  // Given: Authenticated tenant and department list
  await setupTestTenant();
  await fetchDepartments();
  const testEmail = `multidept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Onboarding member with dept_mock_1 and dept_mock_2
  const res = await onboardMemberAction({
    name: '跨部門協調者',
    email: testEmail,
    role: 'member',
    department_ids: ['dept_mock_1', 'dept_mock_2']
  });

  // Then: Member belongs to both departments and skills are the union
  assert.equal(res.department_ids.length, 2);
  assert.ok(res.department_ids.includes('dept_mock_1'));
  assert.ok(res.department_ids.includes('dept_mock_2'));

  const skills = getEffectiveSkills(res.department_ids, appState.departments);
  assert.ok(skills.includes('org.manage'), 'Contains dept 1 skill org.manage');
  assert.ok(skills.includes('audit.trace_view'), 'Contains dept 1 skill audit.trace_view');
  assert.ok(skills.includes('dev.repo_write'), 'Contains dept 2 skill dev.repo_write');
  assert.ok(skills.includes('dev.agent_config'), 'Contains dept 2 skill dev.agent_config');
});

test('TC-MDEP-N-04: Update member departments (granting privilege / adding departments)', async () => {
  // Given: An existing member with dept_mock_1
  await setupTestTenant();
  await fetchDepartments();
  const testEmail = `grantdept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
  const created = await onboardMemberAction({
    name: '工程主管',
    email: testEmail,
    role: 'member',
    department_ids: ['dept_mock_1']
  });
  const userId = created.user_id || created.id;

  // When: Calculating diff for adding dept_mock_3 ('前端小組')
  const diff = computeSkillDiff(['dept_mock_1'], ['dept_mock_1', 'dept_mock_3'], appState.departments);
  assert.ok(diff.addedSkills.includes('ui.build'));
  assert.ok(diff.addedSkills.includes('ui.component_test'));
  assert.equal(diff.removedSkills.length, 0);

  // And: Updating departments in backend
  const updateRes = await assignMemberDepartmentsAction(userId, ['dept_mock_1', 'dept_mock_3']);
  assert.equal(updateRes.department_ids.length, 2);

  // Then: Fetched members reflect updated departments
  const members = await fetchMembers();
  const found = members.find(m => m.user_id === userId || m.id === userId);
  assert.deepEqual(found.department_ids.sort(), ['dept_mock_1', 'dept_mock_3'].sort());
});

test('TC-MDEP-N-05: Update member departments (revoking privilege / removing departments)', async () => {
  // Given: An existing member with dept_mock_1 and dept_mock_2
  await setupTestTenant();
  await fetchDepartments();
  const testEmail = `revokedept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
  const created = await onboardMemberAction({
    name: '離職交接成員',
    email: testEmail,
    role: 'member',
    department_ids: ['dept_mock_1', 'dept_mock_2']
  });
  const userId = created.user_id || created.id;

  // When: Calculating diff for removing dept_mock_1
  const diff = computeSkillDiff(['dept_mock_1', 'dept_mock_2'], ['dept_mock_2'], appState.departments);
  assert.ok(diff.removedSkills.includes('org.manage'));
  assert.ok(diff.removedSkills.includes('audit.trace_view'));
  assert.equal(diff.addedSkills.length, 0);

  // And: Executing update
  const updateRes = await assignMemberDepartmentsAction(userId, ['dept_mock_2']);
  assert.deepEqual(updateRes.department_ids, ['dept_mock_2']);

  // Then: Store reflects removal of dept_mock_1
  const members = await fetchMembers();
  const found = members.find(m => m.user_id === userId || m.id === userId);
  assert.deepEqual(found.department_ids, ['dept_mock_2']);
});

test('TC-MDEP-N-06: List members contains department_ids and department objects', async () => {
  // Given: Authenticated tenant with members in departments
  await setupTestTenant();
  await fetchDepartments();
  const testEmail = `listdept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
  await onboardMemberAction({
    name: '清單測試員',
    email: testEmail,
    role: 'member',
    department_ids: ['dept_mock_5']
  });

  // When: Fetching members
  const members = await fetchMembers();

  // Then: Every member object has department_ids array
  for (const m of members) {
    assert.ok(Array.isArray(m.department_ids));
  }
  const found = members.find(m => m.email === testEmail);
  assert.ok(found);
  assert.deepEqual(found.department_ids, ['dept_mock_5']);
});

test('TC-MDEP-B-01: Boundary - NULL and undefined department_ids handled safely', async () => {
  // Given: Authenticated tenant
  await setupTestTenant();
  const testEmail = `nulldept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Onboarding with null department_ids
  const resNull = await onboardMemberAction({
    name: 'Null 部門',
    email: testEmail,
    role: 'member',
    department_ids: null
  });

  // Then: Safely normalized to empty array
  assert.deepEqual(resNull.department_ids, []);

  // And: Diff calculation with null and undefined inputs safely returns empty arrays
  const nullDiff = computeSkillDiff(null, undefined, appState.departments);
  assert.deepEqual(nullDiff.currentSkills, []);
  assert.deepEqual(nullDiff.nextSkills, []);
  assert.deepEqual(nullDiff.addedSkills, []);
  assert.deepEqual(nullDiff.removedSkills, []);
});

test('TC-MDEP-B-02: Boundary - Duplicate department_ids are deduplicated', async () => {
  // Given: Authenticated tenant and member payload with duplicate department IDs
  await setupTestTenant();
  const testEmail = `dupdept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Onboarding with ['dept_mock_1', 'dept_mock_1', 'dept_mock_2', 'dept_mock_2']
  const res = await onboardMemberAction({
    name: '重複部門',
    email: testEmail,
    role: 'member',
    department_ids: ['dept_mock_1', 'dept_mock_1', 'dept_mock_2', 'dept_mock_2']
  });

  // Then: Deduplicated to 2 departments
  assert.equal(res.department_ids.length, 2);
  assert.deepEqual(res.department_ids.sort(), ['dept_mock_1', 'dept_mock_2'].sort());
});

test('TC-MDEP-B-03: Boundary - Whitespace in department IDs is trimmed and sanitized', async () => {
  // Given: Authenticated tenant and department array with padded whitespace
  await setupTestTenant();
  const testEmail = `paddeddept_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;

  // When: Onboarding with padded IDs
  const res = await onboardMemberAction({
    name: '空白部門',
    email: testEmail,
    role: 'member',
    department_ids: ['  dept_mock_1  ', '   ', ' dept_mock_2 ']
  });

  // Then: Filtered empty strings and trimmed IDs
  assert.deepEqual(res.department_ids.sort(), ['dept_mock_1', 'dept_mock_2'].sort());
});

test('TC-MDEP-B-04: Boundary - Department without skills returns empty skill list without error', () => {
  // Given: Custom departments list where one department has no skills or undefined skills
  const mockDeptList = [
    { id: 'd_empty_1', name: '無技能部', skills: [] },
    { id: 'd_empty_2', name: '未設定技能部' }
  ];

  // When: Getting effective skills for both departments
  const skills = getEffectiveSkills(['d_empty_1', 'd_empty_2'], mockDeptList);

  // Then: Safely returns empty array
  assert.deepEqual(skills, []);

  // And: Diff calculation returns empty diffs
  const diff = computeSkillDiff([], ['d_empty_1', 'd_empty_2'], mockDeptList);
  assert.deepEqual(diff.addedSkills, []);
  assert.deepEqual(diff.removedSkills, []);
});

test('TC-MDEP-E-01: Error - Assign departments to non-existent user is rejected', async () => {
  // Given: Authenticated tenant
  await setupTestTenant();

  // When: Attempting to assign departments to non-existent user
  // Then: Throws member not found error
  await assert.rejects(
    async () => {
      await assignMemberDepartmentsAction('usr_non_existent_8888', ['dept_mock_1']);
    },
    (err) => err?.code === 'IAM_ERR_INVALID_ARGUMENT' || String(err?.message).includes('not found')
  );
});

test('TC-MDEP-E-02: Error - Assign departments with empty userId is rejected', async () => {
  // Given: Authenticated tenant
  await setupTestTenant();

  // When: Attempting to assign departments with empty userId
  // Then: Throws validation error
  await assert.rejects(
    async () => {
      await assignMemberDepartmentsAction('   ', ['dept_mock_1']);
    },
    /使用者 ID 為必填項目/
  );
});


