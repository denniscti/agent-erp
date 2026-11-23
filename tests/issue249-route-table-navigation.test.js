/**
 * @file issue249-route-table-navigation.test.js
 * @description Automated test suite for Issue #249: Central route registry (routes.js),
 * dynamic workspace resolution, and App.svelte shell skeleton refactoring.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-RT-N-01 | Path `/app/purchase-orders` | Equivalence – Purchase Orders Route | Resolves PurchaseOrdersWorkspace & label '採購單' | Primary workspace |
 * | TC-RT-N-02 | Path `/app/warehouses` | Equivalence – Warehouses Route | Resolves WarehouseWorkspace & label '倉庫管理' | Primary workspace |
 * | TC-RT-N-03 | Path `/app/vendor-bills` | Equivalence – Vendor Bills Route | Resolves VendorBillsWorkspace & label '請款單' | Primary workspace |
 * | TC-RT-N-04 | Path `/app/accounts-payable` | Equivalence – Accounts Payable Route | Resolves AccountsPayableWorkspace & label '應付帳款' | Primary workspace |
 * | TC-RT-N-05 | Path `/app/quotes` | Equivalence – Quotes Route | Resolves QuotesWorkspace & label '報價單' | Primary workspace |
 * | TC-RT-N-06 | Path `/app/sales-orders` | Equivalence – Sales Orders Route | Resolves SalesOrdersWorkspace & label '銷售單' | Primary workspace |
 * | TC-RT-N-07 | Path `/app/settings` | Equivalence – Settings Route | Resolves SettingsWorkspace & label '系統設定' | Primary workspace |
 * | TC-RT-N-08 | Path `/app/agent` | Equivalence – Agent Chat Route | Resolves ChatBox & label 'AI 助理對話' | Default workspace |
 * | TC-RT-N-09 | Path `/app/inventory-adjustments` | Equivalence – Subdomain Adjustments | Resolves InventoryAdjustmentsWorkspace & label '庫存調整' | Sub-domain workspace |
 * | TC-RT-N-10 | Path `/app/stocktakes` | Equivalence – Subdomain Stocktakes | Resolves StocktakesWorkspace & label '盤點管理' | Sub-domain workspace |
 * | TC-RT-N-11 | Path `/app/stock-transfers` | Equivalence – Subdomain Transfers | Resolves StockTransfersWorkspace & label '調撥管理' | Sub-domain workspace |
 * | TC-RT-N-12 | Path `/app/opening-payables` | Equivalence – Subdomain Opening AP | Resolves OpeningPayablesWorkspace & label '期初應付帳款' | Sub-domain workspace |
 * | TC-RT-N-13 | Path `/app/vendor-payments` | Equivalence – Subdomain Payments | Resolves VendorPaymentsWorkspace & label '付款單' | Sub-domain workspace |
 * | TC-RT-B-01 | Empty string `""` | Boundary – Empty input | Resolves default ChatBox component and default route | Safety guard |
 * | TC-RT-B-02 | `null` | Boundary – NULL input | Resolves default ChatBox component and default route | Safety guard |
 * | TC-RT-B-03 | `undefined` | Boundary – Undefined input | Resolves default ChatBox component and default route | Safety guard |
 * | TC-RT-B-04 | Whitespace string `"   "` | Boundary – Whitespace input | Resolves default ChatBox component and default route | Safety guard |
 * | TC-RT-B-05 | Non-string input (`123`, `{}`, `[]`) | Boundary – Invalid type input | Resolves default ChatBox component and default route | Safety guard |
 * | TC-RT-B-06 | Hash-prefixed string `#/app/settings` | Boundary – Hash router URL | Correctly trims hash and resolves SettingsWorkspace | Browser URL support |
 * | TC-RT-B-07 | Unknown route `/app/non-existent-domain` | Boundary – Unregistered route | Resolves fallback ChatBox and returns '業務工作區' label | Fallback defense |
 * | TC-RT-B-08 | Route with subpath `/app/purchase-orders/new?id=123` | Boundary – Subpath & query string | Extracts `/app/([^/?#]+)` and resolves PurchaseOrdersWorkspace | Deep link support |
 * | TC-RT-B-09 | Alias `'inventory'` and `'/app/inventory'` | Boundary – Historical alias | Resolves WarehouseWorkspace & label '庫存查詢' | Compatibility support |
 * | TC-RT-B-10 | Alias `'bills'` and `'/app/bills'` | Boundary – Route abbreviation | Resolves VendorBillsWorkspace & label '請款單' | Compatibility support |
 * | TC-RT-B-11 | Alias `'quote'` and `'/app/quote'` | Boundary – Route singular form | Resolves QuotesWorkspace & label '報價單' | Compatibility support |
 * | TC-RT-B-12 | Alias `'sales-order'` and `'/app/sales-order'` | Boundary – Route singular form | Resolves SalesOrdersWorkspace & label '銷售單' | Compatibility support |
 * | TC-RT-B-13 | Alias `'warehouse'` and `'/app/warehouse'` | Boundary – Route singular form | Resolves WarehouseWorkspace & label '倉庫管理' | Compatibility support |
 * | TC-RT-B-14 | Canonical path helper `getWorkspaceRoutePath` | Boundary – Path helper across keys | Resolves `/app/inventory`, canonical paths, and defaults | Path utility |
 * | TC-RT-INT-01 | `App.svelte` line count reduction verification | Integration – God-file decomposition | Line count reduced from 3241 to under 500 lines | Acceptance criteria |
 * | TC-RT-INT-02 | `App.svelte` architecture inspection | Integration – Shell skeleton check | Uses `resolveRouteComponent` and contains no inline settings cards | Architecture check |
 * | TC-RT-INT-03 | `routes.js` registry structure inspection | Integration – Contract validation | Exports 13 distinct routes with required metadata properties | Registry check |
 * | TC-RT-INT-04 | Settings workspace imports verification | Integration – Authentication action bindings | `Workspace.svelte` imports `logoutAction` & `simulateTokenExpiry` | Zero regression |
 * | TC-RT-INT-05 | Vendor bills rail icon SVG path validity | Integration – UI Shell precision | Path defines valid arc syntax `0 0 0 2-2V8z` | SVG fidelity |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Polyfill Svelte 5 runes for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}
if (typeof globalThis.$derived === 'undefined') {
  globalThis.$derived = (fn) => typeof fn === 'function' ? fn() : fn;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const appPath = path.join(rootDir, 'src/App.svelte');
const routesPath = path.join(rootDir, 'src/lib/routes.js');
const routesDir = path.dirname(routesPath);
let routesSource = fs.readFileSync(routesPath, 'utf-8');
routesSource = routesSource.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+\.json)['"];/g, (_, varName, relPath) => {
  const jsonContent = fs.readFileSync(path.resolve(routesDir, relPath), 'utf-8');
  return `const ${varName} = ${jsonContent.trim()};`;
});
const routesDataUri = `data:text/javascript;base64,${Buffer.from(routesSource).toString('base64')}`;

const {
  ROUTES,
  DEFAULT_ROUTE,
  getRoute,
  resolveRouteComponent,
  getRouteLabel,
  getWorkspaceRoutePath
} = await import(routesDataUri);

const { getWorkspaceLabel } = await import('../src/lib/store.svelte.js');

// --- 1. Normal Cases: Domain Workspace Resolution ---

test('TC-RT-N-01: Resolves PurchaseOrdersWorkspace and label for /app/purchase-orders', () => {
  // Given: Route path for purchase orders
  const routePath = '/app/purchase-orders';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'PurchaseOrdersWorkspace', 'Component must be PurchaseOrdersWorkspace');
  assert.equal(label, '採購單', 'Label must be 採購單');
});

test('TC-RT-N-02: Resolves WarehouseWorkspace and label for /app/warehouses', () => {
  // Given: Route path for warehouses
  const routePath = '/app/warehouses';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'WarehouseWorkspace', 'Component must be WarehouseWorkspace');
  assert.equal(label, '倉庫管理', 'Label must be 倉庫管理');
});

test('TC-RT-N-03: Resolves VendorBillsWorkspace and label for /app/vendor-bills', () => {
  // Given: Route path for vendor bills
  const routePath = '/app/vendor-bills';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'VendorBillsWorkspace', 'Component must be VendorBillsWorkspace');
  assert.equal(label, '請款單', 'Label must be 請款單');
});

test('TC-RT-N-04: Resolves AccountsPayableWorkspace and label for /app/accounts-payable', () => {
  // Given: Route path for accounts payable
  const routePath = '/app/accounts-payable';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'AccountsPayableWorkspace', 'Component must be AccountsPayableWorkspace');
  assert.equal(label, '應付帳款', 'Label must be 應付帳款');
});

test('TC-RT-N-05: Resolves QuotesWorkspace and label for /app/quotes', () => {
  // Given: Route path for quotes
  const routePath = '/app/quotes';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'QuotesWorkspace', 'Component must be QuotesWorkspace');
  assert.equal(label, '報價單', 'Label must be 報價單');
});

test('TC-RT-N-06: Resolves SalesOrdersWorkspace and label for /app/sales-orders', () => {
  // Given: Route path for sales orders
  const routePath = '/app/sales-orders';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'SalesOrdersWorkspace', 'Component must be SalesOrdersWorkspace');
  assert.equal(label, '銷售單', 'Label must be 銷售單');
});

test('TC-RT-N-07: Resolves SettingsWorkspace and label for /app/settings', () => {
  // Given: Route path for settings
  const routePath = '/app/settings';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'SettingsWorkspace', 'Component must be SettingsWorkspace');
  assert.equal(label, '系統設定', 'Label must be 系統設定');
});

test('TC-RT-N-08: Resolves ChatBox and label for /app/agent', () => {
  // Given: Route path for AI agent chat
  const routePath = '/app/agent';

  // When:  Resolving route component and label
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Correct workspace component and label returned
  assert.equal(component.name, 'ChatBox', 'Component must be ChatBox');
  assert.equal(label, 'AI 助理對話', 'Label must be AI 助理對話');
});

test('TC-RT-N-09: Resolves InventoryAdjustmentsWorkspace for /app/inventory-adjustments', () => {
  // Given: Subdomain route path
  const routePath = '/app/inventory-adjustments';

  // When:  Resolving route
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Matches dedicated subdomain component
  assert.equal(component.name, 'InventoryAdjustmentsWorkspace');
  assert.equal(label, '庫存調整');
});

test('TC-RT-N-10: Resolves StocktakesWorkspace for /app/stocktakes', () => {
  // Given: Subdomain route path
  const routePath = '/app/stocktakes';

  // When:  Resolving route
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Matches dedicated subdomain component
  assert.equal(component.name, 'StocktakesWorkspace');
  assert.equal(label, '盤點管理');
});

test('TC-RT-N-11: Resolves StockTransfersWorkspace for /app/stock-transfers', () => {
  // Given: Subdomain route path
  const routePath = '/app/stock-transfers';

  // When:  Resolving route
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Matches dedicated subdomain component
  assert.equal(component.name, 'StockTransfersWorkspace');
  assert.equal(label, '調撥管理');
});

test('TC-RT-N-12: Resolves OpeningPayablesWorkspace for /app/opening-payables', () => {
  // Given: Subdomain route path
  const routePath = '/app/opening-payables';

  // When:  Resolving route
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Matches dedicated subdomain component
  assert.equal(component.name, 'OpeningPayablesWorkspace');
  assert.equal(label, '期初應付帳款');
});

test('TC-RT-N-13: Resolves VendorPaymentsWorkspace for /app/vendor-payments', () => {
  // Given: Subdomain route path
  const routePath = '/app/vendor-payments';

  // When:  Resolving route
  const component = resolveRouteComponent(routePath);
  const label = getRouteLabel(routePath);

  // Then:  Matches dedicated subdomain component
  assert.equal(component.name, 'VendorPaymentsWorkspace');
  assert.equal(label, '付款單');
});

// --- 2. Boundary and Failure Cases ---

test('TC-RT-B-01: Empty string input safely falls back to default route', () => {
  // Given: Empty string
  const input = '';

  // When:  Resolving route and component
  const route = getRoute(input);
  const component = resolveRouteComponent(input);

  // Then:  Falls back to DEFAULT_ROUTE and ChatBox
  assert.equal(route.id, DEFAULT_ROUTE.id);
  assert.equal(component.name, 'ChatBox');
});

test('TC-RT-B-02: NULL input safely falls back to default route', () => {
  // Given: NULL input
  const input = null;

  // When:  Resolving route and component
  const route = getRoute(input);
  const component = resolveRouteComponent(input);

  // Then:  Falls back to DEFAULT_ROUTE and ChatBox
  assert.equal(route.id, DEFAULT_ROUTE.id);
  assert.equal(component.name, 'ChatBox');
});

test('TC-RT-B-03: Undefined input safely falls back to default route', () => {
  // Given: Undefined input
  const input = undefined;

  // When:  Resolving route and component
  const route = getRoute(input);
  const component = resolveRouteComponent(input);

  // Then:  Falls back to DEFAULT_ROUTE and ChatBox
  assert.equal(route.id, DEFAULT_ROUTE.id);
  assert.equal(component.name, 'ChatBox');
});

test('TC-RT-B-04: Whitespace-only input safely falls back to default route', () => {
  // Given: Whitespace string
  const input = '    ';

  // When:  Resolving route and component
  const route = getRoute(input);
  const component = resolveRouteComponent(input);

  // Then:  Falls back to DEFAULT_ROUTE and ChatBox
  assert.equal(route.id, DEFAULT_ROUTE.id);
  assert.equal(component.name, 'ChatBox');
});

test('TC-RT-B-05: Non-string inputs safely fall back to default route', () => {
  // Given: Various invalid data types
  const inputs = [123, 0, {}, [], true];

  // When & Then: Each input safely returns DEFAULT_ROUTE and ChatBox
  for (const input of inputs) {
    assert.equal(getRoute(input).id, DEFAULT_ROUTE.id, `Input ${String(input)} must resolve to DEFAULT_ROUTE`);
    assert.equal(resolveRouteComponent(input).name, 'ChatBox', `Input ${String(input)} must resolve to ChatBox`);
  }
});

test('TC-RT-B-06: Hash-prefixed string is cleaned and resolved properly', () => {
  // Given: Hash router URL string
  const hashUrl = '#/app/settings';

  // When:  Resolving component and label
  const component = resolveRouteComponent(hashUrl);
  const label = getRouteLabel(hashUrl);

  // Then:  Resolves to SettingsWorkspace
  assert.equal(component.name, 'SettingsWorkspace');
  assert.equal(label, '系統設定');
});

test('TC-RT-B-07: Unknown or arbitrary route returns fallback component and label', () => {
  // Given: Unknown workspace route
  const unknownRoute = '/app/non-existent-domain';

  // When:  Resolving component and label
  const component = resolveRouteComponent(unknownRoute);
  const label = getRouteLabel(unknownRoute);
  const storeLabel = getWorkspaceLabel('non-existent-domain');

  // Then:  Component falls back to ChatBox, labels fall back to 業務工作區
  assert.equal(component.name, 'ChatBox', 'Unknown route component falls back to ChatBox');
  assert.equal(label, '業務工作區', 'routes.js label falls back to 業務工作區');
  assert.equal(storeLabel, '業務工作區', 'store.svelte.js label falls back to 業務工作區');
});

test('TC-RT-B-08: Subpaths with query strings resolve correctly by /app/ prefix', () => {
  // Given: Route containing subpath and query parameters
  const subpath = '/app/purchase-orders/new?id=123&action=edit';

  // When:  Resolving component and label
  const component = resolveRouteComponent(subpath);
  const label = getRouteLabel(subpath);

  // Then:  Resolves to purchase orders
  assert.equal(component.name, 'PurchaseOrdersWorkspace');
  assert.equal(label, '採購單');
});

test('TC-RT-B-09: Alias inventory and /app/inventory resolve to WarehouseWorkspace with 庫存查詢 label', () => {
  // Given: Historical inventory route aliases
  const aliases = ['inventory', '/app/inventory'];

  for (const a of aliases) {
    // When:  Resolving component and labels
    const component = resolveRouteComponent(a);
    const routeLabel = getRouteLabel(a);
    const storeLabel = getWorkspaceLabel(a);

    // Then:  Component is WarehouseWorkspace and label is 庫存查詢
    assert.equal(component.name, 'WarehouseWorkspace', `Alias ${a} must resolve to WarehouseWorkspace`);
    assert.equal(routeLabel, '庫存查詢', `Route label for ${a} must be 庫存查詢`);
    assert.equal(storeLabel, '庫存查詢', `Store label for ${a} must be 庫存查詢`);
  }
});

test('TC-RT-B-10: Alias bills and /app/bills resolve to VendorBillsWorkspace', () => {
  // Given: Vendor bills aliases
  const aliases = ['bills', 'vendor-bill', '/app/bills'];

  for (const a of aliases) {
    // When:  Resolving component
    const component = resolveRouteComponent(a);

    // Then:  Component is VendorBillsWorkspace
    assert.equal(component.name, 'VendorBillsWorkspace', `Alias ${a} must resolve to VendorBillsWorkspace`);
  }
});

test('TC-RT-B-11: Alias quote and /app/quote resolve to QuotesWorkspace', () => {
  // Given: Quotes singular aliases
  const aliases = ['quote', '/app/quote'];

  for (const a of aliases) {
    // When:  Resolving component
    const component = resolveRouteComponent(a);

    // Then:  Component is QuotesWorkspace
    assert.equal(component.name, 'QuotesWorkspace', `Alias ${a} must resolve to QuotesWorkspace`);
  }
});

test('TC-RT-B-12: Alias sales-order and /app/sales-order resolve to SalesOrdersWorkspace', () => {
  // Given: Sales orders singular aliases
  const aliases = ['sales-order', '/app/sales-order'];

  for (const a of aliases) {
    // When:  Resolving component
    const component = resolveRouteComponent(a);

    // Then:  Component is SalesOrdersWorkspace
    assert.equal(component.name, 'SalesOrdersWorkspace', `Alias ${a} must resolve to SalesOrdersWorkspace`);
  }
});

test('TC-RT-B-13: Alias warehouse and /app/warehouse resolve to WarehouseWorkspace', () => {
  // Given: Warehouses singular aliases
  const aliases = ['warehouse', '/app/warehouse'];

  for (const a of aliases) {
    // When:  Resolving component
    const component = resolveRouteComponent(a);

    // Then:  Component is WarehouseWorkspace
    assert.equal(component.name, 'WarehouseWorkspace', `Alias ${a} must resolve to WarehouseWorkspace`);
  }
});

test('TC-RT-B-14: getWorkspaceRoutePath returns canonical path for valid, aliased, and invalid inputs', () => {
  // Given: Various workspace keys
  // When & Then: Canonical routes resolved
  assert.equal(getWorkspaceRoutePath('purchase-orders'), '/app/purchase-orders');
  assert.equal(getWorkspaceRoutePath('settings'), '/app/settings');
  assert.equal(getWorkspaceRoutePath('inventory'), '/app/inventory');
  assert.equal(getWorkspaceRoutePath('quote'), '/app/quotes');
  assert.equal(getWorkspaceRoutePath(''), '/app/agent');
  assert.equal(getWorkspaceRoutePath(null), '/app/agent');
});

// --- 3. Architecture & Integration Verifications ---

test('TC-RT-INT-01: App.svelte line count drops significantly from 3241 to under 500 lines', () => {
  // Given: App.svelte file content
  const appContent = fs.readFileSync(appPath, 'utf-8');
  const lineCount = appContent.split('\n').length;

  // When:  Evaluating line count
  // Then:  Line count must be under 500 lines (down from 3241 lines, ~85% drop)
  assert.ok(lineCount < 500, `App.svelte must be under 500 lines, current: ${lineCount}`);
  assert.ok(lineCount > 100, `App.svelte must retain shell skeleton, current: ${lineCount}`);
});

test('TC-RT-INT-02: App.svelte uses resolveRouteComponent and delegates settings to SettingsWorkspace', () => {
  // Given: App.svelte file content
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // When:  Inspecting imports and template structure
  // Then:  Uses route table and does not retain inline settings cards
  assert.match(appContent, /import\s*\{\s*resolveRouteComponent\s*\}\s*from\s*'\.\/lib\/routes\.js';/, 'App.svelte must import resolveRouteComponent');
  assert.match(appContent, /<ActiveWorkspace\s*\/>/, 'App.svelte must render dynamic <ActiveWorkspace />');
  assert.doesNotMatch(appContent, /<SettingsEntityCard/, 'App.svelte must not contain inline SettingsEntityCard markup');
  assert.doesNotMatch(appContent, /function handleOnboardMember/, 'App.svelte must not contain member handlers');
  assert.doesNotMatch(appContent, /function handleCreateDepartment/, 'App.svelte must not contain department handlers');
});

test('TC-RT-INT-03: routes.js registry registers all 13 core and sub-domain routes with contract compliance', () => {
  // Given: ROUTES registry
  // When:  Inspecting registered items
  // Then:  All 13 routes defined with valid properties
  assert.ok(ROUTES.length >= 13, 'Must define at least 13 route entries');

  const requiredIds = [
    'agent',
    'settings',
    'purchase-orders',
    'warehouses',
    'vendor-bills',
    'accounts-payable',
    'quotes',
    'sales-orders',
    'inventory-adjustments',
    'stocktakes',
    'stock-transfers',
    'opening-payables',
    'vendor-payments'
  ];

  for (const id of requiredIds) {
    const route = ROUTES.find(r => r.id === id);
    assert.ok(route, `Route ${id} must exist in ROUTES`);
    assert.ok(typeof route.path === 'string' && route.path.startsWith('/app/'), `Route ${id} path must start with /app/`);
    assert.ok(route.component, `Route ${id} must specify a Svelte component`);
    assert.ok(typeof route.label === 'string' && route.label.length > 0, `Route ${id} must specify a label`);
  }
});

test('TC-RT-INT-04: SettingsWorkspace imports logoutAction and simulateTokenExpiry to avoid ReferenceError', () => {
  // Given: src/lib/settings/Workspace.svelte source code
  const settingsPath = path.join(rootDir, 'src/lib/settings/Workspace.svelte');
  const settingsContent = fs.readFileSync(settingsPath, 'utf-8');

  // When:  Inspecting imports
  // Then:  Must import logoutAction and simulateTokenExpiry from store.svelte.js
  assert.match(settingsContent, /logoutAction/, 'Workspace.svelte must import logoutAction');
  assert.match(settingsContent, /simulateTokenExpiry/, 'Workspace.svelte must import simulateTokenExpiry');
  assert.match(settingsContent, /onclick=\{logoutAction\}/, 'Workspace.svelte must bind onclick to logoutAction');
  assert.match(settingsContent, /onclick=\{simulateTokenExpiry\}/, 'Workspace.svelte must bind onclick to simulateTokenExpiry');
});

test('TC-RT-INT-05: App.svelte vendor bills rail nav icon has valid SVG path syntax', () => {
  // Given: src/App.svelte source code
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // When:  Inspecting vendor bills icon SVG markup
  // Then:  Must contain valid arc sweep-flag syntax `0 0 0 2-2V8z`
  assert.match(
    appContent,
    /<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"><\/path>/,
    'Vendor bills icon path must contain valid arc with sweep-flag 0'
  );
  assert.doesNotMatch(
    appContent,
    /h12a2 2 0 0 2-2V8z/,
    'Must not contain corrupted arc syntax without sweep-flag'
  );
});
