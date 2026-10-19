// @ts-check

/**
 * @typedef {import('./bindings').AuthStatusResponse} AuthStatusResponse
 * @typedef {import('./bindings').AuthUser} AuthUser
 * @typedef {import('./bindings').AuthTenant} AuthTenant
 * @typedef {import('./bindings').ApiErrorPayload} ApiErrorPayload
 * @typedef {import('./bindings').LogoutResponse} LogoutResponse
 */

import { invoke, check, relaunch } from './tauri.js';
import { loadModule } from './registry.js';
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

// Define the global reactive app state using Svelte 5 $state
export const appState = $state({
  route: '/app/agent',
  version: '0.1.0',
  isEnterpriseActive: false,
  /** @type {any[]} */
  installedModules: [], // List of installed module metadata
  /** @type {Record<string, any>} */
  loadedComponents: {}, // Map of moduleId -> Svelte Component class

  get activeWorkspace() {
    if (this.route === '/app/agent') return 'agent';
    if (this.route === '/app/sales') return 'sales';
    if (this.route === '/app/finance') return 'finance';
    if (this.route === '/app/crm') return 'crm';
    if (this.route === '/app/settings') return 'settings';
    
    // Generic fallback for any other workspaces like /app/xxx
    const match = this.route.match(/^\/app\/([^/]+)$/);
    if (match) return match[1];
    
    return 'agent';
  },

  set activeWorkspace(ws) {
    let targetRoute = `/app/${ws}`;
    if (ws === 'agent') targetRoute = '/app/agent';
    else if (ws === 'sales') targetRoute = '/app/sales';
    else if (ws === 'finance') targetRoute = '/app/finance';
    else if (ws === 'crm') targetRoute = '/app/crm';
    else if (ws === 'settings') targetRoute = '/app/settings';
    
    this.route = targetRoute;
    if (typeof window !== 'undefined' && window.location && window.location.hash !== '#' + targetRoute) {
      window.location.hash = targetRoute;
    }
  },

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
  /** @type {Record<string, Array<{ role: string, content: string, timestamp?: number }>>} */
  taskMessages: {},

  // Database cache lists
  /** @type {any[]} */
  mirroredOrders: [],
  /** @type {any[]} */
  auditLogs: [],
  /** @type {any[]} */
  notifications: [],

  // Mutation interceptor queue
  /** @type {any} */
  pendingMutation: null, // { id, title, details }

  // System updater status
  updateAvailable: false,
  updateNotes: '',
  updateStatus: 'idle', // 'idle' | 'checking' | 'downloading' | 'finished' | 'up-to-date'
  updateProgress: { percent: 0, downloaded: 0, total: 100 },
  /** @type {any} */
  activeUpdate: null, // Tauri updater instance
  /** @type {string | null} */
  toastMessage: null, // Toast popup message
  /** @type {any[]} */
  modulesGallery: [], // List of available modules in cloud store
  
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

  // Lightweight task confirmation state
  /** @type {import('./workflow/types.js').PendingConfirmation | null} */
  pendingTaskConfirmation: null
});

export function showToast(message) {
  appState.toastMessage = message;
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      appState.toastMessage = null;
    }, 3500);
  }
}

export function navigate(path) {
  if (typeof window !== 'undefined' && window.location) {
    window.location.hash = path;
  }
  appState.route = path;
}

// Fetch mirrored order list from SQLite
pub_fn("fetchOrders");
async function pub_fn(name) {} // Stub helper

export async function fetchOrders() {
  try {
    const list = await invoke('get_mirrored_orders');
    appState.mirroredOrders = list.map(o => ({ ...o, id: o.so_id || o.id }));
  } catch (err) {
    console.error("Failed to fetch mirrored orders:", err);
  }
}

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

// Check local DB for installed dynamic modules
pub_fn("fetchInstalledModules");
export async function fetchInstalledModules() {
  try {
    const list = await invoke('get_installed_modules');
    appState.installedModules = list;
    
    // Automatically register components for Svelte mounting
    for (const mod of list) {
      const { loadModule } = await import('./registry.js');
      await loadModule(mod.id);
    }
    
    if (list.some(m => m.id === 'sales_bi')) {
      appState.isEnterpriseActive = true;
    }
  } catch (err) {
    console.error("Failed to fetch installed modules:", err);
  }
}

