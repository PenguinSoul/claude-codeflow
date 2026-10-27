# Trust and Plan Correctness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tree, config, trust, evidence, and pull request refer to the same object; make plan progress usable without invalidating its approval; remove internal workflow jargon from user-facing docs.

**Architecture:** A repository has one project root (the primary worktree) that owns local state and trust, and one task tree (a linked worktree) that owns the config, diff, gates, and evidence under test. Trust is recorded per approved config hash. Plan approval hashes only immutable step fields; progress is mutable and updated through the CLI. Delivery fails closed when the task tree is missing, on another branch, or when the remote head does not match the verified commit.

**Tech Stack:** Node >= 20, ESM, `node:test`, git, `gh` (optional), Claude Code plugin.

**Spec:** `docs/goal-and-requirements.md`, `docs/architecture.md`, `docs/contracts.md`, `docs/DESIGN.md`

## Global Constraints

- Zero runtime dependencies. No build step. Node >= 20.
- Every command supports `--json` and the envelope in `docs/contracts.md`.
- Never merge, never approve a pull request, never fabricate evidence.
- No gate runs without an approval for the exact config hash being verified.
- Evidence freshness is tree-based; the verified tree, config, gate set, and branch must match the delivered tree.
- No command may fall back to the primary checkout when the task tree is required.
- User-facing docs use "human-gated workflow", "delivery flow", "review-response automation", and "autonomous merge"; they do not use the internal level labels.
- Tests use temporary repositories, fake gates, and fake `gh`. No network and no real GitHub.
- One commit per task. Conventional Commits.

## File Structure

```text
src/repo.mjs          project root, task tree, base branch, exclude path
src/state.mjs         project-root state, task IDs, locks, active pointer
src/config.mjs        config validation, detection, hashing
src/trust.mjs         per-config trust approvals
src/git.mjs           worktree creation, branch/head checks, rebase
src/task.mjs          task-spec, approvals, durable record
src/plan.mjs          immutable plan, mutable progress, rendering
src/gates.mjs         gate selection, kind-aware runs
src/attention.mjs     diff scan, kind inference
src/evidence.mjs      tree/config/branch-bound evidence
src/selfreview.mjs    review packet and approval hash
src/prbody.mjs        template rendering with evidence
src/github.mjs        gh auth, PR state, checks, comments
src/cli.mjs           orchestration
test/repo.test.mjs    project root and worktree resolution
test/trust.test.mjs   per-config approvals and provenance
test/worktree.test.mjs task-tree binding and delivery guards
test/plan.test.mjs    immutable plan hash and progress
test/attention.test.mjs kind inference
test/selfreview.test.mjs approval tamper detection
test/github.test.mjs  no-CI and unknown-check states
test/e2e.test.mjs     binary delivery flow with a local remote
```

---

### Task 1: Resolve the project root and the task tree

**Files:**
- Modify: `src/repo.mjs`, `src/state.mjs`, `src/cli.mjs`
- Test: `test/repo.test.mjs`, `test/cli.test.mjs`

**Interfaces:**
- `findRepo(cwd) -> { root, mainRoot, gitDir, commonDir, excludePath, baseBranch, remote }`
- `statePaths(projectRoot, config) -> { stateDir, tasksDir, activePath, trustPath }`
- `taskWorktree(repo, task, { required }) -> string`

- [ ] **Step 1: Write a failing linked-worktree test**

