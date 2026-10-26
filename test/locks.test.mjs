import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { defaultConfig } from "../src/config.mjs";
import { findRepo } from "../src/repo.mjs";
import {
  acquireLock,
  ensureState,
  lockPath,
  readLock,
  releaseLock,
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
  writeTask(paths, { schemaVersion: 1, id: "task", title: "Task" });
  return { paths };
}

test("a task lock is exclusive and releasable", (t) => {
  const { paths } = setup(t);
  const lock = acquireLock(paths, "task", { command: "verify" });

  assert.equal(lock.pid, process.pid);
  assert.equal(readLock(paths, "task").command, "verify");
  assert.throws(
    () => acquireLock(paths, "task", { command: "start" }),
    (error) => error.code === "E_LOCKED",
  );

  assert.equal(releaseLock(paths, "task"), true);
  assert.equal(readLock(paths, "task"), null);
  assert.equal(acquireLock(paths, "task", { command: "start" }).command, "start");
});

test("a dead pid makes a lock stale", (t) => {
  const { paths } = setup(t);
  writeJsonAtomic(lockPath(paths, "task"), {
    pid: 999999,
    host: hostname(),
    command: "old",
    startedAt: nowIso(),
  });

  const lock = acquireLock(paths, "task", { command: "verify" });
  assert.equal(lock.command, "verify");
});

test("force removes a lock held by another live pid", (t) => {
  const { paths } = setup(t);
  writeJsonAtomic(lockPath(paths, "task"), {
    pid: 1,
    host: hostname(),
    command: "old",
    startedAt: nowIso(),
  });

  assert.throws(
    () => acquireLock(paths, "task", { command: "verify" }),
    (error) => error.code === "E_LOCKED",
  );
  const lock = acquireLock(paths, "task", {
    command: "verify",
    force: true,
  });
  assert.equal(lock.command, "verify");
});
