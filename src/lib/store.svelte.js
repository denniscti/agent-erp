// @ts-check

/**
 * ============================================================================
 * AgentERP 核心狀態管理 (Core Shell Store)
 * ============================================================================
 * 本檔案僅供放置系統級跨領域共用殼層邏輯：
 * - appState 核心骨架、跨領域全域狀態與緩存
 * - 登入、身份驗證、租戶切換與成員管理
 * - Task Panel 工作流任務與訊息排程
 * - 通知訊息 (showToast)、全域導覽 (navigate / getWorkspaceLabel)
 * - 通用 API 轉發 (apiCall) 與純工具函式 (formatCurrency / formatTime)
 * 
 * ⚠️ 注意：領域專屬業務邏輯請勿加入此檔案，請置於對應的 `src/lib/{domain}/` 目錄下。
 * ============================================================================
 */

/**
 * @typedef {import('./bindings').AuthStatusResponse} AuthStatusResponse
 * @typedef {import('./bindings').AuthUser} AuthUser
 * @typedef {import('./bindings').AuthTenant} AuthTenant
 * @typedef {import('./bindings').ApiErrorPayload} ApiErrorPayload
 * @typedef {import('./bindings').LogoutResponse} LogoutResponse
 */

import { invoke, check, relaunch } from './tauri.js';
import { executeConfirmation, executeCancellation } from './workflow/harness.js';
import { getDeclaredSkills, getSkillsByDomain, KNOWN_DOMAINS } from './workflow/index.js';

export {
  navigationStalenessListeners,
  registerNavigationStalenessListener,
  invalidateNavigationStaleness
} from './navigationStaleness.js';

import {
  registerNavigationStalenessListener,
  invalidateNavigationStaleness
} from './navigationStaleness.js';

export {
  fetchDepartments,
  createDepartmentAction,
  filterDeclaredSkills,
  updateDepartmentSkillsAction,
  getEffectiveSkills,
  computeSkillDiff,
  getCurrentUserEffectiveSkills,
  completeDepartmentSetupTask
} from './departments/store.js';

export {
  fetchPartners,
  createPartnerAction,
  createVendorAction,
  fetchVendors,
  updatePartnerAction
} from './partners/store.js';

export {
  resolveCategoryFlags,
  fetchProducts,
  getProductDetailAction,
  createProductAction,
  addProductVariantAction,
  updateProductVariantAction,
  addProductUnitAction,
  updateProductUnitAction,
  addSupplySourceAction,
  updateSupplySourceAction,
  addBomItemAction
} from './products/store.js';

export {
  fetchPurchaseOrders,
  fetchPurchaseOrderDetail,
  selectPurchaseOrder,
  createPurchaseOrderAction,
  updatePurchaseOrderHeaderAction,
  addPurchaseOrderLineAction,
  updatePurchaseOrderLineAction,
  removePurchaseOrderLineAction,
  submitPurchaseOrderAction,
  confirmPurchaseOrderReceivedAction,
  cancelPurchaseOrderAction
} from './purchaseOrders/store.js';

export {
  fetchWarehouses,
  createWarehouseAction,
  updateWarehouseAction,
  setDefaultWarehouseAction,
  deactivateWarehouseAction,
  reactivateWarehouseAction,
  openCreateWarehouseModal,
  closeCreateWarehouseModal,
  isZeroWarehouseError,
  handleZeroWarehouseError,
  formatMovementReason,
  getWarehouseName,
  fetchInventoryLevels,
  fetchUnitInventoryLevel,
  fetchInventoryMovements,
  recordOpeningInventoryBalanceAction,
  fetchUnitConversions,
  fetchUnitConversionDetail,
  selectUnitConversion,
  createUnitConversionAction,
  postUnitConversionAction,
  cancelUnitConversionAction
} from './warehouses/store.js';

export {
  formatAdjustmentReason,
  formatAdjustmentStatus,
  fetchInventoryAdjustments,
  fetchInventoryAdjustmentDetail,
  selectInventoryAdjustment,
  createInventoryAdjustmentAction,
  updateInventoryAdjustmentHeaderAction,
  addInventoryAdjustmentLineAction,
  updateInventoryAdjustmentLineAction,
  removeInventoryAdjustmentLineAction,
  postInventoryAdjustmentAction,
  cancelInventoryAdjustmentAction
} from './inventoryAdjustments/store.js';

export {
  isStocktakeLineCounted,
  STOCKTAKE_STATUS_META,
  getStocktakeStatusBadgeClass,
  isStocktakeMovementConflictError,
  formatStocktakeStatus,
  formatStocktakeProgress,
  fetchStocktakes,
  fetchStocktakeDetail,
  resetStocktakeDetailSequences,
  selectStocktake,
  normalizeStocktakeInput,
  createStocktakeAction,
  updateStocktakeHeaderAction,
  addStocktakeLinesAction,
  addStocktakeLinesFromStockAction,
  removeStocktakeLineAction,
  startStocktakeCountingAction,
  patchStocktakeInList,
  STOCKTAKE_VARIANCE_EPSILON,
  classifyStocktakeLineVariance,
  calculateStocktakePostSummary,
  formatStocktakeConflictLineLabel,
  parseStocktakeConflictLines,
  getLineUpdateSeqsSize,
  setStocktakeCountedQuantityAction,
  refreshStocktakeSystemQuantityAction,
  postStocktakeAction,
  cancelStocktakeAction
} from './stocktakes/store.js';

export {
  patchStockTransferInList,
  fetchStockTransfers,
  fetchStockTransferDetail,
  createStockTransferAction,
  updateStockTransferHeaderAction,
  addStockTransferLineAction,
  updateStockTransferLineAction,
  removeStockTransferLineAction,
  postStockTransferAction,
  cancelStockTransferAction
} from './stockTransfers/store.js';

export {
  loadOpeningPayablesAction,
  createOpeningPayableAction,
  voidOpeningPayableAction
} from './openingPayables/store.js';

export {
  loadOpeningReceivablesAction,
  createOpeningReceivableAction,
  voidOpeningReceivableAction
} from './openingReceivables/store.js';

export {
  fetchVendorBills,
  fetchVendorBillDetail,
  fetchUnbilledReceivedOrders,
  fetchPurchaseOrderBillingInfo,
  createVendorBillAction,
  updateVendorBillHeaderAction,
  addVendorBillOrderAction,
  removeVendorBillOrderAction,
  postVendorBillAction,
  acceptVendorBillDifferenceAction,
  returnVendorBillToDraftAction,
  cancelVendorBillAction,
  voidVendorBillAction
} from './vendorBills/store.js';

