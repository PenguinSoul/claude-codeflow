import {
  closeSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { CodedError, ERROR_CODES } from "./contracts.mjs";
import {
  dateStamp,
  ensureDir,
  fileExists,
  isContained,
  nowIso,
  readJsonSafe,
  slugify,
  writeJsonAtomic,
} from "./util.mjs";

export const TASK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,63}$/;

export function assertTaskId(id) {
  if (!TASK_ID_PATTERN.test(String(id ?? ""))) {
    throw new CodedError(
      ERROR_CODES.USAGE,
      `invalid task id "${id}"`,
      { taskId: id },
      "Use a task id from `codeflow status --json`.",
    );
  }
  return id;
}

export function statePaths(root, config) {
  const stateDir = path.resolve(root, config.stateDir || ".codeflow/state");
  if (!isContained(root, stateDir)) {
    throw new CodedError(
      ERROR_CODES.CONFIG,
      "stateDir escapes the repository",
      { root, stateDir },
      "Use a repository-relative stateDir such as .codeflow/state.",
    );
  }
  const tasksDir = path.join(stateDir, "tasks");
  return {
    root,
    stateDir,
    tasksDir,
    activePath: path.join(stateDir, "active.json"),
    trustPath: path.join(stateDir, "trust.json"),
  };
}

export function ensureState(paths) {
  ensureDir(paths.tasksDir);
}

export function readActive(paths) {
  const value = readJsonSafe(paths.activePath);
  if (!value || typeof value.taskId !== "string") {
    return null;
  }
  if (!TASK_ID_PATTERN.test(value.taskId)) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "active.json contains an invalid task id",
      { taskId: value.taskId },
      "Run `codeflow new` or clear the corrupt active pointer.",
    );
  }
  return value;
}

export function writeActive(paths, taskId) {
  ensureState(paths);
  writeJsonAtomic(paths.activePath, {
    schemaVersion: 1,
    taskId,
    updatedAt: nowIso(),
  });
}

export function taskDir(paths, id) {
  assertTaskId(id);
  return path.join(paths.tasksDir, id);
}

export function taskFile(paths, id, name) {
  return path.join(taskDir(paths, id), name);
}

export function readTask(paths, id) {
  return readJsonSafe(taskFile(paths, id, "task.json"));
}

export function writeTask(paths, task) {
  ensureDir(taskDir(paths, task.id));
  writeJsonAtomic(taskFile(paths, task.id, "task.json"), task);
}

export function listTasks(paths) {
  if (!fileExists(paths.tasksDir)) {
    return [];
  }
  return readdirSync(paths.tasksDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && TASK_ID_PATTERN.test(entry.name),
    )
    .map((entry) => readTask(paths, entry.name))
    .filter(Boolean);
}

export function nextTaskId(paths, title) {
  const base = `${dateStamp()}-${slugify(title)}`;
  let id = base;
  let suffix = 2;
  while (fileExists(taskDir(paths, id))) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function readTrust(paths) {
  return readJsonSafe(paths.trustPath);
}

export function writeTrust(paths, trust) {
  ensureState(paths);
  writeJsonAtomic(paths.trustPath, trust);
}

export function lockPath(paths, taskId) {
  return path.join(taskDir(paths, taskId), "lock");
}

export function projectLockPath(paths) {
  return path.join(paths.stateDir, "state.lock");
}

export function readLock(paths, taskId) {
  return readJsonSafe(lockPath(paths, taskId));
}

export function readProjectLock(paths) {
  return readJsonSafe(projectLockPath(paths));
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireLockFile(file, options = {}) {
  const {
    command = "unknown",
    ttlMs = 2 * 60 * 60 * 1000,
    force = false,
    label = "task",
  } = options;
  ensureDir(path.dirname(file));
  const payload = {
    pid: process.pid,
    host: hostname(),
    command,
    startedAt: nowIso(),
  };

  try {
    const fd = openSync(file, "wx");
    writeSync(fd, `${JSON.stringify(payload)}\n`);
    closeSync(fd);
    return payload;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    const existing = readJsonSafe(file);
    const age = existing?.startedAt
      ? Date.now() - Date.parse(existing.startedAt)
      : Number.POSITIVE_INFINITY;
    const stale =
      !existing ||
      age > ttlMs ||
      (existing.host === hostname() && !pidAlive(existing.pid));
    if (force || stale) {
      try {
        unlinkSync(file);
      } catch {
        // A concurrent process may have removed it.
      }
      return acquireLockFile(file, { command, ttlMs, force: false, label });
    }
    throw new CodedError(
      ERROR_CODES.LOCKED,
      `the ${label} is locked by another process`,
      { lock: existing },
      "Wait for it to finish, or pass --force-unlock if it is stale.",
    );
  }
}

function releaseLockFile(file, options = {}) {
  const existing = readJsonSafe(file);
  if (!existing) {
    return false;
  }
  if (
    !options.force &&
    existing.host === hostname() &&
    existing.pid !== process.pid
  ) {
    return false;
  }
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(paths, taskId, options = {}) {
  ensureDir(taskDir(paths, taskId));
  return acquireLockFile(lockPath(paths, taskId), {
    ...options,
    label: "task",
  });
}

export function acquireProjectLock(paths, options = {}) {
  ensureState(paths);
  return acquireLockFile(projectLockPath(paths), {
    ...options,
    label: "project state",
  });
}

export function releaseLock(paths, taskId, options = {}) {
  return releaseLockFile(lockPath(paths, taskId), options);
}

export function releaseProjectLock(paths, options = {}) {
  return releaseLockFile(projectLockPath(paths), options);
}

export function forceUnlock(paths, taskId) {
  return releaseLock(paths, taskId, { force: true });
}

export function forceProjectUnlock(paths) {
  return releaseProjectLock(paths, { force: true });
}

