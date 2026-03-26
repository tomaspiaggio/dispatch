import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// Configurable base dir — defaults to ~/.dispatch, can be overridden for tests
let _baseDir: string | null = null;

export function setConfigDir(dir: string) {
  _baseDir = dir;
}

export function getConfigDir(): string {
  return _baseDir ?? join(homedir(), ".dispatch");
}

export async function ensureConfigDir(): Promise<string> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readConfigFile(
  filename: string,
  fallback: string
): Promise<string> {
  const dir = await ensureConfigDir();
  try {
    return await readFile(join(dir, filename), "utf-8");
  } catch {
    return fallback;
  }
}

export async function writeConfigFile(
  filename: string,
  content: string
): Promise<void> {
  const dir = await ensureConfigDir();
  await writeFile(join(dir, filename), content, "utf-8");
}