export {
  loadVendorPaymentsAction,
  getVendorPaymentAction,
  createVendorPaymentAction,
  updateVendorPaymentHeaderAction,
  addVendorPaymentAllocationAction,
  updateVendorPaymentAllocationAction,
  removeVendorPaymentAllocationAction,
  postVendorPaymentAction,
  cancelVendorPaymentAction,
  voidVendorPaymentAction
} from './vendorPayments/store.js';

export {
  queryAccountsPayableAction,
  loadAccountsPayableAction,
  getAccountPayableAction,
  loadPayablesAgingAction,
  loadVendorStatementAction
} from './accountsPayable/store.js';

export {
  fetchQuotes,
  fetchQuoteDetail,
  getQuoteDetailReadOnly,
  fetchPendingApprovalQuotes,
  createQuoteAction,
  updateQuoteHeaderAction,
  addQuoteLineAction,
  updateQuoteLineAction,
  deleteQuoteLineAction,
  submitQuoteAction,
  withdrawQuoteApprovalAction,
  approveQuoteAction,
  rejectQuoteAction,
  declineQuoteAction,
  cancelQuoteAction,
  convertQuoteAction,
  selectQuote
} from './quotes/store.js';

export {
  selectSalesOrder,
  fetchSalesOrders,
  fetchSalesOrderDetail,
  shipSalesOrderAction,
  cancelSalesOrderAction
} from './salesOrders/store.js';

import {
  fetchDepartments,
  createDepartmentAction,
  filterDeclaredSkills,
  updateDepartmentSkillsAction,
  getEffectiveSkills,
  computeSkillDiff,
  getCurrentUserEffectiveSkills,
  completeDepartmentSetupTask
} from './departments/store.js';

import {
  fetchPartners,
  createPartnerAction,
  createVendorAction,
  fetchVendors,
  updatePartnerAction
} from './partners/store.js';

import {
  resolveCategoryFlags,
  fetchProducts,
  getProductDetailAction,
  createProductAction,
  addProductVariantAction,
  updateProductVariantAction,
  addProductUnitAction,
  updateProductUnitAction,
  addSupplySourceAction,
  updateSupplySourceAction,
  addBomItemAction
} from './products/store.js';

import {
  fetchPurchaseOrders,
  fetchPurchaseOrderDetail,
  selectPurchaseOrder,
  createPurchaseOrderAction,
  updatePurchaseOrderHeaderAction,
  addPurchaseOrderLineAction,
  updatePurchaseOrderLineAction,
  removePurchaseOrderLineAction,
  submitPurchaseOrderAction,
  confirmPurchaseOrderReceivedAction,
  cancelPurchaseOrderAction
} from './purchaseOrders/store.js';

import {
  fetchWarehouses,
  createWarehouseAction,
  updateWarehouseAction,
  setDefaultWarehouseAction,
  deactivateWarehouseAction,
  reactivateWarehouseAction,
  fetchInventoryLevels
} from './warehouses/store.js';

import {
  formatAdjustmentReason,
  formatAdjustmentStatus,
  fetchInventoryAdjustments,
  fetchInventoryAdjustmentDetail,
  selectInventoryAdjustment,
  createInventoryAdjustmentAction,
  updateInventoryAdjustmentHeaderAction,
  addInventoryAdjustmentLineAction,
  updateInventoryAdjustmentLineAction,
  removeInventoryAdjustmentLineAction,
  postInventoryAdjustmentAction,
  cancelInventoryAdjustmentAction
} from './inventoryAdjustments/store.js';

import {
  isStocktakeLineCounted,
  STOCKTAKE_STATUS_META,
  getStocktakeStatusBadgeClass,
  isStocktakeMovementConflictError,
  formatStocktakeStatus,
  formatStocktakeProgress,
  fetchStocktakes,
  fetchStocktakeDetail,
  resetStocktakeDetailSequences,
  selectStocktake,
  normalizeStocktakeInput,
  createStocktakeAction,
  updateStocktakeHeaderAction,
  addStocktakeLinesAction,
  addStocktakeLinesFromStockAction,
  removeStocktakeLineAction,
  startStocktakeCountingAction,
  patchStocktakeInList,
  STOCKTAKE_VARIANCE_EPSILON,
  classifyStocktakeLineVariance,
  calculateStocktakePostSummary,
  formatStocktakeConflictLineLabel,
  parseStocktakeConflictLines,
  getLineUpdateSeqsSize,
  setStocktakeCountedQuantityAction,
  refreshStocktakeSystemQuantityAction,
  postStocktakeAction,
  cancelStocktakeAction
} from './stocktakes/store.js';

import {
  patchStockTransferInList,
  fetchStockTransfers,
  fetchStockTransferDetail,
  createStockTransferAction,
  updateStockTransferHeaderAction,
  addStockTransferLineAction,
  updateStockTransferLineAction,
  removeStockTransferLineAction,
  postStockTransferAction,
  cancelStockTransferAction
} from './stockTransfers/store.js';

function loadTaskPanelCollapsed() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = localStorage.getItem('agent_erp_task_panel_collapsed');
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load taskPanelCollapsed from localStorage:", e);
    }
  }
  return false;
}

function loadUserCreatedTaskIds() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = localStorage.getItem('agent_erp_user_created_task_ids');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch (e) {
      console.warn("Failed to load userCreatedTaskIds from localStorage:", e);
    }
  }
  return new Set();
}

/**
 * Tracks a task created by the user so it remains visible in TaskPanel
 * @param {string} id
 */
export function trackUserCreatedTaskId(id) {
  if (!id) return;
  if (!appState.userCreatedTaskIds) {
    appState.userCreatedTaskIds = new Set();
  }
  appState.userCreatedTaskIds.add(id);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem('agent_erp_user_created_task_ids', JSON.stringify(Array.from(appState.userCreatedTaskIds)));
    } catch (e) {}
  }
}

