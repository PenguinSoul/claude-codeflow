import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.mjs";
import { capture, cleanup, fakeGhEnv, tempRepo } from "./helpers.mjs";

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
].join("\n");

async function invoke(args, cwd, env) {
  const out = capture();
  const err = capture();
  const code = await run(args, {
    cwd,
    env,
    stdout: out.stream,
    stderr: err.stream,
  });
  let json = null;
  try {
    json = JSON.parse(out.text());
  } catch {
    json = null;
  }
  return { code, out: out.text(), err: err.text(), json };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repoWithRemote(t) {
  const bare = mkdtempSync(join(tmpdir(), "codeflow-origin-"));
  execFileSync("git", ["init", "--bare", "-b", "main", bare], {
    stdio: "ignore",
  });
  const dir = tempRepo({ remotes: { origin: bare } });
  git(dir, ["push", "-u", "origin", "main"]);
  t.after(() => {
    cleanup(dir);
    rmSync(bare, { recursive: true, force: true });
  });
  return { dir, bare };
}

async function setupPlanned(dir, t) {
  const worktreeRoot = mkdtempSync(join(tmpdir(), "codeflow-lifecycle-wt-"));
  t.after(() => rmSync(worktreeRoot, { recursive: true, force: true }));

  assert.equal((await invoke(["init", "--json"], dir)).code, 0);
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
  assert.equal((await invoke(["trust", "--yes", "--json"], dir)).code, 0);

  const created = await invoke(["new", "Fix login", "--json"], dir);
  assert.equal(created.code, 0);
  const taskId = created.json.data.taskId;
  writeFileSync(join(dir, created.json.data.taskSpecPath), SPEC);
  assert.equal((await invoke(["approve", "design", "--json"], dir)).code, 0);

  assert.equal((await invoke(["plan", "--init", "--json"], dir)).code, 0);
  writeFileSync(
    join(dir, ".codeflow/state/tasks", taskId, "plan.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        taskId,
        steps: [
          {
            id: "1",
            title: "Do the work",
            status: "pending",
            commitSubject: "feat: do the work",
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
  assert.equal((await invoke(["approve", "plan", "--json"], dir)).code, 0);
  assert.equal((await invoke(["start", "--json"], dir)).code, 0);

  const taskFile = join(dir, ".codeflow/state/tasks", taskId, "task.json");
  const task = JSON.parse(readFileSync(taskFile, "utf8"));
  return { taskId, task, taskFile, worktree: task.worktree };
}

async function verifyAndReview(dir) {
  const verified = await invoke(["verify", "--json"], dir);
  assert.equal(verified.code, 0, verified.err || verified.out);
  assert.equal((await invoke(["self-review", "--json"], dir)).code, 0);
  assert.equal((await invoke(["approve", "self-review", "--json"], dir)).code, 0);
}

async function deliver(dir, t, options) {
  const planned = await setupPlanned(dir, t);
  await verifyAndReview(dir);
  const env = fakeGhEnv(t, options);
  const pr = await invoke(["pr", "--json"], dir, env);
  assert.equal(pr.code, 0, pr.err || pr.out);
  return { ...planned, env, pr };
}

test("pr blocks with E_REBASE_CONFLICT when the base conflicts", async (t) => {
  const { dir } = repoWithRemote(t);
  const planned = await setupPlanned(dir, t);

  writeFileSync(join(planned.worktree, "shared.txt"), "task\n");
  git(planned.worktree, ["add", "-A"]);
  git(planned.worktree, ["commit", "-m", "task change"]);
  await verifyAndReview(dir);

  writeFileSync(join(dir, "shared.txt"), "main\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "base change"]);
  git(dir, ["push", "origin", "main"]);

  const pr = await invoke(["pr", "--json"], dir);
  assert.equal(pr.code, 4);
  assert.equal(pr.json.error.code, "E_REBASE_CONFLICT");
  assert.deepEqual(pr.json.error.details.conflicts, ["shared.txt"]);
  assert.equal(pr.json.error.details.taskStatus, "blocked");

  const task = JSON.parse(readFileSync(planned.taskFile, "utf8"));
  assert.equal(task.status, "blocked");
  assert.equal(task.blocked.code, "E_REBASE_CONFLICT");
  assert.equal(task.blocked.from, "verified");
  assert.equal(git(planned.worktree, ["status", "--porcelain"]), "");

  const resumed = await invoke(["resume", "--json"], dir);
  assert.equal(resumed.code, 0);
  assert.equal(resumed.json.data.status, "verified");
});

test("pr rebases cleanly and refuses stale evidence until re-verified", async (t) => {
  const { dir, bare } = repoWithRemote(t);
  const planned = await setupPlanned(dir, t);

  writeFileSync(join(planned.worktree, "task.txt"), "task\n");
  git(planned.worktree, ["add", "-A"]);
  git(planned.worktree, ["commit", "-m", "task change"]);
  await verifyAndReview(dir);

  writeFileSync(join(dir, "base.txt"), "base\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "base change"]);
  git(dir, ["push", "origin", "main"]);

  const first = await invoke(["pr", "--json"], dir);
  assert.equal(first.code, 3);
  assert.equal(first.json.error.code, "E_APPROVAL_STALE");
  assert.equal(first.json.error.details.rebased, true);
  assert.equal(readFileSync(join(planned.worktree, "base.txt"), "utf8"), "base\n");

  const taskAfter = JSON.parse(readFileSync(planned.taskFile, "utf8"));
  assert.equal(taskAfter.status, "verified");

  await verifyAndReview(dir);
  const env = fakeGhEnv(t, { checks: ["SUCCESS"] });
  const second = await invoke(["pr", "--json"], dir, env);
  assert.equal(second.code, 0, second.err || second.out);
  assert.equal(second.json.data.rebased, false);
  assert.equal(second.json.data.number, 7);

  const localHead = git(planned.worktree, ["rev-parse", "HEAD"]);
  const remoteHead = execFileSync(
    "git",
    ["--git-dir", bare, "rev-parse", planned.task.branch],
    { encoding: "utf8" },
  ).trim();
  assert.equal(remoteHead, localHead);
});

test("finish trusts gh over --confirm and --force", async (t) => {
  const { dir } = repoWithRemote(t);
  const delivered = await deliver(dir, t, {
    prState: "OPEN",
    checks: ["SUCCESS"],
  });

  const openEnv = fakeGhEnv(t, { prState: "OPEN", checks: ["SUCCESS"] });
  const forced = await invoke(["finish", "--force", "--json"], dir, openEnv);
  assert.equal(forced.code, 3);
  assert.equal(forced.json.error.code, "E_STATE_CONFLICT");
  assert.equal(forced.json.error.details.prState, "OPEN");
  assert.equal(existsSync(delivered.worktree), true);

  const confirmed = await invoke(
    ["finish", "--confirm", "--json"],
    dir,
    openEnv,
  );
  assert.equal(confirmed.code, 3);
  assert.equal(confirmed.json.error.code, "E_STATE_CONFLICT");

  const mergedEnv = fakeGhEnv(t, { prState: "MERGED", checks: ["SUCCESS"] });
  const finished = await invoke(["finish", "--json"], dir, mergedEnv);
  assert.equal(finished.code, 0, finished.err || finished.out);
  assert.equal(finished.json.data.mergeConfirmedBy, "gh");
  assert.equal(existsSync(delivered.worktree), false);
});

test("watch --wait polls until checks settle", async (t) => {
  const { dir } = repoWithRemote(t);
  const delivered = await deliver(dir, t, {
    prState: "OPEN",
    checks: ["PENDING"],
  });

  const env = fakeGhEnv(t, {
    prState: "OPEN",
    checks: ["PENDING", "SUCCESS"],
  });
  const watch = await invoke(
    ["watch", "--wait", "--timeout", "2", "--interval", "10", "--json"],
    dir,
    env,
  );
  assert.equal(watch.code, 0, watch.err || watch.out);
  assert.equal(watch.json.data.state, "success");
  assert.equal(watch.json.data.timedOut, false);
  assert.equal(watch.json.data.waited, true);
  assert.ok(watch.json.data.polls >= 1);
  assert.ok(delivered.worktree);
});

test("watch --wait reports a timeout without failing", async (t) => {
  const { dir } = repoWithRemote(t);
  await deliver(dir, t, { prState: "OPEN", checks: ["PENDING"] });

  const env = fakeGhEnv(t, { prState: "OPEN", checks: ["PENDING"] });
  const watch = await invoke(
    ["watch", "--wait", "--timeout", "0.1", "--interval", "20", "--json"],
    dir,
    env,
  );
  assert.equal(watch.code, 0, watch.err || watch.out);
  assert.equal(watch.json.data.state, "pending");
  assert.equal(watch.json.data.timedOut, true);
  assert.ok(
    watch.json.warnings.some((warning) => warning.code === "W_CHECKS_PENDING"),
  );
});
