import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function tempDir(prefix = "codeflow-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

export function tempRepo(options = {}) {
  const {
    remotes = { origin: "git@example.com:org/repo.git" },
    files = {},
    packageJson = null,
    pyproject = null,
    lockfile = null,
  } = options;

  const dir = tempDir();
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Test User"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  for (const [name, url] of Object.entries(remotes)) {
    git(dir, ["remote", "add", name, url]);
  }

  const all = { "README.md": "# temp\n", ...files };
  if (packageJson) {
    all["package.json"] = `${JSON.stringify(packageJson, null, 2)}\n`;
  }
  if (pyproject) {
    all["pyproject.toml"] = pyproject;
  }
  if (lockfile) {
    all[lockfile] = "";
  }
  for (const [name, content] of Object.entries(all)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

export function capture() {
  const chunks = [];
  return {
    stream: {
      write(value) {
        chunks.push(String(value));
      },
    },
    text() {
      return chunks.join("");
    },
  };
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function rollupFor(state) {
  if (state === "PENDING") {
    return '{"status":"IN_PROGRESS","conclusion":null}';
  }
  if (state === "FAILURE") {
    return '{"conclusion":"FAILURE"}';
  }
  if (state === "SKIPPED") {
    return '{"conclusion":"SKIPPED"}';
  }
  return '{"conclusion":"SUCCESS"}';
}

export function fakeGhEnv(t, options = {}) {
  const {
    prState = "OPEN",
    checks = ["SUCCESS", "PENDING"],
  } = options;
  const sequence = checks.length > 0 ? checks : ["SUCCESS"];
  const cases = sequence
    .map(
      (state, index) => `    ${index + 1}) rollup='${rollupFor(state)}' ;;`,
    )
    .join("\n");
  const fallback = rollupFor(sequence.at(-1));

  const bin = mkdtempSync(join(tmpdir(), "codeflow-gh-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const script = join(bin, "gh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash
set -e
if [ "$1" = "--version" ]; then echo "gh version 2.103.2"; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '[]'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/7"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  counter="$(dirname "$0")/view-count"
  n=0
  if [ -f "$counter" ]; then n=$(cat "$counter"); fi
  n=$((n + 1))
  echo "$n" > "$counter"
  case "$n" in
${cases}
    *) rollup='${fallback}' ;;
  esac
  echo "{\\"number\\":7,\\"url\\":\\"https://github.com/o/r/pull/7\\",\\"state\\":\\"${prState}\\",\\"headRefOid\\":\\"abc\\",\\"statusCheckRollup\\":[$rollup],\\"mergeStateStatus\\":\\"BLOCKED\\",\\"reviewDecision\\":\\"\\"}"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo "o/r"; exit 0; fi
if [ "$1" = "api" ]; then echo '[]'; exit 0; fi
echo "unexpected: $*" >&2
exit 1
`,
  );
  chmodSync(script, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