// Define the global reactive app state using Svelte 5 $state
export const appState = $state({
  route: '/app/agent',
  version: '0.1.0',

  get activeWorkspace() {
    if (this.route === '/app/agent') return 'agent';
    if (this.route === '/app/settings') return 'settings';
    
    // Generic fallback for any other workspaces like /app/xxx or /app/xxx/yyy
    const match = this.route.match(/^\/app\/([^/?#]+)/);
    if (match) return match[1];
    
    return 'agent';
  },

  set activeWorkspace(ws) {
    let targetRoute = `/app/${ws}`;
    if (ws === 'agent') targetRoute = '/app/agent';
    else if (ws === 'settings') targetRoute = '/app/settings';
    
    this.route = targetRoute;
    if (typeof window !== 'undefined' && window.location && window.location.hash !== '#' + targetRoute) {
      window.location.hash = targetRoute;
    }
  },

  // Warehouse master modal state (M12 single warehouse creation entry)
  isCreateWarehouseModalOpen: false,
  /** @type {((wh?: any) => (Promise<any> | void)) | null} */
  createWarehouseSuccessCallback: null,

  // Chat panel state
  /** @type {Array<{ role: string, content: string }>} */
  chatMessages: [
    { role: 'assistant', content: '你好，我是 AgentERP 智能助理。我已經載入本地安全邊緣工作站上下文，隨時可以為您服務。' }
  ],
  isChatStreaming: false,
  currentStreamContent: '',

  // Task-driven workflow state
  /** @type {any[]} */
  tasks: [],
  /** @type {string | null} */
  activeTaskId: null, // null = 主 Agent 環境對話；字串 = 子任務對話
  taskPanelCollapsed: loadTaskPanelCollapsed(),
  /** @type {Set<string>} */
  userCreatedTaskIds: loadUserCreatedTaskIds(),
  /** @type {Record<string, Array<{ role: string, content: string, timestamp?: number }>>} */
  taskMessages: {},

  // Database cache lists
  /** @type {any[]} */
  auditLogs: [],
  /** @type {any[]} */
  notifications: [],

  // System updater status
  updateAvailable: false,
  updateNotes: '',
  updateStatus: 'idle', // 'idle' | 'checking' | 'downloading' | 'finished' | 'up-to-date'
  updateProgress: { percent: 0, downloaded: 0, total: 100 },
  /** @type {any} */
  activeUpdate: null, // Tauri updater instance
  /** @type {string | null} */
  toastMessage: null, // Toast popup message
  
  // Auth state
  /** @type {string} */
  authStatus: 'unauthenticated', // 'unauthenticated' | 'needs_tenant_selection' | 'needs_tenant_creation' | 'authenticated'
  /** @type {AuthUser | null} */
  authUser: null,
  /** @type {AuthTenant[]} */
  authTenants: [],
  /** @type {AuthTenant | null} */
  activeTenant: null,

  // Departments cache
  /** @type {any[]} */
  departments: [],

  // Tenant members cache
  /** @type {any[]} */
  members: [],

  // Partners (Customers / Vendors) cache
  /** @type {any[]} */
  partners: [],

  // Products cache
  /** @type {any[]} */
  products: [],
  /** @type {any | null} */
  currentProductDetail: null,

  // Warehouses cache (Issue #179)
  /** @type {any[]} */
  warehouses: [],

  // Purchase Orders & Inventory cache (Issue #164, #165)
  /** @type {any[]} */
  purchaseOrders: [],
  /** @type {any | null} */
  currentPurchaseOrderDetail: null,
  /** @type {string | null} */
  selectedPurchaseOrderId: null,
  /** @type {any[]} */
  inventoryLevels: [],
  /** @type {any[]} */
  inventoryMovements: [],

  // Inventory Adjustments cache (Issue #180, #183)
  /** @type {any[]} */
  inventoryAdjustments: [],
  /** @type {any | null} */
  currentInventoryAdjustmentDetail: null,
  /** @type {string | null} */
  selectedInventoryAdjustmentId: null,

  // Stocktakes cache (Issue #184)
  /** @type {any[]} */
  stocktakes: [],
  /** @type {any | null} */
  currentStocktakeDetail: null,
  /** @type {string | null} */
  selectedStocktakeId: null,

  // Unit Conversions cache (Issue #230)
  /** @type {any[]} */
  unitConversions: [],
  /** @type {any | null} */
  currentUnitConversion: null,
  /** @type {string | null} */
  selectedUnitConversionId: null,

  // Stock Transfers cache (Issue #185)
  /** @type {any[]} */
  stockTransfers: [],
  /** @type {any | null} */
  currentStockTransferDetail: null,
  /** @type {string | null} */
  selectedStockTransferId: null,

  // Opening Payables cache (Issue #200)
  /** @type {any[]} */
  openingPayables: [],
  /** @type {any | null} */
  currentOpeningPayableDetail: null,

  // Opening Receivables cache (Issue #224)
  /** @type {any[]} */
  openingReceivables: [],
  /** @type {any | null} */
  currentOpeningReceivableDetail: null,

  // Vendor Bills cache (Issue #202)
  /** @type {any[]} */
  vendorBills: [],
  /** @type {any | null} */
  currentVendorBillDetail: null,
  /** @type {string | null} */
  selectedVendorBillId: null,
  /** @type {any[]} */
  unbilledReceivedOrders: [],

  // Vendor Payments & Accounts Payable cache (Issue #203)
  /** @type {any[]} */
  vendorPayments: [],
  /** @type {any | null} */
  currentVendorPaymentDetail: null,
  /** @type {string | null} */
  selectedVendorPaymentId: null,
  /** @type {any[]} */
  accountsPayable: [],
  /** @type {any | null} */
  currentAccountPayableDetail: null,
  /** @type {any | null} */
  payablesAgingReport: null,

  // Quotes cache (Issue #231, #232, #233)
  /** @type {any[]} */
  quotes: [],
  /** @type {any | null} */
  currentQuoteDetail: null,
  /** @type {string | null} */
  selectedQuoteId: null,
  /** @type {string | null} */
  pendingQuoteDetailId: null,
  /** @type {any[]} */
  pendingApprovalQuotes: [],

  // Sales Orders cache (Issue #220, #221)
  /** @type {any[]} */
  salesOrders: [],
  /** @type {any | null} */
  currentSalesOrderDetail: null,
  /** @type {string | null} */
  selectedSalesOrderId: null,

  // Lightweight task confirmation state
  /** @type {import('./workflow/types.js').PendingConfirmation | null} */
  pendingTaskConfirmation: null
});

let toastTimer = null;

export function showToast(message) {
  if (typeof window !== 'undefined' && toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  appState.toastMessage = message;
  if (typeof window !== 'undefined') {
    toastTimer = setTimeout(() => {
      appState.toastMessage = null;
      toastTimer = null;
    }, 3500);
  }
}

/**
 * Dispatch an in-app notification to appState.notifications and trigger toast feedback
 * @param {{
 *   type?: 'success' | 'info' | 'warning' | 'error' | 'alert' | 'critical',
 *   level?: string,
 *   title: string,
 *   message: string,
 *   sourceModule?: string,
 *   action?: { label: string, target: string } | null,
 *   persistent?: boolean,
 *   timestamp?: number,
 *   id?: string
 * }} payload
 * @returns {string} notification ID
 */
export function dispatchNotification(payload) {
  if (!payload || !payload.message) {
    return '';
  }
  const id = payload.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = {
    id,
    type: payload.type || payload.level || 'alert',
    level: payload.level || payload.type || 'alert',
    title: payload.title || '系統通知',
    message: payload.message,
    sourceModule: payload.sourceModule || 'system',
    action: payload.action || null,
    persistent: payload.persistent !== undefined ? payload.persistent : true,
    timestamp: payload.timestamp || Date.now(),
    time: '剛剛'
  };

  appState.notifications = [item, ...appState.notifications];

  // Also trigger toast so user sees immediate feedback
  showToast(`${item.title}：${item.message}`);

  return id;
}

/**
 * Dismiss a notification by ID
 * @param {string} id
 */
export function dismissNotification(id) {
  appState.notifications = appState.notifications.filter(n => n.id !== id);
}

// Initialize window.__SHELL__ global notification API adhering to docs/system_design/notification_system.md
if (typeof window !== 'undefined') {
  const win = /** @type {any} */ (window);
  win.__SHELL__ = win.__SHELL__ || {};
  win.__SHELL__.notify = function(payload) {
    return dispatchNotification(payload);
  };
  win.__SHELL__.dismiss = function(id) {
    return dismissNotification(id);
  };
}

export function navigate(path) {
  invalidateNavigationStaleness();
  if (typeof window !== 'undefined' && window.location) {
    window.location.hash = path;
  }
  appState.route = path;
}

export function getWorkspaceLabel(workspace) {
  const ws = (typeof workspace === 'string' && workspace.startsWith('/app/'))
    ? workspace.slice(5)
    : workspace;
  if (ws === 'agent') return 'AI 助理對話';
  if (ws === 'settings') return '系統設定';
  if (ws === 'purchase-orders') return '採購單';
  if (ws === 'inventory') return '庫存查詢';
  if (ws === 'warehouses' || ws === 'warehouse') return '倉庫管理';
  if (ws === 'accounts-payable') return '應付帳款';
  if (ws === 'vendor-bills' || ws === 'bills') return '請款單';
  if (ws === 'quotes' || ws === 'quote') return '報價單';
  if (ws === 'sales-orders' || ws === 'sales-order') return '銷售單';
  if (ws === 'customer-credit' || ws === 'customer-credits') return '客戶信用';
  return '業務工作區';
}

/**
 * Format currency amount with NT$ prefix
 * @param {number | string | null | undefined} amount
 * @returns {string}
 */
export function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '-';
  const val = Number(amount || 0);
  return `NT$ ${val.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Format unix timestamp into standard date/time string
 * @param {number | null | undefined} timestamp
 * @returns {string}
 */
export function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatAuditDecision(decision) {
  if (decision === 'approved') return '核准 (Approved)';
  if (decision === 'rejected_unauthorized') return '未授權阻斷 (Unauthorized)';
  return '拒絕 (Rejected)';
}

async function pub_fn(name) {} // Stub helper

// Fetch audit logging trail from SQLite
pub_fn("fetchAuditLogs");
export async function fetchAuditLogs() {
  try {
    const list = await invoke('get_audit_logs');
    appState.auditLogs = list || [];
    return appState.auditLogs;
  } catch (err) {
    console.error("Failed to fetch audit logs:", err);
    return [];
  }
}



// Query public update manifest URL
export async function checkForUpdates() {
  appState.updateStatus = 'checking';
  showToast("正在連線雲端檢查更新...");
  try {
    const update = await check();
    if (update && update.available) {
      appState.updateAvailable = true;
      appState.updateStatus = 'idle';
      appState.updateNotes = update.body || '安全升級與效能優化版本。';
      appState.activeUpdate = update;
      showToast("偵測到新版本！已於首頁載入更新橫幅。");
      
      // Dispatch alert to notifications hub
      appState.notifications.unshift({
        id: 'notify-update',
        title: `主程式更新可用 v${update.version || '0.2.0'}`,
        message: 'Tauri 邊緣端主程式已有新版本，請前往首頁進行安全下載更新。'
      });
    } else {
      appState.updateAvailable = false;
      appState.updateStatus = 'up-to-date';
      showToast(`主程式已是最新版本 (v${appState.version})！無需更新。`);
    }
  } catch (err) {
    console.warn("Tauri updater connection failed, falling back to local simulation:", err);
    // Offline simulation fallback for user testing
    appState.updateAvailable = true;
    appState.updateNotes = "主要優化：\n1. 優化 Svelte 5 Runes 渲染引擎\n2. 升級 Rust 邊緣 SQLite 加密協議 (SQLCipher)\n3. 修正 Windows/macOS 系統更新偶發閃退問題。";
    appState.updateStatus = 'idle';
    showToast("已進入模擬測試：已載入模擬更新資訊。");
  }
}

// Run actual Tauri update download and install, fallback to simulation if offline
pub_fn("installUpdate");
export async function installUpdate() {
  if (appState.activeUpdate) {
    appState.updateStatus = 'downloading';
    appState.updateProgress = { percent: 0, downloaded: 0, total: 100 };
    try {
      let downloaded = 0;
      await appState.activeUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          appState.updateProgress.total = event.data.contentLength || 2540000;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          appState.updateProgress.downloaded = downloaded;
          appState.updateProgress.percent = Math.round((downloaded / appState.updateProgress.total) * 100);
        } else if (event.event === 'Finished') {
          appState.updateStatus = 'finished';
        }
      });
      // Relaunch app
      await relaunch();
    } catch (err) {
      console.warn("Real install failed (unsigned dev build), running mock upgrade:", err);
      runMockUpgrade();
    }
  } else {
    runMockUpgrade();
  }
}

function runMockUpgrade() {
  appState.updateStatus = 'downloading';
  appState.updateProgress = { percent: 0, downloaded: 0, total: 2450000 };
  
  let pct = 0;
  const interval = setInterval(async () => {
    pct += 5;
    appState.updateProgress.percent = pct;
    appState.updateProgress.downloaded = Math.round((pct / 100) * 2450000);
    
    if (pct >= 100) {
      clearInterval(interval);
      appState.updateStatus = 'finished';
      
      // Simulate relaunch reboot delay
      setTimeout(() => {
        appState.version = '0.2.0';
        appState.updateAvailable = false;
        appState.updateStatus = 'up-to-date';
        
        // Remove update notification
        appState.notifications = appState.notifications.filter(n => n.id !== 'notify-update');
        
        appState.chatMessages.push({
          role: 'assistant',
          content: '主程式已成功重啟並完成升級！當前外殼版本：v0.2.0。'
        });
      }, 1500);
    }
  }, 100);
}

/**
 * Check current authentication status from backend
 * @returns {Promise<AuthStatusResponse | undefined>}
 */
export async function checkAuthStatus() {
  try {
    /** @type {AuthStatusResponse} */
    const res = await invoke('get_auth_status');
    appState.authStatus = res.status;
    appState.authUser = res.user;
    appState.authTenants = res.tenants;
    appState.activeTenant = res.activeTenant;
    return res;
  } catch (err) {
    console.error("Failed to check auth status:", err);
    appState.authStatus = 'unauthenticated';
    appState.authUser = null;
    appState.authTenants = [];
    appState.activeTenant = null;
  }
}

/**
 * Generic API Call helper that handles token expiration globally
 * @param {string} method
 * @param {string} path
 * @param {Record<string, any>} [body]
 * @returns {Promise<any>}
 */
export async function apiCall(method, path, body = {}) {
  try {
    const res = await invoke('api_call', { method, path, body });
    if (path === '/v1/auth/register-tenant' && res?.tenants?.[0]) {
      appState.activeTenant = res.tenants[0];
      appState.departments = [];
    }
    return res;
  } catch (err) {
    const errorObj = /** @type {any} */ (err);
    const errCode = errorObj?.code || (typeof err === 'string' ? err : '');
    const errMsg = errorObj?.message || (typeof err === 'string' ? err : '');
    const isAuthExpired = 
      errCode === 'IAM_ERR_INVALID_CREDENTIALS' ||
      errMsg.includes('401') ||
      errMsg.includes('UNAUTHENTICATED') ||
      errMsg.includes('invalid credentials');

    if (path !== '/v1/auth/login' && isAuthExpired) {
      showToast('登入已過期');
      appState.authStatus = 'unauthenticated';
      appState.authUser = null;
      appState.authTenants = [];
      appState.activeTenant = null;
      navigate('/login');
    }
    throw err;
  }
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<any>}
 */
export async function login(email, password) {
  const res = await apiCall('POST', '/v1/auth/login', { email, password, client_type: 'app' });
  await checkAuthStatus();
  if (appState.authStatus === 'authenticated' && appState.activeTenant) {
    await Promise.all([
      fetchTasks(),
      fetchDepartments(),
      fetchPartners(),
      fetchWarehouses(),
      fetchMembers()
    ]);
  }
  return res;
}

/**
 * @param {string} adminName
 * @param {string} tenantName
 * @param {string} companyName
 * @param {string} adminEmail
 * @param {string} adminPassword
 * @param {string} tenantCode
 * @returns {Promise<any>}
 */
/**
 * Declarative definition for initial tenant onboarding subtasks
 */
export const ONBOARDING_STEPS = [
  {
    title: '設定部門',
    skillId: 'department.manage',
    moduleId: 'sales',
    assignee: '主管',
    guidanceMessage: (tenantName) =>
      `您好！我是部門設定助理。新租戶「${tenantName}」建立完成後，首要步驟是建立組織部門。請問您想先新增哪一個部門？`
  },
  {
    title: '建立第一個客戶',
    skillId: 'customer.create_basic_profile',
    moduleId: 'sales',
    assignee: '主管',
    guidanceMessage: (tenantName) =>
      `您好！我是客戶管理助理。新租戶「${tenantName}」建立完成後，讓我們來建立第一筆客戶基本資料。請問您想先新增哪一位客戶？（例如：「我想新增台積電 統編 22099131」）`
  },
  {
    title: '建立第一個供應商',
    skillId: 'vendor.create_basic_profile',
    moduleId: 'sales',
    assignee: '主管',
    guidanceMessage: (tenantName) =>
      `您好！我是供應商管理助理。新租戶「${tenantName}」建立完成後，讓我們來建立第一筆供應商基本資料。請問您想先新增哪一家供應商？（例如：「我想新增欣興電子 統編 11223344」）`
  },
  {
    title: '建立第一個商品',
    skillId: 'product.create_basic_profile',
    skills: ['product.create_basic_profile', 'product.manage'],
    moduleId: 'sales',
    assignee: '主管',
    guidanceMessage: (tenantName) =>
      `您好！我是商品資料管理助理。新租戶「${tenantName}」建立完成後，讓我們來建立第一筆商品基本資料。請問您想先新增哪一項商品？（例如：「我想新增智能核心晶片 分類 轉售商品 售價 120」）`
  }
];

let isSyncingOnboarding = false;

/**
 * Shared helper to seed onboarding parent and child tasks
 * @param {string} tenantName
 */
export async function seedOnboardingTasks(tenantName) {
  isSyncingOnboarding = true;
  try {
    const parentTask = await createTaskAction('新租戶起步', 'sales', '主管', null);

    for (const step of ONBOARDING_STEPS) {
      const subTask = await createTaskAction(
        step.title,
        step.moduleId || 'sales',
        step.assignee || '主管',
        parentTask.id,
        step.skillId,
        step.skills || (step.skillId ? [step.skillId] : null)
      );
      if (step.guidanceMessage) {
        const msg = typeof step.guidanceMessage === 'function'
          ? step.guidanceMessage(tenantName)
          : step.guidanceMessage;
        await appendTaskMessageAction(subTask.id, 'assistant', msg);
      }
    }

    // Seed ambient conversation custom onboarding greeting for the newly created tenant
    await appendTaskMessageAction('main', 'assistant', `歡迎建立「${tenantName}」！要開始使用，我可以先幫你新增部門或邀請團隊成員，需要嗎？`);
    await fetchTasks();
  } catch (e) {
    console.warn("Failed to create onboarding tasks on tenant creation:", e);
  } finally {
    isSyncingOnboarding = false;
  }
}

/**
 * @param {string} adminName
 * @param {string} tenantName
 * @param {string} companyName
 * @param {string} adminEmail
 * @param {string} adminPassword
 * @param {string} tenantCode
 * @param {string} [taxId]
 * @returns {Promise<any>}
 */
export async function registerTenant(adminName, tenantName, companyName, adminEmail, adminPassword, tenantCode, taxId) {
  const res = await apiCall('POST', '/v1/auth/register-tenant', {
    admin_name: adminName,
    tenant_name: tenantName,
    company_name: companyName,
    admin_email: adminEmail,
    admin_password: adminPassword,
    tenant_code: tenantCode,
    tax_id: taxId || undefined
  });
  await checkAuthStatus();
  await seedOnboardingTasks(tenantName);
  return res;
}

/**
 * @returns {Promise<void>}
 */
export async function logoutAction() {
  try {
    await apiCall('POST', '/v1/auth/logout', {});
  } catch (err) {
    console.error("Failed to call logout API:", err);
  }
  appState.authStatus = 'unauthenticated';
  appState.authUser = null;
  appState.authTenants = [];
  appState.activeTenant = null;
  appState.members = [];
  appState.tasks = [];
  appState.departments = [];
  appState.partners = [];
  navigate('/login');
}

/**
 * @param {string} tenantId
 * @returns {Promise<any>}
 */
export async function selectTenantAction(tenantId) {
  const res = await apiCall('POST', '/v1/auth/select-tenant', { tenant_id: tenantId });
  await checkAuthStatus();
  await Promise.all([
    fetchTasks(),
    fetchDepartments(),
    fetchPartners(),
    fetchProducts(),
    fetchWarehouses(),
    fetchMembers()
  ]);
  return res;
}

/**
 * @param {string} tenantName
 * @param {string} companyName
 * @param {string} tenantCode
 * @param {string} [taxId]
 * @returns {Promise<any>}
 */
export async function createTenantAction(tenantName, companyName, tenantCode, taxId) {
  const res = await apiCall('POST', '/v1/auth/create-tenant', {
    tenant_name: tenantName,
    company_name: companyName,
    tenant_code: tenantCode,
    tax_id: taxId
  });
  await checkAuthStatus();
  await seedOnboardingTasks(tenantName);
  return res;
}

/**
 * Ensures all declarative ONBOARDING_STEPS subtasks exist under any '新租戶起步' parent task.
 * Self-heals existing databases and tenants that were created before newer onboarding subtasks were added.
 * @param {any[]} tasks
 * @returns {Promise<any[]>}
 */
export async function ensureOnboardingTasksSynced(tasks) {
  if (isSyncingOnboarding) return tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks;

  const parentTask = tasks.find(t => t.title === '新租戶起步');
  if (!parentTask) return tasks;

  const missingSteps = ONBOARDING_STEPS.filter(step => {
    return !tasks.some(t => 
      t.parent_task_id === parentTask.id && 
      (t.title === step.title || (step.skillId && (t.skill_id === step.skillId || t.skillId === step.skillId)))
    );
  });

  if (missingSteps.length === 0) return tasks;

  isSyncingOnboarding = true;
  try {
    for (const step of missingSteps) {
      const subTask = await invoke('create_task', {
        title: step.title,
        moduleId: step.moduleId || 'sales',
        assignee: step.assignee || '主管',
        parentTaskId: parentTask.id,
        parent_task_id: parentTask.id,
        skillId: step.skillId,
        skill_id: step.skillId,
        skills: step.skills || (step.skillId ? [step.skillId] : null)
      });
      if (step.guidanceMessage && subTask?.id) {
        const msg = typeof step.guidanceMessage === 'function'
          ? step.guidanceMessage(appState.activeTenant?.name || '')
          : step.guidanceMessage;
        await appendTaskMessageAction(subTask.id, 'assistant', msg);
      }
    }
    const refreshed = await invoke('list_tasks', { moduleId: '' });
    return refreshed || tasks;
  } catch (err) {
    console.warn("Failed to sync onboarding tasks:", err);
    return tasks;
  } finally {
    isSyncingOnboarding = false;
  }
}

/**
 * Deduplicate onboarding subtasks under the same parent task sharing the same title
 * Prefers 'done' > 'in_progress' > 'pending', or the earliest created task.
 * @param {any[]} tasks
 * @returns {any[]}
 */
export function deduplicateOnboardingTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length <= 1) return tasks || [];

  const onboardingTitles = new Set(ONBOARDING_STEPS.map(s => s.title));
  const seen = new Map();
  const nonOnboarding = [];

  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;
    if (t.parent_task_id && onboardingTitles.has(t.title)) {
      const key = `${t.parent_task_id}:${(t.title || '').trim()}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        // Prioritize 'done' status over pending
        if (existing.status !== 'done' && t.status === 'done') {
          seen.set(key, t);
        }
      } else {
        seen.set(key, t);
      }
    } else {
      nonOnboarding.push(t);
    }
  }

  return [...nonOnboarding, ...seen.values()];
}

