/**
 * ============================================================================
 * AgentERP 跨領域核心 IPC 轉發與通訊 (Core Shell Tauri Bridge)
 * ============================================================================
 * 本檔案僅供放置系統級跨領域通訊殼層邏輯：
 * - Tauri invoke / listen 核心轉發
 * - 瀏覽器環境 Mock 核心轉發分流 (domainMocks 委派)
 * - 核心跨領域 IPC (Auth, Tenant, Task, Audit, LLM trace)
 * 
 * ⚠️ 注意：領域專屬 Mock 邏輯與 IPC 處理請勿加入此檔案，請置於對應的 `src/lib/{domain}/mocks.js`。
 * ============================================================================
 */

import { Channel as TauriChannel } from '@tauri-apps/api/core';
import { calculateDueDate } from './paymentTerms.js';
import {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId,
  resolveMockActiveUserId
} from './mockStorage.js';
import {
  departmentMocks,
  mockDepartments,
  createDefaultMockDepartments
} from './departments/mocks.js';
import {
  partnerMocks,
  mockPartners,
  defaultMockPartners
} from './partners/mocks.js';
import {
  productMocks,
  mockProducts,
  mockProductVariants,
  mockProductUnits,
  mockProductSupplySources,
  mockProductBomItems,
  resolveMockCategoryFlags,
  checkMockBomCycle
} from './products/mocks.js';
import {
  purchaseOrderMocks,
  mockPurchaseOrders,
  mockPurchaseOrderLines,
  calculateMockPoOrderedTotal,
  calculateMockPoReceivedTotal,
  formatMockPurchaseOrderDetail,
  nextMockPoNumber
} from './purchaseOrders/mocks.js';
import {
  warehouseMocks,
  mockWarehouses,
  defaultMockWarehouses,
  resolveMockDefaultWarehouse,
  validateMockWarehouseActive,
  mockInventoryMovements,
  mockUnitConversions,
  formatMockQty,
  resolveMockUnitSnapshot
} from './warehouses/mocks.js';
import {
  inventoryAdjustmentMocks,
  mockInventoryAdjustments,
  mockInventoryAdjustmentLines,
  nextMockAdjNumber,
  formatMockInventoryAdjustmentDetail
} from './inventoryAdjustments/mocks.js';
import {
  stocktakeMocks,
  mockStocktakes,
  mockStocktakeLines,
  isStocktakeLineCounted,
  nextMockStkNumber,
  formatMockStocktakeDetail
} from './stocktakes/mocks.js';
import {
  stockTransferMocks,
  mockStockTransfers,
  mockStockTransferLines,
  nextMockTrfNumber,
  formatMockStockTransferDetail
} from './stockTransfers/mocks.js';
import {
  vendorBillMocks,
  mockVendorBills,
  mockVendorBillOrders,
  formatMockVendorBill,
  nextMockBillNumber
} from './vendorBills/mocks.js';
import {
  openingPayableMocks,
  mockOpeningPayables
} from './openingPayables/mocks.js';
import {
  openingReceivableMocks,
  mockOpeningReceivables
} from './openingReceivables/mocks.js';
import {
  accountPayableMocks,
  mockAccountsPayable,
  formatMockAccountPayable
} from './accountsPayable/mocks.js';
import {
  accountReceivableMocks,
  mockAccountsReceivable,
  formatMockAccountReceivable,
  mockCustomerReceipts,
  mockCustomerReceiptAllocations
} from './accountsReceivable/mocks.js';
import {
  customerInvoiceMocks,
  mockCustomerInvoices,
  mockCustomerInvoiceOrders,
  mockSalesAllowances,
  formatMockCustomerInvoice,
  nextMockCustomerInvoiceNumber
} from './customerInvoices/mocks.js';
import {
  vendorPaymentMocks,
  mockVendorPayments,
  mockVendorPaymentAllocations,
  formatMockVendorPayment
} from './vendorPayments/mocks.js';
import {
  customerReceiptMocks,
  formatMockCustomerReceipt
} from './customerReceipts/mocks.js';
import {
  quoteMocks,
  mockQuotes,
  mockQuoteLines,
  nextMockQuoteNumber,
  expireMockQuotes,
  formatMockQuote,
  getMockBelowStandardLines,
  resetMockQuotes
} from './quotes/mocks.js';
import {
  salesOrderMocks,
  mockSalesOrders,
  mockSalesOrderLines,
  mockSalesShipments,
  mockSalesShipmentLines,
  nextMockSoNumber,
  nextMockShipmentNumber,
  validateMockCalendarDate,
  formatMockSalesOrder,
  resetMockSalesOrders
} from './salesOrders/mocks.js';

