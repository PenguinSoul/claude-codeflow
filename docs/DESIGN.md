---
id: design
type: design
status: draft
title: codeflow — integrated design
parent: architecture
covers: summary l1-flow commands artifacts state trust evidence approval attention plugin modules milestones
tags: [design, l1, workflow, claude-code]
---

# codeflow — integrated design

This is the readable integration of the design. The authoritative details live in:

- [`goal-and-requirements.md`](goal-and-requirements.md) — what codeflow is and is not.
- [`architecture.md`](architecture.md) — topology, decisions, invariants, safety.
- [`contracts.md`](contracts.md) — the JSON wire, schemas, and error codes.

## Summary

codeflow is a Claude Code plugin that turns a git repository into an **L1 workflow**:
humans decide, and a deterministic CLI executes the mechanics from task-spec to pull
request, recording evidence at every gate.

- **Claude** supplies judgement, prose, and code.
- **codeflow** supplies state, isolation, gates, evidence, and delivery.
- **The human** supplies trust, design approval, plan approval, self-review, and merge.

The CLI is the only state owner. The plugin is a thin shell: commands call the CLI,
the skill carries the policy, and one session hook shows the active task.

## The L1 contract

| Automated | Human-only |
| --- | --- |
| Task creation and task-spec scaffold | Trust in gate commands |
| Plan validation | Design approval |
| Worktree and branch creation | Plan approval |
| Gate execution and evidence | Self-review sign-off |
| Attention scanning | Merge |
| PR body rendering, push, PR creation | Conflict and exception decisions |
| CI observation (read-only) | — |
| Review-comment collection (read-only) | — |
| Cleanup | — |

There is no merge command. The skill forbids `gh pr merge`. L2 (agent fixes review
comments) and L3 (autonomous merge) are out of scope.

## A day in the life

1. **Onboard.** `/codeflow:init` detects the base branch and candidate gates, writes
   `.codeflow/config.json`, and prints the commands. Nothing runs.
2. **Trust.** `/codeflow:trust` shows every command and its cwd; the human approves.
   Trust is bound to the config hash.
3. **Start a task.** `/codeflow:new "fix the login redirect"` creates a task and a
   lightweight `TASK.md`. Claude interviews the human, fills Request / Product / Design /
   Deferrals, and runs `/codeflow:approve design`.
4. **Plan.** `/codeflow:plan` writes commit-sized steps with a verification line and a
   Conventional Commit subject. The human approves the plan.
5. **Implement.** `/codeflow:start` creates `codeflow/<id>` and a worktree under
   `~/.local/state/codeflow/worktrees/<repo>/<id>`. Claude implements step by step.
6. **Verify.** `/codeflow:verify` runs the fast gates for the task kind, captures
   evidence, and scans the diff for test weakening, suppressions, config changes, scope
   drift, and large diffs. `--full` adds full gates; `--live` needs explicit permission.
7. **Self-review.** `/codeflow:self-review` shows the packet: diff stat, plan status,
   evidence, attention items, scope drift, closest-look areas.
   `/codeflow:approve self-review` records the human sign-off.
8. **Ship.** `/codeflow:pr` requires fresh evidence, a clean tree, and a self-review.
   It rebases onto the base (a conflict blocks the task), force-pushes with lease after a
   rewrite, renders the repository's PR template, and creates the PR with `gh` — or prints
   a compare URL and body path when `gh` is unavailable. If the rebase changes the tree,
   evidence must be refreshed.
9. **Watch.** `/codeflow:watch` reads CI once (snapshot) or with `--wait` and a bounded
   timeout; it never merges. `/codeflow:comments` collects review threads read-only.
10. **Finish.** After the human merges, `/codeflow:finish` verifies the PR state with
    `gh` when available, removes the worktree, and marks the task done. `--force` only
    bypasses a dirty worktree; it never bypasses the merge check.

## Command surface

