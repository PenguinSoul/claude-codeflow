---
id: contracts
type: contract-design
status: draft
title: codeflow — CLI contracts
parent: architecture
covers: envelope exit-codes errors config trust task plan evidence attention self-review pr event status commands
tags: [contracts, json, cli]
---

# codeflow — CLI contracts

Every command supports `--json`. The JSON is the wire; human output is a renderer of
the same data. Commands, tests, and the plugin shell must never parse prose.

## Envelope

```json
{
  "schemaVersion": 1,
  "command": "status",
  "ok": true,
  "data": {},
  "error": null,
  "warnings": [],
  "meta": {
    "generatedAt": "2026-10-26T10:00:00Z",
    "repoRoot": "/home/user/code/repo",
    "taskId": "2026-10-26-fix-login",
    "cliVersion": "0.1.0"
  }
}
```

Rules:

- `ok: false` implies `data: null` and a non-null `error`.
- `warnings` is always an array; a warning never changes the exit code.
- `meta.taskId` is `null` when no task is selected.
- Unknown fields are ignored by consumers; producers may add fields within the same
  `schemaVersion`.
- Timestamps are ISO 8601 UTC (`2026-10-26T10:00:00Z`).
- Hashes are `sha256:<64 hex chars>`.
- Absolute paths (`repoRoot`, `worktree`) use native separators.
- Repository-relative paths (`taskPath`, `bodyPath`, `logPath`) use POSIX `/` and are
  relative to the repository root.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Success |
| `1` | A required gate failed or timed out |
| `2` | Usage, config, repository, or schema error |
| `3` | State conflict, stale approval, or lock |
| `4` | Git conflict or dirty-tree refusal |
| `5` | GitHub/`gh` missing, unauthenticated, or PR conflict |
| `6` | Trust missing or stale |
| `7` | Task blocked; human action required |
| `8` | Unexpected internal failure |

## Error object

```json
{
  "code": "E_GATE_FAILED",
  "message": "Gate \"test\" exited 1",
  "details": {
    "gate": "test",
    "exitCode": 1,
    "logPath": ".codeflow/state/tasks/2026-10-26-fix-login/logs/test.log"
  },
  "hint": "Fix the failing test, then run `codeflow verify --retry`."
}
```

## Common types

| Type | Shape |
| --- | --- |
| `TaskId` | `^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,63}$` |
| `TaskStatus` | `created`, `designed`, `planned`, `active`, `verified`, `pr_open`, `merged`, `done`, `blocked`, `abandoned` |
| `TaskKind` | `code`, `docs`, `infra`, `test`, `mixed` |
| `GateTier` | `fast`, `full`, `live` |
| `Hash` | `sha256:<64 hex>` |
| `GitTreeHash` | `git:<40 hex>` for SHA-1 or `sha256:<64 hex>` for SHA-256 |
| `IsoTime` | ISO 8601 UTC |
| `RepoPath` | repository-relative POSIX path |
| `AbsPath` | absolute native path |

## Config

`.codeflow/config.json`, committed.

```json
{
  "schemaVersion": 1,
  "baseBranch": "main",
  "remote": "origin",
  "worktreeRoot": "~/.local/state/codeflow/worktrees",
  "stateDir": ".codeflow/state",
  "gates": [
    {
      "name": "lint",
      "command": "npm run lint",
      "cwd": ".",
      "tier": "fast",
      "kinds": ["code", "test", "infra"],
      "required": true,
      "timeoutSec": 300,
      "env": {}
    }
  ],
  "verify": {
    "retryFlaky": true,
    "maxRetries": 1
  },
  "pr": {
    "template": ".github/PULL_REQUEST_TEMPLATE.md",
    "screenshots": "manual",
    "titlePrefix": "",
    "sections": {}
  },
  "attention": {
    "largeDiffFiles": 25,
    "largeDiffLines": 1200,
    "failOn": []
  }
}
```

Rules:

- `gates[].command` is a shell string, executed through the platform shell.
- `gates[].env` may not contain secrets; it is committed.
- `gates[].kinds` limits the gate to those task kinds. An empty array means all kinds.
- `pr.screenshots` is `"manual"` or `{ "command": "npm run screenshots" }`.
- `pr.sections` maps template headings to artifact fields when the template is custom.
- `attention.failOn` accepts attention codes (`skip`, `suppression`, `config`,
  `lockfile`, `large-diff`); empty means warn only.

## Trust

`.codeflow/state/trust.json`, local, never committed.

```json
{
  "schemaVersion": 1,
  "configHash": "sha256:...",
  "approvedBy": "Name <email>",
  "approvedAt": "2026-10-26T10:00:00Z",
  "commands": [
    { "name": "lint", "command": "npm run lint", "cwd": "." }
  ]
}
```

