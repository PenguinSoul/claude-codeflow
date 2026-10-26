---
description: Render the PR body and create or update the pull request
allowed-tools: Bash(codeflow:*), Read
---

Run `codeflow pr --json`.

It requires fresh evidence and an approved self-review. It pushes the task
branch and creates or updates the PR through `gh`, or prints a compare URL when
`gh` is unavailable.

Never merge and never approve the PR. Report the PR URL, the checks, and any
warning.

Next: `/codeflow:watch`.
