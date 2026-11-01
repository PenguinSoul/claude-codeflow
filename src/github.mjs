import { CodedError, ERROR_CODES } from "./contracts.mjs";
import { runFile, which } from "./util.mjs";

function ghBin(env = process.env) {
  return which("gh", env) ?? "gh";
}

function gh(args, options = {}) {
  const {
    cwd,
    env = process.env,
    allowFail = false,
  } = options;
  const result = runFile(ghBin(env), args, {
    cwd,
    env,
    timeout: 120000,
  });
  if (!result.ok) {
    if (result.error?.code === "ENOENT") {
      throw new CodedError(
        ERROR_CODES.GH_MISSING,
        "gh is not installed",
        { command: "gh" },
        "Install GitHub CLI, or use the compare-URL fallback.",
      );
    }
    if (allowFail) {
      return null;
    }
    throw new CodedError(
      ERROR_CODES.GH_AUTH,
      `gh ${args.slice(0, 2).join(" ")} failed`,
      { stderr: result.stderr.trim(), exitCode: result.status },
      "Run `gh auth status` and authenticate.",
    );
  }
  return result.stdout.trim();
}

export function hasGh(env = process.env) {
  const result = runFile(ghBin(env), ["--version"], { env });
  return result.ok;
}

export function ghAuthStatus(env = process.env) {
  const result = runFile(ghBin(env), ["auth", "status"], { env, timeout: 15000 });
  return {
    ok: result.ok,
    detail: result.ok
      ? "authenticated"
      : result.stderr.trim().split(/\r?\n/).filter(Boolean)[0] ??
        "not authenticated",
  };
}

export function findOpenPr(cwd, branch, env = process.env) {
  const output = gh(
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,url,title,state,headRefOid",
    ],
    { cwd, env },
  );
  const list = output ? JSON.parse(output) : [];
  if (list.length > 1) {
    throw new CodedError(
      ERROR_CODES.PR_EXISTS,
      "more than one open PR uses this branch",
      { branch, count: list.length },
      "Close the duplicate PRs, then retry.",
    );
  }
  return list[0] ?? null;
}

export function normalizeChecks(rollup) {
  const checks = { total: 0, passed: 0, failed: 0, pending: 0, skipped: 0 };
  for (const item of rollup ?? []) {
    checks.total += 1;
    const conclusion = String(item.conclusion ?? "").toUpperCase();
    const status = String(item.status ?? "").toUpperCase();
    if (
      [
        "FAILURE",
        "CANCELLED",
        "TIMED_OUT",
        "ACTION_REQUIRED",
        "STARTUP_FAILURE",
      ].includes(conclusion)
    ) {
      checks.failed += 1;
    } else if (["SKIPPED", "NEUTRAL"].includes(conclusion)) {
      checks.skipped += 1;
    } else if (conclusion === "SUCCESS") {
      checks.passed += 1;
    } else {
      checks.pending += 1;
    }
  }
  checks.state =
    checks.total === 0
      ? "none"
      : checks.failed > 0
        ? "failure"
        : checks.pending > 0
          ? "pending"
          : checks.passed === 0 && checks.skipped > 0
            ? "skipped"
            : "success";
  return checks;
}

export function prView(cwd, target, env = process.env) {
  const output = gh(
    [
      "pr",
      "view",
      String(target),
      "--json",
      "number,url,state,headRefOid,statusCheckRollup,mergeStateStatus,reviewDecision",
    ],
    { cwd, env },
  );
  const value = JSON.parse(output);
  return {
    number: value.number,
    url: value.url,
    state: value.state,
    headSha: value.headRefOid,
    checks: normalizeChecks(value.statusCheckRollup),
    mergeStateStatus: value.mergeStateStatus ?? null,
    reviewDecision: value.reviewDecision ?? null,
  };
}

export function createOrUpdatePr(options) {
  const {
    cwd,
    base,
    branch,
    title,
    bodyPath,
    env = process.env,
  } = options;

  const existing = findOpenPr(cwd, branch, env);
  if (existing) {
    gh(["pr", "edit", String(existing.number), "--title", title, "--body-file", bodyPath], {
      cwd,
      env,
    });
    return { ...prView(cwd, existing.number, env), updated: true };
  }

  const output = gh(
    [
      "pr",
      "create",
      "--base",
      base,
      "--head",
      branch,
      "--title",
      title,
      "--body-file",
      bodyPath,
    ],
    { cwd, env },
  );
  const url = output.split(/\s+/).find((part) => part.startsWith("http")) ?? output;
  return { ...prView(cwd, url, env), updated: false };
}

export function readChecks(cwd, number, env = process.env) {
  return prView(cwd, number, env).checks;
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 100) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}`;

export function readComments(cwd, number, env = process.env) {
  const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    cwd,
    env,
  });
  const [owner, name] = repo.split("/");
  const threadsRaw = gh(
    [
      "api",
      "graphql",
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ],
    { cwd, env, allowFail: true },
  );

  let threads = [];
  let resolutionAvailable = false;
  if (threadsRaw) {
    try {
      const nodes =
        JSON.parse(threadsRaw)?.data?.repository?.pullRequest?.reviewThreads
          ?.nodes;
      if (Array.isArray(nodes)) {
        resolutionAvailable = true;
        threads = nodes.map((thread) => ({
          id: thread.id ?? null,
          isResolved: Boolean(thread.isResolved),
          isOutdated: Boolean(thread.isOutdated),
          path: thread.path ?? null,
          line: thread.line ?? null,
          comments: (thread.comments?.nodes ?? []).map((comment) => ({
            author: comment.author?.login ?? "unknown",
            body: comment.body ?? "",
            createdAt: comment.createdAt ?? null,
          })),
        }));
      }
    } catch {
      resolutionAvailable = false;
    }
  }

  const commentsRaw = gh(
    ["api", `repos/${repo}/pulls/${number}/comments`, "--paginate"],
    { cwd, env },
  );
  const reviewsRaw = gh(
    ["api", `repos/${repo}/pulls/${number}/reviews`, "--paginate"],
    { cwd, env },
  );
  const comments = (commentsRaw ? JSON.parse(commentsRaw) : []).map((comment) => ({
    id: comment.id,
    author: comment.user?.login ?? "unknown",
    body: comment.body ?? "",
    path: comment.path ?? null,
    line: comment.line ?? null,
    createdAt: comment.created_at ?? null,
  }));
  const reviews = (reviewsRaw ? JSON.parse(reviewsRaw) : []).map((review) => ({
    id: review.id,
    author: review.user?.login ?? "unknown",
    body: review.body ?? "",
    state: review.state ?? null,
    submittedAt: review.submitted_at ?? null,
  }));
  const resolved = resolutionAvailable
    ? threads.filter((thread) => thread.isResolved).length
    : null;
  return {
    repo,
    threads,
    resolutionAvailable,
    resolved,
    unresolved:
      resolutionAvailable && resolved !== null
        ? threads.length - resolved
        : null,
    comments,
    reviews,
  };
}

export function compareUrl(remoteUrl, base, branch) {
  if (!remoteUrl) {
    return null;
  }
  let url = remoteUrl.trim().replace(/\.git$/, "");
  if (url.startsWith("git@github.com:")) {
    url = `https://github.com/${url.slice("git@github.com:".length)}`;
  }
  if (!url.startsWith("https://github.com/")) {
    return null;
  }
  return `${url}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`;
}
