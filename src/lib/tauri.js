// Detect if we are in Tauri runtime
export const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

let mockAuditLogs = loadStorage('agent_erp_mock_audit_logs', []);
let mockLlmTraces = loadStorage('agent_erp_mock_llm_traces', []);

function loadStorage(key, defaultVal) {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = localStorage.getItem(key);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
  }
  return defaultVal;
}

function saveStorage(key, val) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (val === null || val === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(val));
      }
    } catch (e) {}
  }
}

let mockUidCounter = 0;
function nextMockUid(prefix) {
  mockUidCounter++;
  const ms = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}_${ms}_${mockUidCounter}_${rand}`;
}

// Local mock database for user authentication
const defaultMockUsers = [
  { id: "usr_mock_admin", email: "admin@example.com", password: "password123", name: "Admin User" },
  { id: "usr_mock_new", email: "new@example.com", password: "password123", name: "New User" }
];
const defaultMockTenants = [
  { id: "tnt_mock_1", code: "numax", name: "Numax Office", company_name: "Numax Inc." },
  { id: "tnt_mock_2", code: "alpha", name: "Alpha Corporation", company_name: "Alpha Corp." }
];
const defaultMockUserTenants = [
  { user_id: "usr_mock_admin", tenant_id: "tnt_mock_1", role: "admin" },
  { user_id: "usr_mock_admin", tenant_id: "tnt_mock_2", role: "member" }
];

let mockUsers = loadStorage('agent_erp_mock_users', defaultMockUsers);
let mockTenants = loadStorage('agent_erp_mock_tenants', defaultMockTenants);
let mockUserTenants = loadStorage('agent_erp_mock_user_tenants', defaultMockUserTenants);
let mockSessions = loadStorage('agent_erp_mock_session', null);

function resolveMockActiveTenantId() {
  if (mockSessions && mockSessions.active_tenant_id && typeof mockSessions.active_tenant_id === 'string' && mockSessions.active_tenant_id.trim()) {
    return mockSessions.active_tenant_id.trim();
  }
  return 'tnt_mock_1';
}

const defaultMockTasks = [
  {
    id: "task_parent_1",
    tenant_id: "tnt_mock_1",
    title: "新租戶起步",
    status: "in_progress",
    parent_task_id: null,
    module_id: "sales",
    assignee: "主管",
    skill_id: null,
    skillId: null,
    created_at: Math.floor(Date.now() / 1000) - 3600,
    completed_at: null
  },
  {
    id: "task_sub_1",
    tenant_id: "tnt_mock_1",
    title: "設定部門",
    status: "pending",
    parent_task_id: "task_parent_1",
    module_id: "sales",
    assignee: "主管",
    skill_id: "department.manage",
    skillId: "department.manage",
    created_at: Math.floor(Date.now() / 1000) - 3600,
    completed_at: null
  },
  {
    id: "task_sub_2",
    tenant_id: "tnt_mock_1",
    title: "建立第一個客戶",
    status: "pending",
    parent_task_id: "task_parent_1",
    module_id: "sales",
    assignee: "主管",
    skill_id: "customer.create_basic_profile",
    skillId: "customer.create_basic_profile",
    created_at: Math.floor(Date.now() / 1000) - 3600,
    completed_at: null
  },
  {
    id: "task_sub_3",
    tenant_id: "tnt_mock_1",
    title: "建立第一個供應商",
    status: "pending",
    parent_task_id: "task_parent_1",
    module_id: "sales",
    assignee: "主管",
    skill_id: "vendor.create_basic_profile",
    skillId: "vendor.create_basic_profile",
    skills: ["vendor.create_basic_profile", "vendor.manage"],
    created_at: Math.floor(Date.now() / 1000) - 3600,
    completed_at: null
  },
  {
    id: "task_sub_4",
    tenant_id: "tnt_mock_1",
    title: "建立第一個商品",
    status: "pending",
    parent_task_id: "task_parent_1",
    module_id: "sales",
    assignee: "主管",
    skill_id: "product.create_basic_profile",
    skillId: "product.create_basic_profile",
    skills: ["product.create_basic_profile", "product.manage"],
    created_at: Math.floor(Date.now() / 1000) - 3600,
    completed_at: null
  }
];

const defaultMockPendingTasksCount = defaultMockTasks.filter(t => t.status === 'pending').length;

const defaultMockTaskMessages = [
  {
    id: "msg_main_1",
    task_id: "main",
    role: "assistant",
    content: `你好，我是 AgentERP 智能助理。已載入本地安全邊緣工作站上下文。您目前有 ${defaultMockPendingTasksCount} 筆待處理任務、1 則未讀通知。想從下面的常用任務開始，或直接跟我說您需要什麼協助：`,
    timestamp: Math.floor(Date.now() / 1000) - 3600
  },
  {
    id: "msg_sub_1",
    task_id: "task_sub_1",
    role: "assistant",
    content: "您好！我是部門設定助理。新租戶建立完成後，首要步驟是建立組織部門。請問您想先新增哪一個部門？",
    timestamp: Math.floor(Date.now() / 1000) - 3600
  },
  {
    id: "msg_sub_2",
    task_id: "task_sub_2",
    role: "assistant",
    content: "您好！我是客戶管理助理。新租戶建立完成後，讓我們來建立第一筆客戶基本資料。請問您想先新增哪一位客戶？（例如：「我想新增台積電 統編 22099131」）",
    timestamp: Math.floor(Date.now() / 1000) - 3600
  },
  {
    id: "msg_sub_3",
    task_id: "task_sub_3",
    role: "assistant",
    content: "您好！我是供應商管理助理。新租戶建立完成後，讓我們來建立第一筆供應商基本資料。請問您想先新增哪一家供應商？（例如：「我想新增欣興電子 統編 11223344」）",
    timestamp: Math.floor(Date.now() / 1000) - 3600
  },
  {
    id: "msg_sub_4",
    task_id: "task_sub_4",
    role: "assistant",
    content: "您好！我是商品資料管理助理。新租戶建立完成後，讓我們來建立第一筆商品基本資料。請問您想先新增哪一項商品？（例如：「我想新增智能核心晶片 分類 轉售商品 售價 120」）",
    timestamp: Math.floor(Date.now() / 1000) - 3600
  }
];

let mockTasks = loadStorage('agent_erp_mock_tasks', defaultMockTasks);
if (!mockTasks || mockTasks.length === 0) {
  mockTasks = defaultMockTasks;
  saveStorage('agent_erp_mock_tasks', mockTasks);
} else {
  // Ensure backward compatibility migration
  let migrated = false;
  mockTasks.forEach(t => {
    if (!t.tenant_id) {
      t.tenant_id = 'tnt_mock_1';
      migrated = true;
    }
  });

  // Ensure task_sub_4 exists for product onboarding
  const hasProductSubtask = mockTasks.some(t => t.id === 'task_sub_4' || t.title === '建立第一個商品');
  if (!hasProductSubtask) {
    const parentTask = mockTasks.find(t => t.id === 'task_parent_1' || t.title === '新租戶起步');
    if (parentTask) {
      const prodSubtask = defaultMockTasks.find(t => t.id === 'task_sub_4');
      if (prodSubtask) {
        mockTasks.push({ ...prodSubtask, tenant_id: parentTask.tenant_id || 'tnt_mock_1', parent_task_id: parentTask.id });
        migrated = true;
      }
    }
  }

  if (migrated) saveStorage('agent_erp_mock_tasks', mockTasks);
}

let mockTaskMessages = loadStorage('agent_erp_mock_task_messages', defaultMockTaskMessages);
if (!mockTaskMessages || mockTaskMessages.length === 0) {
  mockTaskMessages = defaultMockTaskMessages;
  saveStorage('agent_erp_mock_task_messages', mockTaskMessages);
} else {
  // Ensure msg_sub_4 exists
  const hasProductMsg = mockTaskMessages.some(m => m.task_id === 'task_sub_4');
  if (!hasProductMsg) {
    const prodMsg = defaultMockTaskMessages.find(m => m.id === 'msg_sub_4');
    if (prodMsg) {
      mockTaskMessages.push({ ...prodMsg });
      saveStorage('agent_erp_mock_task_messages', mockTaskMessages);
    }
  }
}

function createDefaultMockDepartments(tenantId = 'tnt_mock_1') {
  return [
    { id: "dept_mock_1", tenant_id: tenantId, name: "總經理室", parent_id: null, skills: ["org.manage", "audit.trace_view"], created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
    { id: "dept_mock_2", tenant_id: tenantId, name: "研發總處", parent_id: null, skills: ["dev.repo_write", "dev.agent_config"], created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
    { id: "dept_mock_3", tenant_id: tenantId, name: "前端小組", parent_id: "dept_mock_2", skills: ["ui.build", "ui.component_test"], created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
    { id: "dept_mock_4", tenant_id: tenantId, name: "後端架構組", parent_id: "dept_mock_2", skills: ["backend.api_build", "db.migrate"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 },
    { id: "dept_mock_5", tenant_id: tenantId, name: "行銷業務部", parent_id: null, skills: ["sales.lead_manage", "crm.read"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 },
    { id: "dept_mock_6", tenant_id: tenantId, name: "財務會計處", parent_id: null, skills: ["finance.view", "invoice.issue"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 }
  ];
}

const defaultMockDepartments = createDefaultMockDepartments('tnt_mock_1');

let mockDepartments = loadStorage('agent_erp_mock_departments', null);
if (!mockDepartments || !Array.isArray(mockDepartments) || mockDepartments.length === 0) {
  mockDepartments = createDefaultMockDepartments('tnt_mock_1');
  saveStorage('agent_erp_mock_departments', mockDepartments);
} else {
  let migrated = false;
  mockDepartments.forEach(d => {
    if (!d.tenant_id) {
      d.tenant_id = 'tnt_mock_1';
      migrated = true;
    }
  });
  if (migrated) saveStorage('agent_erp_mock_departments', mockDepartments);
}

const defaultMockUserDepartments = [
  { user_id: "usr_mock_admin", tenant_id: "tnt_mock_1", department_id: "dept_mock_1" },
  { user_id: "usr_mock_admin", tenant_id: "tnt_mock_1", department_id: "dept_mock_2" }
];

let mockUserDepartments = loadStorage('agent_erp_mock_user_departments', defaultMockUserDepartments);
if (!mockUserDepartments || !Array.isArray(mockUserDepartments)) {
  mockUserDepartments = defaultMockUserDepartments;
  saveStorage('agent_erp_mock_user_departments', mockUserDepartments);
}

const defaultMockPartners = [
  { id: "part_mock_1", tenant_id: "tnt_mock_1", name: "A 公司 (Customer A)", is_customer: true, is_vendor: false, tax_id: null, created_at: Math.floor(Date.now() / 1000) - 86400 * 5 },
  { id: "part_mock_2", tenant_id: "tnt_mock_1", name: "台積電 (TSMC)", is_customer: true, is_vendor: false, tax_id: "22099131", created_at: Math.floor(Date.now() / 1000) - 86400 * 2 }
];

let mockPartners = loadStorage('agent_erp_mock_partners', defaultMockPartners);
if (!mockPartners || !Array.isArray(mockPartners)) {
  mockPartners = defaultMockPartners;
  saveStorage('agent_erp_mock_partners', mockPartners);
} else {
  let migrated = false;
  mockPartners.forEach(p => {
    if (!p.tenant_id) {
      p.tenant_id = 'tnt_mock_1';
      migrated = true;
    }
  });
  if (migrated) saveStorage('agent_erp_mock_partners', mockPartners);
}

const defaultMockProducts = [
  { id: "prod_mock_1", tenant_id: "tnt_mock_1", name: "智能核心晶片 (AI Core Chip)", category: "resale", is_sellable: true, is_purchasable: true, created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { id: "prod_mock_2", tenant_id: "tnt_mock_1", name: "AI 伺服器機櫃 (AI Server Rack)", category: "manufactured", is_sellable: true, is_purchasable: false, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
  { id: "prod_mock_3", tenant_id: "tnt_mock_1", name: "散熱鋁片 (Cooling Fin)", category: "raw_material", is_sellable: false, is_purchasable: true, created_at: Math.floor(Date.now() / 1000) - 86400 }
];

let mockProducts = loadStorage('agent_erp_mock_products', defaultMockProducts);
if (!mockProducts || !Array.isArray(mockProducts)) {
  mockProducts = defaultMockProducts;
  saveStorage('agent_erp_mock_products', mockProducts);
}

const defaultMockProductVariants = [
  { id: "var_mock_1", product_id: "prod_mock_1", sku: "CHIP-001", name: "標準", spec_attributes: {}, is_default: true, created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { id: "var_mock_2", product_id: "prod_mock_2", sku: "SRV-001", name: "標準", spec_attributes: {}, is_default: true, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
  { id: "var_mock_3", product_id: "prod_mock_3", sku: "FIN-001", name: "標準", spec_attributes: {}, is_default: true, created_at: Math.floor(Date.now() / 1000) - 86400 }
];

let mockProductVariants = loadStorage('agent_erp_mock_product_variants', defaultMockProductVariants);
if (!mockProductVariants || !Array.isArray(mockProductVariants)) {
  mockProductVariants = defaultMockProductVariants;
  saveStorage('agent_erp_mock_product_variants', mockProductVariants);
} else {
  mockProductVariants = mockProductVariants.map(v => ({
    ...v,
    spec_attributes: (v.spec_attributes && typeof v.spec_attributes === 'object' && !Array.isArray(v.spec_attributes)) ? v.spec_attributes : {}
  }));
}

const defaultMockProductUnits = [
  { id: "unit_mock_1", variant_id: "var_mock_1", unit_name: "顆", conversion_ratio: 1.0, is_base_unit: true, selling_price: 120.0, sell_price: 120.0, created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { id: "unit_mock_2", variant_id: "var_mock_2", unit_name: "台", conversion_ratio: 1.0, is_base_unit: true, selling_price: 150000.0, sell_price: 150000.0, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
  { id: "unit_mock_3", variant_id: "var_mock_3", unit_name: "片", conversion_ratio: 1.0, is_base_unit: true, selling_price: 15.0, sell_price: 15.0, created_at: Math.floor(Date.now() / 1000) - 86400 }
];

let mockProductUnits = loadStorage('agent_erp_mock_product_units', defaultMockProductUnits);
if (!mockProductUnits || !Array.isArray(mockProductUnits)) {
  mockProductUnits = defaultMockProductUnits;
  saveStorage('agent_erp_mock_product_units', mockProductUnits);
} else {
  mockProductUnits = mockProductUnits.map(u => ({
    ...u,
    sell_price: u.sell_price !== undefined ? u.sell_price : u.selling_price,
    selling_price: u.selling_price !== undefined ? u.selling_price : (u.sell_price !== undefined ? u.sell_price : 0.0)
  }));
}

let mockProductSupplySources = loadStorage('agent_erp_mock_product_supply_sources', []);
if (!mockProductSupplySources || !Array.isArray(mockProductSupplySources)) {
  mockProductSupplySources = [];
  saveStorage('agent_erp_mock_product_supply_sources', mockProductSupplySources);
}

let mockProductBomItems = loadStorage('agent_erp_mock_product_bom_items', []);
if (!mockProductBomItems || !Array.isArray(mockProductBomItems)) {
  mockProductBomItems = [];
  saveStorage('agent_erp_mock_product_bom_items', mockProductBomItems);
}

function resolveMockCategoryFlags(rawCategory) {
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

function checkMockBomCycle(parentProdId, childProdId) {
  if (parentProdId === childProdId) return true;
  const visited = new Set();
  const queue = [childProdId];
  visited.add(childProdId);

  while (queue.length > 0) {
    const currPid = queue.shift();
    const currVarIds = new Set(
      mockProductVariants.filter(v => v.product_id === currPid).map(v => v.id)
    );
    const childVarIds = mockProductBomItems
      .filter(b => currVarIds.has(b.parent_variant_id))
      .map(b => b.child_variant_id);

    for (const cVarId of childVarIds) {
      const cVar = mockProductVariants.find(v => v.id === cVarId);
      if (cVar?.product_id) {
        if (cVar.product_id === parentProdId) {
          return true;
        }
        if (!visited.has(cVar.product_id)) {
          visited.add(cVar.product_id);
          queue.push(cVar.product_id);
        }
      }
    }
  }

  return false;
}

let mockLlmProviders = [
  { id: "openai", label: "OpenAI GPT-4o", base_url: "https://api.openai.com/v1", model_name: "gpt-4o", requires_key: true, has_key: false, active: true },
  { id: "deepseek", label: "DeepSeek V3 (BYOK)", base_url: "https://api.deepseek.com/v1", model_name: "deepseek-chat", requires_key: true, has_key: false, active: false },
  { id: "gemini", label: "Gemini (BYOK, OpenAI 相容端點)", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model_name: "gemini-2.0-flash", requires_key: true, has_key: false, active: false },
  { id: "ollama", label: "Ollama Local", base_url: "http://localhost:11434/v1", model_name: "llama3.1", requires_key: false, has_key: false, active: false }
];

const listeners = {};

// Mock Channel implementation for streaming chat in browser
class MockChannel {
  constructor(onmessage) {
    this.onmessage = onmessage || null;
  }
}

export const Channel = MockChannel;

// 1. Invoke wrapper
export async function invoke(cmd, args = {}) {
  if (isTauri) {
    const { invoke: realInvoke } = await import('@tauri-apps/api/core');
    return await realInvoke(cmd, args);
  }

  // Browser Mock Implementation
  if (typeof window !== 'undefined') {
    await new Promise(resolve => setTimeout(resolve, 300)); // Simulating latency in browser UI
  }

  switch (cmd) {

    
    case 'list_llm_providers':
      return [...mockLlmProviders];
      
    case 'set_active_llm_provider': {
      const { id } = args;
      mockLlmProviders = mockLlmProviders.map(p => ({ ...p, active: p.id === id }));
      return null;
    }
    
    case 'set_llm_api_key': {
      const { id, key } = args;
      mockLlmProviders = mockLlmProviders.map(p => p.id === id ? { ...p, has_key: !!key } : p);
      return null;
    }
    
    case 'get_audit_logs':
      return [...mockAuditLogs];

    case 'simulate_agent_chat': {
      const { channel } = args;
      if (channel && typeof channel.onmessage === 'function') {
        const responseText = "智能助理已就緒。隨時可以為您服務，請告訴我您需要什麼協助。";

        const words = responseText.split(' ');
        let idx = 0;
        const interval = setInterval(() => {
          if (idx < words.length) {
            const isLast = idx === words.length - 1;
            channel.onmessage({ token: `${words[idx]} `, done: isLast });
            idx++;
            if (isLast) {
              clearInterval(interval);
            }
          } else {
            clearInterval(interval);
          }
        }, 40);
      }
      return null;
    }
    
    case 'agent_chat': {
      const { workspace, message, history, channel } = args;
      if (channel && typeof channel.onmessage === 'function') {
        const fullResponse = `[瀏覽器模擬助理] 已收到您在 ${workspace} 工作區發送的訊息：「${message}」。由於當前運行於瀏覽器沙盒，此對話僅為流程展示。若需完整功能（包含真實 AI 模型呼叫、數據庫工具執行），請切換至 Tauri 端並設定 API 金鑰。`;
        
        let i = 0;
        const interval = setInterval(() => {
          if (i < fullResponse.length) {
            channel.onmessage({ token: fullResponse.slice(i, i + 3), done: false });
            i += 3;
          } else {
            clearInterval(interval);
            channel.onmessage({ token: '', done: true });
          }
        }, 30);
      }
      return null;
    }
    
    case 'get_auth_status': {
      if (!mockSessions) {
        return {
          status: "unauthenticated",
          user: null,
          tenants: [],
          activeTenant: null
        };
      }
      const user = mockUsers.find(u => u.id === mockSessions.user_id);
      const userTnts = mockUserTenants.filter(ut => ut.user_id === mockSessions.user_id);
      const tenants = userTnts.map(ut => {
        const t = mockTenants.find(tnt => tnt.id === ut.tenant_id);
        return {
          id: t.id,
          code: t.code,
          name: t.name,
          role: ut.role
        };
      });
      const activeTenant = tenants.find(t => t.id === mockSessions.active_tenant_id) || null;
      let status = "unauthenticated";
      if (tenants.length === 0) {
        status = "needs_tenant_creation";
      } else if (!activeTenant) {
        status = "needs_tenant_selection";
      } else {
        status = "authenticated";
      }
      return {
        status,
        user: user ? { id: user.id, email: user.email, display_name: user.name || user.email } : null,
        tenants,
        activeTenant
      };
    }
    
    case 'api_call': {
      const { method, path, body } = args;
      if (method === 'POST' && path === '/v1/auth/login') {
        const { email, password } = body;
        const user = mockUsers.find(u => u.email === email);
        if (!user || user.password !== password) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "invalid credentials" };
        }
        const userTnts = mockUserTenants.filter(ut => ut.user_id === user.id);
        const tenants = userTnts.map(ut => {
          const t = mockTenants.find(tnt => tnt.id === ut.tenant_id);
          return {
            id: t.id,
            code: t.code,
            name: t.name,
            role: ut.role
          };
        });
        mockSessions = {
          token: `mock-token-${user.id}`,
          user_id: user.id,
          active_tenant_id: tenants.length === 1 ? tenants[0].id : null
        };
        saveStorage('agent_erp_mock_session', mockSessions);
        return {
          user_id: user.id,
          email: user.email,
          display_name: user.name || user.email,
          tenants
        };
      }
      if (method === 'POST' && path === '/v1/auth/register-tenant') {
        const { admin_name, tenant_name, company_name, admin_email, admin_password, tenant_code, tax_id } = body;
        if (!admin_name || !admin_name.trim()) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "admin_name cannot be empty" };
        }
        if (admin_password.length < 8) {
          throw { code: "IAM_ERR_WEAK_PASSWORD", message: "weak password" };
        }
        if (mockUsers.some(u => u.email === admin_email)) {
          throw { code: "IAM_ERR_EMAIL_TAKEN", message: "email already taken" };
        }
        const user_id = `usr_${Date.now()}`;
        const tenant_id = `tnt_${Date.now()}`;
        mockUsers.push({ id: user_id, email: admin_email, password: admin_password, name: admin_name.trim() });
        saveStorage('agent_erp_mock_users', mockUsers);

        mockTenants.push({ id: tenant_id, code: tenant_code, name: tenant_name, company_name, tax_id: tax_id || null });
        saveStorage('agent_erp_mock_tenants', mockTenants);

        mockUserTenants.push({ user_id, tenant_id, role: "admin" });
        saveStorage('agent_erp_mock_user_tenants', mockUserTenants);

        mockSessions = {
          token: `mock-token-${user_id}`,
          user_id,
          active_tenant_id: tenant_id
        };
        saveStorage('agent_erp_mock_session', mockSessions);

        // Seed initial default departments for newly registered mock tenant
        const initialDepts = createDefaultMockDepartments(tenant_id);
        mockDepartments.push(...initialDepts);
        saveStorage('agent_erp_mock_departments', mockDepartments);

        // Reset any stale mock tasks for clean onboarding experience
        mockTasks = [];
        saveStorage('agent_erp_mock_tasks', mockTasks);
        mockTaskMessages = [];
        saveStorage('agent_erp_mock_task_messages', mockTaskMessages);

        return {
          user: { id: user_id, email: admin_email, display_name: admin_name.trim() },
          tenants: [{ id: tenant_id, code: tenant_code, name: tenant_name, role: "admin" }]
        };
      }
      if (method === 'POST' && path === '/v1/auth/select-tenant') {
        const { tenant_id } = body;
        if (!mockSessions) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "auth: Session not found" };
        }
        const userTnts = mockUserTenants.filter(ut => ut.user_id === mockSessions.user_id);
        const isMember = userTnts.some(ut => ut.tenant_id === tenant_id);
        if (!isMember) {
          throw { code: "IAM_ERR_TENANT_NOT_ASSIGNED", message: "tenant not assigned" };
        }
        mockSessions.active_tenant_id = tenant_id;

        // Generate new mock scoped token
        const new_token = `mock-scoped-token-${mockSessions.user_id}`;
        mockSessions.token = new_token;
        saveStorage('agent_erp_mock_session', mockSessions);

        return {
          access_token: new_token,
          refresh_token: `mock-refresh-${mockSessions.user_id}`,
          status: "authenticated"
        };
      }
      if (method === 'POST' && path === '/v1/auth/create-tenant') {
        const { tenant_name, company_name, tenant_code, tax_id } = body;
        if (!mockSessions) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "auth: Session not found" };
        }
        if (mockTenants.some(t => t.code === tenant_code)) {
          throw { code: "IAM_ERR_TENANT_CODE_TAKEN", message: "tenant code taken" };
        }
        const tenant_id = `tnt_${Date.now()}`;
        mockTenants.push({ id: tenant_id, code: tenant_code, name: tenant_name, company_name, tax_id });
        saveStorage('agent_erp_mock_tenants', mockTenants);

        mockUserTenants.push({ user_id: mockSessions.user_id, tenant_id, role: "admin" });
        saveStorage('agent_erp_mock_user_tenants', mockUserTenants);

        mockSessions.active_tenant_id = tenant_id;

        // Generate new mock scoped token
        const new_token = `mock-scoped-token-${mockSessions.user_id}`;
        mockSessions.token = new_token;

        // Seed initial default departments for newly created mock tenant
        const initialDepts = createDefaultMockDepartments(tenant_id);
        mockDepartments.push(...initialDepts);
        saveStorage('agent_erp_mock_departments', mockDepartments);

        // Reset any stale mock tasks for clean onboarding experience
        mockTasks = [];
        saveStorage('agent_erp_mock_tasks', mockTasks);
        mockTaskMessages = [];
        saveStorage('agent_erp_mock_task_messages', mockTaskMessages);

        const user = mockUsers.find(u => u.id === mockSessions.user_id);
        return {
          access_token: new_token,
          refresh_token: `mock-refresh-${mockSessions.user_id}`,
          user_id: mockSessions.user_id,
          email: user?.email || '',
          tenant_id,
          company_id: `cmp_${Date.now()}`
        };
      }
      if (method === 'POST' && path === '/v1/auth/logout') {
        mockSessions = null;
        saveStorage('agent_erp_mock_session', null);
        return {};
      }
      if ((method === 'GET' && path === '/v1/tenant-admin/members') || (method === 'POST' && path === '/v1/tenant-admin/members/list')) {
        if (!mockSessions || !mockSessions.active_tenant_id) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "auth: Session not found" };
        }
        const userTnts = mockUserTenants.filter(ut => ut.tenant_id === mockSessions.active_tenant_id);
        const members = userTnts.map(ut => {
          const u = mockUsers.find(user => user.id === ut.user_id);
          const userDeptLinks = mockUserDepartments.filter(ud => ud.user_id === ut.user_id && ud.tenant_id === mockSessions.active_tenant_id);
          const department_ids = userDeptLinks.map(ud => ud.department_id);
          const departments = department_ids.map(did => mockDepartments.find(d => d.id === did)).filter(Boolean);
          return {
            id: ut.user_id,
            user_id: ut.user_id,
            email: u ? u.email : 'unknown@example.com',
            name: u ? (u.name || u.email) : 'Unknown Member',
            role: ut.role,
            department_ids,
            departments
          };
        });
        return { members };
      }
      if (method === 'POST' && (path === '/v1/tenant-admin/members/onboard' || path === '/v1/tenant-admin/employees/onboard')) {
        if (!mockSessions || !mockSessions.active_tenant_id) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "auth: Session not found" };
        }
        const { email, name, role, department_ids } = body;
        const trimmedEmail = (email || '').trim();
        const trimmedName = (name || '').trim();
        const trimmedRole = (role || 'member').trim().toLowerCase();
        if (!trimmedEmail || !trimmedName) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "email and name cannot be empty" };
        }
        if (!['owner', 'admin', 'member'].includes(trimmedRole)) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "invalid role: must be owner, admin, or member" };
        }
        const existingUser = mockUsers.find(u => u.email.toLowerCase() === trimmedEmail.toLowerCase());
        if (existingUser && mockUserTenants.some(ut => ut.tenant_id === mockSessions.active_tenant_id && ut.user_id === existingUser.id)) {
          throw { code: "IAM_ERR_ALREADY_EXISTS", message: "member already exists in this tenant" };
        }
        let userId;
        if (existingUser) {
          userId = existingUser.id;
        } else {
          userId = `usr_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
          mockUsers.push({ id: userId, email: trimmedEmail, password: 'password123', name: trimmedName });
          saveStorage('agent_erp_mock_users', mockUsers);
        }
        mockUserTenants.push({ user_id: userId, tenant_id: mockSessions.active_tenant_id, role: trimmedRole });
        saveStorage('agent_erp_mock_user_tenants', mockUserTenants);

        const rawDeptIds = Array.isArray(department_ids) ? department_ids : [];
        const uniqueDeptIds = [...new Set(rawDeptIds.map(d => String(d).trim()).filter(Boolean))];
        for (const deptId of uniqueDeptIds) {
          if (!mockUserDepartments.some(ud => ud.user_id === userId && ud.tenant_id === mockSessions.active_tenant_id && ud.department_id === deptId)) {
            mockUserDepartments.push({ user_id: userId, tenant_id: mockSessions.active_tenant_id, department_id: deptId });
          }
        }
        saveStorage('agent_erp_mock_user_departments', mockUserDepartments);
        const assignedDepartments = uniqueDeptIds.map(did => mockDepartments.find(d => d.id === did)).filter(Boolean);

        return {
          id: userId,
          user_id: userId,
          email: trimmedEmail,
          name: trimmedName,
          role: trimmedRole,
          department_ids: uniqueDeptIds,
          departments: assignedDepartments
        };
      }
      if (method === 'POST' && (path === '/v1/tenant-admin/members/assign-role' || path === '/v1/tenant-admin/employees/assign-role')) {
        if (!mockSessions || !mockSessions.active_tenant_id) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "auth: Session not found" };
        }
        const targetUserId = (body.user_id || body.member_id || '').trim();
        const targetRole = (body.role || body.role_name || '').trim().toLowerCase();
        if (!targetUserId || !targetRole) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "missing user_id or role" };
        }
        if (!['owner', 'admin', 'member'].includes(targetRole)) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "invalid role: must be owner, admin, or member" };
        }
        const utIndex = mockUserTenants.findIndex(ut => ut.tenant_id === mockSessions.active_tenant_id && ut.user_id === targetUserId);
        if (utIndex === -1) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "member not found in this tenant" };
        }
        mockUserTenants[utIndex].role = targetRole;
        saveStorage('agent_erp_mock_user_tenants', mockUserTenants);
        return { user_id: targetUserId, role: targetRole, success: true };
      }
      if (method === 'POST' && (path === '/v1/tenant-admin/members/assign-departments' || path === '/v1/tenant-admin/employees/assign-departments')) {
        if (!mockSessions || !mockSessions.active_tenant_id) {
          throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "auth: Session not found" };
        }
        const targetUserId = (body.user_id || body.member_id || '').trim();
        if (!targetUserId) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "missing user_id" };
        }
        const isMember = mockUserTenants.some(ut => ut.tenant_id === mockSessions.active_tenant_id && ut.user_id === targetUserId);
        if (!isMember) {
          throw { code: "IAM_ERR_INVALID_ARGUMENT", message: "member not found in this tenant" };
        }
        const rawDeptIds = Array.isArray(body.department_ids) ? body.department_ids : [];
        const uniqueDeptIds = [...new Set(rawDeptIds.map(d => String(d).trim()).filter(Boolean))];

        mockUserDepartments = mockUserDepartments.filter(ud => !(ud.tenant_id === mockSessions.active_tenant_id && ud.user_id === targetUserId));
        for (const deptId of uniqueDeptIds) {
          mockUserDepartments.push({ user_id: targetUserId, tenant_id: mockSessions.active_tenant_id, department_id: deptId });
        }
        saveStorage('agent_erp_mock_user_departments', mockUserDepartments);
        const assignedDepartments = uniqueDeptIds.map(did => mockDepartments.find(d => d.id === did)).filter(Boolean);

        return {
          user_id: targetUserId,
          department_ids: uniqueDeptIds,
          departments: assignedDepartments,
          success: true
        };
      }
      if (method === 'POST' && path === '/v1/test/expire') {
        throw { code: "IAM_ERR_INVALID_CREDENTIALS", message: "invalid credentials" };
      }
      throw { code: "UNKNOWN_ERROR", message: `Mock API endpoint not found: ${method} ${path}` };
    }
    
    case 'logout': {
      mockSessions = null;
      saveStorage('agent_erp_mock_session', null);
      return null;
    }

    case 'create_task': {
      const { title, moduleId, assignee, parentTaskId, skillId, module_id, parent_task_id, skill_id, skills } = args;
      const targetTenantId = resolveMockActiveTenantId();
      const now = Math.floor(Date.now() / 1000);
      const finalModuleId = (moduleId || module_id || '').trim();
      const finalParentTaskId = parentTaskId || parent_task_id || null;
      const rawSkillId = skillId || skill_id || null;
      const finalSkillId = rawSkillId ? String(rawSkillId).trim() || null : null;
      const rawSkills = skills || (Array.isArray(skillId) ? skillId : null);
      const finalSkills = Array.isArray(rawSkills)
        ? rawSkills.map(s => String(s).trim()).filter(Boolean)
        : (finalSkillId ? [finalSkillId] : []);
      const newTask = {
        id: `task_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
        tenant_id: targetTenantId,
        title: (title || '').trim(),
        status: 'pending',
        parent_task_id: finalParentTaskId,
        module_id: finalModuleId,
        assignee: (assignee || '').trim(),
        skill_id: finalSkillId,
        skillId: finalSkillId,
        skills: finalSkills,
        created_at: now,
        completed_at: null
      };
      mockTasks.push(newTask);
      saveStorage('agent_erp_mock_tasks', mockTasks);
      return newTask;
    }

    case 'list_tasks': {
      const { moduleId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const trimmedModule = (moduleId || '').trim();
      let list = mockTasks.filter(t => (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (trimmedModule) {
        list = list.filter(t => t.module_id === trimmedModule);
      }
      return list;
    }

    case 'update_task_status': {
      const { taskId, status } = args;
      const targetTenantId = resolveMockActiveTenantId();
      const validStatuses = ['pending', 'in_progress', 'done', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid task status: ${status}`);
      }
      const task = mockTasks.find(t => t.id === taskId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      task.status = status;
      task.completed_at = status === 'done' ? Math.floor(Date.now() / 1000) : null;
      saveStorage('agent_erp_mock_tasks', mockTasks);
      return null;
    }

    case 'append_task_message': {
      const { taskId, role, content } = args;
      if (!taskId) throw new Error('Task ID cannot be empty');
      if (!content) throw new Error('Message content cannot be empty');
      const now = Math.floor(Date.now() / 1000);
      const newMsg = {
        id: `msg_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
        task_id: taskId.trim(),
        role: (role || 'user').trim(),
        content: content.trim(),
        timestamp: now
      };
      mockTaskMessages.push(newMsg);
      saveStorage('agent_erp_mock_task_messages', mockTaskMessages);
      return null;
    }

    case 'get_task_messages': {
      const { taskId } = args;
      const filtered = mockTaskMessages
        .filter(m => m.task_id === (taskId || '').trim())
        .sort((a, b) => a.timestamp - b.timestamp);
      return filtered;
    }

    case 'create_department': {
      const { name, parentId, parent_id } = args;
      const targetTenantId = resolveMockActiveTenantId();
      const targetParentId = parentId !== undefined ? parentId : parent_id;
      const trimmedName = (name || '').trim();
      if (!trimmedName) {
        throw new Error('Department name cannot be empty');
      }
      if (mockDepartments.some(d => (d.tenant_id || 'tnt_mock_1') === targetTenantId && d.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
        throw new Error(`部門「${trimmedName}」已存在，請使用不同名稱`);
      }
      const now = Math.floor(Date.now() / 1000);
      const normalizedParentId = targetParentId && typeof targetParentId === 'string' && targetParentId.trim() ? targetParentId.trim() : null;
      const newDept = {
        id: `dept_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
        tenant_id: targetTenantId,
        name: trimmedName,
        parent_id: normalizedParentId,
        skills: [],
        created_at: now
      };
      mockDepartments.push(newDept);
      saveStorage('agent_erp_mock_departments', mockDepartments);
      return newDept;
    }

    case 'list_departments': {
      const targetTenantId = resolveMockActiveTenantId();
      return mockDepartments.filter(d => (d.tenant_id || 'tnt_mock_1') === targetTenantId);
    }

    case 'update_department_skills': {
      const { department_id, departmentId, skills } = args;
      const targetTenantId = resolveMockActiveTenantId();
      const targetId = (department_id || departmentId || '').trim();
      if (!targetId) {
        throw new Error('Department ID cannot be empty');
      }
      const dept = mockDepartments.find(d => d.id === targetId && (d.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!dept) {
        throw new Error(`Department not found: ${targetId}`);
      }
      const rawSkills = Array.isArray(skills) ? skills : [];
      const cleanSkills = [...new Set(rawSkills.map(s => String(s).trim()).filter(Boolean))].sort();
      dept.skills = cleanSkills;
      saveStorage('agent_erp_mock_departments', mockDepartments);
      return { ...dept };
    }

    case 'detect_department_intent': {
      return { attempted: false, tool_call: null };
    }

    case 'create_partner': {
      const { name, is_customer, isCustomer, is_vendor, isVendor, tax_id, taxId } = args;
      const targetTenantId = resolveMockActiveTenantId();
      const trimmedName = (name || '').trim();
      if (!trimmedName) {
        throw new Error('Partner name cannot be empty');
      }
      const rawTaxId = tax_id !== undefined ? tax_id : taxId;
      let normalizedTaxId = null;
      if (rawTaxId !== undefined && rawTaxId !== null) {
        const s = String(rawTaxId).trim();
        if (s.length > 0) {
          if (!/^\d{8}$/.test(s)) {
            throw new Error('統一編號必須為 8 碼半形數字');
          }
          normalizedTaxId = s;
        }
      }
      const vendFlag = is_vendor !== undefined ? is_vendor : (isVendor !== undefined ? isVendor : false);
      const custFlag = is_customer !== undefined ? is_customer : (isCustomer !== undefined ? isCustomer : !vendFlag);

      const existingIndex = mockPartners.findIndex(p =>
        (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
        p.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (existingIndex >= 0) {
        const existing = mockPartners[existingIndex];
        const needAddVendor = !!vendFlag && !existing.is_vendor;
        const needAddCustomer = !!custFlag && !existing.is_customer;

        if (needAddVendor || needAddCustomer) {
          if (normalizedTaxId) {
            const taxDup = mockPartners.find(p =>
              (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
              p.id !== existing.id &&
              p.tax_id === normalizedTaxId
            );
            if (taxDup) {
              throw new Error(`統一編號「${normalizedTaxId}」已由其他合作夥伴登記`);
            }
          }
          existing.is_customer = existing.is_customer || !!custFlag;
          existing.is_vendor = existing.is_vendor || !!vendFlag;
          if (normalizedTaxId) {
            existing.tax_id = normalizedTaxId;
          }
          saveStorage('agent_erp_mock_partners', mockPartners);
          return { ...existing };
        }

        const roleLabel = (vendFlag && !custFlag) ? '供應商' : '客戶';
        throw new Error(`合作夥伴／${roleLabel}「${trimmedName}」已存在，請使用不同名稱`);
      }

      if (normalizedTaxId) {
        const taxDup = mockPartners.find(p =>
          (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
          p.tax_id === normalizedTaxId
        );
        if (taxDup) {
          throw new Error(`統一編號「${normalizedTaxId}」已由其他合作夥伴登記`);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const newPartner = {
        id: `part_${now}_${Math.floor(1000 + Math.random() * 9000)}`,
        tenant_id: targetTenantId,
        name: trimmedName,
        is_customer: !!custFlag,
        is_vendor: !!vendFlag,
        tax_id: normalizedTaxId,
        created_at: now
      };
      mockPartners.push(newPartner);
      saveStorage('agent_erp_mock_partners', mockPartners);
      return newPartner;
    }

    case 'update_partner': {
      const { id, name, tax_id, taxId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const trimmedId = (id || '').trim();
      if (!trimmedId) {
        throw new Error('Partner ID cannot be empty');
      }

      const targetIndex = mockPartners.findIndex(p =>
        p.id === trimmedId && (p.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (targetIndex < 0) {
        throw new Error('Partner not found');
      }
      const partner = mockPartners[targetIndex];

      if (name !== undefined) {
        const trimmedName = String(name).trim();
        if (!trimmedName) {
          throw new Error('合作夥伴名稱不能為空');
        }
        const nameDup = mockPartners.find(p =>
          (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
          p.id !== partner.id &&
          p.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        if (nameDup) {
          throw new Error(`合作夥伴名稱「${trimmedName}」已存在，請使用不同名稱`);
        }
        partner.name = trimmedName;
      }

      const rawTaxId = tax_id !== undefined ? tax_id : taxId;
      if (rawTaxId !== undefined) {
        if (rawTaxId === null) {
          partner.tax_id = null;
        } else {
          const s = String(rawTaxId).trim();
          if (s.length === 0) {
            partner.tax_id = null;
          } else {
            if (!/^\d{8}$/.test(s)) {
              throw new Error('統一編號必須為 8 碼半形數字');
            }
            const taxDup = mockPartners.find(p =>
              (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
              p.id !== partner.id &&
              p.tax_id === s
            );
            if (taxDup) {
              throw new Error(`統一編號「${s}」已由其他合作夥伴登記`);
            }
            partner.tax_id = s;
          }
        }
      }

      saveStorage('agent_erp_mock_partners', mockPartners);
      return { ...partner };
    }

    case 'list_partners': {
      const { filter_customer, filterCustomer, filter_vendor, filterVendor } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const isCustFilter = filter_customer !== undefined ? filter_customer : filterCustomer;
      const isVendFilter = filter_vendor !== undefined ? filter_vendor : filterVendor;
      let list = mockPartners.filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (isCustFilter === true) {
        list = list.filter(p => p.is_customer);
      }
      if (isVendFilter === true) {
        list = list.filter(p => p.is_vendor);
      }
      return list;
    }

    case 'create_product': {
      const { name, category, sku, unit_name, unitName, selling_price, sellingPrice } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const trimmedName = (name || '').trim();
      if (!trimmedName) {
        throw new Error('商品名稱不能為空');
      }

      const { category: stdCategory, is_sellable, is_purchasable } = resolveMockCategoryFlags(category);

      const rawPrice = selling_price !== undefined ? selling_price : sellingPrice;
      const price = rawPrice !== undefined && rawPrice !== null ? Number(rawPrice) : 0.0;
      if (price < 0.0) {
        throw new Error('售價不能為負數');
      }

      const existing = mockProducts.find(p =>
        (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
        p.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (existing) {
        throw new Error(`商品「${trimmedName}」已存在，請使用不同名稱`);
      }

      const now = Math.floor(Date.now() / 1000);
      const prodId = nextMockUid('prod');
      const newProduct = {
        id: prodId,
        tenant_id: targetTenantId,
        name: trimmedName,
        category: stdCategory,
        is_sellable,
        is_purchasable,
        created_at: now
      };
      mockProducts.push(newProduct);
      saveStorage('agent_erp_mock_products', mockProducts);

      // Auto-create default variant
      const varId = nextMockUid('var');
      const trimmedSku = sku && String(sku).trim() ? String(sku).trim() : null;
      const defaultVariant = {
        id: varId,
        product_id: prodId,
        sku: trimmedSku,
        name: '標準',
        spec_attributes: {},
        is_default: true,
        created_at: now
      };
      mockProductVariants.push(defaultVariant);
      saveStorage('agent_erp_mock_product_variants', mockProductVariants);

      // Auto-create base unit
      const cleanUnitName = (unit_name || unitName || '').trim() || '個';
      const unitId = nextMockUid('unit');
      const baseUnit = {
        id: unitId,
        variant_id: varId,
        unit_name: cleanUnitName,
        conversion_ratio: 1.0,
        is_base_unit: true,
        selling_price: price,
        sell_price: price,
        created_at: now
      };
      mockProductUnits.push(baseUnit);
      saveStorage('agent_erp_mock_product_units', mockProductUnits);

      return {
        product: newProduct,
        variants: [defaultVariant],
        units: [baseUnit],
        supply_sources: [],
        bom_items: []
      };
    }

    case 'list_product':
    case 'list_products': {
      const { filter_category, filterCategory, filter_sellable, filterSellable, filter_purchasable, filterPurchasable } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      let list = mockProducts.filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);

      const catFilter = filter_category || filterCategory;
      if (catFilter && String(catFilter).trim()) {
        const catNorm = String(catFilter).trim().toLowerCase();
        list = list.filter(p => p.category.toLowerCase() === catNorm);
      }

      const sellFilter = filter_sellable !== undefined ? filter_sellable : filterSellable;
      if (sellFilter !== undefined) {
        list = list.filter(p => p.is_sellable === !!sellFilter);
      }

      const purchFilter = filter_purchasable !== undefined ? filter_purchasable : filterPurchasable;
      if (purchFilter !== undefined) {
        list = list.filter(p => p.is_purchasable === !!purchFilter);
      }

      return list.sort((a, b) => a.created_at - b.created_at);
    }

    case 'get_product_detail': {
      const { product_id, productId, id } = args || {};
      const targetId = product_id || productId || id;
      const targetTenantId = resolveMockActiveTenantId();

      const product = mockProducts.find(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.id === targetId);
      if (!product) {
        throw new Error('Product not found');
      }

      const variants = mockProductVariants.filter(v => v.product_id === product.id);
      const variantIds = new Set(variants.map(v => v.id));

      const units = mockProductUnits.filter(u => variantIds.has(u.variant_id));
      const unitIds = new Set(units.map(u => u.id));
      const supply_sources = mockProductSupplySources
        .filter(s => unitIds.has(s.unit_id))
        .map(s => ({
          ...s,
          cost: s.cost !== undefined ? s.cost : s.purchase_cost
        }));
      const bom_items = mockProductBomItems
        .filter(b => b.product_id === product.id || variantIds.has(b.parent_variant_id))
        .map(b => {
          const childVar = mockProductVariants.find(v => v.id === (b.child_variant_id || b.material_variant_id));
          const childProd = childVar ? mockProducts.find(p => p.id === childVar.product_id) : null;
          return {
            ...b,
            product_id: b.product_id || product.id,
            material_variant_id: b.material_variant_id || b.child_variant_id,
            child_product_name: b.child_product_name || (childProd ? childProd.name : null),
            child_variant_name: b.child_variant_name || (childVar ? childVar.name : null),
            child_sku: b.child_sku || (childVar ? childVar.sku : null)
          };
        });

      return {
        product,
        variants,
        units,
        supply_sources,
        bom_items
      };
    }

    case 'add_product_variant': {
      const { product_id, productId, name, sku, spec_attributes, specAttributes } = args || {};
      const targetProdId = product_id || productId;
      const targetTenantId = resolveMockActiveTenantId();
      let trimmedName = (name || '').trim();

      const product = mockProducts.find(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.id === targetProdId);
      if (!product) {
        throw new Error('Product not found');
      }

      let cleanSpec = spec_attributes !== undefined ? spec_attributes : specAttributes;
      if (cleanSpec === undefined || cleanSpec === null) {
        cleanSpec = {};
      } else if (typeof cleanSpec === 'string') {
        try {
          cleanSpec = JSON.parse(cleanSpec);
        } catch (_) {
          throw new Error('規格屬性必須為 JSON 物件格式');
        }
      }
      if (typeof cleanSpec !== 'object' || Array.isArray(cleanSpec) || cleanSpec === null) {
        throw new Error('規格屬性必須為 JSON 物件格式');
      }

      if (!trimmedName) {
        const values = Object.values(cleanSpec).filter(v => v !== undefined && v !== null && String(v).trim());
        if (values.length > 0) {
          trimmedName = values.map(v => String(v).trim()).join(' / ');
        } else {
          throw new Error('變體名稱不能為空');
        }
      }

      const exists = mockProductVariants.some(v => v.product_id === product.id && v.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (exists) {
        throw new Error(`變體「${trimmedName}」已存在`);
      }

      const now = Math.floor(Date.now() / 1000);
      const newVariant = {
        id: nextMockUid('var'),
        product_id: product.id,
        sku: sku && String(sku).trim() ? String(sku).trim() : null,
        name: trimmedName,
        spec_attributes: cleanSpec,
        is_default: false,
        created_at: now
      };
      mockProductVariants.push(newVariant);
      saveStorage('agent_erp_mock_product_variants', mockProductVariants);

      // Auto-create base unit for new variant (satisfying "每個變體至少要有一個基礎單位")
      const defaultVar = mockProductVariants.find(v => v.product_id === product.id && v.is_default);
      const defaultUnit = defaultVar ? mockProductUnits.find(u => u.variant_id === defaultVar.id && u.is_base_unit) : null;
      const baseUnitName = defaultUnit ? defaultUnit.unit_name : '個';
      const baseUnitPrice = defaultUnit ? (defaultUnit.selling_price || defaultUnit.sell_price || 0.0) : 0.0;

      const newBaseUnit = {
        id: nextMockUid('unit'),
        variant_id: newVariant.id,
        unit_name: baseUnitName,
        conversion_ratio: 1.0,
        is_base_unit: true,
        selling_price: baseUnitPrice,
        sell_price: baseUnitPrice,
        created_at: now
      };
      mockProductUnits.push(newBaseUnit);
      saveStorage('agent_erp_mock_product_units', mockProductUnits);

      return newVariant;
    }

    case 'update_product_variant': {
      const { variant_id, variantId, id, name, sku, spec_attributes, specAttributes } = args || {};
      const targetVarId = variant_id || variantId || id;
      const targetTenantId = resolveMockActiveTenantId();

      if (!targetVarId) {
        throw new Error('Variant not found');
      }

      const variantIndex = mockProductVariants.findIndex(v => v.id === targetVarId);
      if (variantIndex === -1) {
        throw new Error('Variant not found');
      }
      const variant = mockProductVariants[variantIndex];

      // Verify product belongs to active tenant
      const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!product) {
        throw new Error('Variant not found');
      }

      let newName = variant.name;
      if (name !== undefined) {
        const tr = String(name).trim();
        if (!tr) {
          throw new Error('變體名稱不能為空');
        }
        newName = tr;
      }

      // Check duplicate name within the same product (excluding self)
      const duplicate = mockProductVariants.some(v => v.product_id === variant.product_id && v.id !== variant.id && v.name.trim().toLowerCase() === newName.toLowerCase());
      if (duplicate) {
        throw new Error(`變體名稱「${newName}」已存在`);
      }

      let newSku = variant.sku;
      if (sku !== undefined) {
        const trSku = sku && String(sku).trim() ? String(sku).trim() : null;
        newSku = trSku;
      }

      let newSpec = variant.spec_attributes || {};
      const inputSpec = spec_attributes !== undefined ? spec_attributes : specAttributes;
      if (inputSpec !== undefined) {
        let parsedSpec = inputSpec;
        if (typeof parsedSpec === 'string') {
          try {
            parsedSpec = JSON.parse(parsedSpec);
          } catch (_) {
            throw new Error('規格屬性必須為 JSON 物件格式');
          }
        }
        if (typeof parsedSpec !== 'object' || Array.isArray(parsedSpec) || parsedSpec === null) {
          throw new Error('規格屬性必須為 JSON 物件格式');
        }
        newSpec = parsedSpec;
      }

      const updatedVariant = {
        ...variant,
        name: newName,
        sku: newSku,
        spec_attributes: newSpec
      };

      mockProductVariants[variantIndex] = updatedVariant;
      saveStorage('agent_erp_mock_product_variants', mockProductVariants);
      return updatedVariant;
    }

    case 'add_product_unit': {
      const { variant_id, variantId, unit_name, unitName, conversion_ratio, conversionRatio, is_base_unit, isBaseUnit, selling_price, sellingPrice, sell_price, sellPrice } = args || {};
      const targetVarId = variant_id || variantId;
      const targetTenantId = resolveMockActiveTenantId();
      const trimmedUnit = (unit_name || unitName || '').trim();

      let variant = mockProductVariants.find(v => v.id === targetVarId);
      if (!variant) {
        variant = mockProductVariants.find(v => v.product_id === targetVarId && v.is_default);
      }
      if (!variant) {
        throw new Error('Product variant not found');
      }
      const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!product) {
        throw new Error('Product variant not found');
      }

      if (!trimmedUnit) {
        throw new Error('單位名稱不能為空');
      }

      // Duplicate unit_name check in same variant
      const exists = mockProductUnits.some(u => u.variant_id === variant.id && u.unit_name.trim().toLowerCase() === trimmedUnit.toLowerCase());
      if (exists) {
        throw new Error(`單位「${trimmedUnit}」已存在`);
      }

      const isBase = is_base_unit !== undefined ? !!is_base_unit : !!isBaseUnit;
      const rawRatio = conversion_ratio !== undefined ? conversion_ratio : conversionRatio;
      const ratio = isBase ? 1.0 : Number(rawRatio);
      if (isNaN(ratio) || ratio <= 0) {
        throw new Error('換算比例必須大於 0');
      }

      const rawPrice = selling_price !== undefined ? selling_price : (sellingPrice !== undefined ? sellingPrice : (sell_price !== undefined ? sell_price : sellPrice));
      const price = rawPrice !== undefined ? Number(rawPrice) : 0.0;
      if (isNaN(price) || price < 0) {
        throw new Error('售價不能為負數');
      }

      if (isBase) {
        mockProductUnits.forEach(u => {
          if (u.variant_id === variant.id) {
            u.is_base_unit = false;
          }
        });
      }

      const now = Math.floor(Date.now() / 1000);
      const newUnit = {
        id: nextMockUid('unit'),
        variant_id: variant.id,
        unit_name: trimmedUnit,
        conversion_ratio: ratio,
        is_base_unit: isBase,
        selling_price: price,
        sell_price: price,
        created_at: now
      };
      mockProductUnits.push(newUnit);
      saveStorage('agent_erp_mock_product_units', mockProductUnits);
      return newUnit;
    }

    case 'update_product_unit': {
      const { unit_id, unitId, id, unit_name, unitName, conversion_ratio, conversionRatio, is_base_unit, isBaseUnit, selling_price, sellingPrice, sell_price, sellPrice } = args || {};
      const targetUnitId = unit_id || unitId || id;
      const targetTenantId = resolveMockActiveTenantId();

      if (!targetUnitId) {
        throw new Error('Product unit not found');
      }

      const unit = mockProductUnits.find(u => u.id === targetUnitId);
      if (!unit) {
        throw new Error('Product unit not found');
      }

      const variant = mockProductVariants.find(v => v.id === unit.variant_id);
      if (!variant) {
        throw new Error('Product unit not found');
      }

      const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!product) {
        throw new Error('Product unit not found');
      }

      // 1. Name validation & duplicate check
      const rawName = unit_name !== undefined ? unit_name : unitName;
      let effectiveName = unit.unit_name;
      if (rawName !== undefined) {
        const trimmed = String(rawName).trim();
        if (!trimmed) {
          throw new Error('單位名稱不能為空');
        }
        const duplicate = mockProductUnits.some(u => u.variant_id === variant.id && u.id !== unit.id && u.unit_name.trim().toLowerCase() === trimmed.toLowerCase());
        if (duplicate) {
          throw new Error(`單位「${trimmed}」已存在`);
        }
        effectiveName = trimmed;
      }

      // 2. Base unit and ratio
      const rawIsBase = is_base_unit !== undefined ? is_base_unit : isBaseUnit;
      const targetIsBase = rawIsBase !== undefined ? !!rawIsBase : unit.is_base_unit;

      if (unit.is_base_unit && !targetIsBase) {
        const otherBase = mockProductUnits.some(u => u.variant_id === variant.id && u.id !== unit.id && u.is_base_unit);
        if (!otherBase) {
          throw new Error('每個變體至少要有一個基準單位');
        }
      }

      const rawRatio = conversion_ratio !== undefined ? conversion_ratio : conversionRatio;
      let effectiveRatio = unit.conversion_ratio;
      if (targetIsBase) {
        if (rawRatio !== undefined && Number(rawRatio) !== 1.0) {
          throw new Error('基準單位換算比例必須為 1');
        }
        effectiveRatio = 1.0;
      } else if (rawRatio !== undefined) {
        const r = Number(rawRatio);
        if (isNaN(r) || r <= 0) {
          throw new Error('換算比例必須大於 0');
        }
        effectiveRatio = r;
      }

      // 3. Selling price
      const rawPrice = selling_price !== undefined ? selling_price : (sellingPrice !== undefined ? sellingPrice : (sell_price !== undefined ? sell_price : sellPrice));
      let effectivePrice = unit.selling_price;
      if (rawPrice !== undefined) {
        const p = Number(rawPrice);
        if (isNaN(p) || p < 0) {
          throw new Error('售價不能為負數');
        }
        effectivePrice = p;
      }

      // If switched to base unit, unset others
      if (targetIsBase && !unit.is_base_unit) {
        mockProductUnits.forEach(u => {
          if (u.variant_id === variant.id && u.id !== unit.id) {
            u.is_base_unit = false;
          }
        });
      }

      unit.unit_name = effectiveName;
      unit.conversion_ratio = effectiveRatio;
      unit.is_base_unit = targetIsBase;
      unit.selling_price = effectivePrice;
      unit.sell_price = effectivePrice;

      saveStorage('agent_erp_mock_product_units', mockProductUnits);
      return { ...unit };
    }

    case 'add_supply_source': {
      const { unit_id, unitId, variant_id, variantId, vendor_partner_id, vendorPartnerId, purchase_cost, purchaseCost, currency, is_primary, isPrimary } = args || {};
      const targetId = unit_id || unitId || variant_id || variantId;
      const targetVendorId = vendor_partner_id || vendorPartnerId;
      const targetTenantId = resolveMockActiveTenantId();

      // Resilient ID resolution: unit_id -> variant_id (base unit) -> product_id (default variant base unit)
      let unit = mockProductUnits.find(u => u.id === targetId);
      if (!unit) {
        // Fallback: targetId was a variant_id
        unit = mockProductUnits.find(u => u.variant_id === targetId && u.is_base_unit) ||
               mockProductUnits.find(u => u.variant_id === targetId);
      }
      if (!unit) {
        // Fallback: targetId was a product_id
        const fallbackVar = mockProductVariants.find(v => v.product_id === targetId && v.is_default) ||
                            mockProductVariants.find(v => v.product_id === targetId);
        if (fallbackVar) {
          unit = mockProductUnits.find(u => u.variant_id === fallbackVar.id && u.is_base_unit) ||
                 mockProductUnits.find(u => u.variant_id === fallbackVar.id);
        }
      }
      if (!unit) {
        throw new Error('Product unit not found');
      }

      const variant = mockProductVariants.find(v => v.id === unit.variant_id);
      if (!variant) {
        throw new Error('Product unit not found');
      }
      const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!product) {
        throw new Error('Product unit not found');
      }

      const vendor = mockPartners.find(p => p.id === targetVendorId && (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.is_vendor === true);
      if (!vendor) {
        throw new Error('供應商不存在或無效');
      }

      const rawCost = purchase_cost !== undefined ? purchase_cost : (purchaseCost !== undefined ? purchaseCost : args?.cost);
      const cost = Number(rawCost);
      if (isNaN(cost) || cost < 0) {
        throw new Error('採購成本不能為負數');
      }

      const targetIsPrimary = is_primary !== undefined ? !!is_primary : !!isPrimary;
      if (targetIsPrimary) {
        mockProductSupplySources.forEach(s => {
          if (s.unit_id === unit.id) {
            s.is_primary = false;
          }
        });
      }

      const now = Math.floor(Date.now() / 1000);
      const newSource = {
        id: nextMockUid('src'),
        unit_id: unit.id,
        vendor_partner_id: vendor.id,
        purchase_cost: cost,
        cost: cost,
        currency: (currency || 'TWD').trim(),
        is_primary: targetIsPrimary,
        created_at: now
      };
      mockProductSupplySources.push(newSource);
      saveStorage('agent_erp_mock_product_supply_sources', mockProductSupplySources);
      return newSource;
    }

    case 'update_supply_source': {
      const {
        source_id,
        sourceId,
        id,
        purchase_cost,
        purchaseCost,
        cost: argCost,
        vendor_partner_id,
        vendorPartnerId,
        currency,
        is_primary,
        isPrimary
      } = args || {};

      const targetSourceId = (source_id || sourceId || id || '').trim();
      if (!targetSourceId) {
        throw new Error('供應來源 ID 不能為空');
      }

      const targetTenantId = resolveMockActiveTenantId();
      const source = mockProductSupplySources.find(s => s.id === targetSourceId);
      if (!source) {
        throw new Error('供應來源不存在');
      }

      // Verify source belongs to active tenant
      const unit = mockProductUnits.find(u => u.id === source.unit_id);
      if (!unit) {
        throw new Error('供應來源不存在');
      }
      const variant = mockProductVariants.find(v => v.id === unit.variant_id);
      if (!variant) {
        throw new Error('供應來源不存在');
      }
      const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!product) {
        throw new Error('供應來源不存在');
      }

      // If updating cost, validate >= 0
      const rawCost = purchase_cost !== undefined ? purchase_cost : (purchaseCost !== undefined ? purchaseCost : argCost);
      if (rawCost !== undefined) {
        const costNum = Number(rawCost);
        if (isNaN(costNum) || costNum < 0) {
          throw new Error('採購成本不能為負數');
        }
        source.purchase_cost = costNum;
        source.cost = costNum;
      }

      // If updating vendor, validate vendor in active tenant with is_vendor = true
      const targetVendorId = vendor_partner_id !== undefined ? vendor_partner_id : vendorPartnerId;
      if (targetVendorId !== undefined) {
        const trimmedVendor = (targetVendorId || '').trim();
        if (!trimmedVendor) {
          throw new Error('供應商不存在或無效');
        }
        const vendor = mockPartners.find(p => p.id === trimmedVendor && (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.is_vendor === true);
        if (!vendor) {
          throw new Error('供應商不存在或無效');
        }
        source.vendor_partner_id = vendor.id;
      }

      if (currency !== undefined) {
        const cur = (currency || '').trim();
        source.currency = cur || 'TWD';
      }

      const prim = is_primary !== undefined ? is_primary : isPrimary;
      if (prim !== undefined) {
        const targetIsPrimary = !!prim;
        if (targetIsPrimary) {
          mockProductSupplySources.forEach(s => {
            if (s.unit_id === source.unit_id && s.id !== source.id) {
              s.is_primary = false;
            }
          });
        }
        source.is_primary = targetIsPrimary;
      }

      saveStorage('agent_erp_mock_product_supply_sources', mockProductSupplySources);
      return { ...source };
    }

    case 'add_bom_item': {
      const {
        parent_variant_id, parentVariantId,
        child_variant_id, childVariantId,
        product_id, productId,
        material_variant_id, materialVariantId,
        quantity
      } = args || {};
      const targetParentVid = parent_variant_id || parentVariantId || product_id || productId;
      const targetChildVid = child_variant_id || childVariantId || material_variant_id || materialVariantId;
      const targetTenantId = resolveMockActiveTenantId();

      const qty = Number(quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('BOM 用量必須大於 0');
      }

      let parentVar = mockProductVariants.find(v => v.id === targetParentVid);
      if (!parentVar) {
        parentVar = mockProductVariants.find(v => v.product_id === targetParentVid && v.is_default) ||
                    mockProductVariants.find(v => v.product_id === targetParentVid);
      }
      if (!parentVar) {
        throw new Error('母規格變體不存在');
      }
      const parentProd = mockProducts.find(p => p.id === parentVar.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!parentProd) {
        throw new Error('母規格變體不存在');
      }
      const isParentManufactured = parentProd.category === 'manufactured' || parentProd.category === '自製成品' || parentProd.category === '自製';
      if (!isParentManufactured) {
        throw new Error('非自製成品不可建立 BOM 組成');
      }

      let childVar = mockProductVariants.find(v => v.id === targetChildVid);
      if (!childVar) {
        childVar = mockProductVariants.find(v =>
          (v.product_id === targetChildVid && v.is_default) ||
          (typeof targetChildVid === 'string' && targetChildVid.startsWith('var_') && targetChildVid.endsWith('_std') && v.product_id === targetChildVid.slice(4, -4)) ||
          v.product_id === targetChildVid
        );
      }
      if (!childVar) {
        throw new Error('子物料變體不存在或不屬於同一租戶');
      }
      const childProd = mockProducts.find(p => p.id === childVar.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!childProd) {
        throw new Error('子物料變體不存在或不屬於同一租戶');
      }

      if (parentVar.id === childVar.id || parentProd.id === childProd.id) {
        throw new Error('BOM 子物料不能為自身');
      }

      if (checkMockBomCycle(parentProd.id, childProd.id)) {
        throw new Error('BOM 子物料不能形成循環引用');
      }

      const now = Math.floor(Date.now() / 1000);
      const newBom = {
        id: nextMockUid('bom'),
        parent_variant_id: parentVar.id,
        child_variant_id: childVar.id,
        product_id: parentProd.id,
        material_variant_id: childVar.id,
        quantity: qty,
        created_at: now,
        child_product_name: childProd.name,
        child_variant_name: childVar.name,
        child_sku: childVar.sku || null
      };
      mockProductBomItems.push(newBom);
      saveStorage('agent_erp_mock_product_bom_items', mockProductBomItems);
      return newBom;
    }

    case 'record_audit_log': {
      const { action_type, actionType, arguments: argsPayload, args: directArgs, decision, operator } = args;
      const now = Math.floor(Date.now() / 1000);
      const logId = `LOG-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
      const rawArgs = argsPayload !== undefined ? argsPayload : directArgs;
      const newLog = {
        id: logId,
        action_type: (action_type || actionType || '').trim(),
        arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs || {}),
        decision: (decision || '').trim(),
        operator: (operator || 'user').trim(),
        timestamp: now
      };
      mockAuditLogs.unshift(newLog);
      saveStorage('agent_erp_mock_audit_logs', mockAuditLogs);
      return logId;
    }

    case 'record_llm_trace': {
      const trace = args.trace || args;
      const now = Math.floor(Date.now() / 1000);
      const traceId = trace.id || `trace_${now}_${Math.floor(1000 + Math.random() * 9000)}`;
      const existingIndex = mockLlmTraces.findIndex(t => t.id === traceId);
      const traceRecord = {
        id: traceId,
        agent_scope: trace.agent_scope || trace.agentScope || 'general',
        system_prompt: trace.system_prompt || trace.systemPrompt || '',
        tools_json: trace.tools_json || trace.toolsJson || '[]',
        user_message: trace.user_message || trace.userMessage || '',
        raw_response: trace.raw_response !== undefined ? trace.raw_response : (trace.rawResponse || null),
        parsed_result: trace.parsed_result !== undefined ? trace.parsed_result : (trace.parsedResult || null),
        model: trace.model || 'z-ai/glm-5.3-flash',
        latency_ms: trace.latency_ms !== undefined ? trace.latency_ms : (trace.latencyMs !== undefined ? trace.latencyMs : null),
        error: trace.error || null,
        human_decision: trace.human_decision || trace.humanDecision || null,
        created_at: trace.created_at || trace.createdAt || now
      };
      if (existingIndex >= 0) {
        mockLlmTraces[existingIndex] = {
          ...mockLlmTraces[existingIndex],
          ...traceRecord,
          human_decision: traceRecord.human_decision !== null ? traceRecord.human_decision : mockLlmTraces[existingIndex].human_decision
        };
      } else {
        mockLlmTraces.unshift(traceRecord);
      }
      saveStorage('agent_erp_mock_llm_traces', mockLlmTraces);
      return traceId;
    }

    case 'update_llm_trace_decision': {
      const { id, decision } = args;
      const trace = mockLlmTraces.find(t => t.id === id);
      if (!trace) {
        throw new Error(`Trace not found: ${id}`);
      }
      trace.human_decision = decision;
      saveStorage('agent_erp_mock_llm_traces', mockLlmTraces);
      return null;
    }

    case 'get_llm_traces': {
      return [...mockLlmTraces];
    }
    
    default:
      console.warn(`Unhandled mock IPC command: ${cmd}`);
      return null;
  }
}

// 2. Listen wrapper
export async function listen(event, callback) {
  if (isTauri) {
    const { listen: realListen } = await import('@tauri-apps/api/event');
    return await realListen(event, callback);
  }

  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(callback);
  
  return () => {
    listeners[event] = listeners[event].filter(cb => cb !== callback);
  };
}

// 3. Check updater wrapper
export async function check() {
  if (isTauri) {
    const { check: realCheck } = await import('@tauri-apps/plugin-updater');
    return await realCheck();
  }

  return {
    available: true,
    version: '0.2.0',
    body: '主要優化：\n1. 優化 Svelte 5 Runes 渲染引擎\n2. 升級 Rust 邊緣 SQLite 加密協議 (SQLCipher)\n3. 修正 Windows/macOS 系統更新偶發閃退問題。'
  };
}

// 4. Relaunch wrapper
export async function relaunch() {
  if (isTauri) {
    const { relaunch: realRelaunch } = await import('@tauri-apps/plugin-process');
    return await realRelaunch();
  }

  console.log('[Mock Process] Relaunching application...');
  alert('應用程式模擬重啟...');
  location.reload();
}
