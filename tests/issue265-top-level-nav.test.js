/**
 * @file issue265-top-level-nav.test.js
 * @description Automated test suite for Issue #265:
 * Dynamic loop rendering of topLevelNav items, icon whitelist lookup, and alias resolution.
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspectives Table (Equivalence Partitioning & Boundary Values)
 * | Case ID        | Input / Precondition                                                | Perspective (Equivalence / Boundary) | Expected Result                                              | Notes                 |
 * |:---------------|:--------------------------------------------------------------------|:--------------------------------------|:-------------------------------------------------------------|:----------------------|
 * | TC-NAV-N-01    | Default DOMAIN_MANIFESTS + CORE_ROUTES                              | Equivalence – Normal Nav List         | Exactly 7 topLevelNav routes with matching titles and icons  | Acceptance criteria 1 |
 * | TC-NAV-N-02    | Navigation click target lookup for each top-level route              | Equivalence – Canonical Route Path    | getWorkspaceRoutePath returns matching /app/* canonical path | Acceptance criteria 1 |
 * | TC-NAV-N-03    | ActiveTab matches standard workspace ID (e.g. 'vendor-bills')       | Equivalence – Active Matching         | isNavActive returns true for matching item, false for others | State consistency     |
 * | TC-NAV-N-04    | ActiveTab matches manifest aliases ('bills', 'inventory', 'quote')  | Equivalence – Alias Active Matching   | isNavActive dynamically resolves true via aliases array      | Core objective        |
 * | TC-NAV-N-05    | Injected manifest with topLevelNav: true                            | Equivalence – Dynamic Manifest Add    | getTopLevelNavRoutes automatically appends new nav item      | Acceptance criteria 2 |
 * | TC-NAV-N-06    | Injected manifest with topLevelNav: false                           | Equivalence – False Filtered          | getTopLevelNavRoutes does NOT include non-topLevelNav items  | Whitelist filter      |
 * | TC-NAV-B-01    | Custom manifests passed as empty array []                           | Boundary – Empty Array (0)            | Returns only core topLevelNav routes without throwing        | Defensive design      |
 * | TC-NAV-B-02    | Custom manifests passed as null or undefined                        | Boundary – NULL / Undefined           | Safely falls back to default DOMAIN_MANIFESTS routes        | Graceful fallback     |
 * | TC-NAV-B-03    | Icon.svelte queried with unknown, empty or whitespace icon name     | Boundary – Empty / Unknown Icon       | isKnownIcon returns false, getIcon returns undefined         | Injection defense     |
 * | TC-NAV-B-04    | isNavActive passed null, undefined, or empty inputs                 | Boundary – NULL / Undefined / Empty   | Safely returns false without throwing exceptions             | Robustness guard      |
 * | TC-NAV-B-05    | ActiveTab or route has leading/trailing whitespaces or hash prefix  | Boundary – Whitespace & Hash          | Trimmed/cleaned and matched against route / alias accurately  | Normalization         |
 * | TC-NAV-E-01    | Manifest with null/missing aliases or non-array aliases             | Error – Malformed Manifest Aliases    | Handled safely without runtime error                         | Fault tolerance       |
 * | TC-NAV-INT-01  | App.svelte source code inspection                                   | Integration – Loop & Icon Architecture| Loops with {#each topLevelNavItems}, uses <Icon />, < 500 lines| Architecture guard   |
 * | TC-NAV-INT-02  | Icon.svelte source code inspection                                  | Integration – Pure Declarative SVG    | Does not use {@html}, renders verified SVG paths per icon    | XSS prevention        |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnownIcon, getIcon, getIconSvg, KNOWN_ICONS } from '../src/lib/icons.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const appPath = path.join(rootDir, 'src/App.svelte');
const iconPath = path.join(rootDir, 'src/lib/components/Icon.svelte');
const routesPath = path.join(rootDir, 'src/lib/routes.js');
const routesDir = path.dirname(routesPath);

let routesSource = fs.readFileSync(routesPath, 'utf-8');
routesSource = routesSource.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+\.json)['"];/g, (_, varName, relPath) => {
  const jsonContent = fs.readFileSync(path.resolve(routesDir, relPath), 'utf-8');
  return `const ${varName} = ${jsonContent.trim()};`;
});
const routesDataUri = `data:text/javascript;base64,${Buffer.from(routesSource).toString('base64')}`;

const {
  DOMAIN_MANIFESTS,
  getTopLevelNavRoutes,
  TOP_LEVEL_NAV_ROUTES,
  getWorkspaceRoutePath,
  isNavActive
} = await import(routesDataUri);

test.describe('Issue #265: Top-Level Navigation Manifest-Driven Architecture', () => {

  test('TC-NAV-N-01: Exactly 11 top-level navigation routes are resolved with verified titles and icons', () => {
    // Given: Default system route configuration
    // When:  Resolving top-level navigation routes
    const routes = getTopLevelNavRoutes();

    // Then:  Exactly 11 top-level routes are generated (Agent + 6 domain manifests + 4 receivable workspaces)
    assert.strictEqual(routes.length, 11, 'Must generate exactly 11 top-level nav items');

    const expectedOrder = [
      { id: 'agent', label: 'AI 助理對話', icon: 'agent', path: '/app/agent' },
      { id: 'purchase-orders', label: '採購單', icon: 'shopping-bag', path: '/app/purchase-orders' },
      { id: 'vendor-bills', label: '請款單', icon: 'file-text', path: '/app/vendor-bills' },
      { id: 'warehouses', label: '倉庫管理', icon: 'warehouse', path: '/app/warehouses' },
      { id: 'accounts-payable', label: '應付帳款', icon: 'credit-card', path: '/app/accounts-payable' },
      { id: 'quotes', label: '報價單', icon: 'clipboard-list', path: '/app/quotes' },
      { id: 'sales-orders', label: '銷售單', icon: 'truck', path: '/app/sales-orders' },
      { id: 'customer-invoices', label: '銷項發票', icon: 'file-check', path: '/app/customer-invoices' },
      { id: 'accounts-receivable', label: '應收帳款', icon: 'clock', path: '/app/accounts-receivable' },
      { id: 'customer-credit', label: '客戶信用', icon: 'shield-check', path: '/app/customer-credit' },
      { id: 'customer-receipts', label: '客戶收款單', icon: 'receipt-card', path: '/app/customer-receipts' }
    ];

    routes.forEach((route, idx) => {
      const exp = expectedOrder[idx];
      assert.strictEqual(route.id, exp.id, `Route index [${idx}] ID mismatch`);
      assert.strictEqual(route.label, exp.label, `Route [${exp.id}] label mismatch`);
      assert.strictEqual(route.icon, exp.icon, `Route [${exp.id}] icon mismatch`);
      assert.strictEqual(route.path, exp.path, `Route [${exp.id}] path mismatch`);
      assert.strictEqual(route.topLevelNav, true, `Route [${exp.id}] topLevelNav must be true`);
      assert.ok(isKnownIcon(route.icon), `Route [${exp.id}] icon "${route.icon}" must be known in icon registry`);
    });

    // Also verify TOP_LEVEL_NAV_ROUTES constant export
    assert.strictEqual(TOP_LEVEL_NAV_ROUTES.length, 11);
  });

  test('TC-NAV-N-02: Navigation click target lookup resolves canonical route paths for all top-level routes', () => {
    // Given: Top-level navigation items
    const routes = getTopLevelNavRoutes();

    // When & Then: getWorkspaceRoutePath accurately maps each ID to its canonical path
    for (const route of routes) {
      const targetPath = getWorkspaceRoutePath(route.id);
      assert.strictEqual(targetPath, route.path, `getWorkspaceRoutePath('${route.id}') must return canonical path`);
    }
  });

  test('TC-NAV-N-03: isNavActive matches standard workspace IDs and route paths', () => {
    // Given: All default top-level navigation routes
    const routes = getTopLevelNavRoutes();
    const vendorBillsNav = routes.find(r => r.id === 'vendor-bills');
    const warehouseNav = routes.find(r => r.id === 'warehouses');

    // When:  Testing standard workspace IDs and routes
    // Then:  Matches correctly when active
    assert.strictEqual(isNavActive(vendorBillsNav, 'vendor-bills', '/app/vendor-bills'), true);
    assert.strictEqual(isNavActive(vendorBillsNav, 'vendor-bills'), true);
    assert.strictEqual(isNavActive(vendorBillsNav, null, '/app/vendor-bills'), true);
    assert.strictEqual(isNavActive(vendorBillsNav, 'warehouses'), false);
    assert.strictEqual(isNavActive(vendorBillsNav, 'accounts-payable', '/app/accounts-payable'), false);

    assert.strictEqual(isNavActive(warehouseNav, 'warehouses', '/app/warehouses'), true);
    assert.strictEqual(isNavActive(warehouseNav, 'vendor-bills'), false);
  });

  test('TC-NAV-N-04: isNavActive dynamically resolves manifest aliases without hardcoded conditions', () => {
    // Given: Top-level navigation items
    const routes = getTopLevelNavRoutes();
    const vendorBillsNav = routes.find(r => r.id === 'vendor-bills');
    const warehouseNav = routes.find(r => r.id === 'warehouses');
    const quotesNav = routes.find(r => r.id === 'quotes');
    const salesOrdersNav = routes.find(r => r.id === 'sales-orders');
    const customerInvoicesNav = routes.find(r => r.id === 'customer-invoices');
    const accountsReceivableNav = routes.find(r => r.id === 'accounts-receivable');
    const customerCreditNav = routes.find(r => r.id === 'customer-credit');
    const customerReceiptsNav = routes.find(r => r.id === 'customer-receipts');

    // When & Then: Aliases resolve true dynamically
    assert.strictEqual(isNavActive(vendorBillsNav, 'bills'), true, 'Alias "bills" must activate vendor-bills');
    assert.strictEqual(isNavActive(vendorBillsNav, 'vendor-bill'), true, 'Alias "vendor-bill" must activate vendor-bills');
    assert.strictEqual(isNavActive(vendorBillsNav, null, '/app/bills'), true, 'Path alias "/app/bills" must activate vendor-bills');

    assert.strictEqual(isNavActive(warehouseNav, 'inventory'), true, 'Alias "inventory" must activate warehouses');
    assert.strictEqual(isNavActive(warehouseNav, null, '/app/inventory'), true, 'Path alias "/app/inventory" must activate warehouses');

    assert.strictEqual(isNavActive(quotesNav, 'quote'), true, 'Alias "quote" must activate quotes');
    assert.strictEqual(isNavActive(quotesNav, null, '/app/quote'), true, 'Path alias "/app/quote" must activate quotes');

    assert.strictEqual(isNavActive(salesOrdersNav, 'sales-order'), true, 'Alias "sales-order" must activate sales-orders');
    assert.strictEqual(isNavActive(salesOrdersNav, null, '/app/sales-order'), true, 'Path alias "/app/sales-order" must activate sales-orders');

    assert.strictEqual(isNavActive(customerInvoicesNav, 'invoices'), true, 'Alias "invoices" must activate customer-invoices');
    assert.strictEqual(isNavActive(customerInvoicesNav, 'customer-invoice'), true, 'Alias "customer-invoice" must activate customer-invoices');
    assert.strictEqual(isNavActive(customerInvoicesNav, null, '/app/invoices'), true, 'Path alias "/app/invoices" must activate customer-invoices');

    assert.strictEqual(isNavActive(accountsReceivableNav, 'ar'), true, 'Alias "ar" must activate accounts-receivable');
    assert.strictEqual(isNavActive(accountsReceivableNav, null, '/app/ar'), true, 'Path alias "/app/ar" must activate accounts-receivable');

    assert.strictEqual(isNavActive(customerCreditNav, 'customer-credits'), true, 'Alias "customer-credits" must activate customer-credit');
    assert.strictEqual(isNavActive(customerCreditNav, null, '/app/customer-credits'), true, 'Path alias "/app/customer-credits" must activate customer-credit');

    assert.strictEqual(isNavActive(customerReceiptsNav, 'receipts'), true, 'Alias "receipts" must activate customer-receipts');
    assert.strictEqual(isNavActive(customerReceiptsNav, 'customerReceipts'), true, 'Alias "customerReceipts" must activate customer-receipts');
    assert.strictEqual(isNavActive(customerReceiptsNav, null, '/app/receipts'), true, 'Path alias "/app/receipts" must activate customer-receipts');
  });

  test('TC-NAV-N-05: Adding a new topLevelNav: true manifest item automatically appears without editing App.svelte', () => {
    // Given: An additional test manifest with topLevelNav: true
    const testManifest = {
      id: 'customModule',
      label: '自訂擴充模組',
      icon: 'file-check',
      route: '/app/custom-module',
      aliases: ['custom-module', 'customModule', '/app/custom-module'],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When:  Generating navigation routes with the injected manifest
    const extendedRoutes = getTopLevelNavRoutes([...DOMAIN_MANIFESTS, testManifest]);

    // Then:  Nav items automatically increment by 1 (11 -> 12) and contains the new module
    assert.strictEqual(extendedRoutes.length, 12, 'Must automatically expand to 12 navigation items');
    const addedItem = extendedRoutes.find(r => r.id === 'custom-module');
    assert.ok(addedItem, 'New top-level nav item must be present');
    assert.strictEqual(addedItem.label, '自訂擴充模組');
    assert.strictEqual(addedItem.icon, 'file-check');
    assert.strictEqual(addedItem.path, '/app/custom-module');
    assert.strictEqual(addedItem.topLevelNav, true);

    // Active state and alias test for dynamic item
    assert.strictEqual(isNavActive(addedItem, 'custom-module'), true);
    assert.strictEqual(isNavActive(addedItem, 'customModule'), true);
    assert.strictEqual(isNavActive(addedItem, 'other'), false);
  });

  test('TC-NAV-N-06: Manifest items with topLevelNav: false are excluded from top-level navigation', () => {
    // Given: Manifests with topLevelNav: false (e.g. departments, products, partners)
    const falseManifest = {
      id: 'subModule',
      label: '次級子模組',
      icon: 'truck',
      route: '/app/sub-module',
      aliases: ['sub-module'],
      entry: 'Workspace.svelte',
      topLevelNav: false
    };

    // When:  Generating navigation routes
    const routes = getTopLevelNavRoutes([...DOMAIN_MANIFESTS, falseManifest]);

    // Then:  The false item is filtered out and length remains 11
    assert.strictEqual(routes.length, 11);
    assert.strictEqual(routes.some(r => r.id === 'sub-module'), false);
  });

  // --- Boundary Cases ---

  test('TC-NAV-B-01: Empty manifests array [] returns only core top-level navigation items without throwing', () => {
    // Given: Empty manifests array []
    // When:  Calling getTopLevelNavRoutes([])
    const routes = getTopLevelNavRoutes([]);

    // Then:  Safely returns core (agent) + additional routes without throwing
    assert.strictEqual(Array.isArray(routes), true);
    assert.strictEqual(routes.length, 5); // 1 core + 4 additional
    assert.strictEqual(routes[0].id, 'agent');
  });

  test('TC-NAV-B-02: Null or undefined manifests input gracefully falls back to default DOMAIN_MANIFESTS', () => {
    // Given: Nullish inputs
    // When:  Calling getTopLevelNavRoutes with null or undefined
    const routesFromNull = getTopLevelNavRoutes(null);
    const routesFromUndefined = getTopLevelNavRoutes(undefined);

    // Then:  Both safely fall back to the 11 default routes
    assert.strictEqual(routesFromNull.length, 11);
    assert.strictEqual(routesFromUndefined.length, 11);
  });

  test('TC-NAV-B-03: Icon whitelist rejects unknown, empty or whitespace-only icon identifiers safely', () => {
    // Given: Invalid or unregistered icon identifiers
    // When & Then: Functions must safely return false / undefined without throwing
    assert.strictEqual(isKnownIcon('non-existent-icon'), false);
    assert.strictEqual(isKnownIcon(''), false);
    assert.strictEqual(isKnownIcon('   '), false);
    assert.strictEqual(isKnownIcon(null), false);
    assert.strictEqual(isKnownIcon(undefined), false);

    assert.strictEqual(getIcon('non-existent-icon'), undefined);
    assert.strictEqual(getIcon(''), undefined);
    assert.strictEqual(getIconSvg('non-existent-icon'), '');
  });

  test('TC-NAV-B-04: isNavActive handles null, undefined, or empty inputs safely without exceptions', () => {
    // Given: Nullish or invalid inputs
    // When & Then: Must safely return false
    assert.strictEqual(isNavActive(null, 'agent'), false);
    assert.strictEqual(isNavActive(undefined, 'agent'), false);
    assert.strictEqual(isNavActive({}, null, null), false);
    assert.strictEqual(isNavActive({ id: 'agent' }, '', ''), false);
    assert.strictEqual(isNavActive({ id: 'agent' }, null, undefined), false);
  });

  test('TC-NAV-B-05: isNavActive trims whitespaces and removes hash prefix properly', () => {
    // Given: Navigation item and inputs with whitespace / hash prefix
    const routes = getTopLevelNavRoutes();
    const vendorBillsNav = routes.find(r => r.id === 'vendor-bills');

    // When & Then: Normalized matching works accurately
    assert.strictEqual(isNavActive(vendorBillsNav, '  bills  '), true, 'Whitespace padded workspace string');
    assert.strictEqual(isNavActive(vendorBillsNav, null, ' #/app/vendor-bills '), true, 'Hash-prefixed and padded route');
    assert.strictEqual(isNavActive(vendorBillsNav, null, '/app/vendor-bills/details/123'), true, 'Subroute prefix matching');
  });

  // --- Error Cases ---

  test('TC-NAV-E-01: Malformed manifest with missing or non-array aliases handled safely', () => {
    // Given: Manifests with defective aliases
    const defectiveManifests = [
      {
        id: 'noAliases',
        label: '無別名模組',
        icon: 'truck',
        route: '/app/no-aliases',
        aliases: null,
        topLevelNav: true
      },
      {
        id: 'stringAliases',
        label: '字串別名模組',
        icon: 'warehouse',
        route: '/app/string-aliases',
        aliases: 'not-an-array',
        topLevelNav: true
      }
    ];

    // When:  Generating nav routes
    const routes = getTopLevelNavRoutes(defectiveManifests);

    // Then:  Must not throw and aliases defaulted to []
    assert.strictEqual(routes.length, 7); // 1 core + 4 additional + 2 dynamic
    const item1 = routes.find(r => r.id === 'noAliases');
    const item2 = routes.find(r => r.id === 'stringAliases');
    assert.deepStrictEqual(item1.aliases, []);
    assert.deepStrictEqual(item2.aliases, []);
    assert.strictEqual(isNavActive(item1, 'noAliases'), true);
    assert.strictEqual(isNavActive(item1, 'nonExistent'), false);
  });

  // --- Architecture & Integration Guards ---

  test('TC-NAV-INT-01: App.svelte line count is under 500 lines and uses {#each topLevelNavItems}', () => {
    // Given: App.svelte source content
    const appContent = fs.readFileSync(appPath, 'utf-8');
    const lineCount = appContent.split('\n').length;

    // Then:  Line count constraint (< 500 lines) is strictly maintained
    assert.ok(lineCount < 500, `App.svelte must be under 500 lines, current: ${lineCount}`);
    assert.ok(lineCount > 100, `App.svelte must retain shell skeleton, current: ${lineCount}`);

    // Verify dynamic loop and Icon component usage
    assert.match(appContent, /import\s+Icon\s+from\s+'\.\/lib\/components\/Icon\.svelte';/, 'App.svelte must import Icon component');
    assert.match(appContent, /import\s*\{[^}]*getTopLevelNavRoutes[^}]*\}\s*from\s*'\.\/lib\/routes\.js';/, 'App.svelte must import getTopLevelNavRoutes');
    assert.match(appContent, /import\s*\{[^}]*isNavActive[^}]*\}\s*from\s*'\.\/lib\/routes\.js';/, 'App.svelte must import isNavActive');
    assert.match(appContent, /\{#each\s+topLevelNavItems\s+as\s+nav\s*\(\s*nav\.id\s*\)\}/, 'App.svelte must iterate topLevelNavItems with keyed {#each}');
    assert.match(appContent, /<Icon\s+name=\{nav\.icon\}\s*\/>/, 'App.svelte must render <Icon name={nav.icon} />');

    // Verify hardcoded rail buttons and inline SVGs are completely removed
    assert.doesNotMatch(appContent, /id="rail-nav-purchase-orders"\s*>\s*<svg/, 'Hardcoded purchase-orders button SVG must be removed');
    assert.doesNotMatch(appContent, /activeTab === 'vendor-bills' \|\| activeTab === 'bills'/, 'Hardcoded vendor-bills alias check must be removed');
    assert.doesNotMatch(appContent, /activeTab === 'warehouses' \|\| activeTab === 'inventory'/, 'Hardcoded warehouses alias check must be removed');
    assert.doesNotMatch(appContent, /activeTab === 'quotes' \|\| activeTab === 'quote'/, 'Hardcoded quotes alias check must be removed');
    assert.doesNotMatch(appContent, /activeTab === 'sales-orders' \|\| activeTab === 'sales-order'/, 'Hardcoded sales-orders alias check must be removed');
  });

  test('TC-NAV-INT-02: Icon.svelte uses pure declarative SVG paths and contains no {@html} injection', () => {
    // Given: Icon.svelte source code
    const iconContent = fs.readFileSync(iconPath, 'utf-8');

    // Then:  Must not use {@html} to prevent untrusted markup injection
    assert.doesNotMatch(iconContent, /\{@html/, 'Icon.svelte must never use {@html} tag');

    // Must define declarative paths for all core icons
    for (const iconName of KNOWN_ICONS) {
      assert.ok(iconContent.includes(`name === '${iconName}'`), `Icon.svelte must handle icon "${iconName}" declaratively`);
    }
  });

});
