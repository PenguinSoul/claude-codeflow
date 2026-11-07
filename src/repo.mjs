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

  const root = path.resolve(git(["rev-parse", "--show-toplevel"], { cwd }));
  const gitDir = absolute(cwd, git(["rev-parse", "--git-dir"], { cwd }));
  const commonDir = absolute(cwd, git(["rev-parse", "--git-common-dir"], { cwd }));

  let mainRoot = root;
  const worktrees = gitOrNull(["worktree", "list", "--porcelain"], { cwd });
  if (worktrees) {
    const first = worktrees
      .split(/\r?\n/)
      .find((line) => line.startsWith("worktree "));
    if (first) {
      mainRoot = path.resolve(first.slice("worktree ".length));
    }
  }

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
    // Inside a task worktree the current branch is the task branch, not the
    // base. The main worktree is the stable place to read the fallback from.
    baseBranch = gitOrNull(["branch", "--show-current"], { cwd: mainRoot });
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
    mainRoot,
    gitDir,
    commonDir,
    excludePath: path.join(commonDir, "info", "exclude"),
    baseBranch: baseBranch ?? "main",
    remote,
  };
}

export function trackedState(repo, stateDir = ".codeflow/state") {
  const value = gitOrNull(["ls-files", "--", stateDir], { cwd: repo.mainRoot });
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

export function assertStateNotTracked(repo, stateDir = ".codeflow/state") {
  const files = trackedState(repo, stateDir);
  if (files.length > 0) {
    throw new CodedError(
      ERROR_CODES.STATE_TRACKED,
      "codeflow state is tracked by git and cannot be trusted",
      { files },
      "Remove the tracked state files, keep `.codeflow/state/` out of commits, then retry.",
    );
  }
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
