/**
 * @file routes.js
 * @description Central route registry and component resolver for agent-erp.
 * Maps route strings and workspace identifiers to domain Workspace components.
 * Driven by Issue #263 T1 domain manifests with per-domain dynamic import() code-splitting.
 * Conforms to docs/system_design/module_boundary_architecture.md Stage 1.
 */

// Import T1 domain manifest declarations
import accountsPayableManifest from './accountsPayable/manifest.json';
import departmentsManifest from './departments/manifest.json';
import inventoryAdjustmentsManifest from './inventoryAdjustments/manifest.json';
import openingPayablesManifest from './openingPayables/manifest.json';
import partnersManifest from './partners/manifest.json';
import productsManifest from './products/manifest.json';
import purchaseOrdersManifest from './purchaseOrders/manifest.json';
import quotesManifest from './quotes/manifest.json';
import salesOrdersManifest from './salesOrders/manifest.json';
import stockTransfersManifest from './stockTransfers/manifest.json';
import stocktakesManifest from './stocktakes/manifest.json';
import vendorBillsManifest from './vendorBills/manifest.json';
import vendorPaymentsManifest from './vendorPayments/manifest.json';
import warehousesManifest from './warehouses/manifest.json';

/**
 * All 14 T1 business domain manifests verified in Issue #263.
 */
export const DOMAIN_MANIFESTS = [
  purchaseOrdersManifest,
  vendorBillsManifest,
  warehousesManifest,
  accountsPayableManifest,
  quotesManifest,
  salesOrdersManifest,
  inventoryAdjustmentsManifest,
  stocktakesManifest,
  stockTransfersManifest,
  openingPayablesManifest,
  vendorPaymentsManifest,
  departmentsManifest,
  partnersManifest,
  productsManifest
];

/**
 * Helper to wrap a dynamic import into a lazy loader function with a component name.
 * Enables both async execution in App.svelte and test reflection on loader.name.
 * @param {string} name
 * @param {() => Promise<any>} loader
 * @returns {() => Promise<any>}
 */
function createLazyComponent(name, loader) {
  const lazy = () => loader();
  Object.defineProperty(lazy, 'name', { value: name, configurable: true });
  lazy.componentName = name;
  return lazy;
}

/**
 * Per-domain lazy loader map.
 * Using explicit literal import() calls enables Vite/Rollup static analysis
 * for chunk creation and code-splitting per domain.
 */
export const DOMAIN_LOADERS = {
  agent: createLazyComponent('ChatBox', () => import('./components/ChatBox.svelte')),
  settings: createLazyComponent('SettingsWorkspace', () => import('./settings/Workspace.svelte')),
  purchaseOrders: createLazyComponent('PurchaseOrdersWorkspace', () => import('./purchaseOrders/Workspace.svelte')),
  warehouses: createLazyComponent('WarehouseWorkspace', () => import('./warehouses/Workspace.svelte')),
  vendorBills: createLazyComponent('VendorBillsWorkspace', () => import('./vendorBills/Workspace.svelte')),
  accountsPayable: createLazyComponent('AccountsPayableWorkspace', () => import('./accountsPayable/Workspace.svelte')),
  quotes: createLazyComponent('QuotesWorkspace', () => import('./quotes/Workspace.svelte')),
  salesOrders: createLazyComponent('SalesOrdersWorkspace', () => import('./salesOrders/Workspace.svelte')),
  inventoryAdjustments: createLazyComponent('InventoryAdjustmentsWorkspace', () => import('./inventoryAdjustments/Workspace.svelte')),
  stocktakes: createLazyComponent('StocktakesWorkspace', () => import('./stocktakes/Workspace.svelte')),
  stockTransfers: createLazyComponent('StockTransfersWorkspace', () => import('./stockTransfers/Workspace.svelte')),
  openingPayables: createLazyComponent('OpeningPayablesWorkspace', () => import('./openingPayables/Workspace.svelte')),
  vendorPayments: createLazyComponent('VendorPaymentsWorkspace', () => import('./vendorPayments/Workspace.svelte')),
  departments: createLazyComponent('SettingsWorkspace', () => import('./settings/Workspace.svelte')),
  partners: createLazyComponent('SettingsWorkspace', () => import('./settings/Workspace.svelte')),
  products: createLazyComponent('SettingsWorkspace', () => import('./settings/Workspace.svelte')),
  openingReceivables: createLazyComponent('OpeningReceivablesWorkspace', () => import('./openingReceivables/Workspace.svelte')),
  accountsReceivable: createLazyComponent('AccountsReceivableWorkspace', () => import('./accountsReceivable/Workspace.svelte')),
  customerCredit: createLazyComponent('CustomerCreditWorkspace', () => import('./customerCredits/Workspace.svelte')),
  customerInvoices: createLazyComponent('CustomerInvoicesWorkspace', () => import('./customerInvoices/Workspace.svelte')),
  customerReceipts: createLazyComponent('CustomerReceiptsWorkspace', () => import('./customerReceipts/Workspace.svelte'))
};

