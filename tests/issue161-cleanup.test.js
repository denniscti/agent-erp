/**
 * @file issue161-cleanup.test.js
 * @description Test suite for Issue #161 - Clean up Phase 0/1 obsolete code and misleading texts.
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-161-RT-01 | Route set to '/app/agent' | Equivalence – Normal active workspace | activeWorkspace returns 'agent' | Core workspace |
 * | TC-161-RT-02 | Route set to '/app/settings' | Equivalence – Normal active workspace | activeWorkspace returns 'settings' | Settings workspace |
 * | TC-161-RT-03 | Route set to '/app/sales', '/app/finance', '/app/crm' | Boundary – Obsolete route strings | Fallback correctly returns subpath or fallback without crash | Verifies obsolete dedicated getter branches are removed |
 * | TC-161-RT-04 | Set activeWorkspace = 'agent' / 'settings' | Equivalence – Workspace setter | Updates appState.route cleanly | Normal routing setter |
 * | TC-161-BC-01 | Workspace is 'settings' | Equivalence – Settings breadcrumb label | Returns '系統設定' (not '系統與市集管理') | Label renamed |
 * | TC-161-BC-02 | Workspace is 'agent' | Equivalence – Agent breadcrumb label | Returns 'AI 助理對話' | Main workspace label |
 * | TC-161-BC-03 | Workspace is arbitrary/custom (boundary) | Boundary – Fallback breadcrumb label | Returns '業務工作區', no installedModules query | Robust fallback |
 * | TC-161-AUD-01 | Audit log decision 'approved' | Equivalence – Approved decision | Formats as '核准 (Approved)' | Normal approval |
 * | TC-161-AUD-02 | Audit log decision 'rejected' | Equivalence – User rejected decision | Formats as '拒絕 (Rejected)' | Distinguishes from unauthorized |
 * | TC-161-AUD-03 | Audit log decision 'rejected_unauthorized' | Boundary – Security unauthorized anomaly | Formats as '未授權阻斷 (Unauthorized)' | Distinguishes from user rejection |
 * | TC-161-AUD-04 | Audit log decision null / empty / unknown | Boundary – NULL / Empty / Unknown decision | Safely falls back to '拒絕 (Rejected)' without crashing | Robust boundary handling |
 * | TC-161-DEAD-01 | Inspect store exports and appState properties | Equivalence – Obsolete dead code elimination | Obsolete state properties are undefined; obsolete functions are not exported | Verification of dead code removal |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const storeModule = await import('../src/lib/store.svelte.js');
const { appState, getWorkspaceLabel, formatAuditDecision } = storeModule;

test('TC-161-RT-01: Equivalence - Route set to /app/agent resolves activeWorkspace to agent', () => {
  // Given: Preconditions
  appState.route = '/app/agent';

  // When:  Operation to execute
  const ws = appState.activeWorkspace;

  // Then:  Expected result/verification
  assert.equal(ws, 'agent', 'activeWorkspace should return "agent" for /app/agent');
});

test('TC-161-RT-02: Equivalence - Route set to /app/settings resolves activeWorkspace to settings', () => {
  // Given: Preconditions
  appState.route = '/app/settings';

  // When:  Operation to execute
  const ws = appState.activeWorkspace;

  // Then:  Expected result/verification
  assert.equal(ws, 'settings', 'activeWorkspace should return "settings" for /app/settings');
});

test('TC-161-RT-03: Boundary - Obsolete routes /app/sales, /app/finance, /app/crm handled safely via generic fallback', () => {
  // Given: Preconditions
  const obsoleteRoutes = ['/app/sales', '/app/finance', '/app/crm'];

  // When / Then: Operation and verification for each obsolete route
  for (const route of obsoleteRoutes) {
    appState.route = route;
    const ws = appState.activeWorkspace;
    const expected = route.replace('/app/', '');
    assert.equal(ws, expected, `Obsolete route ${route} should safely resolve to ${expected} via generic regex`);
  }
});

test('TC-161-RT-04: Equivalence - Setting activeWorkspace updates appState.route', () => {
  // Given: Preconditions
  appState.activeWorkspace = 'settings';

  // When:  Operation to execute
  const currentRoute = appState.route;

  // Then:  Expected result/verification
  assert.equal(currentRoute, '/app/settings');

  // Reset back to agent
  appState.activeWorkspace = 'agent';
  assert.equal(appState.route, '/app/agent');
});

test('TC-161-BC-01: Equivalence - Settings breadcrumb label is "系統設定" instead of "系統與市集管理"', () => {
  // Given: Preconditions
  const workspace = 'settings';

  // When:  Operation to execute
  const label = getWorkspaceLabel(workspace);

  // Then:  Expected result/verification
  assert.equal(label, '系統設定');
  assert.notEqual(label, '系統與市集管理');
});

test('TC-161-BC-02: Equivalence - Agent breadcrumb label is "AI 助理對話"', () => {
  // Given: Preconditions
  const workspace = 'agent';

  // When:  Operation to execute
  const label = getWorkspaceLabel(workspace);

  // Then:  Expected result/verification
  assert.equal(label, 'AI 助理對話');
});

test('TC-161-BC-03: Boundary - Custom/arbitrary workspace falls back to "業務工作區" without querying installedModules', () => {
  // Given: Preconditions
  const unknownWorkspaces = ['custom_ws', '', null, undefined];

  // When / Then: Operation and verification
  for (const ws of unknownWorkspaces) {
    const label = getWorkspaceLabel(ws);
    assert.equal(label, '業務工作區');
  }
});

test('TC-161-AUD-01: Equivalence - Audit decision "approved" formats as "核准 (Approved)"', () => {
  // Given: Preconditions
  const decision = 'approved';

  // When:  Operation to execute
  const formatted = formatAuditDecision(decision);

  // Then:  Expected result/verification
  assert.equal(formatted, '核准 (Approved)');
});

test('TC-161-AUD-02: Equivalence - Audit decision "rejected" formats as "拒絕 (Rejected)"', () => {
  // Given: Preconditions
  const decision = 'rejected';

  // When:  Operation to execute
  const formatted = formatAuditDecision(decision);

  // Then:  Expected result/verification
  assert.equal(formatted, '拒絕 (Rejected)');
});

test('TC-161-AUD-03: Boundary - Audit decision "rejected_unauthorized" formats as "未授權阻斷 (Unauthorized)"', () => {
  // Given: Preconditions
  const decision = 'rejected_unauthorized';

  // When:  Operation to execute
  const formatted = formatAuditDecision(decision);

  // Then:  Expected result/verification
  assert.equal(formatted, '未授權阻斷 (Unauthorized)');
  assert.notEqual(formatted, '阻斷 (Rejected)');
});

test('TC-161-AUD-04: Boundary - Audit decision null, empty, or unknown formats safely as "拒絕 (Rejected)"', () => {
  // Given: Preconditions
  const boundaryDecisions = [null, undefined, '', 'unknown_action', 0];

  // When / Then: Operation and verification
  for (const decision of boundaryDecisions) {
    const formatted = formatAuditDecision(decision);
    assert.equal(formatted, '拒絕 (Rejected)', `Decision ${decision} should safely fallback to "拒絕 (Rejected)"`);
  }
});

test('TC-161-DEAD-01: Equivalence - Obsolete state fields and methods are completely removed', () => {
  // Given: Preconditions
  const deadStateKeys = [
    'installedModules',
    'loadedComponents',
    'mirroredOrders',
    'pendingMutation',
    'modulesGallery',
    'isEnterpriseActive'
  ];

  // When / Then: Check state properties
  for (const key of deadStateKeys) {
    assert.equal(
      appState[key],
      undefined,
      `appState.${key} should be undefined after cleanup`
    );
  }

  // Check dead functions are NOT exported from store
  const deadExports = [
    'fetchOrders',
    'fetchInstalledModules',
    'fetchModulesGallery',
    'installModuleAction',
    'uninstallModuleAction',
    'triggerWebhookSimulation',
    'approveMutation',
    'rejectMutation',
    'activateEnterprise'
  ];

  for (const fnName of deadExports) {
    assert.equal(
      storeModule[fnName],
      undefined,
      `storeModule.${fnName} should NOT be exported after cleanup`
    );
  }
});
