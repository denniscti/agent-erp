// @ts-check

/**
 * @typedef {import('./bindings').AuthStatusResponse} AuthStatusResponse
 * @typedef {import('./bindings').AuthUser} AuthUser
 * @typedef {import('./bindings').AuthTenant} AuthTenant
 * @typedef {import('./bindings').ApiErrorPayload} ApiErrorPayload
 * @typedef {import('./bindings').LogoutResponse} LogoutResponse
 */

import { invoke, check, relaunch, isStocktakeLineCounted } from './tauri.js';
import { executeConfirmation, executeCancellation } from './workflow/harness.js';
import { getDeclaredSkills, getSkillsByDomain, KNOWN_DOMAINS } from './workflow/index.js';

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

  // Stock Transfers cache (Issue #185)
  /** @type {any[]} */
  stockTransfers: [],
  /** @type {any | null} */
  currentStockTransferDetail: null,
  /** @type {string | null} */
  selectedStockTransferId: null,

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

// Generic request-staleness and in-flight detail sequence management
const navigationStalenessListeners = new Set();

/**
 * Register a callback to be executed whenever route navigation occurs,
 * allowing detail flows (e.g. stocktakes, purchase orders, inventory adjustments)
 * to invalidate in-flight asynchronous requests and prevent race conditions.
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function registerNavigationStalenessListener(listener) {
  navigationStalenessListeners.add(listener);
  return () => {
    navigationStalenessListeners.delete(listener);
  };
}

/**
 * Invalidate in-flight detail requests across all registered domain flows
 */
export function invalidateNavigationStaleness() {
  for (const listener of navigationStalenessListeners) {
    try {
      listener();
    } catch (e) {
      console.warn("Error in navigation staleness listener:", e);
    }
  }
}

export function navigate(path) {
  invalidateNavigationStaleness();
  if (typeof window !== 'undefined' && window.location) {
    window.location.hash = path;
  }
  appState.route = path;
}

export function getWorkspaceLabel(workspace) {
  if (workspace === 'agent') return 'AI 助理對話';
  if (workspace === 'settings') return '系統設定';
  if (workspace === 'purchase-orders') return '採購單';
  if (workspace === 'inventory') return '庫存查詢';
  if (workspace === 'warehouses' || workspace === 'warehouse') return '倉庫管理';
  return '業務工作區';
}

/**
 * Open create warehouse modal with optional success callback
 * @param {((wh?: any) => (Promise<any> | void)) | null} [onSuccess=null]
 */
export function openCreateWarehouseModal(onSuccess = null) {
  appState.isCreateWarehouseModalOpen = true;
  appState.createWarehouseSuccessCallback = typeof onSuccess === 'function' ? onSuccess : null;
}

export function closeCreateWarehouseModal() {
  appState.isCreateWarehouseModalOpen = false;
  appState.createWarehouseSuccessCallback = null;
}

/**
 * Check if an error corresponds to W-00 (Zero Warehouse Defense)
 * @param {any} err
 * @returns {boolean}
 */
export function isZeroWarehouseError(err) {
  const errMsg = err instanceof Error ? err.message : String(err || '');
  return errMsg.includes('尚未建立任何倉別') || errMsg.includes('W-00');
}

/**
 * Handle W-00 error by opening the Create Warehouse Modal
 * @param {any} err
 * @param {((wh?: any) => (Promise<any> | void)) | null} [onSuccess=null]
 * @returns {boolean}
 */
export function handleZeroWarehouseError(err, onSuccess = null) {
  if (isZeroWarehouseError(err)) {
    openCreateWarehouseModal(onSuccess);
    return true;
  }
  return false;
}

/**
 * Format inventory movement reason into unified Traditional Chinese badge label
 * @param {string} reason
 * @returns {string}
 */
export function formatMovementReason(reason) {
  switch (reason) {
    case 'opening_balance':
      return '期初開帳';
    case 'purchase_receipt':
      return '採購單入庫';
    case 'adjustment':
    case 'inventory_adjustment':
      return '庫存調整';
    case 'stocktake':
    case 'stocktake_discrepancy':
      return '盤點盈虧';
    case 'transfer_out':
      return '調撥出庫';
    case 'transfer_in':
      return '調撥入庫';
    default:
      return reason || '-';
  }
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

/**
 * Get warehouse display name
 * @param {string | null | undefined} whId
 * @param {string} [defaultLabel='未指定倉庫']
 * @returns {string}
 */
export function getWarehouseName(whId, defaultLabel = '未指定倉庫') {
  if (!whId) return defaultLabel;
  const wh = (appState.warehouses || []).find(w => w.id === whId);
  return wh ? `${wh.name} (${wh.code})` : whId;
}

/**
 * Navigate to and select a purchase order in PurchaseOrdersWorkspace
 * @param {string} orderId
 */
export async function selectPurchaseOrder(orderId) {
  if (!orderId) return;
  appState.selectedPurchaseOrderId = orderId;
  navigate('/app/purchase-orders');
  try {
    await fetchPurchaseOrderDetail(orderId);
  } catch (e) {
    console.error("Failed to fetch purchase order detail upon selection:", e);
  }
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

/**
 * Fetch departments from SQLite / Mock
 * @returns {Promise<any[]>}
 */
export async function fetchDepartments() {
  try {
    const list = await invoke('list_departments');
    appState.departments = list || [];
    return appState.departments;
  } catch (err) {
    console.error("Failed to fetch departments:", err);
    return [];
  }
}

/**
 * Create a department
 * @param {string} name
 * @param {string | null} [parentId]
 * @returns {Promise<any>}
 */
export async function createDepartmentAction(name, parentId = null) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    throw new Error('部門名稱為必填項目');
  }
  const normalizedParentId = parentId && typeof parentId === 'string' && parentId.trim() ? parentId.trim() : null;
  try {
    const dept = await invoke('create_department', {
      name: trimmedName,
      parentId: normalizedParentId,
      parent_id: normalizedParentId
    });
    await fetchDepartments();
    return dept;
  } catch (err) {
    console.error("Failed to create department:", err);
    throw err;
  }
}

/**
 * Fetch partners list
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function fetchPartners(filter = {}) {
  try {
    const filterCustomer = filter?.filterCustomer !== undefined ? filter.filterCustomer : filter?.filter_customer;
    const filterVendor = filter?.filterVendor !== undefined ? filter.filterVendor : filter?.filter_vendor;
    const payload = {};
    if (filterCustomer !== undefined) {
      payload.filterCustomer = filterCustomer;
      payload.filter_customer = filterCustomer;
    }
    if (filterVendor !== undefined) {
      payload.filterVendor = filterVendor;
      payload.filter_vendor = filterVendor;
    }
    const list = await invoke('list_partners', payload);
    appState.partners = list || [];
    return appState.partners;
  } catch (err) {
    console.error("Failed to fetch partners:", err);
    return [];
  }
}

/**
 * Create a partner / customer
 * @param {string | { name: string, tax_id?: string, taxId?: string, is_customer?: boolean, isCustomer?: boolean, is_vendor?: boolean, isVendor?: boolean, payment_terms_type?: string | null, paymentTermsType?: string | null, payment_terms_days?: number | string | null, paymentTermsDays?: number | string | null }} input
 * @param {string | null} [taxId]
 * @returns {Promise<any>}
 */
export async function createPartnerAction(input, taxId = null) {
  let name = '';
  let targetTaxId = null;
  let is_customer = true;
  let is_vendor = false;
  let hasExplicitCustomer = false;
  let hasExplicitVendor = false;

  if (typeof input === 'object' && input !== null) {
    name = (input.name || '').trim();
    targetTaxId = input.tax_id !== undefined ? input.tax_id : input.taxId;
    if (input.is_customer !== undefined) {
      is_customer = input.is_customer;
      hasExplicitCustomer = true;
    } else if (input.isCustomer !== undefined) {
      is_customer = input.isCustomer;
      hasExplicitCustomer = true;
    }
    if (input.is_vendor !== undefined) {
      is_vendor = input.is_vendor;
      hasExplicitVendor = true;
    } else if (input.isVendor !== undefined) {
      is_vendor = input.isVendor;
      hasExplicitVendor = true;
    }

    if (hasExplicitVendor && !hasExplicitCustomer) {
      is_customer = !is_vendor;
    }
  } else if (typeof input === 'string') {
    name = input.trim();
    targetTaxId = taxId;
  }

  if (!name) {
    if (is_vendor && !is_customer) {
      throw new Error('供應商名稱為必填項目');
    }
    throw new Error('客戶名稱為必填項目');
  }
  const normalizedTaxId = targetTaxId && typeof targetTaxId === 'string' && targetTaxId.trim() ? targetTaxId.trim() : null;
  const rawTermsType = typeof input === 'object' && input !== null
    ? (input.payment_terms_type !== undefined ? input.payment_terms_type : input.paymentTermsType)
    : undefined;
  const rawTermsDays = typeof input === 'object' && input !== null
    ? (input.payment_terms_days !== undefined ? input.payment_terms_days : input.paymentTermsDays)
    : undefined;

  try {
    const partner = await invoke('create_partner', {
      name,
      isCustomer: is_customer,
      isVendor: is_vendor,
      taxId: normalizedTaxId,
      is_customer,
      is_vendor,
      tax_id: normalizedTaxId,
      payment_terms_type: rawTermsType,
      paymentTermsType: rawTermsType,
      payment_terms_days: rawTermsDays !== undefined && rawTermsDays !== null && rawTermsDays !== '' ? Number(rawTermsDays) : undefined,
      paymentTermsDays: rawTermsDays !== undefined && rawTermsDays !== null && rawTermsDays !== '' ? Number(rawTermsDays) : undefined
    });
    await fetchPartners();
    if (is_vendor && !is_customer) {
      showToast(`已成功建立供應商「${name}」！`);
    } else if (is_vendor && is_customer) {
      showToast(`已成功建立合作夥伴「${name}」！`);
    } else {
      showToast(`已成功建立客戶「${name}」！`);
    }
    return partner;
  } catch (err) {
    console.error("Failed to create partner:", err);
    throw err;
  }
}

/**
 * Create a vendor action helper
 * @param {string | { name: string, tax_id?: string, taxId?: string }} input
 * @param {string | null} [taxId]
 * @returns {Promise<any>}
 */
export async function createVendorAction(input, taxId = null) {
  if (typeof input === 'object' && input !== null) {
    return createPartnerAction({
      isCustomer: false,
      isVendor: true,
      ...input
    });
  }
  return createPartnerAction({
    name: input,
    taxId: (taxId && typeof taxId === 'string') ? taxId : undefined,
    isCustomer: false,
    isVendor: true
  });
}

