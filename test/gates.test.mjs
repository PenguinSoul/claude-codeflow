import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  gateSetHash,
  runGates,
  selectGates,
} from "../src/gates.mjs";
import { cleanup, tempDir } from "./helpers.mjs";

function gate(overrides) {
  return {
    name: "test",
    command: 'node -e "process.exit(0)"',
    cwd: ".",
    tier: "fast",
    kinds: ["code"],
    required: true,
    timeoutSec: 30,
    ...overrides,
  };
}

test("selectGates filters by tier and kind", () => {
  const config = {
    gates: [
      gate({ name: "lint" }),
      gate({ name: "e2e", tier: "full" }),
      gate({ name: "live", tier: "live" }),
      gate({ name: "docs", kinds: ["docs"] }),
    ],
  };

  assert.deepEqual(
    selectGates(config, "code", "fast").map((entry) => entry.name),
    ["lint"],
  );
  assert.deepEqual(
    selectGates(config, "code", "full").map((entry) => entry.name),
    ["lint", "e2e"],
  );
  assert.deepEqual(
    selectGates(config, "code", "live").map((entry) => entry.name),
    ["lint", "e2e", "live"],
  );
  assert.deepEqual(
    selectGates(config, "docs", "fast").map((entry) => entry.name),
    ["docs"],
  );
  assert.deepEqual(
    selectGates(config, "mixed", "fast").map((entry) => entry.name),
    ["lint", "docs"],
  );
  assert.deepEqual(
    selectGates(config, "mixed", "full").map((entry) => entry.name),
    ["lint", "e2e", "docs"],
  );
});

test("gateSetHash changes when a command changes", () => {
  const one = [gate({ name: "lint", command: "npm run lint" })];
  const two = [gate({ name: "lint", command: "npm run lint:strict" })];
  assert.notEqual(gateSetHash(one), gateSetHash(two));
});

test("runGates passes and writes a log", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const result = runGates(
    [
      gate({ name: "one" }),
      gate({ name: "two" }),
    ],
    { cwd: dir, logDir: join(dir, "logs") },
  );

  assert.equal(result.result, "pass");
  assert.equal(result.results.length, 2);
  assert.ok(existsSync(join(dir, "logs", "one.log")));
});

test("a required failure stops the run", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const result = runGates(
    [
      gate({ name: "bad", command: 'node -e "process.exit(1)"' }),
      gate({ name: "never" }),
    ],
    { cwd: dir, logDir: join(dir, "logs") },
  );

  assert.equal(result.result, "fail");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].exitCode, 1);
});

test("an optional failure is recorded but does not fail the run", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const result = runGates(
    [
      gate({
        name: "optional",
        command: 'node -e "process.exit(1)"',
        required: false,
      }),
    ],
    { cwd: dir, logDir: join(dir, "logs") },
  );

  assert.equal(result.result, "pass");
  assert.equal(result.results[0].exitCode, 1);
});

test("a timeout is recorded as a failure", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const result = runGates(
    [
      gate({
        name: "slow",
        command: 'node -e "setTimeout(()=>{}, 1500)"',
        timeoutSec: 0.1,
      }),
    ],
    { cwd: dir, logDir: join(dir, "logs") },
  );

  assert.equal(result.result, "fail");
  assert.equal(result.results[0].timedOut, true);
  assert.equal(result.results[0].exitCode, -1);
});

test("a flaky gate passes on the retry and is marked flaky", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const flag = join(dir, "flag");
  const result = runGates(
    [
      gate({
        name: "flaky",
        command: `node -e "const fs=require('fs'); if (fs.existsSync(process.env.FLAG)) process.exit(0); fs.writeFileSync(process.env.FLAG,'1'); process.exit(1)"`,
      }),
    ],
    {
      cwd: dir,
      logDir: join(dir, "logs"),
      retryFlaky: true,
      maxRetries: 1,
      env: { ...process.env, FLAG: flag },
    },
  );

  assert.equal(result.result, "pass");
  assert.equal(result.results[0].flaky, true);
  assert.equal(result.results[0].attempt, 2);
});
