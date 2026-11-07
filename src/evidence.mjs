import path from "node:path";
import { configHash } from "./config.mjs";
import { gateSetHash } from "./gates.mjs";
import { git } from "./git.mjs";
import { assertSchema } from "./schema.mjs";
import { taskFile } from "./state.mjs";
import {
  nowIso,
  readJsonSafe,
  sha256,
  stableStringify,
  writeJsonAtomic,
  writeTextAtomic,
} from "./util.mjs";

export function gitTreeHash(cwd) {
  const value = git(["rev-parse", "HEAD^{tree}"], { cwd });
  return `git:${value}`;
}

export function gitCommit(cwd) {
  return git(["rev-parse", "--short", "HEAD"], { cwd });
}

export function gitBranch(cwd) {
  return git(["branch", "--show-current"], { cwd }) || null;
}

export function isDirty(cwd) {
  return git(["status", "--porcelain"], { cwd }).length > 0;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function buildEvidence(options) {
  const {
    root,
    cwd,
    task,
    config,
    gates,
    gateResults,
    attention,
    startedAt,
    finishedAt,
    result,
    kind,
    inferredKind,
    effectiveKind,
  } = options;

  return {
    schemaVersion: 1,
    taskId: task.id,
    kind: kind ?? task.kind,
    inferredKind: inferredKind ?? kind ?? task.kind,
    effectiveKind: effectiveKind ?? kind ?? task.kind,
    treeHash: gitTreeHash(cwd),
    commit: gitCommit(cwd),
    branch: gitBranch(cwd),
    dirty: isDirty(cwd),
    configHash: configHash(config),
    gateSetHash: gateSetHash(gates),
    nodeVersion: process.version,
    platform: process.platform,
    startedAt,
    finishedAt,
    result,
    gates: gateResults.map((entry) => ({
      ...entry,
      logPath: relative(root, entry.logPath),
    })),
    attention,
  };
}

export function evidenceHash(evidence) {
  return sha256(stableStringify(evidence));
}

// The self-review binds to the facts a reviewer signed off on, not to when the
// command happened to run. A no-op re-verify must not invalidate a human
// approval; a changed tree, config, gate set, result, or attention set must.
export function evidenceBindingHash(evidence) {
  return sha256(
    stableStringify({
      schemaVersion: evidence.schemaVersion,
      taskId: evidence.taskId,
      kind: evidence.kind,
      inferredKind: evidence.inferredKind,
      effectiveKind: evidence.effectiveKind,
      treeHash: evidence.treeHash,
      branch: evidence.branch,
      dirty: evidence.dirty,
      configHash: evidence.configHash,
      gateSetHash: evidence.gateSetHash,
      result: evidence.result,
      gates: (evidence.gates ?? []).map((gate) => ({
        name: gate.name,
        tier: gate.tier,
        required: gate.required,
        exitCode: gate.exitCode,
        timedOut: gate.timedOut,
        flaky: gate.flaky,
      })),
      attention: evidence.attention,
    }),
  );
}

export function isFresh(evidence, expected) {
  if (expected.dirty === true) {
    return false;
  }
  if (expected.branch && evidence?.branch !== expected.branch) {
    return false;
  }
  return Boolean(
    evidence &&
      evidence.result === "pass" &&
      evidence.dirty === false &&
      evidence.treeHash === expected.treeHash &&
      evidence.configHash === expected.configHash &&
      evidence.gateSetHash === expected.gateSetHash,
  );
}

export function renderEvidence(evidence) {
  const lines = [
    `# Evidence — ${evidence.taskId}`,
    "",
    `Result: ${evidence.result}`,
    `Tree: ${evidence.treeHash}`,
    `Commit: ${evidence.commit}`,
    `Branch: ${evidence.branch ?? "(detached)"}`,
    `Dirty: ${evidence.dirty ? "yes" : "no"}`,
    `Config: ${evidence.configHash}`,
    `Gates: ${evidence.gateSetHash}`,
    "",
    "| Gate | Tier | Required | Exit | Duration |",
    "| --- | --- | --- | --- | --- |",
    ...evidence.gates.map(
      (gate) =>
        `| ${gate.name} | ${gate.tier} | ${gate.required ? "yes" : "no"} | ${gate.exitCode}${gate.timedOut ? " (timeout)" : ""}${gate.flaky ? " (flaky)" : ""} | ${gate.durationMs}ms |`,
    ),
    "",
    "## Attention",
    `- Test files: ${evidence.attention.testFiles.length}`,
    `- Skips: ${evidence.attention.skips.length}`,
    `- Suppressions: ${evidence.attention.suppressions.length}`,
    `- Config changes: ${evidence.attention.configChanges.length}`,
    `- Lockfile changes: ${evidence.attention.lockfileChanges.length}`,
    `- Large diff: ${evidence.attention.largeDiff.files} files / ${evidence.attention.largeDiff.lines} lines (threshold ${evidence.attention.largeDiff.thresholdFiles} / ${evidence.attention.largeDiff.thresholdLines})`,
  ];
  return `${lines.join("\n")}\n`;
}

export function writeEvidence(paths, task, evidence) {
  writeJsonAtomic(taskFile(paths, task.id, "evidence.json"), evidence);
  writeTextAtomic(taskFile(paths, task.id, "EVIDENCE.md"), renderEvidence(evidence));
}

export function readEvidence(paths, taskId) {
  const file = taskFile(paths, taskId, "evidence.json");
  const value = readJsonSafe(file);
  return value ? assertSchema(value, "evidence", file) : null;
}

export function evidenceMeta(evidence) {
  if (!evidence) {
    return null;
  }
  return {
    result: evidence.result,
    treeHash: evidence.treeHash,
    finishedAt: evidence.finishedAt,
    hash: evidenceHash(evidence),
    attention: evidence.attention,
  };
}

export function emptyEvidenceTime() {
  return nowIso();
}
