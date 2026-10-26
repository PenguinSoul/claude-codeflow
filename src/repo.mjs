import path from "node:path";
import { CodedError, ERROR_CODES } from "./contracts.mjs";
import { git, gitOrNull, isGitRepo } from "./git.mjs";
import { ensureDir, fileExists, readText, writeTextAtomic } from "./util.mjs";

function absolute(base, value) {
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

export function findRepo(cwd) {
  if (!isGitRepo(cwd)) {
    throw new CodedError(
      ERROR_CODES.NOT_REPO,
      "not inside a git repository",
      null,
      "Run codeflow from a git working tree.",
    );
  }

  const root = git(["rev-parse", "--show-toplevel"], { cwd });
  const gitDir = absolute(cwd, git(["rev-parse", "--git-dir"], { cwd }));
  const commonDir = absolute(cwd, git(["rev-parse", "--git-common-dir"], { cwd }));

  const remotes = git(["remote"], { cwd })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : (remotes[0] ?? null);

  let baseBranch = null;
  if (remote) {
    const head = gitOrNull(
      ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`],
      { cwd },
    );
    if (head) {
      baseBranch = head.startsWith(`${remote}/`)
        ? head.slice(remote.length + 1)
        : head;
    }
  }
  if (!baseBranch) {
    baseBranch = gitOrNull(["branch", "--show-current"], { cwd });
  }
  if (!baseBranch) {
    for (const candidate of ["main", "master"]) {
      if (gitOrNull(["rev-parse", "--verify", `${candidate}^{commit}`], { cwd })) {
        baseBranch = candidate;
        break;
      }
    }
  }

  return {
    root,
    gitDir,
    commonDir,
    excludePath: path.join(commonDir, "info", "exclude"),
    baseBranch: baseBranch ?? "main",
    remote,
  };
}

export function ensureExcluded(repo, pattern = ".codeflow/state/") {
  const file = repo.excludePath;
  const current = fileExists(file) ? readText(file) : "";
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(pattern)) {
    return false;
  }
  ensureDir(path.dirname(file));
  const prefix =
    current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  writeTextAtomic(file, `${prefix}${pattern}\n`);
  return true;
}

export function repoRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}
