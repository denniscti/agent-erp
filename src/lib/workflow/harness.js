/**
 * @file harness.js
 * @description Domain-agnostic Core Loop Harness for Task-Driven Workflow.
 * Implements the execution loop described in task_driven_workflow.md section 3.3.
 * Integrates dual-track observability: audit_logs for human decisions & security alerts,
 * and llm_traces for LLM interactions and post-hoc evaluation.
 */

import { invoke } from '../tauri.js';

/**
 * Safely records an audit log entry.
 * @param {string} actionType
 * @param {any} args
 * @param {'approved' | 'rejected' | 'rejected_unauthorized'} decision
 * @param {string} [operator]
 * @param {((entry: any) => Promise<any>) | null} [customLogger]
 * @returns {Promise<string | null>}
 */
export async function logAuditEvent(actionType, args, decision, operator = 'user', customLogger = null) {
  const argsString = typeof args === 'string' ? args : JSON.stringify(args || {});
  const entry = {
    action_type: actionType,
    arguments: argsString,
    decision,
    operator: operator || 'user'
  };

  if (typeof customLogger === 'function') {
    try {
      return await customLogger(entry);
    } catch (err) {
      console.warn('[Harness Observability] Custom audit logger failed:', err);
    }
  }

  try {
    return await invoke('record_audit_log', entry);
  } catch (err) {
    console.warn('[Harness Observability] Failed to record audit log via invoke:', err);
    return null;
  }
}

/**
 * Safely records an LLM trace record.
 * @param {any} traceRecord
 * @param {((trace: any) => Promise<any>) | null} [customTracer]
 * @returns {Promise<string | null>}
 */
export async function logLlmTrace(traceRecord, customTracer = null) {
  if (typeof customTracer === 'function') {
    try {
      return await customTracer(traceRecord);
    } catch (err) {
      console.warn('[Harness Observability] Custom tracer failed:', err);
    }
  }

  try {
    return await invoke('record_llm_trace', { trace: traceRecord });
  } catch (err) {
    console.warn('[Harness Observability] Failed to record llm trace via invoke:', err);
    return null;
  }
}

/**
 * Safely updates human decision for an LLM trace.
 * @param {string} traceId
 * @param {'approved' | 'rejected'} decision
 * @param {((id: string, decision: string) => Promise<any>) | null} [customDecisionUpdater]
 * @returns {Promise<any>}
 */
export async function updateLlmTraceDecision(traceId, decision, customDecisionUpdater = null) {
  if (!traceId) return null;

  if (typeof customDecisionUpdater === 'function') {
    try {
      return await customDecisionUpdater(traceId, decision);
    } catch (err) {
      console.warn('[Harness Observability] Custom trace decision updater failed:', err);
    }
  }

  try {
    return await invoke('update_llm_trace_decision', { id: traceId, decision });
  } catch (err) {
    console.warn('[Harness Observability] Failed to update llm trace decision via invoke:', err);
    return null;
  }
}

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
 * Detects intent using LLM with timing and trace logging, falling back to candidate regex extractors.
 * @param {string} userMessage
 * @param {import('./types.js').AgentProfile} profile
 * @param {any} [context]
 * @param {any} [options]
 * @returns {Promise<{ intent: { tool: string, [key: string]: any } | null, traceId: string | null }>}
 */
