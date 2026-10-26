import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { defaultConfig } from "../src/config.mjs";
import {
  planPath,
  readPlan,
  renderPlan,
  validatePlan,
  writePlanMarkdown,
  writePlanTemplate,
} from "../src/plan.mjs";
import { findRepo } from "../src/repo.mjs";
import { ensureState, statePaths, taskFile } from "../src/state.mjs";
import { createTask } from "../src/task.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

function setup(t) {
  const dir = tempRepo();
  t.after(() => cleanup(dir));
  const repo = findRepo(dir);
  const config = defaultConfig(repo);
  const paths = statePaths(dir, config);
  ensureState(paths);
  const task = createTask(paths, repo, config, { title: "Fix login" });
  return { paths, task };
}

function validPlan(taskId) {
  return {
    schemaVersion: 1,
    taskId,
    steps: [
      {
        id: "1",
        title: "Add the guard",
        status: "pending",
        commitSubject: "fix(auth): add the guard",
        verification: "`npm test` → pass",
        summary: "",
        note: "",
      },
    ],
  };
}

test("plan template is written once and is rejected until edited", (t) => {
  const { paths, task } = setup(t);

  const plan = writePlanTemplate(paths, task);
  assert.equal(plan.steps.length, 1);
  assert.equal(writePlanTemplate(paths, task), null);
  assert.deepEqual(readPlan(paths, task.id), plan);

  const errors = validatePlan(plan, task);
  assert.ok(errors.some((error) => error.includes("template")));
});

test("a valid plan passes validation", (t) => {
  const { paths, task } = setup(t);
  const plan = validPlan(task.id);
  writeFileSync(planPath(paths, task.id), `${JSON.stringify(plan, null, 2)}\n`);

  assert.deepEqual(validatePlan(readPlan(paths, task.id), task), []);
});

test("plan validation catches bad fields and duplicate ids", (t) => {
  const { task } = setup(t);
  const plan = validPlan(task.id);
  plan.steps.push({ ...plan.steps[0] });
  plan.steps[1].status = "done";
  plan.steps[1].commitSubject = "";

  const errors = validatePlan(plan, task);
  assert.ok(errors.some((error) => error.includes("duplicated")));
  assert.ok(errors.some((error) => error.includes("commitSubject")));
});

test("renderPlan and writePlanMarkdown produce a readable plan", (t) => {
  const { paths, task } = setup(t);
  const plan = validPlan(task.id);
  writePlanMarkdown(paths, task, plan);

  const markdown = readFileSync(taskFile(paths, task.id, "PLAN.md"), "utf8");
  assert.match(markdown, /# Plan — /);
  assert.match(markdown, /- \[ \] 1\. Add the guard/);
  assert.match(markdown, /Commit: `fix\(auth\): add the guard`/);
  assert.match(markdown, /Verification: `npm test` → pass/);
  assert.equal(renderPlan(plan), markdown);
});