// Fetch all available modules in the cloud gallery store
pub_fn("fetchModulesGallery");
export async function fetchModulesGallery() {
  try {
    let list = [];
    try {
      const response = await fetch('https://numaxofficee8.github.io/agent-erp/modules_gallery.json');
      if (response.ok) {
        list = await response.json();
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (e) {
      console.warn("Failed to fetch cloud modules gallery, using mock local catalogue:", e);
      // Local fallback catalogue for mock testing
      list = [
        {
          id: 'sales_bi',
          name: 'Finance BI 大看板',
          version: '1.0.2',
          description: '提供即時的銷售數據分析、獲利預測與動態利潤控制工具。',
          iconSvg: '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"10\"></line><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"4\"></line><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"14\"></line></svg>',
          downloadUrl: 'sales_bi_module.js',
          sha256: 'mock-sha-sales-bi'
        },
        {
          id: 'crm',
          name: 'CRM 客戶模組',
          version: '1.0.1',
          description: '企業級客戶關係管理，支援獨立沙盒與靜態 HTML 加載。',
          iconSvg: '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"></path><circle cx=\"9\" cy=\"7\" r=\"4\"></circle><path d=\"M23 21v-2a4 4 0 0 0-3-3.87\"></path><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"></path></svg>',
          downloadUrl: 'crm_dashboard.html',
          sha256: 'mock-sha-crm'
        }
      ];
    }
    appState.modulesGallery = list;
  } catch (err) {
    console.error("Failed to fetch modules gallery:", err);
  }
}

// Download and install a specific module from the store
pub_fn("installModuleAction");
export async function installModuleAction(moduleId) {
  const mod = appState.modulesGallery.find(m => m.id === moduleId);
  if (!mod) return;

  showToast(`正在下載安裝模組 ${mod.name}...`);
  try {
    await invoke('install_module', {
      moduleId: mod.id,
      name: mod.name,
      version: mod.version,
      iconSvg: mod.iconSvg,
      downloadUrl: mod.downloadUrl,
      sha256: mod.sha256
    });

    // Refresh installed list to dynamically mount Svelte component
    await fetchInstalledModules();
    showToast(`模組 ${mod.name} 安裝成功！選單已更新。`);
  } catch (err) {
    console.error(`Failed to install module ${mod.name}:`, err);
    showToast(`模組安裝失敗: ${err}`);
  }
}

// Uninstall a registered module and clear dynamic component states
pub_fn("uninstallModuleAction");
export async function uninstallModuleAction(moduleId) {
  const mod = appState.installedModules.find(m => m.id === moduleId);
  const name = mod ? mod.name : moduleId;

  showToast(`正在解除安裝模組 ${name}...`);
  try {
    await invoke('uninstall_module', { moduleId });
    
    // Clear dynamic component class
    delete appState.loadedComponents[moduleId];
    appState.loadedComponents = { ...appState.loadedComponents };
    
    // Refresh installed list
    await fetchInstalledModules();
    
    // If viewing the uninstalled module, route back to sales tab
    if (appState.activeWorkspace === moduleId) {
      appState.activeWorkspace = 'sales';
    }
    
    showToast(`模組 ${name} 已成功解除安裝！`);
  } catch (err) {
    console.error(`Failed to uninstall module ${moduleId}:`, err);
    showToast(`解除安裝失敗: ${err}`);
  }
}

// Trigger customer PO webhook simulation
pub_fn("triggerWebhookSimulation");
export async function triggerWebhookSimulation() {
  try {
    // Inject a pending notification ticker
    appState.notifications = [
      { id: 'notify-webhook', title: 'Webhook 觸發中...', message: '正在傳送模擬採購單 (PO-2026-0092) 到邊緣端...' }
    ];
    await invoke('simulate_webhook_order');
  } catch (err) {
    console.error("Webhook simulation trigger failed:", err);
  }
}

// Approve mutation card
pub_fn("approveMutation");
export async function approveMutation(id) {
  if (!appState.pendingMutation) return;
  try {
    const operator = appState.authUser?.display_name || appState.authUser?.email || 'Unknown';
    await invoke('confirm_mutation', { mutationId: id, approved: true, operator });
    appState.pendingMutation = null;
    await fetchOrders();
    await fetchAuditLogs();
    
    appState.chatMessages.push({
      role: 'assistant',
      content: `已成功核准訂單 ${id}！寫入指令已釋放，已更新本地 SQLite 庫存，並將加密收據回傳給 A 公司。`
    });
  } catch (err) {
    console.error("Failed to approve mutation:", err);
  }
}

// Reject mutation card
pub_fn("rejectMutation");
export async function rejectMutation(id) {
  if (!appState.pendingMutation) return;
  try {
    const operator = appState.authUser?.display_name || appState.authUser?.email || 'Unknown';
    await invoke('confirm_mutation', { mutationId: id, approved: false, operator });
    appState.pendingMutation = null;
    await fetchOrders();
    await fetchAuditLogs();
    
    appState.chatMessages.push({
      role: 'assistant',
      content: `已拒絕訂單 ${id} 的核准寫入。該指令已被安全阻斷，審計日誌已記錄 ${operator === 'Unknown' ? '操作者' : operator} 的拒絕動作。`
    });
  } catch (err) {
    console.error("Failed to reject mutation:", err);
  }
}

// Simulate downloading, SHA-256 verifying, and hot-plugging the enterprise modules
pub_fn("activateEnterprise");
export async function activateEnterprise() {
  appState.isEnterpriseActive = false;
  
  try {
    // 1. Download & verify Svelte JS module
    const biMeta = await invoke('download_module', { moduleId: 'sales_bi' });
    await loadModule(biMeta.id);
    
    // 2. Download & verify crm iframe dashboard
    const crmMeta = await invoke('download_module', { moduleId: 'crm' });
    await loadModule(crmMeta.id);
    
    await fetchInstalledModules();
    
    appState.chatMessages.push({
      role: 'assistant',
      content: "企業進階授權已解鎖！Finance BI 看板與 CRM 模組已在本地 AppData 安全目錄完成 SHA-256 數位簽章驗收並動態載入。主介面已無縫更新。"
    });
  } catch (err) {
    console.error("Enterprise activation failed:", err);
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

/**
 * Shared helper to seed onboarding parent and child tasks
 * @param {string} tenantName
 */
export async function seedOnboardingTasks(tenantName) {
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
 * Fetch tasks from SQLite
 * @param {string | null} [moduleId]
 * @returns {Promise<any[]>}
 */
export async function fetchTasks(moduleId = null) {
  try {
    const list = await invoke('list_tasks', {
      moduleId: moduleId ? moduleId.trim() : ''
    });
    appState.tasks = list || [];
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
 * @param {string | { name: string, tax_id?: string, taxId?: string, is_customer?: boolean, isCustomer?: boolean, is_vendor?: boolean, isVendor?: boolean }} input
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

  try {
    const partner = await invoke('create_partner', {
      name,
      isCustomer: is_customer,
      isVendor: is_vendor,
      taxId: normalizedTaxId,
      is_customer,
      is_vendor,
      tax_id: normalizedTaxId
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
 * Update an existing partner's name and/or tax_id
 * @param {{ id: string, name?: string, taxId?: string, tax_id?: string }} input
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
 *
 * @param {any[]} tasks
 * @param {string[] | Set<string> | null | undefined} [effectiveSkills]
 * @returns {any[]}
 */
export function filterTasksBySkills(tasks, effectiveSkills = getCurrentUserEffectiveSkills()) {
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

  return tasks.filter(task => {
    if (!task || typeof task !== 'object') {
      return false;
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
    const { content, toolName, completesTask, summary, toast } = await executeConfirmation(conf, { 
      taskId, 
      activeTask: appState.tasks.find(t => t.id === taskId) 
    });

    if (taskId && content) {
      await appendTaskMessageAction(taskId, 'assistant', content);
    }

    if (taskId && completesTask) {
      await updateTaskStatusAction(taskId, 'done');
    }

    if (summary) {
      await appendTaskMessageAction('main', 'assistant', summary);
    }

    if (toolName === 'create_department' || toolName === 'list_departments') {
      await fetchDepartments();
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