/**
 * Fetch tasks from SQLite
 * @param {string | null} [moduleId]
 * @returns {Promise<any[]>}
 */
export async function fetchTasks(moduleId = null) {
  try {
    const list = await invoke('list_tasks', {
      moduleId: moduleId ? moduleId.trim() : ''
    });
    let tasks = list || [];
    if (!moduleId) {
      tasks = await ensureOnboardingTasksSynced(tasks);
    }
    tasks = deduplicateOnboardingTasks(tasks);
    appState.tasks = tasks;
    return appState.tasks;
  } catch (err) {
    console.error("Failed to fetch tasks:", err);
    return [];
  }
}

/**
 * Create a task
 * @param {string} title
 * @param {string} moduleId
 * @param {string} assignee
 * @param {string | null} [parentTaskId]
 * @param {string | null} [skillId]
 * @param {string[] | null} [skills]
 * @returns {Promise<any>}
 */
export async function createTaskAction(title, moduleId, assignee, parentTaskId = null, skillId = null, skills = null) {
  try {
    const task = await invoke('create_task', {
      title,
      moduleId,
      assignee,
      parentTaskId: parentTaskId || null,
      skillId: skillId || null,
      parent_task_id: parentTaskId || null,
      skill_id: skillId || null,
      skills: Array.isArray(skills) ? skills : (skillId ? [skillId] : null)
    });
    if (task?.id) {
      trackUserCreatedTaskId(task.id);
    }
    await fetchTasks();
    return task;
  } catch (err) {
    console.error("Failed to create task:", err);
    throw err;
  }
}

