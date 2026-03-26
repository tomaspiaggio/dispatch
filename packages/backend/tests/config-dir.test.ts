import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import {
  setConfigDir,
  getConfigDir,
  ensureConfigDir,
  readConfigFile,
  writeConfigFile,
} from "../src/lib/config-dir";

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "dispatch-config-test-"));
  setConfigDir(testDir);
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("config dir", () => {
  it("returns the configured dir", () => {
    expect(getConfigDir()).toBe(testDir);
  });

  it("ensures dir exists", async () => {
    const dir = await ensureConfigDir();
    expect(dir).toBe(testDir);
  });
});

describe("readConfigFile", () => {
  it("returns fallback when file does not exist", async () => {
    const result = await readConfigFile("nonexistent.md", "default content");
    expect(result).toBe("default content");
  });

  it("reads existing file", async () => {
    await writeConfigFile("test.md", "hello world");
    const result = await readConfigFile("test.md", "fallback");
    expect(result).toBe("hello world");
  });
});

describe("writeConfigFile", () => {
  it("writes a file and can read it back", async () => {
    await writeConfigFile("soul.md", "# Soul\n\n- **Name:** Dispatch");
    const content = await readFile(join(testDir, "soul.md"), "utf-8");
    expect(content).toContain("Dispatch");
  });

  it("overwrites existing file", async () => {
    await writeConfigFile("memo.md", "version 1");
    await writeConfigFile("memo.md", "version 2");
    const content = await readConfigFile("memo.md", "");
    expect(content).toBe("version 2");
  });
});

describe("memory and soul file operations", () => {
  it("reads memories with default fallback", async () => {
    const content = await readConfigFile(
      "memories-test.md",
      "# Memories\n\nNo memories yet."
    );
    expect(content).toContain("Memories");
  });

  it("writes and reads soul file", async () => {
    const soul = `# Soul

- **Name:** chepibito
- **Tone:** Casual, direct
- **Owner:** Tom
`;
    await writeConfigFile("soul-test.md", soul);
    const read = await readConfigFile("soul-test.md", "");
    expect(read).toContain("chepibito");
    expect(read).toContain("Tom");
  });

  it("simulates memory update cycle", async () => {
    // Initial
    await writeConfigFile("mem-cycle.md", "# Memories\n\n- Use pnpm always");

    // Read current
    const current = await readConfigFile("mem-cycle.md", "");
    expect(current).toContain("pnpm");

    // "Sub-agent" produces updated version
    const updated = current + "\n- Deploy on Fridays only";
    await writeConfigFile("mem-cycle.md", updated);

    // Verify
    const final = await readConfigFile("mem-cycle.md", "");
    expect(final).toContain("pnpm");
    expect(final).toContain("Fridays");
  });
});
