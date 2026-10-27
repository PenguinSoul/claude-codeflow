import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.mjs";
import { capture, cleanup, fakeGhEnv, tempDir, tempRepo } from "./helpers.mjs";

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

test("version and help work outside a repository", async () => {
  const dir = tempDir();
  try {
    const version = await invoke(["--version"], dir);
    assert.equal(version.code, 0);
    assert.match(version.out, /^codeflow 0\.1\.0/);

    const help = await invoke(["--help"], dir);
    assert.equal(help.code, 0);
    assert.match(help.out, /Usage:/);
  } finally {
    cleanup(dir);
  }
});

test("unknown command returns E_USAGE as JSON", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  const result = await invoke(["nope", "--json"], dir);
  assert.equal(result.code, 2);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.error.code, "E_USAGE");
});

test("status outside a repository returns E_NOT_REPO", async () => {
  const dir = tempDir();
  try {
    const result = await invoke(["status", "--json"], dir);
    assert.equal(result.code, 2);
    assert.equal(result.json.error.code, "E_NOT_REPO");
  } finally {
    cleanup(dir);
  }
});

test("status without config returns E_CONFIG", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  const result = await invoke(["status", "--json"], dir);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, "E_CONFIG");
});

test("status rejects a task id that escapes the state directory", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  await invoke(["init", "--json"], dir);

  const result = await invoke(["status", "--task", "../escape", "--json"], dir);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, "E_USAGE");
});

test("doctor without config still reports checks", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  const result = await invoke(["doctor", "--json"], dir);
  assert.equal(result.code, 0);
  assert.equal(result.json.ok, true);
  const config = result.json.data.checks.find((check) => check.name === "config");
  assert.equal(config.ok, false);
});

test("init, status, and doctor form a working slice", async (t) => {
  const dir = tempRepo({
    packageJson: {
      scripts: {
        lint: "eslint .",
        test: "node --test",
      },
    },
    lockfile: "package-lock.json",
  });
  t.after(() => cleanup(dir));

  const init = await invoke(["init", "--json"], dir);
  assert.equal(init.code, 0);
  assert.equal(init.json.ok, true);
  assert.equal(init.json.data.baseBranch, "main");
  assert.equal(init.json.data.remote, "origin");
  assert.ok(existsSync(join(dir, ".codeflow/config.json")));
  assert.ok(
    readFileSync(join(dir, ".git/info/exclude"), "utf8").includes(
      ".codeflow/state/",
    ),
  );
  const config = JSON.parse(
    readFileSync(join(dir, ".codeflow/config.json"), "utf8"),
  );
  assert.deepEqual(
    config.gates.map((gate) => gate.name).sort(),
    ["lint", "test"],
  );

  const status = await invoke(["status", "--json"], dir);
  assert.equal(status.code, 0);
  assert.equal(status.json.data.task, null);
  assert.deepEqual(status.json.data.next, ["new"]);
  assert.equal(status.json.data.trust.trusted, false);

  const doctor = await invoke(["doctor", "--json"], dir);
  assert.equal(doctor.code, 0);
  const configCheck = doctor.json.data.checks.find(
    (check) => check.name === "config",
  );
  assert.equal(configCheck.ok, true);

  const brief = await invoke(["status", "--brief"], dir);
  assert.equal(brief.code, 0);
  assert.match(brief.out, /no active task/);
});

test("init is idempotent without force and rewrites with force", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  const first = await invoke(["init", "--json"], dir);
  assert.equal(first.code, 0);
  const second = await invoke(["init", "--json"], dir);
  assert.equal(second.code, 0);
  assert.ok(
    second.json.warnings.some((warning) => warning.code === "W_CONFIG_EXISTS"),
  );

  const forced = await invoke(["init", "--json", "--force"], dir);
  assert.equal(forced.code, 0);
  assert.equal(
    forced.json.warnings.some((warning) => warning.code === "W_CONFIG_EXISTS"),
    false,
  );
});

