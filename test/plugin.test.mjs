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
import { cleanup, tempRepo } from "./helpers.mjs";

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
  // Claude Code auto-loads hooks/hooks.json; declaring it again makes the
  // whole plugin fail to load.
  assert.equal("hooks" in manifest, false);
  assert.ok(existsSync(join(root, "hooks/hooks.json")));
  assert.ok(existsSync(join(root, "skills/codeflow/SKILL.md")));
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

test("every command has a description, a plugin-root grant, and a CLI call", () => {
  const commands = readdirSync(join(root, "commands")).filter((name) =>
    name.endsWith(".md"),
  );
  assert.ok(commands.length >= 15);
  for (const name of commands) {
    const text = readFileSync(join(root, "commands", name), "utf8");
    const fm = frontmatter(text);
    assert.match(fm, /^description:/m, `${name} has no description`);
    // Claude Code does not put the plugin's bin/ on PATH, so the grant and the
    // call both have to name the plugin root; the variable is substituted in
    // frontmatter and body alike (verified on 2.1.278).
    assert.match(
      fm,
      /allowed-tools:.*Bash\(\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/codeflow:\*\)/,
      `${name} does not grant the plugin-root CLI`,
    );
    assert.match(
      text,
      /"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/codeflow" /,
      `${name} never calls the CLI by its plugin-root path`,
    );
    assert.doesNotMatch(
      text,
      /`codeflow\s/,
      `${name} still invokes a bare codeflow`,
    );
    assert.doesNotMatch(
      text,
      /gh pr merge/,
      `${name} must not instruct a merge`,
    );
  }
});

test("the skill carries the human boundary and red lines", () => {
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

  const hookFile = join(root, "hooks/session-start.mjs");
  if (process.platform === "win32") {
    // Windows has no executable bit; the shebang is what makes the file runnable
    // through the hook's bash invocation.
    assert.match(readFileSync(hookFile, "utf8"), /^#!.*node/);
  } else {
    assert.ok(
      statSync(hookFile).mode & 0o111,
      "session-start.mjs must be executable",
    );
  }

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
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("the session hook stays silent in a repo with no active task", (t) => {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const init = spawnSync(
    process.execPath,
    [join(root, "bin/codeflow"), "init", "--json"],
    { cwd: dir, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const result = spawnSync(
    process.execPath,
    [join(root, "hooks/session-start.mjs")],
    { cwd: dir, encoding: "utf8", timeout: 5000, env },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("the CLI executable is runnable", () => {
  const file = join(root, "bin/codeflow");
  if (process.platform === "win32") {
    assert.match(readFileSync(file, "utf8"), /^#!.*node/);
  } else {
    assert.ok(statSync(file).mode & 0o111, "bin/codeflow must be executable");
  }
  const result = spawnSync(process.execPath, [file, "--version"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^codeflow 0\.1\.0/);
});

test("user-facing docs do not use internal workflow labels", () => {
  const files = [
    "README.md",
    "README.zh-CN.md",
    "package.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "skills/codeflow/SKILL.md",
    ...readdirSync(join(root, "commands")).map((name) => `commands/${name}`),
    ...readdirSync(join(root, "docs"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name}`),
    "docs/superpowers/plans/2026-10-26-codeflow-core.md",
    "docs/superpowers/plans/2026-10-27-trust-and-plan.md",
  ];

  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(
      text,
      /\bL[123]\b/,
      `${file} must not use internal workflow labels`,
    );
  }
});
