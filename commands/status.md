---
description: Show the active task, next step, trust, evidence, and PR
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/codeflow:*)
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/codeflow" status --json` (or `--brief`).

Report the task, the suggested next command, trust state, evidence freshness,
PR/check state, and any block. Never infer state from chat or memory.