/**
 * @typedef {Object} RouteDefinition
 * @property {string} id - Workspace identifier
 * @property {string} path - Canonical route path (e.g. '/app/purchase-orders')
 * @property {() => Promise<any>} component - Lazy component loader function returning dynamic import() Promise
 * @property {string} label - Human readable workspace title
 * @property {string} [domainId] - T1 domain identifier if manifest-driven
 * @property {string} [icon] - Icon name from manifest
 * @property {boolean} [topLevelNav] - Whether included in top-level rail navigation
 * @property {string[]} [aliases] - Alternative route paths or workspace aliases
 */

/**
 * Base non-domain core routes.
 * @type {RouteDefinition[]}
 */
const CORE_ROUTES = [
  {
    id: 'agent',
    path: '/app/agent',
    component: DOMAIN_LOADERS.agent,
    label: 'AI 助理對話',
    aliases: ['agent', '/agent'],
    icon: 'agent',
    topLevelNav: true
  },
  {
    id: 'settings',
    path: '/app/settings',
    component: DOMAIN_LOADERS.settings,
    label: '系統設定',
    aliases: ['settings', '/settings'],
    icon: 'settings',
    topLevelNav: false
  }
];

/**
 * Manifest-driven domain routes generated from T1 DOMAIN_MANIFESTS.
 * @type {RouteDefinition[]}
 */
const MANIFEST_ROUTES = DOMAIN_MANIFESTS.map((manifest) => {
  // Use kebab-case alias as primary id for backward compatibility with existing tests and router keys
  const primaryId = (manifest.aliases && manifest.aliases[0]) || manifest.id;
  const loader = DOMAIN_LOADERS[manifest.id] || DOMAIN_LOADERS[primaryId] || DOMAIN_LOADERS.settings;

  return {
    id: primaryId,
    domainId: manifest.id,
    path: manifest.route,
    component: loader,
    label: manifest.label,
    icon: manifest.icon,
    topLevelNav: manifest.topLevelNav,
    aliases: manifest.aliases || [],
    manifest
  };
});

/**
 * Additional standalone workspace routes awaiting separate domain manifests.
 * @type {RouteDefinition[]}
 */
const ADDITIONAL_ROUTES = [
  {
    id: 'opening-receivables',
    path: '/app/opening-receivables',
    component: DOMAIN_LOADERS.openingReceivables,
    label: '期初應收帳款',
    aliases: ['opening-receivables', 'openingReceivables', '/app/openingReceivables']
  },
  {
    id: 'customer-invoices',
    path: '/app/customer-invoices',
    component: DOMAIN_LOADERS.customerInvoices,
    label: '銷項發票',
    icon: 'file-check',
    topLevelNav: true,
    aliases: ['customer-invoices', 'customer-invoice', 'invoices', 'sales-invoices', '/app/invoices', '/app/customer-invoice']
  },
  {
    id: 'accounts-receivable',
    path: '/app/accounts-receivable',
    component: DOMAIN_LOADERS.accountsReceivable,
    label: '應收帳款',
    icon: 'clock',
    topLevelNav: true,
    aliases: ['accounts-receivable', 'ar', '/app/ar']
  },
  {
    id: 'customer-credit',
    path: '/app/customer-credit',
    component: DOMAIN_LOADERS.customerCredit,
    label: '客戶信用',
    icon: 'shield-check',
    topLevelNav: true,
    aliases: ['customer-credit', 'customer-credits', '/app/customer-credits']
  },
  {
    id: 'customer-receipts',
    path: '/app/customer-receipts',
    component: DOMAIN_LOADERS.customerReceipts,
    label: '客戶收款單',
    icon: 'receipt-card',
    topLevelNav: true,
    aliases: ['customer-receipts', 'customerReceipts', 'receipts', '/app/customerReceipts', '/app/receipts']
  }
];

