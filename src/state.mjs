import { readdirSync } from "node:fs";
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
