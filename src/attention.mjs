import { git } from "./git.mjs";

const TEST_PATH =
  /(^|\/)(__tests__|test|tests)\/|\.(test|spec)\.[^.]+$|_test\.go$/;
const SKIP_PATTERNS = [
  /\b(?:it|describe|test)\.skip\b/,
  /\b(?:xit|xdescribe)\b/,
  /pytest\.mark\.skip/,
  /\bt\.Skip\(/,
  /#\[ignore\]/,
  /@unittest\.skip/,
];
const SUPPRESSION_PATTERNS = [
  /@ts-ignore/,
  /@ts-expect-error/,
  /eslint-disable/,
  /biome-ignore/,
  /\bas any\b/,
  /# type: ignore/,
  /\/\/nolint/,
];
const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
]);

function splitLines(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

export function changedFiles(cwd, base) {
  const files = new Map();
  for (const line of splitLines(git(["diff", "--name-status", base], { cwd }))) {
    const parts = line.split("\t");
    if (parts.length < 2) {
      continue;
    }
    const status = parts[0][0];
    const file = parts.at(-1);
    files.set(file, status);
  }
  for (const file of splitLines(
    git(["ls-files", "--others", "--exclude-standard"], { cwd }),
  )) {
    if (!files.has(file)) {
      files.set(file, "A");
    }
  }
  return [...files.entries()].map(([path, status]) => ({ path, status }));
}

export function diffStats(cwd, base) {
  let files = 0;
  let lines = 0;
  for (const line of splitLines(git(["diff", "--numstat", base], { cwd }))) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    files += 1;
    const added = Number(parts[0]);
    const deleted = Number(parts[1]);
    if (Number.isFinite(added) && Number.isFinite(deleted)) {
      lines += added + deleted;
    }
  }
  return { files, lines };
}

export function addedLines(cwd, base) {
  const added = [];
  let file = null;
  let lineNumber = null;
  for (const line of git(["diff", "-U0", base], { cwd }).split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      file = line.slice("+++ b/".length);
      continue;
    }
    if (line.startsWith("+++ ")) {
      file = null;
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      lineNumber = match ? Number(match[1]) : null;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (file && lineNumber !== null) {
        added.push({ path: file, line: lineNumber, text: line.slice(1) });
        lineNumber += 1;
      }
      continue;
    }
    if (line.startsWith(" ")) {
      if (lineNumber !== null) {
        lineNumber += 1;
      }
    }
  }
  return added;
}

function isTestPath(file) {
  return TEST_PATH.test(file);
}

function isLockfile(file) {
  return LOCKFILES.has(file.split("/").at(-1));
}

function isConfigPath(file) {
  const base = file.split("/").at(-1);
  return (
    file === ".codeflow/config.json" ||
    file.startsWith(".github/workflows/") ||
    ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Makefile"].includes(
      base,
    )
  );
}

const DOC_PATH = /\.(md|mdx|rst|txt)$/i;
const INFRA_FILES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "tsconfig.json",
  "biome.json",
]);

function isDocsPath(file) {
  return (
    DOC_PATH.test(file) ||
    file.startsWith("docs/") ||
    /^LICENSE(\.|$)/.test(file) ||
    /^README(\.|$)/i.test(file)
  );
}

function isInfraPath(file) {
  return (
    isConfigPath(file) ||
    isLockfile(file) ||
    file.startsWith(".github/") ||
    INFRA_FILES.has(file.split("/").at(-1))
  );
}

export function inferKind(files) {
  const kinds = new Set();
  for (const entry of files) {
    const file = typeof entry === "string" ? entry : entry.path;
    if (!file) {
      continue;
    }
    if (isTestPath(file)) {
      kinds.add("test");
    } else if (isDocsPath(file)) {
      kinds.add("docs");
    } else if (isInfraPath(file)) {
      kinds.add("infra");
    } else {
      kinds.add("code");
    }
  }
  if (kinds.size === 0) {
    return "code";
  }
  if (kinds.size > 1) {
    return "mixed";
  }
  return [...kinds][0];
}

function matches(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function scanAttention(cwd, base, config) {
  const files = changedFiles(cwd, base);
  const added = addedLines(cwd, base);
  const stats = diffStats(cwd, base);
  const thresholds = config.attention;

  const skips = added
    .filter((entry) => matches(entry.text, SKIP_PATTERNS))
    .map((entry) => ({
      path: entry.path,
      line: entry.line,
      pattern: entry.text.trim(),
    }));
  const suppressions = added
    .filter((entry) => matches(entry.text, SUPPRESSION_PATTERNS))
    .map((entry) => ({
      path: entry.path,
      line: entry.line,
      pattern: entry.text.trim(),
    }));

  return {
    testFiles: files
      .filter((entry) => isTestPath(entry.path))
      .map((entry) => ({ path: entry.path, change: entry.status })),
    skips,
    suppressions,
    configChanges: files
      .filter((entry) => isConfigPath(entry.path))
      .map((entry) => entry.path),
    lockfileChanges: files
      .filter((entry) => isLockfile(entry.path))
      .map((entry) => entry.path),
    largeDiff: {
      files: stats.files,
      lines: stats.lines,
      thresholdFiles: thresholds.largeDiffFiles,
      thresholdLines: thresholds.largeDiffLines,
    },
    scopeDrift: [],
    closestLook: [],
  };
}

export function hasAttention(attention, category) {
  switch (category) {
    case "test":
      return attention.testFiles.length > 0;
    case "skip":
      return attention.skips.length > 0;
    case "suppression":
      return attention.suppressions.length > 0;
    case "config":
      return attention.configChanges.length > 0;
    case "lockfile":
      return attention.lockfileChanges.length > 0;
    case "large-diff":
      return (
        attention.largeDiff.files > attention.largeDiff.thresholdFiles ||
        attention.largeDiff.lines > attention.largeDiff.thresholdLines
      );
    default:
      return false;
  }
}

export function failedAttention(attention, failOn = []) {
  return failOn.filter((category) => hasAttention(attention, category));
}

export function attentionCounts(attention) {
  return {
    testFiles: attention.testFiles.length,
    skips: attention.skips.length,
    suppressions: attention.suppressions.length,
    configChanges: attention.configChanges.length,
    lockfileChanges: attention.lockfileChanges.length,
    largeDiff:
      attention.largeDiff.files > attention.largeDiff.thresholdFiles ||
      attention.largeDiff.lines > attention.largeDiff.thresholdLines,
  };
}
