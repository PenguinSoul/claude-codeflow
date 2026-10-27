import path from "node:path";
import {
  CLI_VERSION,
  CodedError,
  ERROR_CODES,
  EXIT,
  exitFor,
  fail,
  ok,
} from "./contracts.mjs";
import {
  configHash,
  configPath,
  detectConfig,
  loadConfig,
  writeConfig,
} from "./config.mjs";
import { runDoctor } from "./doctor.mjs";
import {
  addWorktree,
  git,
  gitOrNull,
  isClean,
  rebaseOntoBase,
  removeWorktree,
} from "./git.mjs";
import { failedAttention, scanAttention } from "./attention.mjs";
import {
  buildEvidence,
  evidenceHash,
  gitTreeHash,
  isDirty,
  isFresh,
  readEvidence,
  writeEvidence,
} from "./evidence.mjs";
import {
  compareUrl,
  createOrUpdatePr,
  hasGh,
  prView,
  readChecks,
  readComments,
} from "./github.mjs";
import { runGates, selectGates } from "./gates.mjs";
import {
  planPath,
  readPlan,
  validatePlan,
  writePlanMarkdown,
  writePlanTemplate,
} from "./plan.mjs";
import { renderPrBody, titleFor } from "./prbody.mjs";
import { render, renderBrief, renderError } from "./render.mjs";
import { ensureExcluded, findRepo, repoRelative } from "./repo.mjs";
import {
  approveSelfReview,
  buildReviewPacket,
  diffHash,
  diffStat,
  readReview,
  selfReviewFresh,
} from "./selfreview.mjs";
import {
  acquireLock,
  ensureState,
  forceUnlock,
  readActive,
  readTask,
  readTrust,
  releaseLock,
  statePaths,
  taskDir,
  taskFile,
  writeTask,
} from "./state.mjs";
import {
  actor,
  appendEvent,
  approvalState,
  approveTask,
  createTask,
  hashFile,
} from "./task.mjs";
import { assertTrusted, commandsFor, trustConfig } from "./trust.mjs";
import {
  fileExists,
  nowIso,
  readJsonSafe,
  readText,
  writeJsonAtomic,
  writeTextAtomic,
} from "./util.mjs";

const HELP = `codeflow ${CLI_VERSION} — L1 workflow executor

Usage:
  codeflow <command> [options]

Commands:
  init       Detect the repository and write .codeflow/config.json
  new        Create a task and a task-spec
  approve    Approve the design or the plan by hash
  plan       Validate and render the task plan
  trust      Review and approve the gate commands
  verify     Run the gates and record evidence
  start      Create the task branch and worktree
  resume     Clear a blocked state and continue
  finish     Remove the worktree after merge
  self-review Build the self-review packet
  pr         Render the PR body and create/update the PR
  watch      Read the PR checks (read-only)
  comments   Read the review comments (read-only)
  status     Show the active task and next step
  doctor     Check the environment and configuration

Options:
  --json       Print the versioned JSON envelope
  --task <id>  Select a task
  --kind <k>   Task kind: code, docs, infra, test, mixed
  --issue <n>  Link an issue (repeatable)
  --by <who>   Approver identity (default: git user)
  --note <s>   Approval note
  --yes        Confirm trust (trust only)
  --tier <t>   Gate tier: fast, full, live (verify only)
  --full       Run fast and full gates (verify only)
  --live       Run fast, full, and live gates (verify only)
  --allow-live Permit live gates (verify only)
  --retry      Retry a failing gate once (verify only)
  --init       Create a starter plan (plan only)
  --confirm    Confirm the merge (finish only)
  --delete-branch Delete the task branch (finish only)
  --force-unlock Remove a stale task lock (start/resume/finish)
  --no-push    Render the PR without pushing (pr only)
  --scope-drift <s> Record scope drift (self-review, repeatable)
  --closest-look <s> Record a closest-look area (self-review, repeatable)
  --wait       Wait for checks (watch only)
  --timeout <s> Wait timeout in seconds (watch only)
  --interval <ms> Poll interval in milliseconds (watch only)
  --brief      One-line status (status only)
  --force      Overwrite config, force cleanup, or force unlock
  --dry-run    Print side effects without applying them
  --help       Show this help
  --version    Show the version
`;

