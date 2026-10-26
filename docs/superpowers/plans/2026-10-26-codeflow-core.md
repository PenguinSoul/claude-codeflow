# codeflow v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Claude Code plugin and zero-dependency Node CLI that executes the L1 workflow from task-spec to PR with recorded evidence and human gates.

**Architecture:** A deterministic ESM CLI (`bin/codeflow`) owns state, worktrees, gates, evidence, and delivery. Claude Code commands are thin wrappers over `codeflow <verb> --json`; a skill carries the L1 policy; one `SessionStart` hook injects the active task. JSON contracts are the only wire between the CLI and the shell.

**Tech Stack:** Node >= 20, ESM, `node:test`, git, `gh` (optional), Claude Code plugin manifest.

**Spec:** `docs/DESIGN.md`, `docs/goal-and-requirements.md`, `docs/architecture.md`, `docs/contracts.md`

## Global Constraints

- Zero runtime dependencies. No build step. Node >= 20.
- Every command supports `--json` and returns the envelope in `docs/contracts.md`.
- State lives under `.codeflow/state/`; exclude it through `.git/info/exclude`.
- Config lives at `.codeflow/config.json` and is committed.
- Never merge, never approve a PR, never fabricate evidence.
- No gate runs without a trust grant bound to the current config hash.
- Evidence freshness is tree-based; rebases may reuse evidence only when the tree hash is unchanged.
- Tests use `node:test`, temporary git repositories, fake gates, and a fake `gh`. No network.
- No `@ts-ignore`, `eslint-disable`, or equivalent suppressions.
- One commit per task, Conventional Commits.
- Bootstrap: this task runs on branch `codeflow/2026-10-26-codeflow-core` in the project folder because `start` does not exist yet. Later tasks use a worktree.

## File Structure

```text
package.json
bin/codeflow
src/cli.mjs
src/contracts.mjs
src/util.mjs
src/repo.mjs
src/config.mjs
src/state.mjs
src/task.mjs
src/plan.mjs
src/trust.mjs
src/gates.mjs
src/attention.mjs
src/evidence.mjs
src/git.mjs
src/selfreview.mjs
src/prbody.mjs
src/github.mjs
src/render.mjs
src/doctor.mjs
test/*.test.mjs
test/fixtures/*
.claude-plugin/plugin.json
commands/*.md
skills/codeflow/SKILL.md
hooks/hooks.json
hooks/session-start.mjs
README.md
```

Each module has one responsibility. `cli.mjs` orchestrates; feature modules never import it. `git.mjs` is the only module that runs `git`; `github.mjs` is the only module that runs `gh`.

---

### Task 1: M1 — CLI skeleton, contracts, config, state, init/status/doctor

**Files:**
- Create: `package.json`, `bin/codeflow`
- Create: `src/cli.mjs`, `src/contracts.mjs`, `src/util.mjs`, `src/repo.mjs`, `src/config.mjs`, `src/state.mjs`, `src/doctor.mjs`, `src/render.mjs`
- Test: `test/contracts.test.mjs`, `test/repo.test.mjs`, `test/config.test.mjs`, `test/state.test.mjs`, `test/cli.test.mjs`, `test/init.test.mjs`
- Modify: `.git/info/exclude` (add `.codeflow/state/`)

**Interfaces:**
- `run(argv, io) -> Promise<number>` in `cli.mjs`; `io` is `{ cwd, stdout, stderr }`.
- `ok(command, data, meta) -> Envelope`; `fail(command, error, meta) -> Envelope`; `ERRORS` and `EXIT` in `contracts.mjs`.
- `findRepo(cwd) -> { root, gitDir, commonDir, excludePath, baseBranch, remote }` in `repo.mjs`.
- `detectConfig(repo) -> Config`; `loadConfig(root) -> Config`; `validateConfig(config) -> string[]` in `config.mjs`.
- `statePaths(root, config) -> { stateDir, tasksDir, activePath, trustPath }`; `writeJsonAtomic(path, value)`; `readJson(path)` in `state.mjs`.
- `doctor(repo, config) -> { checks: Check[] }` in `doctor.mjs`.

