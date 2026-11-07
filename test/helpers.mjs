import { execFileSync } from "node:child_process";
import {
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

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function removeDir(dir) {
  // Windows keeps a directory busy while a timed-out gate's grandchild (the
  // shell started the real command) is still exiting. Retry synchronously
  // instead of trusting fs.rmSync's maxRetries, which does not always fire.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) {
        throw error;
      }
      sleepSync(100);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

export function cleanup(dir) {
  removeDir(dir);
}

function fakeGhSource(options) {
  const {
    prState = "OPEN",
    checks = ["SUCCESS", "PENDING"],
    rollup = null,
    failPrView = false,
    threads = [],
    graphql = true,
  } = options;

  const graph = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: threads.map((thread, index) => ({
              id: thread.id ?? `thread-${index + 1}`,
              isResolved: Boolean(thread.resolved),
              isOutdated: Boolean(thread.outdated),
              path: thread.path ?? null,
              line: thread.line ?? null,
              comments: {
                nodes: (thread.comments ?? []).map((comment) => ({
                  author: { login: comment.author ?? "reviewer" },
                  body: comment.body ?? "",
                  createdAt: comment.createdAt ?? null,
                })),
              },
            })),
          },
        },
      },
    },
  };
  const sequence = checks.length > 0 ? checks : ["SUCCESS"];

  return `import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const sequence = ${JSON.stringify(sequence)};
const staticRollup = ${JSON.stringify(rollup)};
const prState = ${JSON.stringify(prState)};
const failPrView = ${JSON.stringify(failPrView)};
const graphql = ${JSON.stringify(graphql)};
const graph = ${JSON.stringify(graph)};

function rollupFor(state) {
  if (state === "PENDING") {
    return { status: "IN_PROGRESS", conclusion: null };
  }
  if (state === "FAILURE") {
    return { conclusion: "FAILURE" };
  }
  if (state === "SKIPPED") {
    return { conclusion: "SKIPPED" };
  }
  return { conclusion: "SUCCESS" };
}

function write(value) {
  process.stdout.write(String(value) + "\\n");
}

function head() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "abc";
  }
}

if (args[0] === "--version") {
  write("gh version 2.103.2");
  process.exit(0);
}
if (args[0] === "auth") {
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "list") {
  write("[]");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") {
  write("https://github.com/o/r/pull/7");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "edit") {
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "view") {
  if (failPrView) {
    process.stderr.write("gh: authentication failed\\n");
    process.exit(1);
  }
  const counter = join(here, "view-count");
  let n = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
  n += 1;
  writeFileSync(counter, String(n));
  const states = staticRollup ?? [
    sequence[Math.min(n - 1, sequence.length - 1)] ??
      sequence[sequence.length - 1],
  ];
  write(
    JSON.stringify({
      number: 7,
      url: "https://github.com/o/r/pull/7",
      state: prState,
      headRefOid: head(),
      statusCheckRollup: states.map(rollupFor),
      mergeStateStatus: "BLOCKED",
      reviewDecision: "",
    }),
  );
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "view") {
  write("o/r");
  process.exit(0);
}
if (args[0] === "api" && args[1] === "graphql") {
  write(graphql ? JSON.stringify(graph) : "[]");
  process.exit(0);
}
if (args[0] === "api") {
  write("[]");
  process.exit(0);
}
process.stderr.write("unexpected: " + args.join(" ") + "\\n");
process.exit(1);
`;
}

export function fakeGhEnv(t, options = {}) {
  const bin = mkdtempSync(join(tmpdir(), "codeflow-gh-"));
  t.after(() => removeDir(bin));
  const script = join(bin, "gh.mjs");
  writeFileSync(script, fakeGhSource(options));
  return {
    ...process.env,
    CODEFLOW_GH_BIN: process.execPath,
    CODEFLOW_GH_SCRIPT: script,
  };
}
