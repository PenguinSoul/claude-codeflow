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
    .filter((entry) => entry.isDirectory())
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

export function readLock(paths, taskId) {
  return readJsonSafe(lockPath(paths, taskId));
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

export function acquireLock(paths, taskId, options = {}) {
  const {
    command = "unknown",
    ttlMs = 2 * 60 * 60 * 1000,
    force = false,
  } = options;
  ensureDir(taskDir(paths, taskId));
  const file = lockPath(paths, taskId);
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
    const existing = readLock(paths, taskId);
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
      return acquireLock(paths, taskId, { command, ttlMs, force: false });
    }
    throw new CodedError(
      ERROR_CODES.LOCKED,
      "the task is locked by another process",
      { lock: existing },
      "Wait for it to finish, or pass --force-unlock if it is stale.",
    );
  }
}

export function releaseLock(paths, taskId, options = {}) {
  const existing = readLock(paths, taskId);
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
    unlinkSync(lockPath(paths, taskId));
    return true;
  } catch {
    return false;
  }
}

export function forceUnlock(paths, taskId) {
  return releaseLock(paths, taskId, { force: true });
}