/**
 * Switch active task conversation
 * @param {string | null} taskId
 */
export async function switchActiveTask(taskId) {
  appState.activeTaskId = taskId;
  const targetKey = taskId || 'main';
  try {
    let msgs = await invoke('get_task_messages', { taskId: targetKey });
    msgs = msgs || [];

    // 通用開場白機制：若 taskId 存在且訊息數為 0，動態產生並儲存一次性開場白快照
    if (taskId && msgs.length === 0) {
      const task = appState.tasks.find(t => t.id === taskId);
      if (task) {
        const subTasks = appState.tasks.filter(t => t.parent_task_id === task.id);
        const total = subTasks.length;
        let greeting = '';
        if (total > 0) {
          const done = subTasks.filter(t => t.status === 'done').length;
          greeting = `您好，我是「${task.title}」的協助人員。目前進度：${done}/${total} 個子任務已完成。`;
        } else {
          greeting = `您好，我是「${task.title}」的協助人員，請問需要什麼協助？`;
        }
        await appendTaskMessageAction(taskId, 'assistant', greeting);
        msgs = appState.taskMessages[targetKey] || [];
      }
    }

    appState.taskMessages[targetKey] = msgs;
    if (!taskId) {
      if (msgs && msgs.length > 0) {
        appState.chatMessages = msgs;
      }
    }
  } catch (err) {
    console.error(`Failed to fetch messages for ${targetKey}:`, err);
  }
}

