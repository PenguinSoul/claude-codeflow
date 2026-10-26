---
description: Approve the design, plan, or self-review by hash
argument-hint: "design|plan|self-review"
allowed-tools: Bash(codeflow:*), Read
---

Read the artifact first: `TASK.md` for design, `plan.json` for plan, or
`REVIEW.md` for self-review. Ask the human to confirm it is what they want.

Only then run `codeflow approve $ARGUMENTS --json`. Never approve on your own,
and re-run the matching step if the artifact changed.
