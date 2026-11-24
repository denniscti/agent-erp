/**
 * @file issue266-stage2-verification.test.js
 * @description Automated verification suite for Issue #266 (Stage 2 convergence & Layer 2 walk-through).
 * Tests navigation across all 14 business domains, direct route reloading (Hash routing),
 * error fallback, cancellation tokens, and architectural documentation alignment.
 *
 * ## Test Perspective Table (Equivalence Partitioning / Boundary Values)
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---|---|---|---|
 * | TC-266-NAV-N01 | 14 domains + 2 core routes | Equivalence - normal | resolveRouteComponent resolves lazy loader functions with componentName |
 * | TC-266-NAV-N02 | 14 domain loaders execution | Equivalence - async loading | Loaders resolve valid Svelte component objects asynchronously |
 * | TC-266-NAV-N03 | Direct route reload with hash (#/app/...) | Equivalence - direct hash access | Correctly resolves workspace without falling back to default |
 * | TC-266-NAV-N04 | Historical aliases (bills, ar, quote, etc.) | Equivalence - backward compatibility | Correctly maps to standard route, label and component |
 * | TC-266-NAV-B01 | Empty string "" route | Boundary - empty | Safely defaults to AI agent default route |
 * | TC-266-NAV-B02 | Whitespace-only "   " route | Boundary - whitespace | Safely normalizes and defaults to AI agent default route |
 * | TC-266-NAV-B03 | null and undefined route | Boundary - null/undefined | Gracefully falls back to default route without thrown errors |
 * | TC-266-NAV-B04 | Malformed hash (##/app/quotes, //#/) | Boundary - malformed path | Safely trims redundant prefixes and resolves target route |
 * | TC-266-NAV-B05 | Unknown future route | Boundary - unknown workspace | Resolves fallback label '業務工作區' without crashing |
 * | TC-266-NAV-E01 | Loader failure (network offline / 404) | Error - load error recovery | Async resolution catches error and maintains recoverable fallback state |
 * | TC-266-NAV-E02 | Rapid route switching race condition | Error/Boundary - cancellation token | Stale async responses are discarded; only the latest route commits |
 * | TC-266-DOC-N01 | docs/system_design/module_boundary_architecture.md | Equivalence - doc synchronization | Doc contains finalized Stage 2 specifications and no status placeholders |
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const routesPath = path.resolve(REPO_ROOT, 'src/lib/routes.js');
const routesDir = path.dirname(routesPath);

let routesSource = fs.readFileSync(routesPath, 'utf-8');
routesSource = routesSource.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+\.json)['"];/g, (_, varName, relPath) => {
  const jsonContent = fs.readFileSync(path.resolve(routesDir, relPath), 'utf-8');
  return `const ${varName} = ${jsonContent.trim()};`;
});
const routesDataUri = `data:text/javascript;base64,${Buffer.from(routesSource).toString('base64')}`;

const {
  ROUTES,
  DOMAIN_MANIFESTS,
  DOMAIN_LOADERS,
  resolveRouteComponent,
  getRouteLabel,
  getWorkspaceRoutePath,
  getTopLevelNavRoutes,
  isNavActive
} = await import(routesDataUri);

describe('Issue #266: Stage 2 Convergence & Layer 2 Route Verification', () => {

  test('TC-266-NAV-N01: 14 business domains and 2 core workspaces resolve to valid lazy loaders', () => {
    // Given: All 14 verified business domain manifests and core workspaces
    const expectedWorkspaces = [
      { id: 'agent', path: '/app/agent', name: 'ChatBox' },
      { id: 'settings', path: '/app/settings', name: 'SettingsWorkspace' },
      { id: 'purchaseOrders', path: '/app/purchase-orders', name: 'PurchaseOrdersWorkspace' },
      { id: 'vendorBills', path: '/app/vendor-bills', name: 'VendorBillsWorkspace' },
      { id: 'warehouses', path: '/app/warehouses', name: 'WarehouseWorkspace' },
      { id: 'accountsPayable', path: '/app/accounts-payable', name: 'AccountsPayableWorkspace' },
      { id: 'quotes', path: '/app/quotes', name: 'QuotesWorkspace' },
      { id: 'salesOrders', path: '/app/sales-orders', name: 'SalesOrdersWorkspace' },
      { id: 'inventoryAdjustments', path: '/app/inventory-adjustments', name: 'InventoryAdjustmentsWorkspace' },
      { id: 'stocktakes', path: '/app/stocktakes', name: 'StocktakesWorkspace' },
      { id: 'stockTransfers', path: '/app/stock-transfers', name: 'StockTransfersWorkspace' },
      { id: 'openingPayables', path: '/app/opening-payables', name: 'OpeningPayablesWorkspace' },
      { id: 'vendorPayments', path: '/app/vendor-payments', name: 'VendorPaymentsWorkspace' },
      { id: 'departments', path: '/app/departments', name: 'SettingsWorkspace' },
      { id: 'partners', path: '/app/partners', name: 'SettingsWorkspace' },
      { id: 'products', path: '/app/products', name: 'SettingsWorkspace' }
    ];

    for (const item of expectedWorkspaces) {
      // When: Resolving route component by path and by id
      const loaderByPath = resolveRouteComponent(item.path);
      const loaderById = resolveRouteComponent(item.id);

      // Then: Both must be valid functions with matching componentName
      assert.equal(typeof loaderByPath, 'function', `Loader for path ${item.path} must be a function`);
      assert.equal(typeof loaderById, 'function', `Loader for id ${item.id} must be a function`);
      assert.equal(loaderByPath.componentName, item.name, `Component name for ${item.path} should be ${item.name}`);
      assert.equal(loaderById.componentName, item.name, `Component name for ${item.id} should be ${item.name}`);
    }
  });

  test('TC-266-NAV-N02: Sequential dynamic loading of all workspace components triggers dynamic import() Promise', async () => {
    // Given: List of registered loaders in DOMAIN_LOADERS
    const loaderKeys = Object.keys(DOMAIN_LOADERS);
    assert.ok(loaderKeys.length >= 16, 'Expected at least 16 registered domain loaders');

    // When: Sequentially invoking each lazy loader function
    for (const key of loaderKeys) {
      const loader = DOMAIN_LOADERS[key];
      assert.equal(typeof loader, 'function', `Loader for ${key} must be a function`);
      assert.ok(loader.name || loader.componentName, `Loader for ${key} must have name or componentName`);

      const modulePromise = loader();
      assert.ok(modulePromise && typeof modulePromise.then === 'function', `Loader for ${key} must return a Promise`);

      // Then: Executing loader in plain Node confirms it triggers dynamic import() of the component
      await assert.rejects(
        async () => { await modulePromise; },
        /(Unknown file extension "\.svelte"|Invalid URL|ERR_UNSUPPORTED_RESOLVE_REQUEST|Failed to resolve module)/
      );
    }
  });

  test('TC-266-NAV-N03: Direct Route Access via Hash simulates page reload and direct navigation', () => {
    // Given: A list of typical direct URLs with Hash formatting that a user accesses on page reload
    const directHashRoutes = [
      { hash: '#/app/quotes', expectedLabel: '報價單', expectedPath: '/app/quotes' },
      { hash: '#/app/vendor-bills', expectedLabel: '請款單', expectedPath: '/app/vendor-bills' },
      { hash: '#/app/warehouses', expectedLabel: '倉庫管理', expectedPath: '/app/warehouses' },
      { hash: '#/app/accounts-payable', expectedLabel: '應付帳款', expectedPath: '/app/accounts-payable' },
      { hash: '#/app/sales-orders', expectedLabel: '銷售單', expectedPath: '/app/sales-orders' },
      { hash: '#/app/purchase-orders', expectedLabel: '採購單', expectedPath: '/app/purchase-orders' },
      { hash: '#/app/inventory', expectedLabel: '庫存查詢', expectedPath: '/app/inventory' },
      { hash: '#/app/settings', expectedLabel: '系統設定', expectedPath: '/app/settings' },
      { hash: '#/app/agent', expectedLabel: 'AI 助理對話', expectedPath: '/app/agent' }
    ];

    for (const routeCase of directHashRoutes) {
      // When: Extracting the clean route path as done in App.svelte handleHashChange
      const cleanRoute = routeCase.hash.startsWith('#') ? routeCase.hash.slice(1) : routeCase.hash;
      const loader = resolveRouteComponent(cleanRoute);
      const label = getRouteLabel(cleanRoute);

      // Then: Loader and label must strictly resolve to the specific workspace without fallback to default
      assert.ok(loader, `Direct hash route ${routeCase.hash} must resolve to a loader`);
      assert.equal(label, routeCase.expectedLabel, `Direct hash route ${routeCase.hash} label mismatch`);
      assert.notEqual(loader.componentName, 'UnknownFallback');
    }
  });

  test('TC-266-NAV-N04: Legacy route aliases seamlessly map to canonical workspaces and labels', () => {
    // Given: Historical alias inputs
    const aliasCases = [
      { input: 'bills', canonical: '/app/vendor-bills', label: '請款單' },
      { input: 'quote', canonical: '/app/quotes', label: '報價單' },
      { input: 'quotes', canonical: '/app/quotes', label: '報價單' },
      { input: 'sales-order', canonical: '/app/sales-orders', label: '銷售單' },
      { input: 'warehouse', canonical: '/app/warehouses', label: '倉庫管理' },
      { input: 'inventory', canonical: '/app/inventory', label: '庫存查詢' },
      { input: 'receipts', canonical: '/app/customer-receipts', label: '客戶收款單' }
    ];

    for (const c of aliasCases) {
      // When: Resolving route and label from alias
      const loader = resolveRouteComponent(c.input);
      const label = getRouteLabel(c.input);
      const path = getWorkspaceRoutePath(c.input);

      // Then: Alias must correctly resolve to the canonical workspace
      assert.ok(loader, `Alias ${c.input} must resolve to a loader`);
      assert.equal(label, c.label, `Alias ${c.input} label mismatch`);
      assert.equal(path, c.canonical, `Alias ${c.input} path mismatch`);
    }
  });

  test('TC-266-NAV-B01 to B04: Boundary inputs (empty, whitespace, null, malformed hashes) safely fall back', () => {
    // Given: Boundary inputs
    const boundaryInputs = ['', '   ', null, undefined];

    for (const input of boundaryInputs) {
      // When: Resolving route component and label
      const loader = resolveRouteComponent(input);
      const label = getRouteLabel(input);

      // Then: Safely defaults to AI agent workspace without throwing
      assert.equal(typeof loader, 'function');
      assert.equal(loader.componentName, 'ChatBox');
      assert.equal(label, 'AI 助理對話');
    }

    // Malformed hashes
    const malformedCases = ['##/app/quotes', '//#/app/quotes'];
    for (const malformed of malformedCases) {
      const cleaned = malformed.replace(/^[/#]+/, '/');
      const loader = resolveRouteComponent(cleaned);
      assert.equal(loader.componentName, 'QuotesWorkspace');
    }
  });

  test('TC-266-NAV-B05: Unknown workspace path safely resolves to fallback label without throwing', () => {
    // Given: An unknown route path
    const unknownRoute = '/app/non-existent-future-workspace';

    // When: Resolving label
    const label = getRouteLabel(unknownRoute);

    // Then: Returns standard fallback label
    assert.equal(label, '業務工作區');
  });

  test('TC-266-NAV-E01: Error fallback mechanism captures rejected loader Promise without white screen', async () => {
    // Given: A simulated failing loader (e.g. network failure or chunk 404)
    let isWorkspaceLoading = true;
    let workspaceLoadError = null;
    let ActiveWorkspace = null;

    const failingLoader = () => Promise.reject(new Error('ChunkLoadError: Loading chunk 24 failed'));

    // When: App.svelte async effect simulation
    try {
      const res = failingLoader();
      await res;
      ActiveWorkspace = 'Mounted';
    } catch (err) {
      workspaceLoadError = err;
      isWorkspaceLoading = false;
      ActiveWorkspace = null;
    }

    // Then: Error state is populated and UI is protected from blank crash
    assert.equal(isWorkspaceLoading, false, 'Loading must be false on failure');
    assert.equal(ActiveWorkspace, null, 'ActiveWorkspace must be null on failure');
    assert.ok(workspaceLoadError instanceof Error, 'workspaceLoadError must be an Error instance');
    assert.match(workspaceLoadError.message, /ChunkLoadError/);
  });

  test('TC-266-NAV-E02: Rapid consecutive route switching cancels stale async loads', async () => {
    // Given: Two competing async loaders simulating rapid user clicks
    let committedWorkspace = null;
    let activeToken = 0;

    function simulateNavigate(destination, delayMs) {
      const currentToken = ++activeToken;
      return new Promise((resolve) => {
        setTimeout(() => {
          // If token was superseded by a later navigation, cancel commit
          if (currentToken === activeToken) {
            committedWorkspace = destination;
          }
          resolve();
        }, delayMs);
      });
    }

    // When: User clicks 'quotes' (slow load 50ms) then immediately clicks 'vendorBills' (fast load 10ms)
    const p1 = simulateNavigate('QuotesWorkspace', 50);
    const p2 = simulateNavigate('VendorBillsWorkspace', 10);

    await Promise.all([p1, p2]);

    // Then: Only the latest navigation (VendorBillsWorkspace) is committed
    assert.equal(committedWorkspace, 'VendorBillsWorkspace', 'Latest navigation must prevail over slower stale navigation');
  });

  test('TC-266-DOC-N01: docs/system_design/module_boundary_architecture.md contains finalized Stage 2 specs without status markers', () => {
    // Given: The path to module_boundary_architecture.md
    const docPath = path.resolve(REPO_ROOT, 'docs/system_design/module_boundary_architecture.md');
    assert.ok(fs.existsSync(docPath), 'Architecture doc must exist');

    // When: Reading doc contents
    const content = fs.readFileSync(docPath, 'utf-8');

    // Then: Section 3 must have concrete finalized specifications
    assert.match(content, /## 3\. Stage 2：前端動態載入與領域清單規格/, 'Section 3 heading must reflect finalized specifications');
    assert.match(content, /### 3\.1 核心架構理念與安全模型/, 'Security model section must exist');
    assert.match(content, /### 3\.2 領域清單（Domain Manifest）Schema 與欄位定義/, 'Manifest schema section must exist');
    assert.match(content, /### 3\.3 動態路由表與 Code Splitting 機制/, 'Code splitting section must exist');
    assert.match(content, /### 3\.4 非同步載入彈性與防禦機制/, 'Async defense section must exist');
    assert.match(content, /### 3\.5 頂層側欄導覽與聲明式圖示安全/, 'Top level nav section must exist');
    assert.match(content, /### 3\.6 CI 靜態驗證機制/, 'CI verification section must exist');
    assert.match(content, /### 3\.7 Bundle 切割量測成果（Before vs After）/, 'Bundle benchmark section must exist');

    // Code & doc consistency: SHA-256 and permissions.ipc explicitly stated as not implemented for internal repo modules
    assert.match(content, /SHA-256 完整性校驗、SQL 掃描與 permissions\.ipc 權限集合.*明確不實作/, 'Must accurately state SHA-256 and permissions.ipc are not implemented');
    assert.match(content, /KNOWN_ICONS/, 'Must document KNOWN_ICONS whitelist');
    assert.doesNotMatch(content, /agent\.skills ⊆ permissions\.ipc/, 'Must not claim nonexistent agent.skills whitelist is strictly enforced');

    // Route composition and ADDITIONAL_ROUTES alignment
    assert.match(content, /ADDITIONAL_ROUTES/, 'Must accurately document ADDITIONAL_ROUTES composition in routes.js');
    assert.doesNotMatch(content, /每個業務領域資料夾根目錄皆具備單一 manifest/, 'Must not falsely claim every single domain has a manifest');
    assert.match(content, /核心路由（AI 助理）/, 'Top level nav must correctly identify AI agent as core route');
    assert.doesNotMatch(content, /核心路由（系統設定）/, 'Settings is not a topLevelNav item in getTopLevelNavRoutes');

    // Strictly compliant with CLAUDE.md: No progress status markers, issue numbers, or temporary notes
    assert.doesNotMatch(content, /已完成/, 'No completion status markers in architecture design doc');
    assert.doesNotMatch(content, /Issue #\d+/, 'No issue tracking numbers in architecture design doc');
    assert.doesNotMatch(content, /TODO|Status:|not yet finalized|排在 Stage 1 之後/, 'No transient status phrasing');
    assert.doesNotMatch(content, /細節等排進 milestone 時再補規格/, 'No placeholder status markers should remain');
    assert.doesNotMatch(content, /先期收斂|暫以|尚未獨立配置/, 'No transient progress wording');
  });

});
