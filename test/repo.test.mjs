import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureExcluded, findRepo } from "../src/repo.mjs";
import { cleanup, git, tempRepo } from "./helpers.mjs";

test("findRepo resolves the root, base branch, remote, and exclude path", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  const repo = findRepo(dir);
  assert.equal(repo.root, dir);
  assert.equal(repo.baseBranch, "main");
  assert.equal(repo.remote, "origin");
  assert.ok(repo.excludePath.endsWith("info/exclude"));
  assert.ok(repo.excludePath.includes(".git"));
});

test("findRepo distinguishes the project root from a linked worktree", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const parent = mkdtempSync(join(tmpdir(), "codeflow-linked-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const worktree = join(parent, "wt");
  git(dir, ["worktree", "add", "-b", "side", worktree]);

  const repo = findRepo(worktree);
  assert.equal(repo.root, worktree);
  assert.equal(repo.mainRoot, dir);
  assert.ok(repo.excludePath.endsWith("info/exclude"));

  assert.equal(findRepo(dir).mainRoot, dir);
});

test("findRepo rejects a directory that is not a git repository", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeflow-norepo-"));
  t.after(() => cleanup(dir));

  assert.throws(
    () => findRepo(dir),
    (error) => error.code === "E_NOT_REPO",
  );
});

test("ensureExcluded appends once and is idempotent", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const repo = findRepo(dir);

  assert.equal(ensureExcluded(repo), true);
  assert.equal(ensureExcluded(repo), false);
  assert.equal(ensureExcluded(repo), false);
});