function parseArgs(argv) {
  const flags = {
    json: false,
    help: false,
    version: false,
    brief: false,
    dryRun: false,
    force: false,
    init: false,
    yes: false,
    full: false,
    live: false,
    allowLive: false,
    retry: false,
    confirm: false,
    deleteBranch: false,
    forceUnlock: false,
    noPush: false,
    wait: false,
    timeout: null,
    interval: null,
    scopeDrift: [],
    closestLook: [],
    tier: null,
    task: null,
    kind: null,
    issues: [],
    by: null,
    note: null,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--version" || arg === "-v") {
      flags.version = true;
    } else if (arg === "--brief") {
      flags.brief = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--init") {
      flags.init = true;
    } else if (arg === "--yes") {
      flags.yes = true;
    } else if (arg === "--full") {
      flags.full = true;
    } else if (arg === "--live") {
      flags.live = true;
    } else if (arg === "--allow-live") {
      flags.allowLive = true;
    } else if (arg === "--retry") {
      flags.retry = true;
    } else if (arg === "--confirm") {
      flags.confirm = true;
    } else if (arg === "--delete-branch") {
      flags.deleteBranch = true;
    } else if (arg === "--force-unlock") {
      flags.forceUnlock = true;
    } else if (arg === "--no-push") {
      flags.noPush = true;
    } else if (arg === "--wait") {
      flags.wait = true;
    } else if (arg === "--timeout") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--timeout requires a value");
      }
      flags.timeout = value;
      index += 1;
    } else if (arg.startsWith("--timeout=")) {
      flags.timeout = arg.slice("--timeout=".length);
    } else if (arg === "--interval") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--interval requires a value");
      }
      flags.interval = value;
      index += 1;
    } else if (arg.startsWith("--interval=")) {
      flags.interval = arg.slice("--interval=".length);
    } else if (arg === "--scope-drift") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--scope-drift requires a value");
      }
      flags.scopeDrift.push(value);
      index += 1;
    } else if (arg.startsWith("--scope-drift=")) {
      flags.scopeDrift.push(arg.slice("--scope-drift=".length));
    } else if (arg === "--closest-look") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--closest-look requires a value");
      }
      flags.closestLook.push(value);
      index += 1;
    } else if (arg.startsWith("--closest-look=")) {
      flags.closestLook.push(arg.slice("--closest-look=".length));
    } else if (arg === "--tier") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--tier requires a value");
      }
      flags.tier = value;
      index += 1;
    } else if (arg.startsWith("--tier=")) {
      flags.tier = arg.slice("--tier=".length);
    } else if (arg === "--task") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--task requires a task id");
      }
      flags.task = value;
      index += 1;
    } else if (arg.startsWith("--task=")) {
      flags.task = arg.slice("--task=".length);
    } else if (arg === "--kind") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--kind requires a value");
      }
      flags.kind = value;
      index += 1;
    } else if (arg.startsWith("--kind=")) {
      flags.kind = arg.slice("--kind=".length);
    } else if (arg === "--issue") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--issue requires a value");
      }
      flags.issues.push(value);
      index += 1;
    } else if (arg.startsWith("--issue=")) {
      flags.issues.push(arg.slice("--issue=".length));
    } else if (arg === "--by") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--by requires a value");
      }
      flags.by = value;
      index += 1;
    } else if (arg.startsWith("--by=")) {
      flags.by = arg.slice("--by=".length);
    } else if (arg === "--note") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CodedError(ERROR_CODES.USAGE, "--note requires a value");
      }
      flags.note = value;
      index += 1;
    } else if (arg.startsWith("--note=")) {
      flags.note = arg.slice("--note=".length);
    } else if (arg.startsWith("-")) {
      throw new CodedError(ERROR_CODES.USAGE, `unknown flag "${arg}"`);
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function emit(envelope, flags, out, err) {
  if (flags.json) {
    out.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  if (!envelope.ok) {
    err.write(`${renderError(envelope)}\n`);
    return;
  }
  if (flags.brief && envelope.command === "status") {
    out.write(`${renderBrief(envelope.data)}\n`);
    return;
  }
  out.write(`${render(envelope)}\n`);
}

function initCommand(repo, flags) {
  const file = configPath(repo.root);
  if (fileExists(file) && !flags.force) {
    const config = loadConfig(repo.root);
    const paths = statePaths(repo.root, config);
    ensureState(paths);
    ensureExcluded(repo);
    return {
      data: {
        repoRoot: repo.root,
        baseBranch: config.baseBranch,
        remote: config.remote,
        configPath: repoRelative(repo.root, file),
        excludePath: repoRelative(repo.root, repo.excludePath),
        detected: config.gates.map((gate) => ({
          name: gate.name,
          command: gate.command,
        })),
        trustRequired: true,
      },
      warnings: [
        {
          code: "W_CONFIG_EXISTS",
          message: "config already exists; left unchanged (use --force to rewrite)",
        },
      ],
    };
  }

  const config = detectConfig(repo);
  if (flags.dryRun) {
    return {
      data: {
        repoRoot: repo.root,
        baseBranch: config.baseBranch,
        remote: config.remote,
        configPath: repoRelative(repo.root, file),
        excludePath: repoRelative(repo.root, repo.excludePath),
        detected: config.gates.map((gate) => ({
          name: gate.name,
          command: gate.command,
        })),
        trustRequired: true,
        dryRun: true,
      },
      warnings: [],
    };
  }

  writeConfig(repo.root, config);
  const paths = statePaths(repo.root, config);
  ensureState(paths);
  ensureExcluded(repo);

  const warnings = [];
  if (config.gates.length === 0) {
    warnings.push({
      code: "W_NO_GATES",
      message: "no gates detected; edit .codeflow/config.json before verify",
    });
  }

  return {
    data: {
      repoRoot: repo.root,
      baseBranch: config.baseBranch,
      remote: config.remote,
      configPath: repoRelative(repo.root, file),
      excludePath: repoRelative(repo.root, repo.excludePath),
      detected: config.gates.map((gate) => ({
        name: gate.name,
        command: gate.command,
      })),
      trustRequired: true,
    },
    warnings,
  };
}

function newCommand(repo, config, flags, positional) {
  const title = positional.slice(1).join(" ").trim();
  if (!title) {
    throw new CodedError(
      ERROR_CODES.USAGE,
      "new requires a task title",
      null,
      'Example: codeflow new "Fix the login redirect"',
    );
  }
  const paths = statePaths(repo.root, config);
  const task = createTask(paths, repo, config, {
    title,
    kind: flags.kind ?? "code",
    issues: flags.issues,
  });
  return {
    data: {
      taskId: task.id,
      taskPath: repoRelative(repo.root, taskDir(paths, task.id)),
      taskSpecPath: repoRelative(repo.root, taskFile(paths, task.id, "TASK.md")),
      kind: task.kind,
      next: ["edit TASK.md", "approve design"],
    },
    taskId: task.id,
  };
}

function approveCommand(repo, config, flags, positional) {
  const target = positional[1];
  if (!target) {
    throw new CodedError(
      ERROR_CODES.USAGE,
      "approve requires a target",
      null,
      "Use `codeflow approve design` or `codeflow approve plan`.",
    );
  }
  if (target !== "design" && target !== "plan" && target !== "self-review") {
    throw new CodedError(
      ERROR_CODES.USAGE,
      `unknown approval target "${target}"`,
      null,
      "Use `design`, `plan`, or `self-review`.",
    );
  }

  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }

  const by = flags.by ?? actor(repo);
  if (target === "self-review") {
    const worktree =
      task.worktree && fileExists(task.worktree) ? task.worktree : repo.root;
    const { task: updated, review } = approveSelfReview(paths, task, {
      cwd: worktree,
      base: config.baseBranch,
      by,
      note: flags.note ?? "",
    });
    const approval = updated.approvals.selfReview;
    return {
      data: {
        target,
        hash: approval.hash,
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        notes: review.notes,
      },
      taskId,
    };
  }

  const updated = approveTask(paths, task, target, {
    by,
    note: flags.note ?? "",
  });
  const approval = updated.approvals[target];
  return {
    data: {
      target,
      hash: approval.hash,
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
    },
    taskId,
  };
}

function planCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }

  if (flags.init) {
    const created = writePlanTemplate(paths, task);
    const plan = created ?? readPlan(paths, task.id);
    writePlanMarkdown(paths, task, plan);
    return {
      data: {
        planPath: repoRelative(repo.root, planPath(paths, task.id)),
        steps: plan.steps.length,
        approved: Boolean(task.approvals.plan),
        next: ["edit plan.json", "approve plan"],
      },
      taskId,
      warnings: created
        ? []
        : [
            {
              code: "W_PLAN_EXISTS",
              message: "plan.json already exists; left unchanged",
            },
          ],
    };
  }

  const plan = readPlan(paths, task.id);
  const errors = validatePlan(plan, task);
  if (errors.length > 0) {
    throw new CodedError(
      ERROR_CODES.CONFIG,
      "plan is invalid",
      { errors },
      "Edit plan.json, then run `codeflow plan` again.",
    );
  }
  writePlanMarkdown(paths, task, plan);

  const approval = task.approvals.plan;
  const stale = Boolean(
    approval && hashFile(planPath(paths, task.id)) !== approval.hash,
  );
  return {
    data: {
      planPath: repoRelative(repo.root, planPath(paths, task.id)),
      steps: plan.steps.length,
      approved: Boolean(approval) && !stale,
      next: stale || !approval ? ["approve plan"] : ["start"],
    },
    taskId,
    warnings: stale
      ? [
          {
            code: "W_APPROVAL_STALE",
            message: "plan.json changed since plan approval; approve it again",
          },
        ]
      : [],
  };
}

function trustCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const commands = commandsFor(config);
  if (!flags.yes) {
    return {
      data: {
        configHash: configHash(config),
        commands,
        trusted: false,
        requiresConfirmation: true,
      },
      warnings: [
        {
          code: "W_TRUST_CONFIRM",
          message: "Review the commands, then run `codeflow trust --yes`.",
        },
      ],
    };
  }
  const trust = trustConfig(paths, config, flags.by ?? actor(repo));
  return {
    data: {
      configHash: trust.configHash,
      commands: trust.commands,
      approvedBy: trust.approvedBy,
      approvedAt: trust.approvedAt,
    },
    warnings:
      commands.length === 0
        ? [{ code: "W_NO_GATES", message: "the config has no gates" }]
        : [],
  };
}

function verifyCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }
  if (task.status !== "active" && task.status !== "verified") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task is ${task.status}; verify requires an active or verified task`,
      { status: task.status },
      "Run `codeflow start` first.",
    );
  }

  assertTrusted(paths, config);

  const tier = flags.live ? "live" : flags.full ? "full" : (flags.tier ?? "fast");
  if (!["fast", "full", "live"].includes(tier)) {
    throw new CodedError(
      ERROR_CODES.USAGE,
      `unknown gate tier "${tier}"`,
      null,
      "Use fast, full, or live.",
    );
  }
  if (tier === "live" && !flags.allowLive) {
    throw new CodedError(
      ERROR_CODES.USAGE,
      "live gates are not allowed without --allow-live",
      { tier },
      "Re-run with --allow-live when you intend to spend real tokens.",
    );
  }

  const gates = selectGates(config, task.kind, tier);
  if (gates.length === 0) {
    throw new CodedError(
      ERROR_CODES.CONFIG,
      `no ${tier} gates apply to a ${task.kind} task`,
      { tier, kind: task.kind },
      "Edit .codeflow/config.json or choose a different tier.",
    );
  }

  if (flags.dryRun) {
    return {
      data: {
        tier,
        dryRun: true,
        gates: gates.map((gate) => ({
          name: gate.name,
          command: gate.command,
          tier: gate.tier,
          required: gate.required,
        })),
      },
      taskId,
    };
  }

  const worktree =
    task.worktree && fileExists(task.worktree) ? task.worktree : repo.root;
  const startedAt = nowIso();
  const logDir = path.join(taskDir(paths, task.id), "logs");
  const run = runGates(gates, {
    cwd: worktree,
    logDir,
    retryFlaky: flags.retry || config.verify.retryFlaky,
    maxRetries: config.verify.maxRetries,
  });
  const attention = scanAttention(worktree, config.baseBranch, config);
  const failed = failedAttention(attention, config.attention.failOn);
  const result = run.result === "pass" && failed.length === 0 ? "pass" : "fail";

  const evidence = buildEvidence({
    root: repo.root,
    cwd: worktree,
    task,
    config,
    gates,
    gateResults: run.results,
    attention,
    startedAt,
    finishedAt: nowIso(),
    result,
  });
  writeEvidence(paths, task, evidence);

  const noted = failedAttention(attention, [
    "test",
    "skip",
    "suppression",
    "config",
    "lockfile",
    "large-diff",
  ]);

  let next;
  if (result === "pass") {
    task.status = "verified";
    task.blocked = null;
    next = ["self-review", "pr"];
  } else if (failed.length > 0) {
    task.status = "blocked";
    task.blocked = {
      code: "E_GATE_FAILED",
      reason: `attention: ${failed.join(", ")}`,
      at: nowIso(),
      from: "active",
      hint: "Review the attention items, fix them, then run `codeflow resume`.",
    };
    next = ["resume"];
  } else {
    task.status = "active";
    next = ["fix the failure", "verify"];
  }

  const event = appendEvent(paths, task.id, "verify.finished", actor(repo), {
    result,
    failed,
    tier,
  });
  task.lastEventHash = event.hash;
  writeTask(paths, task);

  return {
    data: {
      result,
      tier,
      gates: run.results.map((gate) => ({
        name: gate.name,
        exitCode: gate.exitCode,
        durationMs: gate.durationMs,
        required: gate.required,
        timedOut: gate.timedOut,
        flaky: gate.flaky,
      })),
      attention,
      evidencePath: repoRelative(
        repo.root,
        taskFile(paths, task.id, "evidence.json"),
      ),
      next,
    },
    taskId,
    warnings:
      noted.length > 0
        ? [
            {
              code: "W_ATTENTION",
              message: `attention items recorded: ${noted.join(", ")}`,
            },
          ]
        : [],
    exitCode: result === "pass" ? EXIT.OK : EXIT.GATE,
  };
}

function startCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }
  if (task.status !== "planned" && task.status !== "active") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task is ${task.status}; start requires a planned task`,
      { status: task.status },
    );
  }

  const approvals = approvalState(paths, task);
  if (!approvals.design || approvals.design.stale) {
    throw new CodedError(
      ERROR_CODES.APPROVAL_STALE,
      "the design is not approved or has changed",
      { approval: approvals.design },
      "Run `codeflow approve design` first.",
    );
  }
  if (!approvals.plan || approvals.plan.stale) {
    throw new CodedError(
      ERROR_CODES.APPROVAL_STALE,
      "the plan is not approved or has changed",
      { approval: approvals.plan },
      "Run `codeflow approve plan` first.",
    );
  }

  if (flags.dryRun) {
    return {
      data: {
        taskId,
        branch: task.branch,
        worktree: task.worktree,
        base: config.baseBranch,
        dryRun: true,
      },
      taskId,
    };
  }

  const wasActive = task.status === "active";
  acquireLock(paths, task.id, {
    command: "start",
    force: flags.forceUnlock,
  });
  try {
    const result = addWorktree(repo.root, {
      worktree: task.worktree,
      branch: task.branch,
      base: config.baseBranch,
    });
    task.status = "active";
    const event = appendEvent(paths, task.id, "task.started", actor(repo), {
      branch: task.branch,
      worktree: task.worktree,
      base: config.baseBranch,
    });
    task.lastEventHash = event.hash;
    writeTask(paths, task);

    const warnings = [];
    if (wasActive) {
      warnings.push({
        code: "W_ALREADY_ACTIVE",
        message: "the task was already active",
      });
    }
    if (!result.created) {
      warnings.push({
        code: "W_WORKTREE_EXISTS",
        message: "the worktree already exists; reused it",
      });
    }

    return {
      data: {
        taskId,
        branch: task.branch,
        worktree: task.worktree,
        baseCommit: gitOrNull(
          ["rev-parse", "--short", config.baseBranch],
          { cwd: repo.root },
        ),
        reused: !result.created,
        reusedBranch: result.reusedBranch,
      },
      taskId,
      warnings,
    };
  } finally {
    releaseLock(paths, task.id);
  }
}

function resumeCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }
  if (task.status !== "blocked") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task is ${task.status}; resume requires a blocked task`,
      { status: task.status },
    );
  }

  const previous = task.blocked?.from ?? "active";
  acquireLock(paths, task.id, {
    command: "resume",
    force: flags.forceUnlock,
  });
  try {
    task.status = previous;
    task.blocked = null;
    const event = appendEvent(paths, task.id, "task.resumed", actor(repo), {
      status: previous,
    });
    task.lastEventHash = event.hash;
    writeTask(paths, task);
    return {
      data: {
        taskId,
        previousStatus: "blocked",
        status: previous,
        next: nextFor(previous),
      },
      taskId,
    };
  } finally {
    releaseLock(paths, task.id);
  }
}

function mergeDetection(repo, task, paths, env) {
  const pr = readJsonSafe(taskFile(paths, task.id, "pr.json"));
  if (!pr || pr.mode !== "gh" || !pr.number) {
    return { available: false, merged: false, reason: "no GitHub PR" };
  }
  if (!hasGh(env)) {
    return { available: false, merged: false, reason: "gh is not installed" };
  }
  try {
    const view = prView(taskWorktree(repo, task), pr.number, env);
    return {
      available: true,
      merged: String(view.state ?? "").toUpperCase() === "MERGED",
      state: view.state,
      pr,
      view,
    };
  } catch (error) {
    return {
      available: false,
      merged: false,
      reason: error.message,
    };
  }
}

function finishCommand(repo, config, flags, env) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }

  const detection =
    task.status === "pr_open"
      ? mergeDetection(repo, task, paths, env)
      : { available: false, merged: false, reason: `task is ${task.status}` };
  const confirmedByStatus = task.status === "merged";
  const confirmedByGh = detection.available && detection.merged;
  const confirmedByHuman = flags.confirm && !detection.available;
  const mergeConfirmed =
    confirmedByStatus || confirmedByGh || confirmedByHuman;
  const mergeConfirmedBy = confirmedByStatus
    ? "status"
    : confirmedByGh
      ? "gh"
      : confirmedByHuman
        ? "confirm"
        : null;

  if (!mergeConfirmed) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      detection.available
        ? `the GitHub PR is ${detection.state ?? "not merged"}; finish requires a merged PR`
        : `task is ${task.status}; finish requires a merged task or --confirm when merge detection is unavailable`,
      detection.available
        ? { status: task.status, prState: detection.state }
        : {
            status: task.status,
            mergeDetection: "unavailable",
            reason: detection.reason,
          },
      detection.available
        ? "Merge the PR first, then run `codeflow finish`."
        : "Merge the PR, then run `codeflow finish --confirm`.",
    );
  }

  if (flags.dryRun) {
    return {
      data: {
        taskId,
        worktree: task.worktree,
        wouldRemove: Boolean(task.worktree && fileExists(task.worktree)),
        mergeConfirmedBy,
        dryRun: true,
      },
      taskId,
    };
  }

  acquireLock(paths, task.id, {
    command: "finish",
    force: flags.forceUnlock,
  });
  try {
    let removedWorktree = false;
    if (task.worktree && fileExists(task.worktree)) {
      if (!isClean(task.worktree) && !flags.force) {
        throw new CodedError(
          ERROR_CODES.DIRTY_TREE,
          "the worktree has uncommitted changes",
          { worktree: task.worktree },
          "Commit or discard them, or pass --force.",
        );
      }
      removeWorktree(repo.root, task.worktree, { force: flags.force });
      removedWorktree = true;
    }

    let deletedBranch = false;
    if (flags.deleteBranch && task.branch) {
      const result = git(["branch", "-D", task.branch], {
        cwd: repo.root,
        allowFail: true,
      });
      deletedBranch = result !== null;
    }

    if (confirmedByGh && detection.pr) {
      writeJsonAtomic(taskFile(paths, task.id, "pr.json"), {
        ...detection.pr,
        state: "merged",
        lastReadAt: nowIso(),
      });
    }

    task.status = "done";
    task.blocked = null;
    const event = appendEvent(paths, task.id, "task.finished", actor(repo), {
      removedWorktree,
      deletedBranch,
      mergeConfirmedBy,
    });
    task.lastEventHash = event.hash;
    writeTask(paths, task);

    return {
      data: {
        taskId,
        removedWorktree,
        deletedBranch,
        mergeConfirmedBy,
        status: "done",
      },
      taskId,
    };
  } finally {
    releaseLock(paths, task.id);
  }
}

function taskWorktree(repo, task) {
  return task.worktree && fileExists(task.worktree) ? task.worktree : repo.root;
}

function selfReviewCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }
  if (task.status !== "verified") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task is ${task.status}; self-review requires a verified task`,
      { status: task.status },
      "Run `codeflow verify` first.",
    );
  }
  const evidence = readEvidence(paths, task.id);
  if (!evidence || evidence.result !== "pass") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "passing evidence was not found",
      { taskId },
      "Run `codeflow verify` first.",
    );
  }

  const worktree = taskWorktree(repo, task);
  const plan = readPlan(paths, task.id);
  const review = buildReviewPacket({
    paths,
    task,
    cwd: worktree,
    base: config.baseBranch,
    plan,
    evidence,
    notes: flags.note ?? "",
    scopeDrift: flags.scopeDrift,
    closestLook: flags.closestLook,
  });

  const counts = {
    testFiles: review ? evidence.attention.testFiles.length : 0,
    skips: evidence.attention.skips.length,
    suppressions: evidence.attention.suppressions.length,
    configChanges: evidence.attention.configChanges.length,
    lockfileChanges: evidence.attention.lockfileChanges.length,
  };
  return {
    data: {
      reviewPath: repoRelative(
        repo.root,
        taskFile(paths, task.id, "REVIEW.md"),
      ),
      diffHash: review.diffHash,
      evidenceHash: review.evidenceHash,
      attention: counts,
      signed: false,
      next: ["approve self-review"],
    },
    taskId,
    warnings:
      counts.skips + counts.suppressions + counts.testFiles > 0
        ? [
            {
              code: "W_ATTENTION",
              message: "attention items are present in the review packet",
            },
          ]
        : [],
  };
}

