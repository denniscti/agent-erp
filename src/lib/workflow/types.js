/**
 * @file types.js
 * @description Task-Driven Workflow and AgentProfile / ToolHandler interface definitions.
 * Conforms to task_driven_workflow.md section 3.2 and 3.3.
 */

/**
 * @typedef {Object} FunctionDefinition
 * @property {string} name - The name of the function to be called.
 * @property {string} description - A description of what the function does.
 * @property {Record<string, any>} [parameters] - The parameters the function accepts, described as a JSON Schema object.
 */

/**
 * @typedef {Object} ToolDefinition
 * @property {'function'} type - Tool type, defaults to 'function'.
 * @property {FunctionDefinition} function - The function specification.
 */

/**
 * @typedef {Object} ToolHandler
 * @property {ToolDefinition} definition - The tool definition compliant with OpenAI / NIM format.
 * @property {(args: any, context?: any) => string} describeConfirmation - Formats human-readable confirmation text.
 * @property {(args: any, context?: any) => Promise<any>} execute - Executes the actual tool operation (e.g. Tauri IPC).
 * @property {boolean} [requiresConfirmation] - Whether human confirmation is required before execution (default: true).
 * @property {boolean} [completesTask] - Whether successful execution marks the active task as completed ('done').
 * @property {(result: any, args?: any, context?: any) => string} [describeTaskSummary] - Formats summary message reported to main ambient conversation.
 * @property {(result: any, args?: any, context?: any) => string} [describeToast] - Formats toast notification message upon successful execution.
 * @property {(args?: any, context?: any) => string} [describeCancel] - Formats human-readable cancellation response.
 * @property {(text: string) => ({ tool: string, [key: string]: any } | null)} [extractCandidateRegex] - Offline regex fallback parser.
 * @property {string} [confirmLabel] - Custom label for confirmation button (default: '確認').
 * @property {string} [cancelLabel] - Custom label for cancellation button (default: '取消').
 */

/**
 * @typedef {Object} AgentProfile
 * @property {string} systemPrompt - Prompt defining the role and boundary of the agent.
 * @property {ToolDefinition[]} tools - Array of allowed tool definitions.
 * @property {ToolHandler[]} toolHandlers - Array of corresponding tool handler instances.
 * @property {(task?: any) => string} [getFallbackMessage] - Guidance message when user message does not match any tool.
 * @property {Object} [quickAction] - Declarative quick action configuration.
 * @property {string} [quickAction.title] - Title of quick action card.
 * @property {string} [quickAction.desc] - Description of quick action card.
 * @property {string} [quickAction.buttonText] - Text on the action button.
 * @property {(context?: any) => any} [quickAction.trigger] - Handler to trigger quick action.
 */

/**
 * @typedef {Object} PendingConfirmation
 * @property {string} toolName - Name of the pending tool.
 * @property {ToolHandler} handler - Tool handler instance.
 * @property {any} args - Parsed arguments for the tool call.
 * @property {string} confirmText - Human-readable confirmation prompt text.
 * @property {string} [taskId] - ID of the task context if applicable.
 * @property {string} [confirmLabel] - Label for confirmation button.
 * @property {string} [cancelLabel] - Label for cancellation button.
 * @property {any} [payload] - Backward compatibility payload object.
 * @property {string} [type] - Backward compatibility type string.
 */

/**
 * @typedef {Object} TurnResult
 * @property {'text' | 'pending_confirmation' | 'executed' | 'error'} type
 * @property {string} [content]
 * @property {PendingConfirmation} [confirmation]
 * @property {any} [result]
 * @property {string} [error]
 */

export {};