test("init --dry-run does not write config", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  const result = await invoke(["init", "--json", "--dry-run"], dir);
  assert.equal(result.code, 0);
  assert.equal(result.json.data.dryRun, true);
  assert.equal(existsSync(join(dir, ".codeflow/config.json")), false);
});

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
  "Guard the redirect when the token is already present.",
  "",
  "## Durable updates",
  "Not durable — test fixture.",
  "",
].join("\n");

test("new, approve design, plan, and approve plan form the M2 flow", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  await invoke(["init", "--json"], dir);
  const created = await invoke(["new", "Fix login", "--json"], dir);
  assert.equal(created.code, 0);
  const taskId = created.json.data.taskId;
  assert.equal(created.json.data.kind, "code");
  assert.ok(existsSync(join(dir, created.json.data.taskSpecPath)));

  const specPath = join(dir, created.json.data.taskSpecPath);
  writeFileSync(specPath, SPEC);

  const design = await invoke(["approve", "design", "--json"], dir);
  assert.equal(design.code, 0);
  assert.equal(design.json.data.target, "design");

  const planInit = await invoke(["plan", "--init", "--json"], dir);
  assert.equal(planInit.code, 0);
  const planFile = join(
    dir,
    ".codeflow/state/tasks",
    taskId,
    "plan.json",
  );
  writeFileSync(
    planFile,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        taskId,
        steps: [
          {
            id: "1",
            title: "Add the redirect guard",
            status: "pending",
            commitSubject: "fix(auth): add the redirect guard",
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

  const plan = await invoke(["plan", "--json"], dir);
  assert.equal(plan.code, 0);
  assert.equal(plan.json.data.steps, 1);

  const planApproval = await invoke(["approve", "plan", "--json"], dir);
  assert.equal(planApproval.code, 0);

  const status = await invoke(["status", "--json"], dir);
  assert.equal(status.code, 0);
  assert.equal(status.json.data.task.status, "planned");
  assert.deepEqual(status.json.data.next, ["start"]);
  assert.equal(status.json.data.approvals.design.stale, false);
  assert.equal(status.json.data.approvals.plan.stale, false);
});

test("design approval refuses a template and plan approval refuses a missing design", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  await invoke(["init", "--json"], dir);
  const created = await invoke(["new", "Fix login", "--json"], dir);
  assert.equal(created.code, 0);

  const design = await invoke(["approve", "design", "--json"], dir);
  assert.equal(design.code, 3);
  assert.equal(design.json.error.code, "E_STATE_CONFLICT");

  const plan = await invoke(["approve", "plan", "--json"], dir);
  assert.equal(plan.code, 3);
  assert.equal(plan.json.error.code, "E_STATE_CONFLICT");
});

test("status reports a stale approval after the task-spec changes", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));

  await invoke(["init", "--json"], dir);
  const created = await invoke(["new", "Fix login", "--json"], dir);
  const specPath = join(dir, created.json.data.taskSpecPath);
  writeFileSync(specPath, SPEC);
  assert.equal((await invoke(["approve", "design", "--json"], dir)).code, 0);

  writeFileSync(specPath, `${SPEC}\n## Deferrals\nNone.\n`);
  const status = await invoke(["status", "--json"], dir);
  assert.equal(status.code, 0);
  assert.deepEqual(status.json.data.next, ["approve design"]);
  assert.ok(
    status.json.warnings.some((warning) => warning.code === "W_APPROVAL_STALE"),
  );
});

