# codeflow

codeflow is a Claude Code plugin that turns a git repository into an **L1
workflow**: humans decide, and a deterministic CLI executes the mechanics from
task-spec to pull request with recorded evidence.

- **Claude** supplies judgement, prose, and code.
- **codeflow** supplies state, isolation, gates, evidence, and delivery.
- **The human** supplies trust, design approval, plan approval, self-review, and
  merge.

The CLI is the only state owner. The plugin is a thin shell: commands call the
CLI, one skill carries the policy, and one session hook shows the active task.

## The boundary

Automated: task creation, task-spec scaffold, plan validation, worktree, gates,
evidence, attention scanning, PR body, push, PR creation, CI observation,
review-comment collection, status, resume, and cleanup.

Human-only: trust in the gate commands, design approval, plan approval,
self-review sign-off, merge, and exception decisions. codeflow never merges.

## Requirements

- Node.js >= 20
- git
- `gh` (optional; without it, PR creation falls back to a compare URL)
- Claude Code

The first supported platform is WSL/Linux. The CLI is portable Node, but Windows
native polish is deferred.

## Install

Load the plugin from the checkout:

```bash
claude --plugin-dir ~/projects/codeflow
```

Or install it from this repository as a marketplace:

```text
/plugin install codeflow --marketplace PenguinSoul/codeflow
```

The plugin's `bin/` directory is added to the Bash tool's `PATH`, so the
`codeflow` command is available while the plugin is enabled. You can also run
`bin/codeflow` directly.

## Quickstart

```bash
# 1. Detect the repository and write .codeflow/config.json
codeflow init

# 2. Review every gate command, then approve it
codeflow trust
codeflow trust --yes

# 3. Create a task and fill TASK.md
codeflow new "Fix the login redirect"
# edit .codeflow/state/tasks/<id>/TASK.md
codeflow approve design

# 4. Create and approve the plan
codeflow plan --init
# edit .codeflow/state/tasks/<id>/plan.json
codeflow plan
codeflow approve plan

# 5. Work in an isolated worktree
codeflow start
# implement inside the printed worktree

# 6. Verify, review, and ship
codeflow verify
codeflow self-review
codeflow approve self-review
codeflow pr
codeflow watch
codeflow comments
```

Every command supports `--json`.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Detect the base branch, package manager, and candidate gates |
| `trust` | Show and approve the exact gate commands |
| `new` | Create a task and a lightweight task-spec |
| `approve` | Approve the design, plan, or self-review by hash |
| `plan` | Validate and render the step plan |
| `start` | Create the task branch and worktree |
| `verify` | Run the gates and record evidence |
| `self-review` | Build the self-review packet |
| `pr` | Render the PR body and create/update the PR |
| `watch` | Read the PR checks |
| `comments` | Collect review comments without changing code |
| `status` | Show the active task and next step |
| `resume` | Clear a blocked state |
| `finish` | Remove the worktree after the merge |
| `doctor` | Check the environment and configuration |

## Artifacts

Committed:

```text
.codeflow/config.json
```

Local, excluded through `.git/info/exclude`:

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

Worktrees live under `~/.local/state/codeflow/worktrees/<repo>/<task>` by
default.

## Safety

- No gate runs until a human approves the exact config hash.
- Evidence is tree-based: a rebase may reuse it only when the tree is unchanged.
- No PR without fresh evidence, a clean tree, and an approved self-review.
- No merge command exists; the skill forbids `gh pr merge`.
- Gate logs are local-only and may contain sensitive output.
- The CLI stores no tokens; `gh` owns GitHub auth.

## Development

```bash
npm test          # node:test, temporary repositories, fake gates and fake gh
```

Design and contracts live in [`docs/`](docs/):

- [`docs/goal-and-requirements.md`](docs/goal-and-requirements.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/contracts.md`](docs/contracts.md)
- [`docs/DESIGN.md`](docs/DESIGN.md)

Licensed under the MIT License.
