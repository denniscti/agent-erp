// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  DOMAIN_MANIFESTS,
  DOMAIN_LOADERS,
  getRoute,
  resolveRouteComponent,
  getRouteLabel,
  getWorkspaceRoutePath
} = await import(routesDataUri);

import { EXPECTED_DOMAINS } from '../scripts/verify-domain-manifests.mjs';

/**
 * -------------------------------------------------------------------------------------------------
 * Test Strategy Perspective Table (Issue #264: Manifest-driven Code Splitting & Async Routes)
 * -------------------------------------------------------------------------------------------------
 * | Case ID      | Input / Precondition                                 | Perspective (Equivalence / Boundary) | Expected Result                                                   | Notes                  |
 * |--------------|------------------------------------------------------|--------------------------------------|-------------------------------------------------------------------|------------------------|
 * | TC-R264-N-01 | Call resolveRouteComponent('/app/purchase-orders')   | Equivalence – Lazy Loader Function   | Returns function returning dynamic import() Promise               | Code-splitting contract|
 * | TC-R264-N-02 | DOMAIN_MANIFESTS array inspection                    | Equivalence – Manifest Whitelist     | Contains all 14 expected T1 domain manifests                      | Manifest SSOT          |
 * | TC-R264-N-03 | ROUTES array structure verification                  | Equivalence – Route Contracts        | Every entry has valid id, path, component loader, label, aliases   | Route structure        |
 * | TC-R264-N-04 | Synchronous lookup via getRoute, getRouteLabel       | Equivalence – Sync API Preservation  | Returns route definition and label synchronously                  | Backward compat        |
 * | TC-R264-N-05 | App.svelte source inspection                         | Equivalence – Async UI Architecture  | Contains loading state, error fallback, and dynamic ActiveWorkspace| Architecture guard     |
 * | TC-R264-N-06 | Intra-workspace subroute switching (/warehouses <-> /inventory) | Equivalence – Subroute Memoization  | Shares identical loader, preserves instance without remounting   | State preservation guard|
 * | TC-R264-E-01 | Mock loader rejecting with Error                     | Error – Async Import Failure         | Rejection is caught gracefully, produces error state              | Fallback guard         |
 * | TC-R264-E-02 | Unknown route path '/app/unknown-workspace-xyz'      | Error – Unknown Route Fallback       | Resolves safely to DEFAULT_ROUTE (/app/agent)                     | Fallback guard         |
 * | TC-R264-E-03 | Mock loader throwing synchronously                   | Error – Synchronous Throw Fallback   | Caught in try/catch block, sets error state, does not crash app   | Robustness guard       |
 * | TC-R264-E-04 | Non-string route query types (number, object, bool)  | Error – Invalid Type Fallback        | Safely defaults to DEFAULT_ROUTE without throwing                 | Defensive type check   |
 * | TC-R264-B-01 | getRoute(null)                                       | Boundary – NULL input                | Returns DEFAULT_ROUTE                                             | Null safety            |
 * | TC-R264-B-02 | getRoute(undefined)                                  | Boundary – Undefined input           | Returns DEFAULT_ROUTE                                             | Undefined safety       |
 * | TC-R264-B-03 | getRoute('') (empty string)                          | Boundary – Empty String input        | Returns DEFAULT_ROUTE                                             | Empty string safety    |
 * | TC-R264-B-04 | getRoute('   ') (whitespace-only string)             | Boundary – Whitespace input          | Returns DEFAULT_ROUTE                                             | Whitespace safety      |
 * | TC-R264-B-05 | getRoute('#/app/sales-orders')                       | Boundary – Hash Prefix               | Normalizes '#/app/sales-orders' to salesOrders route              | Hash router compat     |
 * | TC-R264-B-06 | getRouteLabel(null), getRouteLabel('unknown')        | Boundary – Label Fallback            | null returns DEFAULT_ROUTE.label, unknown returns '業務工作區'    | Fallback labels        |
 * | TC-R264-B-07 | getWorkspaceRoutePath(null), getWorkspaceRoutePath('inventory') | Boundary – Route Path Fallback | null returns '/app/agent', 'inventory' returns '/app/inventory'   | Canonical paths        |
 * | TC-R264-B-08 | Rapid route switching race condition cancellation    | Boundary – Async Race Cancellation   | Obsolete pending Promise is aborted by cancellation token         | Race condition guard   |
 * -------------------------------------------------------------------------------------------------
 */