/**
 * Set and persist task panel collapsed state
 * @param {boolean} collapsed
 */
export function setTaskPanelCollapsed(collapsed) {
  appState.taskPanelCollapsed = Boolean(collapsed);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem('agent_erp_task_panel_collapsed', JSON.stringify(appState.taskPanelCollapsed));
    } catch (e) {
      console.warn("Failed to save taskPanelCollapsed to localStorage:", e);
    }
  }
}

/**
 * Append message to task conversation
 * @param {string} taskId
 * @param {string} role
 * @param {string} content
 */
export async function appendTaskMessageAction(taskId, role, content) {
  const targetKey = taskId || 'main';
  try {
    await invoke('append_task_message', { taskId: targetKey, role, content });
    if (!appState.taskMessages[targetKey]) {
      appState.taskMessages[targetKey] = [];
    }
    appState.taskMessages[targetKey].push({
      role,
      content,
      timestamp: Math.floor(Date.now() / 1000)
    });
    if (targetKey === 'main' || !appState.activeTaskId) {
      appState.chatMessages = [...(appState.taskMessages['main'] || [])];
    }
  } catch (err) {
    console.error("Failed to append task message:", err);
  }
}

/**
 * Update task status
 * @param {string} taskId
 * @param {string} status
 */
export async function updateTaskStatusAction(taskId, status) {
  try {
    await invoke('update_task_status', { taskId, status });
    await fetchTasks();
  } catch (err) {
    console.error("Failed to update task status:", err);
  }
}

