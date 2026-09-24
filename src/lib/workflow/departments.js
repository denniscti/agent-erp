/**
 * @file departments.js
 * @description ToolHandler declarations and AgentProfile for Department setup and management.
 */

import { invoke } from '../tauri.js';

/** @type {import('./types.js').ToolHandler} */
export const createDepartmentToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'create_department',
      description: '建立或新增一個組織部門',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '欲建立的部門名稱，例如：行銷部、研發部、IT專責小組'
          }
        },
        required: ['name']
      }
    }
  },
  requiresConfirmation: true,
  completesTask: true,
  confirmLabel: '確認建立',
  cancelLabel: '取消',

  describeConfirmation(args, context = {}) {
    const name = args?.name ? String(args.name).trim() : '新部門';
    const isDone = context?.activeTask?.status === 'done';
    return isDone
      ? `偵測到您想額外建立「${name}」，確認要建立嗎？`
      : `偵測到您想建立「${name}」，確認要建立嗎？`;
  },

  describeTaskSummary(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新部門';
    return `✅「設定部門」已完成，新增了『${name}』`;
  },

  describeToast(_result, args) {
    const name = args?.name ? String(args.name).trim() : '新部門';
    return `已成功建立「${name}」！`;
  },

  async execute(args) {
    const name = args?.name ? String(args.name).trim() : '';
    if (!name) {
      throw new Error('部門名稱不能為空');
    }

    return await invoke('create_department', {
      name,
      parentId: args?.parentId || null
    });
  },

  formatResult(_result, args) {
    const name = args?.name ? String(args.name).trim() : '';
    return `已為您建立「${name}」！`;
  },

  describeCancel() {
    return '好的，請告訴我正確的部門名稱';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();

    // 1. Quoted department name: 「行銷部」, "研發部"
    const quoteMatch = trimmed.match(/[「『"']([\u4e00-\u9fa5A-Za-z0-9]{2,12}部)[」』"']/);
    if (quoteMatch) return { tool: 'create_department', name: quoteMatch[1] };

    // 2. Action verb prefix: 幫我新增/建立/設立 行銷部
    const actionMatch = trimmed.match(/(?:新增|建立|成立|設定|設立|創立|加)\s*(?:一個|一組)?\s*([A-Za-z0-9\u4e00-\u9fa5]{2,10}部)/);
    if (actionMatch) return { tool: 'create_department', name: actionMatch[1] };

    // 3. Any 2~10 Chinese/alphanumeric characters ending with '部'
    const stopWords = ['全部', '一部', '內部', '外部', '這部', '那部', '各部', '本部', '局部', '首部'];
    const words = trimmed.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,10}部/g);
    if (words) {
      for (const w of words) {
        if (!stopWords.includes(w)) {
          return { tool: 'create_department', name: w };
        }
      }
    }
    return null;
  }
};

/** @type {import('./types.js').ToolHandler} */
export const listDepartmentsToolHandler = {
  definition: {
    type: 'function',
    function: {
      name: 'list_departments',
      description: '列出或查詢目前系統中已建立的所有部門列表',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  requiresConfirmation: true,
  confirmLabel: '確認查詢',
  cancelLabel: '取消',

  describeConfirmation() {
    return '偵測到您想查詢目前已建立的組織部門列表，確認要查詢嗎？';
  },

  describeToast() {
    return '已完成部門列表查詢！';
  },

  async execute() {
    const list = await invoke('list_departments');
    return list || [];
  },

  formatResult(depts) {
    if (Array.isArray(depts) && depts.length > 0) {
      const deptNames = depts
        .map((d, i) => `${i + 1}. ${d.name}${d.parent_id ? ' (子部門)' : ''}`)
        .join('\n');
      return `目前系統中已建立的部門列表（共 ${depts.length} 個）：\n${deptNames}`;
    }
    return '目前系統中尚未建立任何部門。您可以告訴我想建立的部門名稱（例如「行銷部」、「研發部」）。';
  },

  describeCancel() {
    return '好的，已取消部門列表查詢。';
  },

  extractCandidateRegex(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (
      trimmed.includes('列') ||
      trimmed.includes('查') ||
      trimmed.includes('哪些部門') ||
      trimmed.includes('部門列表') ||
      trimmed.includes('清單')
    ) {
      return { tool: 'list_departments' };
    }
    return null;
  }
};

/** @type {import('./types.js').AgentProfile} */
export const departmentAgentProfile = {
  systemPrompt: '你是一個組織架構助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。',
  tools: [
    listDepartmentsToolHandler.definition,
    createDepartmentToolHandler.definition
  ],
  toolHandlers: [
    listDepartmentsToolHandler,
    createDepartmentToolHandler
  ],
  getFallbackMessage(activeTask) {
    return activeTask?.status !== 'done'
      ? '請告訴我想建立的部門名稱（例如「行銷部」、「研發部」），或詢問目前有哪些已建立的部門。'
      : '「設定部門」任務已於稍早完成。若您想繼續新增其他部門或查詢列表，請直接告訴我。';
  },
  quickAction: {
    title: '🏢 快速建立部門引導',
    desc: '點擊下方按鈕可快速觸發建立「銷售部」的確認流程：',
    buttonText: '✨ 建立「銷售部」並完成任務',
    defaultTool: 'create_department',
    defaultArgs: { name: '銷售部' }
  }
};
