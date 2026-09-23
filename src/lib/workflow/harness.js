/**
 * @file harness.js
 * @description Domain-agnostic Core Loop Harness for Task-Driven Workflow.
 * Implements the execution loop described in task_driven_workflow.md section 3.3.
 */

/**
 * Checks if a tool name is declared in the AgentProfile tools whitelist.
 * @param {string} toolName
 * @param {import('./types.js').AgentProfile} profile
 * @returns {boolean}
 */
export function checkToolWhitelist(toolName, profile) {
  if (!toolName || !profile || !Array.isArray(profile.tools)) {
    return false;
  }
  return profile.tools.some((t) => {
    const name = t?.function?.name || t?.name;
    return name === toolName;
  });
}

/**
 * Detects intent using LLM with regex fallback.
 * @param {string} userMessage
 * @param {import('./types.js').AgentProfile} profile
 * @param {(msg: string, profile: import('./types.js').AgentProfile) => Promise<{ tool: string, [key: string]: any } | null>} [llmDetector]
 * @returns {Promise<{ tool: string, [key: string]: any } | null>}
 */
export async function detectIntentWithFallback(userMessage, profile, llmDetector) {
  if (!userMessage || !userMessage.trim()) {
    return null;
  }

  const trimmed = userMessage.trim();

  // 1. Try LLM detector first if provided
  if (typeof llmDetector === 'function') {
    try {
      const llmResult = await llmDetector(trimmed, profile);
      if (llmResult && typeof llmResult === 'object' && llmResult.tool) {
        return llmResult;
      }
    } catch (err) {
      console.warn('[Harness] LLM intent detection failed or unavailable, falling back to regex:', err);
    }
  }

  // 2. Fallback to candidate regex extractors registered in profile toolHandlers
  if (profile && Array.isArray(profile.toolHandlers)) {
    for (const handler of profile.toolHandlers) {
      if (typeof handler.extractCandidateRegex === 'function') {
        try {
          const match = handler.extractCandidateRegex(trimmed);
          if (match && match.tool) {
            return match;
          }
        } catch (regexErr) {
          console.warn('[Harness] Handler regex extractor error:', regexErr);
        }
      }
    }
  }

  return null;
}

/**
 * Runs one turn of the agent workflow loop.
 * @param {string} userMessage
 * @param {import('./types.js').AgentProfile} profile
 * @param {{ taskId?: string | null, activeTask?: any, [key: string]: any }} [context]
 * @param {{ llmDetector?: (msg: string, profile: import('./types.js').AgentProfile) => Promise<any> }} [options]
 * @returns {Promise<import('./types.js').TurnResult>}
 */
export async function runAgentTurn(userMessage, profile, context = {}, options = {}) {
  const ctx = context || {};
  const opts = options || {};

  // Step 1: Detect intent
  const intent = await detectIntentWithFallback(userMessage, profile, opts.llmDetector);

  // If no tool was detected, return guidance/fallback text
  if (!intent || !intent.tool) {
    const fallbackMsg = typeof profile?.getFallbackMessage === 'function'
      ? profile.getFallbackMessage(ctx.activeTask)
      : '請提供具體的操作需求，我將為您執行相應的任務。';
    return {
      type: 'text',
      content: fallbackMsg
    };
  }

  const toolName = intent.tool;
  // Extract args from intent payload (omit the 'tool' field itself)
  const { tool: _, ...rawArgs } = intent;
  const args = intent.args || rawArgs;

  // Step 2: Whitelist verification
  const isAllowed = checkToolWhitelist(toolName, profile);
  if (!isAllowed) {
    const errMsg = `系統安全性警告：AI 意圖呼叫未經授權的工具「${toolName}」，該操作已被白名單安全性規則攔截。`;
    console.error(`[Harness Security Alert] Tool "${toolName}" is not in whitelist of AgentProfile!`, {
      toolName,
      args,
      allowedTools: profile?.tools?.map((t) => t?.function?.name)
    });
    return {
      type: 'error',
      error: `Unauthorized tool call: ${toolName}`,
      content: errMsg
    };
  }

  // Step 3: Lookup ToolHandler
  const handler = profile.toolHandlers?.find(
    (h) => (h?.definition?.function?.name || h?.name) === toolName
  );

  if (!handler) {
    const errMsg = `系統錯誤：已授權工具「${toolName}」尚未註冊執行處理常式 (ToolHandler)。`;
    console.error(`[Harness Error] Missing ToolHandler for authorized tool "${toolName}"`);
    return {
      type: 'error',
      error: `Missing ToolHandler for ${toolName}`,
      content: errMsg
    };
  }

  // Step 4: Check if human-in-the-loop confirmation is required
  const requiresConfirmation = handler.requiresConfirmation !== false;

  if (!requiresConfirmation) {
    // Direct execution (e.g. read-only queries with requiresConfirmation = false)
    try {
      const result = await handler.execute(args, ctx);
      const content = handler.formatResult(result, args, ctx);
      return {
        type: 'executed',
        result,
        content
      };
    } catch (execErr) {
      console.error(`[Harness Error] Execution of tool "${toolName}" failed:`, execErr);
      const errString = execErr?.message || String(execErr);
      return {
        type: 'error',
        error: errString,
        content: `執行工具「${toolName}」失敗：${errString}`
      };
    }
  }

  // Requires confirmation: build pending confirmation object
  const confirmText = handler.describeConfirmation(args, ctx);
  /** @type {import('./types.js').PendingConfirmation} */
  const confirmation = {
    toolName,
    handler,
    args,
    confirmText,
    taskId: ctx.taskId || null,
    confirmLabel: handler.confirmLabel || '確認',
    cancelLabel: handler.cancelLabel || '取消',
    // Backward compatibility fields
    type: toolName,
    payload: { ...args, taskId: ctx.taskId || null }
  };

  return {
    type: 'pending_confirmation',
    confirmation,
    content: confirmText
  };
}

/**
 * Executes a pending confirmation.
 * @param {import('./types.js').PendingConfirmation} confirmation
 * @param {any} [context]
 * @returns {Promise<{ result: any, content: string, toolName: string, args: any }>}
 */
export async function executeConfirmation(confirmation, context = {}) {
  if (!confirmation || !confirmation.handler) {
    throw new Error('No pending confirmation or handler found.');
  }

  const { handler, args, toolName } = confirmation;
  const ctx = {
    taskId: confirmation.taskId || context?.taskId,
    ...context
  };

  const result = await handler.execute(args, ctx);
  const content = handler.formatResult(result, args, ctx);

  return {
    result,
    content,
    toolName,
    args
  };
}

/**
 * Executes a cancellation for a pending confirmation.
 * @param {import('./types.js').PendingConfirmation} confirmation
 * @param {any} [context]
 * @returns {{ content: string, toolName: string, args: any }}
 */
export function executeCancellation(confirmation, context = {}) {
  if (!confirmation || !confirmation.handler) {
    return {
      content: '好的，已取消操作。',
      toolName: '',
      args: {}
    };
  }

  const { handler, args, toolName } = confirmation;
  const ctx = {
    taskId: confirmation.taskId || context?.taskId,
    ...context
  };

  const content = typeof handler.describeCancel === 'function'
    ? handler.describeCancel(args, ctx)
    : '好的，已取消操作。';

  return {
    content,
    toolName,
    args
  };
}
