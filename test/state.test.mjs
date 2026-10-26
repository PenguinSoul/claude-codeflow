import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { defaultConfig } from "../src/config.mjs";
import { findRepo } from "../src/repo.mjs";
import {
  ensureState,
  listTasks,
  nextTaskId,
  readActive,
  readTask,
  statePaths,
  writeActive,
  writeTask,
} from "../src/state.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

test("statePaths and active pointer round-trip", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const config = defaultConfig(findRepo(dir));
  const paths = statePaths(dir, config);

  ensureState(paths);
  assert.equal(existsSync(paths.tasksDir), true);
  assert.equal(readActive(paths), null);

  writeActive(paths, "2026-10-26-fix-login");
  assert.equal(readActive(paths).taskId, "2026-10-26-fix-login");
});

test("writeTask, readTask, listTasks, and nextTaskId are consistent", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const config = defaultConfig(findRepo(dir));
  const paths = statePaths(dir, config);
  ensureState(paths);

  const first = nextTaskId(paths, "Fix login");
  writeTask(paths, {
    schemaVersion: 1,
    id: first,
    title: "Fix login",
    status: "created",
  });
  const second = nextTaskId(paths, "Fix login");
  writeTask(paths, {
    schemaVersion: 1,
    id: second,
    title: "Fix login",
    status: "created",
  });
  const third = nextTaskId(paths, "Fix login");

  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.equal(readTask(paths, first).title, "Fix login");
  assert.equal(listTasks(paths).length, 2);
  assert.match(first, /^\d{4}-\d{2}-\d{2}-fix-login/);
});

test("statePaths rejects a stateDir that escapes the repository", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const config = defaultConfig(findRepo(dir));
  config.stateDir = "../escape";
  assert.throws(
    () => statePaths(dir, config),
    (error) => error.code === "E_CONFIG",
  );
});
