import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkToolWhitelist,
  detectIntentWithFallback,
  runAgentTurn,
  executeConfirmation,
  executeCancellation
} from '../src/lib/workflow/harness.js';

import {
  createDepartmentToolHandler,
  listDepartmentsToolHandler,
  departmentAgentProfile
} from '../src/lib/workflow/departments.js';

import {
  getAgentProfileForTask,
  registerAgentProfile
} from '../src/lib/workflow/index.js';

test('TC-HN-01: create_department normal intent requires confirmation', async () => {
  // Given: Preconditions - Department AgentProfile and LLM returns create_department
  const userMessage = '我想建立行銷部';
  const mockLLM = async () => ({ tool: 'create_department', name: '行銷部' });
  const context = { taskId: 'task_m2_dept', activeTask: { id: 'task_m2_dept', status: 'pending' } };

  // When:  Operation to execute - Run one agent turn through harness
  const turnResult = await runAgentTurn(userMessage, departmentAgentProfile, context, { llmDetector: mockLLM });

  // Then:  Expected result - Returns pending_confirmation with formatted text
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_department');
  assert.equal(turnResult.confirmation.args.name, '行銷部');
  assert.equal(turnResult.content, '偵測到您想建立「行銷部」，確認要建立嗎？');
  assert.equal(turnResult.confirmation.confirmLabel, '確認建立');
  assert.equal(turnResult.confirmation.cancelLabel, '取消');
});

test('TC-HN-02: create_department user confirmation executes handler and formats result', async () => {
  // Given: Preconditions - A pending confirmation for create_department with mock actions
  let createdDeptName = null;
  let taskStatusUpdated = null;
  let reportedMainMessage = null;

  const mockHandler = {
    ...createDepartmentToolHandler,
    async execute(args, ctx) {
      createdDeptName = args.name;
      if (ctx.taskId) {
        taskStatusUpdated = 'done';
        reportedMainMessage = `✅「設定部門」已完成，新增了『${args.name}』`;
      }
      return { id: 'dept_123', name: args.name };
    }
  };

  const confirmation = {
    toolName: 'create_department',
    handler: mockHandler,
    args: { name: '研發部' },
    confirmText: '偵測到您想建立「研發部」，確認要建立嗎？',
    taskId: 'task_m2_dept'
  };

  // When:  Operation to execute - User confirms the action
  const execResult = await executeConfirmation(confirmation, { taskId: 'task_m2_dept' });

  // Then:  Expected result - Execution succeeded, status updated, result formatted
  assert.equal(createdDeptName, '研發部');
  assert.equal(taskStatusUpdated, 'done');
  assert.equal(reportedMainMessage, '✅「設定部門」已完成，新增了『研發部』');
  assert.equal(execResult.content, '已為您建立「研發部」！');
  assert.equal(execResult.toolName, 'create_department');
});

test('TC-HN-03: create_department user cancellation invokes describeCancel', async () => {
  // Given: Preconditions - A pending confirmation for create_department
  const confirmation = {
    toolName: 'create_department',
    handler: createDepartmentToolHandler,
    args: { name: '研發部' },
    confirmText: '偵測到您想建立「研發部」，確認要建立嗎？',
    taskId: 'task_m2_dept'
  };

  // When:  Operation to execute - User cancels the action
  const cancelResult = executeCancellation(confirmation, { taskId: 'task_m2_dept' });

  // Then:  Expected result - Custom cancel guidance returned
  assert.equal(cancelResult.content, '好的，請告訴我正確的部門名稱');
  assert.equal(cancelResult.toolName, 'create_department');
});

test('TC-HN-04: list_departments normal intent and execution formatting', async () => {
  // Given: Preconditions - Department AgentProfile and LLM returns list_departments
  const userMessage = '查詢部門列表';
  const mockLLM = async () => ({ tool: 'list_departments' });
  const context = { taskId: 'task_m2_dept', activeTask: { id: 'task_m2_dept', status: 'pending' } };

  // When:  Operation to execute - Run agent turn
  const turnResult = await runAgentTurn(userMessage, departmentAgentProfile, context, { llmDetector: mockLLM });

  // Then:  Expected result - Pending confirmation for query
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'list_departments');
  assert.equal(turnResult.content, '偵測到您想查詢目前已建立的組織部門列表，確認要查詢嗎？');

  // When:  Executing confirmation with mock department list
  const mockListHandler = {
    ...listDepartmentsToolHandler,
    async execute() {
      return [
        { id: 'dept_1', name: '業務部', parent_id: null },
        { id: 'dept_2', name: '銷售一組', parent_id: 'dept_1' }
      ];
    }
  };

  const listExec = await executeConfirmation({
    toolName: 'list_departments',
    handler: mockListHandler,
    args: {},
    confirmText: turnResult.content,
    taskId: 'task_m2_dept'
  });

  // Then:  Formatted department list is returned
  assert.ok(listExec.content.includes('共 2 個'));
  assert.ok(listExec.content.includes('1. 業務部'));
  assert.ok(listExec.content.includes('2. 銷售一組 (子部門)'));
});

