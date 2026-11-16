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
  validateMockWarehouseActive
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
  accountPayableMocks,
  mockAccountsPayable,
  formatMockAccountPayable
} from './accountsPayable/mocks.js';
import {
  vendorPaymentMocks,
  mockVendorPayments,
  mockVendorPaymentAllocations,
  mockPayments,
  mockPaymentAllocations,
  formatMockVendorPayment
} from './vendorPayments/mocks.js';

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
  accountPayableMocks,
  mockAccountsPayable,
  formatMockAccountPayable,
  vendorPaymentMocks,
  mockVendorPayments,
  mockVendorPaymentAllocations,
  mockPayments,
  mockPaymentAllocations,
  formatMockVendorPayment
};

// Detect if we are in Tauri runtime
export const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

let mockAuditLogs = loadStorage('agent_erp_mock_audit_logs', []);
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

export let mockInventoryMovements = loadStorage('agent_erp_mock_inventory_movements', []);
if (!mockInventoryMovements || !Array.isArray(mockInventoryMovements)) {
  mockInventoryMovements = [];
  saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
}

let mockUnitConversions = loadStorage('agent_erp_mock_unit_conversions', []);
if (!mockUnitConversions || !Array.isArray(mockUnitConversions)) {
  mockUnitConversions = [];
  saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
}