`configHash` is computed over the normalized config with stable key ordering and no
whitespace variance. A command change, cwd change, or gate addition invalidates trust.

## Task

`.codeflow/state/tasks/<id>/task.json`.

```json
{
  "schemaVersion": 1,
  "id": "2026-10-26-fix-login",
  "title": "Fix login redirect",
  "kind": "code",
  "status": "created",
  "branch": "codeflow/2026-10-26-fix-login",
  "worktree": "/home/user/.local/state/codeflow/worktrees/repo/2026-10-26-fix-login",
  "baseBranch": "main",
  "remote": "origin",
  "createdAt": "2026-10-26T09:00:00Z",
  "createdBy": "Name <email>",
  "issues": ["#123"],
  "approvals": {
    "design": {
      "hash": "sha256:...",
      "approvedBy": "Name <email>",
      "approvedAt": "2026-10-26T09:30:00Z",
      "note": ""
    },
    "plan": null,
    "selfReview": null
  },
  "blocked": null,
  "lastEventHash": "sha256:..."
}
```

`blocked` is `null` or:

```json
{
  "code": "E_REBASE_CONFLICT",
  "reason": "origin/main conflicts in src/auth.ts",
  "at": "2026-10-26T11:00:00Z",
  "from": "active",
  "hint": "Resolve the conflict, commit, then run `codeflow resume`."
}
```

## Plan

`.codeflow/state/tasks/<id>/plan.json`.

```json
{
  "schemaVersion": 1,
  "taskId": "2026-10-26-fix-login",
  "steps": [
    {
      "id": "1",
      "title": "Reproduce the redirect loop",
      "status": "pending",
      "commitSubject": "test(auth): reproduce the login redirect loop",
      "verification": "`npm test -- auth` → failing test added",
      "summary": "",
      "note": ""
    }
  ]
}
```

Rules:

- `status` is `pending`, `in_progress`, `done`, or `blocked`.
- `verification` is `check → result` or `not verified`.
- `commitSubject` matches the repository's commit style; Conventional Commits by
  default.
- A step that changes code must have a `commitSubject`.

## Evidence

`.codeflow/state/tasks/<id>/evidence.json`.

```json
{
  "schemaVersion": 1,
  "taskId": "2026-10-26-fix-login",
  "treeHash": "git:...",
  "commit": "abc1234",
  "branch": "codeflow/2026-10-26-fix-login",
  "dirty": false,
  "configHash": "sha256:...",
  "gateSetHash": "sha256:...",
  "nodeVersion": "v26.11.1",
  "platform": "linux",
  "startedAt": "2026-10-26T10:00:00Z",
  "finishedAt": "2026-10-26T10:02:00Z",
  "result": "pass",
  "gates": [
    {
      "name": "lint",
      "command": "npm run lint",
      "tier": "fast",
      "required": true,
      "exitCode": 0,
      "durationMs": 1200,
      "timedOut": false,
      "flaky": false,
      "logPath": ".codeflow/state/tasks/2026-10-26-fix-login/logs/lint.log",
      "tail": "…last 20 lines…"
    }
  ],
  "attention": {
    "testFiles": [],
    "skips": [],
    "suppressions": [],
    "configChanges": [],
    "lockfileChanges": [],
    "largeDiff": {
      "files": 4,
      "lines": 120,
      "thresholdFiles": 25,
      "thresholdLines": 1200
    },
    "scopeDrift": [],
    "closestLook": []
  }
}
```

`treeHash` is the GitHub-style tree object name from `git rev-parse HEAD^{tree}`,
prefixed with `sha256:` only when the hash algorithm is SHA-256. For SHA-1 repositories
it is `git:<40 hex>`; the prefix makes the algorithm explicit.

`configHash` is `sha256` over the normalized config with stable key ordering.
`gateSetHash` is `sha256` over the ordered selected gates' name, command, cwd, tier, and
`required` flag. Both are recomputed on every `verify` and `pr`.

Freshness for `pr`:

```text
result == "pass"
dirty == false
treeHash == current HEAD tree
configHash == current config hash
gateSetHash == current selected gate set
```

## Self-review

`.codeflow/state/tasks/<id>/review.json`.

```json
{
  "schemaVersion": 1,
  "taskId": "2026-10-26-fix-login",
  "diffHash": "sha256:...",
  "evidenceHash": "sha256:...",
  "reviewedBy": "Name <email>",
  "reviewedAt": "2026-10-26T10:10:00Z",
  "notes": "Closest look: redirect loop guard.",
  "acknowledged": ["attention:suppression:src/auth.ts:42"]
}
```

`diffHash` is `sha256` over `git diff --binary <base>...HEAD` in a clean tree.
`evidenceHash` is `sha256` over the canonical `evidence.json` bytes.
`pr` requires a self-review whose `diffHash` and `evidenceHash` match the current diff
and evidence.

