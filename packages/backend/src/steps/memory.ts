import { DurableAgent } from "@workflow/ai/agent";
import { google } from "@workflow/ai/google";
import type { UIMessageChunk } from "ai";
import { getWritable } from "workflow";
import { MODEL_ID } from "@dispatch/shared";

const DEFAULT_MEMORIES = `# Memories

Instructions, preferences, and things to remember.

<!-- Add memories below. Each section or bullet is a memory. -->
`;

const DEFAULT_SOUL = `# Soul

Who I am and how I behave.

- **Name:** Chepibe
- **Tone:** Helpful and concise
- **Style:** Direct, no fluff
`;

// All file I/O happens inside step functions to avoid Node.js module errors in the workflow sandbox

export async function getMemoriesContent(): Promise<string> {
  "use step";
  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  try {
    return await readFile(join(dir, "memories.md"), "utf-8");
  } catch {
    return DEFAULT_MEMORIES;
  }
}

export async function getSoulContent(): Promise<string> {
  "use step";
  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  try {
    return await readFile(join(dir, "soul.md"), "utf-8");
  } catch {
    return DEFAULT_SOUL;
  }
}

async function writeMemoryFile(content: string) {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "memories.md"), content, "utf-8");
}

async function writeSoulFile(content: string) {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "soul.md"), content, "utf-8");
}

export async function updateMemoryStep(instruction: string) {
  "use step";

  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  let current: string;
  try {
    current = await readFile(join(dir, "memories.md"), "utf-8");
  } catch {
    current = DEFAULT_MEMORIES;
  }

  console.log(`[memory] Updating with: "${instruction.slice(0, 80)}"`);

  const agent = new DurableAgent({
    model: google(MODEL_ID) as any,
    instructions: `You are a memory manager. You maintain a markdown file of memories/instructions for an AI assistant.

Your job: Given the CURRENT memory file and a NEW INSTRUCTION, produce an UPDATED memory file.

Rules:
- If the new instruction contradicts an existing memory, REPLACE the old one
- If it's a refinement, UPDATE the existing entry
- If it's new, ADD it in the right section
- Keep it organized with clear sections and bullet points
- Keep it concise — no redundancy
- Preserve the "# Memories" header
- Return ONLY the updated markdown, nothing else (no code fences)

CURRENT MEMORY FILE:
${current}

NEW INSTRUCTION: ${instruction}`,
  });

  const writable = getWritable<UIMessageChunk>();
  const result = await agent.stream({
    messages: [{ role: "user", content: "Update the memory file." }],
    writable,
    maxSteps: 1,
  });

  const raw = result.steps[result.steps.length - 1]?.text ?? current;
  const cleaned = raw.replace(/^```(?:markdown)?\n?/m, "").replace(/\n?```$/m, "").trim();

  await writeMemoryFile(cleaned + "\n");
  console.log(`[memory] Updated (${cleaned.length} chars)`);
  return { updated: true, instruction };
}

export async function updateSoulStep(instruction: string) {
  "use step";

  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  let current: string;
  try {
    current = await readFile(join(dir, "soul.md"), "utf-8");
  } catch {
    current = DEFAULT_SOUL;
  }

  console.log(`[soul] Updating with: "${instruction.slice(0, 80)}"`);

  const agent = new DurableAgent({
    model: google(MODEL_ID) as any,
    instructions: `You are a soul/identity manager. You maintain a markdown file defining an AI assistant's personality.

Your job: Given the CURRENT soul file and a NEW INSTRUCTION, produce an UPDATED soul file.

Rules:
- If the instruction changes an existing attribute, UPDATE it
- If it adds a new trait, ADD it
- If it contradicts, REPLACE the old version
- Use bullet points with bold keys for attributes
- Preserve the "# Soul" header
- Return ONLY the updated markdown, nothing else (no code fences)

CURRENT SOUL FILE:
${current}

NEW INSTRUCTION: ${instruction}`,
  });

  const writable = getWritable<UIMessageChunk>();
  const result = await agent.stream({
    messages: [{ role: "user", content: "Update the soul file." }],
    writable,
    maxSteps: 1,
  });

  const raw = result.steps[result.steps.length - 1]?.text ?? current;
  const cleaned = raw.replace(/^```(?:markdown)?\n?/m, "").replace(/\n?```$/m, "").trim();

  await writeSoulFile(cleaned + "\n");
  console.log(`[soul] Updated (${cleaned.length} chars)`);
  return { updated: true, instruction };
}

export async function readMemoryFileStep() {
  "use step";
  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  try {
    return await readFile(join(dir, "memories.md"), "utf-8");
  } catch {
    return DEFAULT_MEMORIES;
  }
}

export async function readSoulFileStep() {
  "use step";
  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });
  try {
    return await readFile(join(dir, "soul.md"), "utf-8");
  } catch {
    return DEFAULT_SOUL;
  }
}
