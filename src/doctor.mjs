import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { validateConfig } from "./config.mjs";
import { ghAuthStatus } from "./github.mjs";
import { gitVersion } from "./git.mjs";
import { planPath } from "./plan.mjs";
import { isSchemaSupported } from "./schema.mjs";
import {
  readActive,
  readLock,
  readProjectLock,
  readTrust,
  statePaths,
  taskFile,
} from "./state.mjs";
import { isTrusted } from "./trust.mjs";
import { expandHome, readJsonSafe, which } from "./util.mjs";

const LOCK_TTL_MS = 2 * 60 * 60 * 1000;

function writableDir(dir) {
  let current = dir;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  try {
    accessSync(current, constants.W_OK);
    return { ok: true, detail: dir };
  } catch {
    return { ok: false, detail: `${dir} (not writable)` };
  }
}

function lockCheck(paths, activeId) {
  const locks = [];
  const project = readProjectLock(paths);
  if (project) {
    locks.push({ scope: "project", ...project });
  }
  if (activeId) {
    const task = readLock(paths, activeId);
    if (task) {
      locks.push({ scope: "task", ...task });
    }
  }
  if (locks.length === 0) {
    return { ok: true, detail: "no active locks" };
  }
  const now = Date.now();
  const stale = locks.filter((lock) => {
    const age = lock.startedAt ? now - Date.parse(lock.startedAt) : Infinity;
    return age > LOCK_TTL_MS;
  });
  const detail = locks
    .map(
      (lock) =>
        `${lock.scope} pid ${lock.pid} (${lock.command})${stale.includes(lock) ? " stale" : ""}`,
    )
    .join("; ");
  return { ok: stale.length === 0, detail };
}

function schemaCheck(paths, activeId) {
  if (!activeId) {
    return { ok: true, detail: "no active task" };
  }
  const files = [
    ["task", taskFile(paths, activeId, "task.json")],
    ["plan", planPath(paths, activeId)],
    ["evidence", taskFile(paths, activeId, "evidence.json")],
    ["review", taskFile(paths, activeId, "review.json")],
    ["pr", taskFile(paths, activeId, "pr.json")],
  ];
  const unsupported = [];
  const checked = [];
  for (const [kind, file] of files) {
    const value = readJsonSafe(file);
    if (!value) {
      continue;
    }
    checked.push(kind);
    if (!isSchemaSupported(value)) {
      unsupported.push(`${kind} (${value.schemaVersion ?? "missing"})`);
    }
  }
  return {
    ok: unsupported.length === 0,
    detail:
      unsupported.length > 0
        ? `unsupported: ${unsupported.join(", ")}`
        : checked.length > 0
          ? `supported: ${checked.join(", ")}`
          : "no artifacts yet",
  };
}

export function runDoctor(repo, config, configError = null, env = process.env) {
  const checks = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: nodeMajor >= 20,
    detail: process.version,
  });

  const version = gitVersion();
  checks.push({
    name: "git",
    ok: Boolean(version),
    detail: version ?? "not found",
  });

  const gh = which("gh", env);
  checks.push({
    name: "gh",
    ok: Boolean(gh),
    detail: gh ?? "not installed; PR creation will use a compare URL",
  });
  if (gh) {
    const auth = ghAuthStatus(env);
    checks.push({
      name: "ghAuth",
      ok: auth.ok,
      detail: auth.detail,
    });
  }

  if (configError) {
    checks.push({
      name: "config",
      ok: false,
      detail: configError.message,
    });
  } else {
    const errors = validateConfig(config);
    checks.push({
      name: "config",
      ok: errors.length === 0,
      detail: errors.length === 0 ? "valid" : errors.join("; "),
    });
  }

  if (!config) {
    checks.push({ name: "worktreeRoot", ok: false, detail: "no config" });
    checks.push({ name: "state", ok: false, detail: "no config" });
    checks.push({ name: "trust", ok: false, detail: "no config" });
    checks.push({ name: "schema", ok: false, detail: "no config" });
    checks.push({ name: "locks", ok: false, detail: "no config" });
    return { checks };
  }

  const worktreeRoot = writableDir(expandHome(config.worktreeRoot));
  checks.push({ name: "worktreeRoot", ...worktreeRoot });

  const paths = statePaths(repo.mainRoot, config);
  const stateExists = existsSync(paths.stateDir);
  let writable = false;
  try {
    accessSync(stateExists ? paths.stateDir : repo.mainRoot, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "state",
    ok: writable,
    detail: stateExists
      ? paths.stateDir
      : `${paths.stateDir} (will be created by init)`,
  });

  let activeId = null;
  try {
    activeId = readActive(paths)?.taskId ?? null;
  } catch (error) {
    checks.push({
      name: "active",
      ok: false,
      detail: error.message,
    });
  }

  let trust = null;
  try {
    trust = readTrust(paths);
  } catch (error) {
    checks.push({
      name: "trust",
      ok: false,
      detail: error.message,
    });
  }
  if (trust === null && !checks.some((check) => check.name === "trust")) {
    checks.push({
      name: "trust",
      ok: false,
      detail: "not trusted; run `codeflow trust`",
    });
  } else if (trust && !isTrusted(paths, config)) {
    checks.push({
      name: "trust",
      ok: false,
      detail: "config changed since trust; run `codeflow trust` again",
    });
  } else if (trust) {
    checks.push({ name: "trust", ok: true, detail: "config hash matches" });
  }

  const schema = schemaCheck(paths, activeId);
  checks.push({
    name: "schema",
    ok: schema.ok && config.schemaVersion === 1,
    detail:
      config.schemaVersion === 1
        ? `config 1; ${schema.detail}`
        : `config ${config.schemaVersion}; ${schema.detail}`,
  });

  checks.push({
    name: "locks",
    ...lockCheck(paths, activeId),
  });

  return { checks };
}
