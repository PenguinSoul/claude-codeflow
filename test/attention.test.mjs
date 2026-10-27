import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  failedAttention,
  hasAttention,
  inferKind,
  scanAttention,
} from "../src/attention.mjs";
import { defaultConfig } from "../src/config.mjs";
import { findRepo } from "../src/repo.mjs";
import { cleanup, git, tempRepo } from "./helpers.mjs";

test("inferKind classifies docs, tests, infra, and mixed", () => {
  assert.equal(inferKind(["README.md"]), "docs");
  assert.equal(inferKind(["docs/guide.md"]), "docs");
  assert.equal(inferKind(["src/a.test.ts"]), "test");
  assert.equal(inferKind([".github/workflows/ci.yml"]), "infra");
  assert.equal(inferKind(["package-lock.json"]), "infra");
  assert.equal(inferKind(["src/a.ts"]), "code");
  assert.equal(inferKind(["README.md", "src/a.ts"]), "mixed");
  assert.equal(inferKind([]), "code");
});

test("scanAttention finds test changes, skips, suppressions, config, and lockfiles", (t) => {
  const dir = tempRepo({
    files: {
      "src/auth.ts": "export const a = 1;\n",
      "src/auth.test.ts": "it('a', () => {});\n",
    },
  });
  t.after(() => cleanup(dir));

  writeFileSync(join(dir, "src/auth.test.ts"), "it.skip('a', () => {});\n");
  writeFileSync(join(dir, "src/auth.ts"), "// @ts-ignore\nexport const a = 2;\n");
  mkdirSync(join(dir, ".codeflow"), { recursive: true });
  writeFileSync(join(dir, ".codeflow/config.json"), "{}\n");
  writeFileSync(join(dir, "package-lock.json"), "{}\n");
  git(dir, ["add", "-A"]);

  const config = defaultConfig(findRepo(dir));
  config.attention.largeDiffFiles = 0;
  config.attention.largeDiffLines = 0;
  const attention = scanAttention(dir, "main", config);

  assert.ok(
    attention.testFiles.some((entry) => entry.path === "src/auth.test.ts"),
  );
  assert.equal(attention.skips.length, 1);
  assert.match(attention.skips[0].pattern, /it\.skip/);
  assert.equal(attention.suppressions.length, 1);
  assert.match(attention.suppressions[0].pattern, /@ts-ignore/);
  assert.ok(attention.configChanges.includes(".codeflow/config.json"));
  assert.ok(attention.lockfileChanges.includes("package-lock.json"));

  assert.equal(hasAttention(attention, "suppression"), true);
  assert.deepEqual(
    failedAttention(attention, ["suppression", "large-diff"]),
    ["suppression", "large-diff"],
  );
});