async function prCommand(repo, config, flags, env) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "no active task",
      null,
      "Run `codeflow new` or pass --task.",
    );
  }
  const task = readTask(paths, taskId);
  if (!task) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task "${taskId}" was not found`,
      { taskId },
    );
  }
  if (task.status !== "verified" && task.status !== "pr_open") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task is ${task.status}; pr requires a verified task`,
      { status: task.status },
      "Run `codeflow verify` and `codeflow approve self-review` first.",
    );
  }

  const approvals = approvalState(paths, task);
  if (!approvals.design || approvals.design.stale) {
    throw new CodedError(
      ERROR_CODES.APPROVAL_STALE,
      "the design is not approved or has changed",
      { approval: approvals.design },
      "Re-approve the design.",
    );
  }
  if (!approvals.plan || approvals.plan.stale) {
    throw new CodedError(
      ERROR_CODES.APPROVAL_STALE,
      "the plan is not approved or has changed",
      { approval: approvals.plan },
      "Re-approve the plan.",
    );
  }

  const worktree = taskWorktree(repo, task);
  if (isDirty(worktree)) {
    throw new CodedError(
      ERROR_CODES.DIRTY_TREE,
      "the worktree has uncommitted changes",
      { worktree },
      "Commit or discard the changes, then retry.",
    );
  }

  const remote = config.remote ?? "origin";
  let rebase = {
    attempted: false,
    rebased: false,
    source: null,
    baseCommit: null,
    conflicts: [],
  };
  if (!flags.noPush && !flags.dryRun) {
    const previousStatus = task.status;
    rebase = {
      attempted: true,
      ...rebaseOntoBase(worktree, remote, config.baseBranch),
    };
    if (!rebase.ok && rebase.reason === "conflict") {
      task.status = "blocked";
      task.blocked = {
        code: ERROR_CODES.REBASE_CONFLICT,
        reason: `rebasing onto ${remote}/${config.baseBranch} produced conflicts`,
        at: nowIso(),
        from: previousStatus,
        hint: "Resolve the conflict manually, then run `codeflow resume`.",
        conflicts: rebase.conflicts,
      };
      const event = appendEvent(paths, task.id, "pr.rebase_conflict", actor(repo), {
        base: `${remote}/${config.baseBranch}`,
        baseCommit: rebase.baseCommit,
        conflicts: rebase.conflicts,
      });
      task.lastEventHash = event.hash;
      writeTask(paths, task);
      throw new CodedError(
        ERROR_CODES.REBASE_CONFLICT,
        `rebase onto ${remote}/${config.baseBranch} produced conflicts`,
        {
          baseCommit: rebase.baseCommit,
          conflicts: rebase.conflicts,
          headBefore: rebase.headBefore,
          headAfter: rebase.headAfter,
          taskStatus: "blocked",
        },
        "Resolve the conflict manually, run `codeflow resume`, then verify again.",
      );
    }
  }

  const evidence = readEvidence(paths, task.id);
  if (!evidence) {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "evidence.json was not found",
      { taskId },
      "Run `codeflow verify` first.",
    );
  }
  const tree = gitTreeHash(worktree);
  const hash = configHash(config);
  if (
    !isFresh(evidence, {
      treeHash: tree,
      configHash: hash,
      gateSetHash: evidence.gateSetHash,
      dirty: false,
    })
  ) {
    throw new CodedError(
      ERROR_CODES.APPROVAL_STALE,
      rebase.rebased
        ? "the branch was rebased and the evidence no longer matches the tree"
        : "the evidence is missing, stale, or the worktree is dirty",
      {
        treeHash: tree,
        evidenceTree: evidence.treeHash,
        dirty: false,
        rebased: rebase.rebased,
        baseCommit: rebase.baseCommit,
      },
      rebase.rebased
        ? "Run `codeflow verify`, `codeflow self-review`, and `codeflow approve self-review`, then retry."
        : "Commit the work, run `codeflow verify`, then retry.",
    );
  }

  const self = selfReviewFresh(paths, task, {
    cwd: worktree,
    base: config.baseBranch,
  });
  if (!self.fresh) {
    throw new CodedError(
      ERROR_CODES.APPROVAL_STALE,
      "the self-review is missing, stale, or unapproved",
      { reason: self.reason },
      "Run `codeflow self-review` and `codeflow approve self-review`.",
    );
  }

  const plan = readPlan(paths, task.id);
  const taskSpec = readText(taskFile(paths, task.id, "TASK.md"));
  const templateFile = path.resolve(repo.root, config.pr.template);
  const template = fileExists(templateFile) ? readText(templateFile) : "";
  const body = renderPrBody({
    template,
    task,
    taskSpec,
    plan,
    evidence,
    config,
    review: self.review,
    diffStatText: diffStat(worktree, config.baseBranch),
  });
  const bodyPath = taskFile(paths, task.id, "PR_BODY.md");
  writeTextAtomic(bodyPath, body);
  const title = titleFor(task, config);
  const mode = hasGh(env) ? "gh" : "compare";

  if (flags.dryRun) {
    return {
      data: {
        mode,
        title,
        bodyPath: repoRelative(repo.root, bodyPath),
        dryRun: true,
      },
      taskId,
    };
  }

  if (!flags.noPush) {
    const pushArgs = ["push", "-u"];
    if (rebase.rebased) {
      pushArgs.push("--force-with-lease");
    }
    pushArgs.push(remote, task.branch);
    const pushed = git(pushArgs, {
      cwd: worktree,
      allowFail: true,
    });
    if (pushed === null) {
      throw new CodedError(
        ERROR_CODES.PUSH_FAILED,
        "the task branch could not be pushed",
        { remote, branch: task.branch, rebased: rebase.rebased },
        rebase.rebased
          ? "The rebase rewrote the branch and the lease failed. Fetch the remote, confirm nobody else updated the branch, then retry."
          : "Check the remote and your credentials, then retry.",
      );
    }
  }

  let pr;
  if (mode === "gh") {
    const created = createOrUpdatePr({
      cwd: worktree,
      base: config.baseBranch,
      branch: task.branch,
      title,
      bodyPath,
      env,
    });
    pr = {
      schemaVersion: 1,
      taskId: task.id,
      mode: "gh",
      number: created.number,
      url: created.url,
      state: String(created.state ?? "OPEN").toLowerCase(),
      title,
      bodyPath: repoRelative(repo.root, bodyPath),
      headSha: created.headSha ?? gitOrNull(["rev-parse", "--short", "HEAD"], { cwd: worktree }),
      baseBranch: config.baseBranch,
      compareUrl: null,
      createdAt: nowIso(),
      lastReadAt: nowIso(),
      checks: created.checks,
    };
  } else {
    const remoteUrl = gitOrNull(["remote", "get-url", config.remote ?? "origin"], {
      cwd: repo.root,
    });
    pr = {
      schemaVersion: 1,
      taskId: task.id,
      mode: "compare",
      number: null,
      url: null,
      state: "open",
      title,
      bodyPath: repoRelative(repo.root, bodyPath),
      headSha: gitOrNull(["rev-parse", "--short", "HEAD"], { cwd: worktree }),
      baseBranch: config.baseBranch,
      compareUrl: compareUrl(remoteUrl, config.baseBranch, task.branch),
      createdAt: nowIso(),
      lastReadAt: nowIso(),
      checks: null,
    };
  }

  writeJsonAtomic(taskFile(paths, task.id, "pr.json"), pr);
  task.status = "pr_open";
  task.blocked = null;
  const event = appendEvent(paths, task.id, "pr.created", actor(repo), {
    mode: pr.mode,
    number: pr.number,
    url: pr.url ?? pr.compareUrl,
    rebased: rebase.rebased,
    baseCommit: rebase.baseCommit,
  });
  task.lastEventHash = event.hash;
  writeTask(paths, task);

  const warnings = [];
  if (pr.mode === "compare") {
    warnings.push({
      code: "W_GH_MISSING",
      message: "gh is unavailable; pushed a compare URL instead of a PR",
    });
  }
  if (rebase.attempted && rebase.reason === "no-base") {
    warnings.push({
      code: "W_BASE_MISSING",
      message: `could not resolve ${remote}/${config.baseBranch}; skipped the pre-push rebase`,
    });
  } else if (rebase.attempted && rebase.source === "local") {
    warnings.push({
      code: "W_BASE_LOCAL",
      message: `could not fetch ${remote}/${config.baseBranch}; rebased onto the local ${config.baseBranch}`,
    });
  }
  if (rebase.rebased) {
    warnings.push({
      code: "W_REBASED",
      message: `rebased onto ${remote}/${config.baseBranch} and force-pushed with lease`,
    });
  }

  return {
    data: {
      mode: pr.mode,
      number: pr.number,
      url: pr.url,
      compareUrl: pr.compareUrl,
      bodyPath: pr.bodyPath,
      headSha: pr.headSha,
      checks: pr.checks,
      rebased: rebase.rebased,
      baseCommit: rebase.baseCommit,
    },
    taskId,
    warnings,
  };
}

