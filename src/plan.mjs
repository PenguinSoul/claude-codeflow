import { CodedError, ERROR_CODES } from "./contracts.mjs";
import { taskFile } from "./state.mjs";
import {
  fileExists,
  isPlainObject,
  readJson,
  readText,
  writeJsonAtomic,
  writeTextAtomic,
} from "./util.mjs";

const STEP_STATUSES = new Set(["pending", "in_progress", "done", "blocked"]);
const PLACEHOLDER_TITLE = "Describe the first step";
const PLACEHOLDER_SUBJECT = "feat: describe the first step";

export function planPath(paths, taskId) {
  return taskFile(paths, taskId, "plan.json");
}

export function readPlan(paths, taskId) {
  const file = planPath(paths, taskId);
  if (!fileExists(file)) {
    throw new CodedError(
      ERROR_CODES.CONFIG,
      "plan.json was not found",
      { path: file },
      "Run `codeflow plan --init`, then edit the plan.",
    );
  }
  try {
    return readJson(file);
  } catch (error) {
    throw new CodedError(ERROR_CODES.CONFIG, "plan.json is not valid JSON", {
      path: file,
      error: error.message,
    });
  }
}

export function planTemplate(taskId) {
  return {
    schemaVersion: 1,
    taskId,
    steps: [
      {
        id: "1",
        title: PLACEHOLDER_TITLE,
        status: "pending",
        commitSubject: PLACEHOLDER_SUBJECT,
        verification: "not verified",
        summary: "",
        note: "",
      },
    ],
  };
}

export function writePlanTemplate(paths, task) {
  const file = planPath(paths, task.id);
  if (fileExists(file)) {
    return null;
  }
  const plan = planTemplate(task.id);
  writeJsonAtomic(file, plan);
  return plan;
}

export function validatePlan(plan, task) {
  const errors = [];
  if (!isPlainObject(plan)) {
    return ["plan must be a JSON object"];
  }
  if (plan.schemaVersion !== 1) {
    errors.push("plan schemaVersion must be 1");
  }
  if (plan.taskId !== task.id) {
    errors.push(`plan taskId must be "${task.id}"`);
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push("plan.steps must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  plan.steps.forEach((step, index) => {
    const at = `steps[${index}]`;
    if (!isPlainObject(step)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof step.id !== "string" || !step.id.trim()) {
      errors.push(`${at}.id must be a non-empty string`);
    } else if (ids.has(step.id)) {
      errors.push(`${at}.id "${step.id}" is duplicated`);
    } else {
      ids.add(step.id);
    }
    if (typeof step.title !== "string" || !step.title.trim()) {
      errors.push(`${at}.title must be a non-empty string`);
    } else if (step.title === PLACEHOLDER_TITLE) {
      errors.push(`${at}.title is still the plan template`);
    }
    if (!STEP_STATUSES.has(step.status)) {
      errors.push(`${at}.status must be pending, in_progress, done, or blocked`);
    }
    if (
      typeof step.commitSubject !== "string" ||
      !step.commitSubject.trim() ||
      step.commitSubject === PLACEHOLDER_SUBJECT
    ) {
      errors.push(`${at}.commitSubject must be a non-empty commit subject`);
    }
    if (typeof step.verification !== "string" || !step.verification.trim()) {
      errors.push(`${at}.verification must be a non-empty string`);
    }
    if (step.summary !== undefined && typeof step.summary !== "string") {
      errors.push(`${at}.summary must be a string`);
    }
    if (step.note !== undefined && typeof step.note !== "string") {
      errors.push(`${at}.note must be a string`);
    }
  });

  return errors;
}

export function renderPlan(plan) {
  const lines = [`# Plan — ${plan.taskId}`, ""];
  const marker = {
    pending: " ",
    in_progress: "~",
    done: "x",
    blocked: "!",
  };
  for (const step of plan.steps ?? []) {
    lines.push(`- [${marker[step.status] ?? " "}] ${step.id}. ${step.title}`);
    lines.push(`  - Commit: \`${step.commitSubject}\``);
    lines.push(`  - Verification: ${step.verification}`);
    if (step.summary) {
      lines.push(`  - Summary: ${step.summary}`);
    }
    if (step.note) {
      lines.push(`  - Note: ${step.note}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function writePlanMarkdown(paths, task, plan) {
  writeTextAtomic(taskFile(paths, task.id, "PLAN.md"), renderPlan(plan));
}

export function planSummary(paths, plan) {
  const file = taskFile(paths, plan.taskId, "PLAN.md");
  return fileExists(file) ? readText(file) : renderPlan(plan);
}
