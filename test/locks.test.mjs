import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { defaultConfig } from "../src/config.mjs";
import { findRepo } from "../src/repo.mjs";
import {
  acquireLock,
  acquireProjectLock,
  ensureState,
  lockPath,
  projectLockPath,
  readLock,
  readProjectLock,
  releaseLock,
  releaseProjectLock,
  statePaths,
  writeTask,
} from "../src/state.mjs";
import { nowIso, writeJsonAtomic } from "../src/util.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

function setup(t) {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const repo = findRepo(dir);
  const config = defaultConfig(repo);
  const paths = statePaths(dir, config);
  ensureState(paths);
  writeTask(paths, { schemaVersion: 1, id: "2026-10-27-task", title: "Task" });
  return { paths };
}

test("a task lock is exclusive and releasable", (t) => {
  const { paths } = setup(t);
  const lock = acquireLock(paths, "2026-10-27-task", { command: "verify" });

  assert.equal(lock.pid, process.pid);
  assert.equal(readLock(paths, "2026-10-27-task").command, "verify");
  assert.throws(
    () => acquireLock(paths, "2026-10-27-task", { command: "start" }),
    (error) => error.code === "E_LOCKED",
  );

  assert.equal(releaseLock(paths, "2026-10-27-task"), true);
  assert.equal(readLock(paths, "2026-10-27-task"), null);
  assert.equal(acquireLock(paths, "2026-10-27-task", { command: "start" }).command, "start");
});

test("a project lock is exclusive and releasable", (t) => {
  const { paths } = setup(t);
  const lock = acquireProjectLock(paths, { command: "new" });

  assert.equal(lock.pid, process.pid);
  assert.equal(readProjectLock(paths).command, "new");
  assert.ok(projectLockPath(paths).endsWith("state.lock"));
  assert.throws(
    () => acquireProjectLock(paths, { command: "trust" }),
    (error) => error.code === "E_LOCKED",
  );

  assert.equal(releaseProjectLock(paths), true);
  assert.equal(readProjectLock(paths), null);
  assert.equal(acquireProjectLock(paths, { command: "trust" }).command, "trust");
});

test("a dead pid makes a lock stale", (t) => {
  const { paths } = setup(t);
  writeJsonAtomic(lockPath(paths, "2026-10-27-task"), {
    pid: 999999,
    host: hostname(),
    command: "old",
    startedAt: nowIso(),
  });

  const lock = acquireLock(paths, "2026-10-27-task", { command: "verify" });
  assert.equal(lock.command, "verify");
});

test("force removes a lock held by another live pid", (t) => {
  const { paths } = setup(t);
  writeJsonAtomic(lockPath(paths, "2026-10-27-task"), {
    pid: 1,
    host: hostname(),
    command: "old",
    startedAt: nowIso(),
  });

  assert.throws(
    () => acquireLock(paths, "2026-10-27-task", { command: "verify" }),
    (error) => error.code === "E_LOCKED",
  );
  const lock = acquireLock(paths, "2026-10-27-task", {
    command: "verify",
    force: true,
  });
  assert.equal(lock.command, "verify");
});