| CLI | Slash | Purpose |
| --- | --- | --- |
| `codeflow init` | `/codeflow:init` | Detect repo, base, gates; write config; exclude state |
| `codeflow trust` | `/codeflow:trust` | Approve exact gate commands |
| `codeflow new "<request>"` | `/codeflow:new` | Create task and `TASK.md` |
| `codeflow approve design\|plan\|self-review` | `/codeflow:approve` | Hash-bound approval |
| `codeflow plan` | `/codeflow:plan` | Validate and render the step plan |
| `codeflow start` | `/codeflow:start` | Create branch and worktree |
| `codeflow verify` | `/codeflow:verify` | Run gates, capture evidence, scan attention |
| `codeflow self-review` | `/codeflow:self-review` | Build the self-review packet |
| `codeflow pr` | `/codeflow:pr` | Rebase, render body, push, create/update PR |
| `codeflow watch` | `/codeflow:watch` | Read-only CI snapshot or bounded wait |
| `codeflow comments` | `/codeflow:comments` | Read-only review threads |
| `codeflow status` | `/codeflow:status` | Human or `--json` status; `--brief` for hooks |
| `codeflow resume` | `/codeflow:resume` | Resume a blocked task |
| `codeflow finish` | `/codeflow:finish` | Verify the merge, then remove the worktree |
| `codeflow doctor` | `/codeflow:doctor` | Environment and state diagnostics |

All commands support `--json` with the envelope in [`contracts.md`](contracts.md).
Mutating commands support `--dry-run` where a command has side effects.

## Artifact layout

Committed:

```text
.codeflow/config.json
```

Local, gitignored via `.git/info/exclude`:

```text
.codeflow/state/
  active.json
  trust.json
  tasks/<id>/
    task.json
    TASK.md
    plan.json
    PLAN.md
    evidence.json
    EVIDENCE.md
    review.json
    REVIEW.md
    pr.json
    PR_BODY.md
    comments.json
    COMMENTS.md
    events.jsonl
    logs/<gate>.log
```

Worktrees:

```text
~/.local/state/codeflow/worktrees/<repo-slug>/<task-id>/
```

`active.json` is a convenience pointer. Any command accepts `--task <id>`, so multiple
tasks can run in parallel.

## State machine

```text
created → designed → planned → active → verified → pr_open → merged → done
                          ↘ blocked ↗
```

- `created`: task and `TASK.md` exist.
- `designed`: the task-spec is approved and unchanged.
- `planned`: the plan is valid and approved.
- `active`: branch and worktree exist; the task lock is held.
- `verified`: required gates pass; evidence is fresh; attention is recorded.
- `pr_open`: the PR exists (or a compare URL is ready).
- `merged`: a human merged; `gh` confirms when possible.
- `done`: worktree removed and task closed.
- `blocked`: a reason and a hint; `resume` returns to the previous state.

Every transition is guarded. Approvals are hashes; editing an approved artifact
invalidates the approval and blocks the next transition.

## Trust, evidence, approval, attention

**Trust.** `.codeflow/state/trust.json` binds a human approval to the normalized config
hash. `verify` refuses without it. A cloned repository cannot execute its own gates
until a human approves the exact commands.

**Evidence.** `evidence.json` records every gate, exit code, duration, log, tree hash,
config hash, gate-set hash, and dirty state. A PR requires passing, fresh evidence and a
clean tree. Rebase may change the commit ID; the tree hash decides freshness.

**Approval.** Design approval hashes `TASK.md`; plan approval hashes `plan.json`;
self-review hashes the diff and evidence. A change invalidates the approval.

**Attention.** The diff scan surfaces test-file changes, skips, suppressions,
config/lockfile changes, large diffs, scope drift, and closest-look areas. It is a
spotlight for the human, never an automatic verdict.

## Plugin surface

```text
codeflow/
  .claude-plugin/plugin.json
  bin/codeflow                 # on the Bash tool PATH
  src/*.mjs                    # zero-dependency Node ESM
  commands/*.md                # thin wrappers over the CLI
  skills/codeflow/SKILL.md     # L1 policy, gates, red lines
  hooks/hooks.json             # SessionStart → codeflow status --brief
  test/*.test.mjs              # node:test
  docs/                        # this design
  README.md
```