async function markStepDone(dir, stepId = "1") {
  const result = await invoke(
    [
      "plan",
      "step",
      stepId,
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
  assert.equal(result.code, 0, result.err || result.out);
  return result;
}

async function setupActiveTask(dir, command, options = {}, t = null) {
  const worktreeRoot = mkdtempSync(join(tmpdir(), "codeflow-worktrees-"));
  if (t) {
    t.after(() => rmSync(worktreeRoot, { recursive: true, force: true }));
  }
  const {
    failOn = [],
    trust = true,
  } = options;

  await invoke(["init", "--json"], dir);
  const configFile = join(dir, ".codeflow/config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.worktreeRoot = worktreeRoot;
  config.gates = [
    {
      name: "test",
      command,
      cwd: ".",
      tier: "fast",
      kinds: ["code"],
      required: true,
      timeoutSec: 30,
    },
  ];
  config.attention.failOn = failOn;
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync("git", ["add", ".codeflow/config.json"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "test: commit codeflow config"], {
    cwd: dir,
  });
  if (trust) {
    assert.equal((await invoke(["trust", "--yes", "--json"], dir)).code, 0);
  }

  const created = await invoke(["new", "Fix login", "--json"], dir);
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
  await markStepDone(dir);

  const taskFile = join(dir, ".codeflow/state/tasks", taskId, "task.json");
  const task = JSON.parse(readFileSync(taskFile, "utf8"));
  return { taskId, configFile, taskFile, worktree: task.worktree };
}

test("verify passes, records evidence, and marks the task verified", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const { taskId } = await setupActiveTask(
    dir,
    'node -e "process.exit(0)"',
    {},
    t,
  );

  const result = await invoke(["verify", "--json"], dir);
  assert.equal(result.code, 0);
  assert.equal(result.json.data.result, "pass");
  assert.ok(existsSync(join(dir, result.json.data.evidencePath)));

  const status = await invoke(["status", "--json", "--task", taskId], dir);
  assert.equal(status.json.data.task.status, "verified");
  assert.deepEqual(status.json.data.next, ["self-review", "pr"]);
});

test("verify refuses an untrusted config", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  await setupActiveTask(dir, 'node -e "process.exit(0)"', { trust: false }, t);

  const result = await invoke(["verify", "--json"], dir);
  assert.equal(result.code, 6);
  assert.equal(result.json.error.code, "E_TRUST_REQUIRED");
});

test("a failing required gate exits 1 and records a failed evidence file", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  await setupActiveTask(dir, 'node -e "process.exit(1)"', {}, t);

  const result = await invoke(["verify", "--json"], dir);
  assert.equal(result.code, 1);
  assert.equal(result.json.data.result, "fail");
  const evidence = JSON.parse(
    readFileSync(join(dir, result.json.data.evidencePath), "utf8"),
  );
  assert.equal(evidence.result, "fail");
});

test("attention failOn blocks the task", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const { taskId, worktree } = await setupActiveTask(
    dir,
    'node -e "process.exit(0)"',
    { failOn: ["suppression"] },
    t,
  );

  writeFileSync(join(worktree, "auth.ts"), "// @ts-ignore\nexport const a = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: worktree });

  const result = await invoke(["verify", "--json"], dir);
  assert.equal(result.code, 1);
  assert.equal(result.json.data.result, "fail");

  const status = await invoke(["status", "--json", "--task", taskId], dir);
  assert.equal(status.json.data.task.status, "blocked");
  assert.deepEqual(status.json.data.next, ["resume"]);
  assert.equal(status.json.data.blocked.code, "E_GATE_FAILED");
});

async function setupPlannedTask(dir, t) {
  const worktreeRoot = mkdtempSync(join(tmpdir(), "codeflow-worktrees-"));
  t.after(() => rmSync(worktreeRoot, { recursive: true, force: true }));

  await invoke(["init", "--json"], dir);
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
  execFileSync("git", ["add", ".codeflow/config.json"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "test: commit codeflow config"], {
    cwd: dir,
  });
  assert.equal((await invoke(["trust", "--yes", "--json"], dir)).code, 0);

  const created = await invoke(["new", "Fix login", "--json"], dir);
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

  const taskFile = join(dir, ".codeflow/state/tasks", taskId, "task.json");
  const task = JSON.parse(readFileSync(taskFile, "utf8"));
  return { taskId, taskFile, task, worktree: task.worktree };
}

