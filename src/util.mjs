import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readJsonSafe(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function fileExists(file) {
  return existsSync(file);
}

export function readText(file) {
  return readFileSync(file, "utf8");
}

export function expandHome(value) {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

export function tailLines(text, count = 20) {
  const lines = String(text ?? "").split(/\r?\n/);
  return lines.slice(-count).join("\n").trimEnd();
}

export function truncate(text, max = 4000) {
  const value = String(text ?? "");
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function slugify(text) {
  const source = String(text ?? "");
  const slug = source
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/g, "");
  if (slug) {
    return slug;
  }
  // A title with no ASCII word characters (for example CJK) loses every
  // character above and would collapse to the same "task" id. Keep ids ASCII
  // and branch-safe, but derive a stable suffix from the original title so
  // different titles stay distinguishable and repeat runs stay idempotent.
  const trimmed = source.trim();
  if (!trimmed) {
    return "task";
  }
  const digest = createHash("sha256")
    .update(trimmed.normalize("NFC"))
    .digest("hex")
    .slice(0, 8);
  return `t-${digest}`;
}

export function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isContained(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function which(name, env = process.env) {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [name], { encoding: "utf8", env });
  if (result.status === 0) {
    const found = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) {
      return found;
    }
  }
  if (env.PATH !== undefined && env.PATH.trim() === "") {
    return null;
  }
  const fallbacks = [
    path.join(homedir(), ".local", "bin", name),
    path.join(homedir(), "bin", name),
    path.join("/usr/local/bin", name),
    path.join("/opt/homebrew/bin", name),
  ];
  return fallbacks.find((candidate) => existsSync(candidate)) ?? null;
}

export function runFile(file, args = [], options = {}) {
  const {
    cwd,
    timeout = 30000,
    env = process.env,
  } = options;
  const result = spawnSync(file, args, {
    cwd,
    timeout,
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    timedOut,
  };
}

export function runShell(command, options = {}) {
  const {
    cwd,
    timeout = 300000,
    env = process.env,
  } = options;
  const result = spawnSync(command, {
    cwd,
    shell: true,
    timeout,
    encoding: "utf8",
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    timedOut,
  };
}
