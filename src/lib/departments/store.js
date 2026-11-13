// @ts-check
import { invoke } from '../tauri.js';
import {
  appState,
  showToast,
  fetchAuditLogs,
  updateTaskStatusAction,
  appendTaskMessageAction
} from '../store.svelte.js';

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
 * Filter declared skills list by search keyword (case-insensitive across name, id, domain, description)
 * @param {import('../workflow/types.js').DeclaredSkill[]} skills
 * @param {string} [keyword]
 * @returns {import('../workflow/types.js').DeclaredSkill[]}
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
  const memberRecord = members.find(m => m.id === authUser.id || m.email === authUser.email);
  if (memberRecord && Array.isArray(memberRecord.department_ids)) {
    return getEffectiveSkills(memberRecord.department_ids, state.departments);
  }

  return [];
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