async function watchCommand(repo, config, flags, env) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(ERROR_CODES.STATE_CONFLICT, "no active task");
  }
  const task = readTask(paths, taskId);
  if (!task || task.status !== "pr_open") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "watch requires an open PR",
      { status: task?.status ?? null },
    );
  }
  const pr = readJsonSafe(taskFile(paths, task.id, "pr.json"));
  if (!pr || pr.mode !== "gh" || !pr.number) {
    throw new CodedError(
      ERROR_CODES.GH_MISSING,
      "no GitHub PR is recorded for this task",
      { mode: pr?.mode ?? null },
      "Use the compare URL printed by `codeflow pr`.",
    );
  }
  const worktree = taskWorktree(repo, task);
  let checks = readChecks(worktree, pr.number, env);
  let waited = false;
  let timedOut = false;
  let polls = 0;
  if (flags.wait) {
    const timeoutValue = Number(
      flags.timeout ?? process.env.CODEFLOW_WATCH_TIMEOUT_SEC ?? 300,
    );
    const intervalValue = Number(
      flags.interval ?? process.env.CODEFLOW_WATCH_INTERVAL_MS ?? 5000,
    );
    if (!Number.isFinite(timeoutValue) || timeoutValue < 0) {
      throw new CodedError(
        ERROR_CODES.USAGE,
        "--timeout must be a non-negative number of seconds",
      );
    }
    if (!Number.isFinite(intervalValue) || intervalValue < 1) {
      throw new CodedError(
        ERROR_CODES.USAGE,
        "--interval must be a positive number of milliseconds",
      );
    }
    const timeoutMs = timeoutValue * 1000;
    const interval = Math.round(intervalValue);
    const deadline = Date.now() + timeoutMs;
    const maxPolls = Number(
      process.env.CODEFLOW_WATCH_ATTEMPTS ?? Number.MAX_SAFE_INTEGER,
    );
    while (
      checks.state === "pending" &&
      Date.now() < deadline &&
      polls < maxPolls
    ) {
      const remaining = Math.max(0, deadline - Date.now());
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(interval, remaining)),
      );
      checks = readChecks(worktree, pr.number, env);
      waited = true;
      polls += 1;
    }
    timedOut = checks.state === "pending" && Date.now() >= deadline;
  }
  pr.checks = checks;
  pr.lastReadAt = nowIso();
  writeJsonAtomic(taskFile(paths, task.id, "pr.json"), pr);
  return {
    data: {
      state: checks.state,
      checks,
      lastReadAt: pr.lastReadAt,
      waited,
      polls,
      timedOut,
    },
    taskId,
    warnings: timedOut
      ? [
          {
            code: "W_CHECKS_PENDING",
            message: "checks were still pending when the wait timeout expired",
          },
        ]
      : [],
  };
}