export {
  loadStorage,
  saveStorage,
  nextMockUid,
  resolveMockActiveTenantId,
  resolveMockActiveUserId,
  mockDepartments,
  createDefaultMockDepartments,
  mockPartners,
  defaultMockPartners,
  mockProducts,
  mockProductVariants,
  mockProductUnits,
  mockProductSupplySources,
  mockProductBomItems,
  resolveMockCategoryFlags,
  checkMockBomCycle,
  mockPurchaseOrders,
  mockPurchaseOrderLines,
  calculateMockPoOrderedTotal,
  calculateMockPoReceivedTotal,
  formatMockPurchaseOrderDetail,
  nextMockPoNumber,
  warehouseMocks,
  mockWarehouses,
  defaultMockWarehouses,
  resolveMockDefaultWarehouse,
  validateMockWarehouseActive,
  mockInventoryMovements,
  mockUnitConversions,
  formatMockQty,
  resolveMockUnitSnapshot,
  inventoryAdjustmentMocks,
  mockInventoryAdjustments,
  mockInventoryAdjustmentLines,
  nextMockAdjNumber,
  formatMockInventoryAdjustmentDetail,
  stocktakeMocks,
  mockStocktakes,
  mockStocktakeLines,
  isStocktakeLineCounted,
  nextMockStkNumber,
  formatMockStocktakeDetail,
  stockTransferMocks,
  mockStockTransfers,
  mockStockTransferLines,
  nextMockTrfNumber,
  formatMockStockTransferDetail,
  vendorBillMocks,
  mockVendorBills,
  mockVendorBillOrders,
  formatMockVendorBill,
  nextMockBillNumber,
  openingPayableMocks,
  mockOpeningPayables,
  openingReceivableMocks,
  mockOpeningReceivables,
  accountPayableMocks,
  mockAccountsPayable,
  formatMockAccountPayable,
  accountReceivableMocks,
  mockAccountsReceivable,
  formatMockAccountReceivable,
  mockCustomerReceipts,
  mockCustomerReceiptAllocations,
  customerInvoiceMocks,
  mockCustomerInvoices,
  mockCustomerInvoiceOrders,
  mockSalesAllowances,
  formatMockCustomerInvoice,
  nextMockCustomerInvoiceNumber,
  vendorPaymentMocks,
  mockVendorPayments,
  mockVendorPaymentAllocations,
  formatMockVendorPayment,
  customerReceiptMocks,
  formatMockCustomerReceipt,
  quoteMocks,
  mockQuotes,
  mockQuoteLines,
  nextMockQuoteNumber,
  expireMockQuotes,
  formatMockQuote,
  getMockBelowStandardLines,
  resetMockQuotes,
  salesOrderMocks,
  mockSalesOrders,
  mockSalesOrderLines,
  mockSalesShipments,
  mockSalesShipmentLines,
  nextMockSoNumber,
  nextMockShipmentNumber,
  validateMockCalendarDate,
  formatMockSalesOrder,
  resetMockSalesOrders
};

// Detect if we are in Tauri runtime
export const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export let mockAuditLogs = loadStorage('agent_erp_mock_audit_logs', []);
let mockLlmTraces = loadStorage('agent_erp_mock_llm_traces', []);

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

const defaultMockUserDepartments = [
  { user_id: "usr_mock_admin", tenant_id: "tnt_mock_1", department_id: "dept_mock_1" },
  { user_id: "usr_mock_admin", tenant_id: "tnt_mock_1", department_id: "dept_mock_2" }
];

let mockUserDepartments = loadStorage('agent_erp_mock_user_departments', defaultMockUserDepartments);
if (!mockUserDepartments || !Array.isArray(mockUserDepartments)) {
  mockUserDepartments = defaultMockUserDepartments;
  saveStorage('agent_erp_mock_user_departments', mockUserDepartments);
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
  if (typeof window !== 'undefined' && !window.invoke) {
    window.invoke = invoke;
  }
  if (isTauri) {
    const { invoke: realInvoke } = await import('@tauri-apps/api/core');
    return await realInvoke(cmd, args);
  }

  // Browser Mock Implementation
  if (typeof window !== 'undefined') {
    await new Promise(resolve => setTimeout(resolve, 300)); // Simulating latency in browser UI
  }

  const domainMocks = {
    ...departmentMocks,
    ...partnerMocks,
    ...productMocks,
    ...purchaseOrderMocks,
    ...warehouseMocks,
    ...inventoryAdjustmentMocks,
    ...stocktakeMocks,
    ...stockTransferMocks,
    ...vendorBillMocks,
    ...openingPayableMocks,
    ...openingReceivableMocks,
    ...accountPayableMocks,
    ...accountReceivableMocks,
    ...customerInvoiceMocks,
    ...vendorPaymentMocks,
    ...customerReceiptMocks,
    ...quoteMocks,
    ...salesOrderMocks
  };

  if (typeof domainMocks[cmd] === 'function') {
    return await domainMocks[cmd](args);
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
        saveStorage('agent_erp_mock_session', mockSessions);

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

    case 'detect_intent': {
      return { attempted: false, tool_call: null, tool_calls: null, content: null };
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
