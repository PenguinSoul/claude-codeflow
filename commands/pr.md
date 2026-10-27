---
description: Render the PR body and create or update the pull request
allowed-tools: Bash(codeflow:*), Read
---

Run `codeflow pr --json`.

It requires fresh evidence and an approved self-review. It fetches the base,
rebases the task branch, pushes it, and creates or updates the PR through `gh`,
or prints a compare URL when `gh` is unavailable.

A rebase conflict marks the task `blocked` with `E_REBASE_CONFLICT`; stop and ask
the human to resolve it. If the rebase changes the tree, `pr` refuses with
`E_APPROVAL_STALE`; run `/codeflow:verify`, `/codeflow:self-review`, and
`/codeflow:approve self-review` again.

Never merge and never approve the PR. Report the PR URL, the checks, and any
warning.

Next: `/codeflow:watch`.
