import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : "";
}

test("plugin manifest points at the real components", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"),
  );
  assert.equal(manifest.name, "codeflow");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.commands, "./commands/");
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  assert.ok(existsSync(join(root, "skills/codeflow/SKILL.md")));
  assert.ok(existsSync(join(root, "hooks/hooks.json")));
  assert.ok(existsSync(join(root, "hooks/session-start.mjs")));
  assert.ok(existsSync(join(root, "bin/codeflow")));
});

test("the marketplace manifest and icon are present", () => {
  const marketplace = JSON.parse(
    readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"),
  );
  assert.equal(marketplace.name, "codeflow");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "codeflow");

  const icon = readFileSync(join(root, ".claude-plugin/icon.png"));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
});

test("every command has a description, a codeflow tool grant, and a CLI call", () => {
  const commands = readdirSync(join(root, "commands")).filter((name) =>
    name.endsWith(".md"),
  );
  assert.ok(commands.length >= 15);
  for (const name of commands) {
    const text = readFileSync(join(root, "commands", name), "utf8");
    const fm = frontmatter(text);
    assert.match(fm, /^description:/m, `${name} has no description`);
    assert.match(
      fm,
      /allowed-tools:.*Bash\(codeflow:\*\)/,
      `${name} does not grant codeflow`,
    );
    assert.match(text, /codeflow /, `${name} never calls the CLI`);
    assert.doesNotMatch(
      text,
      /gh pr merge/,
      `${name} must not instruct a merge`,
    );
  }
});

test("the skill carries the L1 boundary and red lines", () => {
  const skill = readFileSync(join(root, "skills/codeflow/SKILL.md"), "utf8");
  const fm = frontmatter(skill);
  assert.match(fm, /^name: codeflow$/m);
  assert.match(fm, /^description:/m);
  assert.match(skill, /Hydrate then act/);
  assert.match(skill, /Never merge/);
  assert.match(skill, /Never approve on your own/);
  assert.match(skill, /Never fabricate evidence/);
  assert.match(skill, /Never weaken a gate/);
  assert.match(skill, /Never touch the base branch/);
});

test("the session hook is registered, executable, and non-fatal outside a repo", () => {
  const hooks = JSON.parse(readFileSync(join(root, "hooks/hooks.json"), "utf8"));
  assert.ok(Array.isArray(hooks.hooks.SessionStart));
  const command = hooks.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /session-start\.mjs/);

  const mode = statSync(join(root, "hooks/session-start.mjs")).mode;
  assert.ok(mode & 0o111, "session-start.mjs must be executable");

  const result = spawnSync(
    process.execPath,
    [join(root, "hooks/session-start.mjs")],
    {
      cwd: tmpdir(),
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("the CLI executable is runnable", () => {
  const file = join(root, "bin/codeflow");
  const mode = statSync(file).mode;
  assert.ok(mode & 0o111, "bin/codeflow must be executable");
  const result = spawnSync(process.execPath, [file, "--version"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^codeflow 0\.1\.0/);
});