/**
 * Fetch vendors list only
 * @returns {Promise<any[]>}
 */
export async function fetchVendors() {
  return fetchPartners({ filterVendor: true, filter_vendor: true });
}

/**
 * Update an existing partner's name, tax_id, and/or payment terms
 * @param {{ id: string, name?: string, taxId?: string, tax_id?: string, payment_terms_type?: string | null, paymentTermsType?: string | null, payment_terms_days?: number | string | null, paymentTermsDays?: number | string | null, clear_payment_terms?: boolean, clearPaymentTerms?: boolean }} input
 * @returns {Promise<any>}
 */
export async function updatePartnerAction(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('更新合作夥伴參數錯誤');
  }
  const id = (input.id || '').trim();
  if (!id) {
    throw new Error('合作夥伴識別碼為必填項目');
  }

  const payload = { id };
  if (input.name !== undefined) {
    const trimmedName = String(input.name).trim();
    if (!trimmedName) {
      throw new Error('合作夥伴名稱不能為空');
    }
    payload.name = trimmedName;
  }

  const rawTaxId = input.tax_id !== undefined ? input.tax_id : input.taxId;
  if (rawTaxId !== undefined) {
    if (rawTaxId === null || (typeof rawTaxId === 'string' && !rawTaxId.trim())) {
      payload.tax_id = '';
      payload.taxId = '';
    } else {
      const trimmedTaxId = String(rawTaxId).trim();
      if (!/^\d{8}$/.test(trimmedTaxId)) {
        throw new Error('統一編號必須為 8 碼半形數字');
      }
      payload.tax_id = trimmedTaxId;
      payload.taxId = trimmedTaxId;
    }
  }

  const rawTermsType = input.payment_terms_type !== undefined ? input.payment_terms_type : input.paymentTermsType;
  if (rawTermsType !== undefined) {
    payload.payment_terms_type = rawTermsType;
    payload.paymentTermsType = rawTermsType;
  }
  const rawTermsDays = input.payment_terms_days !== undefined ? input.payment_terms_days : input.paymentTermsDays;
  if (rawTermsDays !== undefined) {
    payload.payment_terms_days = rawTermsDays !== null && rawTermsDays !== '' ? Number(rawTermsDays) : null;
    payload.paymentTermsDays = payload.payment_terms_days;
  }
  if (input.clear_payment_terms !== undefined || input.clearPaymentTerms !== undefined) {
    payload.clear_payment_terms = input.clear_payment_terms !== undefined ? input.clear_payment_terms : input.clearPaymentTerms;
    payload.clearPaymentTerms = payload.clear_payment_terms;
  }

  try {
    const updated = await invoke('update_partner', payload);
    await fetchPartners();
    showToast(`已成功更新合作夥伴「${updated.name}」資料！`);
    return updated;
  } catch (err) {
    console.error("Failed to update partner:", err);
    throw err;
  }
}

/**
 * Resolve category string to standard category name and sellable/purchasable flags
 * @param {string} rawCategory
 * @returns {{ category: string, is_sellable: boolean, is_purchasable: boolean }}
 */
export function resolveCategoryFlags(rawCategory) {
  const norm = String(rawCategory || '').trim().toLowerCase();
  if (norm === 'resale' || norm === '轉售商品' || norm === '轉售') {
    return { category: 'resale', is_sellable: true, is_purchasable: true };
  }
  if (norm === 'manufactured' || norm === '自製成品' || norm === '自製') {
    return { category: 'manufactured', is_sellable: true, is_purchasable: false };
  }
  if (norm === 'raw_material' || norm === '原物料' || norm === '原料') {
    return { category: 'raw_material', is_sellable: false, is_purchasable: true };
  }
  throw new Error(`無效的商品類別「${rawCategory}」，僅允許：轉售商品、自製成品、原物料`);
}

/**
 * Fetch products list
 * @param {any} [filters]
 * @returns {Promise<any[]>}
 */
export async function fetchProducts(filters = {}) {
  try {
    const payload = {};
    if (filters.filter_category !== undefined || filters.filterCategory !== undefined) {
      payload.filter_category = filters.filter_category !== undefined ? filters.filter_category : filters.filterCategory;
      payload.filterCategory = payload.filter_category;
    }
    if (filters.filter_sellable !== undefined || filters.filterSellable !== undefined) {
      payload.filter_sellable = filters.filter_sellable !== undefined ? filters.filter_sellable : filters.filterSellable;
      payload.filterSellable = payload.filter_sellable;
    }
    if (filters.filter_purchasable !== undefined || filters.filterPurchasable !== undefined) {
      payload.filter_purchasable = filters.filter_purchasable !== undefined ? filters.filter_purchasable : filters.filterPurchasable;
      payload.filterPurchasable = payload.filter_purchasable;
    }
    const list = await invoke('list_products', payload);
    appState.products = list || [];
    return appState.products;
  } catch (err) {
    console.error("Failed to fetch products:", err);
    return [];
  }
}

/**
 * Get product detail (including variants, units, supply sources, BOM)
 * @param {string} productId
 * @returns {Promise<any>}
 */
export async function getProductDetailAction(productId) {
  const trimmedId = (productId || '').trim();
  if (!trimmedId) {
    throw new Error('商品 ID 為必填項目');
  }
  try {
    const detail = await invoke('get_product_detail', {
      product_id: trimmedId,
      productId: trimmedId
    });
    appState.currentProductDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to get product detail:", err);
    throw err;
  }
}

/**
 * Create a new product
 * @param {{ name: string, category: string, sku?: string, unit_name?: string, unitName?: string, baseUnit?: string, base_unit?: string, selling_price?: number, sellingPrice?: number, initialBomItems?: any[], initial_bom_items?: any[], bomItems?: any[], bom_items?: any[] }} input
 * @returns {Promise<any>}
 */
export async function createProductAction(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('商品資訊無效');
  }
  const name = (input.name || '').trim();
  if (!name) {
    throw new Error('商品名稱不能為空');
  }
  const category = (input.category || '').trim();
  if (!category) {
    throw new Error('商品類別為必填項目');
  }
  const sku = input.sku ? String(input.sku).trim() : undefined;
  const unitName = (input.unit_name || input.unitName || input.baseUnit || input.base_unit || '').trim() || undefined;
  const sellingPrice = input.selling_price !== undefined ? input.selling_price : input.sellingPrice;

  try {
    const created = await invoke('create_product', {
      name,
      category,
      sku,
      unit_name: unitName,
      unitName,
      selling_price: sellingPrice,
      sellingPrice
    });

    const initialBom = input.initialBomItems || input.initial_bom_items || input.bomItems || input.bom_items;
    if (Array.isArray(initialBom) && initialBom.length > 0) {
      const parentVarId = (created.variants && created.variants[0]) ? created.variants[0].id : (created.product ? created.product.id : created.id);
      const validItems = initialBom
        .map(item => ({
          childId: item.materialVariantId || item.material_variant_id || item.childVariantId || item.child_variant_id,
          qty: Number(item.quantity)
        }))
        .filter(item => item.childId && !isNaN(item.qty) && item.qty > 0);

      if (validItems.length > 0) {
        try {
          await Promise.all(validItems.map(item => addBomItemAction(parentVarId, item.childId, item.qty)));
        } catch (bomErr) {
          await fetchProducts();
          throw bomErr;
        }
      }
    }

    await fetchProducts();
    showToast(`已成功建立商品「${name}」！`);
    return created;
  } catch (err) {
    console.error("Failed to create product:", err);
    throw err;
  }
}

/**
 * Add a variant to an existing product
 * @param {string} productId
 * @param {string} name
 * @param {string} [sku]
 * @param {object} [specAttributes={}]
 * @returns {Promise<any>}
 */
export async function addProductVariantAction(productId, name, sku = undefined, specAttributes = {}) {
  const prodId = (productId || '').trim();
  const variantName = (name || '').trim();
  if (!prodId) throw new Error('商品 ID 為必填項目');
  if (!variantName && (!specAttributes || Object.keys(specAttributes).length === 0)) {
    throw new Error('變體名稱不能為空');
  }

  try {
    const v = await invoke('add_product_variant', {
      product_id: prodId,
      productId: prodId,
      name: variantName,
      sku: sku ? String(sku).trim() : undefined,
      spec_attributes: specAttributes || {},
      specAttributes: specAttributes || {}
    });
    if (appState.currentProductDetail && appState.currentProductDetail.product.id === prodId) {
      await getProductDetailAction(prodId);
    }
    showToast(`已成功新增變體「${v.name || variantName}」！`);
    return v;
  } catch (err) {
    console.error("Failed to add product variant:", err);
    throw err;
  }
}

/**
 * Update an existing product variant
 * @param {string} variantId
 * @param {object} updates
 * @param {string} [updates.name]
 * @param {string} [updates.sku]
 * @param {object} [updates.spec_attributes]
 * @param {object} [updates.specAttributes]
 * @param {string} [updates.productId] Optional product ID to reload currentProductDetail
 * @returns {Promise<any>}
 */
export async function updateProductVariantAction(variantId, { name, sku, spec_attributes, specAttributes, productId } = {}) {
  const vId = (variantId || '').trim();
  if (!vId) throw new Error('變體 ID 為必填項目');

  const payload = {
    variant_id: vId,
    variantId: vId
  };
  if (name !== undefined) {
    payload.name = name;
  }
  if (sku !== undefined) {
    payload.sku = sku;
  }
  const spec = spec_attributes !== undefined ? spec_attributes : specAttributes;
  if (spec !== undefined) {
    payload.spec_attributes = spec;
    payload.specAttributes = spec;
  }

  try {
    const updated = await invoke('update_product_variant', payload);
    const prodId = productId || (appState.currentProductDetail?.product?.id);
    if (prodId) {
      await getProductDetailAction(prodId);
    }
    showToast(`已成功更新規格變體「${updated.name}」！`);
    return updated;
  } catch (err) {
    console.error("Failed to update product variant:", err);
    throw err;
  }
}

/**
 * Add a unit to an existing variant
 * @param {string} variantId
 * @param {string} unitName
 * @param {number} conversionRatio
 * @param {boolean} [isBaseUnit=false]
 * @param {number} [sellingPrice=0.0]
 * @returns {Promise<any>}
 */
