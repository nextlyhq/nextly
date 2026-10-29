/**
 * A pull request's run reads its workflow from the merge commit, but a job
 * that checks out the branch's head at the root of its workspace reads any
 * `./.github/actions/*` action from that head. A branch cut before the action
 * existed then fails with "Can't find 'action.yml'", and one cut before the
 * action changed runs the old version beside the new workflow. Such a job
 * takes its local actions from a checkout of the workflow's own commit, in a
 * folder of its own.
 */
import { readdirSync, readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const WORKFLOWS = readdirSync(new URL("../.github/workflows/", import.meta.url)).filter(name => /\.ya?ml$/.test(name));
const isCheckout = step => String(step.uses ?? "").startsWith("actions/checkout@");
// A ref naming a pull request's head, by SHA or by its `refs/pull/<n>/head` ref.
const isPullRequestHead = ref => /pull_request\.head\b|refs\/pull\/[^']*\/head/.test(String(ref ?? ""));
// The workflow's own commit: checkout's default, or `github.sha` named.
const isWorkflowCommit = ref => ref === undefined || /^\$\{\{\s*github\.sha\s*\}\}$/.test(String(ref));

const jobs = WORKFLOWS.flatMap(file => {
  const workflow = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"));
  return Object.entries(workflow.jobs ?? {}).map(([id, job]) => ({ where: `${file} ${id}`, steps: job.steps ?? [] }));
});
// Jobs whose workspace root holds a pull request's head rather than the workflow's commit.
const headJobs = jobs.filter(({ steps }) => steps.some(step => isCheckout(step) && !step.with?.path && isPullRequestHead(step.with?.ref)));

describe("a job that checks out a pull request's head at its root", () => {
  it("is found", () => {
    expect(headJobs.map(job => job.where)).toEqual(["code-hygiene.yml whole-repo"]);
  });

  it.each(headJobs.map(job => [job.where, job]))("%s takes each local action from a checkout of the workflow's own commit", (_, { steps }) => {
    const local = steps.map((step, index) => ({ step, index })).filter(({ step }) => String(step.uses ?? "").startsWith("./"));
    const stray = local.filter(({ step, index }) => {
      const folder = /^\.\/([^/]+)\/\.github\/actions\//.exec(step.uses)?.[1];
      return !steps
        .slice(0, index)
        .some(earlier => isCheckout(earlier) && earlier.with?.path === folder && isWorkflowCommit(earlier.with?.ref));
    });
    expect(local.length).toBeGreaterThan(0);
    expect(stray.map(({ step }) => step.uses)).toEqual([]);
  });
});