test('TC-HN-05: tool with requiresConfirmation: false executes directly without pending card', async () => {
  // Given: Preconditions - Custom tool configured with requiresConfirmation: false
  let executedCount = 0;
  const directToolHandler = {
    definition: {
      type: 'function',
      function: {
        name: 'read_status',
        description: 'Read system status',
        parameters: {}
      }
    },
    requiresConfirmation: false,
    describeConfirmation: () => '確認讀取？',
    execute: async () => {
      executedCount++;
      return { status: 'healthy', count: 42 };
    },
    formatResult: (res) => `系統狀態良好，計數：${res.count}`
  };

  const profile = {
    systemPrompt: 'Read-only bot',
    tools: [directToolHandler.definition],
    toolHandlers: [directToolHandler]
  };

  // When:  Operation to execute - Run turn when LLM selects read_status
  const turnResult = await runAgentTurn('查詢系統狀態', profile, {}, {
    llmDetector: async () => ({ tool: 'read_status' })
  });

  // Then:  Expected result - Directly executed, no pending confirmation
  assert.equal(turnResult.type, 'executed');
  assert.equal(executedCount, 1);
  assert.equal(turnResult.content, '系統狀態良好，計數：42');
});

test('TC-SEC-01: AI selecting unauthorized tool is blocked by whitelist check (non-silent fail)', async () => {
  // Given: Preconditions - Profile only allows department tools, LLM hallucinates/attacks delete_database
  const userMessage = '刪除所有資料庫';
  const mockAttackLLM = async () => ({ tool: 'delete_database', target: '*' });

  // When:  Operation to execute - Run turn
  const turnResult = await runAgentTurn(userMessage, departmentAgentProfile, {}, { llmDetector: mockAttackLLM });

  // Then:  Expected result - Intercepted with security error, NOT executed, non-silent fail
  assert.equal(turnResult.type, 'error');
  assert.equal(turnResult.error, 'Unauthorized tool call: delete_database');
  assert.ok(turnResult.content.includes('系統安全性警告'));
  assert.ok(turnResult.content.includes('未經授權的工具「delete_database」'));
});

test('TC-SEC-02: Empty tools list rejects any tool call', async () => {
  // Given: Preconditions - Profile with empty tools array
  const emptyProfile = {
    systemPrompt: 'No tools bot',
    tools: [],
    toolHandlers: []
  };

  // When:  Operation to execute - Check whitelist for any tool
  const isAllowed = checkToolWhitelist('create_department', emptyProfile);

  // Then:  Expected result - false
  assert.equal(isAllowed, false);
});

test('TC-ERR-01: Tool in whitelist but missing ToolHandler returns error', async () => {
  // Given: Preconditions - Tool is listed in tools, but toolHandlers is missing the handler
  const brokenProfile = {
    systemPrompt: 'Broken bot',
    tools: [
      {
        type: 'function',
        function: { name: 'missing_handler_tool', description: 'desc' }
      }
    ],
    toolHandlers: []
  };

  // When:  Operation to execute - Run turn
  const turnResult = await runAgentTurn('執行缺失工具', brokenProfile, {}, {
    llmDetector: async () => ({ tool: 'missing_handler_tool' })
  });

  // Then:  Expected result - System error indicating missing handler
  assert.equal(turnResult.type, 'error');
  assert.ok(turnResult.content.includes('尚未註冊執行處理常式'));
});

test('TC-ERR-02: Tool execute exception is caught and formatted', async () => {
  // Given: Preconditions - Handler execute throws an error (e.g. duplicate name)
  const throwingHandler = {
    definition: {
      type: 'function',
      function: { name: 'failing_tool', description: 'desc' }
    },
    requiresConfirmation: false,
    describeConfirmation: () => '確認？',
    execute: async () => {
      throw new Error('部門名稱已重複');
    },
    formatResult: () => '成功'
  };

  const profile = {
    systemPrompt: 'Test bot',
    tools: [throwingHandler.definition],
    toolHandlers: [throwingHandler]
  };

  // When:  Operation to execute - Run turn
  const turnResult = await runAgentTurn('執行失敗操作', profile, {}, {
    llmDetector: async () => ({ tool: 'failing_tool' })
  });

  // Then:  Expected result - Error is caught and returned cleanly
  assert.equal(turnResult.type, 'error');
  assert.ok(turnResult.content.includes('執行工具「failing_tool」失敗：部門名稱已重複'));
});