export async function detectIntentWithFallbackAndTrace(userMessage, profile, context = {}, options = {}) {
  if (!userMessage || !userMessage.trim()) {
    return { intent: null, traceId: null };
  }

  const trimmed = userMessage.trim();
  const ctx = context || {};
  const opts = options || {};
  let traceId = null;

  // 1. Try LLM detector first if provided
  if (typeof opts.llmDetector === 'function') {
    const startTime = Date.now();
    let llmRawResult = null;
    let callError = null;

    try {
      llmRawResult = await opts.llmDetector(trimmed, profile);
    } catch (err) {
      callError = err;
      console.warn('[Harness] LLM intent detection failed or unavailable, falling back to regex:', err);
    }

    // Determine if the LLM call was actually attempted (e.g. API key was present)
    // If llmRawResult explicitly states attempted === false, it means unconfigured / skipped.
    const wasAttempted = callError != null || (llmRawResult != null && llmRawResult.attempted !== false);

    if (wasAttempted) {
      const nowSec = Math.floor(Date.now() / 1000);
      traceId = opts.traceId || `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Extract tool intent (supports DetectDepartmentIntentResult { attempted, tool_call } or direct { tool, ... })
      let detectedIntent = null;
      if (llmRawResult && typeof llmRawResult === 'object') {
        if (llmRawResult.tool_call && typeof llmRawResult.tool_call === 'object' && llmRawResult.tool_call.tool) {
          detectedIntent = llmRawResult.tool_call;
        } else if (llmRawResult.tool) {
          detectedIntent = llmRawResult;
        }
      }

      const traceRecord = {
        id: traceId,
        agent_scope: ctx.agentScope || ctx.taskId || profile?.id || 'general',
        system_prompt: profile?.systemPrompt || '',
        tools_json: JSON.stringify(profile?.tools || []),
        user_message: trimmed,
        raw_response: llmRawResult != null ? JSON.stringify(llmRawResult) : null,
        parsed_result: detectedIntent ? JSON.stringify(detectedIntent) : null,
        model: opts.model || profile?.model || 'z-ai/glm-5.3-flash',
        latency_ms: Date.now() - startTime,
        error: callError ? (callError?.message || String(callError)) : null,
        human_decision: null,
        created_at: nowSec
      };

      // Record trace in DB/storage only when model was actually attempted
      await logLlmTrace(traceRecord, opts.tracer);

      if (detectedIntent) {
        return { intent: detectedIntent, traceId };
      }
    }
  }

  // 2. Fallback to candidate regex extractors registered in profile toolHandlers
  if (profile && Array.isArray(profile.toolHandlers)) {
    for (const handler of profile.toolHandlers) {
      if (typeof handler.extractCandidateRegex === 'function') {
        try {
          const match = handler.extractCandidateRegex(trimmed);
          if (match && match.tool) {
            return { intent: match, traceId };
          }
        } catch (regexErr) {
          console.warn('[Harness] Handler regex extractor error:', regexErr);
        }
      }
    }
  }

  return { intent: null, traceId };
}

/**
 * Backward-compatible detectIntentWithFallback signature.
 * @param {string} userMessage
 * @param {import('./types.js').AgentProfile} profile
 * @param {(msg: string, profile: import('./types.js').AgentProfile) => Promise<{ tool: string, [key: string]: any } | null>} [llmDetector]
 * @returns {Promise<{ tool: string, [key: string]: any } | null>}
 */
export async function detectIntentWithFallback(userMessage, profile, llmDetector) {
  const res = await detectIntentWithFallbackAndTrace(
    userMessage,
    profile,
    {},
    { llmDetector }
  );
  return res.intent;
}

/**
 * Runs one turn of the agent workflow loop.
 * @param {string} userMessage
 * @param {import('./types.js').AgentProfile} profile
 * @param {{ taskId?: string | null, activeTask?: any, agentScope?: string, operator?: string, [key: string]: any }} [context]
 * @param {{ llmDetector?: (msg: string, profile: import('./types.js').AgentProfile) => Promise<any>, tracer?: (trace: any) => Promise<any>, auditLogger?: (entry: any) => Promise<any>, [key: string]: any }} [options]
 * @returns {Promise<import('./types.js').TurnResult>}
 */
export async function runAgentTurn(userMessage, profile, context = {}, options = {}) {
  const ctx = context || {};
  const opts = options || {};

  // Step 1: Detect intent with trace logging
  const { intent, traceId } = await detectIntentWithFallbackAndTrace(
    userMessage,
    profile,
    ctx,
    opts
  );

  // If no tool was detected, return guidance/fallback text
  if (!intent || !intent.tool) {
    const fallbackMsg = typeof profile?.getFallbackMessage === 'function'
      ? profile.getFallbackMessage(ctx.activeTask)
      : '請提供具體的操作需求，我將為您執行相應的任務。';
    return {
      type: 'text',
      content: fallbackMsg,
      traceId
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

    // Write audit log for security anomaly (decision = 'rejected_unauthorized')
    await logAuditEvent(
      toolName,
      args,
      'rejected_unauthorized',
      ctx.operator || 'system',
      opts.auditLogger
    );

    return {
      type: 'error',
      error: `Unauthorized tool call: ${toolName}`,
      content: errMsg,
      traceId
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
      content: errMsg,
      traceId
    };
  }

  // Step 4: Check if human-in-the-loop confirmation is required
  const requiresConfirmation = handler.requiresConfirmation !== false;

  if (!requiresConfirmation) {
    // Direct execution (e.g. read-only queries with requiresConfirmation = false)
    try {
      const result = await handler.execute(args, ctx);
      const content = handler.formatResult(result, args, ctx);
      const completesTask = Boolean(handler.completesTask);
      const summary = typeof handler.describeTaskSummary === 'function'
        ? handler.describeTaskSummary(result, args, ctx)
        : null;
      const toast = typeof handler.describeToast === 'function'
        ? handler.describeToast(result, args, ctx)
        : null;
      return {
        type: 'executed',
        result,
        content,
        toolName,
        args,
        completesTask,
        summary,
        toast,
        traceId
      };
    } catch (execErr) {
      console.error(`[Harness Error] Execution of tool "${toolName}" failed:`, execErr);
      const errString = execErr?.message || String(execErr);
      return {
        type: 'error',
        error: errString,
        content: `執行工具「${toolName}」失敗：${errString}`,
        traceId
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
    traceId: traceId || null,
    confirmLabel: handler.confirmLabel || '確認',
    cancelLabel: handler.cancelLabel || '取消',
    // Backward compatibility fields
    type: toolName,
    payload: { ...args, taskId: ctx.taskId || null, traceId: traceId || null }
  };

  return {
    type: 'pending_confirmation',
    confirmation,
    content: confirmText,
    traceId
  };
}

/**
 * Executes a pending confirmation and records human decision in audit_logs and llm_traces.
 * @param {import('./types.js').PendingConfirmation} confirmation
 * @param {any} [context]
 * @param {{ auditLogger?: (entry: any) => Promise<any>, decisionUpdater?: (id: string, decision: string) => Promise<any> }} [options]
 * @returns {Promise<{ result: any, content: string, toolName: string, args: any, completesTask: boolean, summary: string | null, toast: string | null }>}
 */
export async function executeConfirmation(confirmation, context = {}, options = {}) {
  if (!confirmation || !confirmation.handler) {
    throw new Error('No pending confirmation or handler found.');
  }

  const { handler, args, toolName } = confirmation;
  const ctx = {
    taskId: confirmation.taskId || context?.taskId,
    ...context
  };
  const opts = options || {};

  // Record audit log for human approval (decision = 'approved')
  await logAuditEvent(
    toolName,
    args,
    'approved',
    ctx.operator || 'user',
    opts.auditLogger
  );

  // Backfill human_decision on the associated LLM trace
  const traceId = confirmation.traceId || confirmation.payload?.traceId;
  if (traceId) {
    await updateLlmTraceDecision(traceId, 'approved', opts.decisionUpdater);
  }

  const result = await handler.execute(args, ctx);
  const content = handler.formatResult(result, args, ctx);
  const completesTask = Boolean(handler.completesTask);
  const summary = typeof handler.describeTaskSummary === 'function'
    ? handler.describeTaskSummary(result, args, ctx)
    : null;
  const toast = typeof handler.describeToast === 'function'
    ? handler.describeToast(result, args, ctx)
    : null;

  return {
    result,
    content,
    toolName,
    args,
    completesTask,
    summary,
    toast
  };
}

/**
 * Executes a cancellation for a pending confirmation and records human decision in audit_logs and llm_traces.
 * @param {import('./types.js').PendingConfirmation} confirmation
 * @param {any} [context]
 * @param {{ auditLogger?: (entry: any) => Promise<any>, decisionUpdater?: (id: string, decision: string) => Promise<any> }} [options]
 * @returns {Promise<{ content: string, toolName: string, args: any }>}
 */
export async function executeCancellation(confirmation, context = {}, options = {}) {
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
  const opts = options || {};

  // Record audit log for human rejection/cancellation (decision = 'rejected')
  await logAuditEvent(
    toolName,
    args,
    'rejected',
    ctx.operator || 'user',
    opts.auditLogger
  );

  // Backfill human_decision on the associated LLM trace
  const traceId = confirmation.traceId || confirmation.payload?.traceId;
  if (traceId) {
    await updateLlmTraceDecision(traceId, 'rejected', opts.decisionUpdater);
  }

  const content = typeof handler.describeCancel === 'function'
    ? handler.describeCancel(args, ctx)
    : '好的，已取消操作。';

  return {
    content,
    toolName,
    args
  };
}