- [ ] **Step 1: Write the failing envelope test**

```js
// test/contracts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ok, fail, ERRORS, EXIT } from "../src/contracts.mjs";

test("ok envelope has the contract shape", () => {
  const e = ok("status", { task: null });
  assert.equal(e.schemaVersion, 1);
  assert.equal(e.command, "status");
  assert.equal(e.ok, true);
  assert.deepEqual(e.data, { task: null });
  assert.equal(e.error, null);
  assert.deepEqual(e.warnings, []);
});

test("fail envelope carries a coded error", () => {
  const e = fail("init", { code: ERRORS.NOT_REPO, message: "no git" });
  assert.equal(e.ok, false);
  assert.equal(e.data, null);
  assert.equal(e.error.code, "E_NOT_REPO");
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test test/contracts.test.mjs`
Expected: FAIL with `Cannot find module '../src/contracts.mjs'`.

- [ ] **Step 3: Implement `package.json`, `bin/codeflow`, `contracts.mjs`, `util.mjs`**

`package.json`:

```json
{
  "name": "codeflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "codeflow": "./bin/codeflow" },
  "scripts": {
    "test": "node --test",
    "check": "node scripts/check-syntax.mjs"
  },
  "engines": { "node": ">=20" }
}
```

`bin/codeflow`:

```js
#!/usr/bin/env node
import { run } from "../src/cli.mjs";
const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exitCode = code;
```

`src/contracts.mjs` defines `SCHEMA_VERSION = 1`, `EXIT`, `ERRORS`, `ok()`, `fail()`, and `error()`.

- [ ] **Step 4: Run the envelope test**

Run: `node --test test/contracts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing repo/config test**

```js
// test/repo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { findRepo } from "../src/repo.mjs";

