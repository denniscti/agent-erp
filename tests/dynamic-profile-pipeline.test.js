import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleSystemPrompt,
  isEmptyModelResponse,
  detectIntentWithFallbackAndTrace,
  runAgentTurn
} from '../src/lib/workflow/harness.js';

import {
  departmentAgentProfile
} from '../src/lib/workflow/departments.js';

import {
  customerCreateBasicProfileAgentProfile,
  vendorCreateBasicProfileAgentProfile
} from '../src/lib/workflow/partners.js';

import {
  productManagementAgentProfile
} from '../src/lib/workflow/products.js';

// ==============================================================================
// Section 1: Department Regression Suite (13 Test Cases from Issue #163 Spike)
// ==============================================================================

const departmentBenchmarkCases = [
  { id: 'TC-D-01', input: '我想新增行銷部', expectedTool: 'create_department', checkArgs: a => a.name === '行銷部' },
  { id: 'TC-D-02', input: '幫我設立一個全球運籌中心', expectedTool: 'create_department', checkArgs: a => a.name?.includes('全球運籌中心') },
  { id: 'TC-D-03', input: '請建立「AI 研發部」', expectedTool: 'create_department', checkArgs: a => a.name?.includes('AI 研發部') || a.name?.includes('AI研發部') },
  { id: 'TC-D-04', input: '幫我開一個 DevOps 核心小組', expectedTool: 'create_department', checkArgs: a => a.name?.includes('DevOps') },
  { id: 'TC-D-05', input: '新增 人事部', expectedTool: 'create_department', checkArgs: a => a.name === '人事部' },
  { id: 'TC-D-06', input: '目前有哪些部門？列給我看', expectedTool: 'list_departments', checkArgs: () => true },
  { id: 'TC-D-07', input: '查一下部門列表', expectedTool: 'list_departments', checkArgs: () => true },
  { id: 'TC-D-08', input: '組織架構裡現在有哪些單位？', expectedTool: 'list_departments', checkArgs: () => true },
  { id: 'TC-D-09', input: '列出所有 departments 清單', expectedTool: 'list_departments', checkArgs: () => true },
  { id: 'TC-D-10', input: '今天天氣真好，幫我查個天氣', expectedTool: null },
  { id: 'TC-D-11', input: '幫我導出上個月的財務報表', expectedTool: null },
  { id: 'TC-D-12', input: '這部電腦多少錢？', expectedTool: null },
  { id: 'TC-D-13', input: '你好，你可以幫我做什麼？', expectedTool: null }
];

test('TC-D-01 to TC-D-13: Department 13 benchmark test cases zero regression in dynamic pipeline', async () => {
  // Given: Preconditions - Department AgentProfile and mock detector simulating model behavior for benchmark inputs
  const mockBenchmarkDetector = async (msg) => {
    // Exact mapping simulating model output on the 13 benchmark cases
    if (msg === '我想新增行銷部') {
      return { tool_call: { tool: 'create_department', name: '行銷部' }, content: null };
    }
    if (msg === '幫我設立一個全球運籌中心') {
      return { tool_call: { tool: 'create_department', name: '全球運籌中心' }, content: null };
    }
    if (msg === '請建立「AI 研發部」') {
      return { tool_call: { tool: 'create_department', name: 'AI 研發部' }, content: null };
    }
    if (msg === '幫我開一個 DevOps 核心小組') {
      return { tool_call: { tool: 'create_department', name: 'DevOps 核心小組' }, content: null };
    }
    if (msg === '新增 人事部') {
      return { tool_call: { tool: 'create_department', name: '人事部' }, content: null };
    }
    if (msg.includes('目前有哪些部門') || msg.includes('查一下部門列表') || msg.includes('組織架構裡現在有哪些單位') || msg.includes('列出所有 departments')) {
      return { tool_call: { tool: 'list_departments' }, content: null };
    }
    // Negative cases: model returns text guidance or null tool call
    return { tool_call: null, content: '我是組織架構助理，僅能協助部門相關設定。' };
  };

  for (const tc of departmentBenchmarkCases) {
    // When: Executing turn through dynamic harness pipeline
    const turnResult = await runAgentTurn(
      tc.input,
      departmentAgentProfile,
      { taskId: 'task_m2_dept' },
      { llmDetector: mockBenchmarkDetector }
    );

    // Then: Expected result verification
    if (tc.expectedTool === 'create_department') {
      assert.equal(turnResult.type, 'pending_confirmation', `Case ${tc.id} must require confirmation`);
      assert.equal(turnResult.confirmation.toolName, 'create_department', `Case ${tc.id} toolName`);
      assert.ok(tc.checkArgs(turnResult.confirmation.args), `Case ${tc.id} args check failed`);
    } else if (tc.expectedTool === 'list_departments') {
      assert.equal(turnResult.type, 'pending_confirmation', `Case ${tc.id} must require confirmation`);
      assert.equal(turnResult.confirmation.toolName, 'list_departments', `Case ${tc.id} toolName`);
    } else {
      assert.equal(turnResult.type, 'text', `Case ${tc.id} negative input should return text`);
      assert.ok(turnResult.content && turnResult.content.length > 0, `Case ${tc.id} content must not be blank`);
    }
  }
});

