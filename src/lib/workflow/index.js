/**
 * @file index.js
 * @description Task-Driven Workflow Registry and exports.
 */

import { departmentAgentProfile } from './departments.js';
import {
  customerCreateBasicProfileAgentProfile,
  vendorCreateBasicProfileAgentProfile
} from './partners.js';
import { isKnownDomain } from './domains.js';

export * from './types.js';
export * from './harness.js';
export * from './departments.js';
export * from './partners.js';
export * from './domains.js';

/**
 * Task to AgentProfile registry mapping
 * @type {Map<string, import('./types.js').AgentProfile>}
 */
const taskProfileMap = new Map();

// Register built-in profiles
registerAgentProfile('department.manage', departmentAgentProfile);
registerAgentProfile('task_m2_dept', departmentAgentProfile);
registerAgentProfile('departments', departmentAgentProfile);
registerAgentProfile('customer.create_basic_profile', customerCreateBasicProfileAgentProfile);
registerAgentProfile('task_m3_customer', customerCreateBasicProfileAgentProfile);
registerAgentProfile('customers', customerCreateBasicProfileAgentProfile);
registerAgentProfile('vendor.create_basic_profile', vendorCreateBasicProfileAgentProfile);
registerAgentProfile('task_m4_vendor', vendorCreateBasicProfileAgentProfile);
registerAgentProfile('vendors', vendorCreateBasicProfileAgentProfile);

/**
 * System declared skills registry
 * @type {import('./types.js').DeclaredSkill[]}
 */
const declaredSkillsList = [
  {
    id: 'department.manage',
    name: '設定部門與組織架構',
    domain: 'department',
    description: '建立與查詢組織部門架構，維護組織階層關係'
  },
  {
    id: 'customer.create_basic_profile',
    name: '新增客戶基本資料',
    domain: 'customer',
    description: '建立新客戶基本檔案、統編與主要聯絡資訊'
  },
  {
    id: 'customer.view',
    name: '檢視客戶資料與歷史',
    domain: 'customer',
    description: '查詢客戶基本資料、歷史往來紀錄與聯絡人'
  },
  {
    id: 'vendor.manage',
    name: '供應商基本資料管理',
    domain: 'vendor',
    description: '建立與維護供應商基本資料、廠商編號與付款條件'
  },
  {
    id: 'vendor.create_basic_profile',
    name: '新增供應商基本資料',
    domain: 'vendor',
    description: '建立新供應商基本檔案與採購聯絡資訊'
  }
];

/**
 * Resolves the appropriate AgentProfile for a given task.
 * Prioritizes direct lookup via task.skillId (or task.skill_id),
 * with backward-compatible fallback to title keyword matching.
 * @param {any} task
 * @returns {import('./types.js').AgentProfile | null}
 */
export function getAgentProfileForTask(task) {
  if (!task) return null;

  // 1. Priority: Check declared skillId in taskProfileMap
  const rawSkillId = task.skillId || task.skill_id;
  const skillId = rawSkillId ? String(rawSkillId).trim() : '';
  if (skillId && taskProfileMap.has(skillId)) {
    return taskProfileMap.get(skillId) || null;
  }

  // 2. Check exact task id match
  if (task.id && taskProfileMap.has(task.id)) {
    return taskProfileMap.get(task.id) || null;
  }

  // 3. Check moduleId match
  const rawModuleId = task.moduleId || task.module_id;
  const moduleId = rawModuleId ? String(rawModuleId).trim() : '';
  if (moduleId && taskProfileMap.has(moduleId)) {
    return taskProfileMap.get(moduleId) || null;
  }

  // 4. Fallback check for department subtask title
  if (task.title && task.title.includes('設定部門')) {
    return departmentAgentProfile;
  }

  // 5. Fallback check for vendor subtask title
  if (task.title && (task.title.includes('新增供應商') || task.title.includes('建立供應商') || task.title.includes('供應商') || task.title.includes('廠商'))) {
    return vendorCreateBasicProfileAgentProfile;
  }

  // 6. Fallback check for customer subtask title
  if (task.title && (task.title.includes('新增客戶') || task.title.includes('建立客戶') || task.title.includes('客戶'))) {
    return customerCreateBasicProfileAgentProfile;
  }

  return null;
}

/**
 * Registers a custom AgentProfile for a task ID or module ID.
 * Allows new modules to reuse the core workflow loop without changing core files.
 * @param {string} key - Task ID or Module ID
 * @param {import('./types.js').AgentProfile} profile
 */
export function registerAgentProfile(key, profile) {
  if (profile && profile.domain && !isKnownDomain(profile.domain)) {
    throw new Error(
      `[Workflow Registry] Unknown domain "${profile.domain}" for profile "${profile.id || key}". Must be declared in KNOWN_DOMAINS.`
    );
  }
  taskProfileMap.set(key, profile);
}

/**
 * Get all declared skills in the system.
 * @returns {import('./types.js').DeclaredSkill[]}
 */
export function getDeclaredSkills() {
  return [...declaredSkillsList];
}

/**
 * Registers a new skill definition into the declared skills registry.
 * @param {import('./types.js').DeclaredSkill} skill
 */
export function registerDeclaredSkill(skill) {
  if (!skill || !skill.id || !skill.domain) {
    throw new Error('Skill must contain non-empty "id" and "domain"');
  }
  if (!isKnownDomain(skill.domain)) {
    throw new Error(
      `[Workflow Registry] Unknown domain "${skill.domain}" for skill "${skill.id}". Must be declared in KNOWN_DOMAINS.`
    );
  }
  const existingIdx = declaredSkillsList.findIndex(s => s.id === skill.id);
  if (existingIdx >= 0) {
    declaredSkillsList[existingIdx] = { ...declaredSkillsList[existingIdx], ...skill };
  } else {
    declaredSkillsList.push(skill);
  }
}

/**
 * Retrieves declared skills grouped or filtered by domain.
 * @param {string} [domain]
 * @returns {import('./types.js').DeclaredSkill[]}
 */
export function getSkillsByDomain(domain) {
  if (!domain) return getDeclaredSkills();
  const trimmed = domain.trim();
  return declaredSkillsList.filter(s => s.domain === trimmed);
}
