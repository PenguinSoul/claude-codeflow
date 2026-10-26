import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig, loadConfig } from "../src/config.mjs";
import { findRepo } from "../src/repo.mjs";
import { statePaths } from "../src/state.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

test("an unsupported config schema is rejected", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const config = defaultConfig(findRepo(dir));
  config.schemaVersion = 99;
  mkdirSync(join(dir, ".codeflow"), { recursive: true });
  writeFileSync(join(dir, ".codeflow/config.json"), JSON.stringify(config));
  assert.throws(
    () => loadConfig(dir),
    (error) => error.code === "E_CONFIG",
  );
});

test("a stateDir that escapes the repository is rejected", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const config = defaultConfig(findRepo(dir));
  config.stateDir = "../escape";
  assert.throws(
    () => statePaths(dir, config),
    (error) => error.code === "E_CONFIG",
  );
});

test("the implementation contains no merge command", () => {
  const files = [
    ...readdirSync(join("src")).map((name) => join("src", name)),
    ...readdirSync(join("commands")).map((name) => join("commands", name)),
  ].filter((file) => file.endsWith(".mjs") || file.endsWith(".md"));

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /gh\s+pr\s+merge/,
      `${file} must not contain a merge command`,
    );
  }
});
