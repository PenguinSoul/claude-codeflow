import path from "node:path";
import {
  ensureDir,
  runShell,
  sha256,
  stableStringify,
  tailLines,
  writeTextAtomic,
} from "./util.mjs";

export const TIER_GATES = Object.freeze({
  fast: ["fast"],
  full: ["fast", "full"],
  live: ["fast", "full", "live"],
});

export function selectGates(config, kind, tier = "fast") {
  const allowed = TIER_GATES[tier] ?? TIER_GATES.fast;
  return config.gates.filter((gate) => {
    const matchesKind =
      kind === "mixed"
        ? true
        : gate.kinds.length === 0 || gate.kinds.includes(kind);
    return matchesKind && allowed.includes(gate.tier);
  });
}

export function gateSetHash(gates) {
  return sha256(
    stableStringify(
      gates.map((gate) => ({
        name: gate.name,
        command: gate.command,
        cwd: gate.cwd ?? ".",
        tier: gate.tier,
        required: gate.required,
      })),
    ),
  );
}

function gateLog(gate, run) {
  return [
    `$ ${gate.command}`,
    `cwd: ${gate.cwd ?? "."}`,
    `exit: ${run.status}`,
    run.timedOut ? "timeout: yes" : null,
    "",
    "--- stdout ---",
    run.stdout,
    "",
    "--- stderr ---",
    run.stderr,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function attemptGate(gate, options, attempt) {
  const {
    cwd,
    logDir,
    env = process.env,
  } = options;
  const startedAt = Date.now();
  const run = runShell(gate.command, {
    cwd: path.resolve(cwd, gate.cwd ?? "."),
    timeout: Math.max(1, Math.round((gate.timeoutSec ?? 300) * 1000)),
    env,
  });
  const durationMs = Date.now() - startedAt;
  const logPath = path.join(logDir, `${gate.name.replace(/[^\w-]/g, "_")}.log`);
  ensureDir(logDir);
  writeTextAtomic(logPath, `${gateLog(gate, run)}\n`);
  return {
    name: gate.name,
    command: gate.command,
    tier: gate.tier,
    required: gate.required,
    exitCode: run.timedOut ? -1 : run.status,
    durationMs,
    timedOut: run.timedOut,
    flaky: false,
    attempt,
    logPath,
    tail: tailLines(`${run.stdout}\n${run.stderr}`, 20),
  };
}

export function runGates(gates, options = {}) {
  const {
    retryFlaky = false,
    maxRetries = 1,
  } = options;
  const results = [];
  let result = "pass";

  for (const gate of gates) {
    let entry = attemptGate(gate, options, 1);

    if (
      !entry.timedOut &&
      entry.exitCode !== 0 &&
      retryFlaky &&
      maxRetries > 0 &&
      !options.dryRun
    ) {
      const retry = attemptGate(gate, options, 2);
      if (retry.exitCode === 0) {
        retry.flaky = true;
        retry.firstExitCode = entry.exitCode;
        entry = retry;
      } else {
        retry.firstExitCode = entry.exitCode;
        entry = retry;
      }
    }

    results.push(entry);
    if ((entry.timedOut || entry.exitCode !== 0) && gate.required) {
      result = "fail";
      break;
    }
  }

  return { results, result };
}