function nextMockUcvNumber(tenantId) {
  let maxSeq = 0;
  for (const ucv of mockUnitConversions) {
    if ((ucv.tenant_id || 'tnt_mock_1') === tenantId && ucv.conversion_number && ucv.conversion_number.startsWith('UCV-')) {
      const num = parseInt(ucv.conversion_number.slice(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `UCV-${String(maxSeq + 1).padStart(5, '0')}`;
}

function formatMockQty(q) {
  const rounded = Math.round(q * 1e6) / 1e6;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

let mockQuotes = loadStorage('agent_erp_mock_quotes', []);
if (!mockQuotes || !Array.isArray(mockQuotes)) {
  mockQuotes = [];
  saveStorage('agent_erp_mock_quotes', mockQuotes);
}

let mockQuoteLines = loadStorage('agent_erp_mock_quote_lines', []);
if (!mockQuoteLines || !Array.isArray(mockQuoteLines)) {
  mockQuoteLines = [];
  saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
}

function nextMockQuoteNumber(tenantId) {
  const existing = mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const q of existing) {
    if (q.quote_number && q.quote_number.startsWith('QUO-')) {
      const num = parseInt(q.quote_number.substring(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `QUO-${String(nextSeq).padStart(5, '0')}`;
}

function expireMockQuotes(tenantId, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);
  for (const q of mockQuotes) {
    if ((q.tenant_id || 'tnt_mock_1') === tenantId && ['pending_approval', 'sent'].includes(q.status)) {
      if (q.valid_until < t) {
        q.status = 'expired';
        q.expired_at = now;
      }
    }
  }
  saveStorage('agent_erp_mock_quotes', mockQuotes);
}

function formatMockQuote(quote) {
  const lines = mockQuoteLines
    .filter(l => l.quote_id === quote.id)
    .sort((a, b) => a.line_no - b.line_no);
  const total_amount = Math.round(lines.reduce((sum, l) => sum + (Number(l.line_amount) || 0), 0) * 100) / 100;
  return {
    quote: {
      ...quote,
      total_amount
    },
    lines,
    total_amount
  };
}

let mockSalesOrders = loadStorage('agent_erp_mock_sales_orders', []);
if (!mockSalesOrders || !Array.isArray(mockSalesOrders)) {
  mockSalesOrders = [];
  saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
}

let mockSalesOrderLines = loadStorage('agent_erp_mock_sales_order_lines', []);
if (!mockSalesOrderLines || !Array.isArray(mockSalesOrderLines)) {
  mockSalesOrderLines = [];
  saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
}

let mockSalesShipments = loadStorage('agent_erp_mock_sales_shipments', []);
if (!mockSalesShipments || !Array.isArray(mockSalesShipments)) {
  mockSalesShipments = [];
  saveStorage('agent_erp_mock_sales_shipments', mockSalesShipments);
}

let mockSalesShipmentLines = loadStorage('agent_erp_mock_sales_shipment_lines', []);
if (!mockSalesShipmentLines || !Array.isArray(mockSalesShipmentLines)) {
  mockSalesShipmentLines = [];
  saveStorage('agent_erp_mock_sales_shipment_lines', mockSalesShipmentLines);
}

function nextMockSoNumber(tenantId) {
  const existing = mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const o of existing) {
    if (o.so_number && o.so_number.startsWith('SO-')) {
      const num = parseInt(o.so_number.substring(3), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `SO-${String(maxSeq + 1).padStart(5, '0')}`;
}

function nextMockShipmentNumber(tenantId) {
  const existing = mockSalesShipments.filter(s => (s.tenant_id || 'tnt_mock_1') === tenantId);
  let maxSeq = 0;
  for (const s of existing) {
    if (s.shipment_number && s.shipment_number.startsWith('SHP-')) {
      const num = parseInt(s.shipment_number.substring(4), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `SHP-${String(maxSeq + 1).padStart(5, '0')}`;
}

function validateMockCalendarDate(dateStr) {
  const trimmed = String(dateStr || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error('日期格式需為 YYYY-MM-DD');
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('無效的日期數值');
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const dim = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > dim) {
    throw new Error('日期超出該月份天數');
  }
  return trimmed;
}

function formatMockSalesOrder(order) {
  const lines = mockSalesOrderLines
    .filter(l => l.sales_order_id === order.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map(l => {
      const subtotal = Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100;
      const shipped_subtotal = l.shipped_quantity !== null && l.shipped_quantity !== undefined
        ? Math.round(Number(l.shipped_quantity) * Number(l.unit_price) * 100) / 100
        : null;
      return {
        ...l,
        subtotal,
        shipped_subtotal
      };
    });
  const total_amount = Math.round(lines.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100;
  const shipped_amount = Math.round(lines.reduce((sum, l) => sum + (l.shipped_subtotal || 0), 0) * 100) / 100;
  const shipments = mockSalesShipments
    .filter(s => s.sales_order_id === order.id)
    .sort((a, b) => (a.shipped_at - b.shipped_at) || (a.created_at - b.created_at) || String(a.shipment_number).localeCompare(String(b.shipment_number)))
    .map(s => {
      const shpLines = mockSalesShipmentLines
        .filter(sl => sl.shipment_id === s.id)
        .sort((a, b) => a.line_no - b.line_no)
        .map(sl => ({
          ...sl,
          subtotal: Math.round(Number(sl.shipped_quantity) * Number(sl.unit_price) * 100) / 100
        }));
      const shpTotal = Math.round(shpLines.reduce((sum, sl) => sum + sl.subtotal, 0) * 100) / 100;
      return {
        ...s,
        total_amount: shpTotal,
        lines: shpLines
      };
    });
  return {
    order: {
      ...order,
      total_amount,
      shipped_amount,
      lines_count: lines.length
    },
    lines,
    shipments
  };
}

function getMockBelowStandardLines(lines) {
  return lines
    .filter(l => {
      const unitPrice = Math.round(Number(l.unit_price) * 100) / 100;
      const stdPrice = Math.round(Number(l.standard_price_snapshot) * 100) / 100;
      return l.requires_approval === 1 || unitPrice < stdPrice || stdPrice <= 0;
    })
    .map(l => {
      const unitPrice = Math.round(Number(l.unit_price) * 100) / 100;
      const stdPrice = Math.round(Number(l.standard_price_snapshot) * 100) / 100;
      const diff = Math.round((stdPrice - unitPrice) * 100) / 100;
      return {
        line_id: l.id,
        unit_id: l.unit_id,
        product_name: l.product_name_snapshot,
        quantity: Number(l.quantity),
        unit_price: unitPrice,
        standard_price: stdPrice,
        difference: diff
      };
    });
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
    ...accountPayableMocks,
    ...vendorPaymentMocks
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

    case 'create_unit_conversion': {
      const {
        warehouse_id, warehouseId,
        from_unit_id, fromUnitId,
        from_quantity, fromQuantity,
        to_unit_id, toUnitId,
        to_quantity, toQuantity,
        note,
        task_id, taskId
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('tenant_id 不可為空');
      }
      const activeUid = mockSessions && mockSessions.user_id ? mockSessions.user_id : 'usr_mock_admin';
      if (!activeUid || !activeUid.trim()) {
        throw new Error('user_id 不可為空');
      }
      const whId = String(warehouse_id !== undefined ? warehouse_id : warehouseId || '').trim();
      const wh = mockWarehouses.find(w => w.id === whId && (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.is_active);
      if (!wh) {
        throw new Error('找不到指定的倉別或倉別已停用');
      }
      const fUnitId = String(from_unit_id !== undefined ? from_unit_id : fromUnitId || '').trim();
      const tUnitId = String(to_unit_id !== undefined ? to_unit_id : toUnitId || '').trim();
      const fQty = Number(from_quantity !== undefined ? from_quantity : fromQuantity);
      const tQty = Number(to_quantity !== undefined ? to_quantity : toQuantity);
      if (!Number.isFinite(fQty) || fQty <= 1e-9) {
        throw new Error('來源數量 (from_quantity) 必須大於 0');
      }
      if (!Number.isFinite(tQty) || tQty <= 1e-9) {
        throw new Error('目標數量 (to_quantity) 必須大於 0');
      }
      let fromSnap;
      try {
        fromSnap = resolveMockUnitSnapshot(targetTenantId, fUnitId);
      } catch {
        throw new Error('找不到來源商品單位 (from_unit_id) 或不屬於目前租戶');
      }
      let toSnap;
      try {
        toSnap = resolveMockUnitSnapshot(targetTenantId, tUnitId);
      } catch {
        throw new Error('找不到目標商品單位 (to_unit_id) 或不屬於目前租戶');
      }
      if (fromSnap.variant.id !== toSnap.variant.id) {
        throw new Error('來源單位與目標單位必須屬於同一個商品規格 (variant)');
      }
      if (fUnitId === tUnitId) {
        throw new Error('來源單位與目標單位不可相同');
      }

      const now = Math.floor(Date.now() / 1000);
      const ucv = {
        id: `ucv_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        tenant_id: targetTenantId,
        conversion_number: nextMockUcvNumber(targetTenantId),
        warehouse_id: whId,
        variant_id: fromSnap.variant.id,
        from_unit_id: fUnitId,
        from_quantity: fQty,
        to_unit_id: tUnitId,
        to_quantity: tQty,
        status: 'draft',
        note: note && String(note).trim() ? String(note).trim() : null,
        product_name_snapshot: fromSnap.product.name,
        variant_name_snapshot: fromSnap.variant.name,
        sku_snapshot: fromSnap.variant.sku || null,
        from_unit_name_snapshot: fromSnap.unit.unit_name,
        to_unit_name_snapshot: toSnap.unit.unit_name,
        created_by: activeUid,
        created_at: now,
        posted_at: null,
        cancelled_at: null,
        task_id: task_id !== undefined ? task_id : (taskId !== undefined ? taskId : null)
      };
      mockUnitConversions.push(ucv);
      saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
      return { ...ucv };
    }

    case 'post_unit_conversion': {
      const { conversion_id, conversionId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const activeUid = mockSessions && mockSessions.user_id ? mockSessions.user_id : 'usr_mock_admin';
      const targetId = String(conversion_id !== undefined ? conversion_id : conversionId || '').trim();
      const ucv = mockUnitConversions.find(c => c.id === targetId && (c.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!ucv) {
        throw new Error('找不到指定的單位轉換單或無權限存取');
      }
      if (ucv.status !== 'draft') {
        throw new Error(`單位轉換單狀態為「${ucv.status}」，無法變更為「posted」`);
      }
      const wh = mockWarehouses.find(w => w.id === ucv.warehouse_id && (w.tenant_id || 'tnt_mock_1') === targetTenantId && w.is_active);
      if (!wh) {
        throw new Error('找不到指定的倉別或倉別已停用');
      }
      const fromSnap = resolveMockUnitSnapshot(targetTenantId, ucv.from_unit_id);
      const toSnap = resolveMockUnitSnapshot(targetTenantId, ucv.to_unit_id);
      if (fromSnap.variant.id !== toSnap.variant.id) {
        throw new Error('來源單位與目標單位必須屬於同一個商品規格 (variant)');
      }

      const currentStock = mockInventoryMovements
        .filter(m => (m.tenant_id || 'tnt_mock_1') === targetTenantId && m.warehouse_id === ucv.warehouse_id && m.unit_id === ucv.from_unit_id)
        .reduce((sum, m) => sum + Number(m.quantity_delta || 0), 0);

      if (currentStock + 1e-9 < ucv.from_quantity) {
        throw new Error(
          `〔${ucv.product_name_snapshot}／${ucv.variant_name_snapshot}／${ucv.from_unit_name_snapshot}〕在〔${wh.name}〕現有庫存 ${formatMockQty(currentStock)} 不足，無法扣除轉換數量 ${formatMockQty(ucv.from_quantity)}`
        );
      }

      const now = Math.floor(Date.now() / 1000);
      ucv.status = 'posted';
      ucv.posted_at = now;

      mockInventoryMovements.push({
        id: `im_ucv_out_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        tenant_id: targetTenantId,
        unit_id: ucv.from_unit_id,
        warehouse_id: ucv.warehouse_id,
        quantity_delta: -ucv.from_quantity,
        unit_cost: null,
        reason: 'unit_conversion_out',
        reference_type: 'unit_conversion',
        reference_id: ucv.id,
        created_by: activeUid,
        created_at: now
      });
      mockInventoryMovements.push({
        id: `im_ucv_in_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        tenant_id: targetTenantId,
        unit_id: ucv.to_unit_id,
        warehouse_id: ucv.warehouse_id,
        quantity_delta: ucv.to_quantity,
        unit_cost: null,
        reason: 'unit_conversion_in',
        reference_type: 'unit_conversion',
        reference_id: ucv.id,
        created_by: activeUid,
        created_at: now
      });

      saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      return { ...ucv };
    }

    case 'cancel_unit_conversion': {
      const { conversion_id, conversionId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetId = String(conversion_id !== undefined ? conversion_id : conversionId || '').trim();
      const ucv = mockUnitConversions.find(c => c.id === targetId && (c.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!ucv) {
        throw new Error('找不到指定的單位轉換單或無權限存取');
      }
      if (ucv.status !== 'draft') {
        throw new Error(`單位轉換單狀態為「${ucv.status}」，無法變更為「cancelled」`);
      }
      ucv.status = 'cancelled';
      ucv.cancelled_at = Math.floor(Date.now() / 1000);
      saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
      return { ...ucv };
    }

    case 'get_unit_conversion': {
      const { conversion_id, conversionId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetId = String(conversion_id !== undefined ? conversion_id : conversionId || '').trim();
      const ucv = mockUnitConversions.find(c => c.id === targetId && (c.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!ucv) {
        throw new Error('找不到指定的單位轉換單或無權限存取');
      }
      return { ...ucv };
    }

    case 'list_unit_conversions': {
      const { status, warehouse_id, warehouseId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetWhId = warehouse_id !== undefined ? warehouse_id : warehouseId;
      let list = mockUnitConversions.filter(c => (c.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (status && String(status).trim() && String(status).trim() !== 'all') {
        list = list.filter(c => c.status === String(status).trim());
      }
      if (targetWhId && String(targetWhId).trim()) {
        list = list.filter(c => c.warehouse_id === String(targetWhId).trim());
      }
      return list
        .map(c => ({ ...c }))
        .sort((a, b) => b.created_at - a.created_at || b.conversion_number.localeCompare(a.conversion_number));
    }

    case 'reset_mock_unit_conversions': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        mockUnitConversions = mockUnitConversions.filter(c => (c.tenant_id || 'tnt_mock_1') !== targetTid);
      } else {
        mockUnitConversions = [];
      }
      saveStorage('agent_erp_mock_unit_conversions', mockUnitConversions);
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

    case 'create_quote': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const targetUserId = resolveMockActiveUserId();
      const customerId = (payload.customer_partner_id || payload.customerPartnerId || '').trim();
      if (!customerId) {
        throw new Error('找不到此客戶，或該往來對象未設定為客戶');
      }
      const customer = mockPartners.find(p => p.id === customerId && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!customer || !customer.is_customer || customer.is_active === false) {
        throw new Error('找不到此客戶，或該往來對象未設定為客戶');
      }
      const validUntil = (payload.valid_until || payload.validUntil || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
        throw new Error('日期格式需為 YYYY-MM-DD');
      }
      const today = payload.today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const now = Math.floor(Date.now() / 1000);
      const quoteNumber = nextMockQuoteNumber(targetTenantId);
      const quoteId = `quo_${targetTenantId}_${now}_${Math.floor(Math.random() * 9000 + 1000)}`;

      const newQuote = {
        id: quoteId,
        tenant_id: targetTenantId,
        quote_number: quoteNumber,
        customer_partner_id: customer.id,
        customer_name_snapshot: customer.name,
        currency: 'TWD',
        status: 'draft',
        valid_until: validUntil,
        note: payload.note ? String(payload.note).trim() : null,
        customer_po_number: payload.customer_po_number || payload.customerPoNumber ? String(payload.customer_po_number || payload.customerPoNumber).trim() : null,
        requires_approval: 0,
        approval_rejection_reason: null,
        created_by: targetUserId,
        created_at: now,
        submitted_at: null,
        approved_by: null,
        approved_at: null,
        sent_at: null,
        declined_at: null,
        decline_reason: null,
        expired_at: null,
        cancelled_at: null,
        converted_at: null,
        accepted_by: null,
        converted_sales_order_id: null
      };

      mockQuotes.push(newQuote);
      saveStorage('agent_erp_mock_quotes', mockQuotes);
      return formatMockQuote(newQuote);
    }

    case 'update_quote_header': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const quoteId = (payload.quote_id || payload.quoteId || '').trim();
      const today = payload.today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === quoteId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'draft') {
        throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
      }

      if (payload.customer_partner_id || payload.customerPartnerId) {
        const cid = (payload.customer_partner_id || payload.customerPartnerId).trim();
        const customer = mockPartners.find(p => p.id === cid && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
        if (!customer || !customer.is_customer || customer.is_active === false) {
          throw new Error('找不到此客戶，或該往來對象未設定為客戶');
        }
        quote.customer_partner_id = customer.id;
        quote.customer_name_snapshot = customer.name;
      }

      if (payload.valid_until || payload.validUntil) {
        const vu = (payload.valid_until || payload.validUntil).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vu)) {
          throw new Error('日期格式需為 YYYY-MM-DD');
        }
        quote.valid_until = vu;
      }

      if (payload.note !== undefined) {
        quote.note = payload.note ? String(payload.note).trim() : null;
      }
      if (payload.customer_po_number !== undefined || payload.customerPoNumber !== undefined) {
        const po = payload.customer_po_number !== undefined ? payload.customer_po_number : payload.customerPoNumber;
        quote.customer_po_number = po ? String(po).trim() : null;
      }

      saveStorage('agent_erp_mock_quotes', mockQuotes);
      return formatMockQuote(quote);
    }

    case 'add_quote_line': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const quoteId = (payload.quote_id || payload.quoteId || '').trim();
      const today = payload.today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === quoteId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'draft') {
        throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
      }

      const qty = Number(payload.quantity);
      const unitPrice = Number(payload.unit_price !== undefined ? payload.unit_price : payload.unitPrice);
      if (isNaN(qty) || qty <= 0 || isNaN(unitPrice) || unitPrice < 0) {
        throw new Error('數量必須大於 0，單價不可為負數');
      }

      const unitId = (payload.unit_id || payload.unitId || '').trim();
      const existingLines = mockQuoteLines.filter(l => l.quote_id === quote.id);
      if (existingLines.some(l => l.unit_id === unitId)) {
        throw new Error('同一報價單內商品單位不可重複');
      }

      const foundUnit = (mockProductUnits || []).find(u => u.id === unitId);
      if (!foundUnit) {
        throw new Error('找不到指定的商品單位');
      }
      const foundVariant = (mockProductVariants || []).find(v => v.id === foundUnit.variant_id);
      const foundProduct = (mockProducts || []).find(p => p.id === foundVariant?.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!foundProduct) {
        throw new Error('找不到指定的商品單位');
      }
      if (!foundProduct.is_sellable) {
        throw new Error('此商品不可銷售');
      }

      const nextLineNo = existingLines.reduce((max, l) => Math.max(max, l.line_no || 0), 0) + 1;
      const now = Math.floor(Date.now() / 1000);
      const lineId = `qline_${targetTenantId}_${now}_${Math.floor(Math.random() * 9000 + 1000)}`;
      const roundedPrice = Math.round(unitPrice * 100) / 100;
      const lineAmount = Math.round(qty * roundedPrice * 100) / 100;
      const stdPrice = Number(foundUnit.selling_price) || 0;

      const newLine = {
        id: lineId,
        quote_id: quote.id,
        line_no: nextLineNo,
        unit_id: unitId,
        product_name_snapshot: foundProduct.name,
        variant_name_snapshot: foundVariant?.name || '標準',
        unit_name_snapshot: foundUnit.unit_name || '個',
        sku_snapshot: foundVariant?.sku || null,
        quantity: qty,
        unit_price: roundedPrice,
        standard_price_snapshot: stdPrice,
        requires_approval: 0,
        line_amount: lineAmount,
        note: payload.note ? String(payload.note).trim() : null
      };

      mockQuoteLines.push(newLine);
      saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
      return formatMockQuote(quote);
    }

    case 'update_quote_line': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const quoteId = (payload.quote_id || payload.quoteId || '').trim();
      const lineId = (payload.line_id || payload.lineId || '').trim();
      const today = payload.today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === quoteId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'draft') {
        throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
      }

      const qty = Number(payload.quantity);
      const unitPrice = Number(payload.unit_price !== undefined ? payload.unit_price : payload.unitPrice);
      if (isNaN(qty) || qty <= 0 || isNaN(unitPrice) || unitPrice < 0) {
        throw new Error('數量必須大於 0，單價不可為負數');
      }

      const line = mockQuoteLines.find(l => l.id === lineId && l.quote_id === quote.id);
      if (!line) throw new Error('找不到指定的報價明細');

      line.quantity = qty;
      line.unit_price = Math.round(unitPrice * 100) / 100;
      line.line_amount = Math.round(qty * line.unit_price * 100) / 100;
      if (payload.note !== undefined) {
        line.note = payload.note ? String(payload.note).trim() : null;
      }

      saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
      return formatMockQuote(quote);
    }

    case 'delete_quote_line': {
      const { quote_id, quoteId, line_id, lineId, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const qId = (quote_id || quoteId || '').trim();
      const lId = (line_id || lineId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'draft') {
        throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
      }

      const idx = mockQuoteLines.findIndex(l => l.id === lId && l.quote_id === quote.id);
      if (idx === -1) throw new Error('找不到指定的報價明細');
      mockQuoteLines.splice(idx, 1);

      saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
      return formatMockQuote(quote);
    }

    case 'submit_quote': {
      const { quote_id, quoteId, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const qId = (quote_id || quoteId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'draft') {
        throw new Error(`報價單狀態為 ${quote.status}，僅草稿可修改`);
      }

      if (quote.valid_until < today) {
        throw new Error('報價有效期已過，請先修改有效期');
      }

      const lines = mockQuoteLines.filter(l => l.quote_id === quote.id);
      if (lines.length === 0) {
        throw new Error('報價單沒有任何品項，無法送出');
      }

      const now = Math.floor(Date.now() / 1000);
      let lowPriceCount = 0;

      for (const line of lines) {
        const foundUnit = (mockProductUnits || []).find(u => u.id === line.unit_id);
        const currentStdPrice = foundUnit ? (Number(foundUnit.selling_price) || 0) : 0;

        line.standard_price_snapshot = currentStdPrice;
        const roundedUnit = Math.round(Number(line.unit_price) * 100) / 100;
        const roundedStd = Math.round(currentStdPrice * 100) / 100;
        const needsAppr = roundedUnit < roundedStd || roundedStd <= 0;
        line.requires_approval = needsAppr ? 1 : 0;
        if (needsAppr) {
          lowPriceCount++;
        }
      }
      saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);

      let message = '';
      if (lowPriceCount > 0) {
        quote.status = 'pending_approval';
        quote.requires_approval = 1;
        quote.submitted_at = now;
        message = `已送交核准（${lowPriceCount} 項低於標準售價）`;
      } else {
        quote.status = 'sent';
        quote.requires_approval = 0;
        quote.submitted_at = now;
        quote.sent_at = now;
        message = '報價已送出';
      }

      saveStorage('agent_erp_mock_quotes', mockQuotes);
      return {
        quote: formatMockQuote(quote).quote,
        message
      };
    }

    case 'withdraw_quote_approval': {
      const { quote_id, quoteId, reason, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const qId = (quote_id || quoteId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'pending_approval') {
        throw new Error('目前狀態不允許此操作');
      }

      quote.status = 'draft';
      quote.approval_rejection_reason = reason ? String(reason).trim() : null;
      saveStorage('agent_erp_mock_quotes', mockQuotes);
      return formatMockQuote(quote);
    }

    case 'decline_quote': {
      const { quote_id, quoteId, reason, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const qId = (quote_id || quoteId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'sent') {
        throw new Error('目前狀態不允許此操作');
      }

      const now = Math.floor(Date.now() / 1000);
      quote.status = 'declined';
      quote.declined_at = now;
      quote.decline_reason = reason ? String(reason).trim() : null;
      saveStorage('agent_erp_mock_quotes', mockQuotes);
      return formatMockQuote(quote);
    }

    case 'convert_quote': {
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = resolveMockActiveUserId();
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const qId = String(payload.quote_id || payload.quoteId || '').trim();
      const rawToday = args?.today_override !== undefined
        ? args.today_override
        : (args?.todayOverride !== undefined
          ? args.todayOverride
          : (payload.today_override !== undefined ? payload.today_override : payload.todayOverride));
      const today = (rawToday !== undefined && rawToday !== null && String(rawToday).trim() !== '')
        ? String(rawToday).trim()
        : new Date().toISOString().slice(0, 10);

      // In-transaction lazy expiration check before conversion
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (quote.status === 'expired') {
        throw new Error('報價單已過期，無法轉為銷售單');
      }
      if (['converted', 'declined', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'sent') {
        throw new Error('目前狀態不允許此操作');
      }

      const quoteLines = mockQuoteLines
        .filter(l => l.quote_id === quote.id)
        .sort((a, b) => a.line_no - b.line_no);
      if (quoteLines.length === 0) {
        throw new Error('銷售單至少需有 1 筆明細');
      }

      // Validate all #220 sales order preconditions atomically before mutating anything
      if (mockSalesOrders.some(o => o.source_quote_id === quote.id)) {
        throw new Error('此報價單已轉換過銷售單，不可重複轉單');
      }

      const customer = mockPartners.find(
        p => p.id === quote.customer_partner_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (!customer || !customer.is_customer || customer.is_active === false) {
        throw new Error('找不到此客戶，或該往來對象未設定為客戶');
      }

      const rawWhId = payload.warehouse_id !== undefined ? payload.warehouse_id : payload.warehouseId;
      const wh = (rawWhId && String(rawWhId).trim())
        ? validateMockWarehouseActive(targetTenantId, rawWhId)
        : resolveMockDefaultWarehouse(targetTenantId);

      const currency = (quote.currency && String(quote.currency).trim()) || 'TWD';
      if (currency !== 'TWD') {
        throw new Error('幣別僅支援 TWD');
      }

      const rawExpected = payload.expected_ship_date !== undefined ? payload.expected_ship_date : payload.expectedShipDate;
      const expectedShipDate = (rawExpected && String(rawExpected).trim())
        ? validateMockCalendarDate(rawExpected)
        : null;

      const seenUnits = new Set();
      for (const l of quoteLines) {
        resolveMockUnitSnapshot(targetTenantId, l.unit_id);
        if (seenUnits.has(l.unit_id)) {
          throw new Error('同一銷售單內商品單位不可重複');
        }
        seenUnits.add(l.unit_id);
        const qty = Number(l.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error('數量必須大於 0');
        }
        const price = Number(l.unit_price);
        if (!Number.isFinite(price) || price < 0) {
          throw new Error('單價不可為負數');
        }
      }

      const rawPo = payload.customer_po_number !== undefined
        ? payload.customer_po_number
        : (payload.customerPoNumber !== undefined
          ? payload.customerPoNumber
          : (payload.customer_reference !== undefined ? payload.customer_reference : payload.customerReference));
      const customerReference = (rawPo !== undefined && rawPo !== null)
        ? (String(rawPo).trim() !== '' ? String(rawPo).trim() : null)
        : (quote.customer_po_number || null);

      const rawNote = payload.note;
      const soNote = (rawNote !== undefined && rawNote !== null)
        ? (String(rawNote).trim() !== '' ? String(rawNote).trim() : null)
        : (quote.note || null);

      const now = Math.floor(Date.now() / 1000);
      const soId = nextMockUid('so');
      const soNumber = nextMockSoNumber(targetTenantId);
      const order = {
        id: soId,
        tenant_id: targetTenantId,
        so_number: soNumber,
        customer_partner_id: quote.customer_partner_id,
        customer_name_snapshot: quote.customer_name_snapshot || customer.name,
        customer_reference: customerReference,
        source_quote_id: quote.id,
        warehouse_id: wh.id,
        currency,
        status: 'confirmed',
        expected_ship_date: expectedShipDate,
        ship_date: null,
        note: soNote,
        created_by: activeUid,
        created_at: now,
        confirmed_at: now,
        shipped_by: null,
        shipped_at: null,
        cancelled_at: null,
        task_id: null
      };
      mockSalesOrders.push(order);

      quoteLines.forEach((l, idx) => {
        mockSalesOrderLines.push({
          id: nextMockUid('sol'),
          sales_order_id: soId,
          line_no: idx + 1,
          unit_id: l.unit_id,
          product_name_snapshot: l.product_name_snapshot,
          variant_name_snapshot: l.variant_name_snapshot,
          sku_snapshot: l.sku_snapshot || null,
          unit_name_snapshot: l.unit_name_snapshot,
          quantity: Number(l.quantity),
          shipped_quantity: null,
          unit_price: Number(l.unit_price),
          standard_price_snapshot: Number(l.standard_price_snapshot),
          created_at: now
        });
      });

      quote.status = 'converted';
      quote.converted_at = now;
      quote.accepted_by = activeUid;
      quote.converted_sales_order_id = soId;

      saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
      saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
      saveStorage('agent_erp_mock_quotes', mockQuotes);

      const formattedQuote = formatMockQuote(quote);
      return {
        ...formattedQuote,
        sales_order: formatMockSalesOrder(order)
      };
    }

    case 'cancel_quote': {
      const { quote_id, quoteId, reason, today_override, todayOverride } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const qId = (quote_id || quoteId || '').trim();
      const r = (reason || '').trim();
      if (!r) throw new Error('取消理由為必填');
      const today = today_override || todayOverride || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }

      const now = Math.floor(Date.now() / 1000);
      quote.status = 'cancelled';
      quote.cancelled_at = now;
      quote.cancel_reason = r;
      saveStorage('agent_erp_mock_quotes', mockQuotes);
      return formatMockQuote(quote);
    }

    case 'get_quote': {
      const { id, quote_id, quoteId, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const qId = (id || quote_id || quoteId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      return formatMockQuote(quote);
    }

    case 'list_quotes': {
      const {
        filter_status,
        filterStatus,
        status,
        filter_customer_id,
        filterCustomerId,
        customer_partner_id,
        customerPartnerId,
        today_override
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      let list = mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      const st = filter_status || filterStatus || status;
      if (st && String(st).trim()) {
        const normSt = String(st).trim();
        list = list.filter(q => q.status === normSt);
      }
      const cid = filter_customer_id || filterCustomerId || customer_partner_id || customerPartnerId;
      if (cid && String(cid).trim()) {
        const normCid = String(cid).trim();
        list = list.filter(q => q.customer_partner_id === normCid);
      }
      list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return list.map(q => formatMockQuote(q).quote);
    }

    case 'approve_quote': {
      const { quote_id, quoteId, reason, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const activeUid = resolveMockActiveUserId();
      const qId = (quote_id || quoteId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'pending_approval') {
        throw new Error('目前狀態不允許此操作');
      }

      const now = Math.floor(Date.now() / 1000);
      quote.status = 'sent';
      quote.approved_by = activeUid;
      quote.approved_at = now;
      quote.sent_at = now;
      quote.approval_rejection_reason = null;

      const formatted = formatMockQuote(quote);
      const belowStandardLines = getMockBelowStandardLines(formatted.lines);
      const trimmedReason = reason && String(reason).trim() ? String(reason).trim() : null;

      const logId = `LOG-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
      const auditLog = {
        id: logId,
        action_type: 'quote_approval',
        arguments: JSON.stringify({
          quote_id: quote.id,
          quote_number: quote.quote_number,
          total_amount: formatted.total_amount,
          below_standard_lines: belowStandardLines,
          reason: trimmedReason
        }),
        decision: 'approved',
        operator: activeUid,
        timestamp: now
      };
      mockAuditLogs.unshift(auditLog);
      saveStorage('agent_erp_mock_audit_logs', mockAuditLogs);
      saveStorage('agent_erp_mock_quotes', mockQuotes);

      return formatted;
    }

    case 'reject_quote': {
      const { quote_id, quoteId, reason, today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const activeUid = resolveMockActiveUserId();
      const qId = (quote_id || quoteId || '').trim();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const trimmedReason = reason !== undefined && reason !== null ? String(reason).trim() : '';
      if (!trimmedReason) {
        throw new Error('駁回理由為必填');
      }

      const quote = mockQuotes.find(q => q.id === qId && (q.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (!quote) throw new Error('找不到報價單或不屬於目前租戶');
      if (['converted', 'declined', 'expired', 'cancelled'].includes(quote.status)) {
        throw new Error('此報價單已結案，無法修改');
      }
      if (quote.status !== 'pending_approval') {
        throw new Error('目前狀態不允許此操作');
      }

      const now = Math.floor(Date.now() / 1000);
      quote.status = 'draft';
      quote.approval_rejection_reason = trimmedReason;

      const formatted = formatMockQuote(quote);
      const belowStandardLines = getMockBelowStandardLines(formatted.lines);

      const logId = `LOG-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
      const auditLog = {
        id: logId,
        action_type: 'quote_approval',
        arguments: JSON.stringify({
          quote_id: quote.id,
          quote_number: quote.quote_number,
          total_amount: formatted.total_amount,
          below_standard_lines: belowStandardLines,
          reason: trimmedReason
        }),
        decision: 'rejected',
        operator: activeUid,
        timestamp: now
      };
      mockAuditLogs.unshift(auditLog);
      saveStorage('agent_erp_mock_audit_logs', mockAuditLogs);
      saveStorage('agent_erp_mock_quotes', mockQuotes);

      return formatted;
    }

    case 'list_pending_approval_quotes': {
      const { today_override } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const today = today_override || new Date().toISOString().slice(0, 10);
      expireMockQuotes(targetTenantId, today);

      const pendingQuotes = mockQuotes.filter(
        q => (q.tenant_id || 'tnt_mock_1') === targetTenantId && q.status === 'pending_approval'
      );
      pendingQuotes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      return pendingQuotes.map(q => {
        const formatted = formatMockQuote(q);
        const belowStandardLines = getMockBelowStandardLines(formatted.lines);
        return {
          quote: formatted.quote,
          below_standard_lines: belowStandardLines,
          total_amount: formatted.total_amount
        };
      });
    }

    case 'reset_mock_quotes': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        const removedQuoteIds = new Set(
          mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') === targetTid).map(q => q.id)
        );
        mockQuotes = mockQuotes.filter(q => (q.tenant_id || 'tnt_mock_1') !== targetTid);
        mockQuoteLines = mockQuoteLines.filter(l => !removedQuoteIds.has(l.quote_id));
      } else {
        mockQuotes = [];
        mockQuoteLines = [];
      }
      saveStorage('agent_erp_mock_quotes', mockQuotes);
      saveStorage('agent_erp_mock_quote_lines', mockQuoteLines);
      return true;
    }

    case 'ship_sales_order': {
      const {
        order_id,
        orderId,
        ship_date,
        shipDate,
        line_shipped_quantities,
        lineShippedQuantities,
        note,
        today_override,
        todayOverride
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = resolveMockActiveUserId();
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const rawToday = today_override !== undefined ? today_override : todayOverride;
      const today = (rawToday !== undefined && rawToday !== null && String(rawToday).trim() !== '')
        ? validateMockCalendarDate(rawToday)
        : new Date().toISOString().slice(0, 10);

      const rawShipDate = ship_date !== undefined ? ship_date : shipDate;
      let resolvedShipDate = today;
      if (rawShipDate !== undefined && rawShipDate !== null && String(rawShipDate).trim() !== '') {
        resolvedShipDate = validateMockCalendarDate(rawShipDate);
        if (resolvedShipDate > today) {
          throw new Error('出貨日不可晚於今天');
        }
      }
      const cleanNote = note !== undefined && note !== null && String(note).trim() !== ''
        ? String(note).trim()
        : null;

      const targetOrderId = String(order_id || orderId || '').trim();
      const order = mockSalesOrders.find(
        o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (!order) {
        throw new Error('找不到銷售單或不屬於目前租戶');
      }
      if (order.status !== 'confirmed' && order.status !== 'partially_shipped') {
        throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 shipped`);
      }

      const wh = validateMockWarehouseActive(targetTenantId, order.warehouse_id);

      const lines = mockSalesOrderLines
        .filter(l => l.sales_order_id === order.id)
        .sort((a, b) => a.line_no - b.line_no);
      if (lines.length === 0) {
        throw new Error('銷售單至少需有 1 筆明細');
      }

      const knownLineIds = new Set(lines.map(l => l.id));
      const overrideMap = new Map();
      const rawInputs = line_shipped_quantities !== undefined ? line_shipped_quantities : lineShippedQuantities;
      if (Array.isArray(rawInputs)) {
        for (const item of rawInputs) {
          const lid = String(item?.line_id || item?.lineId || '').trim();
          if (!knownLineIds.has(lid)) {
            throw new Error('找不到指定的銷售單明細行');
          }
          if (overrideMap.has(lid)) {
            throw new Error('出貨明細重複指定同一行');
          }
          const qtyVal = item.shipped_quantity !== undefined ? item.shipped_quantity : item.shippedQuantity;
          overrideMap.set(lid, Number(qtyVal));
        }
      } else if (rawInputs && typeof rawInputs === 'object') {
        for (const [k, v] of Object.entries(rawInputs)) {
          const lid = String(k).trim();
          if (!knownLineIds.has(lid)) {
            throw new Error('找不到指定的銷售單明細行');
          }
          overrideMap.set(lid, Number(v));
        }
      }

      const resolvedLines = [];
      let totalShipped = 0;
      let allFullyShipped = true;
      for (const line of lines) {
        const orderedQty = Number(line.quantity);
        const alreadyShipped = Number(line.shipped_quantity || 0);
        const remainingQty = Math.max(0, orderedQty - alreadyShipped);
        const actualQty = overrideMap.has(line.id) ? overrideMap.get(line.id) : remainingQty;
        if (!Number.isFinite(actualQty) || actualQty < 0) {
          throw new Error('出貨數量不可小於 0');
        }
        if (actualQty > remainingQty + 1e-9) {
          throw new Error(alreadyShipped <= 1e-9 ? '出貨數量不可超過訂購數量' : '出貨數量不可超過剩餘可出貨數量');
        }
        let newCumShipped = alreadyShipped + actualQty;
        if (newCumShipped + 1e-9 >= orderedQty) {
          if (newCumShipped > orderedQty) newCumShipped = orderedQty;
        } else {
          allFullyShipped = false;
        }
        totalShipped += actualQty;
        resolvedLines.push({ line, actualQty, newCumShipped });
      }
      if (totalShipped <= 0) {
        throw new Error('出貨數量合計需大於 0');
      }

      // Check stock atomically before mutating anything
      for (const { line, actualQty } of resolvedLines) {
        if (actualQty <= 0) continue;
        let currentStock = 0;
        for (const m of mockInventoryMovements) {
          if (
            (m.tenant_id || 'tnt_mock_1') === targetTenantId &&
            m.unit_id === line.unit_id &&
            m.warehouse_id === wh.id
          ) {
            currentStock += Number(m.quantity_delta || 0);
          }
        }
        if (currentStock + 1e-9 < actualQty) {
          throw new Error(
            `〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${wh.name}〕現有 ${formatMockQty(currentStock)}，不足出貨 ${formatMockQty(actualQty)}`
          );
        }
      }

      const now = Math.floor(Date.now() / 1000);
      order.status = allFullyShipped ? 'shipped' : 'partially_shipped';
      order.ship_date = resolvedShipDate;
      order.shipped_by = activeUid;
      order.shipped_at = now;

      const shipmentId = nextMockUid('shp');
      const shipmentNumber = nextMockShipmentNumber(targetTenantId);
      mockSalesShipments.push({
        id: shipmentId,
        tenant_id: targetTenantId,
        sales_order_id: order.id,
        shipment_number: shipmentNumber,
        warehouse_id: wh.id,
        ship_date: resolvedShipDate,
        note: cleanNote,
        shipped_by: activeUid,
        shipped_at: now,
        created_at: now
      });

      for (const { line, actualQty, newCumShipped } of resolvedLines) {
        line.shipped_quantity = newCumShipped;
        if (actualQty <= 0) continue;
        mockSalesShipmentLines.push({
          id: nextMockUid('shpl'),
          shipment_id: shipmentId,
          sales_order_line_id: line.id,
          line_no: line.line_no,
          unit_id: line.unit_id,
          product_name_snapshot: line.product_name_snapshot,
          variant_name_snapshot: line.variant_name_snapshot,
          sku_snapshot: line.sku_snapshot || null,
          unit_name_snapshot: line.unit_name_snapshot,
          shipped_quantity: actualQty,
          unit_price: Number(line.unit_price),
          created_at: now
        });
        mockInventoryMovements.push({
          id: nextMockUid('mov_so'),
          tenant_id: targetTenantId,
          unit_id: line.unit_id,
          warehouse_id: wh.id,
          quantity_delta: -actualQty,
          unit_cost: null,
          reason: 'sales_shipment',
          reference_type: 'sales_order',
          reference_id: order.id,
          created_by: activeUid,
          created_at: now
        });
      }

      saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
      saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
      saveStorage('agent_erp_mock_sales_shipments', mockSalesShipments);
      saveStorage('agent_erp_mock_sales_shipment_lines', mockSalesShipmentLines);
      saveStorage('agent_erp_mock_inventory_movements', mockInventoryMovements);
      return formatMockSalesOrder(order);
    }

    case 'cancel_sales_order': {
      const { order_id, orderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const activeUid = resolveMockActiveUserId();
      if (!activeUid || !activeUid.trim()) {
        throw new Error('無法解析有效使用者 session，操作被拒絕');
      }

      const targetOrderId = String(order_id || orderId || '').trim();
      const order = mockSalesOrders.find(
        o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (!order) {
        throw new Error('找不到銷售單或不屬於目前租戶');
      }
      if (order.status !== 'confirmed') {
        throw new Error(`無效的狀態轉換：不可從 ${order.status} 轉換至 cancelled`);
      }

      const now = Math.floor(Date.now() / 1000);
      order.status = 'cancelled';
      order.cancelled_at = now;

      saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
      return formatMockSalesOrder(order);
    }

    case 'get_sales_order': {
      const { order_id, orderId } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      const targetOrderId = String(order_id || orderId || '').trim();
      const order = mockSalesOrders.find(
        o => o.id === targetOrderId && (o.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (!order) {
        throw new Error('找不到銷售單或不屬於目前租戶');
      }
      return formatMockSalesOrder(order);
    }

    case 'list_sales_orders': {
      const {
        status,
        customer_partner_id,
        customerPartnerId,
        warehouse_id,
        warehouseId
      } = args || {};
      const targetTenantId = resolveMockActiveTenantId();
      if (!targetTenantId || !targetTenantId.trim()) {
        throw new Error('Tenant ID cannot be empty');
      }
      let list = mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === targetTenantId);
      if (status && String(status).trim()) {
        const st = String(status).trim();
        list = list.filter(o => o.status === st);
      }
      const cid = customer_partner_id !== undefined ? customer_partner_id : customerPartnerId;
      if (cid && String(cid).trim()) {
        const c = String(cid).trim();
        list = list.filter(o => o.customer_partner_id === c);
      }
      const wid = warehouse_id !== undefined ? warehouse_id : warehouseId;
      if (wid && String(wid).trim()) {
        const w = String(wid).trim();
        list = list.filter(o => o.warehouse_id === w);
      }
      list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return list.map(o => formatMockSalesOrder(o).order);
    }

    case 'seed_mock_sales_order': {
      // Test-only helper for mocking confirmed sales orders (since #220 has no create_sales_order command)
      const payload = args?.input || args || {};
      const targetTenantId = resolveMockActiveTenantId();
      const activeUid = resolveMockActiveUserId();
      const sourceQuoteId = String(payload.source_quote_id || payload.sourceQuoteId || '').trim();
      if (!sourceQuoteId) {
        throw new Error('來源報價單 ID 不可為空');
      }
      if (mockSalesOrders.some(o => o.source_quote_id === sourceQuoteId)) {
        throw new Error('此報價單已轉換過銷售單，不可重複轉單');
      }
      const customerId = String(payload.customer_partner_id || payload.customerPartnerId || '').trim();
      const customer = mockPartners.find(
        p => p.id === customerId && (p.tenant_id || 'tnt_mock_1') === targetTenantId
      );
      if (!customer || !customer.is_customer || customer.is_active === false) {
        throw new Error('找不到此客戶，或該往來對象未設定為客戶');
      }
      const rawWhId = payload.warehouse_id !== undefined ? payload.warehouse_id : payload.warehouseId;
      const wh = (rawWhId && String(rawWhId).trim())
        ? validateMockWarehouseActive(targetTenantId, rawWhId)
        : resolveMockDefaultWarehouse(targetTenantId);

      const rawCurrency = payload.currency ? String(payload.currency).trim() : 'TWD';
      if (rawCurrency !== 'TWD') {
        throw new Error('幣別僅支援 TWD');
      }
      const rawExpected = payload.expected_ship_date !== undefined ? payload.expected_ship_date : payload.expectedShipDate;
      const expectedShipDate = (rawExpected && String(rawExpected).trim())
        ? validateMockCalendarDate(rawExpected)
        : null;

      const inputLines = Array.isArray(payload.lines) ? payload.lines : [];
      if (inputLines.length === 0) {
        throw new Error('銷售單至少需有 1 筆明細');
      }
      const seenUnits = new Set();
      for (const l of inputLines) {
        const uid = String(l.unit_id || l.unitId || '').trim();
        resolveMockUnitSnapshot(targetTenantId, uid);
        if (seenUnits.has(uid)) {
          throw new Error('同一銷售單內商品單位不可重複');
        }
        seenUnits.add(uid);
        const qty = Number(l.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error('數量必須大於 0');
        }
        const price = Number(l.unit_price);
        if (!Number.isFinite(price) || price < 0) {
          throw new Error('單價不可為負數');
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const soId = nextMockUid('so');
      const soNumber = nextMockSoNumber(targetTenantId);
      const order = {
        id: soId,
        tenant_id: targetTenantId,
        so_number: soNumber,
        customer_partner_id: customer.id,
        customer_name_snapshot: payload.customer_name_snapshot ? String(payload.customer_name_snapshot).trim() : customer.name,
        customer_reference: payload.customer_reference ? String(payload.customer_reference).trim() : null,
        source_quote_id: sourceQuoteId,
        warehouse_id: wh.id,
        currency: 'TWD',
        status: 'confirmed',
        expected_ship_date: expectedShipDate,
        ship_date: null,
        note: payload.note ? String(payload.note).trim() : null,
        created_by: activeUid,
        created_at: now,
        confirmed_at: now,
        shipped_by: null,
        shipped_at: null,
        cancelled_at: null,
        task_id: payload.task_id || null
      };
      mockSalesOrders.push(order);

      inputLines.forEach((l, idx) => {
        mockSalesOrderLines.push({
          id: nextMockUid('sol'),
          sales_order_id: soId,
          line_no: idx + 1,
          unit_id: String(l.unit_id || l.unitId).trim(),
          product_name_snapshot: String(l.product_name_snapshot).trim(),
          variant_name_snapshot: String(l.variant_name_snapshot).trim(),
          sku_snapshot: l.sku_snapshot ? String(l.sku_snapshot).trim() : null,
          unit_name_snapshot: String(l.unit_name_snapshot).trim(),
          quantity: Number(l.quantity),
          shipped_quantity: null,
          unit_price: Number(l.unit_price),
          standard_price_snapshot: Number(l.standard_price_snapshot ?? l.unit_price),
          created_at: now
        });
      });

      saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
      saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
      return formatMockSalesOrder(order);
    }

    case 'reset_mock_sales_orders': {
      const { tenant_id, tenantId } = args || {};
      const targetTid = tenant_id || tenantId;
      if (targetTid) {
        const removedIds = new Set(
          mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') === targetTid).map(o => o.id)
        );
        const removedShipmentIds = new Set(
          mockSalesShipments.filter(s => removedIds.has(s.sales_order_id)).map(s => s.id)
        );
        mockSalesOrders = mockSalesOrders.filter(o => (o.tenant_id || 'tnt_mock_1') !== targetTid);
        mockSalesOrderLines = mockSalesOrderLines.filter(l => !removedIds.has(l.sales_order_id));
        mockSalesShipments = mockSalesShipments.filter(s => !removedIds.has(s.sales_order_id));
        mockSalesShipmentLines = mockSalesShipmentLines.filter(sl => !removedShipmentIds.has(sl.shipment_id));
      } else {
        mockSalesOrders = [];
        mockSalesOrderLines = [];
        mockSalesShipments = [];
        mockSalesShipmentLines = [];
      }
      saveStorage('agent_erp_mock_sales_orders', mockSalesOrders);
      saveStorage('agent_erp_mock_sales_order_lines', mockSalesOrderLines);
      saveStorage('agent_erp_mock_sales_shipments', mockSalesShipments);
      saveStorage('agent_erp_mock_sales_shipment_lines', mockSalesShipmentLines);
      return true;
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