export async function addProductUnitAction(variantId, unitName, conversionRatio, isBaseUnit = false, sellingPrice = 0.0) {
  const varId = (variantId || '').trim();
  const uName = (unitName || '').trim();
  if (!varId) throw new Error('規格變體 ID 為必填項目');
  if (!uName) throw new Error('單位名稱不能為空');

  try {
    const unit = await invoke('add_product_unit', {
      variant_id: varId,
      variantId: varId,
      unit_name: uName,
      unitName: uName,
      conversion_ratio: conversionRatio,
      conversionRatio,
      is_base_unit: isBaseUnit,
      isBaseUnit,
      selling_price: sellingPrice,
      sellingPrice,
      sell_price: sellingPrice,
      sellPrice: sellingPrice
    });
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast(`已成功新增包裝單位「${uName}」！`);
    return unit;
  } catch (err) {
    console.error("Failed to add product unit:", err);
    throw err;
  }
}

/**
 * Update an existing product sales unit
 * @param {string} unitId
 * @param {object} updates
 * @param {string} [updates.unit_name]
 * @param {string} [updates.unitName]
 * @param {number} [updates.conversion_ratio]
 * @param {number} [updates.conversionRatio]
 * @param {boolean} [updates.is_base_unit]
 * @param {boolean} [updates.isBaseUnit]
 * @param {number} [updates.selling_price]
 * @param {number} [updates.sellingPrice]
 * @param {number} [updates.sell_price]
 * @param {number} [updates.sellPrice]
 * @param {string} [updates.productId] Optional product ID to reload currentProductDetail
 * @returns {Promise<any>}
 */
export async function updateProductUnitAction(unitId, {
  unit_name,
  unitName,
  conversion_ratio,
  conversionRatio,
  is_base_unit,
  isBaseUnit,
  selling_price,
  sellingPrice,
  sell_price,
  sellPrice,
  productId
} = {}) {
  const uId = (unitId || '').trim();
  if (!uId) throw new Error('單位 ID 為必填項目');

  const payload = {
    unit_id: uId,
    unitId: uId
  };

  const name = unit_name !== undefined ? unit_name : unitName;
  if (name !== undefined) {
    payload.unit_name = name;
    payload.unitName = name;
  }

  const ratio = conversion_ratio !== undefined ? conversion_ratio : conversionRatio;
  if (ratio !== undefined) {
    payload.conversion_ratio = Number(ratio);
    payload.conversionRatio = Number(ratio);
  }

  const isBase = is_base_unit !== undefined ? is_base_unit : isBaseUnit;
  if (isBase !== undefined) {
    payload.is_base_unit = Boolean(isBase);
    payload.isBaseUnit = Boolean(isBase);
  }

  const price = selling_price !== undefined ? selling_price : (sellingPrice !== undefined ? sellingPrice : (sell_price !== undefined ? sell_price : sellPrice));
  if (price !== undefined) {
    payload.selling_price = Number(price);
    payload.sellingPrice = Number(price);
    payload.sell_price = Number(price);
    payload.sellPrice = Number(price);
  }

  try {
    const updated = await invoke('update_product_unit', payload);
    const prodId = productId || (appState.currentProductDetail?.product?.id);
    if (prodId) {
      await getProductDetailAction(prodId);
    }
    showToast(`已成功更新包裝單位「${updated.unit_name}」！`);
    return updated;
  } catch (err) {
    console.error("Failed to update product unit:", err);
    throw err;
  }
}

/**
 * Add a vendor supply source to a product sales unit
 * @param {string|any} unitId - Unit ID string or source options object
 * @param {string} [vendorPartnerId]
 * @param {number} [purchaseCost]
 * @param {string} [currency='TWD']
 * @param {boolean} [isPrimary=false]
 * @returns {Promise<any>}
 */
export async function addSupplySourceAction(unitId, vendorPartnerId, purchaseCost = 0, currency = 'TWD', isPrimary = false) {
  let uId = '';
  let vendorId = '';
  let cost = 0;
  let cur = currency;
  let prim = isPrimary;

  if (typeof unitId === 'object' && unitId !== null) {
    uId = (unitId.unit_id || unitId.unitId || '').trim();
    vendorId = (unitId.vendor_partner_id || unitId.vendorPartnerId || '').trim();
    cost = unitId.purchase_cost !== undefined ? unitId.purchase_cost : (unitId.cost !== undefined ? unitId.cost : 0);
    cur = unitId.currency || 'TWD';
    prim = unitId.is_primary !== undefined ? unitId.is_primary : (unitId.isPrimary || false);
  } else {
    uId = (unitId || '').trim();
    vendorId = (vendorPartnerId || '').trim();
    cost = purchaseCost !== undefined ? purchaseCost : 0;
  }

  if (!uId) throw new Error('包裝銷售單位 ID 為必填項目');
  if (!vendorId) throw new Error('供應商 ID 為必填項目');

  try {
    const src = await invoke('add_supply_source', {
      unit_id: uId,
      unitId: uId,
      variant_id: uId,
      variantId: uId,
      vendor_partner_id: vendorId,
      vendorPartnerId: vendorId,
      purchase_cost: cost,
      purchaseCost: cost,
      cost,
      currency: cur,
      is_primary: prim,
      isPrimary: prim
    });
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast('已成功新增供應來源！');
    return src;
  } catch (err) {
    console.error("Failed to add supply source:", err);
    throw err;
  }
}

/**
 * Update an existing product supply source
 * @param {string} sourceId
 * @param {Object} [updates={}]
 * @returns {Promise<any>}
 */
export async function updateSupplySourceAction(sourceId, updates = {}) {
  const sId = (sourceId || '').trim();
  if (!sId) throw new Error('供應來源 ID 為必填項目');

  const effectiveCost = updates.purchase_cost !== undefined ? updates.purchase_cost : updates.cost;
  const payload = {
    source_id: sId,
    sourceId: sId,
    id: sId,
    purchase_cost: effectiveCost !== undefined ? Number(effectiveCost) : undefined,
    purchaseCost: effectiveCost !== undefined ? Number(effectiveCost) : undefined,
    cost: effectiveCost !== undefined ? Number(effectiveCost) : undefined,
    vendor_partner_id: updates.vendor_partner_id !== undefined ? updates.vendor_partner_id : updates.vendorPartnerId,
    vendorPartnerId: updates.vendor_partner_id !== undefined ? updates.vendor_partner_id : updates.vendorPartnerId,
    currency: updates.currency,
    is_primary: updates.is_primary !== undefined ? updates.is_primary : updates.isPrimary,
    isPrimary: updates.is_primary !== undefined ? updates.is_primary : updates.isPrimary
  };

  try {
    const updated = await invoke('update_supply_source', payload);
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast('已成功更新供應來源！');
    return updated;
  } catch (err) {
    console.error("Failed to update supply source:", err);
    throw err;
  }
}

/**
 * Add a BOM item to a manufactured product variant
 * @param {string|object} parentVariantIdOrOptions Parent variant ID (or product ID) or options object
 * @param {string} [childVariantId] Child variant ID (or material variant ID)
 * @param {number} [quantity] BOM quantity
 * @returns {Promise<any>}
 */
export async function addBomItemAction(parentVariantIdOrOptions, childVariantId, quantity) {
  let parentVid = '';
  let childVid = '';
  let qty = quantity;

  if (typeof parentVariantIdOrOptions === 'object' && parentVariantIdOrOptions !== null) {
    parentVid = (parentVariantIdOrOptions.parent_variant_id || parentVariantIdOrOptions.parentVariantId || parentVariantIdOrOptions.product_id || parentVariantIdOrOptions.productId || '').trim();
    childVid = (parentVariantIdOrOptions.child_variant_id || parentVariantIdOrOptions.childVariantId || parentVariantIdOrOptions.material_variant_id || parentVariantIdOrOptions.materialVariantId || '').trim();
    qty = parentVariantIdOrOptions.quantity;
  } else {
    parentVid = (parentVariantIdOrOptions || '').trim();
    childVid = (childVariantId || '').trim();
  }

  if (!parentVid || !childVid) throw new Error('母規格變體與子物料變體為必填項目');

  try {
    const bom = await invoke('add_bom_item', {
      parent_variant_id: parentVid,
      parentVariantId: parentVid,
      product_id: parentVid,
      productId: parentVid,
      child_variant_id: childVid,
      childVariantId: childVid,
      material_variant_id: childVid,
      materialVariantId: childVid,
      quantity: Number(qty)
    });
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast('已成功新增 BOM 組成項目！');
    return bom;
  } catch (err) {
    console.error("Failed to add BOM item:", err);
    throw err;
  }
}

/**
 * Filter declared skills list by search keyword (case-insensitive across name, id, domain, description)
 * @param {import('./workflow/types.js').DeclaredSkill[]} skills
 * @param {string} [keyword]
 * @returns {import('./workflow/types.js').DeclaredSkill[]}
 */
export function filterDeclaredSkills(skills, keyword) {
  if (!skills || !Array.isArray(skills)) return [];
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) return skills;
  const lower = keyword.trim().toLowerCase();
  return skills.filter(s => {
    const idMatch = s.id && s.id.toLowerCase().includes(lower);
    const nameMatch = s.name && s.name.toLowerCase().includes(lower);
    const domainMatch = s.domain && s.domain.toLowerCase().includes(lower);
    const descMatch = s.description && s.description.toLowerCase().includes(lower);
    return idMatch || nameMatch || domainMatch || descMatch;
  });
}

/**
 * Update department available skills and record sensitive audit logs.
 * @param {string} departmentId
 * @param {string[]} skillIds
 * @param {string | null} [operator]
 * @returns {Promise<any>}
 */