The manifest declares `name`, `displayName`, `version`, `description`, `license`,
`skills`, `commands`, and `hooks`; it declares no MCP server. Every command has
`description`, `argument-hint`, and `allowed-tools: Bash(codeflow:*)`; its body only
calls the CLI and renders the JSON. The `SessionStart` hook matches
`startup|clear|compact`, runs `codeflow status --brief`, and never fails a session when
codeflow is not configured.

The skill is the policy layer. It states:

- Hydrate then act: read `codeflow status --json` before every transition.
- Never merge, never approve a PR, never fabricate evidence.
- Never skip design/plan/self-review gates.
- Never weaken a gate, add a suppression, or edit tests to pass.
- Never run repository-defined commands without trust.
- Stop and escalate on conflicts, ambiguity, auth failures, or repeated gate failures.

## Module map

| Module | Responsibility |
| --- | --- |
| `cli` | Parse, dispatch, envelope, exit codes |
| `contracts` | Schema versions, validators, error codes |
| `repo` / `git` | Git root, base/remote, worktree, tree hash |
| `config` / `trust` | Detect, validate, write config; trust grant |
| `state` | Task store, active pointer, locks, events, atomic writes |
| `task` / `plan` | Task-spec, approvals, step plan |
| `gates` / `evidence` | Gate execution, logs, freshness |
| `attention` | Diff risk scan |
| `selfreview` / `prbody` | Review packet, PR body |
| `github` | `gh` create/update, checks, comments |
| `render` / `doctor` | Human output; diagnostics |

The detailed dependency rules and invariants are in
[`architecture.md`](architecture.md).

## Implementation order

This is the plan skeleton; the detailed plan comes after this design is approved.

- **M0 — Docs and skeleton.** This design, a README, `bin/codeflow`, module stubs.
- **M1 — Contracts, config, state, repo.** `init`, `doctor`, `status --json`, tests.
- **M2 — Task and plan.** `new`, `approve`, `plan`, templates, hash invalidation.
- **M3 — Trust, gates, evidence, attention.** `trust`, `verify`, `review` data.
- **M4 — Git isolation.** `start`, `resume`, `finish`, locks, worktree safety.
- **M5 — Delivery.** `self-review`, `pr`, `watch`, `comments`, fake `gh` tests.
- **M6 — Plugin shell.** Manifest, commands, skill, hook, README.
- **M7 — End-to-end and validation.** Temp-repo golden path, safety tests,
  `claude plugin validate`, manual smoke.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| MCP server first | Adds transport and lifecycle work without changing L1 behavior |
| TypeScript + build step | Install friction; zero-dep Node is enough |
| Pure skills/commands | No durable state, no deterministic evidence |
| Auto-merge | Violates the L1 boundary |
| Single active task per repo | Throws away worktree parallelism |
| Commit-hash evidence | Rebases invalidate valid evidence |
| Parsing human output in commands | Fragile seam; JSON contract is cheaper |
| Trusting committed gate commands | Cloned repository = arbitrary code execution |
| Storing tokens | Adds a secret-management surface; `gh` already owns auth |
| Auto-fixing review comments | That is L2, not L1 |

## Deferred

MCP adapter, screenshot automation, issue-tracker sync, multi-repo orchestration,
L2 review-comment fixes, web UI, task GC, agent-compliance evals, Windows-native
polish.

## Review checklist

Before implementation starts, confirm:

- [ ] The goal and non-goals are right.
- [ ] The L1 boundary is exactly where you want it.
- [ ] The trust model is acceptable.
- [ ] The evidence freshness rule is correct.
- [ ] The command surface is complete enough for the first build.
- [ ] The artifact layout and state machine are acceptable.
- [ ] The plugin shell is the right shape.
- [ ] The implementation order is sensible.
