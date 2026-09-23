/**
 * @file index.js
 * @description Task-Driven Workflow Registry and exports.
 */

import { departmentAgentProfile } from './departments.js';

export * from './types.js';
export * from './harness.js';
export * from './departments.js';

/**
 * Task to AgentProfile registry mapping
 * @type {Map<string, import('./types.js').AgentProfile>}
 */
const taskProfileMap = new Map();

// Register built-in profiles
taskProfileMap.set('task_m2_dept', departmentAgentProfile);
taskProfileMap.set('departments', departmentAgentProfile);

/**
 * Resolves the appropriate AgentProfile for a given task.
 * @param {any} task
 * @returns {import('./types.js').AgentProfile | null}
 */
export function getAgentProfileForTask(task) {
  if (!task) return null;

  // 1. Check exact task id match
  if (task.id && taskProfileMap.has(task.id)) {
    return taskProfileMap.get(task.id) || null;
  }

  // 2. Check moduleId match
  if (task.moduleId && taskProfileMap.has(task.moduleId)) {
    return taskProfileMap.get(task.moduleId) || null;
  }

  // 3. Fallback check for department subtask title
  if (task.title && task.title.includes('設定部門')) {
    return departmentAgentProfile;
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
  taskProfileMap.set(key, profile);
}
