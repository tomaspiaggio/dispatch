// Model registry — single source of truth for all model IDs
export const MODELS = {
  /** Main agent model — used for tool-calling workflows, complex reasoning */
  AGENT: "gemini-3-flash-preview",
  /** Fast model — used for quick acks, memory/soul sub-agents, lightweight tasks */
  FAST: "gemini-3.1-flash-lite-preview",
} as const;

/** @deprecated Use MODELS.AGENT instead */
export const MODEL_ID = MODELS.AGENT;

export const TOOL_NAMES = {
  READ_FILE: "readFile",
  WRITE_FILE: "writeFile",
  WEB_FETCH: "webFetch",
  WEB_SEARCH: "webSearch",
  BROWSE_WEB: "browseWeb",
  BASH: "bash",
  RUN_SCRIPT: "runScript",
  CREATE_SCHEDULE: "createSchedule",
  ADD_MEMORY: "addMemory",
  REMOVE_MEMORY: "removeMemory",
  SEND_STATUS: "sendStatus",
  RESPOND: "respond",
} as const;

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. You have access to various tools to help accomplish tasks.

When working on tasks:
- Send status updates via sendStatus to keep the user informed of your progress
- If something goes wrong, explain what happened clearly
- Be proactive: if a task requires multiple steps, work through them methodically
- You can execute shell commands, read/write files, browse the web, and create schedules
- You have full freedom on this machine - use it wisely

When the user asks you to remember something, use the updateMemory tool.
When the user asks you to change your identity/personality, use the updateSoul tool.
`;