Create a repository with a committed `.codeflow/config.json`, run `init`, `new`, `plan`, `start`, then run `status` and `verify` from the created worktree. Assert that `status` sees the task and `verify` reaches the gates. Assert `findRepo(worktree).mainRoot` equals the primary checkout and `findRepo(worktree).root` equals the worktree.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/repo.test.mjs test/cli.test.mjs`
Expected: FAIL because state is resolved from the linked worktree.

- [ ] **Step 3: Implement the root model**

Add `mainRoot` from `git worktree list --porcelain` (first entry), with a fallback to the parent of `git-common-dir`. Keep `root` as the current worktree. Resolve all state paths from `repo.mainRoot`. Make `status` report the task from the project root. Make `taskWorktree` throw `E_WORKTREE_MISSING` when `required` and the worktree is absent.

- [ ] **Step 4: Run the tests**

Run: `node --test test/repo.test.mjs test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repo.mjs src/state.mjs src/cli.mjs test/repo.test.mjs test/cli.test.mjs
git commit -m "fix(state): resolve state from the project root"
```

---

### Task 2: Reject tracked state and trust

**Files:**
- Modify: `src/contracts.mjs`, `src/repo.mjs`, `src/cli.mjs`
- Test: `test/trust.test.mjs`, `test/repo.test.mjs`

**Interfaces:**
- `assertStateNotTracked(repo) -> void`
- New error code: `E_STATE_TRACKED` (exit 6).

- [ ] **Step 1: Write a failing provenance test**

Commit `.codeflow/state/trust.json` with a valid-looking hash. Run `verify` and assert `E_STATE_TRACKED`. Run the same check for a tracked `evidence.json`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/trust.test.mjs`
Expected: FAIL because the forged trust file is accepted.

- [ ] **Step 3: Implement the check**

Run `git ls-files -- .codeflow/state` from the project root. If any path is printed, throw `E_STATE_TRACKED` with a hint to remove the tracked files and run `codeflow init`. Call it for every command after repository discovery.

- [ ] **Step 4: Run the tests**

Run: `node --test test/trust.test.mjs test/repo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contracts.mjs src/repo.mjs src/cli.mjs test/trust.test.mjs test/repo.test.mjs
git commit -m "fix(trust): reject repository-supplied state"
```

---

### Task 3: Bind evidence and delivery to the task tree

**Files:**
- Modify: `src/git.mjs`, `src/cli.mjs`, `src/prbody.mjs`
- Test: `test/worktree.test.mjs`, `test/lifecycle.test.mjs`, `test/e2e.test.mjs`

**Interfaces:**
- `assertTaskWorktree(repo, task) -> string`
- `assertWorktreeBranch(worktree, branch) -> void`
- `pr --no-push` renders only and never creates a PR or marks the task delivered.

- [ ] **Step 1: Write failing guards**

- Delete the task worktree, run `verify`, assert `E_WORKTREE_MISSING`.
- Check out another branch in the task worktree, run `pr`, assert `E_WORKTREE_MISMATCH`.
- Run `pr --no-push` and assert `PR_BODY.md` exists but `pr.json` does not and the task stays `verified`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test test/worktree.test.mjs test/lifecycle.test.mjs`
Expected: FAIL because the base checkout is used and `--no-push` creates a PR.

- [ ] **Step 3: Implement the guards**

Require the worktree for `verify`, `self-review`, `approve self-review`, `pr`, `watch`, and `comments`. Assert the worktree branch equals `task.branch`. Before marking `pr_open`, compare the PR head returned by `gh` with the local HEAD; a mismatch is `E_PUSH_FAILED`. Make `--no-push` return after writing `PR_BODY.md`.

- [ ] **Step 4: Update the fake `gh` and tests**

The fake `gh` reports the current worktree HEAD. The delivery tests use a local bare remote instead of `--no-push`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/worktree.test.mjs test/lifecycle.test.mjs test/e2e.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/git.mjs src/cli.mjs src/prbody.mjs test/worktree.test.mjs test/lifecycle.test.mjs test/e2e.test.mjs test/helpers.mjs
git commit -m "fix(pr): bind delivery to the task worktree"
```

---

### Task 4: Load config and trust from the tree under test

**Files:**
- Modify: `src/trust.mjs`, `src/config.mjs`, `src/cli.mjs`
- Test: `test/trust.test.mjs`, `test/lifecycle.test.mjs`

**Interfaces:**
- `trustConfig(paths, config, approvedBy) -> Trust`
- `assertTrusted(paths, config) -> Trust`
- Trust records multiple approvals keyed by `configHash`.

- [ ] **Step 1: Write a failing config-change test**

