function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    return [];
  }
  return ["", "Warnings:", ...warnings.map((warning) => `  - ${warning.message}`)];
}

export function renderError(envelope) {
  const err = envelope.error;
  const lines = [`error: ${err.code} — ${err.message}`];
  if (err.hint) {
    lines.push(`hint: ${err.hint}`);
  }
  return lines.join("\n");
}

export function render(envelope) {
  if (!envelope.ok) {
    return renderError(envelope);
  }
  const { command, data, warnings } = envelope;
  switch (command) {
    case "init":
      return [
        `Initialized codeflow in ${data.repoRoot}`,
        `Base branch: ${data.baseBranch}`,
        `Remote: ${data.remote ?? "(none)"}`,
        `Config: ${data.configPath}`,
        `Gates: ${data.detected.length === 0 ? "(none detected; edit the config)" : data.detected.map((gate) => gate.name).join(", ")}`,
        "Next: codeflow trust",
        ...renderWarnings(warnings),
      ].join("\n");
    case "status":
      return renderStatus(data, warnings);
    case "doctor":
      return [
        ...data.checks.map(
          (check) => `${check.name.padEnd(10)} ${check.ok ? "ok  " : "FAIL"} ${check.detail}`,
        ),
        ...renderWarnings(warnings),
      ].join("\n");
    default:
      return JSON.stringify(data, null, 2);
  }
}

export function renderStatus(data, warnings = []) {
  const lines = [
    `Repository: ${data.repo.root}`,
    `Base: ${data.repo.baseBranch}${data.repo.remote ? ` ← ${data.repo.remote}` : ""}`,
  ];
  if (!data.task) {
    lines.push("Task: none");
    lines.push(`Next: ${data.next.join(", ")}`);
  } else {
    lines.push(`Task: ${data.task.id} — ${data.task.title}`);
    lines.push(`Status: ${data.task.status}`);
    lines.push(`Next: ${data.next.length === 0 ? "(none)" : data.next.join(", ")}`);
  }
  lines.push(
    `Trust: ${data.trust.trusted ? "trusted" : "not trusted"}`,
  );
  if (data.evidence) {
    lines.push(
      `Evidence: ${data.evidence.result}${data.evidence.fresh === false ? " (stale)" : ""}`,
    );
  }
  if (data.pr) {
    const checks = data.pr.checks?.state ? ` (${data.pr.checks.state})` : "";
    lines.push(
      `PR: ${data.pr.number ? `#${data.pr.number}` : data.pr.mode} ${data.pr.state ?? ""}${checks}`.trim(),
    );
  }
  if (data.blocked) {
    lines.push(`Blocked: ${data.blocked.code} — ${data.blocked.reason}`);
  }
  lines.push(...renderWarnings(warnings));
  return lines.join("\n");
}

export function renderBrief(data) {
  if (!data.task) {
    return "";
  }
  const next = data.next.length > 0 ? data.next.join(", ") : "none";
  return `codeflow: ${data.task.id} [${data.task.status}] — ${data.task.title} → next: ${next}`;
}
