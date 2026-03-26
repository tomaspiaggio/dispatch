import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export async function writeFileStep(path: string, content: string) {
  "use step";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
  return { path, bytesWritten: content.length };
}
