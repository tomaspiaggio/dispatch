import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir } from "fs/promises";

const execFileAsync = promisify(execFile);

export async function runScriptStep(scriptPath: string, args: string[] = []) {
  "use step";
  const cwd = "/tmp/dispatch-scripts";
  await mkdir(cwd, { recursive: true });

  try {
    const { stdout, stderr } = await execFileAsync("node", [scriptPath, ...args], {
      timeout: 60000,
      cwd,
      maxBuffer: 1024 * 1024 * 10,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? (error as Error).message,
      exitCode: execError.code ?? 1,
    };
  }
}
