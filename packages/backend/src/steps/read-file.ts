import { readFile } from "fs/promises";

export async function readFileStep(path: string) {
  "use step";
  const content = await readFile(path, "utf-8");
  return { path, content, size: content.length };
}
