import { accessSync, constants, existsSync } from "node:fs";
import { configHash, validateConfig } from "./config.mjs";
import { gitVersion } from "./git.mjs";
import { statePaths, readTrust } from "./state.mjs";
import { which } from "./util.mjs";

export function runDoctor(repo, config, configError = null) {
  const checks = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: nodeMajor >= 20,
    detail: process.version,
  });

  const version = gitVersion();
  checks.push({
    name: "git",
    ok: Boolean(version),
    detail: version ?? "not found",
  });

  const gh = which("gh");
  checks.push({
    name: "gh",
    ok: Boolean(gh),
    detail: gh ?? "not installed; PR creation will use a compare URL",
  });

  if (configError) {
    checks.push({
      name: "config",
      ok: false,
      detail: configError.message,
    });
  } else {
    const errors = validateConfig(config);
    checks.push({
      name: "config",
      ok: errors.length === 0,
      detail: errors.length === 0 ? "valid" : errors.join("; "),
    });
  }

  if (!config) {
    checks.push({ name: "state", ok: false, detail: "no config" });
    checks.push({ name: "trust", ok: false, detail: "no config" });
    checks.push({ name: "schema", ok: false, detail: "no config" });
    return { checks };
  }

  const paths = statePaths(repo.root, config);
  const stateExists = existsSync(paths.stateDir);
  let writable = false;
  try {
    accessSync(stateExists ? paths.stateDir : repo.root, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "state",
    ok: writable,
    detail: stateExists
      ? paths.stateDir
      : `${paths.stateDir} (will be created by init)`,
  });

  const trust = readTrust(paths);
  const hash = configHash(config);
  if (!trust) {
    checks.push({
      name: "trust",
      ok: false,
      detail: "not trusted; run `codeflow trust`",
    });
  } else if (trust.configHash !== hash) {
    checks.push({
      name: "trust",
      ok: false,
      detail: "config changed since trust; run `codeflow trust` again",
    });
  } else {
    checks.push({ name: "trust", ok: true, detail: "config hash matches" });
  }

  checks.push({
    name: "schema",
    ok: config.schemaVersion === 1,
    detail: `config schemaVersion ${config.schemaVersion}`,
  });

  return { checks };
}