function commentsCommand(repo, config, flags, env) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId;
  if (!taskId) {
    throw new CodedError(ERROR_CODES.STATE_CONFLICT, "no active task");
  }
  const task = readTask(paths, taskId);
  if (!task || task.status !== "pr_open") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      "comments requires an open PR",
      { status: task?.status ?? null },
    );
  }
  const pr = readJsonSafe(taskFile(paths, task.id, "pr.json"));
  if (!pr || pr.mode !== "gh" || !pr.number) {
    throw new CodedError(
      ERROR_CODES.GH_MISSING,
      "no GitHub PR is recorded for this task",
      { mode: pr?.mode ?? null },
    );
  }
  const worktree = taskWorktree(repo, task);
  const data = readComments(worktree, pr.number, env);
  writeJsonAtomic(taskFile(paths, task.id, "comments.json"), data);
  const lines = [
    `# Review comments — ${task.id}`,
    "",
    `PR: #${pr.number}`,
    "",
    "## Reviews",
    ...(data.reviews.length === 0
      ? ["- None."]
      : data.reviews.map(
          (review) =>
            `- ${review.author} (${review.state ?? "COMMENTED"}): ${review.body || "(no body)"}`,
        )),
    "",
    "## Inline comments",
    ...(data.comments.length === 0
      ? ["- None."]
      : data.comments.map(
          (comment) =>
            `- ${comment.author} at \`${comment.path ?? "?"}:${comment.line ?? "?"}\`: ${comment.body}`,
        )),
  ];
  writeTextAtomic(taskFile(paths, task.id, "COMMENTS.md"), `${lines.join("\n")}\n`);
  return {
    data: {
      threads: data.comments.length,
      reviews: data.reviews.length,
      path: repoRelative(repo.root, taskFile(paths, task.id, "COMMENTS.md")),
      resolved: 0,
      unresolved: data.comments.length,
    },
    taskId,
  };
}

function nextFor(status) {
  const map = {
    created: ["edit TASK.md", "approve design"],
    designed: ["plan"],
    planned: ["start"],
    active: ["verify"],
    verified: ["self-review", "pr"],
    pr_open: ["watch", "comments"],
    merged: ["finish"],
    done: [],
    blocked: ["resume"],
    abandoned: [],
  };
  return map[status] ?? [];
}

