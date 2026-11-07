import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
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
import { cleanup, fakeGhEnv, tempRepo } from "./helpers.mjs";

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

test("normalizeChecks reports no checks and unknown conclusions honestly", () => {
  assert.equal(normalizeChecks([]).state, "none");
  assert.equal(
    normalizeChecks([{ status: "COMPLETED", conclusion: null }]).state,
    "pending",
  );
  assert.equal(
    normalizeChecks([{ conclusion: "SKIPPED" }]).state,
    "skipped",
  );
});

test("findOpenPr, createOrUpdatePr, checks, and comments use gh", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const env = fakeGhEnv(t, {
    rollup: ["SUCCESS", "PENDING"],
    graphql: false,
  });

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
  assert.equal(comments.resolutionAvailable, false);
  assert.equal(comments.resolved, null);
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
  delete env.CODEFLOW_GH_BIN;
  delete env.CODEFLOW_GH_SCRIPT;

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