// ==============================================================================
// Section 2: Empty Response Defense, Retry, and Fallback
// ==============================================================================

test('TC-EMP-N-01: Empty response on first call retries and succeeds on second call', async () => {
  // Given: Preconditions - Detector returns empty response on call 1, valid tool call on call 2
  let callCount = 0;
  const mockDetector = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { tool_call: null, content: '' };
    }
    return { tool_call: { tool: 'create_department', name: '行銷部' }, content: null };
  };

  // When: Operation to execute - Run agent turn
  const turnResult = await runAgentTurn(
    '我想新增行銷部',
    departmentAgentProfile,
    { taskId: 'task_m2_dept' },
    { llmDetector: mockDetector }
  );

  // Then: Expected result - Detector called twice (1 retry), turn succeeds with confirmation card
  assert.equal(callCount, 2, 'Detector must be retried exactly once');
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_department');
  assert.equal(turnResult.confirmation.args.name, '行銷部');
});

test('TC-EMP-N-02: Empty response after retry gracefully falls back to candidate regex extractor', async () => {
  // Given: Preconditions - Detector returns empty response on both calls, but user message matches regex
  let callCount = 0;
  const mockDetector = async () => {
    callCount += 1;
    return { tool_call: null, content: '' };
  };

  // When: Operation to execute - Run agent turn with input matching create_department regex
  const turnResult = await runAgentTurn(
    '我想新增行銷部',
    departmentAgentProfile,
    { taskId: 'task_m2_dept' },
    { llmDetector: mockDetector }
  );

  // Then: Expected result - Called twice, falls back to regex, confirmation card generated
  assert.equal(callCount, 2, 'Detector must be called twice (initial + retry)');
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_department');
  assert.equal(turnResult.confirmation.args.name, '行銷部');
});

test('TC-EMP-N-03: Empty response after retry with non-regex input returns fallback guidance', async () => {
  // Given: Preconditions - Detector returns empty response on both calls, user input does NOT match regex
  let callCount = 0;
  const mockDetector = async () => {
    callCount += 1;
    return { tool_call: null, content: '   \n  ' };
  };

  // When: Operation to execute - Run agent turn with general question
  const turnResult = await runAgentTurn(
    '今天天氣如何？',
    departmentAgentProfile,
    { taskId: 'task_m2_dept' },
    { llmDetector: mockDetector }
  );

  // Then: Expected result - Called twice, regex doesn't match, returns profile fallback message
  assert.equal(callCount, 2);
  assert.equal(turnResult.type, 'text');
  assert.ok(turnResult.content && turnResult.content.includes('請告訴我想建立的部門名稱'));
});

