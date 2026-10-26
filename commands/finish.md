---
description: Remove the task worktree after the human confirms the merge
allowed-tools: Bash(codeflow:*)
---

Run `codeflow finish --json` only after the human confirms the merge.

Use `--confirm` for a merged PR. Use `--delete-branch` only when the human asks.
Use `--force` only when the human explicitly accepts losing uncommitted work.
