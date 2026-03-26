import { getWritable, sleep } from "workflow";
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

function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
  if (!match) throw new Error(`Invalid delay: "${delay}". Use e.g. "30s", "5m", "1h", "2d"`);
  const [, num, unit] = match;
  const u = unit!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000, sec: 1000,
    m: 60_000, min: 60_000,
    h: 3600_000, hr: 3600_000, hour: 3600_000,
    d: 86400_000, day: 86400_000,
  };
  return parseInt(num!) * multipliers[u]!;
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
        scheduleDelayed: tool({
          description: 'Sleep for a duration then execute a task. The workflow literally pauses (durably, survives restarts) and resumes after the delay. Use for "do X in 30 minutes", "remind me in 1 hour", "check Y tomorrow". Formats: "30s", "5m", "1h", "2d" or an ISO date string.',
          inputSchema: z.object({
            delay: z.string().describe('Duration like "1m", "30m", "2h", "1d" or ISO date like "2026-03-26T10:00:00Z"'),
            taskPrompt: z.string().describe("What to do after the delay"),
          }),
          execute: async ({ delay: delayStr, taskPrompt }) => {
            log(`scheduleDelayed: delay="${delayStr}" task="${taskPrompt.slice(0, 80)}"`);

            await sendStatusStep(threadJson, conversation.id, `Scheduled: "${taskPrompt.slice(0, 60)}..." — will execute after ${delayStr}`);

            // Determine sleep target: duration string or ISO date
            if (delayStr.includes("T") || delayStr.match(/^\d{4}-/)) {
              const target = new Date(delayStr);
              log(`Sleeping until ${target.toISOString()}`);
              await sleep(target);
            } else {
              const ms = parseDelay(delayStr);
              log(`Sleeping for ${ms}ms (${delayStr})`);
              await sleep(ms);
            }

            log(`Woke up! Executing: ${taskPrompt.slice(0, 80)}`);
            await sendStatusStep(threadJson, conversation.id, `Timer fired! Working on: "${taskPrompt.slice(0, 60)}..."`);

            // Execute the delayed task with a fresh agent
            const freshPrompt = await getSystemPromptStep();
            const freshAgent = new DurableAgent({
              model: google(MODELS.AGENT) as any,
              instructions: freshPrompt + "\n\nYou are executing a previously scheduled task. Complete it and respond with the result.",
              tools: {
                bash: tool({
                  description: "Execute a shell command.",
                  inputSchema: z.object({ command: z.string() }),
                  execute: async ({ command }) => { log(`[delayed] bash: ${command.slice(0, 80)}`); return bashStep(command); },
                }),
                webFetch: tool({
                  description: "HTTP request.",
                  inputSchema: z.object({ url: z.string(), method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET") }),
                  execute: async ({ url, method }) => { log(`[delayed] webFetch: ${method} ${url}`); return webFetchStep(url, method); },
                }),
                readFile: tool({
                  description: "Read a file.",
                  inputSchema: z.object({ path: z.string() }),
                  execute: async ({ path }) => readFileStep(path),
                }),
                writeFile: tool({
                  description: "Write a file.",
                  inputSchema: z.object({ path: z.string(), content: z.string() }),
                  execute: async ({ path, content: c }) => writeFileStep(path, c),
                }),
              },
            });

            const dw = getWritable<UIMessageChunk>();
            const dr = await freshAgent.stream({
              messages: [{ role: "user" as const, content: taskPrompt }],
              writable: dw,
              maxSteps: 20,
            });

            const resultText = dr.steps[dr.steps.length - 1]?.text ?? "Task completed.";
            await logMessageStep(conversation.id, "assistant", `[Scheduled task result]\n${resultText}`);
            log(`Delayed task done: ${resultText.slice(0, 100)}`);
            return { executed: true, result: resultText };
          },
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
