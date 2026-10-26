import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureExcluded, findRepo } from "../src/repo.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

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
