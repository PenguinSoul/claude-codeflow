---
name: codeflow
description: "Use when a git repository has .codeflow/config.json, or when the user asks for the codeflow L1 workflow: task-spec, plan, worktree, gates, evidence, self-review, and a pull request. Also use when a task must move from design to delivery without giving up human approval."
---

# Codeflow

Codeflow is an L1 workflow. Humans decide; the CLI executes. You supply
judgement, prose, and code. `codeflow` supplies state, isolation, gates,
evidence, and delivery.

## The boundary

Automated: task creation, task-spec scaffold, plan validation, worktree,
gates, evidence, attention scanning, PR body, push, PR creation, checks,
review-comment collection, status, resume, and cleanup.

Human-only:

1. Trust in the gate commands.
2. Design approval.
3. Plan approval.
4. Self-review sign-off.
5. Merge.
6. Conflict, ambiguity, security, and blocked-state decisions.

The CLI never merges. Do not run `gh pr merge` or approve a PR.

## Hydrate then act

The CLI is the only state owner. Chat memory is not state.

- Run `codeflow status --json` before every transition.
- Re-read `plan.json` / `PLAN.md` and the evidence before acting on them.
- Never edit `.codeflow/state/` by hand.
- Never infer the current step from the conversation.

## Routes

| The ask | First command | Human gate |
| --- | --- | --- |
| New repository | `/codeflow:init` | Review the detected commands |
| New task | `/codeflow:new "<title>"` | Design approval |
| Plan the work | `/codeflow:plan` | Plan approval |
| Implement | `/codeflow:start` | Work inside the worktree |
| Verify | `/codeflow:verify` | Review the attention items |
| Self-review | `/codeflow:self-review` | `/codeflow:approve self-review` |
| Deliver | `/codeflow:pr` | Review and merge |
| Watch | `/codeflow:watch` | Read-only |
| Review comments | `/codeflow:comments` | Read-only |
| Resume | `/codeflow:resume` | Resolve the block first |
| Cleanup | `/codeflow:finish` | Confirm the merge |

## Red lines

These are hard stops, not advice.

- **Never merge.** No `gh pr merge`, no auto-merge, no approval of a PR.
- **Never approve on your own.** Design, plan, and self-review approvals belong
  to the human. Ask, then run the approval command.
- **Never fabricate evidence.** A gate result exists only if `codeflow verify`
  recorded it. "Tests pass" without a JSON result is a lie.
- **Never skip a gate.** Not "small", not "obvious", not "already ran once" when
  the tree changed.
- **Never weaken a gate.** Do not edit tests, add skips, add `@ts-ignore`,
  `@ts-expect-error`, `eslint-disable`, `biome-ignore`, or `as any` to pass.
- **Never work around trust.** If the config is untrusted or stale, stop and ask
  the human to review the commands.
- **Never touch the base branch.** Work only in the task worktree and
  `codeflow/<id>` branch.
- **Never finish an unmerged task.** When `gh` reports the PR open, `finish`
  refuses even with `--confirm` or `--force`. `--force` only bypasses a dirty
  worktree.
- **Never guess at a conflict.** A rebase conflict, ambiguous requirement, or
  security concern becomes `blocked`; ask the human.
- **Never hide a failure.** Report the error code, the failing gate, and the
  hint. Do not retry blindly or silently skip.

## Before and after every step

1. Read `codeflow status --json`.
2. Do the single command that matches the next step.
3. Report the result, the attention items, and the next command.
4. Stop at every human gate.

If `status` says `next: ["approve design"]`, do not implement. If it says
`approve plan`, do not start. If it says `resume`, do not retry the blocked
operation.

## Attention is a spotlight

`verify` records test-file changes, skips, suppressions, config and lockfile
changes, large diffs, scope drift, and closest-look areas. Show them to the
human. They are not an automatic verdict, but they are never hidden.

## Errors

The CLI returns a coded error, a message, details, and a hint. Report all four.
Common codes:

- `E_TRUST_REQUIRED` / `E_TRUST_STALE`: review and approve the commands.
- `E_STATE_CONFLICT`: the task is not in the right state; read `status`.
- `E_APPROVAL_STALE`: an approved artifact changed; re-approve it. After a
  rebase, run `verify`, `self-review`, and `approve self-review` again.
- `E_GATE_FAILED` / `E_GATE_TIMEOUT`: fix the cause; do not weaken the gate.
- `E_DIRTY_TREE`: commit or discard the changes; do not force without the human.
- `E_REBASE_CONFLICT`: the task is blocked; ask the human to resolve the conflict,
  then run `resume`.
- `E_GH_MISSING` / `E_GH_AUTH`: use the compare URL or fix `gh`.
- `E_BLOCKED` / a `blocked` status: stop and ask the human.

## Task artifacts

`.codeflow/state/tasks/<id>/` holds `TASK.md`, `plan.json`, `PLAN.md`,
`evidence.json`, `EVIDENCE.md`, `review.json`, `REVIEW.md`, `pr.json`,
`comments.json`, and `events.jsonl`. `TASK.md` is temporary; durable knowledge
must land in the repository's specs, README, or ADRs before the PR.

## The one-line test

If you are about to do something irreversible, ask: did a human approve this
exact artifact, and did `codeflow verify` record the evidence for this exact
tree? If not, stop.