## Attention

Embedded in evidence and rendered in the self-review packet:

```json
{
  "testFiles": [{ "path": "src/auth.test.ts", "change": "modified" }],
  "skips": [{ "path": "src/auth.test.ts", "line": 42, "pattern": "it.skip" }],
  "suppressions": [{ "path": "src/auth.ts", "line": 10, "pattern": "@ts-ignore" }],
  "configChanges": [".codeflow/config.json"],
  "lockfileChanges": ["package-lock.json"],
  "largeDiff": {
    "files": 30,
    "lines": 1500,
    "thresholdFiles": 25,
    "thresholdLines": 1200
  },
  "scopeDrift": ["also renamed a helper in src/util.ts"],
  "closestLook": ["the rollback path in src/auth.ts"]
}
```

## PR

`.codeflow/state/tasks/<id>/pr.json`.

```json
{
  "schemaVersion": 1,
  "taskId": "2026-10-26-fix-login",
  "mode": "gh",
  "number": 42,
  "url": "https://github.com/org/repo/pull/42",
  "state": "open",
  "title": "fix(auth): stop the login redirect loop",
  "bodyPath": ".codeflow/state/tasks/2026-10-26-fix-login/PR_BODY.md",
  "headSha": "abc1234",
  "baseBranch": "main",
  "compareUrl": null,
  "createdAt": "2026-10-26T10:20:00Z",
  "lastReadAt": "2026-10-26T10:25:00Z",
  "checks": {
    "state": "pending",
    "total": 5,
    "passed": 3,
    "failed": 0,
    "pending": 2
  }
}
```

`mode` is `gh` or `compare`. In `compare` mode, `number`, `url`, and `checks` may be
`null`; `compareUrl` is present.

## Event

`.codeflow/state/tasks/<id>/events.jsonl`, one JSON object per line.

```json
{
  "schemaVersion": 1,
  "at": "2026-10-26T09:00:00Z",
  "taskId": "2026-10-26-fix-login",
  "type": "task.created",
  "actor": "Name <email>",
  "data": {},
  "prevHash": "sha256:...",
  "hash": "sha256:..."
}
```

Event types: `task.created`, `task.approved`, `plan.approved`, `task.started`,
`verify.started`, `verify.finished`, `review.approved`, `pr.created`, `pr.updated`,
`pr.checks`, `comments.read`, `task.blocked`, `task.resumed`, `task.finished`,
`task.abandoned`, `config.trusted`.

## Status data

```json
{
  "repo": {
    "root": "/home/user/code/repo",
    "baseBranch": "main",
    "remote": "origin"
  },
  "task": {
    "id": "2026-10-26-fix-login",
    "title": "Fix login redirect",
    "kind": "code",
    "status": "verified",
    "branch": "codeflow/2026-10-26-fix-login",
    "worktree": "/home/user/.local/state/codeflow/worktrees/repo/2026-10-26-fix-login"
  },
  "next": ["review", "pr"],
  "trust": {
    "trusted": true,
    "configHash": "sha256:..."
  },
  "evidence": {
    "fresh": true,
    "result": "pass",
    "treeHash": "git:...",
    "finishedAt": "2026-10-26T10:02:00Z"
  },
  "pr": {
    "mode": "gh",
    "number": 42,
    "state": "open",
    "checks": { "state": "pending", "total": 5, "passed": 3, "failed": 0, "pending": 2 }
  },
  "blocked": null
}
```

`next` is an array of suggested commands, never an automatic action.

## Command data

### `init`

```json
{
  "repoRoot": "/repo",
  "baseBranch": "main",
  "remote": "origin",
  "configPath": ".codeflow/config.json",
  "excludePath": ".git/info/exclude",
  "detected": [
    { "name": "lint", "command": "npm run lint", "reason": "package.json script" }
  ],
  "trustRequired": true
}
```

### `trust`

```json
{
  "configHash": "sha256:...",
  "commands": [{ "name": "lint", "command": "npm run lint", "cwd": "." }],
  "approvedBy": "Name <email>",
  "approvedAt": "2026-10-26T10:00:00Z"
}
```

### `new`

```json
{
  "taskId": "2026-10-26-fix-login",
  "taskPath": ".codeflow/state/tasks/2026-10-26-fix-login",
  "taskSpecPath": ".codeflow/state/tasks/2026-10-26-fix-login/TASK.md",
  "kind": "code",
  "next": ["edit TASK.md", "approve design"]
}
```

### `approve`

```json
{
  "target": "design",
  "hash": "sha256:...",
  "approvedBy": "Name <email>",
  "approvedAt": "2026-10-26T09:30:00Z"
}
```

`target` is `design`, `plan`, or `self-review`.