/**
 * All registered workspace routes in the application.
 * @type {RouteDefinition[]}
 */
export const ROUTES = [
  ...CORE_ROUTES,
  ...MANIFEST_ROUTES,
  ...ADDITIONAL_ROUTES
];

export const DEFAULT_ROUTE = ROUTES[0]; // agent / ChatBox

/**
 * Route lookup map populated from ROUTES, indexed by:
 * - id
 * - domainId (if available)
 * - path
 * - all aliases
 */
const ROUTE_LOOKUP = new Map();

for (const route of ROUTES) {
  // Preserve first-come precedence for canonical paths (e.g. /app/settings belongs to 'settings')
  if (!ROUTE_LOOKUP.has(route.id)) {
    ROUTE_LOOKUP.set(route.id, route);
  }
  if (route.domainId && !ROUTE_LOOKUP.has(route.domainId)) {
    ROUTE_LOOKUP.set(route.domainId, route);
  }
  if (!ROUTE_LOOKUP.has(route.path)) {
    ROUTE_LOOKUP.set(route.path, route);
  }
  if (Array.isArray(route.aliases)) {
    for (const alias of route.aliases) {
      if (!ROUTE_LOOKUP.has(alias)) {
        ROUTE_LOOKUP.set(alias, route);
      }
    }
  }
}

/**
 * Special labels for aliases where label differs from canonical route label
 * e.g., 'inventory' -> '庫存查詢' (historical requirement in getWorkspaceLabel)
 */
const SPECIAL_LABELS = {
  'inventory': '庫存查詢',
  '/app/inventory': '庫存查詢'
};

/**
 * Resolves route definition by route path or workspace key.
 * Fallback to DEFAULT_ROUTE if not found.
 * @param {string | null | undefined} routeOrKey
 * @returns {RouteDefinition}
 */
