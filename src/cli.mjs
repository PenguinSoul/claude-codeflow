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
import { gitOrNull } from "./git.mjs";
import { failedAttention, scanAttention } from "./attention.mjs";
import {
  buildEvidence,
  writeEvidence,
} from "./evidence.mjs";
import { runGates, selectGates } from "./gates.mjs";
import {
  planPath,
  readPlan,
  validatePlan,
  writePlanMarkdown,
  writePlanTemplate,
} from "./plan.mjs";
import { render, renderBrief, renderError } from "./render.mjs";
import { ensureExcluded, findRepo, repoRelative } from "./repo.mjs";
import {
  ensureState,
  readActive,
  readTask,
  readTrust,
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
import { fileExists, nowIso, readJsonSafe } from "./util.mjs";

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
  --brief      One-line status (status only)
  --force      Overwrite an existing config (init only)
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
  if (target === "self-review") {
    throw new CodedError(
      ERROR_CODES.USAGE,
      "self-review approval is not available yet",
      null,
      "It lands with the delivery milestone.",
    );
  }
  if (target !== "design" && target !== "plan") {
    throw new CodedError(
      ERROR_CODES.USAGE,
      `unknown approval target "${target}"`,
      null,
      "Use `design` or `plan`.",
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
  if (task.status !== "active") {
    throw new CodedError(
      ERROR_CODES.STATE_CONFLICT,
      `task is ${task.status}; verify requires an active task`,
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
