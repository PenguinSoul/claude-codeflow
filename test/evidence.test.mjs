import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanAttention } from "../src/attention.mjs";
import { defaultConfig } from "../src/config.mjs";
import {
  buildEvidence,
  gitTreeHash,
  isFresh,
  renderEvidence,
  writeEvidence,
} from "../src/evidence.mjs";
import { gateSetHash } from "../src/gates.mjs";
import { findRepo } from "../src/repo.mjs";
import { ensureState, statePaths, taskFile } from "../src/state.mjs";
import { cleanup, git, tempRepo } from "./helpers.mjs";

function setup(t) {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const repo = findRepo(dir);
  const config = defaultConfig(repo);
  const paths = statePaths(dir, config);
  ensureState(paths);
  const task = { id: "2026-10-26-evidence" };
  const gates = [
    {
      name: "test",
      command: 'node -e "process.exit(0)"',
      cwd: ".",
      tier: "fast",
      kinds: ["code"],
      required: true,
      timeoutSec: 30,
    },
  ];
  const gateResults = [
    {
      name: "test",
      command: gates[0].command,
      tier: "fast",
      required: true,
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
      flaky: false,
      attempt: 1,
      logPath: join(paths.stateDir, "tasks", task.id, "logs", "test.log"),
      tail: "",
    },
  ];
  return { dir, repo, config, paths, task, gates, gateResults };
}

function build(context, overrides = {}) {
  return buildEvidence({
    root: context.dir,
    cwd: context.dir,
    task: context.task,
    config: context.config,
    gates: context.gates,
    gateResults: context.gateResults,
    attention: scanAttention(context.dir, "main", context.config),
    startedAt: "2026-10-26T10:00:00Z",
    finishedAt: "2026-10-26T10:01:00Z",
    result: "pass",
    ...overrides,
  });
}

test("evidence records tree, config, gates, and is fresh for the same tree", (t) => {
  const context = setup(t);
  const evidence = build(context);

  assert.equal(evidence.treeHash, gitTreeHash(context.dir));
  assert.equal(evidence.configHash, evidence.configHash);
  assert.equal(evidence.gateSetHash, gateSetHash(context.gates));
  assert.equal(evidence.dirty, false);
  assert.equal(
    isFresh(evidence, {
      treeHash: evidence.treeHash,
      configHash: evidence.configHash,
      gateSetHash: evidence.gateSetHash,
    }),
    true,
  );
  assert.match(renderEvidence(evidence), /# Evidence — 2026-10-26-evidence/);
});

test("a content change or a dirty tree invalidates freshness", (t) => {
  const context = setup(t);
  const evidence = build(context);

  writeFileSync(join(context.dir, "README.md"), "# changed\n");
  assert.equal(
    isFresh(evidence, {
      treeHash: evidence.treeHash,
      configHash: evidence.configHash,
      gateSetHash: evidence.gateSetHash,
      dirty: true,
    }),
    false,
  );

  git(context.dir, ["add", "-A"]);
  git(context.dir, ["commit", "-m", "change"]);
  const nextTree = gitTreeHash(context.dir);
  assert.notEqual(nextTree, evidence.treeHash);
  assert.equal(
    isFresh(evidence, {
      treeHash: nextTree,
      configHash: evidence.configHash,
      gateSetHash: evidence.gateSetHash,
    }),
    false,
  );
});

test("writeEvidence writes JSON and Markdown", (t) => {
  const context = setup(t);
  const evidence = build(context);
  writeEvidence(context.paths, context.task, evidence);

  assert.ok(
    existsSync(taskFile(context.paths, context.task.id, "evidence.json")),
  );
  const markdown = readFileSync(
    taskFile(context.paths, context.task.id, "EVIDENCE.md"),
    "utf8",
  );
  assert.match(markdown, /Result: pass/);
  assert.match(markdown, /\| test \| fast \| yes \| 0 \| 10ms \|/);
});