export function getRoute(routeOrKey) {
  if (!routeOrKey || typeof routeOrKey !== 'string') {
    return DEFAULT_ROUTE;
  }
  const trimmed = routeOrKey.trim();

  // 1. Direct lookup
  if (ROUTE_LOOKUP.has(trimmed)) {
    return ROUTE_LOOKUP.get(trimmed);
  }

  // 2. Strip hash if provided e.g. '#/app/settings'
  const clean = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (ROUTE_LOOKUP.has(clean)) {
    return ROUTE_LOOKUP.get(clean);
  }

  // 3. Match /app/xxx prefix for routes with sub-paths (e.g. /app/purchase-orders/new)
  const match = clean.match(/^\/app\/([^/?#]+)/);
  if (match && ROUTE_LOOKUP.has(match[1])) {
    return ROUTE_LOOKUP.get(match[1]);
  }

  return DEFAULT_ROUTE;
}

/**
 * Resolves lazy Svelte component loader for given route or workspace key.
 * Returns a function returning dynamic import() Promise.
 * @param {string | null | undefined} routeOrKey
 * @returns {() => Promise<any>}
 */
export function resolveRouteComponent(routeOrKey) {
  return getRoute(routeOrKey).component;
}

/**
 * Resolves human-readable label for a workspace or route.
 * Preserves historical labels like 'inventory' -> '庫存查詢'
 * and returns '業務工作區' as fallback for unknown workspaces.
 * @param {string | null | undefined} routeOrKey
 * @returns {string}
 */
export function getRouteLabel(routeOrKey) {
  if (!routeOrKey || typeof routeOrKey !== 'string') {
    return DEFAULT_ROUTE.label;
  }
  const trimmed = routeOrKey.trim();
  if (!trimmed) {
    return DEFAULT_ROUTE.label;
  }
  const clean = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;

  if (SPECIAL_LABELS[clean]) {
    return SPECIAL_LABELS[clean];
  }

  // Check if known in ROUTE_LOOKUP
  if (ROUTE_LOOKUP.has(clean)) {
    return ROUTE_LOOKUP.get(clean).label;
  }

  const match = clean.match(/^\/app\/([^/?#]+)/);
  if (match && ROUTE_LOOKUP.has(match[1])) {
    return ROUTE_LOOKUP.get(match[1]).label;
  }

  return '業務工作區';
}

/**
 * Returns canonical route path for a given workspace key.
 * @param {string} ws
 * @returns {string}
 */
export function getWorkspaceRoutePath(ws) {
  if (!ws || typeof ws !== 'string') return '/app/agent';
  if (ws === 'inventory') return '/app/inventory';
  const route = getRoute(ws);
  return route.path;
}

/**
 * Resolves top-level navigation items driven by domain manifests and core routes.
 * Supports passing custom manifests for test injection.
 * @param {Array<any>} [manifests=DOMAIN_MANIFESTS]
 * @returns {RouteDefinition[]}
 */
export function getTopLevelNavRoutes(manifests = DOMAIN_MANIFESTS) {
  const safeManifests = Array.isArray(manifests) ? manifests : DOMAIN_MANIFESTS;

  const domainNavs = safeManifests
    .filter(m => m && typeof m === 'object' && m.topLevelNav)
    .map(manifest => {
      const primaryId = (Array.isArray(manifest.aliases) && manifest.aliases[0]) || manifest.id;
      const loader = DOMAIN_LOADERS[manifest.id] || DOMAIN_LOADERS[primaryId] || DOMAIN_LOADERS.settings;
      return {
        id: primaryId,
        domainId: manifest.id,
        path: manifest.route,
        component: loader,
        label: manifest.label,
        icon: manifest.icon,
        topLevelNav: manifest.topLevelNav,
        aliases: Array.isArray(manifest.aliases) ? manifest.aliases : [],
        manifest
      };
    });

  const coreNavs = CORE_ROUTES.filter(r => r.topLevelNav);
  const additionalNavs = ADDITIONAL_ROUTES.filter(r => r.topLevelNav);
  return [...coreNavs, ...domainNavs, ...additionalNavs];
}

/**
 * Pre-resolved static list of default top-level navigation routes.
 * @type {RouteDefinition[]}
 */
export const TOP_LEVEL_NAV_ROUTES = getTopLevelNavRoutes();

/**
 * Checks whether a navigation item is active based on current workspace or route path.
 * Matches by item.id, item.domainId, item.path, or any alias defined in item.aliases.
 * @param {RouteDefinition | Object} item
 * @param {string | null | undefined} currentWs
 * @param {string | null | undefined} [currentRoute]
 * @returns {boolean}
 */
export function isNavActive(item, currentWs, currentRoute) {
  if (!item || typeof item !== 'object') return false;
  const cleanWs = typeof currentWs === 'string' ? currentWs.trim() : '';
  const cleanRoute = typeof currentRoute === 'string' ? currentRoute.trim().replace(/^#/, '') : '';

  if (cleanWs) {
    if (item.id === cleanWs || item.domainId === cleanWs) return true;
    if (Array.isArray(item.aliases)) {
      if (item.aliases.some(a => typeof a === 'string' && a.trim() === cleanWs)) return true;
    }
  }

  if (cleanRoute) {
    if (item.path === cleanRoute) return true;
    if (Array.isArray(item.aliases)) {
      if (item.aliases.some(a => typeof a === 'string' && a.trim() === cleanRoute)) return true;
    }
    // Match /app/xxx prefix for sub-routes
    if (item.path && cleanRoute.startsWith(item.path + '/')) return true;
  }

  return false;
}