export { getDeclaredSkills, getSkillsByDomain, KNOWN_DOMAINS };

/**
 * Fetch tenant members from Mock / Backend
 * @returns {Promise<any[]>}
 */
export async function fetchMembers() {
  try {
    const res = await apiCall('GET', '/v1/tenant-admin/members');
    appState.members = res?.members || (Array.isArray(res) ? res : []);
    return appState.members;
  } catch (err) {
    console.error("Failed to fetch members:", err);
    return [];
  }
}

/**
 * Filter task list based on user's effective skill set (Issue #132).
 * Tasks declaring a skillId / skill_id must match one of user's effective skills.
 * Tasks without skillId (unrestricted/parent tasks) are preserved.
 * User-created tasks are also preserved so creators never lose their own tasks.
 *
 * @param {any[]} tasks
 * @param {string[] | Set<string> | null | undefined} [effectiveSkills]
 * @param {any} [currentUser]
 * @returns {any[]}
 */
export function filterTasksBySkills(tasks, effectiveSkills = getCurrentUserEffectiveSkills(), currentUser = appState.authUser) {
  if (!tasks || !Array.isArray(tasks)) {
    return [];
  }

  let skillSet;
  if (effectiveSkills instanceof Set) {
    skillSet = new Set(Array.from(effectiveSkills).map(s => typeof s === 'string' ? s.trim() : String(s)));
  } else if (Array.isArray(effectiveSkills)) {
    skillSet = new Set(effectiveSkills.map(s => typeof s === 'string' ? s.trim() : String(s)));
  } else {
    skillSet = new Set();
  }

  const currentUserId = currentUser?.id || currentUser?.user_id;
  const currentUserEmail = currentUser?.email;

  return tasks.filter(task => {
    if (!task || typeof task !== 'object') {
      return false;
    }

    // User-created tasks exception: creators can always see tasks they created
    if (task.created_by && ((currentUserId && task.created_by === currentUserId) || (currentUserEmail && task.created_by === currentUserEmail))) {
      return true;
    }
    if (appState.userCreatedTaskIds && appState.userCreatedTaskIds.has(task.id)) {
      return true;
    }

    const rawSkillId = task.skillId || task.skill_id;
    let taskSkills = [];
    if (Array.isArray(task.skills) && task.skills.length > 0) {
      taskSkills = task.skills.map(s => typeof s === 'string' ? s.trim() : String(s).trim()).filter(Boolean);
    } else if (typeof rawSkillId === 'string' && rawSkillId.trim()) {
      taskSkills = rawSkillId.split(',').map(s => s.trim()).filter(Boolean);
    } else if (rawSkillId) {
      const trimmed = String(rawSkillId).trim();
      if (trimmed) taskSkills = [trimmed];
    }

    if (taskSkills.length === 0) {
      // Unrestricted task (e.g. parent task or general task without skill requirement)
      return true;
    }

    return taskSkills.some(s => skillSet.has(s));
  });
}

/**
 * Onboard a new member to the active tenant
 * @param {{ name: string, email: string, role?: string, department_ids?: string[] }} payload
 * @returns {Promise<any>}
 */
export async function onboardMemberAction({ name, email, role = 'member', department_ids = [] }) {
  try {
    const trimmedName = (name || '').trim();
    const trimmedEmail = (email || '').trim();
    const trimmedRole = (role || 'member').trim().toLowerCase();
    const validDepartmentIds = Array.isArray(department_ids)
      ? [...new Set(department_ids.map(d => String(d).trim()).filter(Boolean))]
      : [];

    if (!trimmedName || !trimmedEmail) {
      throw new Error('姓名與電子郵件為必填項目');
    }

    const res = await apiCall('POST', '/v1/tenant-admin/members/onboard', {
      name: trimmedName,
      email: trimmedEmail,
      role: trimmedRole,
      department_ids: validDepartmentIds
    });
    await fetchMembers();
    if (appState.departments.length === 0) {
      await fetchDepartments();
    }
    showToast(`已成功新增成員「${trimmedName}」`);
    return res;
  } catch (err) {
    console.error("Failed to onboard member:", err);
    throw err;
  }
}

/**
 * Assign / update member role
 * @param {string} userId
 * @param {string} role
 * @returns {Promise<any>}
 */
export async function assignMemberRoleAction(userId, role) {
  try {
    const trimmedUserId = (userId || '').trim();
    const trimmedRole = (role || '').trim().toLowerCase();

    if (!trimmedUserId || !trimmedRole) {
      throw new Error('使用者 ID 與角色為必填項目');
    }

    const res = await apiCall('POST', '/v1/tenant-admin/members/assign-role', {
      user_id: trimmedUserId,
      role: trimmedRole
    });
    await fetchMembers();
    showToast(`成員角色已更新為 ${trimmedRole.toUpperCase()}`);
    return res;
  } catch (err) {
    console.error("Failed to assign member role:", err);
    throw err;
  }
}

