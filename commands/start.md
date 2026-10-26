---
description: Create the task branch and worktree
allowed-tools: Bash(codeflow:*), Read
---

Run `codeflow start --json`.

It creates the task branch and an isolated worktree. Do not edit the base
branch, and work inside the printed worktree from now on.

Next: implement the plan, then `/codeflow:verify`.