Commit a task-branch config whose gate exits 1 while the project config gate exits 0. Run `verify` from the project root. Assert `E_TRUST_STALE` and that the failing gate command is the one selected. Approve the task config, run verify again, and assert the task gate runs.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/lifecycle.test.mjs test/trust.test.mjs`
Expected: FAIL because the project config is used.

- [ ] **Step 3: Implement the split**

Load the project config for state and task metadata. For `verify`, `pr`, `self-review`, `status`, `watch`, and `comments`, load the config from the task worktree and check trust for that exact hash. `trust` approves the config from the current checkout. Store multiple approvals in `trust.json` (legacy top-level fields remain readable).

- [ ] **Step 4: Run the tests**

Run: `node --test test/trust.test.mjs test/lifecycle.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trust.mjs src/config.mjs src/cli.mjs test/trust.test.mjs test/lifecycle.test.mjs
git commit -m "fix(trust): verify the task config under test"
```

---

### Task 5: Enforce the self-review approval and tell the truth about CI

**Files:**
- Modify: `src/selfreview.mjs`, `src/github.mjs`, `src/cli.mjs`, `src/render.mjs`
- Test: `test/selfreview.test.mjs`, `test/github.test.mjs`, `test/lifecycle.test.mjs`

**Interfaces:**
- `reviewHash(review) -> Hash`
- `normalizeChecks(rollup) -> { state: "none" | "pending" | "success" | "failure" }`
- `watch` returns `mergeStateStatus` and `reviewDecision`.

- [ ] **Step 1: Write failing tests**

- Edit `review.json` after approval and assert `pr` refuses `E_APPROVAL_STALE`.
- `normalizeChecks([])` returns `state: "none"`.
- A check with `conclusion: null, status: "COMPLETED"` is `pending`, not `passed`.
- `watch` returns the PR merge state and review decision.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test test/selfreview.test.mjs test/github.test.mjs test/lifecycle.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Compare `task.approvals.selfReview.hash` with `reviewHash(review)`. Return `none` for zero checks. Treat unknown conclusions as pending. Add merge state and review decision to the watch result and `pr.json`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/selfreview.test.mjs test/github.test.mjs test/lifecycle.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/selfreview.mjs src/github.mjs src/cli.mjs src/render.mjs test/selfreview.test.mjs test/github.test.mjs test/lifecycle.test.mjs
git commit -m "fix(review): enforce approval hashes and honest check states"
```

---

### Task 6: Contain the PR template and validate task IDs

**Files:**
- Modify: `src/config.mjs`, `src/state.mjs`, `src/cli.mjs`
- Test: `test/config.test.mjs`, `test/state.test.mjs`, `test/worktree.test.mjs`

- [ ] **Step 1: Write failing tests**

- A `pr.template` of `../secret.md` or an absolute path is rejected.
- `--task ../escape` returns `E_USAGE` without touching the filesystem.

- [ ] **Step 2: Implement**

Reject absolute and parent-relative template paths; resolve and check containment. Validate task IDs against the documented pattern before any path join.

- [ ] **Step 3: Run the tests and commit**

```bash
git add src/config.mjs src/state.mjs src/cli.mjs test/config.test.mjs test/state.test.mjs test/worktree.test.mjs
git commit -m "fix(state): contain template paths and task ids"
```

---

### Task 7: Make plan progress mutable without invalidating approval

**Files:**
- Modify: `src/plan.mjs`, `src/task.mjs`, `src/cli.mjs`, `src/selfreview.mjs`, `src/prbody.mjs`
- Test: `test/plan.test.mjs`, `test/task.test.mjs`, `test/lifecycle.test.mjs`

**Interfaces:**
- `planApprovalHash(plan) -> Hash` over `schemaVersion`, `taskId`, and each step's `id`, `title`, `commitSubject`, `verification`.
- `codeflow plan step <id> --status <status> --summary <text> --verification <text>`
- `pr` refuses while any step is not `done`.

- [ ] **Step 1: Write failing tests**

- Approving a plan, marking a step done, and approving again keeps the task `verified`/`active` and the approval fresh.
- Changing a step title invalidates the plan approval.
- `pr` refuses with `E_STATE_CONFLICT` while a step is pending.
- `plan step` writes `PLAN.md` and an event.

- [ ] **Step 2: Implement**

Move the plan hash to the immutable fields. Add the `plan step` command for `active`/`verified` tasks. Require plan approval for step updates. Check all steps at `pr`. Keep the existing fields for compatibility.

