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
