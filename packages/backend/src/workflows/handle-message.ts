import { getWritable } from "workflow";
import { DurableAgent } from "@workflow/ai/agent";
import { google } from "@workflow/ai/google";
import { tool } from "ai";
import { z } from "zod";
import type { UIMessageChunk } from "ai";
import { MODELS } from "@dispatch/shared";

import { readFileStep } from "../steps/read-file";
import { writeFileStep } from "../steps/write-file";
import { webFetchStep } from "../steps/web-fetch";
import { bashStep } from "../steps/bash";
import { runScriptStep } from "../steps/run-script";
import { sendStatusStep } from "../steps/send-status";
import { updateMemoryStep, updateSoulStep, readMemoryFileStep, readSoulFileStep } from "../steps/memory";
import { logMessageStep } from "../steps/log-message";
import { createScheduleStep, listSchedulesStep, deleteScheduleStep } from "../steps/schedule";
import { spawnTaskStep, listSpawnedTasksStep } from "../steps/spawn-task";
import {
  findOrCreateConversationStep,
  getConversationHistoryStep,
  getSystemPromptStep,
} from "../steps/conversation";

function log(msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${ts}] [workflow] ${msg}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[${ts}] [workflow] ${msg}`);
  }
}

export async function handleMessageWorkflow(
  threadJson: string | null,
  content: string,
  platform: string,
  channelId: string,
  threadId: string | null
) {
  "use workflow";

  const writable = getWritable<UIMessageChunk>();

  log(`>>> Received message`, { platform, channel: channelId, content: content.slice(0, 120) });

  try {
    const conversation = await findOrCreateConversationStep(platform, channelId, threadId);
    log(`Conversation: ${conversation.id}`);

    await logMessageStep(conversation.id, "user", content);

    const history = await getConversationHistoryStep(conversation.id);
    log(`History: ${history.length} messages`);

    const systemPrompt = await getSystemPromptStep();
    log(`System prompt: ${systemPrompt.length} chars`);

    const agent = new DurableAgent({
      model: google(MODELS.AGENT) as any,
      instructions: systemPrompt,
      tools: {
        readFile: tool({
          description: "Read a file from the filesystem.",
          inputSchema: z.object({ path: z.string().describe("Absolute file path") }),
          execute: async ({ path }) => { log(`readFile: ${path}`); return readFileStep(path); },
        }),
        writeFile: tool({
          description: "Write content to a file. Creates directories if needed.",
          inputSchema: z.object({
            path: z.string().describe("Absolute file path"),
            content: z.string().describe("File content"),
          }),
          execute: async ({ path, content: c }) => { log(`writeFile: ${path} (${c.length} chars)`); return writeFileStep(path, c); },
        }),
        webFetch: tool({
          description: "Make an HTTP request.",
          inputSchema: z.object({
            url: z.string().describe("URL to fetch"),
            method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
            body: z.string().optional().describe("Request body"),
            headers: z.record(z.string()).optional().describe("Headers"),
          }),
          execute: async ({ url, method, body, headers }) => { log(`webFetch: ${method} ${url}`); return webFetchStep(url, method, body, headers); },
        }),
        bash: tool({
          description: "Execute a shell command. Full access, no restrictions.",
          inputSchema: z.object({
            command: z.string().describe("Shell command"),
            cwd: z.string().optional().describe("Working directory"),
            timeout: z.number().optional().default(30000).describe("Timeout ms"),
          }),
          execute: async ({ command, cwd, timeout }) => { log(`bash: ${command.slice(0, 120)}`); return bashStep(command, cwd, timeout); },
        }),
        runScript: tool({
          description: "Execute a Node.js script file.",
          inputSchema: z.object({
            scriptPath: z.string().describe("Path to script"),
            args: z.array(z.string()).optional().default([]).describe("Script args"),
          }),
          execute: async ({ scriptPath, args }) => { log(`runScript: ${scriptPath}`); return runScriptStep(scriptPath, args); },
        }),
        createSchedule: tool({
          description: `Schedule a task to run later. This tool SAVES the schedule to the database and returns immediately — the scheduler will execute it automatically. You must provide EITHER cronExpression (recurring) OR delay (one-time), not both.

Examples:
- "remind me in 30 minutes" → delay: "30m"
- "every day at 8:30 AM" → cronExpression: "30 8 * * *"
- "every Monday at 9 AM" → cronExpression: "0 9 * * 1"

