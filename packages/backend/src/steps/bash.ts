import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function bashStep(
  command: string,
  cwd?: string,
  timeout: number = 30000
) {
  "use step";
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ?? process.env.HOME,
      timeout,
      maxBuffer: 1024 * 1024 * 10, // 10MB
      shell: "/bin/zsh",
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