- [ ] **Step 3: Update tests and docs, run the suite, commit**

```bash
git add src/plan.mjs src/task.mjs src/cli.mjs src/selfreview.mjs src/prbody.mjs test/plan.test.mjs test/task.test.mjs test/lifecycle.test.mjs docs/architecture.md docs/contracts.md
git commit -m "feat(plan): track progress without freezing the plan"
```

---

### Task 8: Infer the change kind and support docs/mixed tasks

**Files:**
- Modify: `src/attention.mjs`, `src/config.mjs`, `src/gates.mjs`, `src/cli.mjs`, `src/task.mjs`
- Test: `test/attention.test.mjs`, `test/gates.test.mjs`, `test/lifecycle.test.mjs`

**Interfaces:**
- `inferKind(changedFiles) -> "code" | "docs" | "test" | "infra" | "mixed"`
- `verify` warns when the inferred kind differs and uses the broader gate set.
- A docs task with no docs gate records zero gates and a warning, not a hard failure.

- [ ] **Step 1: Write failing tests**

- A docs-only diff infers `docs`.
- A diff touching docs and code infers `mixed`.
- A `docs` task with no docs gate verifies with zero gates and `W_NO_GATES`.
- A `mixed` task runs all gates.

- [ ] **Step 2: Implement**

Add `mixed` to config kinds. Infer from changed paths. Select the union for mixed. Allow zero-gate docs verification with a warning. Record the inferred and effective kinds in evidence.

- [ ] **Step 3: Run the tests and commit**

```bash
git add src/attention.mjs src/config.mjs src/gates.mjs src/cli.mjs src/task.mjs test/attention.test.mjs test/gates.test.mjs test/lifecycle.test.mjs
git commit -m "feat(verify): infer change kinds and support docs/mixed"
```

---

### Task 9: Require a durable-knowledge record

**Files:**
- Modify: `templates/TASK.md`, `src/task.mjs`, `src/prbody.mjs`, `src/cli.mjs`
- Test: `test/task.test.mjs`, `test/prbody.test.mjs`, `test/lifecycle.test.mjs`

- [ ] **Step 1: Write failing tests**

- Approving a design without a `Durable updates` section is refused.
- A record of "updated docs/architecture.md" reaches the PR body.
- "Not durable — internal refactor" is accepted.

- [ ] **Step 2: Implement**

Add the section to the template and the design check. Carry it into the PR body and require it at `pr`.

- [ ] **Step 3: Run the tests and commit**

```bash
git add templates/TASK.md src/task.mjs src/prbody.mjs src/cli.mjs test/task.test.mjs test/prbody.test.mjs test/lifecycle.test.mjs
git commit -m "feat(task): require a durable-knowledge record"
```

---

### Task 10: Remove internal workflow jargon

**Files:**
- Modify: `README.md`, `README.zh-CN.md`, `docs/*.md`, `skills/codeflow/SKILL.md`, `commands/*.md`, `package.json`, `.claude-plugin/*.json`
- Test: `test/plugin.test.mjs` (add a grep assertion)

- [ ] **Step 1: Add a failing jargon test**

Assert that user-facing docs and the plugin manifest contain no `L1`, `L2`, or `L3` level labels.

- [ ] **Step 2: Replace the terms**

Use "human-gated workflow", "delivery flow", "review-response automation", and "autonomous merge" in English; "人审交付流程", "交付流程", "评审响应自动化", "自主合并" in Chinese.

- [ ] **Step 3: Run the tests and commit**

```bash
git add README.md README.zh-CN.md docs skills commands package.json .claude-plugin test/plugin.test.mjs
git commit -m "docs: replace internal workflow labels"
```

---

## Verification

- `npm test` passes.
- `npm run check` passes.
- `claude plugin validate .` passes.
- The linked-worktree flow works from the worktree.
- A tracked trust file is refused.
- A missing/wrong worktree is refused.
- A config change on the task branch requires a new trust approval.
- A tampered self-review is refused.
- Zero checks report `none`, not `success`.
- Plan progress updates do not invalidate the approved plan.
- No user-facing doc contains `L1`, `L2`, or `L3`.
