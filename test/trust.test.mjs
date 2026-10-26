import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.mjs";
import { findRepo } from "../src/repo.mjs";
import { ensureState, readTrust, statePaths } from "../src/state.mjs";
import { assertTrusted, commandsFor, trustConfig } from "../src/trust.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

function setup(t) {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const repo = findRepo(dir);
  const config = defaultConfig(repo);
  config.gates = [
    {
      name: "test",
      command: "node -e \"process.exit(0)\"",
      cwd: ".",
      tier: "fast",
      kinds: ["code"],
      required: true,
      timeoutSec: 30,
    },
  ];
  const paths = statePaths(dir, config);
  ensureState(paths);
  return { dir, config, paths };
}

test("trust is required before assertTrusted succeeds", (t) => {
  const { config, paths } = setup(t);

  assert.throws(
    () => assertTrusted(paths, config),
    (error) => error.code === "E_TRUST_REQUIRED",
  );
});

test("trust records the config hash and commands", (t) => {
  const { config, paths } = setup(t);
  const trust = trustConfig(paths, config, "Test <t@t>");

  assert.equal(trust.configHash, readTrust(paths).configHash);
  assert.deepEqual(trust.commands, commandsFor(config));
  assert.equal(trust.commands[0].name, "test");
  assert.equal(assertTrusted(paths, config).approvedBy, "Test <t@t>");
});

test("changing the config invalidates trust", (t) => {
  const { config, paths } = setup(t);
  trustConfig(paths, config, "Test <t@t>");

  config.gates[0].command = "node -e \"process.exit(1)\"";
  assert.throws(
    () => assertTrusted(paths, config),
    (error) => error.code === "E_TRUST_STALE",
  );
});
