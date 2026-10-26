---
description: Create, validate, and render the task plan
allowed-tools: Bash(codeflow:*), Read, Write, Edit
---

Run `codeflow plan --init --json` if `plan.json` does not exist. Replace the
template step with commit-sized steps that each carry a title, commitSubject,
and a concrete verification line.

Run `codeflow plan --json` to validate and render `PLAN.md`. Ask the human to
review it.

Next: `/codeflow:approve plan`.