test('TC-EMP-B-01: Empty string content is identified by isEmptyModelResponse', () => {
  // Given: Preconditions - Various response structures
  // When & Then: Boundary checks
  assert.equal(isEmptyModelResponse({ tool_call: null, content: '' }), true);
  assert.equal(isEmptyModelResponse({ tool_call: null, content: '   \n\t ' }), true);
  assert.equal(isEmptyModelResponse({ tool_call: null, content: null }), true);
  assert.equal(isEmptyModelResponse({ tool_call: null, content: '有文字回覆' }), false);
  assert.equal(isEmptyModelResponse({ tool_call: { tool: 'list_departments' }, content: '' }), false);
  assert.equal(isEmptyModelResponse({ attempted: false, tool_call: null, content: '' }), false);
});

test('TC-EMP-B-05: Unconfigured / offline model (attempted: false) does NOT trigger retry', async () => {
  // Given: Preconditions - Detector returns attempted: false (offline / missing API key)
  let callCount = 0;
  const unconfiguredDetector = async () => {
    callCount += 1;
    return { attempted: false, tool_call: null };
  };

  // When: Executing turn
  const turnResult = await runAgentTurn(
    '我想新增行銷部',
    departmentAgentProfile,
    { taskId: 'task_m2_dept' },
    { llmDetector: unconfiguredDetector }
  );

  // Then: Called only once (no retry), immediately falls back to regex
  assert.equal(callCount, 1, 'Offline/unconfigured detector must not be retried');
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.equal(turnResult.confirmation.args.name, '行銷部');
});

// ==============================================================================
// Section 3: Context Injection Assembly
// ==============================================================================

test('TC-CTX-N-01: Existing domains without contextInjection preserve exact systemPrompt', async () => {
  // Given: Existing 4 profiles
  const profiles = [
    departmentAgentProfile,
    customerCreateBasicProfileAgentProfile,
    vendorCreateBasicProfileAgentProfile,
    productManagementAgentProfile
  ];

  for (const prof of profiles) {
    // When: Assembling system prompt
    const prompt = await assembleSystemPrompt(prof);

    // Then: Returns identical systemPrompt without modifications
    assert.equal(prompt, prof.systemPrompt);
  }
});

test('TC-CTX-N-02: Static string contextInjection is appended with double newline', async () => {
  // Given: Profile with static string contextInjection
  const mockProfile = {
    systemPrompt: 'Base prompt.',
    contextInjection: '### Catalog Context:\n- Vendor: 大同'
  };

  // When: Assembling system prompt
  const assembled = await assembleSystemPrompt(mockProfile);

  // Then: Combined cleanly
  assert.equal(assembled, 'Base prompt.\n\n### Catalog Context:\n- Vendor: 大同');
});

test('TC-CTX-N-03: Dynamic async function contextInjection receives context and appends', async () => {
  // Given: Profile with dynamic contextInjection function
  const mockProfile = {
    systemPrompt: 'PO Assistant.',
    contextInjection: async (ctx) => `### Tenant: ${ctx.tenantId}\n- Items count: ${ctx.items.length}`
  };

  // When: Assembling with context
  const assembled = await assembleSystemPrompt(mockProfile, { tenantId: 'tenant_101', items: [1, 2, 3] });

  // Then: Context evaluated and appended
  assert.equal(assembled, 'PO Assistant.\n\n### Tenant: tenant_101\n- Items count: 3');
});

test('TC-CTX-B-01: Empty or whitespace contextInjection returns base systemPrompt cleanly', async () => {
  // Given: Profiles with empty string or whitespace injection
  const pEmpty = { systemPrompt: 'Base prompt.', contextInjection: '' };
  const pSpace = { systemPrompt: 'Base prompt.', contextInjection: '   \n  ' };
  const pNullFn = { systemPrompt: 'Base prompt.', contextInjection: async () => null };

  // When & Then:
  assert.equal(await assembleSystemPrompt(pEmpty), 'Base prompt.');
  assert.equal(await assembleSystemPrompt(pSpace), 'Base prompt.');
  assert.equal(await assembleSystemPrompt(pNullFn), 'Base prompt.');
});
