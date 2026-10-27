import { CodedError, ERROR_CODES } from "./contracts.mjs";
import { configHash } from "./config.mjs";
import { readTrust, writeTrust } from "./state.mjs";
import { nowIso } from "./util.mjs";

export function commandsFor(config) {
  return config.gates.map((gate) => ({
    name: gate.name,
    command: gate.command,
    cwd: gate.cwd ?? ".",
  }));
}

function approvalsOf(trust) {
  if (!trust) {
    return [];
  }
  if (Array.isArray(trust.approvals)) {
    return trust.approvals;
  }
  if (trust.configHash && trust.approvedBy) {
    return [
      {
        configHash: trust.configHash,
        approvedBy: trust.approvedBy,
        approvedAt: trust.approvedAt,
        commands: trust.commands ?? [],
      },
    ];
  }
  return [];
}

export function trustConfig(paths, config, approvedBy) {
  const previous = readTrust(paths);
  const approval = {
    configHash: configHash(config),
    approvedBy,
    approvedAt: nowIso(),
    commands: commandsFor(config),
  };
  const approvals = [
    ...approvalsOf(previous).filter(
      (entry) => entry.configHash !== approval.configHash,
    ),
    approval,
  ].slice(-20);
  const trust = {
    schemaVersion: 1,
    ...approval,
    approvals,
  };
  writeTrust(paths, trust);
  return trust;
}

export function assertTrusted(paths, config) {
  const trust = readTrust(paths);
  const current = configHash(config);
  const approval = approvalsOf(trust).find(
    (entry) => entry.configHash === current,
  );
  if (!approval) {
    if (!trust) {
      throw new CodedError(
        ERROR_CODES.TRUST_REQUIRED,
        "the config is not trusted",
        { configHash: current },
        "Review the gate commands, then run `codeflow trust --yes`.",
      );
    }
    throw new CodedError(
      ERROR_CODES.TRUST_STALE,
      "the config changed since it was trusted",
      { expected: trust.configHash, actual: current },
      "Review the new commands, then run `codeflow trust --yes` again.",
    );
  }
  return approval;
}

export function isTrusted(paths, config) {
  const trust = readTrust(paths);
  return approvalsOf(trust).some(
    (entry) => entry.configHash === configHash(config),
  );
}
