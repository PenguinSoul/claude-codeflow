import { spawnSync } from "node:child_process";
import { CodedError, ERROR_CODES } from "./contracts.mjs";

export function git(args, options = {}) {
  const {
    cwd,
    allowFail = false,
    timeout = 30000,
    env = process.env,
  } = options;
  const result = spawnSync("git", args, {
    cwd,
    timeout,
    encoding: "utf8",
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    if (allowFail) {
      return null;
    }
    throw new CodedError(
      ERROR_CODES.INTERNAL,
      `git ${args.join(" ")} could not run: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    if (allowFail) {
      return null;
    }
    throw new CodedError(
      ERROR_CODES.NOT_REPO,
      `git ${args.join(" ")} failed`,
      { status: result.status, stderr: result.stderr.trim() },
    );
  }
  return result.stdout.trim();
}

export function gitOrNull(args, options = {}) {
  return git(args, { ...options, allowFail: true });
}

export function isGitRepo(cwd) {
  return gitOrNull(["rev-parse", "--is-inside-work-tree"], { cwd }) === "true";
}

export function gitVersion() {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}
