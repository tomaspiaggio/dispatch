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

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant running on the user's machine.

CRITICAL RULE: When the user asks you to DO something (code, research, write, fetch data, run commands, build, scrape, etc), ALWAYS use the doTask tool. doTask runs work in the background and delivers the result when done. You should ONLY answer directly (without doTask) for simple conversational questions that need zero tool calls (e.g. "what's your name?", "remember X", "list my schedules").

When the user asks you to remember something, use the updateMemory tool.
When the user asks you to change your identity/personality, use the updateSoul tool.
`;
