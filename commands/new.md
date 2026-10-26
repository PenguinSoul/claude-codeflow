---
description: Create a task and a lightweight task-spec
argument-hint: "<task title>"
allowed-tools: Bash(codeflow:*), Read, Write, Edit
---

Run `codeflow new "$ARGUMENTS" --json`.

Then interview the human and fill the generated `TASK.md` with Request,
Product, Design, and Deferrals. Do not write code before the design is
approved. Keep the task-spec short and concrete.

Next: `/codeflow:approve design`.