After calling this tool, confirm to the user with the schedule details (name, when it will run). Do NOT call any other scheduling tools — this one does everything.`,
          inputSchema: z.object({
            name: z.string().describe("Short human-readable name, e.g. 'Weather Reminder' or 'Daily HN Summary'"),
            taskPrompt: z.string().describe("The full prompt the agent will execute when the schedule fires. Be specific — this runs in a fresh conversation with no prior context."),
            cronExpression: z.string().optional().describe('Cron expression for RECURRING tasks. Format: "min hour dom month dow". E.g. "30 8 * * *" = daily at 8:30 AM. Server timezone is PDT/PST.'),
            delay: z.string().optional().describe('One-time delay for single reminders. E.g. "2m", "30m", "2h", "1d". Cannot be combined with cronExpression.'),
          }),
          execute: async ({ name, taskPrompt, cronExpression, delay }) => {
            log(`createSchedule: "${name}" cron=${cronExpression ?? "none"} delay=${delay ?? "none"}`);
            return createScheduleStep(name, taskPrompt, platform, channelId, threadJson, cronExpression, delay);
          },
        }),
        listSchedules: tool({
          description: "List all scheduled tasks from the database. Returns an array of schedules with their IDs, names, prompts, next run times, and status. Call this when the user asks to see their schedules or before deleting one.",
          inputSchema: z.object({
            status: z.string().optional().describe('Filter by status: "active", "paused", "completed". Omit to show all non-completed.'),
          }),
          execute: async ({ status }) => { log(`listSchedules`); return listSchedulesStep(status); },
        }),
        deleteSchedule: tool({
          description: "Permanently delete a schedule by its ID. Call listSchedules first to find the ID if you don't have it.",
          inputSchema: z.object({
            scheduleId: z.string().describe("The UUID of the schedule to delete"),
          }),
          execute: async ({ scheduleId }) => { log(`deleteSchedule: ${scheduleId}`); return deleteScheduleStep(scheduleId); },
        }),
        doTask: tool({
          description: "Execute a task in the background. The result is delivered to the chat when done. This is the PREFERRED way to handle any user request that requires work (coding, research, file operations, web scraping, writing, running commands, etc). Only skip this tool for simple questions that need zero tool calls to answer.",
          inputSchema: z.object({
            taskPrompt: z.string().describe("Complete self-contained prompt. Include ALL context — the background worker has no access to this conversation. Copy any relevant details, file paths, URLs, and requirements from the user's message."),
          }),
          execute: async ({ taskPrompt }) => {
            log(`doTask: "${taskPrompt.slice(0, 80)}"`);
            return spawnTaskStep(taskPrompt, platform, channelId, conversation.id);
          },
        }),
        listSpawnedTasks: tool({
          description: "List all tasks spawned from this conversation and their status (running/completed). Use when the user asks about running tasks, pending tasks, or wants to check if something finished.",
          inputSchema: z.object({}),
          execute: async () => { log(`listSpawnedTasks`); return listSpawnedTasksStep(conversation.id); },
        }),
        updateMemory: tool({
          description: 'Update the persistent memory file (~/.dispatch/memories.md). A sub-agent will intelligently merge your instruction into the existing memories — resolving contradictions, updating existing entries, or adding new ones. Use for "remember that...", "from now on...", "always do X", "stop doing Y".',
          inputSchema: z.object({ instruction: z.string().describe("What to add, change, or remove from memory") }),
          execute: async ({ instruction }) => { log(`updateMemory: ${instruction.slice(0, 80)}`); return updateMemoryStep(instruction); },
        }),
        readMemory: tool({
          description: "Read the current memory file. Returns the full markdown content of ~/.dispatch/memories.md. Use when user asks what you remember.",
          inputSchema: z.object({}),
          execute: async () => { log(`readMemory`); return readMemoryFileStep(); },
        }),
        updateSoul: tool({
          description: 'Update the soul/identity file (~/.dispatch/soul.md). A sub-agent will intelligently update your identity — name, personality, tone, style, behavior rules. Use when user tells you who you are, how to behave, your name, etc.',
          inputSchema: z.object({ instruction: z.string().describe("What to change about identity/personality") }),
          execute: async ({ instruction }) => { log(`updateSoul: ${instruction.slice(0, 80)}`); return updateSoulStep(instruction); },
        }),
        readSoul: tool({
          description: "Read the current soul/identity file. Returns the full markdown content of ~/.dispatch/soul.md.",
          inputSchema: z.object({}),
          execute: async () => { log(`readSoul`); return readSoulFileStep(); },
        }),
        sendStatus: tool({
          description: "Send an intermediate status update to the user while working.",
          inputSchema: z.object({ message: z.string().describe("Status message") }),
          execute: async ({ message }) => { log(`sendStatus: ${message.slice(0, 80)}`); return sendStatusStep(threadJson, conversation.id, message); },
        }),
      },
      onStepFinish: async (event) => {
        const tokens = event.usage
          ? `${event.usage.inputTokens ?? 0}in/${event.usage.outputTokens ?? 0}out`
          : "n/a";
        if (event.toolCalls && event.toolCalls.length > 0) {
          const names = event.toolCalls.map((tc: any) => tc.toolName).join(", ");
          log(`Step done: [${names}] tokens=${tokens}`);
          await logMessageStep(
            conversation.id, "tool", null, event.toolCalls, null,
            event.usage ? {
              prompt: event.usage.inputTokens,
              completion: event.usage.outputTokens,
              total: (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0),
            } : undefined
          );
        } else if (event.text) {
          log(`Step done: text="${event.text.slice(0, 80)}..." tokens=${tokens}`);
        }
      },
    });

    log(`Streaming agent response...`);
    const result = await agent.stream({ messages: history, writable, maxSteps: 50 });

    const lastStep = result.steps[result.steps.length - 1];
    const finalText = lastStep?.text ?? "";
    const totalUsage = result.steps.reduce(
      (acc, step) => ({
        prompt: acc.prompt + (step.usage?.inputTokens ?? 0),
        completion: acc.completion + (step.usage?.outputTokens ?? 0),
        total: acc.total + (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
      }),
      { prompt: 0, completion: 0, total: 0 }
    );

    log(`<<< Agent finished`, { steps: result.steps.length, tokens: totalUsage.total, text: finalText.slice(0, 120) });

    if (finalText) {
      await logMessageStep(
        conversation.id, "assistant", finalText, null,
        typeof lastStep?.reasoning === "string" ? lastStep.reasoning : null,
        totalUsage
      );
      log(`Assistant response saved to DB`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`!!! ERROR: ${errorMessage}`);
    // Save error as an assistant message so the handler's poller picks it up and delivers it
    try {
      const errConv = await findOrCreateConversationStep(platform, channelId, threadId);
      await logMessageStep(
        errConv.id,
        "assistant",
        `Something went wrong: ${errorMessage}`
      );
      log(`Error message saved to DB for delivery`);
    } catch (dbErr) {
      log(`Failed to save error to DB: ${dbErr}`);
    }
  }
}