### `plan`

```json
{
  "planPath": ".codeflow/state/tasks/2026-10-26-fix-login/plan.json",
  "steps": 4,
  "approved": true,
  "next": ["start"]
}
```

### `start`

```json
{
  "taskId": "2026-10-26-fix-login",
  "branch": "codeflow/2026-10-26-fix-login",
  "worktree": "/home/user/.local/state/codeflow/worktrees/repo/2026-10-26-fix-login",
  "baseCommit": "abc1234"
}
```

### `verify`

```json
{
  "result": "pass",
  "gates": [
    { "name": "lint", "exitCode": 0, "durationMs": 1200, "required": true }
  ],
  "attention": {
    "testFiles": [],
    "suppressions": [],
    "largeDiff": false
  },
  "evidencePath": ".codeflow/state/tasks/2026-10-26-fix-login/evidence.json",
  "next": ["review", "pr"]
}
```

### `pr`

```json
{
  "mode": "gh",
  "number": 42,
  "url": "https://github.com/org/repo/pull/42",
  "bodyPath": ".codeflow/state/tasks/2026-10-26-fix-login/PR_BODY.md",
  "headSha": "abc1234",
  "checks": { "state": "pending", "total": 5, "passed": 3, "failed": 0, "pending": 2 },
  "rebased": false,
  "baseCommit": "def5678"
}
```

`pr` fetches and rebases the task branch onto `<remote>/<base>` before pushing. A
conflict aborts the rebase, marks the task `blocked` with `E_REBASE_CONFLICT`, and
leaves the worktree clean. If the rebase changes the tree, the existing evidence
is stale: `pr` refuses with `E_APPROVAL_STALE` (`details.rebased: true`) until
`verify`, `self-review`, and `approve self-review` are run again. A rewritten
branch is pushed with `--force-with-lease`.

In `compare` mode, `number`, `url`, and `checks` are `null`, and `compareUrl` is the
pull-request compare link.

### `self-review`

```json
{
  "reviewPath": ".codeflow/state/tasks/2026-10-26-fix-login/REVIEW.md",
  "diffHash": "sha256:...",
  "evidenceHash": "sha256:...",
  "attention": {
    "testFiles": 0,
    "skips": 0,
    "suppressions": 0,
    "configChanges": 0,
    "largeDiff": false
  },
  "signed": false,
  "next": ["approve self-review"]
}
```

### `watch`

```json
{
  "state": "pending",
  "checks": { "total": 5, "passed": 3, "failed": 0, "pending": 2 },
  "lastReadAt": "2026-10-26T10:25:00Z",
  "waited": false,
  "polls": 0,
  "timedOut": false
}
```

`watch --wait` polls only while checks are pending. `--timeout <seconds>` (default
300) and `--interval <ms>` (default 5000) bound the wait; a timeout returns
`timedOut: true` with `W_CHECKS_PENDING` and exit code 0.

### `comments`

```json
{
  "threads": 3,
  "path": ".codeflow/state/tasks/2026-10-26-fix-login/COMMENTS.md",
  "resolved": 1,
  "unresolved": 2
}
```

### `finish`

```json
{
  "taskId": "2026-10-26-fix-login",
  "removedWorktree": true,
  "deletedBranch": false,
  "mergeConfirmedBy": "gh",
  "status": "done"
}
```

`mergeConfirmedBy` is `gh`, `status`, or `confirm`. When `gh` is available and a
GitHub PR is recorded, `finish` trusts the live PR state: an open PR is refused even
with `--confirm` or `--force`. `--confirm` only substitutes for merge detection when
it is unavailable (no `gh`, no GitHub PR, or a compare-mode fallback).

### `resume`

```json
{
  "taskId": "2026-10-26-fix-login",
  "previousStatus": "blocked",
  "status": "active",
  "next": ["verify"]
}
```

### `doctor`

```json
{
  "checks": [
    { "name": "node", "ok": true, "detail": "v26.11.1" },
    { "name": "git", "ok": true, "detail": "2.56.0" },
    { "name": "gh", "ok": false, "detail": "not installed; PR creation will use compare URL" },
    { "name": "trust", "ok": true, "detail": "config hash matches" }
  ]
}
```

`doctor` checks: Node version, git repository, config parse, trust hash, `gh` presence
and auth, worktree root writability, artifact schema versions, and stale locks. A
failed check never changes repository state.

## Schema evolution

- Additive fields are allowed within a `schemaVersion`.
- Removing or renaming a field, changing its type, or changing semantics requires a
  version bump.
- The CLI rejects artifacts newer than it supports (`E_SCHEMA_UNSUPPORTED`).
- Older artifacts are migrated with a backup under `.codeflow/state/backups/`.
- Migrations are pure functions with fixtures, not best-effort reads.
