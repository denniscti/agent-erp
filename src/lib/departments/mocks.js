// @ts-check
import { loadStorage, saveStorage, resolveMockActiveTenantId } from '../mockStorage.js';

export function createDefaultMockDepartments(tenantId = 'tnt_mock_1') {
  return [
    { id: "dept_mock_1", tenant_id: tenantId, name: "總經理室", parent_id: null, skills: ["org.manage", "audit.trace_view", "department.manage", "vendor.manage_purchase_order", "vendor.manage", "vendor.create_basic_profile", "product.manage", "product.create_basic_profile", "customer.create_basic_profile", "customer.view"], created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
    { id: "dept_mock_2", tenant_id: tenantId, name: "研發總處", parent_id: null, skills: ["dev.repo_write", "dev.agent_config", "product.manage"], created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
    { id: "dept_mock_3", tenant_id: tenantId, name: "前端小組", parent_id: "dept_mock_2", skills: ["ui.build", "ui.component_test"], created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
    { id: "dept_mock_4", tenant_id: tenantId, name: "後端架構組", parent_id: "dept_mock_2", skills: ["backend.api_build", "db.migrate"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 },
    { id: "dept_mock_5", tenant_id: tenantId, name: "行銷業務部", parent_id: null, skills: ["sales.lead_manage", "crm.read", "customer.create_basic_profile", "customer.view"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 },
    { id: "dept_mock_6", tenant_id: tenantId, name: "財務會計處", parent_id: null, skills: ["finance.view", "invoice.issue", "vendor.manage_purchase_order", "vendor.manage"], created_at: Math.floor(Date.now() / 1000) - 86400 * 1 }
  ];
}

export let mockDepartments = loadStorage('agent_erp_mock_departments', null);
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

export const departmentMocks = {
  create_department: async (args) => {
    const { name, parentId, parent_id } = args || {};
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
  },

  list_departments: async () => {
    const targetTenantId = resolveMockActiveTenantId();
    return mockDepartments.filter(d => (d.tenant_id || 'tnt_mock_1') === targetTenantId);
  },

  update_department_skills: async (args) => {
    const { department_id, departmentId, skills } = args || {};
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
  },

  detect_department_intent: async () => {
    return { attempted: false, tool_call: null };
  }
};

