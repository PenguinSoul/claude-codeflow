import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { cleanup, fakeGhEnv, git, tempRepo } from "./helpers.mjs";

const cli = fileURLToPath(new URL("../bin/codeflow", import.meta.url));

function runCli(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return {
    code: result.status,
    out: result.stdout,
    err: result.stderr,
    json,
  };
}

const SPEC = [
  "# Fix login",
  "",
  "## Request",
  "Stop the redirect loop.",
  "",
  "## Product",
  "A user lands on the dashboard after login.",
  "",
  "## Design",
  "Guard the redirect when the token is present.",
  "",
  "## Durable updates",
  "Not durable — test fixture.",
  "",
].join("\n");

test("the built binary runs the full human-gated flow in a temporary repository", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const worktreeRoot = mkdtempSync(join(tmpdir(), "codeflow-e2e-wt-"));
  t.after(() => rmSync(worktreeRoot, { recursive: true, force: true }));
  const bare = mkdtempSync(join(tmpdir(), "codeflow-e2e-origin-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  execFileSync("git", ["init", "--bare", "-b", "main", bare], {
    stdio: "ignore",
  });
  execFileSync("git", ["remote", "set-url", "origin", bare], { cwd: dir });
  const env = fakeGhEnv(t);

  const init = runCli(["init", "--json"], dir);
  assert.equal(init.code, 0);

  const configFile = join(dir, ".codeflow/config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.worktreeRoot = worktreeRoot;
  config.gates = [
    {
      name: "test",
      command: 'node -e "process.exit(0)"',
      cwd: ".",
      tier: "fast",
      kinds: ["code"],
      required: true,
      timeoutSec: 30,
    },
  ];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  git(dir, ["add", ".codeflow/config.json"]);
  git(dir, ["commit", "-m", "test: commit codeflow config"]);
  git(dir, ["push", "-u", "origin", "main"]);

  assert.equal(runCli(["trust", "--yes", "--json"], dir).code, 0);

  const created = runCli(["new", "Fix login", "--json"], dir);
  assert.equal(created.code, 0);
  const taskId = created.json.data.taskId;
  writeFileSync(join(dir, created.json.data.taskSpecPath), SPEC);
  assert.equal(runCli(["approve", "design", "--json"], dir).code, 0);

  assert.equal(runCli(["plan", "--init", "--json"], dir).code, 0);
  writeFileSync(
    join(dir, ".codeflow/state/tasks", taskId, "plan.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        taskId,
        steps: [
          {
            id: "1",
            title: "Add the guard",
            status: "pending",
            commitSubject: "fix(auth): add the guard",
            verification: "`npm test` → pass",
            summary: "",
            note: "",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  assert.equal(runCli(["approve", "plan", "--json"], dir).code, 0);

  const started = runCli(["start", "--json"], dir);
  assert.equal(started.code, 0);
  assert.ok(existsSync(started.json.data.worktree));

  const step = runCli(
    [
      "plan",
      "step",
      "1",
      "--status",
      "done",
      "--summary",
      "Implemented and checked.",
      "--result",
      "`npm test` → pass",
      "--json",
    ],
    dir,
  );
  assert.equal(step.code, 0, step.err || step.out);

  const verified = runCli(["verify", "--json"], dir);
  assert.equal(verified.code, 0);
  assert.equal(verified.json.data.result, "pass");

  assert.equal(runCli(["self-review", "--json"], dir).code, 0);
  assert.equal(
    runCli(["approve", "self-review", "--json"], dir).code,
    0,
  );

  const pr = runCli(["pr", "--json"], dir, env);
  assert.equal(pr.code, 0);
  assert.equal(pr.json.data.number, 7);

  const watch = runCli(["watch", "--json"], dir, env);
  assert.equal(watch.code, 0);
  assert.equal(watch.json.data.state, "pending");

  const comments = runCli(["comments", "--json"], dir, env);
  assert.equal(comments.code, 0);
  assert.equal(comments.json.data.threads, 0);

  const mergedEnv = fakeGhEnv(t, { prState: "MERGED", checks: ["SUCCESS"] });
  const finished = runCli(["finish", "--json"], dir, mergedEnv);
  assert.equal(finished.code, 0);
  assert.equal(finished.json.data.mergeConfirmedBy, "gh");
  assert.equal(existsSync(started.json.data.worktree), false);

  const status = runCli(["status", "--json"], dir);
  assert.equal(status.code, 0);
  assert.equal(status.json.data.task, null);
  assert.deepEqual(status.json.data.next, ["new"]);

  const archived = runCli(["status", "--task", taskId, "--json"], dir);
  assert.equal(archived.code, 0);
  assert.equal(archived.json.data.task.status, "done");
});
