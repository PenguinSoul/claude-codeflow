---
description: Create, validate, and render the task plan
allowed-tools: Bash(codeflow:*), Read, Write, Edit
---

Run `codeflow plan --init --json` if `plan.json` does not exist. Replace the
template step with commit-sized steps that each carry a title, commitSubject,
and a concrete verification line.

Run `codeflow plan --json` to validate and render `PLAN.md`. Ask the human to
review it.

After the plan is approved and the task is active, record progress with
`codeflow plan step <id> --status done --summary "<what changed>" --result
"<check → result>" --json`. Do not edit `status`, `summary`, or `result` by hand.
`pr` refuses while any step is open.

Next: `/codeflow:approve plan`.