test("findRepo resolves root, base branch, and remote", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codeflow-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "git@example.com:org/repo.git"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# temp\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"], { cwd: dir });
  const repo = findRepo(dir);
  assert.equal(repo.baseBranch, "main");
  assert.equal(repo.remote, "origin");
  assert.ok(repo.excludePath.endsWith("info/exclude"));
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `node --test test/repo.test.mjs`
Expected: FAIL with `Cannot find module '../src/repo.mjs'`.

- [ ] **Step 7: Implement `repo.mjs`, `config.mjs`, `state.mjs`**

`repo.mjs` uses `execFileSync("git", ...)` with `cwd` and trims output. It resolves the root, common dir, exclude path, remote (`origin` or the first), and base branch (`refs/remotes/<remote>/HEAD`, current branch, then `main`/`master`).

`config.mjs` detects Node/Python/Go/Rust gates only when the marker and command exist. It writes a deterministic config. `validateConfig` returns human-readable errors.

`state.mjs` resolves paths, creates directories, and writes JSON through a temp file + rename.

- [ ] **Step 8: Run repo/config/state tests**

Run: `node --test test/repo.test.mjs test/config.test.mjs test/state.test.mjs`
Expected: PASS.

- [ ] **Step 9: Write the failing `init`/`status`/`doctor` integration test**

```js
// test/init.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { run } from "../src/cli.mjs";

test("init writes config and excludes state; status and doctor are JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codeflow-init-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "git@example.com:org/repo.git"], { cwd: dir });

  const env = { cwd: dir, stdout: { write() {} }, stderr: { write() {} } };
  assert.equal(await run(["init", "--json"], env), 0);
  const config = JSON.parse(await readFile(join(dir, ".codeflow/config.json"), "utf8"));
  assert.equal(config.baseBranch, "main");
  assert.ok((await readFile(join(dir, ".git/info/exclude"), "utf8")).includes(".codeflow/state/"));

  assert.equal(await run(["status", "--json"], env), 0);
  assert.equal(await run(["doctor", "--json"], env), 0);
});
```

- [ ] **Step 10: Run it and verify it fails**

Run: `node --test test/init.test.mjs`
Expected: FAIL because `run()` is not implemented.

- [ ] **Step 11: Implement `cli.mjs`, `render.mjs`, `doctor.mjs`, and the `init`/`status`/`doctor` handlers**

- `cli.mjs` parses `--json`, `--help`, `--version`, `--task`, `--dry-run`; dispatches; prints the envelope or human output; returns the exit code.
- `init` writes config, creates `.codeflow/state/`, and appends `.codeflow/state/` to `.git/info/exclude` when absent.
- `status` reads config, active task, trust, and returns `task: null` plus `next` when no task exists.
- `doctor` checks node, git, gh, config, trust, state dir, and schema versions.

- [ ] **Step 12: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add package.json bin src test
git commit -m "feat(cli): add the codeflow skeleton with init, status, and doctor"
```

---

### Task 2: M2 — task-spec, approvals, and plan

**Files:**
- Create: `src/task.mjs`, `src/plan.mjs`, `templates/TASK.md`, `templates/plan.json`
- Test: `test/task.test.mjs`, `test/plan.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- `createTask(repo, config, { title, kind, issues }) -> Task`
- `approveTask(task, target, actor) -> Task`
- `hashFile(path) -> Hash`
- `validatePlan(plan, task) -> string[]`
- `renderPlan(plan) -> string`

- [ ] **Step 1: Write failing tests for `new` and hash-bound design approval** (create task, assert `TASK.md` exists, approve, change `TASK.md`, assert stale).
- [ ] **Step 2: Run and verify failure.**
- [ ] **Step 3: Implement templates, `createTask`, `approveTask`, and hashes.**
- [ ] **Step 4: Write failing tests for plan validation and approval** (missing `verification` rejected, approval hash invalidated by edits).
- [ ] **Step 5: Implement `plan` and `approve plan`.**
- [ ] **Step 6: Run `npm test`.**
- [ ] **Step 7: Commit:** `feat(task): add task-spec creation and hash-bound approvals`

---

### Task 3: M3 — trust, gates, evidence, attention

**Files:**
- Create: `src/trust.mjs`, `src/gates.mjs`, `src/attention.mjs`, `src/evidence.mjs`
- Test: `test/trust.test.mjs`, `test/gates.test.mjs`, `test/attention.test.mjs`, `test/evidence.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- `trustConfig(repo, config, actor) -> Trust`
- `assertTrusted(repo, config) -> Trust`
- `selectGates(config, kind, tier) -> Gate[]`
- `runGates(gates, cwd, { retry, timeoutMul }) -> GateResult[]`
- `scanAttention(changedFiles, config) -> Attention`
- `buildEvidence(...) -> Evidence`; `isFresh(evidence, gitTree, config, gates) -> boolean`

- [ ] **Step 1: Write failing trust tests** (untrusted verify exits 6; config change invalidates trust).
- [ ] **Step 2: Run and verify failure.**
- [ ] **Step 3: Implement `trust` and `assertTrusted`.**
- [ ] **Step 4: Write failing gate/evidence tests** (pass, fail, timeout, retry-once flaky, tree-hash reuse after rebase, stale after content change).
- [ ] **Step 5: Implement `gates` and `evidence`.**
- [ ] **Step 6: Write failing attention tests** (test file, skip, suppression, config, large diff).
- [ ] **Step 7: Implement `attention` and wire `verify`.**
- [ ] **Step 8: Run `npm test`.**
- [ ] **Step 9: Commit:** `feat(verify): add trust-bound gates with tree-hash evidence`

---

### Task 4: M4 — worktree isolation, start, resume, finish

**Files:**
- Create: `src/git.mjs`
- Test: `test/git.test.mjs`, `test/worktree.test.mjs`
- Modify: `src/cli.mjs`, `src/state.mjs`

**Interfaces:**
- `createWorktree(repo, task) -> { branch, worktree }`
- `removeWorktree(repo, task, { force }) -> void`
- `treeHash(cwd) -> GitTreeHash`
- `isClean(cwd) -> boolean`
- `withTaskLock(path, fn) -> result`

- [ ] **Step 1: Write failing tests for `start`** (creates branch/worktree; reuses an existing one; lock contention exits 3).
- [ ] **Step 2: Run and verify failure.**
- [ ] **Step 3: Implement worktree creation and locks.**
- [ ] **Step 4: Write failing tests for `finish`** (dirty refuses; clean removes; `--force` requires `--confirm`).
- [ ] **Step 5: Implement `finish` and `resume`.**
- [ ] **Step 6: Run `npm test`.**
- [ ] **Step 7: Commit:** `feat(git): add per-task worktrees and safe cleanup`

---

### Task 5: M5 — self-review, PR body, PR, watch, comments

**Files:**
- Create: `src/selfreview.mjs`, `src/prbody.mjs`, `src/github.mjs`
- Test: `test/prbody.test.mjs`, `test/github.test.mjs`, `test/pr.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- `buildReviewPacket(...) -> Review`
- `renderPrBody(template, task, plan, evidence, attention) -> string`
- `createOrUpdatePr(repo, task, bodyPath, title) -> Pr`
- `readChecks(pr) -> Checks`; `readComments(pr) -> Comment[]`

- [ ] **Step 1: Write failing PR body tests** (template sections preserved; only evidence-backed checkboxes ticked; attention section appended).
- [ ] **Step 2: Run and verify failure.**
- [ ] **Step 3: Implement `prbody` and `selfreview`.**
- [ ] **Step 4: Write failing GitHub tests** with a fake `gh` on `PATH` (create, update, compare fallback, missing auth).
- [ ] **Step 5: Implement `github`, `pr`, `watch`, `comments`.**
- [ ] **Step 6: Run `npm test`.**
- [ ] **Step 7: Commit:** `feat(pr): render the template and ship through gh or compare URL`

---

### Task 6: M6 — Claude Code plugin shell

**Files:**
- Create: `.claude-plugin/plugin.json`, `commands/*.md`, `skills/codeflow/SKILL.md`, `hooks/hooks.json`, `hooks/session-start.mjs`, `README.md`
- Test: `test/plugin.test.mjs`

**Interfaces:**
- Every command calls `codeflow <verb> --json` and renders the result.
- The skill states: hydrate then act, no merge, no fabricated evidence, no skipped gates, no gate weakening, escalate on block.
- The hook runs `codeflow status --brief` and never fails a session.

- [ ] **Step 1: Write failing plugin tests** (manifest validates; every command file has `description` and `allowed-tools: Bash(codeflow:*)`; the skill contains the red lines).
- [ ] **Step 2: Run and verify failure.**
- [ ] **Step 3: Implement the manifest, commands, skill, and hook.**
- [ ] **Step 4: Run `claude plugin validate .`** (if available) and `npm test`.
- [ ] **Step 5: Commit:** `feat(plugin): add the Claude Code manifest, commands, skill, and hook`

---

### Task 7: M7 — end-to-end, safety, and plugin validation

**Files:**
- Create: `test/e2e.test.mjs`, `test/safety.test.mjs`, `scripts/check-syntax.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the golden-path test:** temp repo → `init` → `trust` → `new` → `approve design` → `plan` → `approve plan` → `start` → `verify` with fake gates → `self-review` → `pr` with fake `gh` → assert body and PR record.
- [ ] **Step 2: Write the safety suite:** dirty tree, stale approval, untrusted config, lock contention, rebase conflict, timeout, schema mismatch, path traversal.
- [ ] **Step 3: Implement the syntax check script and run every test.**
- [ ] **Step 4: Run `npm test` and `claude plugin validate .`.**
- [ ] **Step 5: Commit:** `test: prove the L1 flow in a temporary repository`

---

## Verification

- `npm test` passes.
- `claude plugin validate .` passes (or reports the exact missing CLI).
- The golden path produces `.codeflow/state/tasks/<id>/PR_BODY.md` and a fake PR record.
- No test touches the network or a real GitHub.
- No command merges; `grep -R "pr merge" src commands` returns nothing.