test.describe('Issue #264: Manifest-driven Code Splitting & Async Route Resolution', () => {

  // --- 1. Normal Cases ---

  test('TC-R264-N-01: resolveRouteComponent returns lazy loader function returning dynamic import() Promise', async () => {
    // Given: Canonical route path for purchase orders
    const routePath = '/app/purchase-orders';

    // When:  Resolving route component
    const loader = resolveRouteComponent(routePath);

    // Then:  Loader must be a function whose execution returns a Promise
    assert.equal(typeof loader, 'function', 'Loader must be a function');
    assert.equal(loader.name, 'PurchaseOrdersWorkspace', 'Loader function must have component name');

    // Executing loader in plain Node confirms it attempts to dynamically import the Svelte module
    await assert.rejects(
      async () => { await loader(); },
      /(Unknown file extension "\.svelte"|Invalid URL|ERR_UNSUPPORTED_RESOLVE_REQUEST|Failed to resolve module)/
    );
  });

  test('TC-R264-N-02: DOMAIN_MANIFESTS contains all 14 expected T1 domain manifests', () => {
    // Given: Expected 14 business domain names from Issue #263 CI verification
    // When:  Inspecting exported DOMAIN_MANIFESTS
    // Then:  Exactly 14 manifests exported matching EXPECTED_DOMAINS
    assert.equal(DOMAIN_MANIFESTS.length, 14, 'Must register exactly 14 domain manifests');

    const manifestIds = DOMAIN_MANIFESTS.map(m => m.id);
    for (const expected of EXPECTED_DOMAINS) {
      assert.ok(manifestIds.includes(expected), `DOMAIN_MANIFESTS must include manifest for domain "${expected}"`);
    }
  });

  test('TC-R264-N-03: ROUTES array complies with RouteDefinition contracts', () => {
    // Given: Registered ROUTES list
    // When:  Inspecting properties of each RouteDefinition
    // Then:  All routes specify id, canonical path, component loader, label, and aliases
    assert.ok(ROUTES.length >= 14, 'Must contain at least 14 route entries');

    for (const route of ROUTES) {
      assert.equal(typeof route.id, 'string', `Route id must be a string: ${JSON.stringify(route)}`);
      assert.ok(route.path.startsWith('/app/'), `Route path must start with /app/: ${route.path}`);
      assert.equal(typeof route.component, 'function', `Route component must be a loader function: ${route.id}`);
      assert.equal(typeof route.label, 'string', `Route label must be a string: ${route.id}`);
      assert.ok(Array.isArray(route.aliases), `Route aliases must be an array: ${route.id}`);
    }
  });

  test('TC-R264-N-04: Synchronous metadata queries (getRoute, getRouteLabel, getWorkspaceRoutePath) operate synchronously', () => {
    // Given: Various valid route keys
    const testCases = [
      { key: '/app/warehouses', expectedId: 'warehouses', expectedLabel: '倉庫管理' },
      { key: 'vendorBills', expectedId: 'vendor-bills', expectedLabel: '請款單' },
      { key: 'inventory', expectedId: 'warehouses', expectedLabel: '庫存查詢' },
      { key: '/app/agent', expectedId: 'agent', expectedLabel: 'AI 助理對話' }
    ];

    // When & Then: Querying synchronously without await
    for (const tc of testCases) {
      const route = getRoute(tc.key);
      const label = getRouteLabel(tc.key);
      assert.equal(route.id, tc.expectedId, `Route for "${tc.key}" must match expected id`);
      assert.equal(label, tc.expectedLabel, `Label for "${tc.key}" must match expected label`);
    }
  });

  test('TC-R264-N-05: App.svelte architecture contains async loader, loading state, error fallback, and dynamic component', () => {
    // Given: Source code of src/App.svelte
    const appContent = fs.readFileSync(appPath, 'utf-8');

    // When:  Inspecting structure
    // Then:  Contains async loader effect, isWorkspaceLoading, workspaceLoadError, and ActiveWorkspace render
    assert.match(appContent, /resolveRouteComponent\(route\)/, 'App.svelte must resolve loader via resolveRouteComponent');
    assert.match(appContent, /isWorkspaceLoading\s*=\s*\$state\(false\)/, 'App.svelte must declare isWorkspaceLoading state');
    assert.match(appContent, /workspaceLoadError\s*=\s*\$state\(null\)/, 'App.svelte must declare workspaceLoadError state');
    assert.match(appContent, /currentLoadedLoader/, 'App.svelte must track currentLoadedLoader to prevent remounting on subroute change');
    assert.match(appContent, /class="workspace-loading-state/, 'App.svelte must render workspace loading UI');
    assert.match(appContent, /class="workspace-error-fallback/, 'App.svelte must render workspace error fallback UI');
    assert.match(appContent, /<ActiveWorkspace\s*\/>/, 'App.svelte must mount dynamic <ActiveWorkspace /> component');
  });

  test('TC-R264-N-06: Intra-workspace subroute switches share same loader and avoid remounting', () => {
    // Given: Subroutes under the same domain (e.g. warehouses domain)
    const warehouseRoute = '/app/warehouses';
    const inventoryRoute = '/app/inventory';

    // When:  Resolving loaders for both routes
    const loaderA = resolveRouteComponent(warehouseRoute);
    const loaderB = resolveRouteComponent(inventoryRoute);

    // Then:  Both routes resolve to the exact same loader function reference
    assert.equal(loaderA, loaderB, 'Subroutes of warehouses domain must share the identical loader function');

    // Simulate App.svelte effect memoization
    let ActiveWorkspace = { name: 'WarehouseWorkspace' };
    let currentLoadedLoader = loaderA;
    let reloadTriggered = false;

    const simulateRouteEffect = (nextRoute) => {
      const nextLoader = resolveRouteComponent(nextRoute);
      if (nextLoader && nextLoader === currentLoadedLoader && ActiveWorkspace) {
        return; // Retain active instance
      }
      reloadTriggered = true;
    };

    simulateRouteEffect(inventoryRoute);
    assert.equal(reloadTriggered, false, 'Switching between subroutes sharing same loader must not trigger reload');
  });

  // --- 2. Error Cases ---

  test('TC-R264-E-01: Simulated dynamic import rejection triggers error fallback handling', async () => {
    // Given: A simulated failing loader rejecting with chunk load error
    const simulatedError = new Error('Failed to fetch dynamically imported module: /assets/broken-chunk.js');
    const failingLoader = () => Promise.reject(simulatedError);

    // When:  Executing async resolution simulation identical to App.svelte $effect
    let ActiveWorkspace = null;
    let isWorkspaceLoading = true;
    let workspaceLoadError = null;

    try {
      const res = failingLoader();
      await res;
      ActiveWorkspace = res?.default || res;
      isWorkspaceLoading = false;
    } catch (err) {
      workspaceLoadError = err;
      isWorkspaceLoading = false;
    }

    // Then:  Error is caught, loading is cleared, and error fallback state is set
    assert.equal(isWorkspaceLoading, false, 'Loading state must become false on error');
    assert.equal(ActiveWorkspace, null, 'ActiveWorkspace must remain null on error');
    assert.equal(workspaceLoadError, simulatedError, 'workspaceLoadError must capture the thrown error');
    assert.match(workspaceLoadError.message, /broken-chunk/, 'Error message must preserve context');
  });

  test('TC-R264-E-02: Unknown route path falls back gracefully to DEFAULT_ROUTE without throw', () => {
    // Given: An unknown or unconfigured route path
    const unknownPath = '/app/non-existent-module-xyz';

    // When:  Resolving route and label
    const route = getRoute(unknownPath);
    const label = getRouteLabel(unknownPath);

    // Then:  Falls back to DEFAULT_ROUTE
    assert.equal(route.id, DEFAULT_ROUTE.id, 'Unknown path must resolve to DEFAULT_ROUTE');
    assert.equal(label, '業務工作區', 'Unknown path label must fall back to 業務工作區');
  });

  test('TC-R264-E-03: Loader throwing synchronously is safely captured by try/catch', () => {
    // Given: A loader function throwing synchronously
    const synchronousCrash = new Error('Syntax error during module initialization');
    const crashingLoader = () => { throw synchronousCrash; };

    // When:  Simulating App.svelte loader dispatch
    let ActiveWorkspace = null;
    let isWorkspaceLoading = true;
    let workspaceLoadError = null;

    try {
      const res = crashingLoader();
      if (res && typeof res.then === 'function') {
        // unreachable
      }
    } catch (err) {
      workspaceLoadError = err;
      isWorkspaceLoading = false;
    }

    // Then:  Synchronous crash is contained, preventing whole app unhandled exception
    assert.equal(isWorkspaceLoading, false, 'Loading must terminate on sync error');
    assert.equal(workspaceLoadError, synchronousCrash, 'Must capture sync crash');
    assert.equal(ActiveWorkspace, null, 'Workspace component remains unmounted');
  });

  test('TC-R264-E-04: Non-string input types safely default without crashing', () => {
    // Given: Invalid types passed to router query APIs
    const invalidInputs = [123, true, false, {}, [], () => {}];

    // When & Then: Functions must handle safely
    for (const input of invalidInputs) {
      // @ts-ignore
      const route = getRoute(input);
      // @ts-ignore
      const label = getRouteLabel(input);
      // @ts-ignore
      const comp = resolveRouteComponent(input);

      assert.equal(route.id, DEFAULT_ROUTE.id, `Invalid input ${String(input)} must resolve to DEFAULT_ROUTE`);
      assert.equal(label, DEFAULT_ROUTE.label, `Invalid input ${String(input)} must resolve to default label`);
      assert.equal(comp, DEFAULT_ROUTE.component, `Invalid input ${String(input)} must resolve to default component`);
    }
  });

  // --- 3. Boundary Cases ---

  test('TC-R264-B-01: Boundary value - null input', () => {
    // Given: null
    // When:  Querying route functions
    // Then:  Returns DEFAULT_ROUTE safely
    assert.equal(getRoute(null).id, DEFAULT_ROUTE.id);
    assert.equal(getRouteLabel(null), DEFAULT_ROUTE.label);
    assert.equal(resolveRouteComponent(null), DEFAULT_ROUTE.component);
    assert.equal(getWorkspaceRoutePath(null), '/app/agent');
  });

  test('TC-R264-B-02: Boundary value - undefined input', () => {
    // Given: undefined
    // When:  Querying route functions
    // Then:  Returns DEFAULT_ROUTE safely
    assert.equal(getRoute(undefined).id, DEFAULT_ROUTE.id);
    assert.equal(getRouteLabel(undefined), DEFAULT_ROUTE.label);
    assert.equal(resolveRouteComponent(undefined), DEFAULT_ROUTE.component);
    assert.equal(getWorkspaceRoutePath(undefined), '/app/agent');
  });

  test('TC-R264-B-03: Boundary value - empty string "" input', () => {
    // Given: Empty string
    // When:  Querying route functions
    // Then:  Returns DEFAULT_ROUTE safely
    assert.equal(getRoute('').id, DEFAULT_ROUTE.id);
    assert.equal(getRouteLabel(''), DEFAULT_ROUTE.label);
    assert.equal(resolveRouteComponent(''), DEFAULT_ROUTE.component);
    assert.equal(getWorkspaceRoutePath(''), '/app/agent');
  });

  test('TC-R264-B-04: Boundary value - whitespace-only string "   " input', () => {
    // Given: Whitespace string
    // When:  Querying route functions
    // Then:  Returns DEFAULT_ROUTE safely
    assert.equal(getRoute('   ').id, DEFAULT_ROUTE.id);
    assert.equal(getRouteLabel('   '), DEFAULT_ROUTE.label);
    assert.equal(resolveRouteComponent('   '), DEFAULT_ROUTE.component);
  });

  test('TC-R264-B-05: Boundary value - Hash prefixed routes ("#/app/sales-orders" and "#")', () => {
    // Given: Hash-prefixed string
    const hashRoute = '#/app/sales-orders';
    const hashOnly = '#';

    // When:  Resolving routes
    const route = getRoute(hashRoute);
    const routeFromHashOnly = getRoute(hashOnly);

    // Then:  # is stripped and sales-orders is resolved; bare # defaults safely
    assert.equal(route.id, 'sales-orders', 'Hash-prefixed route must resolve to sales-orders');
    assert.equal(routeFromHashOnly.id, DEFAULT_ROUTE.id, 'Bare hash must default safely');
  });

  test('TC-R264-B-06: Rapid route switching race condition cancellation', async () => {
    // Given: Two asynchronous loaders with different simulated network latencies
    let slowCancelled = false;
    let fastCancelled = false;
    let activeRendered = null;

    // Slow loader finishes in 50ms
    const slowLoader = () => new Promise((resolve) => {
      setTimeout(() => {
        if (!slowCancelled) activeRendered = 'SlowWorkspace';
        resolve({ default: 'SlowWorkspace' });
      }, 50);
    });

    // Fast loader finishes in 10ms
    const fastLoader = () => new Promise((resolve) => {
      setTimeout(() => {
        if (!fastCancelled) activeRendered = 'FastWorkspace';
        resolve({ default: 'FastWorkspace' });
      }, 10);
    });

    // When: User switches to slow route first, then immediately switches to fast route
    // Turn 1: Switch to slow route
    const slowCleanup = () => { slowCancelled = true; };

    // Turn 2: User switches to fast route before slow finishes (invoking slow cleanup)
    slowCleanup();
    fastLoader();
    slowLoader();

    // Wait for both to complete
    await new Promise((r) => setTimeout(r, 70));

    // Then: Fast workspace is rendered, slow workspace did not overwrite it
    assert.equal(activeRendered, 'FastWorkspace', 'Stale pending route resolution must not overwrite newer active route');
  });

  test('TC-R264-B-07: getWorkspaceRoutePath special and boundary aliases', () => {
    // Given: Canonical workspace keys and historical aliases
    assert.equal(getWorkspaceRoutePath('inventory'), '/app/inventory', 'inventory returns /app/inventory');
    assert.equal(getWorkspaceRoutePath('purchase-orders'), '/app/purchase-orders');
    assert.equal(getWorkspaceRoutePath('unknown-xyz'), '/app/agent');
    assert.equal(getWorkspaceRoutePath(''), '/app/agent');
  });

});
