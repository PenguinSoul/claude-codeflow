---
description: Remove the task worktree after the human confirms the merge
allowed-tools: Bash(codeflow:*)
---

Run `codeflow finish --json` only after the human confirms the merge.

When `gh` is available and the task has a GitHub PR, `finish` reads the live PR
state and refuses unless it is merged. `--confirm` only substitutes for merge
detection when it is unavailable. `--force` only bypasses a dirty worktree; it
never bypasses the merge check.

Use `--delete-branch` only when the human asks. Use `--force` only when the human
explicitly accepts losing uncommitted work.
