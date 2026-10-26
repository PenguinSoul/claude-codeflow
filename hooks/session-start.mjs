#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/codeflow", import.meta.url));
const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const result = spawnSync(process.execPath, [cli, "status", "--brief"], {
  cwd,
  encoding: "utf8",
  timeout: 5000,
});

if (result.status === 0 && result.stdout.trim()) {
  process.stdout.write(result.stdout);
}

process.exit(0);
