import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareUrl,
  createOrUpdatePr,
  findOpenPr,
  hasGh,
  normalizeChecks,
  readChecks,
  readComments,
} from "../src/github.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

function fakeGh(t) {
  const dir = mkdtempSync(join(tmpdir(), "codeflow-gh-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash
set -e
if [ "$1" = "--version" ]; then echo "gh version 2.103.2"; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '[]'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/7"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"number":7,"url":"https://github.com/o/r/pull/7","state":"OPEN","headRefOid":"abc","statusCheckRollup":[{"conclusion":"SUCCESS"},{"status":"IN_PROGRESS","conclusion":null}],"mergeStateStatus":"BLOCKED","reviewDecision":""}'
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo "o/r"; exit 0; fi
if [ "$1" = "api" ]; then echo '[]'; exit 0; fi
echo "unexpected: $*" >&2
exit 1
`,
  );
  chmodSync(script, 0o755);
  return { ...process.env, PATH: `${dir}:${process.env.PATH}` };
}

test("normalizeChecks counts success, failure, pending, and skipped", () => {
  const checks = normalizeChecks([
    { conclusion: "SUCCESS" },
    { conclusion: "FAILURE" },
    { status: "IN_PROGRESS", conclusion: null },
    { conclusion: "SKIPPED" },
  ]);
  assert.deepEqual(checks, {
    total: 4,
    passed: 1,
    failed: 1,
    pending: 1,
    skipped: 1,
    state: "failure",
  });
});

test("findOpenPr, createOrUpdatePr, checks, and comments use gh", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const env = fakeGh(t);

  assert.equal(await hasGh(env), true);
  assert.equal(findOpenPr(dir, "codeflow/x", env), null);

  const bodyPath = join(dir, "body.md");
  writeFileSync(bodyPath, "body\n");
  const created = createOrUpdatePr({
    cwd: dir,
    base: "main",
    branch: "codeflow/x",
    title: "Fix login",
    bodyPath,
    env,
  });
  assert.equal(created.number, 7);
  assert.equal(created.checks.state, "pending");
  assert.equal(created.updated, false);

  const checks = readChecks(dir, 7, env);
  assert.equal(checks.total, 2);
  assert.equal(checks.state, "pending");

  const comments = readComments(dir, 7, env);
  assert.equal(comments.repo, "o/r");
  assert.deepEqual(comments.comments, []);
  assert.deepEqual(comments.reviews, []);
});

test("compareUrl handles GitHub SSH and HTTPS remotes", () => {
  assert.equal(
    compareUrl("git@github.com:org/repo.git", "main", "codeflow/x"),
    "https://github.com/org/repo/compare/main...codeflow%2Fx?expand=1",
  );
  assert.equal(
    compareUrl("https://github.com/org/repo.git", "main", "codeflow/x"),
    "https://github.com/org/repo/compare/main...codeflow%2Fx?expand=1",
  );
  assert.equal(compareUrl("git@gitlab.com:org/repo.git", "main", "x"), null);
});

test("missing gh is reported as E_GH_MISSING", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const env = { ...process.env, PATH: "" };

  assert.equal(await hasGh(env), false);
  assert.throws(
    () =>
      createOrUpdatePr({
        cwd: dir,
        base: "main",
        branch: "x",
        title: "x",
        bodyPath: join(dir, "body.md"),
        env,
      }),
    (error) => error.code === "E_GH_MISSING",
  );
});