test("start creates a worktree and abandon removes it", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const planned = await setupPlannedTask(dir, t);

  const start = await invoke(["start", "--json"], dir);
  assert.equal(start.code, 0);
  assert.equal(start.json.data.branch, planned.task.branch);
  assert.ok(existsSync(planned.worktree));

  const status = await invoke(["status", "--json"], dir);
  assert.equal(status.json.data.task.status, "active");

  const again = await invoke(["start", "--json"], dir);
  assert.equal(again.code, 0);
  assert.ok(
    again.json.warnings.some((warning) => warning.code === "W_ALREADY_ACTIVE"),
  );

  const finish = await invoke(["finish", "--confirm", "--json"], dir);
  assert.equal(finish.code, 3);
  assert.equal(finish.json.error.code, "E_STATE_CONFLICT");

  const abandoned = await invoke(["abandon", "--confirm", "--json"], dir);
  assert.equal(abandoned.code, 0);
  assert.equal(abandoned.json.data.removedWorktree, true);
  assert.equal(existsSync(planned.worktree), false);

  const done = await invoke(["status", "--json"], dir);
  assert.equal(done.json.data.task.status, "abandoned");
});

test("resume clears a blocked state", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const planned = await setupPlannedTask(dir, t);
  assert.equal((await invoke(["start", "--json"], dir)).code, 0);

  const task = JSON.parse(readFileSync(planned.taskFile, "utf8"));
  task.status = "blocked";
  task.blocked = {
    code: "E_REBASE_CONFLICT",
    reason: "conflict",
    from: "active",
    at: new Date().toISOString(),
    hint: "resolve",
  };
  writeFileSync(planned.taskFile, `${JSON.stringify(task, null, 2)}\n`);

  const resumed = await invoke(["resume", "--json"], dir);
  assert.equal(resumed.code, 0);
  assert.equal(resumed.json.data.status, "active");
  const after = JSON.parse(readFileSync(planned.taskFile, "utf8"));
  assert.equal(after.status, "active");
  assert.equal(after.blocked, null);
});

test("abandon refuses a dirty worktree without force", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const planned = await setupPlannedTask(dir, t);
  assert.equal((await invoke(["start", "--json"], dir)).code, 0);
  writeFileSync(join(planned.worktree, "dirty.txt"), "dirty\n");

  const refused = await invoke(["abandon", "--confirm", "--json"], dir);
  assert.equal(refused.code, 4);
  assert.equal(refused.json.error.code, "E_DIRTY_TREE");

  const forced = await invoke(
    ["abandon", "--confirm", "--force", "--json"],
    dir,
  );
  assert.equal(forced.code, 0);
  assert.equal(existsSync(planned.worktree), false);
});

function fakeGh(t) {
  const bin = mkdtempSync(join(tmpdir(), "codeflow-gh-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const script = join(bin, "gh");
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
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

test("self-review, approve, pr, watch, and comments form the delivery flow", async (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const bare = mkdtempSync(join(tmpdir(), "codeflow-origin-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  execFileSync("git", ["init", "--bare", "-b", "main", bare], {
    stdio: "ignore",
  });
  const planned = await setupPlannedTask(dir, t);
  execFileSync("git", ["remote", "set-url", "origin", bare], { cwd: dir });
  execFileSync("git", ["push", "-u", "origin", "main"], { cwd: dir });
  const env = fakeGhEnv(t);

  assert.equal((await invoke(["start", "--json"], dir)).code, 0);
  await markStepDone(dir);
  assert.equal((await invoke(["verify", "--json"], dir)).code, 0);
  assert.equal((await invoke(["self-review", "--json"], dir)).code, 0);
  assert.equal(
    (await invoke(["approve", "self-review", "--json"], dir)).code,
    0,
  );

  const pr = await invoke(["pr", "--json"], dir, env);
  assert.equal(pr.code, 0, pr.err || pr.out);
  assert.equal(pr.json.data.mode, "gh");
  assert.equal(pr.json.data.number, 7);
  assert.ok(existsSync(join(dir, ".codeflow/state/tasks", planned.taskId, "pr.json")));

  const watch = await invoke(["watch", "--json"], dir, env);
  assert.equal(watch.code, 0);
  assert.equal(watch.json.data.state, "pending");

  const comments = await invoke(["comments", "--json"], dir, env);
  assert.equal(comments.code, 0);
  assert.equal(comments.json.data.threads, 0);
  assert.ok(
    existsSync(join(dir, ".codeflow/state/tasks", planned.taskId, "COMMENTS.md")),
  );
});

