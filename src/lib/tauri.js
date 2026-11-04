import { Channel as TauriChannel } from '@tauri-apps/api/core';
import { calculateDueDate } from './paymentTerms.js';

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
  if (mockSessions && mockSessions.active_tenant_id !== undefined && mockSessions.active_tenant_id !== null) {
    return typeof mockSessions.active_tenant_id === 'string' ? mockSessions.active_tenant_id : String(mockSessions.active_tenant_id);
  }
  return 'tnt_mock_1';
}

function resolveMockActiveUserId() {
  if (mockSessions && mockSessions.user_id !== undefined && mockSessions.user_id !== null) {
    return typeof mockSessions.user_id === 'string' ? mockSessions.user_id : String(mockSessions.user_id);
  }
  return 'usr_mock_admin';
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

  // Deduplicate existing duplicate onboarding subtasks in mockTasks
  const seenSubtasks = new Set();
  const dedupedMock = [];
  const onboardingTitles = new Set(['設定部門', '建立第一個客戶', '建立第一個供應商', '建立第一個商品']);
  for (const t of mockTasks) {
    if (t.parent_task_id && onboardingTitles.has(t.title)) {
      const key = `${t.tenant_id || 'tnt_mock_1'}:${t.parent_task_id}:${t.title}`;
      if (seenSubtasks.has(key)) {
        migrated = true;
        continue;
      }
      seenSubtasks.add(key);
    }
    dedupedMock.push(t);
  }
  if (dedupedMock.length !== mockTasks.length) {
    mockTasks = dedupedMock;
    migrated = true;
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
    { id: "dept_mock_1", tenant_id: tenantId, name: "總經理室", parent_id: null, skills: ["org.manage", "audit.trace_view", "department.manage", "vendor.manage_purchase_order", "vendor.manage", "vendor.create_basic_profile", "product.manage", "product.create_basic_profile", "customer.create_basic_profile", "customer.view"], created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
    { id: "dept_mock_2", tenant_id: tenantId, name: "研發總處", parent_id: null, skills: ["dev.repo_write", "dev.agent_config", "product.manage"], created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
    { id: "dept_mock_3", tenant_id: tenantId, name: "前端小組", parent_id: "dept_mock_2", skills: ["ui.build", "ui.component_test"], created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
    { id: "dept_mock_4", tenant_id: tenantId, name: "後端架構組", parent_id: "dept_mock_2", skills: ["backend.api_build", "db.migrate"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 },
    { id: "dept_mock_5", tenant_id: tenantId, name: "行銷業務部", parent_id: null, skills: ["sales.lead_manage", "crm.read", "customer.create_basic_profile", "customer.view"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 },
    { id: "dept_mock_6", tenant_id: tenantId, name: "財務會計處", parent_id: null, skills: ["finance.view", "invoice.issue", "vendor.manage_purchase_order", "vendor.manage"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 }
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
    if ((d.id === 'dept_mock_1' || d.id === 'dept_mock_6') && Array.isArray(d.skills) && !d.skills.includes('vendor.manage_purchase_order')) {
      d.skills.push('vendor.manage_purchase_order');
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
  { id: "part_mock_1", tenant_id: "tnt_mock_1", name: "A 公司 (Customer A)", is_customer: true, is_vendor: false, tax_id: null, payment_terms_type: null, payment_terms_days: null, created_at: Math.floor(Date.now() / 1000) - 86400 * 5 },
  { id: "part_mock_2", tenant_id: "tnt_mock_1", name: "台積電 (TSMC)", is_customer: true, is_vendor: false, tax_id: "22099131", payment_terms_type: null, payment_terms_days: null, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 }
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

let mockPurchaseOrders = loadStorage('agent_erp_mock_purchase_orders', []);
if (!mockPurchaseOrders || !Array.isArray(mockPurchaseOrders)) {
  mockPurchaseOrders = [];
  saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
}

let mockPurchaseOrderLines = loadStorage('agent_erp_mock_purchase_order_lines', []);
if (!mockPurchaseOrderLines || !Array.isArray(mockPurchaseOrderLines)) {
  mockPurchaseOrderLines = [];
  saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
}

let mockInventoryMovements = loadStorage('agent_erp_mock_inventory_movements', []);
if (!mockInventoryMovements || !Array.isArray(mockInventoryMovements)) {
  mockInventoryMovements = [];
  saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
}

let mockInventoryAdjustments = loadStorage('agent_erp_mock_inventory_adjustments', []);
if (!mockInventoryAdjustments || !Array.isArray(mockInventoryAdjustments)) {
  mockInventoryAdjustments = [];
  saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
}

let mockInventoryAdjustmentLines = loadStorage('agent_erp_mock_inventory_adjustment_lines', []);
if (!mockInventoryAdjustmentLines || !Array.isArray(mockInventoryAdjustmentLines)) {
  mockInventoryAdjustmentLines = [];
  saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
}

function nextMockAdjNumber(tenantId) {
  let maxSeq = 0;
  for (const adj of mockInventoryAdjustments) {
    if ((adj.tenant_id || 'tnt_mock_1') === tenantId && adj.adjustment_number && adj.adjustment_number.startsWith('ADJ-')) {
      const num = parseInt(adj.adjustment_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `ADJ-${String(maxSeq + 1).padStart(5, '0')}`;
}

function formatMockQty(q) {
  const rounded = Math.round(q * 1e6) / 1e6;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

function formatMockInventoryAdjustmentDetail(adjustment) {
  const lines = mockInventoryAdjustmentLines
    .filter(l => l.adjustment_id === adjustment.id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    adjustment: {
      ...adjustment,
      lines_count: lines.length
    },
    lines: lines.map(l => ({ ...l }))
  };
}

let mockStocktakes = loadStorage('agent_erp_mock_stocktakes', []);
if (!mockStocktakes || !Array.isArray(mockStocktakes)) {
  mockStocktakes = [];
  saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
}

let mockStocktakeLines = loadStorage('agent_erp_mock_stocktake_lines', []);
if (!mockStocktakeLines || !Array.isArray(mockStocktakeLines)) {
  mockStocktakeLines = [];
  saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
}

export function isStocktakeLineCounted(val) {
  if (val !== null && typeof val === 'object') {
    return val.counted_quantity !== null && val.counted_quantity !== undefined && val.counted_quantity !== '';
  }
  return val !== null && val !== undefined && val !== '';
}

function nextMockStkNumber(tenantId) {
  let maxSeq = 0;
  for (const stk of mockStocktakes) {
    if ((stk.tenant_id || 'tnt_mock_1') === tenantId && stk.stocktake_number && stk.stocktake_number.startsWith('STK-')) {
      const num = parseInt(stk.stocktake_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `STK-${String(maxSeq + 1).padStart(5, '0')}`;
}

function formatMockStocktakeDetail(stocktake) {
  const lines = mockStocktakeLines
    .filter(l => l.stocktake_id === stocktake.id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    stocktake: { ...stocktake },
    lines: lines.map(l => ({ ...l }))
  };
}

let mockStockTransfers = loadStorage('agent_erp_mock_stock_transfers', []);
if (!mockStockTransfers || !Array.isArray(mockStockTransfers)) {
  mockStockTransfers = [];
  saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
}

let mockStockTransferLines = loadStorage('agent_erp_mock_stock_transfer_lines', []);
if (!mockStockTransferLines || !Array.isArray(mockStockTransferLines)) {
  mockStockTransferLines = [];
  saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
}

let mockAccountsPayable = loadStorage('agent_erp_mock_accounts_payable', []);
if (!mockAccountsPayable || !Array.isArray(mockAccountsPayable)) {
  mockAccountsPayable = [];
  saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
}

let mockPayments = loadStorage('agent_erp_mock_payments', []);
if (!mockPayments || !Array.isArray(mockPayments)) {
  mockPayments = [];
  saveStorage('agent_erp_mock_payments', mockPayments);
}

let mockPaymentAllocations = loadStorage('agent_erp_mock_payment_allocations', []);
if (!mockPaymentAllocations || !Array.isArray(mockPaymentAllocations)) {
  mockPaymentAllocations = [];
  saveStorage('agent_erp_mock_payment_allocations', mockPaymentAllocations);
}

let mockVendorBills = loadStorage('agent_erp_mock_vendor_bills', []);
if (!mockVendorBills || !Array.isArray(mockVendorBills)) {
  mockVendorBills = [];
  saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
}

let mockVendorBillOrders = loadStorage('agent_erp_mock_vendor_bill_orders', []);
if (!mockVendorBillOrders || !Array.isArray(mockVendorBillOrders)) {
  mockVendorBillOrders = [];
  saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
}

function calculateMockPoReceivedTotal(poId) {
  const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === poId);
  let total = 0;
  for (const l of lines) {
    const qty = l.received_quantity !== undefined && l.received_quantity !== null ? Number(l.received_quantity) : Number(l.quantity);
    total += qty * Number(l.purchase_cost);
  }
  return Math.round(total * 100) / 100;
}

function formatMockVendorBill(vb) {
  const untaxed = Math.round(Number(vb.untaxed_amount) * 100) / 100;
  const tax = Math.round(Number(vb.tax_amount) * 100) / 100;
  const total = Math.round((untaxed + tax) * 100) / 100;
  const orders = mockVendorBillOrders.filter(o => o.bill_id === vb.id);

  const bill = {
    id: vb.id,
    tenant_id: vb.tenant_id,
    bill_number: vb.bill_number,
    vendor_partner_id: vb.vendor_partner_id,
    vendor_name_snapshot: vb.vendor_name_snapshot,
    vendor_invoice_number: vb.vendor_invoice_number,
    bill_date: vb.bill_date,
    due_date: vb.due_date,
    untaxed_amount: untaxed,
    tax_amount: tax,
    total_amount: total,
    currency: vb.currency || 'TWD',
    status: vb.status,
    basis_amount: vb.basis_amount !== undefined && vb.basis_amount !== null ? Math.round(Number(vb.basis_amount) * 100) / 100 : null,
    difference_amount: vb.difference_amount !== undefined && vb.difference_amount !== null ? Math.round(Number(vb.difference_amount) * 100) / 100 : null,
    difference_note: vb.difference_note || null,
    difference_accepted_by: vb.difference_accepted_by || null,
    difference_accepted_at: vb.difference_accepted_at || null,
    note: vb.note || null,
    created_by: vb.created_by,
    created_at: vb.created_at,
    posted_at: vb.posted_at || null,
    cancelled_at: vb.cancelled_at || null,
    voided_by: vb.voided_by || null,
    voided_at: vb.voided_at || null,
    void_reason: vb.void_reason || null,
    task_id: vb.task_id || null
  };

  const item = {
    ...bill,
    order_count: orders.length
  };

  const orderInfos = orders.map(o => ({
    id: o.id,
    bill_id: o.bill_id,
    purchase_order_id: o.purchase_order_id,
    po_number_snapshot: o.po_number_snapshot,
    created_at: o.created_at,
    received_total_amount: calculateMockPoReceivedTotal(o.purchase_order_id)
  }));

  return {
    item,
    detail: {
      bill,
      orders: orderInfos
    }
  };
}

function nextMockBillNumber(tenantId) {
  const existing = mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const b of existing) {
    if (b.bill_number && b.bill_number.startsWith('BILL-')) {
      const num = parseInt(b.bill_number.substring(5), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `BILL-${String(nextSeq).padStart(5, '0')}`;
}

function formatMockAccountPayable(ap) {
  const targetTenantId = ap.tenant_id || 'tnt_mock_1';
  const allocations = mockPaymentAllocations
    .filter(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId)
    .map(pa => {
      const payment = mockPayments.find(p => p.id === pa.payment_id) || {};
      return {
        id: pa.id,
        payment_id: pa.payment_id,
        payment_number: payment.payment_number || '',
        amount: Math.round(Number(pa.amount) * 100) / 100,
        payment_date: payment.payment_date || '',
        payment_status: payment.status || 'posted',
        created_at: pa.created_at || ap.created_at
      };
    });

  let rawPaid = 0;
  for (const a of allocations) {
    if (a.payment_status === 'posted') {
      rawPaid += a.amount;
    }
  }

  const roundedTotal = Math.round(Number(ap.amount) * 100) / 100;
  const roundedPaid = Math.round(rawPaid * 100) / 100;

  let paid_amount = 0;
  let outstanding_amount = 0;
  let settlement_status = 'unpaid';

  if (ap.status === 'voided') {
    paid_amount = 0;
    outstanding_amount = 0;
    settlement_status = 'unpaid';
  } else {
    const outstanding = Math.round((roundedTotal - roundedPaid) * 100) / 100;
    if (outstanding <= 0) {
      paid_amount = roundedPaid;
      outstanding_amount = 0;
      settlement_status = 'paid';
    } else if (outstanding >= roundedTotal) {
      paid_amount = 0;
      outstanding_amount = roundedTotal;
      settlement_status = 'unpaid';
    } else {
      paid_amount = roundedPaid;
      outstanding_amount = outstanding;
      settlement_status = 'partially_paid';
    }
  }

  return {
    detail: {
      ...ap,
      paid_amount,
      outstanding_amount,
      settlement_status,
      allocations
    },
    item: {
      ...ap,
      paid_amount,
      outstanding_amount,
      settlement_status
    }
  };
}

function nextMockTrfNumber(tenantId) {
  let maxSeq = 0;
  for (const trf of mockStockTransfers) {
    if ((trf.tenant_id || 'tnt_mock_1') === tenantId && trf.transfer_number && trf.transfer_number.startsWith('TRF-')) {
      const num = parseInt(trf.transfer_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `TRF-${String(maxSeq + 1).padStart(5, '0')}`;
}

function formatMockStockTransferDetail(transfer) {
  const lines = mockStockTransferLines
    .filter(l => l.transfer_id === transfer.id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    transfer: { ...transfer },
    lines: lines.map(l => ({ ...l }))
  };
}

function validateMockAdjReasonAndNote(reasonCode, note) {
  const trimmedReason = String(reasonCode || '').trim();
  const allowed = ['damage', 'loss', 'found', 'opening_correction', 'other'];
  if (!allowed.includes(trimmedReason)) {
    throw new Error('請選擇調整原因');
  }
  if (trimmedReason === 'other') {
    if (!note || !String(note).trim()) {
      throw new Error('原因為其他時須填寫說明');
    }
  }
}

const defaultMockWarehouses = [
  {
    id: "wh_mock_1",
    tenant_id: "tnt_mock_1",
    code: "MAIN",
    name: "主倉",
    is_default: true,
    is_active: true,
    created_at: Math.floor(Date.now() / 1000) - 86400,
  }
];

let mockWarehouses = loadStorage('agent_erp_mock_warehouses', defaultMockWarehouses);
if (!mockWarehouses || !Array.isArray(mockWarehouses)) {
  mockWarehouses = JSON.parse(JSON.stringify(defaultMockWarehouses));
  saveStorage('agent_erp_mock_warehouses', mockWarehouses);
}

function migrateAndBackfillMockWarehouses() {
  const tenantsWithData = new Set();
  for (const po of mockPurchaseOrders) {
    if (!po.warehouse_id) {
      tenantsWithData.add(po.tenant_id || 'tnt_mock_1');
    }
  }
  for (const mov of mockInventoryMovements) {
    if (!mov.warehouse_id) {
      tenantsWithData.add(mov.tenant_id || 'tnt_mock_1');
    }
  }

  for (const tid of tenantsWithData) {
    let wh = mockWarehouses.find(w => (w.tenant_id || 'tnt_mock_1') === tid && w.is_default);
    if (!wh) {
      wh = mockWarehouses.find(w => (w.tenant_id || 'tnt_mock_1') === tid && w.is_active);
    }
    if (!wh) {
      wh = {
        id: nextMockUid('wh'),
        tenant_id: tid,
        code: 'MAIN',
        name: '主倉',
        is_default: true,
        is_active: true,
        created_at: Math.floor(Date.now() / 1000),
      };
      mockWarehouses.push(wh);
    }
    for (const po of mockPurchaseOrders) {
      if ((po.tenant_id || 'tnt_mock_1') === tid && !po.warehouse_id) {
        po.warehouse_id = wh.id;
      }
    }
    for (const mov of mockInventoryMovements) {
      if ((mov.tenant_id || 'tnt_mock_1') === tid && !mov.warehouse_id) {
        mov.warehouse_id = wh.id;
      }
    }
  }
  saveStorage('agent_erp_mock_warehouses', mockWarehouses);
  saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
  saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
}
migrateAndBackfillMockWarehouses();

function resolveMockDefaultWarehouse(tenantId) {
  const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === tenantId);
  if (tWhs.length === 0) {
    throw new Error('此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別');
  }
  let defWh = tWhs.find(w => w.is_default);
  if (!defWh) {
    defWh = tWhs.find(w => w.is_active);
  }
  if (!defWh || !defWh.is_active) {
    throw new Error('預設倉已停用，請先重新啟用或設定其他預設倉');
  }
  return defWh;
}

function validateMockWarehouseActive(tenantId, warehouseId) {
  const targetId = String(warehouseId || '').trim();
  if (!targetId) {
    throw new Error('找不到倉別或倉別已停用');
  }
  const wh = mockWarehouses.find(w => w.id === targetId && (w.tenant_id || 'tnt_mock_1') === tenantId);
  if (!wh || !wh.is_active) {
    throw new Error('找不到倉別或倉別已停用');
  }
  return wh;
}

function nextMockPoNumber(tenantId) {
  let maxSeq = 0;
  for (const po of mockPurchaseOrders) {
    if ((po.tenant_id || 'tnt_mock_1') === tenantId && po.po_number && po.po_number.startsWith('PO-')) {
      const num = parseInt(po.po_number.slice(3), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `PO-${String(maxSeq + 1).padStart(5, '0')}`;
}

function resolveMockUnitSnapshot(tenantId, unitId) {
  const targetUid = String(unitId || '').trim();
  const unit = mockProductUnits.find(u => u.id === targetUid);
  if (!unit) {
    throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
  }
  const variant = mockProductVariants.find(v => v.id === unit.variant_id);
  if (!variant) {
    throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
  }
  const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === tenantId);
  if (!product) {
    throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
  }
  return { unit, variant, product };
}

function resolveMockVendorSnapshot(tenantId, vendorPartnerId) {
  const targetVid = String(vendorPartnerId || '').trim();
  const partner = mockPartners.find(p => p.id === targetVid && (p.tenant_id || 'tnt_mock_1') === tenantId);
  if (!partner) {
    throw new Error('找不到指定的供應商或不屬於目前租戶');
  }
  if (!partner.is_vendor) {
    throw new Error('指定的合作夥伴不是供應商 (is_vendor != 1)');
  }
  return partner.name;
}

function formatMockPurchaseOrderDetail(order) {
  const lines = mockPurchaseOrderLines
    .filter(l => l.purchase_order_id === order.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map(l => ({
      ...l,
      subtotal: (l.quantity || 0) * (l.purchase_cost || 0)
    }));
  const total_amount = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return {
    order: {
      ...order,
      total_amount
    },
    lines
  };
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

// Mock Channel implementation for streaming chat in browser / test runner
class MockChannel {
  constructor(onmessage) {
    this.onmessage = onmessage || null;
  }
}

// Environment-aware Channel implementation:
// Uses native Tauri IPC Channel with transformCallback and toJSON() in Tauri runtime,
// and MockChannel in browser or node test runner.
export class Channel {
  constructor(onmessage) {
    const inTauri = (typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__) || isTauri;
    if (inTauri) {
      if (typeof window !== 'undefined' && window.__TAURI__?.core?.Channel) {
        return new window.__TAURI__.core.Channel(onmessage);
      }
      return new TauriChannel(onmessage);
    }
    return new MockChannel(onmessage);
  }
}

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
        const responseText = "一般對話尚未串接 LLM 模型。如需體驗智能助理，請由上方或列表選擇具體業務任務（如部門、客戶、供應商、商品管理）。";

        const chunks = responseText.match(/[\s\S]{1,3}/g) || [responseText];
        let idx = 0;
        const interval = setInterval(() => {
          if (idx < chunks.length) {
            const isLast = idx === chunks.length - 1;
            channel.onmessage({ token: chunks[idx], done: isLast });
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
      const targetUserId = (mockSessions && mockSessions.user_id) ? mockSessions.user_id : 'usr_mock_admin';
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
        completed_at: null,
        created_by: targetUserId
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

    // 保留作為遷移期間的驗證基準與 rollback 安全網，前端已全面改走 detect_intent
    case 'detect_department_intent': {
      return { attempted: false, tool_call: null };
    }

    case 'detect_intent': {
      return { attempted: false, tool_call: null, tool_calls: null, content: null };
    }

    case 'create_partner': {
      const {
        name,
        is_customer,
        isCustomer,
        is_vendor,
        isVendor,
        tax_id,
        taxId,
        payment_terms_type,
        paymentTermsType,
        payment_terms_days,
        paymentTermsDays
      } = args;
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

      // Validate payment terms (PT-01, PT-02, PT-03)
      const rawType = payment_terms_type !== undefined ? payment_terms_type : paymentTermsType;
      const rawDays = payment_terms_days !== undefined ? payment_terms_days : paymentTermsDays;
      const normType = rawType !== undefined && rawType !== null ? String(rawType).trim() : null;
      const hasType = normType !== null && normType.length > 0;
      const hasDays = rawDays !== undefined && rawDays !== null && rawDays !== '';

      if ((hasType && !hasDays) || (!hasType && hasDays)) {
        throw new Error('付款條件類型與天數需同時設定');
      }

      if (hasType) {
        if (!vendFlag) {
          throw new Error('僅供應商可設定付款條件');
        }
        if (normType !== 'net' && normType !== 'month_end') {
          throw new Error('付款條件類型需為 net 或 month_end');
        }
        const d = Number(rawDays);
        if (!Number.isInteger(d) || d < 0 || d > 365) {
          throw new Error('付款天數需為 0～365 的整數');
        }
      }

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
          if (hasType) {
            existing.payment_terms_type = normType;
            existing.payment_terms_days = Number(rawDays);
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
        payment_terms_type: hasType ? normType : null,
        payment_terms_days: hasType ? Number(rawDays) : null,
        created_at: now
      };
      mockPartners.push(newPartner);
      saveStorage('agent_erp_mock_partners', mockPartners);
      return newPartner;
    }

    case 'update_partner': {
      const {
        id,
        name,
        tax_id,
        taxId,
        payment_terms_type,
        paymentTermsType,
        payment_terms_days,
        paymentTermsDays,
        clear_payment_terms,
        clearPaymentTerms
      } = args || {};
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

      // Handle payment terms update and clearing (PT-01, PT-02, PT-03)
      const shouldClear = clear_payment_terms === true || clearPaymentTerms === true ||
        (payment_terms_type === '' && (payment_terms_days === null || payment_terms_days === undefined));

      if (shouldClear) {
        partner.payment_terms_type = null;
        partner.payment_terms_days = null;
      } else if (
        payment_terms_type !== undefined ||
        paymentTermsType !== undefined ||
        payment_terms_days !== undefined ||
        paymentTermsDays !== undefined
      ) {
        const rawType = payment_terms_type !== undefined ? payment_terms_type : paymentTermsType;
        const rawDays = payment_terms_days !== undefined ? payment_terms_days : paymentTermsDays;
        const normType = rawType !== undefined && rawType !== null ? String(rawType).trim() : null;
        const hasType = normType !== null && normType.length > 0;
        const hasDays = rawDays !== undefined && rawDays !== null && rawDays !== '';

        if ((hasType && !hasDays) || (!hasType && hasDays)) {
          throw new Error('付款條件類型與天數需同時設定');
        }

        if (hasType) {
          if (!partner.is_vendor) {
            throw new Error('僅供應商可設定付款條件');
          }
          if (normType !== 'net' && normType !== 'month_end') {
            throw new Error('付款條件類型需為 net 或 month_end');
          }
          const d = Number(rawDays);
          if (!Number.isInteger(d) || d < 0 || d > 365) {
            throw new Error('付款天數需為 0～365 的整數');
          }
          partner.payment_terms_type = normType;
          partner.payment_terms_days = d;
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

    case 'create_purchase_order': {
      const {
        vendor_partner_id, vendorPartnerId,
        currency,
        expected_date, expectedDate,
        note,
        task_id, taskId,
        initial_lines, initialLines,
        warehouse_id, warehouseId
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetVendorId = vendor_partner_id || vendorPartnerId;
      const targetUserId = (mockSessions && mockSessions.user_id) ? mockSessions.user_id : 'usr_mock_admin';
      if (!targetUserId || !targetUserId.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }
      const curr = currency || 'TWD';
      if (curr.trim().toUpperCase() !== 'TWD') {
        throw new Error("幣別僅支援 'TWD'");
      }
      const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      let targetWh;
      if (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') {
        targetWh = validateMockWarehouseActive(targetTenantId, rawWhId);
      } else {
        targetWh = resolveMockDefaultWarehouse(targetTenantId);
      }
      const vendorName = resolveMockVendorSnapshot(targetTenantId, targetVendorId);
      const now = Math.floor(Date.now() / 1000);
      const poId = nextMockUid('po');
      const poNumber = nextMockPoNumber(targetTenantId);

      const newOrder = {
        id: poId,
        tenant_id: targetTenantId,
        po_number: poNumber,
        warehouse_id: targetWh.id,
        vendor_partner_id: targetVendorId,
        vendor_name_snapshot: vendorName,
        currency: curr.trim().toUpperCase(),
        status: 'draft',
        expected_date: expected_date !== undefined ? expected_date : (expectedDate || null),
        note: note || null,
        created_by: targetUserId.trim(),
        created_at: now,
        ordered_at: null,
        received_at: null,
        cancelled_at: null,
        task_id: task_id || taskId || null
      };
      mockPurchaseOrders.push(newOrder);

      const items = initial_lines || initialLines || [];
      const seenUnits = new Set();
      items.forEach((item, idx) => {
        const uId = String(item.unit_id || item.unitId || '').trim();
        if (seenUnits.has(uId)) {
          throw new Error('同一採購單內商品單位不可重複，若需調整數量請修改既有明細');
        }
        seenUnits.add(uId);

        const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
        if (!product.is_purchasable) {
          throw new Error(`商品「${product.name}」設定為不可採購 (is_purchasable = 0)`);
        }
        const qty = Number(item.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error('採購數量必須大於 0');
        }

        let cost = item.purchase_cost !== undefined ? item.purchase_cost : item.purchaseCost;
        let supplySourceId = null;

        const src = mockProductSupplySources.find(s => s.unit_id === uId && s.vendor_partner_id === targetVendorId);
        if (src && (src.currency || 'TWD').toUpperCase() === 'TWD') {
          supplySourceId = src.id;
          if (cost === undefined || cost === null) {
            cost = src.purchase_cost !== undefined ? src.purchase_cost : src.cost;
          }
        }

        if (cost === undefined || cost === null) {
          throw new Error('查無此供應商的預設供應來源成本，請手動指定單價');
        }
        const numCost = Number(cost);
        if (isNaN(numCost) || numCost < 0) {
          throw new Error('採購單價不可為負數');
        }

        const polId = nextMockUid('pol');
        const newLine = {
          id: polId,
          purchase_order_id: poId,
          line_no: idx + 1,
          unit_id: uId,
          supply_source_id: supplySourceId,
          product_name_snapshot: product.name,
          variant_name_snapshot: variant.name,
          sku_snapshot: variant.sku || null,
          unit_name_snapshot: unit.unit_name,
          quantity: qty,
          received_quantity: null,
          purchase_cost: numCost,
          created_at: now
        };
        mockPurchaseOrderLines.push(newLine);
      });

      saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
      saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
      return formatMockPurchaseOrderDetail(newOrder);
    }

    case 'update_purchase_order_header': {
      const {
        order_id, orderId,
        vendor_partner_id, vendorPartnerId,
        expected_date, expectedDate,
        note,
        warehouse_id, warehouseId
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetOrderId = order_id || orderId;
      const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到採購單或不屬於目前租戶');
      }
      if (order.status === 'received' || order.status === 'cancelled') {
        throw new Error(`採購單狀態為 ${order.status}，不允許修改表頭`);
      }
      const newVendor = vendor_partner_id !== undefined ? vendor_partner_id : vendorPartnerId;
      if (newVendor !== undefined && newVendor !== order.vendor_partner_id) {
        if (order.status !== 'draft') {
          throw new Error('僅有草稿 (draft) 狀態的採購單可修改供應商');
        }
        const hasLines = mockPurchaseOrderLines.some(l => l.purchase_order_id === order.id);
        if (hasLines) {
          throw new Error('採購單已有明細，不可修改供應商');
        }
        const vendorName = resolveMockVendorSnapshot(targetTenantId, newVendor);
        order.vendor_partner_id = newVendor;
        order.vendor_name_snapshot = vendorName;
      }
      const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      if (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') {
        const wh = validateMockWarehouseActive(targetTenantId, rawWhId);
        order.warehouse_id = wh.id;
      }
      if (expected_date !== undefined || expectedDate !== undefined) {
        order.expected_date = expected_date !== undefined ? expected_date : expectedDate;
      }
      if (note !== undefined) {
        order.note = note;
      }
      saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'add_purchase_order_line': {
      const { order_id, orderId, unit_id, unitId, quantity, purchase_cost, purchaseCost } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetOrderId = order_id || orderId;
      const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到採購單或不屬於目前租戶');
      }
      if (order.status !== 'draft') {
        throw new Error(`採購單狀態為 ${order.status}，僅草稿狀態可新增明細`);
      }
      const targetUnitId = String(unit_id || unitId || '').trim();
      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, targetUnitId);
      if (!product.is_purchasable) {
        throw new Error(`商品「${product.name}」設定為不可採購 (is_purchasable = 0)`);
      }
      const qty = Number(quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('採購數量必須大於 0');
      }
      const isDup = mockPurchaseOrderLines.some(l => l.purchase_order_id === order.id && l.unit_id === targetUnitId);
      if (isDup) {
        throw new Error('同一採購單內商品單位不可重複，若需調整數量請修改既有明細');
      }

      let cost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
      let supplySourceId = null;

      const src = mockProductSupplySources.find(s => s.unit_id === targetUnitId && s.vendor_partner_id === order.vendor_partner_id);
      if (src && (src.currency || 'TWD').toUpperCase() === (order.currency || 'TWD').toUpperCase()) {
        supplySourceId = src.id;
        if (cost === undefined || cost === null) {
          cost = src.purchase_cost !== undefined ? src.purchase_cost : src.cost;
        }
      }

      if (cost === undefined || cost === null) {
        throw new Error('查無此供應商的預設供應來源成本，請手動指定單價');
      }
      const numCost = Number(cost);
      if (isNaN(numCost) || numCost < 0) {
        throw new Error('採購單價不可為負數');
      }

      const maxLineNo = mockPurchaseOrderLines
        .filter(l => l.purchase_order_id === order.id)
        .reduce((max, l) => Math.max(max, l.line_no || 0), 0);
      const now = Math.floor(Date.now() / 1000);
      const polId = nextMockUid('pol');
      const newLine = {
        id: polId,
        purchase_order_id: order.id,
        line_no: maxLineNo + 1,
        unit_id: targetUnitId,
        supply_source_id: supplySourceId,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || null,
        unit_name_snapshot: unit.unit_name,
        quantity: qty,
        received_quantity: null,
        purchase_cost: numCost,
        created_at: now
      };
      mockPurchaseOrderLines.push(newLine);
      saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'update_purchase_order_line': {
      const { line_id, lineId, quantity, purchase_cost, purchaseCost } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetLineId = line_id || lineId;
      const line = mockPurchaseOrderLines.find(l => l.id === targetLineId);
      if (!line) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      const order = mockPurchaseOrders.find(o => o.id === line.purchase_order_id && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      if (order.status !== 'draft') {
        throw new Error(`採購單狀態為 ${order.status}，僅草稿狀態可修改明細`);
      }
      if (quantity !== undefined) {
        const qty = Number(quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error('採購數量必須大於 0');
        }
        line.quantity = qty;
      }
      const rawCost = purchase_cost !== undefined ? purchase_cost : purchaseCost;
      if (rawCost !== undefined) {
        const cost = Number(rawCost);
        if (isNaN(cost) || cost < 0) {
          throw new Error('採購單價不可為負數');
        }
        line.purchase_cost = cost;
      }
      saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'remove_purchase_order_line': {
      const { line_id, lineId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetLineId = line_id || lineId;
      const lineIndex = mockPurchaseOrderLines.findIndex(l => l.id === targetLineId);
      if (lineIndex === -1) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      const line = mockPurchaseOrderLines[lineIndex];
      const order = mockPurchaseOrders.find(o => o.id === line.purchase_order_id && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      if (order.status !== 'draft') {
        throw new Error(`採購單狀態為 ${order.status}，僅草稿狀態可刪除明細`);
      }
      mockPurchaseOrderLines.splice(lineIndex, 1);
      const remaining = mockPurchaseOrderLines
        .filter(l => l.purchase_order_id === order.id)
        .sort((a, b) => a.line_no - b.line_no);
      remaining.forEach((l, idx) => {
        l.line_no = idx + 1;
      });
      saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'submit_purchase_order': {
      const { order_id, orderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetOrderId = order_id || orderId;
      const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到採購單或不屬於目前租戶');
      }
      if (order.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 ordered`);
      }
      const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === order.id);
      if (lines.length === 0) {
        throw new Error('採購單至少需有 1 筆明細方可下單');
      }
      for (const l of lines) {
        const { product } = resolveMockUnitSnapshot(targetTenantId, l.unit_id);
        if (!product.is_purchasable) {
          throw new Error(`明細項目「${product.name}」設定為不可採購 (is_purchasable = 0)`);
        }
        if (l.quantity <= 0) {
          throw new Error('明細項目採購數量必須大於 0');
        }
        if (l.purchase_cost < 0) {
          throw new Error('明細項目採購單價不可為負數');
        }
      }
      const now = Math.floor(Date.now() / 1000);
      order.status = 'ordered';
      order.ordered_at = now;
      saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'confirm_purchase_order_received': {
      const { order_id, orderId, line_received_quantities, lineReceivedQuantities } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetOrderId = order_id || orderId;
      const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到採購單或不屬於目前租戶');
      }
      if (order.status !== 'ordered') {
        throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 received`);
      }
      const rawMap = line_received_quantities || lineReceivedQuantities || [];
      const recMap = new Map();
      if (Array.isArray(rawMap)) {
        rawMap.forEach(item => {
          recMap.set(item.line_id || item.lineId, item.received_quantity !== undefined ? item.received_quantity : item.receivedQuantity);
        });
      } else if (rawMap && typeof rawMap === 'object') {
        Object.entries(rawMap).forEach(([k, v]) => recMap.set(k, v));
      }

      const now = Math.floor(Date.now() / 1000);
      const targetUserId = (mockSessions && mockSessions.user_id) ? mockSessions.user_id : 'usr_mock_admin';
      const lines = mockPurchaseOrderLines.filter(l => l.purchase_order_id === order.id);

      for (const l of lines) {
        const userQty = recMap.get(l.id);
        const actualQty = userQty !== undefined ? Number(userQty) : l.quantity;
        if (actualQty < 0) {
          throw new Error('實到數量不可為負數');
        }
      }

      if (!order.warehouse_id) {
        const defWh = resolveMockDefaultWarehouse(targetTenantId);
        order.warehouse_id = defWh.id;
      }
      validateMockWarehouseActive(targetTenantId, order.warehouse_id);

      order.status = 'received';
      order.received_at = now;

      for (const l of lines) {
        const userQty = recMap.get(l.id);
        const actualQty = userQty !== undefined ? Number(userQty) : l.quantity;
        l.received_quantity = actualQty;

        const imId = nextMockUid('im');
        mockInventoryMovements.push({
          id: imId,
          tenant_id: targetTenantId,
          warehouse_id: order.warehouse_id,
          unit_id: l.unit_id,
          quantity_delta: actualQty,
          unit_cost: l.purchase_cost,
          reason: 'purchase_receipt',
          reference_type: 'purchase_order',
          reference_id: order.id,
          created_by: targetUserId,
          created_at: now
        });
      }

      saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
      saveStorage('agent_erp_mock_purchase_order_lines', mockPurchaseOrderLines);
      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'cancel_purchase_order': {
      const { order_id, orderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetOrderId = order_id || orderId;
      const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到採購單或不屬於目前租戶');
      }
      if (order.status !== 'draft' && order.status !== 'ordered') {
        throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 cancelled`);
      }
      const now = Math.floor(Date.now() / 1000);
      order.status = 'cancelled';
      order.cancelled_at = now;
      saveStorage('agent_erp_mock_purchase_orders', mockPurchaseOrders);
      return formatMockPurchaseOrderDetail(order);
    }

    case 'get_purchase_order': {
      const { order_id, orderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetOrderId = order_id || orderId;
      const order = mockPurchaseOrders.find(o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!order) {
        throw new Error('找不到採購單或不屬於目前租戶');
      }
      return formatMockPurchaseOrderDetail(order);
    }

    case 'list_purchase_orders': {
      const { filter_status, filterStatus, filter_vendor_partner_id, filterVendorPartnerId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      let list = mockPurchaseOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      const st = filter_status || filterStatus;
      if (st && String(st).trim()) {
        const norm = String(st).trim();
        list = list.filter(o => o.status === norm);
      }
      const vp = filter_vendor_partner_id || filterVendorPartnerId;
      if (vp && String(vp).trim()) {
        const normVp = String(vp).trim();
        list = list.filter(o => o.vendor_partner_id === normVp);
      }
      return list
        .sort((a, b) => b.created_at - a.created_at)
        .map(o => {
          const detail = formatMockPurchaseOrderDetail(o);
          return detail.order;
        });
    }

    case 'record_opening_inventory_balance': {
      const { unit_id, unitId, quantity, quantity_delta, quantityDelta, unit_cost, unitCost, warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetUserId = (mockSessions && mockSessions.user_id) ? mockSessions.user_id : 'usr_mock_admin';
      const targetUnitId = String(unit_id || unitId || '').trim();
      resolveMockUnitSnapshot(targetTenantId, targetUnitId);

      const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      let targetWh;
      if (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') {
        targetWh = validateMockWarehouseActive(targetTenantId, rawWhId);
      } else {
        targetWh = resolveMockDefaultWarehouse(targetTenantId);
      }

      const rawQty = quantity !== undefined ? quantity : (quantity_delta !== undefined ? quantity_delta : quantityDelta);
      const qty = Number(rawQty);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('期初開帳數量必須大於 0');
      }
      const cost = Number(unit_cost !== undefined ? unit_cost : unitCost);
      if (isNaN(cost) || cost < 0) {
        throw new Error('期初開帳成本不可為負數');
      }

      const dup = mockInventoryMovements.find(
        m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === targetUnitId && m.warehouse_id === targetWh.id && m.reason === 'opening_balance'
      );
      if (dup) {
        throw new Error(`此商品單位在〔${targetWh.name}〕已開帳，數量更正請用庫存調整（原因：期初更正）`);
      }

      const now = args?.created_at !== undefined ? args.created_at : Math.floor(Date.now() / 1000);
      const imId = nextMockUid('im');
      const newMovement = {
        id: imId,
        tenant_id: targetTenantId,
        warehouse_id: targetWh.id,
        unit_id: targetUnitId,
        quantity_delta: qty,
        unit_cost: cost,
        reason: 'opening_balance',
        reference_type: 'opening_balance',
        reference_id: null,
        created_by: targetUserId,
        created_at: now
      };
      mockInventoryMovements.push(newMovement);
      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      return newMovement;
    }

    case 'get_inventory_level': {
      const { unit_id, unitId, warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetUnitId = String(unit_id || unitId || '').trim();
      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, targetUnitId);
      const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      const targetWhId = (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') ? String(rawWhId).trim() : null;

      const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (tWhs.length === 0) {
        return {
          unit_id: targetUnitId,
          warehouse_id: targetWhId,
          current_quantity: 0,
          product_name: product.name,
          variant_name: variant.name,
          sku: variant.sku || null,
          unit_name: unit.unit_name
        };
      }

      let movements = mockInventoryMovements.filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === targetUnitId);
      if (targetWhId) {
        movements = movements.filter(m => m.warehouse_id === targetWhId);
      }
      const current_quantity = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
      return {
        unit_id: targetUnitId,
        warehouse_id: targetWhId,
        current_quantity,
        product_name: product.name,
        variant_name: variant.name,
        sku: variant.sku || null,
        unit_name: unit.unit_name
      };
    }

    case 'list_inventory_levels': {
      const { warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (tWhs.length === 0) {
        return [];
      }
      const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      const targetWhId = (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') ? String(rawWhId).trim() : null;

      const tenantProducts = mockProducts.filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      const prodIds = new Set(tenantProducts.map(p => p.id));
      const tenantVariants = mockProductVariants.filter(v => prodIds.has(v.product_id));
      const varIds = new Set(tenantVariants.map(v => v.id));
      const tenantUnits = mockProductUnits.filter(u => varIds.has(u.variant_id));

      const levels = tenantUnits.map(unit => {
        const variant = tenantVariants.find(v => v.id === unit.variant_id);
        const product = tenantProducts.find(p => p.id === variant.product_id);
        let movements = mockInventoryMovements.filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === unit.id);
        if (targetWhId) {
          movements = movements.filter(m => m.warehouse_id === targetWhId);
        }
        const current_quantity = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
        return {
          unit_id: unit.id,
          warehouse_id: targetWhId,
          current_quantity,
          product_name: product ? product.name : null,
          variant_name: variant ? variant.name : null,
          sku: variant ? variant.sku : null,
          unit_name: unit.unit_name
        };
      });
      return levels.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
    }

    case 'list_inventory_movements': {
      const { unit_id, unitId, warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const tWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (tWhs.length === 0) {
        return [];
      }
      const targetUnitId = String(unit_id || unitId || '').trim();
      const rawWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      const targetWhId = (rawWhId !== undefined && rawWhId !== null && String(rawWhId).trim() !== '') ? String(rawWhId).trim() : null;

      let list = mockInventoryMovements.filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (targetUnitId) {
        list = list.filter(m => m.unit_id === targetUnitId);
      }
      if (targetWhId) {
        list = list.filter(m => m.warehouse_id === targetWhId);
      }
      return list.sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || (a.id > b.id ? 1 : -1));
    }

    case 'create_warehouse': {
      const { code, name } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const trimmedCode = String(code || '').trim();
      if (!trimmedCode) {
        throw new Error('倉別代碼不可空白');
      }
      const trimmedName = String(name || '').trim();
      if (!trimmedName) {
        throw new Error('倉別名稱不可空白');
      }
      const dup = mockWarehouses.some(
        w => (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.code.toLowerCase() === trimmedCode.toLowerCase()
      );
      if (dup) {
        throw new Error('倉別代碼已存在');
      }
      const tenantWhs = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      const is_default = tenantWhs.length === 0;
      const newWh = {
        id: nextMockUid('wh'),
        tenant_id: targetTenantId,
        code: trimmedCode,
        name: trimmedName,
        is_default,
        is_active: true,
        created_at: Math.floor(Date.now() / 1000)
      };
      mockWarehouses.push(newWh);
      saveStorage('agent_erp_mock_warehouses', mockWarehouses);
      return newWh;
    }

    case 'update_warehouse': {
      const { id, code, name } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const trimmedId = String(id || '').trim();
      const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!wh) {
        throw new Error('找不到倉別或不屬於目前租戶');
      }
      const trimmedCode = String(code || '').trim();
      if (!trimmedCode) {
        throw new Error('倉別代碼不可空白');
      }
      const trimmedName = String(name || '').trim();
      if (!trimmedName) {
        throw new Error('倉別名稱不可空白');
      }
      const dup = mockWarehouses.some(
        w => (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.id !== trimmedId && w.code.toLowerCase() === trimmedCode.toLowerCase()
      );
      if (dup) {
        throw new Error('倉別代碼已存在');
      }
      wh.code = trimmedCode;
      wh.name = trimmedName;
      saveStorage('agent_erp_mock_warehouses', mockWarehouses);
      return wh;
    }

    case 'set_default_warehouse': {
      const { id } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const trimmedId = String(id || '').trim();
      const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!wh) {
        throw new Error('找不到倉別或不屬於目前租戶');
      }
      if (!wh.is_active) {
        throw new Error('停用中的倉別不可設為預設');
      }
      for (const w of mockWarehouses) {
        if ((w.tenant_id || 'tnt_mock_1') === targetTenantId) {
          w.is_default = (w.id === trimmedId);
        }
      }
      saveStorage('agent_erp_mock_warehouses', mockWarehouses);
      return wh;
    }

    case 'deactivate_warehouse': {
      const { id } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const trimmedId = String(id || '').trim();
      const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!wh) {
        throw new Error('找不到倉別或不屬於目前租戶');
      }
      if (wh.is_default) {
        throw new Error('預設倉不可停用');
      }
      // Check stock
      const stockByUnit = {};
      for (const m of mockInventoryMovements) {
        if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === trimmedId) {
          stockByUnit[m.unit_id] = (stockByUnit[m.unit_id] || 0) + m.quantity_delta;
        }
      }
      for (const qty of Object.values(stockByUnit)) {
        if (Math.abs(qty) > 1e-6) {
          throw new Error('此倉仍有庫存，請先調撥或調整歸零');
        }
      }
      // Check pending POs
      const pendingPo = mockPurchaseOrders.find(
        po => (po.tenant_id || 'tnt_mock_1') === targetTenantId && po.warehouse_id === trimmedId && (po.status === 'draft' || po.status === 'ordered')
      );
      if (pendingPo) {
        throw new Error(`此倉仍被未結案單據引用：${pendingPo.po_number}`);
      }
      // Check pending ADJs (W-03 Extension)
      const pendingAdj = mockInventoryAdjustments.find(
        adj => (adj.tenant_id || 'tnt_mock_1') === targetTenantId && adj.warehouse_id === trimmedId && adj.status === 'draft'
      );
      if (pendingAdj) {
        throw new Error(`此倉仍被未結案單據引用：${pendingAdj.adjustment_number}`);
      }
      // Check pending STKs (W-03 Extension)
      const pendingStk = mockStocktakes.find(
        stk => (stk.tenant_id || 'tnt_mock_1') === targetTenantId && stk.warehouse_id === trimmedId && (stk.status === 'draft' || stk.status === 'counting')
      );
      if (pendingStk) {
        throw new Error(`此倉仍被未結案單據引用：${pendingStk.stocktake_number}`);
      }
      // Check pending TRFs (W-03 Extension)
      const pendingTrf = mockStockTransfers.find(
        trf => (trf.tenant_id || 'tnt_mock_1') === targetTenantId && (trf.from_warehouse_id === trimmedId || trf.to_warehouse_id === trimmedId) && trf.status === 'draft'
      );
      if (pendingTrf) {
        throw new Error(`此倉仍被未結案單據引用：${pendingTrf.transfer_number}`);
      }
      wh.is_active = false;
      saveStorage('agent_erp_mock_warehouses', mockWarehouses);
      return wh;
    }

    case 'reactivate_warehouse': {
      const { id } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const trimmedId = String(id || '').trim();
      const wh = mockWarehouses.find(w => w.id === trimmedId && (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!wh) {
        throw new Error('找不到倉別或不屬於目前租戶');
      }
      wh.is_active = true;
      saveStorage('agent_erp_mock_warehouses', mockWarehouses);
      return wh;
    }

    case 'list_warehouses': {
      const { include_inactive, includeInactive } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const incInactive = include_inactive !== undefined ? include_inactive : includeInactive;
      let list = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!incInactive) {
        list = list.filter(w => w.is_active);
      }
      return list.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || a.created_at - b.created_at);
    }

    case 'create_inventory_adjustment': {
      const {
        warehouse_id, warehouseId,
        reason_code, reasonCode,
        note,
        task_id, taskId,
        initial_lines, initialLines
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = mockSessions && mockSessions.user_id ? mockSessions.user_id : 'usr_mock_admin';
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetWhId = String(warehouse_id || warehouseId || '').trim();
      const wh = validateMockWarehouseActive(targetTenantId, targetWhId);

      const rCode = String(reason_code || reasonCode || '').trim();
      validateMockAdjReasonAndNote(rCode, note);

      const now = Math.floor(Date.now() / 1000);
      const adjId = nextMockUid('adj');
      const adjNumber = nextMockAdjNumber(targetTenantId);

      const items = initial_lines || initialLines || [];
      const seenUnits = new Set();
      const createdLines = [];

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const uId = String(item.unit_id || item.unitId || '').trim();
        if (!uId) {
          throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
        }
        const delta = Number(item.quantity_delta !== undefined ? item.quantity_delta : item.quantityDelta);
        if (isNaN(delta) || Math.abs(delta) < 1e-9) {
          throw new Error('調整數量不可為 0');
        }
        if (seenUnits.has(uId)) {
          throw new Error('同一調整單內商品單位不可重複，請修改既有明細');
        }
        seenUnits.add(uId);

        const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
        const lineId = nextMockUid('adjl');
        const newLine = {
          id: lineId,
          adjustment_id: adjId,
          line_no: idx + 1,
          unit_id: uId,
          quantity_delta: delta,
          product_name_snapshot: product.name,
          variant_name_snapshot: variant.name,
          sku_snapshot: variant.sku || null,
          unit_name_snapshot: unit.unit_name,
          created_at: now
        };
        createdLines.push(newLine);
      }

      const newAdj = {
        id: adjId,
        tenant_id: targetTenantId,
        adjustment_number: adjNumber,
        warehouse_id: wh.id,
        reason_code: rCode,
        status: 'draft',
        note: note ? String(note).trim() : null,
        created_by: activeUid,
        created_at: now,
        posted_at: null,
        cancelled_at: null,
        task_id: task_id || taskId || null
      };

      mockInventoryAdjustments.push(newAdj);
      if (createdLines.length > 0) {
        mockInventoryAdjustmentLines.push(...createdLines);
      }
      saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
      saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
      return formatMockInventoryAdjustmentDetail(newAdj);
    }

    case 'update_inventory_adjustment_header': {
      const {
        adjustment_id, adjustmentId,
        warehouse_id, warehouseId,
        reason_code, reasonCode,
        note
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
      const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到調整單或不屬於目前租戶');
      }
      if (adj.status !== 'draft') {
        throw new Error(`調整單狀態為 ${adj.status}，不允許修改表頭`);
      }

      const rawWh = warehouse_id !== undefined ? warehouse_id : warehouseId;
      const targetWhId = rawWh !== undefined ? String(rawWh || '').trim() : adj.warehouse_id;
      validateMockWarehouseActive(targetTenantId, targetWhId);

      const rawReason = reason_code !== undefined ? reason_code : reasonCode;
      const targetReason = rawReason !== undefined ? String(rawReason || '').trim() : adj.reason_code;
      const targetNote = note !== undefined ? (note ? String(note).trim() : null) : adj.note;

      validateMockAdjReasonAndNote(targetReason, targetNote);

      if (rawWh !== undefined) {
        adj.warehouse_id = targetWhId;
      }
      if (rawReason !== undefined) {
        adj.reason_code = targetReason;
      }
      if (note !== undefined) {
        adj.note = targetNote;
      }

      saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'add_inventory_adjustment_line': {
      const {
        adjustment_id, adjustmentId,
        unit_id, unitId,
        quantity_delta, quantityDelta
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
      const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到調整單或不屬於目前租戶');
      }
      if (adj.status !== 'draft') {
        throw new Error(`調整單狀態為 ${adj.status}，僅草稿狀態可新增明細`);
      }

      const uId = String(unit_id || unitId || '').trim();
      if (!uId) {
        throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
      }
      const delta = Number(quantity_delta !== undefined ? quantity_delta : quantityDelta);
      if (isNaN(delta) || Math.abs(delta) < 1e-9) {
        throw new Error('調整數量不可為 0');
      }

      const dup = mockInventoryAdjustmentLines.find(l => l.adjustment_id === adj.id && l.unit_id === uId);
      if (dup) {
        throw new Error('同一調整單內商品單位不可重複，請修改既有明細');
      }

      const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);

      const maxLineNo = mockInventoryAdjustmentLines
        .filter(l => l.adjustment_id === adj.id)
        .reduce((max, l) => Math.max(max, l.line_no || 0), 0);

      const now = Math.floor(Date.now() / 1000);
      const newLine = {
        id: nextMockUid('adjl'),
        adjustment_id: adj.id,
        line_no: maxLineNo + 1,
        unit_id: uId,
        quantity_delta: delta,
        product_name_snapshot: product.name,
        variant_name_snapshot: variant.name,
        sku_snapshot: variant.sku || null,
        unit_name_snapshot: unit.unit_name,
        created_at: now
      };

      mockInventoryAdjustmentLines.push(newLine);
      saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'update_inventory_adjustment_line': {
      const {
        line_id, lineId,
        quantity_delta, quantityDelta
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetLineId = String(line_id || lineId || '').trim();
      const line = mockInventoryAdjustmentLines.find(l => l.id === targetLineId);
      if (!line) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      const adj = mockInventoryAdjustments.find(a => a.id === line.adjustment_id && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      if (adj.status !== 'draft') {
        throw new Error(`調整單狀態為 ${adj.status}，僅草稿狀態可修改明細`);
      }

      const delta = Number(quantity_delta !== undefined ? quantity_delta : quantityDelta);
      if (isNaN(delta) || Math.abs(delta) < 1e-9) {
        throw new Error('調整數量不可為 0');
      }

      line.quantity_delta = delta;
      saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'remove_inventory_adjustment_line': {
      const { line_id, lineId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetLineId = String(line_id || lineId || '').trim();
      const lineIndex = mockInventoryAdjustmentLines.findIndex(l => l.id === targetLineId);
      if (lineIndex === -1) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      const line = mockInventoryAdjustmentLines[lineIndex];
      const adj = mockInventoryAdjustments.find(a => a.id === line.adjustment_id && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到明細項目或不屬於目前租戶');
      }
      if (adj.status !== 'draft') {
        throw new Error(`調整單狀態為 ${adj.status}，僅草稿狀態可刪除明細`);
      }

      mockInventoryAdjustmentLines.splice(lineIndex, 1);
      const remaining = mockInventoryAdjustmentLines
        .filter(l => l.adjustment_id === adj.id)
        .sort((a, b) => a.line_no - b.line_no);
      remaining.forEach((l, idx) => {
        l.line_no = idx + 1;
      });
      saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'post_inventory_adjustment': {
      const { adjustment_id, adjustmentId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = mockSessions && mockSessions.user_id ? mockSessions.user_id : 'usr_mock_admin';
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
      const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到調整單或不屬於目前租戶');
      }
      if (adj.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${adj.status} 轉換至 posted`);
      }

      const wh = validateMockWarehouseActive(targetTenantId, adj.warehouse_id);

      const lines = mockInventoryAdjustmentLines.filter(l => l.adjustment_id === adj.id);
      if (lines.length === 0) {
        throw new Error('調整單沒有任何明細');
      }

      for (const line of lines) {
        resolveMockUnitSnapshot(targetTenantId, line.unit_id);
        if (Math.abs(line.quantity_delta) < 1e-9) {
          throw new Error('調整數量不可為 0');
        }
      }

      // Check current quantity and A-09 negative check
      for (const line of lines) {
        const movements = mockInventoryMovements.filter(
          m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === adj.warehouse_id && m.unit_id === line.unit_id
        );
        const currentQty = movements.reduce((sum, m) => sum + m.quantity_delta, 0);
        const newQty = currentQty + line.quantity_delta;
        if (newQty < -1e-6) {
          const curStr = formatMockQty(currentQty);
          const newStr = formatMockQty(newQty);
          throw new Error(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${wh.name}〕現有 ${curStr}，調整後將為 ${newStr}（負數），無法過帳`);
        }
      }

      const now = args?.created_at !== undefined ? args.created_at : Math.floor(Date.now() / 1000);
      adj.status = 'posted';
      adj.posted_at = now;

      for (const line of lines) {
        const imId = nextMockUid('im');
        mockInventoryMovements.push({
          id: imId,
          tenant_id: targetTenantId,
          warehouse_id: adj.warehouse_id,
          unit_id: line.unit_id,
          quantity_delta: line.quantity_delta,
          unit_cost: null,
          reason: 'adjustment',
          reference_type: 'inventory_adjustment',
          reference_id: adj.id,
          created_by: activeUid,
          created_at: now
        });
      }

      saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'cancel_inventory_adjustment': {
      const { adjustment_id, adjustmentId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
      const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到調整單或不屬於目前租戶');
      }
      if (adj.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${adj.status} 轉換至 cancelled`);
      }

      const now = Math.floor(Date.now() / 1000);
      adj.status = 'cancelled';
      adj.cancelled_at = now;

      saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'get_inventory_adjustment': {
      const { adjustment_id, adjustmentId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetAdjId = String(adjustment_id || adjustmentId || '').trim();
      const adj = mockInventoryAdjustments.find(a => a.id === targetAdjId && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!adj) {
        throw new Error('找不到調整單或不屬於目前租戶');
      }
      return formatMockInventoryAdjustmentDetail(adj);
    }

    case 'list_inventory_adjustments': {
      const { status, warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      let list = mockInventoryAdjustments.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (status && String(status).trim()) {
        list = list.filter(a => a.status === String(status).trim());
      }
      if (targetWhId && String(targetWhId).trim()) {
        list = list.filter(a => a.warehouse_id === String(targetWhId).trim());
      }
      return list
        .map(a => {
          const lines = mockInventoryAdjustmentLines.filter(l => l.adjustment_id === a.id);
          return {
            ...a,
            lines_count: lines.length
          };
        })
        .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
    }

    case 'reset_mock_inventory_adjustments': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        const removedAdjIds = new Set(
          mockInventoryAdjustments.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTid).map(a => a.id)
        );
        mockInventoryAdjustments = mockInventoryAdjustments.filter(a => (a.tenant_id || 'tnt_mock_1') !== targetTid);
        mockInventoryAdjustmentLines = mockInventoryAdjustmentLines.filter(l => !removedAdjIds.has(l.adjustment_id));
      } else {
        mockInventoryAdjustments = [];
        mockInventoryAdjustmentLines = [];
      }
      saveStorage('agent_erp_mock_inventory_adjustments', mockInventoryAdjustments);
      saveStorage('agent_erp_mock_inventory_adjustment_lines', mockInventoryAdjustmentLines);
      return true;
    }

    case 'create_stocktake': {
      const {
        warehouse_id, warehouseId,
        note,
        task_id, taskId,
        initial_unit_ids, initialUnitIds
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = mockSessions && mockSessions.user_id ? mockSessions.user_id : 'usr_mock_admin';
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetWhId = String(warehouse_id || warehouseId || '').trim();
      validateMockWarehouseActive(targetTenantId, targetWhId);

      const now = Math.floor(Date.now() / 1000);
      const stkId = nextMockUid('stk');
      const stkNumber = nextMockStkNumber(targetTenantId);

      const unitList = initial_unit_ids || initialUnitIds || [];
      const seenUnits = new Set();
      const createdLines = [];

      for (let idx = 0; idx < unitList.length; idx++) {
        const uId = String(unitList[idx] || '').trim();
        if (!uId) {
          throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
        }
        if (seenUnits.has(uId)) {
          throw new Error('此品項已在盤點單中');
        }
        seenUnits.add(uId);

        const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
        const lineId = nextMockUid('stkl');
        const newLine = {
          id: lineId,
          stocktake_id: stkId,
          line_no: idx + 1,
          unit_id: uId,
          product_name_snapshot: product.name,
          variant_name_snapshot: variant.name,
          sku_snapshot: variant.sku || null,
          unit_name_snapshot: unit.name,
          system_quantity: null,
          system_quantity_at: null,
          counted_quantity: null,
          created_at: now
        };
        createdLines.push(newLine);
      }

      const newStk = {
        id: stkId,
        tenant_id: targetTenantId,
        stocktake_number: stkNumber,
        warehouse_id: targetWhId,
        status: 'draft',
        note: note ? String(note).trim() : null,
        created_by: activeUid,
        created_at: now,
        counting_started_at: null,
        posted_at: null,
        cancelled_at: null,
        task_id: task_id || taskId || null
      };

      mockStocktakes.push(newStk);
      for (const line of createdLines) {
        mockStocktakeLines.push(line);
      }

      saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);

      return formatMockStocktakeDetail(newStk);
    }

    case 'update_stocktake_header': {
      const effectiveArgs = (args && args.payload) ? args.payload : (args || {});
      const {
        stocktake_id, stocktakeId,
        warehouse_id, warehouseId,
        note
      } = effectiveArgs;
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'draft') {
        throw new Error(`盤點單狀態為 ${stk.status}，僅草稿狀態可修改表頭`);
      }

      const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      if (targetWhId !== undefined && targetWhId !== null) {
        const trimmedWh = String(targetWhId).trim();
        validateMockWarehouseActive(targetTenantId, trimmedWh);
        stk.warehouse_id = trimmedWh;
      }
      if (note !== undefined) {
        stk.note = note ? String(note).trim() : null;
      }

      saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
      return formatMockStocktakeDetail(stk);
    }

    case 'add_stocktake_lines': {
      const {
        stocktake_id, stocktakeId,
        unit_ids, unitIds
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'draft') {
        throw new Error(`盤點單狀態為 ${stk.status}，僅草稿狀態可新增品項`);
      }

      const existingUnits = new Set(
        mockStocktakeLines.filter(l => l.stocktake_id === targetStkId).map(l => l.unit_id)
      );
      let maxLineNo = mockStocktakeLines
        .filter(l => l.stocktake_id === targetStkId)
        .reduce((max, l) => Math.max(max, l.line_no || 0), 0);

      const unitList = unit_ids || unitIds || [];
      const now = Math.floor(Date.now() / 1000);

      for (const rawUid of unitList) {
        const uId = String(rawUid || '').trim();
        if (!uId) {
          throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
        }
        if (existingUnits.has(uId)) {
          throw new Error('此品項已在盤點單中');
        }
        existingUnits.add(uId);

        const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
        maxLineNo++;
        const lineId = nextMockUid('stkl');
        mockStocktakeLines.push({
          id: lineId,
          stocktake_id: targetStkId,
          line_no: maxLineNo,
          unit_id: uId,
          product_name_snapshot: product.name,
          variant_name_snapshot: variant.name,
          sku_snapshot: variant.sku || null,
          unit_name_snapshot: unit.name,
          system_quantity: null,
          system_quantity_at: null,
          counted_quantity: null,
          created_at: now
        });
      }

      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return formatMockStocktakeDetail(stk);
    }

    case 'add_stocktake_lines_from_stock': {
      const { stocktake_id, stocktakeId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'draft') {
        throw new Error(`盤點單狀態為 ${stk.status}，僅草稿狀態可新增品項`);
      }

      const balances = {};
      for (const m of mockInventoryMovements) {
        if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === stk.warehouse_id) {
          balances[m.unit_id] = (balances[m.unit_id] || 0) + m.quantity_delta;
        }
      }

      const existingUnits = new Set(
        mockStocktakeLines.filter(l => l.stocktake_id === targetStkId).map(l => l.unit_id)
      );
      let maxLineNo = mockStocktakeLines
        .filter(l => l.stocktake_id === targetStkId)
        .reduce((max, l) => Math.max(max, l.line_no || 0), 0);

      const now = Math.floor(Date.now() / 1000);
      for (const [uId, bal] of Object.entries(balances)) {
        if (Math.abs(bal) > 1e-6 && !existingUnits.has(uId)) {
          existingUnits.add(uId);
          const { unit, variant, product } = resolveMockUnitSnapshot(targetTenantId, uId);
          maxLineNo++;
          const lineId = nextMockUid('stkl');
          mockStocktakeLines.push({
            id: lineId,
            stocktake_id: targetStkId,
            line_no: maxLineNo,
            unit_id: uId,
            product_name_snapshot: product.name,
            variant_name_snapshot: variant.name,
            sku_snapshot: variant.sku || null,
            unit_name_snapshot: unit.name,
            system_quantity: null,
            system_quantity_at: null,
            counted_quantity: null,
            created_at: now
          });
        }
      }

      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return formatMockStocktakeDetail(stk);
    }

    case 'remove_stocktake_line': {
      const { line_id, lineId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetLineId = String(line_id || lineId || '').trim();
      const line = mockStocktakeLines.find(l => l.id === targetLineId);
      if (!line) {
        throw new Error('找不到指定的盤點單明細行');
      }
      const stk = mockStocktakes.find(s => s.id === line.stocktake_id && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到指定的盤點單明細行');
      }
      if (stk.status !== 'draft' && stk.status !== 'counting') {
        throw new Error(`盤點單狀態為 ${stk.status}，不可刪除明細`);
      }

      mockStocktakeLines = mockStocktakeLines.filter(l => l.id !== targetLineId);
      const remaining = mockStocktakeLines
        .filter(l => l.stocktake_id === stk.id)
        .sort((a, b) => a.line_no - b.line_no);
      for (let i = 0; i < remaining.length; i++) {
        remaining[i].line_no = i + 1;
      }

      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return formatMockStocktakeDetail(stk);
    }

    case 'start_stocktake_counting': {
      const { stocktake_id, stocktakeId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${stk.status} 轉換至 counting`);
      }

      validateMockWarehouseActive(targetTenantId, stk.warehouse_id);

      const lines = mockStocktakeLines.filter(l => l.stocktake_id === targetStkId);
      if (lines.length === 0) {
        throw new Error('盤點單沒有任何品項');
      }

      // S-05: Check mutual exclusion in the same warehouse
      for (const line of lines) {
        const conflictStk = mockStocktakes.find(s =>
          (s.tenant_id || 'tnt_mock_1') === targetTenantId &&
          s.warehouse_id === stk.warehouse_id &&
          s.status === 'counting' &&
          s.id !== stk.id &&
          mockStocktakeLines.some(otherL => otherL.stocktake_id === s.id && otherL.unit_id === line.unit_id)
        );

        if (conflictStk) {
          throw new Error(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕已在盤點單 ${conflictStk.stocktake_number} 盤點中`);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      stk.status = 'counting';
      stk.counting_started_at = now;

      for (const line of lines) {
        let bal = 0;
        let count = 0;
        for (const m of mockInventoryMovements) {
          if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === stk.warehouse_id && m.unit_id === line.unit_id) {
            bal += m.quantity_delta;
            count += 1;
          }
        }
        line.system_quantity = bal;
        line.system_quantity_at = now;
        line.system_movements_count = count;
        line.counted_quantity = null;
      }

      saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return formatMockStocktakeDetail(stk);
    }

    case 'set_stocktake_counted_quantity': {
      const effectiveArgs = (args && args.payload) ? args.payload : (args || {});
      const { line_id, lineId, counted_quantity, countedQuantity } = effectiveArgs;
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetLineId = String(line_id || lineId || '').trim();
      const line = mockStocktakeLines.find(l => l.id === targetLineId);
      if (!line) {
        throw new Error('找不到指定的盤點單明細行');
      }
      const stk = mockStocktakes.find(s => s.id === line.stocktake_id && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到指定的盤點單明細行');
      }
      if (stk.status !== 'counting') {
        throw new Error('只有盤點中 (counting) 狀態可輸入實盤量');
      }

      const hasQty = counted_quantity !== undefined || countedQuantity !== undefined;
      if (hasQty) {
        const rawQty = counted_quantity !== undefined ? counted_quantity : countedQuantity;
        if (rawQty === '' || rawQty === null) {
          line.counted_quantity = null;
        } else {
          const qty = Number(rawQty);
          if (isNaN(qty) || qty < 0) {
            throw new Error('實盤量不可為負');
          }
          line.counted_quantity = qty;
        }
        saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      }
      return {
        ...line
      };
    }

    case 'refresh_stocktake_system_quantity': {
      const { stocktake_id, stocktakeId, line_ids, lineIds } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'counting') {
        throw new Error('只有 counting 狀態可以重新取得系統量');
      }

      const targetLineIds = line_ids || lineIds || [];
      const now = Math.floor(Date.now() / 1000);

      for (const lid of targetLineIds) {
        const line = mockStocktakeLines.find(l => l.id === lid && l.stocktake_id === targetStkId);
        if (!line) {
          throw new Error('找不到指定的盤點單明細行');
        }

        let bal = 0;
        let count = 0;
        for (const m of mockInventoryMovements) {
          if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === stk.warehouse_id && m.unit_id === line.unit_id) {
            bal += m.quantity_delta;
            count += 1;
          }
        }
        line.system_quantity = bal;
        line.system_quantity_at = now;
        line.system_movements_count = count;
        line.counted_quantity = null; // S-08: clear counted quantity
      }

      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return formatMockStocktakeDetail(stk);
    }

    case 'post_stocktake': {
      const { stocktake_id, stocktakeId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = mockSessions && mockSessions.user_id ? mockSessions.user_id : 'usr_mock_admin';
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'counting') {
        throw new Error(`無效的狀態轉換：不可從 ${stk.status} 轉換至 posted`);
      }

      validateMockWarehouseActive(targetTenantId, stk.warehouse_id);

      const lines = mockStocktakeLines.filter(l => l.stocktake_id === targetStkId);
      if (lines.length === 0) {
        throw new Error('盤點單沒有任何品項');
      }

      const missingCount = lines.filter(l => !isStocktakeLineCounted(l.counted_quantity)).length;
      if (missingCount > 0) {
        throw new Error(`尚有 ${missingCount} 項未輸入實盤量`);
      }

      // S-07: check movement count mismatch
      const affectedItems = [];
      const affectedLineIds = [];
      for (const line of lines) {
        const snapCount = line.system_movements_count ?? 0;
        let currentCount = 0;
        for (const m of mockInventoryMovements) {
          if ((m.tenant_id || 'tnt_mock_1') === targetTenantId &&
              m.warehouse_id === stk.warehouse_id &&
              m.unit_id === line.unit_id) {
            currentCount += 1;
          }
        }
        if (currentCount !== snapCount) {
          affectedItems.push(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕`);
          affectedLineIds.push(line.id);
        }
      }

      if (affectedItems.length > 0) {
        const err = new Error(`以下品項在盤點期間有異動：${affectedItems.join('、')}，請重新取得系統量並重新確認實盤`);
        err.code = 'MOVEMENTS_DETECTED_DURING_COUNTING';
        err.affected_line_ids = affectedLineIds;
        err.affectedLineIds = affectedLineIds;
        throw err;
      }

      const now = Math.floor(Date.now() / 1000);
      stk.status = 'posted';
      stk.posted_at = now;

      for (const line of lines) {
        const delta = (line.counted_quantity || 0) - (line.system_quantity || 0);
        if (Math.abs(delta) > 1e-6) {
          const imId = nextMockUid('im');
          mockInventoryMovements.push({
            id: imId,
            tenant_id: targetTenantId,
            unit_id: line.unit_id,
            warehouse_id: stk.warehouse_id,
            quantity_delta: delta,
            unit_cost: null,
            reason: 'stocktake',
            reference_type: 'stocktake',
            reference_id: stk.id,
            created_by: activeUid,
            created_at: now
          });
        }
      }

      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
      return formatMockStocktakeDetail(stk);
    }

    case 'cancel_stocktake': {
      const { stocktake_id, stocktakeId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      if (stk.status !== 'draft' && stk.status !== 'counting') {
        throw new Error(`無效的狀態轉換：不可從 ${stk.status} 轉換至 cancelled`);
      }

      const now = Math.floor(Date.now() / 1000);
      stk.status = 'cancelled';
      stk.cancelled_at = now;

      saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
      return formatMockStocktakeDetail(stk);
    }

    case 'get_stocktake': {
      const { stocktake_id, stocktakeId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetStkId = String(stocktake_id || stocktakeId || '').trim();
      const stk = mockStocktakes.find(s => s.id === targetStkId && (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!stk) {
        throw new Error('找不到盤點單或不屬於目前租戶');
      }
      return formatMockStocktakeDetail(stk);
    }

    case 'list_stocktakes': {
      const { status, warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      let list = mockStocktakes.filter(s => (s.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (status && String(status).trim()) {
        list = list.filter(s => s.status === String(status).trim());
      }
      if (targetWhId && String(targetWhId).trim()) {
        list = list.filter(s => s.warehouse_id === String(targetWhId).trim());
      }
      return list.map(s => {
        const lines = mockStocktakeLines.filter(l => l.stocktake_id === s.id);
        const counted = lines.filter(l => isStocktakeLineCounted(l.counted_quantity)).length;
        return {
          ...s,
          lines_count: lines.length,
          counted_count: counted
        };
      }).sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
    }

    case 'reset_mock_stocktakes': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        const removedStkIds = new Set(
          mockStocktakes.filter(s => (s.tenant_id || 'tnt_mock_1') === targetTid).map(s => s.id)
        );
        mockStocktakes = mockStocktakes.filter(s => (s.tenant_id || 'tnt_mock_1') !== targetTid);
        mockStocktakeLines = mockStocktakeLines.filter(l => !removedStkIds.has(l.stocktake_id));
      } else {
        mockStocktakes = [];
        mockStocktakeLines = [];
      }
      saveStorage('agent_erp_mock_stocktakes', mockStocktakes);
      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return true;
    }

    case 'set_mock_stocktake_line_snap_at': {
      const { line_id, lineId, system_quantity_at, systemQuantityAt } = args || {};
      const targetLid = line_id || lineId;
      const targetSnap = system_quantity_at !== undefined ? system_quantity_at : systemQuantityAt;
      const l = mockStocktakeLines.find(x => x.id === targetLid);
      if (l) {
        l.system_quantity_at = targetSnap;
      }
      saveStorage('agent_erp_mock_stocktake_lines', mockStocktakeLines);
      return true;
    }

    case 'create_stock_transfer': {
      const {
        from_warehouse_id, fromWarehouseId,
        to_warehouse_id, toWarehouseId,
        note,
        task_id, taskId,
        initial_lines, initialLines
      } = args || {};

      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = resolveMockActiveUserId();
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const rawFromWh = String(from_warehouse_id !== undefined ? from_warehouse_id : (fromWarehouseId || '')).trim();
      const rawToWh = String(to_warehouse_id !== undefined ? to_warehouse_id : (toWarehouseId || '')).trim();

      if (!rawFromWh || !rawToWh) {
        throw new Error('找不到倉別或倉別已停用');
      }
      if (rawFromWh === rawToWh) {
        throw new Error('來源倉與目的倉不可相同');
      }

      const fromWh = validateMockWarehouseActive(targetTenantId, rawFromWh);
      const toWh = validateMockWarehouseActive(targetTenantId, rawToWh);

      const rawLines = initial_lines !== undefined ? initial_lines : initialLines;
      const createdLines = [];
      const now = Math.floor(Date.now() / 1000);
      const trfId = nextMockUid('trf');
      const trfNumber = nextMockTrfNumber(targetTenantId);

      if (rawLines && Array.isArray(rawLines)) {
        const seenUnits = new Set();
        for (let i = 0; i < rawLines.length; i++) {
          const l = rawLines[i];
          const uid = String(l.unit_id || l.unitId || '').trim();
          if (!uid) {
            throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
          }
          if (seenUnits.has(uid)) {
            throw new Error('同一調撥單內商品單位不可重複');
          }
          seenUnits.add(uid);

          const qty = Number(l.quantity);
          if (isNaN(qty) || qty <= 0) {
            throw new Error('調撥數量必須大於 0');
          }

          const snap = resolveMockUnitSnapshot(targetTenantId, uid);
          createdLines.push({
            id: nextMockUid('trfl'),
            transfer_id: trfId,
            line_no: i + 1,
            unit_id: uid,
            quantity: qty,
            product_name_snapshot: snap.product_name,
            variant_name_snapshot: snap.variant_name,
            sku_snapshot: snap.sku,
            unit_name_snapshot: snap.unit_name,
            created_at: now
          });
        }
      }

      const newTrf = {
        id: trfId,
        tenant_id: targetTenantId,
        transfer_number: trfNumber,
        from_warehouse_id: fromWh.id,
        to_warehouse_id: toWh.id,
        status: 'draft',
        note: note ? String(note).trim() : null,
        created_by: activeUid,
        created_at: now,
        posted_at: null,
        cancelled_at: null,
        task_id: task_id || taskId || null
      };

      mockStockTransfers.push(newTrf);
      if (createdLines.length > 0) {
        mockStockTransferLines.push(...createdLines);
      }
      saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
      saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
      return formatMockStockTransferDetail(newTrf);
    }

    case 'update_stock_transfer_header': {
      const {
        transfer_id, transferId,
        from_warehouse_id, fromWarehouseId,
        to_warehouse_id, toWarehouseId,
        note
      } = args || {};

      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetTrfId = String(transfer_id || transferId || '').trim();
      const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      if (trf.status !== 'draft') {
        throw new Error(`調撥單狀態為 ${trf.status}，不允許修改表頭`);
      }

      const rawFromWh = from_warehouse_id !== undefined ? from_warehouse_id : fromWarehouseId;
      const targetFromWhId = rawFromWh !== undefined && rawFromWh !== null ? String(rawFromWh).trim() : trf.from_warehouse_id;

      const rawToWh = to_warehouse_id !== undefined ? to_warehouse_id : toWarehouseId;
      const targetToWhId = rawToWh !== undefined && rawToWh !== null ? String(rawToWh).trim() : trf.to_warehouse_id;

      if (!targetFromWhId || !targetToWhId) {
        throw new Error('找不到倉別或倉別已停用');
      }
      if (targetFromWhId === targetToWhId) {
        throw new Error('來源倉與目的倉不可相同');
      }

      const fromWh = validateMockWarehouseActive(targetTenantId, targetFromWhId);
      const toWh = validateMockWarehouseActive(targetTenantId, targetToWhId);

      trf.from_warehouse_id = fromWh.id;
      trf.to_warehouse_id = toWh.id;

      if (note !== undefined) {
        trf.note = note ? String(note).trim() : null;
      }

      saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
      return formatMockStockTransferDetail(trf);
    }

    case 'add_stock_transfer_line': {
      const {
        transfer_id, transferId,
        unit_id, unitId,
        quantity
      } = args || {};

      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetTrfId = String(transfer_id || transferId || '').trim();
      const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      if (trf.status !== 'draft') {
        throw new Error(`調撥單狀態為 ${trf.status}，僅草稿狀態可新增明細`);
      }

      const targetUnitId = String(unit_id || unitId || '').trim();
      if (!targetUnitId) {
        throw new Error('找不到指定的商品單位 (unit_id) 或不屬於目前租戶');
      }

      const qty = Number(quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('調撥數量必須大於 0');
      }

      const isDup = mockStockTransferLines.some(l => l.transfer_id === targetTrfId && l.unit_id === targetUnitId);
      if (isDup) {
        throw new Error('同一調撥單內商品單位不可重複');
      }

      const snap = resolveMockUnitSnapshot(targetTenantId, targetUnitId);
      const existingLines = mockStockTransferLines.filter(l => l.transfer_id === targetTrfId);
      const maxLineNo = existingLines.reduce((max, l) => Math.max(max, l.line_no || 0), 0);

      const now = Math.floor(Date.now() / 1000);
      const newLine = {
        id: nextMockUid('trfl'),
        transfer_id: targetTrfId,
        line_no: maxLineNo + 1,
        unit_id: targetUnitId,
        quantity: qty,
        product_name_snapshot: snap.product_name,
        variant_name_snapshot: snap.variant_name,
        sku_snapshot: snap.sku,
        unit_name_snapshot: snap.unit_name,
        created_at: now
      };

      mockStockTransferLines.push(newLine);
      saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
      return formatMockStockTransferDetail(trf);
    }

    case 'update_stock_transfer_line': {
      const { line_id, lineId, quantity } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetLid = String(line_id || lineId || '').trim();
      const line = mockStockTransferLines.find(l => l.id === targetLid);
      if (!line) {
        throw new Error('找不到指定的調撥單明細行');
      }
      const trf = mockStockTransfers.find(t => t.id === line.transfer_id && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      if (trf.status !== 'draft') {
        throw new Error(`調撥單狀態為 ${trf.status}，僅草稿狀態可修改明細`);
      }

      const qty = Number(quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('調撥數量必須大於 0');
      }

      line.quantity = qty;
      saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
      return formatMockStockTransferDetail(trf);
    }

    case 'remove_stock_transfer_line': {
      const { line_id, lineId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetLid = String(line_id || lineId || '').trim();
      const line = mockStockTransferLines.find(l => l.id === targetLid);
      if (!line) {
        throw new Error('找不到指定的調撥單明細行');
      }
      const trf = mockStockTransfers.find(t => t.id === line.transfer_id && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      if (trf.status !== 'draft') {
        throw new Error(`調撥單狀態為 ${trf.status}，僅草稿狀態可刪除明細`);
      }

      mockStockTransferLines = mockStockTransferLines.filter(l => l.id !== targetLid);
      const remaining = mockStockTransferLines.filter(l => l.transfer_id === trf.id).sort((a, b) => a.line_no - b.line_no);
      remaining.forEach((l, idx) => {
        l.line_no = idx + 1;
      });

      saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
      return formatMockStockTransferDetail(trf);
    }

    case 'post_stock_transfer': {
      const { transfer_id, transferId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = resolveMockActiveUserId();
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetTrfId = String(transfer_id || transferId || '').trim();
      const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      if (trf.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${trf.status} 轉換至 posted`);
      }

      if (trf.from_warehouse_id === trf.to_warehouse_id) {
        throw new Error('來源倉與目的倉不可相同');
      }

      const fromWh = validateMockWarehouseActive(targetTenantId, trf.from_warehouse_id);
      const toWh = validateMockWarehouseActive(targetTenantId, trf.to_warehouse_id);

      const lines = mockStockTransferLines.filter(l => l.transfer_id === trf.id);
      if (lines.length === 0) {
        throw new Error('調撥單沒有任何明細');
      }

      // Check current stock in from_warehouse_id for each line
      for (const line of lines) {
        let currentStock = 0;
        for (const m of mockInventoryMovements) {
          if ((m.tenant_id || 'tnt_mock_1') === targetTenantId && m.unit_id === line.unit_id && m.warehouse_id === trf.from_warehouse_id) {
            currentStock += Number(m.quantity_delta || 0);
          }
        }
        if (currentStock + 1e-9 < line.quantity) {
          throw new Error(`〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${fromWh.name}〕現有 ${currentStock}，不足調撥 ${line.quantity}`);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      trf.status = 'posted';
      trf.posted_at = now;

      // Write two inventory movements per line
      for (const line of lines) {
        mockInventoryMovements.push({
          id: nextMockUid('mov'),
          tenant_id: targetTenantId,
          unit_id: line.unit_id,
          warehouse_id: trf.from_warehouse_id,
          quantity_delta: -line.quantity,
          unit_cost: null,
          reason: 'transfer_out',
          reference_type: 'stock_transfer',
          reference_id: trf.id,
          created_by: activeUid,
          created_at: now
        });
        mockInventoryMovements.push({
          id: nextMockUid('mov'),
          tenant_id: targetTenantId,
          unit_id: line.unit_id,
          warehouse_id: trf.to_warehouse_id,
          quantity_delta: line.quantity,
          unit_cost: null,
          reason: 'transfer_in',
          reference_type: 'stock_transfer',
          reference_id: trf.id,
          created_by: activeUid,
          created_at: now
        });
      }

      saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      return formatMockStockTransferDetail(trf);
    }

    case 'cancel_stock_transfer': {
      const { transfer_id, transferId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = resolveMockActiveUserId();
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetTrfId = String(transfer_id || transferId || '').trim();
      const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      if (trf.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${trf.status} 轉換至 cancelled`);
      }

      const now = Math.floor(Date.now() / 1000);
      trf.status = 'cancelled';
      trf.cancelled_at = now;

      saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
      return formatMockStockTransferDetail(trf);
    }

    case 'get_stock_transfer': {
      const { transfer_id, transferId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetTrfId = String(transfer_id || transferId || '').trim();
      const trf = mockStockTransfers.find(t => t.id === targetTrfId && (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!trf) {
        throw new Error('找不到調撥單或不屬於目前租戶');
      }
      return formatMockStockTransferDetail(trf);
    }

    case 'list_stock_transfers': {
      const { status, from_warehouse_id, fromWarehouseId, to_warehouse_id, toWarehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetFromWhId = from_warehouse_id !== undefined ? from_warehouse_id : fromWarehouseId;
      const targetToWhId = to_warehouse_id !== undefined ? to_warehouse_id : toWarehouseId;

      let list = mockStockTransfers.filter(t => (t.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (status && String(status).trim()) {
        list = list.filter(t => t.status === String(status).trim());
      }
      if (targetFromWhId && String(targetFromWhId).trim()) {
        list = list.filter(t => t.from_warehouse_id === String(targetFromWhId).trim());
      }
      if (targetToWhId && String(targetToWhId).trim()) {
        list = list.filter(t => t.to_warehouse_id === String(targetToWhId).trim());
      }

      return list
        .map(t => {
          const lines = mockStockTransferLines.filter(l => l.transfer_id === t.id);
          return {
            ...t,
            lines_count: lines.length
          };
        })
        .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
    }

    case 'get_account_payable': {
      const { id, ap_id, apId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetId = id || ap_id || apId;
      if (!targetId || !String(targetId).trim()) {
        throw new Error('缺少應付帳款 ID (id 或 ap_id)');
      }
      const ap = mockAccountsPayable.find(a => a.id === String(targetId).trim() && (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!ap) {
        throw new Error('找不到指定的應付帳款或不屬於目前租戶');
      }
      return formatMockAccountPayable(ap).detail;
    }

    case 'list_accounts_payable': {
      const { vendor_partner_id, vendorPartnerId, settlement_status, settlementStatus, status, due_date_from, dueDateFrom, due_date_to, dueDateTo } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      let list = mockAccountsPayable.filter(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId);
      const vp = vendor_partner_id || vendorPartnerId;
      if (vp && String(vp).trim()) {
        list = list.filter(a => a.vendor_partner_id === String(vp).trim());
      }
      const st = status;
      if (st && String(st).trim()) {
        list = list.filter(a => a.status === String(st).trim());
      }
      const from = due_date_from || dueDateFrom;
      if (from && String(from).trim()) {
        list = list.filter(a => a.due_date >= String(from).trim());
      }
      const to = due_date_to || dueDateTo;
      if (to && String(to).trim()) {
        list = list.filter(a => a.due_date <= String(to).trim());
      }

      const items = list
        .sort((a, b) => (b.document_date || '').localeCompare(a.document_date || '') || b.created_at - a.created_at)
        .map(a => formatMockAccountPayable(a).item);

      const ss = settlement_status || settlementStatus;
      if (ss && String(ss).trim()) {
        const norm = String(ss).trim().toLowerCase();
        let targetNorm = norm;
        if (norm === '未付') targetNorm = 'unpaid';
        else if (norm === '部分付款' || norm === 'partial') targetNorm = 'partially_paid';
        else if (norm === '已付清') targetNorm = 'paid';
        return items.filter(item => item.settlement_status === targetNorm);
      }
      return items;
    }

    case 'create_vendor_bill': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetUserId = resolveMockActiveUserId();
      if (!targetTenantId || !String(targetTenantId).trim()) {
        throw new Error('租戶 ID 不可為空');
      }
      const vendorId = payload.vendor_partner_id || payload.vendorPartnerId;
      if (!vendorId || !String(vendorId).trim()) {
        throw new Error('供應商 ID 不可為空');
      }
      const invoiceNo = payload.vendor_invoice_number || payload.vendorInvoiceNumber;
      if (!invoiceNo || !String(invoiceNo).trim()) {
        throw new Error('供應商發票號碼不可為空');
      }
      const trimmedInvoice = String(invoiceNo).trim();
      const untaxed = Number(payload.untaxed_amount !== undefined ? payload.untaxed_amount : payload.untaxedAmount);
      if (isNaN(untaxed) || untaxed <= 0) {
        throw new Error('未稅金額必須大於 0');
      }
      const tax = Number(payload.tax_amount !== undefined ? payload.tax_amount : payload.taxAmount);
      if (isNaN(tax) || tax < 0) {
        throw new Error('進項稅額不可小於 0');
      }
      const billDate = String(payload.bill_date || payload.billDate || '').trim();
      if (!billDate) {
        throw new Error('無效的日期格式');
      }
      const today = new Date().toISOString().split('T')[0];
      if (billDate > today) {
        throw new Error('請款日不可晚於今天');
      }

      const vendor = mockPartners.find(p => p.id === String(vendorId).trim() && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!vendor) {
        throw new Error('找不到指定的供應商');
      }
      if (!vendor.is_vendor) {
        throw new Error('指定的合作夥伴不是供應商');
      }

      let dueDate = payload.due_date || payload.dueDate;
      if (dueDate && String(dueDate).trim()) {
        dueDate = String(dueDate).trim();
      } else {
        dueDate = calculateDueDate(billDate, vendor.payment_terms_type, vendor.payment_terms_days);
      }
      if (dueDate < billDate) {
        throw new Error('到期日不可早於請款日');
      }

      const dup = mockVendorBills.find(b =>
        (b.tenant_id || 'tnt_mock_1') === targetTenantId &&
        b.vendor_partner_id === vendor.id &&
        b.vendor_invoice_number.trim().toLowerCase() === trimmedInvoice.toLowerCase() &&
        b.status !== 'cancelled' && b.status !== 'voided'
      );
      if (dup) {
        throw new Error(`此供應商的發票號碼 ${trimmedInvoice} 已登錄於 ${dup.bill_number}`);
      }

      const now = Math.floor(Date.now() / 1000);
      const newBill = {
        id: nextMockUid('bill'),
        tenant_id: targetTenantId,
        bill_number: nextMockBillNumber(targetTenantId),
        vendor_partner_id: vendor.id,
        vendor_name_snapshot: vendor.name,
        vendor_invoice_number: trimmedInvoice,
        bill_date: billDate,
        due_date: dueDate,
        untaxed_amount: untaxed,
        tax_amount: tax,
        currency: 'TWD',
        status: 'draft',
        basis_amount: null,
        difference_amount: null,
        difference_note: null,
        difference_accepted_by: null,
        difference_accepted_at: null,
        note: payload.note ? String(payload.note).trim() : null,
        created_by: targetUserId,
        created_at: now,
        posted_at: null,
        cancelled_at: null,
        voided_by: null,
        voided_at: null,
        void_reason: null,
        task_id: null
      };

      mockVendorBills.push(newBill);
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(newBill).detail;
    }

    case 'update_vendor_bill_header': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const billId = payload.bill_id || payload.billId;
      if (!billId || !String(billId).trim()) {
        throw new Error('請款單 ID 不可為空');
      }
      const bill = mockVendorBills.find(b => b.id === String(billId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) {
        throw new Error('找不到指定的請款單');
      }
      if (bill.status !== 'draft') {
        throw new Error(`請款單狀態為 ${bill.status}，不可修改`);
      }
      const invoiceNo = payload.vendor_invoice_number || payload.vendorInvoiceNumber;
      if (!invoiceNo || !String(invoiceNo).trim()) {
        throw new Error('供應商發票號碼不可為空');
      }
      const trimmedInvoice = String(invoiceNo).trim();
      const untaxed = Number(payload.untaxed_amount !== undefined ? payload.untaxed_amount : payload.untaxedAmount);
      if (isNaN(untaxed) || untaxed <= 0) {
        throw new Error('未稅金額必須大於 0');
      }
      const tax = Number(payload.tax_amount !== undefined ? payload.tax_amount : payload.taxAmount);
      if (isNaN(tax) || tax < 0) {
        throw new Error('進項稅額不可小於 0');
      }
      const billDate = String(payload.bill_date || payload.billDate || '').trim();
      const dueDate = String(payload.due_date || payload.dueDate || '').trim();
      const today = new Date().toISOString().split('T')[0];
      if (billDate > today) {
        throw new Error('請款日不可晚於今天');
      }
      if (dueDate < billDate) {
        throw new Error('到期日不可早於請款日');
      }
      const dup = mockVendorBills.find(b =>
        b.id !== bill.id &&
        (b.tenant_id || 'tnt_mock_1') === targetTenantId &&
        b.vendor_partner_id === bill.vendor_partner_id &&
        b.vendor_invoice_number.trim().toLowerCase() === trimmedInvoice.toLowerCase() &&
        b.status !== 'cancelled' && b.status !== 'voided'
      );
      if (dup) {
        throw new Error(`此供應商的發票號碼 ${trimmedInvoice} 已登錄於 ${dup.bill_number}`);
      }

      bill.vendor_invoice_number = trimmedInvoice;
      bill.bill_date = billDate;
      bill.due_date = dueDate;
      bill.untaxed_amount = untaxed;
      bill.tax_amount = tax;
      bill.note = payload.note ? String(payload.note).trim() : null;
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(bill).detail;
    }

    case 'add_vendor_bill_order': {
      const { bill_id, billId, purchase_order_id, purchaseOrderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const bId = bill_id || billId;
      const poId = purchase_order_id || purchaseOrderId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');
      if (!poId || !String(poId).trim()) throw new Error('採購單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'draft') throw new Error(`請款單狀態為 ${bill.status}，不可修改`);

      const po = mockPurchaseOrders.find(p => p.id === String(poId).trim() && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!po || po.status !== 'received' || po.vendor_partner_id !== bill.vendor_partner_id) {
        throw new Error('僅能加入同一供應商且已到貨的採購單');
      }

      const activeCovered = mockVendorBillOrders.find(o => {
        if (o.purchase_order_id !== po.id) return false;
        const coveringBill = mockVendorBills.find(b => b.id === o.bill_id && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
        return coveringBill && ['draft', 'disputed', 'posted'].includes(coveringBill.status);
      });
      if (activeCovered) {
        const coveringBill = mockVendorBills.find(b => b.id === activeCovered.bill_id);
        throw new Error(`採購單 ${po.po_number} 已在請款單 ${coveringBill.bill_number} 中`);
      }

      const alreadyInBill = mockVendorBillOrders.some(o => o.bill_id === bill.id && o.purchase_order_id === po.id);
      if (alreadyInBill) {
        throw new Error(`採購單 ${po.po_number} 已在請款單 ${bill.bill_number} 中`);
      }

      const newOrder = {
        id: nextMockUid('billpo'),
        bill_id: bill.id,
        purchase_order_id: po.id,
        po_number_snapshot: po.po_number,
        created_at: Math.floor(Date.now() / 1000)
      };
      mockVendorBillOrders.push(newOrder);
      saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
      return formatMockVendorBill(bill).detail;
    }

    case 'remove_vendor_bill_order': {
      const { bill_id, billId, purchase_order_id, purchaseOrderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const bId = bill_id || billId;
      const poId = purchase_order_id || purchaseOrderId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');
      if (!poId || !String(poId).trim()) throw new Error('採購單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'draft') throw new Error(`請款單狀態為 ${bill.status}，不可修改`);

      mockVendorBillOrders = mockVendorBillOrders.filter(o => !(o.bill_id === bill.id && (o.purchase_order_id === poId || o.id === poId)));
      saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
      return formatMockVendorBill(bill).detail;
    }

    case 'post_vendor_bill': {
      const { bill_id, billId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetUserId = resolveMockActiveUserId();
      const bId = bill_id || billId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'draft') {
        throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 posted`);
      }

      const coveredOrders = mockVendorBillOrders.filter(o => o.bill_id === bill.id);
      if (coveredOrders.length === 0) {
        throw new Error('請款單需至少涵蓋一張採購單');
      }

      let basisAmount = 0;
      for (const o of coveredOrders) {
        basisAmount += calculateMockPoReceivedTotal(o.purchase_order_id);
      }
      basisAmount = Math.round(basisAmount * 100) / 100;
      const diff = Math.round((bill.untaxed_amount - basisAmount) * 100) / 100;
      const isMatched = Math.abs(diff) < 1.0;
      const now = Math.floor(Date.now() / 1000);

      bill.basis_amount = basisAmount;
      bill.difference_amount = diff;

      if (isMatched) {
        bill.status = 'posted';
        bill.posted_at = now;

        const totalAmount = Math.round((bill.untaxed_amount + bill.tax_amount) * 100) / 100;
        const ap = {
          id: nextMockUid('ap'),
          tenant_id: targetTenantId,
          vendor_partner_id: bill.vendor_partner_id,
          vendor_name_snapshot: bill.vendor_name_snapshot,
          source_type: 'vendor_bill',
          source_id: bill.id,
          source_number: bill.bill_number,
          external_reference: bill.vendor_invoice_number,
          document_date: bill.bill_date,
          due_date: bill.due_date,
          amount: totalAmount,
          currency: 'TWD',
          status: 'open',
          created_by: targetUserId,
          created_at: now
        };
        mockAccountsPayable.push(ap);
        saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
      } else {
        bill.status = 'disputed';
      }

      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(bill).detail;
    }

    case 'accept_vendor_bill_difference': {
      const { bill_id, billId, difference_note, differenceNote } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetUserId = resolveMockActiveUserId();
      const bId = bill_id || billId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'disputed') {
        throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 posted`);
      }

      const note = difference_note || differenceNote;
      if (!note || !String(note).trim()) {
        throw new Error('接受差異需填寫說明');
      }

      const now = Math.floor(Date.now() / 1000);
      bill.status = 'posted';
      bill.difference_note = String(note).trim();
      bill.difference_accepted_by = targetUserId;
      bill.difference_accepted_at = now;
      bill.posted_at = now;

      const totalAmount = Math.round((bill.untaxed_amount + bill.tax_amount) * 100) / 100;
      const ap = {
        id: nextMockUid('ap'),
        tenant_id: targetTenantId,
        vendor_partner_id: bill.vendor_partner_id,
        vendor_name_snapshot: bill.vendor_name_snapshot,
        source_type: 'vendor_bill',
        source_id: bill.id,
        source_number: bill.bill_number,
        external_reference: bill.vendor_invoice_number,
        document_date: bill.bill_date,
        due_date: bill.due_date,
        amount: totalAmount,
        currency: 'TWD',
        status: 'open',
        created_by: targetUserId,
        created_at: now
      };
      mockAccountsPayable.push(ap);
      saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(bill).detail;
    }

    case 'return_vendor_bill_to_draft': {
      const { bill_id, billId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const bId = bill_id || billId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'disputed') {
        throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 draft`);
      }

      bill.status = 'draft';
      bill.basis_amount = null;
      bill.difference_amount = null;
      bill.difference_note = null;
      bill.difference_accepted_by = null;
      bill.difference_accepted_at = null;
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(bill).detail;
    }

    case 'cancel_vendor_bill': {
      const { bill_id, billId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const bId = bill_id || billId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'draft' && bill.status !== 'disputed') {
        throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 cancelled`);
      }

      bill.status = 'cancelled';
      bill.cancelled_at = Math.floor(Date.now() / 1000);
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(bill).detail;
    }

    case 'void_vendor_bill': {
      const { bill_id, billId, void_reason, voidReason } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetUserId = resolveMockActiveUserId();
      const bId = bill_id || billId;
      if (!bId || !String(bId).trim()) throw new Error('請款單 ID 不可為空');

      const bill = mockVendorBills.find(b => b.id === String(bId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) throw new Error('找不到指定的請款單');
      if (bill.status !== 'posted') {
        throw new Error(`無效的狀態轉換：不可從 ${bill.status} 轉換至 voided`);
      }

      const reason = void_reason || voidReason;
      if (!reason || !String(reason).trim()) {
        throw new Error('作廢原因為必填');
      }

      const ap = mockAccountsPayable.find(a => (a.tenant_id || 'tnt_mock_1') === targetTenantId && a.source_type === 'vendor_bill' && a.source_id === bill.id && a.status === 'open');
      if (ap) {
        const alloc = mockPaymentAllocations.find(pa => pa.account_payable_id === ap.id && (pa.tenant_id || 'tnt_mock_1') === targetTenantId);
        if (alloc) {
          const p = mockPayments.find(pay => pay.id === alloc.payment_id && pay.status === 'posted');
          if (p) {
            throw new Error(`此請款單已有付款核銷：${p.payment_number}，請先作廢付款單`);
          }
        }
        ap.status = 'voided';
        ap.voided_by = targetUserId;
        ap.voided_at = Math.floor(Date.now() / 1000);
        ap.void_reason = String(reason).trim();
        saveStorage('agent_erp_mock_accounts_payable', mockAccountsPayable);
      }

      bill.status = 'voided';
      bill.voided_by = targetUserId;
      bill.voided_at = Math.floor(Date.now() / 1000);
      bill.void_reason = String(reason).trim();
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      return formatMockVendorBill(bill).detail;
    }

    case 'get_vendor_bill': {
      const { id, bill_id, billId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetId = id || bill_id || billId;
      if (!targetId || !String(targetId).trim()) {
        throw new Error('缺少請款單 ID (id 或 bill_id)');
      }
      const bill = mockVendorBills.find(b => b.id === String(targetId).trim() && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!bill) {
        throw new Error('找不到指定的請款單');
      }
      return formatMockVendorBill(bill).detail;
    }

    case 'list_vendor_bills': {
      const { vendor_partner_id, vendorPartnerId, status } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      let list = mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') === targetTenantId);
      const vp = vendor_partner_id || vendorPartnerId;
      if (vp && String(vp).trim()) {
        list = list.filter(b => b.vendor_partner_id === String(vp).trim());
      }
      if (status && String(status).trim()) {
        list = list.filter(b => b.status === String(status).trim());
      }
      return list
        .sort((a, b) => (b.bill_date || '').localeCompare(a.bill_date || '') || b.created_at - a.created_at || (b.bill_number || '').localeCompare(a.bill_number || ''))
        .map(b => formatMockVendorBill(b).item);
    }

    case 'list_unbilled_received_orders': {
      const { vendor_partner_id, vendorPartnerId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const vp = vendor_partner_id || vendorPartnerId;

      const activeCoveredPoIds = new Set();
      for (const order of mockVendorBillOrders) {
        const bill = mockVendorBills.find(b => b.id === order.bill_id && (b.tenant_id || 'tnt_mock_1') === targetTenantId);
        if (bill && ['draft', 'disputed', 'posted'].includes(bill.status)) {
          activeCoveredPoIds.add(order.purchase_order_id);
        }
      }

      let list = mockPurchaseOrders.filter(po => (po.tenant_id || 'tnt_mock_1') === targetTenantId && po.status === 'received' && !activeCoveredPoIds.has(po.id));
      if (vp && String(vp).trim()) {
        list = list.filter(po => po.vendor_partner_id === String(vp).trim());
      }

      return list
        .sort((a, b) => (b.received_at || 0) - (a.received_at || 0) || (b.po_number || '').localeCompare(a.po_number || ''))
        .map(po => ({
          purchase_order_id: po.id,
          po_number: po.po_number,
          vendor_partner_id: po.vendor_partner_id,
          vendor_name_snapshot: po.vendor_name_snapshot,
          ordered_at: po.ordered_at || null,
          received_at: po.received_at || null,
          received_total_amount: calculateMockPoReceivedTotal(po.id)
        }));
    }

    case 'reset_mock_vendor_bills': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        const removedBillIds = new Set(
          mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') === targetTid).map(b => b.id)
        );
        mockVendorBills = mockVendorBills.filter(b => (b.tenant_id || 'tnt_mock_1') !== targetTid);
        mockVendorBillOrders = mockVendorBillOrders.filter(o => !removedBillIds.has(o.bill_id));
      } else {
        mockVendorBills = [];
        mockVendorBillOrders = [];
      }
      saveStorage('agent_erp_mock_vendor_bills', mockVendorBills);
      saveStorage('agent_erp_mock_vendor_bill_orders', mockVendorBillOrders);
      return true;
    }

    case 'reset_mock_stock_transfers': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        const removedTrfIds = new Set(
          mockStockTransfers.filter(t => (t.tenant_id || 'tnt_mock_1') === targetTid).map(t => t.id)
        );
        mockStockTransfers = mockStockTransfers.filter(t => (t.tenant_id || 'tnt_mock_1') !== targetTid);
        mockStockTransferLines = mockStockTransferLines.filter(l => !removedTrfIds.has(l.transfer_id));
      } else {
        mockStockTransfers = [];
        mockStockTransferLines = [];
      }
      saveStorage('agent_erp_mock_stock_transfers', mockStockTransfers);
      saveStorage('agent_erp_mock_stock_transfer_lines', mockStockTransferLines);
      return true;
    }

    case 'set_mock_active_tenant': {
      const rawTid = args && (args.tenant_id !== undefined ? args.tenant_id : args.tenantId);
      const tid = rawTid !== undefined ? rawTid : 'tnt_mock_1';
      if (!mockSessions) {
        mockSessions = {
          user_id: 'usr_mock_admin',
          active_tenant_id: tid,
          token: 'mock-token'
        };
      } else {
        mockSessions.active_tenant_id = tid;
      }
      saveStorage('agent_erp_mock_session', mockSessions);
      return tid;
    }

    case 'reset_mock_warehouses': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        mockWarehouses = mockWarehouses.filter(w => (w.tenant_id || 'tnt_mock_1') !== targetTid);
      } else {
        mockWarehouses = JSON.parse(JSON.stringify(defaultMockWarehouses));
      }
      saveStorage('agent_erp_mock_warehouses', mockWarehouses);
      return mockWarehouses;
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