test('TC-FB-01: Offline/Regex fallback detects create_department when LLM returns null', async () => {
  // Given: Preconditions - LLM returns null or throws error
  const userMessage = '請幫我新增「資訊部」';
  const failingLLM = async () => null;

  // When:  Operation to execute - Run turn
  const turnResult = await runAgentTurn(userMessage, departmentAgentProfile, {}, { llmDetector: failingLLM });

  // Then:  Expected result - Regex extractor in handler identifies create_department
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_department');
  assert.equal(turnResult.confirmation.args.name, '資訊部');
  assert.equal(turnResult.content, '偵測到您想建立「資訊部」，確認要建立嗎？');
});

test('TC-FB-02: Offline/Regex fallback detects list_departments when LLM returns null', async () => {
  // Given: Preconditions - LLM returns null
  const userMessage = '查看有哪些部門清單';
  const failingLLM = async () => null;

  // When:  Operation to execute - Run turn
  const turnResult = await runAgentTurn(userMessage, departmentAgentProfile, {}, { llmDetector: failingLLM });

  // Then:  Expected result - Regex extractor in handler identifies list_departments
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'list_departments');
});

test('TC-BD-01: Empty or whitespace message returns fallback guidance', async () => {
  // Given: Preconditions - Empty / whitespace messages
  const emptyTurn = await runAgentTurn('', departmentAgentProfile, {});
  const spaceTurn = await runAgentTurn('   \n\t  ', departmentAgentProfile, {});

  // When / Then:  Returns guidance message without exceptions
  assert.equal(emptyTurn.type, 'text');
  assert.ok(emptyTurn.content.includes('請告訴我想建立的部門名稱'));
  assert.equal(spaceTurn.type, 'text');
  assert.ok(spaceTurn.content.includes('請告訴我想建立的部門名稱'));
});

test('TC-BD-02: Department name with whitespace is properly trimmed by handler', () => {
  // Given: Preconditions - Name with leading/trailing spaces
  const args = { name: '   技術支援部   ' };

  // When:  Operation to execute - describeConfirmation
  const confirmText = createDepartmentToolHandler.describeConfirmation(args, {});

  // Then:  Expected result - Name is trimmed
  assert.equal(confirmText, '偵測到您想建立「技術支援部」，確認要建立嗎？');
});

test('TC-EXT-01: Cross-module reusability - 2nd module registers ToolHandlers and reuses core harness', async () => {
  // Given: Preconditions - A second module (e.g. Member Invitations) defines its own ToolHandlers
  let invitedEmail = null;
  const inviteMemberToolHandler = {
    definition: {
      type: 'function',
      function: {
        name: 'invite_member',
        description: '邀請新成員加入組織',
        parameters: {
          type: 'object',
          properties: { email: { type: 'string' }, role: { type: 'string' } },
          required: ['email']
        }
      }
    },
    requiresConfirmation: true,
    confirmLabel: '送出邀請',
    cancelLabel: '取消邀請',
    describeConfirmation: (args) => `偵測到您想邀請「${args.email}」擔任 ${args.role || '成員'}，確認要發送邀請信嗎？`,
    execute: async (args) => {
      invitedEmail = args.email;
      return { success: true, email: args.email };
    },
    formatResult: (_res, args) => `已成功送出邀請信給「${args.email}」！`,
    describeCancel: () => '已取消成員邀請。',
    extractCandidateRegex: (text) => {
      const match = text.match(/邀請\s*([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
      return match ? { tool: 'invite_member', email: match[1] } : null;
    }
  };

  const memberAgentProfile = {
    systemPrompt: '你是成員管理助理',
    tools: [inviteMemberToolHandler.definition],
    toolHandlers: [inviteMemberToolHandler],
    getFallbackMessage: () => '請提供想邀請的成員 Email'
  };

  // Register the new profile into the workflow registry
  registerAgentProfile('task_m2_invite', memberAgentProfile);
  const resolvedProfile = getAgentProfileForTask({ id: 'task_m2_invite' });
  assert.equal(resolvedProfile, memberAgentProfile);

  // When:  Operation to execute - Run turn using offline regex fallback
  const turnResult = await runAgentTurn('請幫我邀請 user@example.com 加入團隊', memberAgentProfile, { taskId: 'task_m2_invite' });

  // Then:  Expected result - Pending confirmation generated seamlessly by core harness
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'invite_member');
  assert.equal(turnResult.content, '偵測到您想邀請「user@example.com」擔任 成員，確認要發送邀請信嗎？');

  // When:  Executing confirmation
  const confirmResult = await executeConfirmation(turnResult.confirmation, { taskId: 'task_m2_invite' });

  // Then:  2nd module executed cleanly with zero changes to harness core
  assert.equal(invitedEmail, 'user@example.com');
  assert.equal(confirmResult.content, '已成功送出邀請信給「user@example.com」！');
});