export async function updateDepartmentSkillsAction(departmentId, skillIds, operator = undefined) {
  const trimmedId = (departmentId || '').trim();
  if (!trimmedId) {
    throw new Error('部門 ID 為必填項目');
  }
  const depts = appState.departments || [];
  let targetDept = depts.find(d => d.id === trimmedId);
  if (!targetDept) {
    await fetchDepartments();
    targetDept = (appState.departments || []).find(d => d.id === trimmedId);
    if (!targetDept) {
      throw new Error(`找不到指定的部門：${trimmedId}`);
    }
  }

  const rawSkills = Array.isArray(skillIds) ? skillIds : [];
  const cleanSkills = [...new Set(rawSkills.map(s => String(s).trim()).filter(Boolean))].sort();

  const prevSkills = new Set(targetDept.skills || []);
  const nextSkills = new Set(cleanSkills);

  const addedSkills = cleanSkills.filter(s => !prevSkills.has(s));
  const removedSkills = (targetDept.skills || []).filter(s => !nextSkills.has(s));

  const op = (operator || appState.authUser?.display_name || appState.authUser?.email || 'user').trim();

  try {
    const updated = await invoke('update_department_skills', {
      departmentId: trimmedId,
      department_id: trimmedId,
      skills: cleanSkills
    });

    // Record audit log for each granted skill
    for (const sk of addedSkills) {
      await invoke('record_audit_log', {
        actionType: 'grant_department_skill',
        action_type: 'grant_department_skill',
        arguments: JSON.stringify({
          department_id: trimmedId,
          department_name: targetDept.name,
          skill_id: sk,
          action: 'grant'
        }),
        decision: 'approved',
        operator: op
      });
    }

    // Record audit log for each revoked skill
    for (const sk of removedSkills) {
      await invoke('record_audit_log', {
        actionType: 'revoke_department_skill',
        action_type: 'revoke_department_skill',
        arguments: JSON.stringify({
          department_id: trimmedId,
          department_name: targetDept.name,
          skill_id: sk,
          action: 'revoke'
        }),
        decision: 'approved',
        operator: op
      });
    }

    // If no specific diff (e.g. batch same), still record audit update
    if (addedSkills.length === 0 && removedSkills.length === 0) {
      await invoke('record_audit_log', {
        actionType: 'update_department_skills',
        action_type: 'update_department_skills',
        arguments: JSON.stringify({
          department_id: trimmedId,
          department_name: targetDept.name,
          skills: cleanSkills
        }),
        decision: 'approved',
        operator: op
      });
    }

    targetDept.skills = cleanSkills;
    await fetchDepartments();
    await fetchAuditLogs();
    showToast(`已成功更新「${targetDept.name}」的可用 Skill 清單`);
    return updated;
  } catch (err) {
    console.error("Failed to update department skills:", err);
    throw err;
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
 * Compute the union of skills for a list of department IDs
 * @param {string[] | null | undefined} departmentIds
 * @param {any[]} [departments]
 * @returns {string[]} Deduplicated list of skills
 */
export function getEffectiveSkills(departmentIds, departments = appState.departments) {
  if (!departmentIds || !Array.isArray(departmentIds) || departmentIds.length === 0) {
    return [];
  }
  const depts = departments || [];
  const skillSet = new Set();
  for (const deptId of departmentIds) {
    const dept = depts.find(d => d.id === deptId || d.name === deptId);
    if (dept && Array.isArray(dept.skills)) {
      for (const skill of dept.skills) {
        if (typeof skill === 'string' && skill.trim()) {
          skillSet.add(skill.trim());
        }
      }
    }
  }
  return Array.from(skillSet).sort();
}

/**
 * Compute difference in effective skills between current and next department selections
 * @param {string[] | null | undefined} currentDeptIds
 * @param {string[] | null | undefined} nextDeptIds
 * @param {any[]} [departments]
 * @returns {{ currentSkills: string[], nextSkills: string[], addedSkills: string[], removedSkills: string[] }}
 */
export function computeSkillDiff(currentDeptIds, nextDeptIds, departments = appState.departments) {
  const currentSkills = getEffectiveSkills(currentDeptIds, departments);
  const nextSkills = getEffectiveSkills(nextDeptIds, departments);

  const currentSet = new Set(currentSkills);
  const nextSet = new Set(nextSkills);

  const addedSkills = nextSkills.filter(s => !currentSet.has(s));
  const removedSkills = currentSkills.filter(s => !nextSet.has(s));

  return {
    currentSkills,
    nextSkills,
    addedSkills,
    removedSkills
  };
}

/**
 * Get effective skills for the current logged-in user in appState
 * Computes the union of skills across all assigned departments of the active user.
 * @param {any} [state]
 * @returns {string[]}
 */
export function getCurrentUserEffectiveSkills(state = appState) {
  if (!state) return [];
  if (Array.isArray(state.currentUserSkills)) {
    return [...state.currentUserSkills];
  }
  if (state.currentUserSkills instanceof Set) {
    return Array.from(state.currentUserSkills);
  }

  const authUser = state.authUser;
  if (!authUser) {
    return [];
  }

  // If authUser directly defines department_ids
  if (Array.isArray(authUser.department_ids)) {
    return getEffectiveSkills(authUser.department_ids, state.departments);
  }

  // Look up user in state.members
  const members = Array.isArray(state.members) ? state.members : [];
  const currentMember = members.find(m => 
    (m.user_id && m.user_id === authUser.id) ||
    (m.id && m.id === authUser.id) ||
    (m.email && authUser.email && m.email.toLowerCase() === authUser.email.toLowerCase())
  );

  if (currentMember && Array.isArray(currentMember.department_ids)) {
    return getEffectiveSkills(currentMember.department_ids, state.departments);
  }

  return [];
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
 * Complete department setup task and report back to main agent
 * @param {string} taskId
 * @param {string} [departmentName]
 */
export async function completeDepartmentSetupTask(taskId, departmentName = '銷售部') {
  try {
    await updateTaskStatusAction(taskId, 'done');
    await appendTaskMessageAction(taskId, 'assistant', `已為您成功建立「${departmentName}」！此子任務已圓滿完成。`);
    // Report summary to main agent ambient conversation
    await appendTaskMessageAction('main', 'assistant', `✅「設定部門」已完成，新增了『${departmentName}』`);
    showToast(`「設定部門」任務已完成！結果已回報至主 Agent。`);
  } catch (err) {
    console.error("Failed to complete department setup task:", err);
    showToast(`完成任務失敗: ${err}`);
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

// ==========================================
// Purchase Orders & Inventory Management (Issue #164, #165)
// ==========================================

/**
 * Fetch purchase orders list
 * @param {any} [filters]
 * @returns {Promise<any[]>}
 */
export async function fetchPurchaseOrders(filters = {}) {
  try {
    const payload = {};
    if (filters.filter_status !== undefined || filters.filterStatus !== undefined) {
      const st = filters.filter_status !== undefined ? filters.filter_status : filters.filterStatus;
      if (st && st !== 'all') {
        payload.filter_status = st;
        payload.filterStatus = st;
      }
    }
    if (filters.filter_vendor_partner_id !== undefined || filters.filterVendorPartnerId !== undefined) {
      payload.filter_vendor_partner_id = filters.filter_vendor_partner_id !== undefined ? filters.filter_vendor_partner_id : filters.filterVendorPartnerId;
      payload.filterVendorPartnerId = payload.filter_vendor_partner_id;
    }
    const list = await invoke('list_purchase_orders', payload);
    appState.purchaseOrders = list || [];
    return appState.purchaseOrders;
  } catch (err) {
    console.error("Failed to fetch purchase orders:", err);
    return [];
  }
}

/**
 * Get purchase order detail
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function fetchPurchaseOrderDetail(orderId) {
  const trimmedId = (orderId || '').trim();
  if (!trimmedId) {
    throw new Error('採購單 ID 為必填項目');
  }
  try {
    const detail = await invoke('get_purchase_order', {
      order_id: trimmedId,
      orderId: trimmedId
    });
    appState.currentPurchaseOrderDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch purchase order detail:", err);
    throw err;
  }
}

/**
 * Fetch inventory levels
 * @param {string | null} [warehouseId]
 * @returns {Promise<any[]>}
 */
export async function fetchInventoryLevels(warehouseId = null) {
  try {
    const payload = {};
    if (warehouseId && String(warehouseId).trim()) {
      payload.warehouse_id = String(warehouseId).trim();
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_inventory_levels', payload);
    appState.inventoryLevels = list || [];
    return appState.inventoryLevels;
  } catch (err) {
    console.error("Failed to fetch inventory levels:", err);
    return [];
  }
}

/**
 * Fetch inventory level for a specific warehouse and unit
 * @param {string} warehouseId
 * @param {string} unitId
 * @returns {Promise<any>}
 */
export async function fetchUnitInventoryLevel(warehouseId, unitId) {
  if (!warehouseId || !unitId) return null;
  try {
    const level = await invoke('get_inventory_level', {
      warehouse_id: String(warehouseId).trim(),
      warehouseId: String(warehouseId).trim(),
      unit_id: String(unitId).trim(),
      unitId: String(unitId).trim()
    });
    return level;
  } catch (err) {
    console.error("Failed to fetch unit inventory level:", err);
    throw err;
  }
}

/**
 * Fetch inventory movements for a unit (or all)
 * @param {string} [unitId]
 * @param {string | null} [warehouseId]
 * @returns {Promise<any[]>}
 */
export async function fetchInventoryMovements(unitId, warehouseId = null) {
  try {
    const payload = {};
    if (unitId && String(unitId).trim()) {
      payload.unit_id = String(unitId).trim();
      payload.unitId = String(unitId).trim();
    }
    if (warehouseId && String(warehouseId).trim()) {
      payload.warehouse_id = String(warehouseId).trim();
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_inventory_movements', payload);
    appState.inventoryMovements = list || [];
    return appState.inventoryMovements;
  } catch (err) {
    console.error("Failed to fetch inventory movements:", err);
    return [];
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

/**
 * Create a new purchase order
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createPurchaseOrderAction({
  vendor_partner_id,
  vendorPartnerId,
  currency = 'TWD',
  expected_date,
  expectedDate,
  note,
  warehouse_id,
  warehouseId,
  task_id = null,
  taskId = null,
  initial_lines,
  initialLines
} = {}) {
  const vendorId = String(vendor_partner_id !== undefined ? vendor_partner_id : (vendorPartnerId !== undefined ? vendorPartnerId : '')).trim();
  if (!vendorId) {
    throw new Error('供應商為必填項目');
  }
  const expDate = expected_date !== undefined ? expected_date : expectedDate;
  const lines = initial_lines !== undefined ? initial_lines : initialLines;
  const whId = warehouse_id !== undefined ? warehouse_id : warehouseId;

  const payload = {
    vendor_partner_id: vendorId,
    vendorPartnerId: vendorId,
    currency: currency || 'TWD',
    expected_date: expDate !== undefined && expDate !== null && expDate !== '' ? Number(expDate) : null,
    expectedDate: expDate !== undefined && expDate !== null && expDate !== '' ? Number(expDate) : null,
    note: note ? String(note).trim() : null,
    task_id: task_id || taskId || null,
    taskId: task_id || taskId || null
  };
  if (whId && String(whId).trim()) {
    payload.warehouse_id = String(whId).trim();
    payload.warehouseId = String(whId).trim();
  }
  if (lines && Array.isArray(lines)) {
    payload.initial_lines = lines;
    payload.initialLines = lines;
  }

  try {
    const detail = await invoke('create_purchase_order', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast(`已成功建立採購單「${detail.order.po_number}」！`);
    return detail;
  } catch (err) {
    console.error("Failed to create purchase order:", err);
    handleZeroWarehouseError(err);
    throw err;
  }
}

/**
 * Update purchase order header
 * @param {string} orderId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updatePurchaseOrderHeaderAction(orderId, {
  vendor_partner_id,
  vendorPartnerId,
  expected_date,
  expectedDate,
  note,
  warehouse_id,
  warehouseId
} = {}) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  const payload = {
    order_id: oId,
    orderId: oId
  };
  const vp = vendor_partner_id !== undefined ? vendor_partner_id : vendorPartnerId;
  if (vp !== undefined) {
    payload.vendor_partner_id = vp ? String(vp).trim() : null;
    payload.vendorPartnerId = payload.vendor_partner_id;
  }
  const expDate = expected_date !== undefined ? expected_date : expectedDate;
  if (expDate !== undefined) {
    payload.expected_date = expDate ? Number(expDate) : null;
    payload.expectedDate = payload.expected_date;
  }
  if (note !== undefined) {
    payload.note = note ? String(note).trim() : null;
  }
  const whId = warehouse_id !== undefined ? warehouse_id : warehouseId;
  if (whId !== undefined) {
    payload.warehouse_id = whId ? String(whId).trim() : null;
    payload.warehouseId = payload.warehouse_id;
  }

  try {
    const detail = await invoke('update_purchase_order_header', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('採購單表頭已成功更新！');
    return detail;
  } catch (err) {
    console.error("Failed to update purchase order header:", err);
    throw err;
  }
}

/**
 * Add a line item to a purchase order
 * @param {string} orderId
 * @param {object} lineInput
 * @returns {Promise<any>}
 */
export async function addPurchaseOrderLineAction(orderId, {
  unit_id,
  unitId,
  quantity,
  purchase_cost,
  purchaseCost
} = {}) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');
  const uId = String(unit_id || unitId || '').trim();
  if (!uId) throw new Error('商品單位為必填項目');

  const payload = {
    order_id: oId,
    orderId: oId,
    unit_id: uId,
    unitId: uId,
    quantity: Number(quantity)
  };
  const cost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
  if (cost !== undefined && cost !== null && cost !== '') {
    payload.purchase_cost = Number(cost);
    payload.purchaseCost = Number(cost);
  }

  try {
    const detail = await invoke('add_purchase_order_line', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('已新增採購單明細！');
    return detail;
  } catch (err) {
    console.error("Failed to add purchase order line:", err);
    throw err;
  }
}

/**
 * Update an existing line item in a purchase order
 * @param {string} lineId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updatePurchaseOrderLineAction(lineId, {
  quantity,
  purchase_cost,
  purchaseCost
} = {}) {
  const lId = String(lineId || '').trim();
  if (!lId) throw new Error('明細 ID 為必填項目');

  const payload = {
    line_id: lId,
    lineId: lId
  };
  if (quantity !== undefined) {
    payload.quantity = Number(quantity);
  }
  const cost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
  if (cost !== undefined && cost !== null && cost !== '') {
    payload.purchase_cost = Number(cost);
    payload.purchaseCost = Number(cost);
  }

  try {
    const detail = await invoke('update_purchase_order_line', payload);
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('已更新明細項目！');
    return detail;
  } catch (err) {
    console.error("Failed to update purchase order line:", err);
    throw err;
  }
}

/**
 * Remove a line item from a purchase order
 * @param {string} lineId
 * @returns {Promise<any>}
 */
export async function removePurchaseOrderLineAction(lineId) {
  const lId = String(lineId || '').trim();
  if (!lId) throw new Error('明細 ID 為必填項目');

  try {
    const detail = await invoke('remove_purchase_order_line', {
      line_id: lId,
      lineId: lId
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast('已刪除明細項目！');
    return detail;
  } catch (err) {
    console.error("Failed to remove purchase order line:", err);
    throw err;
  }
}

/**
 * Submit purchase order (draft -> ordered)
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function submitPurchaseOrderAction(orderId) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  try {
    const detail = await invoke('submit_purchase_order', {
      order_id: oId,
      orderId: oId
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast(`採購單「${detail.order.po_number}」已成功送出下單！`);
    return detail;
  } catch (err) {
    console.error("Failed to submit purchase order:", err);
    throw err;
  }
}

/**
 * Confirm purchase order received (ordered -> received)
 * @param {string | { order_id?: string, orderId?: string }} orderId
 * @param {Array<{ line_id?: string, lineId?: string, received_quantity?: number, receivedQuantity?: number }>} lineReceivedQuantities
 * @returns {Promise<any>}
 */
export async function confirmPurchaseOrderReceivedAction(orderId, lineReceivedQuantities = []) {
  let rawId = orderId;
  if (orderId && typeof orderId === 'object') {
    const obj = /** @type {any} */ (orderId);
    rawId = obj.order_id || obj.orderId;
  }
  const oId = String(rawId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  try {
    const detail = await invoke('confirm_purchase_order_received', {
      order_id: oId,
      orderId: oId,
      line_received_quantities: lineReceivedQuantities,
      lineReceivedQuantities
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    await fetchInventoryLevels();
    showToast(`採購單「${detail.order.po_number}」已完成驗收到貨結案並入庫！`);
    return detail;
  } catch (err) {
    console.error("Failed to confirm purchase order received:", err);
    throw err;
  }
}

/**
 * Cancel purchase order (draft/ordered -> cancelled)
 * @param {string} orderId
 * @returns {Promise<any>}
 */
export async function cancelPurchaseOrderAction(orderId) {
  const oId = String(orderId || '').trim();
  if (!oId) throw new Error('採購單 ID 為必填項目');

  try {
    const detail = await invoke('cancel_purchase_order', {
      order_id: oId,
      orderId: oId
    });
    appState.currentPurchaseOrderDetail = detail;
    await fetchPurchaseOrders();
    showToast(`採購單「${detail.order.po_number}」已取消！`);
    return detail;
  } catch (err) {
    console.error("Failed to cancel purchase order:", err);
    throw err;
  }
}

/**
 * Record opening inventory balance (R-17)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function recordOpeningInventoryBalanceAction({
  unit_id,
  unitId,
  quantity,
  quantity_delta,
  quantityDelta,
  unit_cost,
  unitCost,
  warehouse_id,
  warehouseId
} = {}) {
  const uId = String(unit_id || unitId || '').trim();
  if (!uId) throw new Error('商品單位 ID 為必填項目');

  const rawQty = quantity !== undefined ? quantity : (quantity_delta !== undefined ? quantity_delta : quantityDelta);
  const rawCost = unit_cost !== undefined ? unit_cost : unitCost;
  const whId = warehouse_id !== undefined ? warehouse_id : warehouseId;

  const payload = {
    unit_id: uId,
    unitId: uId,
    quantity_delta: Number(rawQty),
    quantityDelta: Number(rawQty),
    unit_cost: Number(rawCost),
    unitCost: Number(rawCost)
  };
  if (whId && String(whId).trim()) {
    payload.warehouse_id = String(whId).trim();
    payload.warehouseId = String(whId).trim();
  }

  try {
    const movement = await invoke('record_opening_inventory_balance', payload);
    await fetchInventoryLevels();
    showToast('已成功建立期初庫存底帳！');
    return movement;
  } catch (err) {
    console.error("Failed to record opening inventory balance:", err);
    handleZeroWarehouseError(err);
    throw err;
  }
}

/**
 * Fetch warehouses from SQLite / Mock
 * @param {boolean} [includeInactive=true]
 * @returns {Promise<any[]>}
 */
export async function fetchWarehouses(includeInactive = true) {
  try {
    const payload = {};
    if (includeInactive !== null && includeInactive !== undefined) {
      payload.include_inactive = Boolean(includeInactive);
      payload.includeInactive = Boolean(includeInactive);
    }
    const list = await invoke('list_warehouses', payload);
    appState.warehouses = list || [];
    return appState.warehouses;
  } catch (err) {
    console.error("Failed to fetch warehouses:", err);
    return [];
  }
}

/**
 * Create a warehouse
 * @param {string | object} codeOrObj
 * @param {string} [maybeName]
 * @returns {Promise<any>}
 */
export async function createWarehouseAction(codeOrObj, maybeName) {
  let rawCode = codeOrObj;
  let rawName = maybeName;
  if (codeOrObj && typeof codeOrObj === 'object') {
    rawCode = codeOrObj.code;
    rawName = codeOrObj.name;
  }
  const trimmedCode = (rawCode || '').trim();
  const trimmedName = (rawName || '').trim();
  if (!trimmedCode) throw new Error('倉庫代碼為必填項目');
  if (!trimmedName) throw new Error('倉庫名稱為必填項目');
  try {
    const wh = await invoke('create_warehouse', {
      code: trimmedCode,
      name: trimmedName
    });
    await fetchWarehouses();
    showToast(`倉庫「${wh.name} (${wh.code})」建立成功！`);
    if (typeof appState.createWarehouseSuccessCallback === 'function') {
      /** @type {any} */
      const cb = appState.createWarehouseSuccessCallback;
      appState.createWarehouseSuccessCallback = null;
      try {
        await cb(wh);
      } catch (cbErr) {
        console.error("Callback error after warehouse creation:", cbErr);
      }
    }
    return wh;
  } catch (err) {
    console.error("Failed to create warehouse:", err);
    throw err;
  }
}

/**
 * Update warehouse
 * @param {string} id
 * @param {string} code
 * @param {string} name
 * @returns {Promise<any>}
 */
export async function updateWarehouseAction(id, code, name) {
  const trimmedCode = (code || '').trim();
  const trimmedName = (name || '').trim();
  if (!trimmedCode) throw new Error('倉庫代碼為必填項目');
  if (!trimmedName) throw new Error('倉庫名稱為必填項目');
  try {
    const wh = await invoke('update_warehouse', {
      id,
      code: trimmedCode,
      name: trimmedName
    });
    await fetchWarehouses();
    showToast(`倉庫「${wh.name}」已更新！`);
    return wh;
  } catch (err) {
    console.error("Failed to update warehouse:", err);
    throw err;
  }
}

/**
 * Set default warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function setDefaultWarehouseAction(id) {
  try {
    const wh = await invoke('set_default_warehouse', { id });
    await fetchWarehouses();
    showToast(`已將「${wh.name}」設為預設倉！`);
    return wh;
  } catch (err) {
    console.error("Failed to set default warehouse:", err);
    throw err;
  }
}

/**
 * Deactivate warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deactivateWarehouseAction(id) {
  try {
    const wh = await invoke('deactivate_warehouse', { id });
    await fetchWarehouses();
    showToast(`已停用倉庫「${wh.name}」！`);
    return wh;
  } catch (err) {
    console.error("Failed to deactivate warehouse:", err);
    throw err;
  }
}

/**
 * Reactivate warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function reactivateWarehouseAction(id) {
  try {
    const wh = await invoke('reactivate_warehouse', { id });
    await fetchWarehouses();
    showToast(`已重新啟用倉庫「${wh.name}」！`);
    return wh;
  } catch (err) {
    console.error("Failed to reactivate warehouse:", err);
    throw err;
  }
}

// ==========================================
// Inventory Adjustments (Issue #180, #183)
// ==========================================

/**
 * Format inventory adjustment reason code to Traditional Chinese
 * @param {string} reason
 * @returns {string}
 */
export function formatAdjustmentReason(reason) {
  switch (reason) {
    case 'damage':
      return '報廢／損壞';
    case 'loss':
      return '盤虧／遺失';
    case 'found':
      return '盤盈／尋獲';
    case 'opening_correction':
      return '期初更正';
    case 'other':
      return '其他';
    default:
      return reason || '-';
  }
}

/**
 * Format inventory adjustment status to badge label
 * @param {string} status
 * @returns {string}
 */
export function formatAdjustmentStatus(status) {
  switch (status) {
    case 'draft':
      return '草稿 (draft)';
    case 'posted':
      return '已過帳 (posted)';
    case 'cancelled':
      return '已取消 (cancelled)';
    default:
      return status || '-';
  }
}

/**
 * Fetch inventory adjustments list from SQLite / Mock
 * @param {any} [arg1=null]
 * @param {any} [arg2=null]
 * @returns {Promise<any[]>}
 */
export async function fetchInventoryAdjustments(arg1 = null, arg2 = null) {
  let status = null;
  let warehouseId = null;

  if (typeof arg1 === 'object' && arg1 !== null) {
    status = arg1.status || null;
    warehouseId = arg1.warehouse_id || arg1.warehouseId || null;
  } else if (arg1 === 'draft' || arg1 === 'posted' || arg1 === 'cancelled') {
    status = arg1;
    warehouseId = arg2;
  } else if (arg2 === 'draft' || arg2 === 'posted' || arg2 === 'cancelled') {
    warehouseId = arg1;
    status = arg2;
  } else if (arg1 && typeof arg1 === 'string' && (arg1.startsWith('wh_') || !arg2)) {
    // If only one param or starts with wh_, treat as warehouseId unless it's a status
    warehouseId = arg1;
    status = arg2;
  } else {
    status = arg1;
    warehouseId = arg2;
  }

  try {
    const payload = {};
    if (status && status !== 'all') {
      payload.status = status;
    }
    if (warehouseId && String(warehouseId).trim() !== '') {
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_inventory_adjustments', payload);
    appState.inventoryAdjustments = list || [];
    return appState.inventoryAdjustments;
  } catch (err) {
    console.error("Failed to fetch inventory adjustments:", err);
    return [];
  }
}

/**
 * Fetch inventory adjustment detail by ID
 * @param {string} adjustmentId
 * @returns {Promise<any>}
 */
export async function fetchInventoryAdjustmentDetail(adjustmentId) {
  if (!adjustmentId) return null;
  try {
    const detail = await invoke('get_inventory_adjustment', {
      adjustmentId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch inventory adjustment detail:", err);
    throw err;
  }
}

/**
 * Select active inventory adjustment and load detail
 * @param {string | null} adjustmentId
 */
export async function selectInventoryAdjustment(adjustmentId) {
  appState.selectedInventoryAdjustmentId = adjustmentId;
  if (adjustmentId) {
    const detail = await fetchInventoryAdjustmentDetail(adjustmentId);
    return detail;
  } else {
    appState.currentInventoryAdjustmentDetail = null;
    return null;
  }
}

/**
 * Create a new inventory adjustment (draft)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createInventoryAdjustmentAction({
  warehouse_id,
  warehouseId,
  reason_code,
  reasonCode,
  note = null,
  task_id = null,
  taskId = null,
  initial_lines,
  initialLines
} = {}) {
  const targetWhId = String(warehouse_id !== undefined ? warehouse_id : (warehouseId !== undefined ? warehouseId : '')).trim();
  const targetReason = String(reason_code !== undefined ? reason_code : (reasonCode !== undefined ? reasonCode : '')).trim();
  const lines = initial_lines !== undefined ? initial_lines : initialLines;

  const payload = {
    warehouseId: targetWhId,
    reasonCode: targetReason,
    note: note ? String(note).trim() : null,
    taskId: task_id || taskId || null
  };
  if (lines && Array.isArray(lines)) {
    payload.initialLines = lines;
  }

  try {
    const detail = await invoke('create_inventory_adjustment', payload);
    appState.currentInventoryAdjustmentDetail = detail;
    appState.selectedInventoryAdjustmentId = detail.adjustment.id;
    await fetchInventoryAdjustments();
    showToast(`已建立調整單「${detail.adjustment.adjustment_number}」！`);
    return detail.adjustment;
  } catch (err) {
    console.error("Failed to create inventory adjustment:", err);
    throw err;
  }
}

/**
 * Update inventory adjustment header
 * @param {string} adjustmentId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updateInventoryAdjustmentHeaderAction(adjustmentId, {
  warehouse_id,
  warehouseId,
  reason_code,
  reasonCode,
  note
} = {}) {
  const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
  const targetReason = reason_code !== undefined ? reason_code : reasonCode;

  try {
    const detail = await invoke('update_inventory_adjustment_header', {
      adjustmentId,
      warehouseId: targetWhId || null,
      reasonCode: targetReason || null,
      note: note !== undefined ? note : null
    });
    appState.currentInventoryAdjustmentDetail = detail;
    await fetchInventoryAdjustments();
    showToast(`已更新調整單表頭！`);
    return detail;
  } catch (err) {
    console.error("Failed to update inventory adjustment header:", err);
    throw err;
  }
}

/**
 * Add a line to inventory adjustment
 * @param {string} adjustmentId
 * @param {string} unitId
 * @param {number} quantityDelta
 * @returns {Promise<any>}
 */
export async function addInventoryAdjustmentLineAction(adjustmentId, unitId, quantityDelta) {
  try {
    const detail = await invoke('add_inventory_adjustment_line', {
      adjustmentId,
      unitId,
      quantityDelta: Number(quantityDelta)
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to add inventory adjustment line:", err);
    throw err;
  }
}

/**
 * Update quantity delta of an adjustment line
 * @param {string} lineId
 * @param {number} quantityDelta
 * @returns {Promise<any>}
 */
export async function updateInventoryAdjustmentLineAction(lineId, quantityDelta) {
  try {
    const detail = await invoke('update_inventory_adjustment_line', {
      lineId,
      quantityDelta: Number(quantityDelta)
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to update inventory adjustment line:", err);
    throw err;
  }
}

/**
 * Remove an adjustment line
 * @param {string} arg1
 * @param {string | null} [arg2=null]
 * @returns {Promise<any>}
 */
export async function removeInventoryAdjustmentLineAction(arg1, arg2 = null) {
  const targetLineId = arg2 ? String(arg2).trim() : String(arg1).trim();
  try {
    const detail = await invoke('remove_inventory_adjustment_line', {
      lineId: targetLineId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to remove inventory adjustment line:", err);
    throw err;
  }
}

/**
 * Post inventory adjustment to ledger
 * @param {string} adjustmentId
 * @returns {Promise<any>}
 */
export async function postInventoryAdjustmentAction(adjustmentId) {
  try {
    const detail = await invoke('post_inventory_adjustment', {
      adjustmentId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    await Promise.all([
      fetchInventoryAdjustments(),
      fetchInventoryLevels()
    ]);
    showToast(`調整單「${detail.adjustment.adjustment_number}」已過帳，庫存已同步更新！`);
    return detail.adjustment;
  } catch (err) {
    console.error("Failed to post inventory adjustment:", err);
    throw err;
  }
}

/**
 * Cancel a draft inventory adjustment
 * @param {string} adjustmentId
 * @returns {Promise<any>}
 */
export async function cancelInventoryAdjustmentAction(adjustmentId) {
  try {
    const detail = await invoke('cancel_inventory_adjustment', {
      adjustmentId
    });
    appState.currentInventoryAdjustmentDetail = detail;
    await fetchInventoryAdjustments();
    showToast(`已取消調整單「${detail.adjustment.adjustment_number}」！`);
    return detail.adjustment;
  } catch (err) {
    console.error("Failed to cancel inventory adjustment:", err);
    throw err;
  }
}

export const STOCKTAKE_STATUS_META = {
  draft: { label: '草稿 (draft)', badgeClass: 'badge-gray', progressBadgeClass: null },
  counting: { label: '盤點中 (counting)', badgeClass: 'badge-sky', progressBadgeClass: 'badge-sky' },
  posted: { label: '已過帳 (posted)', badgeClass: 'badge-emerald', progressBadgeClass: 'badge-emerald' },
  cancelled: { label: '已取消 (cancelled)', badgeClass: 'badge-red', progressBadgeClass: null }
};

/**
 * Get CSS badge class for stocktake status
 * @param {string} status
 * @returns {string}
 */
export function getStocktakeStatusBadgeClass(status) {
  return STOCKTAKE_STATUS_META[status]?.badgeClass || 'badge-gray';
}

/**
 * Check if error is an S-07 concurrent inventory movement error
 * @param {any} err
 * @returns {boolean}
 */
export function isStocktakeMovementConflictError(err) {
  if (!err) return false;
  return err.code === 'MOVEMENTS_DETECTED_DURING_COUNTING';
}

/**
 * Format stocktake status to badge label
 * @param {string} status
 * @returns {string}
 */
export function formatStocktakeStatus(status) {
  return STOCKTAKE_STATUS_META[status]?.label || (status || '-');
}

/**
 * Format stocktake progress badge and label
 * @param {object} stk
 * @returns {{ type: 'badge' | 'text', badgeClass?: string, label: string }}
 */
export function formatStocktakeProgress(stk) {
  if (!stk) return { type: 'text', label: '-' };
  if (stk.status === 'draft') return { type: 'text', label: '-' };
  if (stk.status === 'counting') {
    return {
      type: 'badge',
      badgeClass: STOCKTAKE_STATUS_META.counting.progressBadgeClass || 'badge-sky',
      label: `${stk.counted_count ?? 0} / ${stk.lines_count ?? 0}`
    };
  }
  if (stk.status === 'posted') {
    return {
      type: 'badge',
      badgeClass: STOCKTAKE_STATUS_META.posted.progressBadgeClass || 'badge-emerald',
      label: `已完成 (${stk.counted_count ?? 0}/${stk.lines_count ?? 0})`
    };
  }
  return { type: 'text', label: '已取消' };
}

/**
 * Fetch stocktakes with optional filters
 * @param {object | string} [filters={}] - Filter object { status, warehouseId } or legacy status
 * @param {string | null} [legacyWhId=null] - warehouseId if filters is string status
 * @returns {Promise<any[]>}
 */
export async function fetchStocktakes(filters = {}, legacyWhId = null) {
  let status = null;
  let warehouseId = null;

  if (typeof filters === 'object' && filters !== null) {
    status = filters.status || null;
    warehouseId = filters.warehouseId || filters.warehouse_id || null;
  } else if (typeof filters === 'string') {
    status = filters;
    warehouseId = legacyWhId;
  }

  try {
    const payload = {};
    if (status && status !== 'all') {
      payload.status = status;
    }
    if (warehouseId && String(warehouseId).trim() !== '' && warehouseId !== 'all') {
      payload.warehouseId = String(warehouseId).trim();
    }
    const list = await invoke('list_stocktakes', payload);
    appState.stocktakes = list || [];
    return appState.stocktakes;
  } catch (err) {
    console.error("Failed to fetch stocktakes:", err);
    throw err;
  }
}

/**
 * Fetch stocktake detail by ID
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function fetchStocktakeDetail(stocktakeId) {
  if (!stocktakeId) return null;
  try {
    const detail = await invoke('get_stocktake', { stocktakeId });
    appState.currentStocktakeDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch stocktake detail:", err);
    throw err;
  }
}

/**
 * Select active stocktake and load detail
 * @param {string | null} stocktakeId
 */
export async function selectStocktake(stocktakeId) {
  resetStocktakeDetailSequences();
  appState.selectedStocktakeId = stocktakeId;
  if (stocktakeId) {
    const detail = await fetchStocktakeDetail(stocktakeId);
    return detail;
  } else {
    appState.currentStocktakeDetail = null;
    return null;
  }
}

/**
 * Normalize dual snake_case / camelCase fields for stocktake inputs.
 * @param {object} [input={}]
 * @returns {{ warehouseId?: string|null, note?: string|null, taskId?: string|null, initialUnitIds?: string[] }}
 */
export function normalizeStocktakeInput(input = {}) {
  if (!input || typeof input !== 'object') return {};
  const res = {};
  const wh = input.warehouse_id !== undefined ? input.warehouse_id : input.warehouseId;
  if (wh !== undefined) {
    res.warehouseId = wh !== null ? String(wh).trim() : null;
  }
  if (input.note !== undefined) {
    res.note = input.note !== null ? String(input.note).trim() : null;
  }
  const task = input.task_id !== undefined ? input.task_id : input.taskId;
  if (task !== undefined) {
    res.taskId = task ? String(task).trim() : null;
  }
  const units = input.initial_unit_ids !== undefined ? input.initial_unit_ids : input.initialUnitIds;
  if (units !== undefined) {
    res.initialUnitIds = Array.isArray(units) ? units : [units];
  }
  return res;
}

/**
 * Create a new stocktake (draft)
 * @param {object} input
 * @returns {Promise<any>}
 */
export async function createStocktakeAction(input = {}) {
  const norm = normalizeStocktakeInput(input);

  const payload = {
    warehouseId: norm.warehouseId || '',
    note: norm.note || null,
    taskId: norm.taskId || null
  };
  if (norm.initialUnitIds) {
    payload.initialUnitIds = norm.initialUnitIds;
  }

  try {
    const detail = await invoke('create_stocktake', payload);
    appState.currentStocktakeDetail = detail;
    appState.selectedStocktakeId = detail.stocktake.id;
    await fetchStocktakes();
    showToast(`已建立盤點單「${detail.stocktake.stocktake_number}」！`);
    return detail.stocktake;
  } catch (err) {
    console.error("Failed to create stocktake:", err);
    throw err;
  }
}

/**
 * Update stocktake header
 * @param {string} stocktakeId
 * @param {object} updates
 * @returns {Promise<any>}
 */
export async function updateStocktakeHeaderAction(stocktakeId, updates = {}) {
  const norm = normalizeStocktakeInput(updates);

  try {
    const payload = { stocktakeId };
    if (norm.warehouseId !== undefined) {
      payload.warehouseId = norm.warehouseId || null;
    }
    if (norm.note !== undefined) {
      payload.note = norm.note;
    }
    const detail = await invoke('update_stocktake_header', { payload });
    appState.currentStocktakeDetail = detail;
    patchStocktakeInList(detail.stocktake);
    showToast(`已更新盤點單表頭！`);
    return detail;
  } catch (err) {
    console.error("Failed to update stocktake header:", err);
    throw err;
  }
}

/**
 * Add product units to a draft stocktake
 * @param {string} stocktakeId
 * @param {string[]} unitIds
 * @returns {Promise<any>}
 */
export async function addStocktakeLinesAction(stocktakeId, unitIds) {
  const list = Array.isArray(unitIds) ? unitIds : [unitIds];
  try {
    const detail = await invoke('add_stocktake_lines', {
      stocktakeId,
      unitIds: list
    });
    appState.currentStocktakeDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to add stocktake lines:", err);
    throw err;
  }
}

/**
 * Add all active inventory items from warehouse into draft stocktake (S-04)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function addStocktakeLinesFromStockAction(stocktakeId) {
  try {
    const detail = await invoke('add_stocktake_lines_from_stock', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    showToast(`已帶入此倉現有庫存品項！`);
    return detail;
  } catch (err) {
    console.error("Failed to add stocktake lines from stock:", err);
    throw err;
  }
}

/**
 * Remove a stocktake line
 * @param {string} lineId
 * @returns {Promise<any>}
 */
export async function removeStocktakeLineAction(lineId) {
  try {
    const detail = await invoke('remove_stocktake_line', {
      lineId
    });
    appState.currentStocktakeDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to remove stocktake line:", err);
    throw err;
  }
}

/**
 * Start counting for a draft stocktake (transitions to counting, snapshots balances)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function startStocktakeCountingAction(stocktakeId) {
  try {
    const detail = await invoke('start_stocktake_counting', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    patchStocktakeInList(detail.stocktake);
    showToast(`盤點單「${detail.stocktake.stocktake_number}」已開始盤點！`);
    return detail;
  } catch (err) {
    console.error("Failed to start stocktake counting:", err);
    throw err;
  }
}

/**
 * Update a single stocktake item in appState.stocktakes in-place
 * @param {any} updatedStocktake
 */
export function patchStocktakeInList(updatedStocktake) {
  if (!updatedStocktake || !Array.isArray(appState.stocktakes)) return;
  const idx = appState.stocktakes.findIndex(s => s.id === updatedStocktake.id);
  if (idx !== -1) {
    appState.stocktakes[idx] = { ...appState.stocktakes[idx], ...updatedStocktake };
  }
}

// Re-export single source of truth from tauri.js
export { isStocktakeLineCounted };

export const STOCKTAKE_VARIANCE_EPSILON = 1e-6;

/**
 * Classify variance delta for a single stocktake line
 * @param {number|null|undefined} countedQuantity
 * @param {number|null|undefined} systemQuantity
 * @returns {'missing' | 'surplus' | 'shortage' | 'matched'}
 */
export function classifyStocktakeLineVariance(countedQuantity, systemQuantity) {
  if (!isStocktakeLineCounted(countedQuantity)) {
    return 'missing';
  }
  const delta = Number(countedQuantity) - (Number(systemQuantity) || 0);
  if (delta > STOCKTAKE_VARIANCE_EPSILON) {
    return 'surplus';
  }
  if (delta < -STOCKTAKE_VARIANCE_EPSILON) {
    return 'shortage';
  }
  return 'matched';
}

/**
 * Calculate post summary metrics for a list of stocktake lines
 * @param {Array<any>} lines
 * @returns {{ surplus: number, shortage: number, matched: number, missing: number }}
 */
export function calculateStocktakePostSummary(lines = []) {
  const summary = { surplus: 0, shortage: 0, matched: 0, missing: 0 };
  for (const line of (lines || [])) {
    const status = classifyStocktakeLineVariance(line.counted_quantity, line.system_quantity);
    summary[status]++;
  }
  return summary;
}

/**
 * Format a bracketed conflict line snapshot label for S-07 conflict reporting and matching.
 * @param {any} line
 * @returns {string}
 */
export function formatStocktakeConflictLineLabel(line) {
  return `〔${line?.product_name_snapshot ?? ''}／${line?.variant_name_snapshot ?? ''}／${line?.unit_name_snapshot ?? ''}〕`;
}

/**
 * Extract affected line IDs from S-07 concurrency conflict error or message.
 * Prioritizes structured `affected_line_ids` / `affectedLineIds` from backend payload.
 * @param {any} errOrMsg
 * @param {Array<any>} lines
 * @returns {string[]} matchedLineIds
 */
export function parseStocktakeConflictLines(errOrMsg, lines = []) {
  if (!errOrMsg || !Array.isArray(lines) || lines.length === 0) {
    return [];
  }
  if (typeof errOrMsg === 'object') {
    const structuredIds = Array.isArray(errOrMsg.affected_line_ids)
      ? errOrMsg.affected_line_ids
      : (Array.isArray(errOrMsg.affectedLineIds) ? errOrMsg.affectedLineIds : null);
    if (structuredIds) {
      const idSet = new Set(structuredIds);
      return lines.filter(l => l && idSet.has(l.id)).map(l => l.id);
    }
  }
  return [];
}

let stocktakeDetailSeq = 0;
const lineUpdateSeqs = new Map();

/**
 * Reset and invalidate stocktake in-flight detail requests and line updates.
 */
export function resetStocktakeDetailSequences() {
  ++stocktakeDetailSeq;
  lineUpdateSeqs.clear();
}

// Automatically subscribe stocktake detail flow to route navigation invalidation
registerNavigationStalenessListener(resetStocktakeDetailSequences);

/**
 * Return current number of tracked in-flight/active line sequence entries (for diagnostics/testing)
 * @returns {number}
 */
export function getLineUpdateSeqsSize() {
  return lineUpdateSeqs.size;
}

/**
 * Set counted quantity for a specific stocktake line
 * @param {string} lineId
 * @param {number | string | null} [countedQuantity=null]
 * @returns {Promise<any>}
 */
export async function setStocktakeCountedQuantityAction(lineId, countedQuantity) {
  const currentSeq = ++stocktakeDetailSeq;
  lineUpdateSeqs.set(lineId, currentSeq);
  try {
    const payload = { lineId };
    if (countedQuantity !== undefined) {
      payload.countedQuantity = (countedQuantity === null || countedQuantity === '')
        ? null
        : Number(countedQuantity);
    }
    const updatedLine = await invoke('set_stocktake_counted_quantity', { payload });

    // Guard against navigation / stocktake switching during in-flight request
    const activeStocktake = appState.currentStocktakeDetail?.stocktake;
    const isMatchingStocktake = activeStocktake && (
      !updatedLine?.stocktake_id || updatedLine.stocktake_id === activeStocktake.id
    );

    if (isMatchingStocktake) {
      const isLatestForLine = lineUpdateSeqs.get(lineId) === currentSeq;
      if (isLatestForLine) {
        // Targeted in-place per-line patch!
        // Does NOT reassign appState.currentStocktakeDetail, preventing unblurred input loss on sibling rows
        if (Array.isArray(appState.currentStocktakeDetail.lines)) {
          const line = appState.currentStocktakeDetail.lines.find(l => l.id === lineId);
          if (line) {
            line.counted_quantity = updatedLine?.counted_quantity !== undefined ? updatedLine.counted_quantity : (payload.countedQuantity ?? null);
          }
        }
      }
    }

    return updatedLine;
  } catch (err) {
    console.error("Failed to set stocktake counted quantity:", err);
    throw err;
  }
}

/**
 * Refresh system quantity snapshots for affected lines (S-08)
 * @param {string} stocktakeId
 * @param {string[]} lineIds
 * @returns {Promise<any>}
 */
export async function refreshStocktakeSystemQuantityAction(stocktakeId, lineIds) {
  const list = Array.isArray(lineIds) ? lineIds : [lineIds];
  try {
    const detail = await invoke('refresh_stocktake_system_quantity', {
      stocktakeId,
      lineIds: list
    });
    appState.currentStocktakeDetail = detail;
    showToast(`已重新取得系統量快照，相關品項實盤量已清空，請重新清點！`);
    return detail;
  } catch (err) {
    console.error("Failed to refresh stocktake system quantity:", err);
    throw err;
  }
}

/**
 * Post stocktake to ledger (transitions to posted, creates movement ledger rows)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function postStocktakeAction(stocktakeId) {
  try {
    const detail = await invoke('post_stocktake', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    await Promise.all([
      fetchStocktakes(),
      fetchInventoryLevels()
    ]);
    showToast(`盤點單「${detail.stocktake.stocktake_number}」已過帳，庫存已同步更新！`);
    return detail.stocktake;
  } catch (err) {
    console.error("Failed to post stocktake:", err);
    const rawErr = /** @type {any} */ (err);
    if (rawErr && typeof rawErr === 'object' && !(rawErr instanceof Error) && rawErr.message) {
      const wrapped = /** @type {any} */ (new Error(rawErr.message));
      if (rawErr.code) wrapped.code = rawErr.code;
      if (Array.isArray(rawErr.affected_line_ids)) wrapped.affected_line_ids = rawErr.affected_line_ids;
      if (Array.isArray(rawErr.affectedLineIds)) wrapped.affectedLineIds = rawErr.affectedLineIds;
      throw wrapped;
    }
    throw err;
  }
}

/**
 * Cancel a stocktake (from draft or counting)
 * @param {string} stocktakeId
 * @returns {Promise<any>}
 */
export async function cancelStocktakeAction(stocktakeId) {
  try {
    const detail = await invoke('cancel_stocktake', {
      stocktakeId
    });
    appState.currentStocktakeDetail = detail;
    patchStocktakeInList(detail.stocktake);
    showToast(`已取消盤點單「${detail.stocktake.stocktake_number}」！`);
    return detail.stocktake;
  } catch (err) {
    console.error("Failed to cancel stocktake:", err);
    throw err;
  }
}

// ==========================================
// Stock Transfers (Issue #185)
// ==========================================

/**
 * Patch a transfer in appState.stockTransfers in-place
 * @param {any} updatedTransfer
 */
export function patchStockTransferInList(updatedTransfer) {
  if (!updatedTransfer || !Array.isArray(appState.stockTransfers)) return;
  const idx = appState.stockTransfers.findIndex(t => t.id === updatedTransfer.id);
  if (idx !== -1) {
    appState.stockTransfers[idx] = { ...appState.stockTransfers[idx], ...updatedTransfer };
  }
}

/**
 * Fetch list of stock transfers with optional filters
 * @param {{ status?: string, fromWarehouseId?: string, toWarehouseId?: string }} [filters]
 * @returns {Promise<any[]>}
 */
export async function fetchStockTransfers(filters = {}) {
  try {
    const payload = {};
    if (filters.status && String(filters.status).trim()) {
      payload.status = String(filters.status).trim();
    }
    if (filters.fromWarehouseId && String(filters.fromWarehouseId).trim()) {
      payload.fromWarehouseId = String(filters.fromWarehouseId).trim();
    }
    if (filters.toWarehouseId && String(filters.toWarehouseId).trim()) {
      payload.toWarehouseId = String(filters.toWarehouseId).trim();
    }
    const list = await invoke('list_stock_transfers', payload);
    appState.stockTransfers = list || [];
    return appState.stockTransfers;
  } catch (err) {
    console.error("Failed to fetch stock transfers:", err);
    throw err;
  }
}

/**
 * Fetch detail of a single stock transfer
 * @param {string} transferId
 * @returns {Promise<any>}
 */
export async function fetchStockTransferDetail(transferId) {
  try {
    const detail = await invoke('get_stock_transfer', { transferId });
    appState.currentStockTransferDetail = detail;
    appState.selectedStockTransferId = detail.transfer.id;
    patchStockTransferInList(detail.transfer);
    return detail;
  } catch (err) {
    console.error("Failed to fetch stock transfer detail:", err);
    throw err;
  }
}

/**
 * Create a new stock transfer
 * @param {{ fromWarehouseId: string, toWarehouseId: string, note?: string | null, taskId?: string | null, initialLines?: any[] }} params
 * @returns {Promise<any>}
 */
export async function createStockTransferAction({
  fromWarehouseId,
  toWarehouseId,
  note = null,
  taskId = null,
  initialLines = []
}) {
  try {
    const payload = {
      fromWarehouseId,
      toWarehouseId,
      note: note || null,
      taskId: taskId || null,
      initialLines: Array.isArray(initialLines) && initialLines.length > 0 ? initialLines : null
    };
    const detail = await invoke('create_stock_transfer', payload);
    appState.currentStockTransferDetail = detail;
    appState.selectedStockTransferId = detail.transfer.id;
    appState.stockTransfers = [detail.transfer, ...appState.stockTransfers.filter(t => t.id !== detail.transfer.id)];
    showToast(`調撥單「${detail.transfer.transfer_number}」建立成功！`);
    return detail;
  } catch (err) {
    console.error("Failed to create stock transfer:", err);
    throw err;
  }
}

/**
 * Update stock transfer header
 * @param {{ transferId: string, fromWarehouseId?: string, toWarehouseId?: string, note?: string|null }} params
 * @returns {Promise<any>}
 */
export async function updateStockTransferHeaderAction({
  transferId,
  fromWarehouseId,
  toWarehouseId,
  note
}) {
  try {
    const payload = {
      transferId,
      fromWarehouseId: fromWarehouseId !== undefined ? fromWarehouseId : null,
      toWarehouseId: toWarehouseId !== undefined ? toWarehouseId : null,
      note: note !== undefined ? note : null
    };
    const detail = await invoke('update_stock_transfer_header', payload);
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("調撥單表頭更新成功！");
    return detail;
  } catch (err) {
    console.error("Failed to update stock transfer header:", err);
    throw err;
  }
}

/**
 * Add a line to a draft stock transfer
 * @param {string} transferId
 * @param {string} unitId
 * @param {number} quantity
 * @returns {Promise<any>}
 */
export async function addStockTransferLineAction(transferId, unitId, quantity) {
  try {
    const detail = await invoke('add_stock_transfer_line', {
      transferId,
      unitId,
      quantity: Number(quantity)
    });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("新增調撥明細成功！");
    return detail;
  } catch (err) {
    console.error("Failed to add stock transfer line:", err);
    throw err;
  }
}

/**
 * Update quantity of a line in a draft stock transfer
 * @param {string} lineId
 * @param {number} quantity
 * @returns {Promise<any>}
 */
export async function updateStockTransferLineAction(lineId, quantity) {
  try {
    const detail = await invoke('update_stock_transfer_line', {
      lineId,
      quantity: Number(quantity)
    });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("調撥數量更新成功！");
    return detail;
  } catch (err) {
    console.error("Failed to update stock transfer line:", err);
    throw err;
  }
}

/**
 * Remove a line from a draft stock transfer
 * @param {string} lineId
 * @returns {Promise<any>}
 */
export async function removeStockTransferLineAction(lineId) {
  try {
    const detail = await invoke('remove_stock_transfer_line', { lineId });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast("已移除調撥明細！");
    return detail;
  } catch (err) {
    console.error("Failed to remove stock transfer line:", err);
    throw err;
  }
}

/**
 * Post a stock transfer
 * @param {string} transferId
 * @returns {Promise<any>}
 */
export async function postStockTransferAction(transferId) {
  try {
    const detail = await invoke('post_stock_transfer', { transferId });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast(`調撥單「${detail.transfer.transfer_number}」已成功過帳！`);
    // Refresh inventory levels and movements
    fetchInventoryLevels().catch(() => {});
    fetchInventoryMovements().catch(() => {});
    return detail;
  } catch (err) {
    console.error("Failed to post stock transfer:", err);
    throw err;
  }
}

/**
 * Cancel a stock transfer
 * @param {string} transferId
 * @returns {Promise<any>}
 */
export async function cancelStockTransferAction(transferId) {
  try {
    const detail = await invoke('cancel_stock_transfer', { transferId });
    appState.currentStockTransferDetail = detail;
    patchStockTransferInList(detail.transfer);
    showToast(`已取消調撥單「${detail.transfer.transfer_number}」！`);
    return detail;
  } catch (err) {
    console.error("Failed to cancel stock transfer:", err);
    throw err;
  }
}