function statusCommand(repo, config, flags) {
  const paths = statePaths(repo.root, config);
  const active = readActive(paths);
  const taskId = flags.task ?? active?.taskId ?? null;

  let task = null;
  if (taskId) {
    task = readTask(paths, taskId);
    if (!task) {
      throw new CodedError(
        ERROR_CODES.STATE_CONFLICT,
        `task "${taskId}" was not found`,
        { taskId },
        "Run `codeflow status` without --task to see the active task.",
      );
    }
  }

  const hash = configHash(config);
  const trust = readTrust(paths);
  const trusted = Boolean(trust && trust.configHash === hash);

  let evidence = null;
  if (task) {
    const value = readJsonSafe(taskFile(paths, task.id, "evidence.json"));
    if (value) {
      const tree = gitOrNull(["rev-parse", "HEAD^{tree}"], { cwd: repo.root });
      evidence = {
        result: value.result,
        treeHash: value.treeHash,
        finishedAt: value.finishedAt,
        fresh: Boolean(
          value.result === "pass" &&
            value.dirty === false &&
            tree &&
            value.treeHash === `git:${tree}` &&
            value.configHash === hash,
        ),
      };
    }
  }

  let pr = null;
  if (task) {
    const value = readJsonSafe(taskFile(paths, task.id, "pr.json"));
    if (value) {
      pr = {
        mode: value.mode,
        number: value.number ?? null,
        url: value.url ?? null,
        state: value.state ?? null,
        checks: value.checks ?? null,
      };
    }
  }

  const approvals = task ? approvalState(paths, task) : null;
  let next = task ? nextFor(task.status) : ["new"];
  const warnings = [];
  if (approvals?.design?.stale) {
    next = ["approve design"];
    warnings.push({
      code: "W_APPROVAL_STALE",
      message: "TASK.md changed since design approval",
    });
  } else if (approvals?.plan?.stale) {
    next = ["approve plan"];
    warnings.push({
      code: "W_APPROVAL_STALE",
      message: "plan.json changed since plan approval",
    });
  }

  return {
    data: {
      repo: {
        root: repo.root,
        baseBranch: repo.baseBranch,
        remote: repo.remote,
      },
      task: task
        ? {
            id: task.id,
            title: task.title,
            kind: task.kind,
            status: task.status,
            branch: task.branch,
            worktree: task.worktree,
          }
        : null,
      next,
      approvals,
      trust: { trusted, configHash: hash },
      evidence,
      pr,
      blocked: task?.blocked ?? null,
    },
    taskId,
    warnings,
  };
}

function doctorCommand(repo, config, configError) {
  return {
    data: runDoctor(repo, config, configError),
  };
}

export async function run(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const envelope = fail("codeflow", error, {});
    emit(envelope, { json: argv.includes("--json") }, out, err);
    return exitFor(error.code);
  }

  const { flags, positional } = parsed;
  if (flags.version) {
    out.write(`codeflow ${CLI_VERSION}\n`);
    return EXIT.OK;
  }
  if (flags.help || positional.length === 0) {
    out.write(HELP);
    return EXIT.OK;
  }

  const command = positional[0];
  const meta = { repoRoot: null, taskId: flags.task ?? null };

  try {
    const repo = findRepo(cwd);
    meta.repoRoot = repo.root;

    let result;
    switch (command) {
      case "init": {
        result = initCommand(repo, flags);
        break;
      }
      case "new": {
        const config = loadConfig(repo.root);
        result = newCommand(repo, config, flags, positional);
        break;
      }
      case "approve": {
        const config = loadConfig(repo.root);
        result = approveCommand(repo, config, flags, positional);
        break;
      }
      case "plan": {
        const config = loadConfig(repo.root);
        result = planCommand(repo, config, flags);
        break;
      }
      case "trust": {
        const config = loadConfig(repo.root);
        result = trustCommand(repo, config, flags);
        break;
      }
      case "verify": {
        const config = loadConfig(repo.root);
        result = verifyCommand(repo, config, flags);
        break;
      }
      case "start": {
        const config = loadConfig(repo.root);
        result = startCommand(repo, config, flags);
        break;
      }
      case "resume": {
        const config = loadConfig(repo.root);
        result = resumeCommand(repo, config, flags);
        break;
      }
      case "finish": {
        const config = loadConfig(repo.root);
        result = finishCommand(repo, config, flags, env);
        break;
      }
      case "self-review": {
        const config = loadConfig(repo.root);
        result = selfReviewCommand(repo, config, flags);
        break;
      }
      case "pr": {
        const config = loadConfig(repo.root);
        result = await prCommand(repo, config, flags, env);
        break;
      }
      case "watch": {
        const config = loadConfig(repo.root);
        result = await watchCommand(repo, config, flags, env);
        break;
      }
      case "comments": {
        const config = loadConfig(repo.root);
        result = commentsCommand(repo, config, flags, env);
        break;
      }
      case "status": {
        const config = loadConfig(repo.root);
        result = statusCommand(repo, config, flags);
        break;
      }
      case "doctor": {
        let config = null;
        let configError = null;
        try {
          config = loadConfig(repo.root);
        } catch (error) {
          configError = error;
        }
        result = doctorCommand(repo, config, configError);
        break;
      }
      default:
        throw new CodedError(
          ERROR_CODES.USAGE,
          `unknown command "${command}"`,
          null,
          "Run `codeflow --help`.",
        );
    }

    const envelope = ok(
      command,
      result.data,
      {
        repoRoot: repo.root,
        taskId: result.taskId ?? flags.task ?? null,
      },
      result.warnings ?? [],
    );
    emit(envelope, flags, out, err);
    return result.exitCode ?? EXIT.OK;
  } catch (error) {
    const coded =
      error instanceof CodedError
        ? error
        : new CodedError(ERROR_CODES.INTERNAL, error?.message ?? String(error));
    const envelope = fail(command, coded.toJSON(), meta);
    emit(envelope, flags, out, err);
    return exitFor(coded.code);
  }
}
