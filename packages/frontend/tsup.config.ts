import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  outDir: "dist",
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "ink",
    "ink-text-input",
    "ink-spinner",
    "react",
    "@tanstack/react-query",
    "@trpc/client",
    "@trpc/react-query",
  ],
});