/**
 * Assign / update member departments (multi-select)
 * @param {string} userId
 * @param {string[]} departmentIds
 * @returns {Promise<any>}
 */
export async function assignMemberDepartmentsAction(userId, departmentIds) {
  try {
    const trimmedUserId = (userId || '').trim();
    if (!trimmedUserId) {
      throw new Error('使用者 ID 為必填項目');
    }
    const validDepartmentIds = Array.isArray(departmentIds)
      ? [...new Set(departmentIds.map(d => String(d).trim()).filter(Boolean))]
      : [];

    const res = await apiCall('POST', '/v1/tenant-admin/members/assign-departments', {
      user_id: trimmedUserId,
      department_ids: validDepartmentIds
    });
    await fetchMembers();
    showToast('成員部門已成功更新');
    return res;
  } catch (err) {
    console.error("Failed to assign member departments:", err);
    throw err;
  }
}

/**
 * Check if the active tenant role has member management permissions (admin or owner)
 * @param {AuthTenant | null} [tenant]
 * @returns {boolean}
 */
export function canManageMembers(tenant = appState.activeTenant) {
  const role = (tenant?.role || '').trim().toLowerCase();
  return role === 'admin' || role === 'owner';
}

/**
 * Set pending task confirmation
 * @param {import('./workflow/types.js').PendingConfirmation | any} confirmation
 */
export function setPendingTaskConfirmation(confirmation) {
  appState.pendingTaskConfirmation = {
    toolName: confirmation.toolName || confirmation.type,
    handler: confirmation.handler,
    args: confirmation.args || confirmation.payload || {},
    confirmText: confirmation.confirmText || '',
    taskId: confirmation.taskId || confirmation.payload?.taskId || appState.activeTaskId,
    confirmLabel: confirmation.confirmLabel || '確認',
    cancelLabel: confirmation.cancelLabel || '取消',
    // Backward compatibility fields
    type: confirmation.type || confirmation.toolName,
    payload: confirmation.payload || confirmation.args || {}
  };
}

/**
 * Clear pending task confirmation
 */
export function clearPendingTaskConfirmation() {
  appState.pendingTaskConfirmation = null;
}

/**
 * Confirm pending task action (Domain-agnostic via ToolHandler)
 */
export async function confirmPendingTaskAction() {
  const conf = appState.pendingTaskConfirmation;
  if (!conf) return;

  const taskId = conf.taskId || conf.payload?.taskId || appState.activeTaskId;
  clearPendingTaskConfirmation();

  try {
    const { content, toolName, completesTask, cancelsTask, summary, toast } = await executeConfirmation(conf, { 
      taskId, 
      activeTask: appState.tasks.find(t => t.id === taskId) 
    });

    if (taskId && content) {
      await appendTaskMessageAction(taskId, 'assistant', content);
    }

    if (taskId && completesTask) {
      await updateTaskStatusAction(taskId, 'done');
    } else if (taskId && cancelsTask) {
      await updateTaskStatusAction(taskId, 'cancelled');
    } else if (taskId) {
      const currentTask = appState.tasks.find(t => t.id === taskId);
      if (currentTask && currentTask.status === 'pending') {
        await updateTaskStatusAction(taskId, 'in_progress');
      }
    }

    if (summary) {
      await appendTaskMessageAction('main', 'assistant', summary);
    }

    if (toolName === 'create_department' || toolName === 'list_departments') {
      await fetchDepartments();
    }

    if (toolName && toolName.includes('purchase_order')) {
      try {
        await fetchPurchaseOrders();
        await fetchInventoryLevels();
      } catch (e) {
        console.warn("Failed to refresh purchase orders or inventory after confirmation:", e);
      }
    }

    // Refresh audit logs in store
    await fetchAuditLogs();

    if (toast) {
      showToast(toast);
    } else {
      showToast(`已成功執行「${toolName}」！`);
    }
  } catch (err) {
    console.error("Failed to execute confirmation from ToolHandler:", err);
    const errorObj = /** @type {any} */ (err);
    const errorMsg = typeof err === 'string' ? err : (errorObj?.message || '執行動作失敗');
    if (taskId) {
      await appendTaskMessageAction(taskId, 'assistant', `執行動作失敗：${errorMsg}`);
    }
    showToast(`執行失敗: ${errorMsg}`);
  }
}

/**
 * Cancel pending task action (Domain-agnostic via ToolHandler)
 */
export async function cancelPendingTaskAction() {
  const conf = appState.pendingTaskConfirmation;
  const taskId = conf?.taskId || conf?.payload?.taskId || appState.activeTaskId;
  clearPendingTaskConfirmation();

  if (taskId && conf) {
    const { content } = await executeCancellation(conf, { 
      taskId, 
      activeTask: appState.tasks.find(t => t.id === taskId) 
    });
    // Refresh audit logs in store
    await fetchAuditLogs();
    if (content) {
      await appendTaskMessageAction(taskId, 'assistant', content);
    }
  }
}

/**
 * Initialize main chat greeting based on pending tasks count
 */
export async function initMainChatGreeting() {
  try {
    const tasks = await fetchTasks();
    const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
    
    const mainMsgs = await invoke('get_task_messages', { taskId: 'main' });
    if (!mainMsgs || mainMsgs.length === 0) {
      const greeting = pendingCount > 0
        ? `你好，我是 AgentERP 智能助理。您目前有 ${pendingCount} 筆待處理任務。想從下方的任務開始，或直接跟我說您需要什麼協助：`
        : `你好，我是 AgentERP 智能助理。我已經載入本地安全邊緣工作站上下文，隨時可以為您服務。`;
      
      await appendTaskMessageAction('main', 'assistant', greeting);
    } else {
      appState.taskMessages['main'] = mainMsgs;
      appState.chatMessages = [...mainMsgs];
    }
  } catch (err) {
    console.error("Failed to init main chat greeting:", err);
  }
}

export async function simulateTokenExpiry() {
  try {
    await apiCall('POST', '/v1/test/expire', {});
  } catch (err) {
    console.log("Token expiration simulated successfully:", err);
  }
}

/**
 * Navigate to a specific task conversation
 * @param {string} taskId
 */
export async function navigateToTask(taskId) {
  if (taskId) {
    await switchActiveTask(taskId);
  }
  navigate('/app/agent');
}


