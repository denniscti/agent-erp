/**
 * @file routes.js
 * @description Central route registry and component resolver for agent-erp.
 * Maps route strings and workspace identifiers to domain Workspace components.
 * Conforms to docs/system_design/module_boundary_architecture.md Stage 1.
 */

import ChatBox from './components/ChatBox.svelte';
import SettingsWorkspace from './settings/Workspace.svelte';
import PurchaseOrdersWorkspace from './purchaseOrders/Workspace.svelte';
import WarehouseWorkspace from './warehouses/Workspace.svelte';
import VendorBillsWorkspace from './vendorBills/Workspace.svelte';
import AccountsPayableWorkspace from './accountsPayable/Workspace.svelte';
import QuotesWorkspace from './quotes/Workspace.svelte';
import SalesOrdersWorkspace from './salesOrders/Workspace.svelte';
import InventoryAdjustmentsWorkspace from './inventoryAdjustments/Workspace.svelte';
import StocktakesWorkspace from './stocktakes/Workspace.svelte';
import StockTransfersWorkspace from './stockTransfers/Workspace.svelte';
import OpeningPayablesWorkspace from './openingPayables/Workspace.svelte';
import OpeningReceivablesWorkspace from './openingReceivables/Workspace.svelte';
import VendorPaymentsWorkspace from './vendorPayments/Workspace.svelte';
import CustomerCreditWorkspace from './customerCredits/Workspace.svelte';
import CustomerInvoicesWorkspace from './customerInvoices/Workspace.svelte';

/**
 * @typedef {Object} RouteDefinition
 * @property {string} id - Workspace identifier
 * @property {string} path - Canonical route path (e.g. '/app/purchase-orders')
 * @property {any} component - Svelte component to render
 * @property {string} label - Human readable workspace title
 * @property {string[]} [aliases] - Alternative route paths or workspace aliases
 */

/**
 * All registered workspace routes in the application.
 * @type {RouteDefinition[]}
 */
export const ROUTES = [
  {
    id: 'agent',
    path: '/app/agent',
    component: ChatBox,
    label: 'AI 助理對話',
    aliases: ['agent', '/agent']
  },
  {
    id: 'settings',
    path: '/app/settings',
    component: SettingsWorkspace,
    label: '系統設定',
    aliases: ['settings', '/settings']
  },
  {
    id: 'purchase-orders',
    path: '/app/purchase-orders',
    component: PurchaseOrdersWorkspace,
    label: '採購單',
    aliases: ['purchase-orders', 'purchase-order', '/app/purchase-order']
  },
  {
    id: 'warehouses',
    path: '/app/warehouses',
    component: WarehouseWorkspace,
    label: '倉庫管理',
    aliases: ['warehouses', 'warehouse', '/app/warehouse', 'inventory', '/app/inventory']
  },
  {
    id: 'vendor-bills',
    path: '/app/vendor-bills',
    component: VendorBillsWorkspace,
    label: '請款單',
    aliases: ['vendor-bills', 'bills', 'vendor-bill', '/app/bills', '/app/vendor-bill']
  },
  {
    id: 'accounts-payable',
    path: '/app/accounts-payable',
    component: AccountsPayableWorkspace,
    label: '應付帳款',
    aliases: ['accounts-payable', 'ap', '/app/ap']
  },
  {
    id: 'quotes',
    path: '/app/quotes',
    component: QuotesWorkspace,
    label: '報價單',
    aliases: ['quotes', 'quote', '/app/quote']
  },
  {
    id: 'sales-orders',
    path: '/app/sales-orders',
    component: SalesOrdersWorkspace,
    label: '銷售單',
    aliases: ['sales-orders', 'sales-order', '/app/sales-order']
  },
  {
    id: 'inventory-adjustments',
    path: '/app/inventory-adjustments',
    component: InventoryAdjustmentsWorkspace,
    label: '庫存調整',
    aliases: ['inventory-adjustments', 'adjustments', '/app/adjustments']
  },
  {
    id: 'stocktakes',
    path: '/app/stocktakes',
    component: StocktakesWorkspace,
    label: '盤點管理',
    aliases: ['stocktakes', 'stocktake', '/app/stocktake']
  },
  {
    id: 'stock-transfers',
    path: '/app/stock-transfers',
    component: StockTransfersWorkspace,
    label: '調撥管理',
    aliases: ['stock-transfers', 'transfers', 'stockTransfers', '/app/stockTransfers', '/app/transfers']
  },
  {
    id: 'opening-payables',
    path: '/app/opening-payables',
    component: OpeningPayablesWorkspace,
    label: '期初應付帳款',
    aliases: ['opening-payables', 'openingPayables', '/app/openingPayables']
  },
  {
    id: 'opening-receivables',
    path: '/app/opening-receivables',
    component: OpeningReceivablesWorkspace,
    label: '期初應收帳款',
    aliases: ['opening-receivables', 'openingReceivables', '/app/openingReceivables']
  },
  {
    id: 'vendor-payments',
    path: '/app/vendor-payments',
    component: VendorPaymentsWorkspace,
    label: '付款單',
    aliases: ['vendor-payments', 'vendorPayments', 'payments', '/app/vendorPayments', '/app/payments']
  },
  {
    id: 'customer-credit',
    path: '/app/customer-credit',
    component: CustomerCreditWorkspace,
    label: '客戶信用',
    aliases: ['customer-credit', 'customer-credits', '/app/customer-credits', 'accounts-receivable', '/app/accounts-receivable']
  },
  {
    id: 'customer-invoices',
    path: '/app/customer-invoices',
    component: CustomerInvoicesWorkspace,
    label: '銷項發票',
    aliases: ['customer-invoices', 'customer-invoice', 'invoices', 'sales-invoices', '/app/invoices', '/app/customer-invoice']
  }
];

export const DEFAULT_ROUTE = ROUTES[0]; // agent / ChatBox

/**
 * Route lookup map populated from ROUTES, indexed by:
 * - id
 * - path
 * - all aliases
 */
const ROUTE_LOOKUP = new Map();

for (const route of ROUTES) {
  ROUTE_LOOKUP.set(route.id, route);
  ROUTE_LOOKUP.set(route.path, route);
  if (Array.isArray(route.aliases)) {
    for (const alias of route.aliases) {
      ROUTE_LOOKUP.set(alias, route);
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
 * Resolves Svelte component to render for given route or workspace key.
 * @param {string | null | undefined} routeOrKey
 * @returns {any}
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

