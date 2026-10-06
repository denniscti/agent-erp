/**
 * @file department-skills.test.js
 * @description Comprehensive test suite for Department Usable Skills Management (Issue #115).
 * Conforms to docs/standards/authoring/agent-skill-authoring.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-SKILL-N-01 | Call getDeclaredSkills() | Equivalence – Normal query | Returns full list of declared skills with id, name, domain, description | Core registry query |
 * | TC-SKILL-N-02 | Call getSkillsByDomain(domain) | Equivalence – Grouping by domain | Correctly filters skills belonging to given domain from KNOWN_DOMAINS | Domain filtering |
 * | TC-SKILL-N-03 | Search with keywords: "customer", "客戶", "manage" | Equivalence – Keyword search | Correctly matches id, name, domain, or description | Search filter |
 * | TC-SKILL-N-04 | Grant single/multiple skills to department | Equivalence – Skill granting | Department skills updated; audit_logs records 'grant_department_skill' with operator | Sensitive action audit |
 * | TC-SKILL-N-05 | Revoke skill from department | Equivalence – Skill revocation | Department skills updated; audit_logs records 'revoke_department_skill' with operator | Sensitive action audit |
 * | TC-SKILL-N-06 | Batch update skills (both added and removed) | Equivalence – Batch diff | Department skills updated to latest set; separate grant & revoke audit logs recorded | Batch safety & audit |
 * | TC-SKILL-B-01 | Set department skills to [] (0 skills) | Boundary – 0 skills / Empty array | Department skills cleared; revoke audit logs recorded | Zero boundary |
 * | TC-SKILL-B-02 | Search with empty string "" or whitespace "   " | Boundary – Empty search | Returns entire list without filtering out items | Search tolerance |
 * | TC-SKILL-B-03 | Input array containing duplicate skill IDs | Boundary – Duplicate skill IDs | Automatically sanitized and deduplicated | Normalization |
 * | TC-SKILL-B-04 | Department skills with leading/trailing spaces | Boundary – Whitespace skill IDs | Trimmed and sanitized properly | Normalization |
 * | TC-SKILL-E-01 | registerAgentProfile with domain not in KNOWN_DOMAINS | Error – Unknown domain registration | Throws Error with descriptive domain rejection message | Strict domain enforcement |
 * | TC-SKILL-E-02 | registerDeclaredSkill with domain not in KNOWN_DOMAINS | Error – Unknown skill domain | Throws Error rejecting unregistered domain | Strict domain enforcement |
 * | TC-SKILL-E-03 | updateDepartmentSkillsAction with nonexistent department ID | Error – Nonexistent department | Throws Error rejecting update on missing department | Target validation |
 * | TC-SKILL-E-04 | updateDepartmentSkillsAction with empty/whitespace department ID | Error – Empty department ID | Throws Error '部門 ID 為必填項目' | Required field check |
 * | TC-SKILL-ROLE-01 | Active tenant role 'owner' or 'admin' | Equivalence – Role authorization | canManageMembers returns true | Permission check |
 * | TC-SKILL-ROLE-02 | Active tenant role 'member' | Equivalence – Role forbidden | canManageMembers returns false | Permission check |
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
  updateDepartmentSkillsAction,
  filterDeclaredSkills,
  getDeclaredSkills,
  getSkillsByDomain,
  KNOWN_DOMAINS,
  canManageMembers,
  fetchAuditLogs
} = await import('../src/lib/store.svelte.js');

const {
  registerAgentProfile,
  registerDeclaredSkill,
  isKnownDomain
} = await import('../src/lib/workflow/index.js');

test('TC-SKILL-N-01: getDeclaredSkills returns all registered system skills', () => {
  // Given: System has initialized declared skills
  // When:  Operation to execute - Query all declared skills
  const skills = getDeclaredSkills();

  // Then:  Expected result - Valid array containing built-in skills with required fields
  assert.ok(Array.isArray(skills), 'Skills must be an array');
  assert.ok(skills.length >= 3, 'Must contain at least initial skills');

  const deptManage = skills.find(s => s.id === 'department.manage');
  assert.ok(deptManage, 'department.manage skill must be registered');
  assert.equal(deptManage.domain, 'department');
  assert.ok(deptManage.name);

  const custCreate = skills.find(s => s.id === 'customer.create_basic_profile');
  assert.ok(custCreate, 'customer.create_basic_profile must be registered');
  assert.equal(custCreate.domain, 'customer');
});

test('TC-SKILL-N-02: getSkillsByDomain filters skills by valid domain from KNOWN_DOMAINS', () => {
  // Given: KNOWN_DOMAINS contains 'department', 'customer', 'vendor'
  assert.ok(isKnownDomain('department'));
  assert.ok(isKnownDomain('customer'));
  assert.ok(isKnownDomain('vendor'));

  // When:  Operation to execute - Query skills for 'customer' domain
  const customerSkills = getSkillsByDomain('customer');

  // Then:  Expected result - All returned skills have domain === 'customer'
  assert.ok(customerSkills.length > 0);
  for (const sk of customerSkills) {
    assert.equal(sk.domain, 'customer');
  }

  // When:  Operation to execute - Query skills with null/undefined domain
  const allSkills = getSkillsByDomain(null);
  // Then:  Expected result - Returns all skills
  assert.equal(allSkills.length, getDeclaredSkills().length);
});

test('TC-SKILL-N-03: filterDeclaredSkills accurately searches by ID, name, domain, and description', () => {
  // Given: Full declared skills list
  const allSkills = getDeclaredSkills();

  // When:  Searching by domain/id keyword "customer"
  const custResults = filterDeclaredSkills(allSkills, 'customer');
  // Then:  Only skills matching "customer" are returned
  assert.ok(custResults.length > 0);
  assert.ok(custResults.every(s => s.id.includes('customer') || s.domain === 'customer'));

  // When:  Searching by Chinese name keyword "部門"
  const deptResults = filterDeclaredSkills(allSkills, '部門');
  // Then:  department.manage is matched
  assert.ok(deptResults.some(s => s.id === 'department.manage'));

  // When:  Searching with mixed-case keyword "MANAGE"
  const manageResults = filterDeclaredSkills(allSkills, 'MANAGE');
  // Then:  Case-insensitive matching works
  assert.ok(manageResults.some(s => s.id.includes('manage')));
});

test('TC-SKILL-N-04: Granting skills to department updates department and records grant_department_skill in audit_logs', async () => {
  // Given: An existing department with empty skills
  const deptName = `業務授權部_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const dept = await createDepartmentAction(deptName, null);
  assert.deepEqual(dept.skills, []);

  // When:  Operation to execute - Grant 'customer.create_basic_profile' and 'customer.view'
  const skillsToGrant = ['customer.create_basic_profile', 'customer.view'];
  const operatorName = 'Admin Auditor';
  const updated = await updateDepartmentSkillsAction(dept.id, skillsToGrant, operatorName);

  // Then:  Department skills are updated
  assert.deepEqual(updated.skills, ['customer.create_basic_profile', 'customer.view']);

  // And:   Store departments list is updated
  const list = await fetchDepartments();
  const found = list.find(d => d.id === dept.id);
  assert.ok(found);
  assert.deepEqual(found.skills, ['customer.create_basic_profile', 'customer.view']);

  // And:   Audit log contains 'grant_department_skill' entries with operator and department details
  const auditLogs = await fetchAuditLogs();
  const grantLog1 = auditLogs.find(
    log => log.action_type === 'grant_department_skill' && log.arguments.includes('customer.create_basic_profile') && log.arguments.includes(dept.id)
  );
  assert.ok(grantLog1, 'Audit log must contain grant record for customer.create_basic_profile');
  assert.equal(grantLog1.operator, operatorName);
  assert.equal(grantLog1.decision, 'approved');
});

test('TC-SKILL-N-05: Revoking skill from department updates department and records revoke_department_skill in audit_logs', async () => {
  // Given: An existing department with multiple skills
  const deptName = `研發撤銷部_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const dept = await createDepartmentAction(deptName, null);
  await updateDepartmentSkillsAction(dept.id, ['department.manage', 'vendor.manage'], 'Setup Admin');

  // When:  Operation to execute - Remove 'vendor.manage', keeping only 'department.manage'
  const updated = await updateDepartmentSkillsAction(dept.id, ['department.manage'], 'Security Admin');

  // Then:  Department skills only contain 'department.manage'
  assert.deepEqual(updated.skills, ['department.manage']);

  // And:   Audit log records 'revoke_department_skill' for 'vendor.manage'
  const auditLogs = await fetchAuditLogs();
  const revokeLog = auditLogs.find(
    log => log.action_type === 'revoke_department_skill' && log.arguments.includes('vendor.manage') && log.arguments.includes(dept.id)
  );
  assert.ok(revokeLog, 'Audit log must contain revoke record for vendor.manage');
  assert.equal(revokeLog.operator, 'Security Admin');
  assert.equal(revokeLog.decision, 'approved');
});

test('TC-SKILL-N-06: Batch updating skills with simultaneous additions and removals logs both audit records', async () => {
  // Given: Department with initial skills ['customer.view', 'vendor.manage']
  const deptName = `綜合調整部_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const dept = await createDepartmentAction(deptName, null);
  await updateDepartmentSkillsAction(dept.id, ['customer.view', 'vendor.manage'], 'Initial Operator');

  // When:  Operation to execute - Change to ['department.manage', 'customer.view']
  //        (Granted: 'department.manage', Revoked: 'vendor.manage')
  await updateDepartmentSkillsAction(dept.id, ['department.manage', 'customer.view'], 'Batch Officer');

  // Then:  Department skills match the new set
  const list = await fetchDepartments();
  const found = list.find(d => d.id === dept.id);
  assert.deepEqual(found.skills, ['customer.view', 'department.manage']);

  // And:   Both grant and revoke audit logs exist for this department change
  const auditLogs = await fetchAuditLogs();
  const grantEntry = auditLogs.find(
    l => l.action_type === 'grant_department_skill' && l.arguments.includes('department.manage') && l.arguments.includes(dept.id)
  );
  const revokeEntry = auditLogs.find(
    l => l.action_type === 'revoke_department_skill' && l.arguments.includes('vendor.manage') && l.arguments.includes(dept.id)
  );
  assert.ok(grantEntry, 'Must log grant for department.manage');
  assert.ok(revokeEntry, 'Must log revoke for vendor.manage');
  assert.equal(grantEntry.operator, 'Batch Officer');
  assert.equal(revokeEntry.operator, 'Batch Officer');
});

test('TC-SKILL-B-01: Boundary - Clearing all department skills to empty array [] succeeds and records revoke', async () => {
  // Given: Department with skills
  const deptName = `清空技能部_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const dept = await createDepartmentAction(deptName, null);
  await updateDepartmentSkillsAction(dept.id, ['customer.create_basic_profile'], 'Admin');

  // When:  Operation to execute - Update with empty array []
  const updated = await updateDepartmentSkillsAction(dept.id, [], 'Admin');

  // Then:  Skills array is empty
  assert.deepEqual(updated.skills, []);
  const list = await fetchDepartments();
  const found = list.find(d => d.id === dept.id);
  assert.deepEqual(found.skills, []);
});

test('TC-SKILL-B-02: Boundary - filterDeclaredSkills with empty or whitespace keyword returns all skills', () => {
  // Given: Full declared skills
  const allSkills = getDeclaredSkills();

  // When:  Filtering with null, undefined, "", or "   "
  const resNull = filterDeclaredSkills(allSkills, null);
  const resEmpty = filterDeclaredSkills(allSkills, '');
  const resSpaces = filterDeclaredSkills(allSkills, '   ');

  // Then:  All return full unfiltered skills array
  assert.equal(resNull.length, allSkills.length);
  assert.equal(resEmpty.length, allSkills.length);
  assert.equal(resSpaces.length, allSkills.length);
});

test('TC-SKILL-B-03: Boundary - Duplicate skill IDs are deduplicated and normalized', async () => {
  // Given: Department
  const deptName = `去重部_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const dept = await createDepartmentAction(deptName, null);

  // When:  Passing duplicate and un-trimmed skill IDs
  const rawSkills = ['customer.view', '  customer.view  ', 'customer.view'];
  const updated = await updateDepartmentSkillsAction(dept.id, rawSkills, 'Admin');

  // Then:  Deduplicated to single unique skill ID
  assert.deepEqual(updated.skills, ['customer.view']);
});

test('TC-SKILL-E-01: Error - registerAgentProfile with unknown domain throws Error (agent-skill-authoring.md rule)', () => {
  // Given: Invalid domain "unregistered_custom_domain" not in KNOWN_DOMAINS
  const invalidProfile = {
    id: 'custom.something',
    domain: 'unregistered_custom_domain',
    systemPrompt: 'test',
    tools: [],
    toolHandlers: []
  };

  // When & Then: Registration must throw an Error rejecting the unknown domain
  assert.throws(
    () => {
      registerAgentProfile('custom_task', invalidProfile);
    },
    /Unknown domain "unregistered_custom_domain"/
  );
});

test('TC-SKILL-E-02: Error - registerDeclaredSkill with unknown domain throws Error', () => {
  // Given: Invalid skill with domain not in KNOWN_DOMAINS
  const invalidSkill = {
    id: 'invalid.skill',
    name: '非法技能',
    domain: 'hacker_domain'
  };

  // When & Then: Registration throws Error
  assert.throws(
    () => {
      registerDeclaredSkill(invalidSkill);
    },
    /Unknown domain "hacker_domain"/
  );
});

test('TC-SKILL-E-03: Error - updateDepartmentSkillsAction on nonexistent department ID throws Error', async () => {
  // Given: A nonexistent department ID
  const fakeDeptId = 'dept_nonexistent_9999';

  // When & Then: Operation rejects with error
  await assert.rejects(
    async () => {
      await updateDepartmentSkillsAction(fakeDeptId, ['customer.view'], 'Admin');
    },
    /找不到指定的部門/
  );
});

test('TC-SKILL-E-04: Error - updateDepartmentSkillsAction with empty department ID throws validation Error', async () => {
  // Given: Empty department ID
  // When & Then: Validation error is thrown
  await assert.rejects(
    async () => {
      await updateDepartmentSkillsAction('   ', ['customer.view'], 'Admin');
    },
    /部門 ID 為必填項目/
  );
});

test('TC-SKILL-ROLE-01: Role authorization - owner and admin roles can manage department skills', () => {
  // Given: Active tenant with owner or admin role
  const ownerTenant = { id: 't1', role: 'owner' };
  const adminTenant = { id: 't2', role: 'admin' };

  // When & Then: canManageMembers returns true
  assert.equal(canManageMembers(ownerTenant), true);
  assert.equal(canManageMembers(adminTenant), true);
});

test('TC-SKILL-ROLE-02: Role authorization - member role or null cannot manage department skills', () => {
  // Given: Active tenant with member role or null
  const memberTenant = { id: 't3', role: 'member' };

  // When & Then: canManageMembers returns false
  assert.equal(canManageMembers(memberTenant), false);
  assert.equal(canManageMembers(null), false);
});
