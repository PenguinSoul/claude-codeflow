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

export function trustConfig(paths, config, approvedBy) {
  const trust = {
    schemaVersion: 1,
    configHash: configHash(config),
    approvedBy,
    approvedAt: nowIso(),
    commands: commandsFor(config),
  };
  writeTrust(paths, trust);
  return trust;
}

export function assertTrusted(paths, config) {
  const trust = readTrust(paths);
  if (!trust) {
    throw new CodedError(
      ERROR_CODES.TRUST_REQUIRED,
      "the config is not trusted",
      { configHash: configHash(config) },
      "Review the gate commands, then run `codeflow trust --yes`.",
    );
  }
  const current = configHash(config);
  if (trust.configHash !== current) {
    throw new CodedError(
      ERROR_CODES.TRUST_STALE,
      "the config changed since it was trusted",
      { expected: trust.configHash, actual: current },
      "Review the new commands, then run `codeflow trust --yes` again.",
    );
  }
  return trust;
}
