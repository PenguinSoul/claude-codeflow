import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.mjs";
import { capture, cleanup, tempDir, tempRepo } from "./helpers.mjs";

async function invoke(args, cwd) {
  const out = capture();
  const err = capture();
  const code = await run(args, {
    cwd,
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
