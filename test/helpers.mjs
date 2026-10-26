import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    writeFileSync(join(dir, name), content);
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
