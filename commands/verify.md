---
description: Run the gates and record tree-hash evidence
allowed-tools: Bash(codeflow:*), Read, Write, Edit
---

Run `codeflow verify --json` in the task worktree.

Use `--full` for full gates. Use `--live` only with explicit human permission
and `--allow-live`. Report the gate results and every attention item from the
JSON. Never claim a gate passed unless the JSON says so.

If a gate fails, fix the cause. Never weaken a test, skip a test, or add a
suppression to make it pass. If the task is blocked, stop and explain why.

Next: `/codeflow:self-review`.
