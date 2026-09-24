/**
 * What the merge queue needs from the workflows behind its required checks,
 * held on the workflow files themselves.
 *
 * The queue merges a pull request only when every required check passes on
 * the queue's own commit. A workflow that does not run on that event, or that
 * filters itself out by path, creates no check there, and the queue waits for
 * a result that never comes. A job that runs but skips its work on that event
 * reports a pass it did not earn. Neither shows up until the queue is switched
 * on, so the shape is checked here, before it is.
 */
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const read = path => load(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
/** js-yaml reads the bare key `on` as the boolean `true`, as YAML 1.1 does. */
const triggersOf = workflow => workflow.on ?? workflow[true];

/** The required checks each workflow carries, by the names the ruleset requires. */
const QUEUE_CHECKS = {
  ".github/workflows/ci.yml": ["CI gate", "Comment convention (describes code, not process)"],
  ".github/workflows/integration.yml": ["Integration (postgres)", "Integration (mysql)", "Integration (sqlite)"],
  ".github/workflows/pr-title.yml": ["Validate PR title follows Conventional Commits"],
  ".github/workflows/independent-review.yml": ["Independent review of the revision being merged"],
  ".github/workflows/secret-scan.yml": ["gitleaks"],
};

describe("every workflow behind a required check, in the merge queue", () => {
  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    const workflow = read(path);
    const triggers = triggersOf(workflow);

    it(`${path} runs on the queue's event`, () => {
      expect(triggers.merge_group).toEqual({ types: ["checks_requested"] });
    });

    it(`${path} never filters itself out by path, on any event`, () => {
      for (const [event, filter] of Object.entries(triggers)) {
        expect(Object.keys(filter ?? {}), event).not.toContain("paths");
        expect(Object.keys(filter ?? {}), event).not.toContain("paths-ignore");
      }
    });

    it(`${path} still names its required checks exactly`, () => {
      const names = Object.values(workflow.jobs).map(job => job.name);
      for (const check of checks) expect(names).toContain(check);
    });
  }
});

describe("the change scope, which decides whether required jobs run", () => {
  for (const [path, job] of [
    [".github/workflows/ci.yml", "changes"],
    [".github/workflows/integration.yml", "changes"],
  ]) {
    it(`${path} takes its range from the event through the one shared script`, () => {
      const steps = read(path).jobs[job].steps;
      const decide = steps.find(step => step.id === "decide");
      expect(decide.run).toBe("node scripts/change-scope.mjs");
      expect(decide.env.INERT_PATHS).toBeTruthy();
      // Both ends of every range have to be in the checkout.
      expect(steps.find(step => String(step.uses).startsWith("actions/checkout@")).with["fetch-depth"]).toBe(0);
    });
  }
});

describe("the changeset check in the queue", () => {
  /*
   * A group's head holds every member's changes. Compared with `HEAD^1` it
   * would read only the last member's changesets, so in the queue it is
   * compared with the queue's base.
   */
  it("compares a queued group with the queue's base", () => {
    const step = read(".github/workflows/ci.yml").jobs.ci.steps.find(candidate => candidate.name === "Changeset covers the lockstep group");
    expect(step.env.QUEUE_BASE).toBe("${{ github.event.merge_group.base_sha }}");
    expect(step.run).toMatch(/git diff --name-only --diff-filter=ACMRT "\$base" HEAD/);
    expect(step.run).toMatch(/base="\$QUEUE_BASE"/);
  });
});

describe("the last commit Integration tested", () => {
  /*
   * The change scope of a push compares with the last commit this workflow
   * tested. A run where one leg judged the commit and another was cancelled
   * did not test it on the second dialect, so every leg is named as the work.
   */
  it("counts a run as tested only when every leg reached a verdict", () => {
    const workflow = read(".github/workflows/integration.yml");
    const legs = Object.values(workflow.jobs).map(job => job.name).filter(name => name.startsWith("Integration ("));
    const ask = workflow.jobs.changes.steps.find(step => step.id === "newer");
    expect(legs.length).toBe(3);
    expect(ask.with["substantive-job"].split("\n").map(name => name.trim()).filter(Boolean).sort()).toEqual(legs.sort());
  });
});

describe("steps limited to one event", () => {
  /*
   * A step limited to pull requests is skipped in the queue while its job still
   * reports success, and a job limited to them reports `skipped`, which the
   * gate accepts; either way the queue would merge on a check that did less there
   * than on a pull request's own run. Every such condition in a workflow the queue
   * requires has to name the queue's event too.
   */
  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    it(`${path} names the queue's event wherever it names a pull request's, in every job its required checks stand on`, () => {
      const workflow = read(path);
      expect(pullRequestOnly(workflow, requiredJobs(workflow, checks))).toEqual([]);
    });
  }

  it("reads either pull-request event as a limit, and one that also names the queue's as none", () => {
    expect(limitedToPullRequests("github.event_name == 'pull_request'")).toBe(true);
    expect(limitedToPullRequests("${{ always() && github.event_name == 'pull_request_target' }}")).toBe(true);
    expect(limitedToPullRequests("github.event_name == 'pull_request' || github.event_name == 'merge_group'")).toBe(false);
    expect(limitedToPullRequests("github.event_name == 'push'")).toBe(false);
  });

  it("reads a gate's dependencies as part of it, and leaves a job no required check stands on out", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(requiredJobs(ci, QUEUE_CHECKS[".github/workflows/ci.yml"])).toEqual(expect.arrayContaining(["gate", "ci", "changes", "comments"]));
    const title = read(".github/workflows/pr-title.yml");
    expect(requiredJobs(title, QUEUE_CHECKS[".github/workflows/pr-title.yml"])).toEqual(["lint"]);
  });
});

/**
 * The jobs a workflow's required checks stand on: each check's own job, and
 * every job it `needs`, however deep. A job outside that set, such as one that
 * only comments on a pull request, may be limited to a pull request's events.
 */
function requiredJobs(workflow, checks) {
  const seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    [workflow.jobs[id]?.needs ?? []].flat().forEach(visit);
  };
  Object.entries(workflow.jobs).filter(([, job]) => checks.includes(job.name)).forEach(([id]) => visit(id));
  return [...seen];
}

/** The given jobs and their steps whose condition names a pull request's event and not the queue's. */
function pullRequestOnly(workflow, ids) {
  return ids.flatMap(id => [...guardedJob(id, workflow.jobs[id]), ...guardedSteps(id, workflow.jobs[id])]);
}

function guardedJob(id, job) {
  return limitedToPullRequests(String(job.if ?? "")) ? [id] : [];
}

function guardedSteps(id, job) {
  return (job.steps ?? []).filter(step => limitedToPullRequests(String(step.if ?? ""))).map(step => `${id}: ${step.name}`);
}

/** Either pull-request event, `pull_request` or `pull_request_target`, without the queue's. */
function limitedToPullRequests(condition) {
  return /event_name == 'pull_request(?:_target)?'/.test(condition) && !/event_name == 'merge_group'/.test(condition);
}

describe("the independent-review gate", () => {
  const workflow = read(".github/workflows/independent-review.yml");
  const job = workflow.jobs.review;

  /*
   * The queue is where the reviews a pull request will get have had time to
   * arrive, and where the gate decides. It judges from the queue's base with
   * read-only access, so no queued change can rewrite what counts as a review
   * of itself.
   */
  it("decides in the queue, from the queue's base, with read access only", () => {
    expect(job.if).toBe("github.event_name == 'merge_group'");
    const checkout = job.steps.find(step => String(step.uses).startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("${{ github.event.merge_group.base_sha }}");
    expect(checkout.with["fetch-depth"]).toBe(0);
    expect(workflow.permissions).toEqual({});
    expect(Object.values(job.permissions)).toEqual(["read", "read", "read"]);
    expect(job.steps.at(-1).run).toBe("node scripts/independent-review.mjs");
  });

  // The job installs no packages, so everything the script loads has to be
  // Node's own or a file of this repository's. A package import would pass
  // every test here, where the packages are installed, and fail in the queue.
  it("runs a script that loads nothing the job does not install", () => {
    expect(job.steps.some(step => /\binstall\b/.test(String(step.run)))).toBe(false);
    expect(packageImports(new URL("./independent-review.mjs", import.meta.url))).toEqual([]);
  });
});

const IMPORTED = /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;

/** The specifiers a module names in its static and literal dynamic imports. */
function specifiersOf(url) {
  return [...readFileSync(url, "utf8").matchAll(IMPORTED)].map(match => match.slice(1).find(Boolean));
}

/** The package specifiers a module reaches through its relative imports, however deep. */
function packageImports(url, seen = new Set()) {
  if (seen.has(url.href)) return [];
  seen.add(url.href);
  return specifiersOf(url).flatMap(specifier => {
    if (specifier.startsWith(".")) return packageImports(new URL(specifier, url), seen);
    return isBuiltin(specifier) ? [] : [specifier];
  });
}

describe("the title check's permissions", () => {
  const workflow = read(".github/workflows/pr-title.yml");
  const writes = job => Object.values(job.permissions ?? {}).includes("write");

  it("grants nothing at the workflow level, so each job holds only what it declares", () => {
    expect(workflow.permissions).toEqual({});
  });

  it("checks the title with a read-only token", () => {
    const lint = Object.values(workflow.jobs).find(job => job.name === "Validate PR title follows Conventional Commits");
    expect(writes(lint)).toBe(false);
  });

  /*
   * `pull_request_target` hands a write-capable token to a run a fork's pull
   * request can start. A job holding one must run nothing a checkout could
   * supply: no checkout, no local action, no shell step.
   */
  it("gives write access only to jobs that run no repository code", () => {
    const writers = Object.entries(workflow.jobs).filter(([, job]) => writes(job));
    expect(writers.length).toBeGreaterThan(0);
    for (const [id, job] of writers) {
      for (const step of job.steps) {
        expect(String(step.uses ?? ""), `${id}: ${step.name}`).not.toMatch(/^(actions\/checkout@|\.\/)/);
        expect(step.run, `${id}: ${step.name}`).toBeUndefined();
      }
    }
  });

  /*
   * In the queue the checked-out tree holds the queued changes, so a queued
   * change to the validator would judge its own title. The checkout is the
   * queue's base instead, with the history the queued commits are read from.
   */
  it("runs the queue's check from the queue's base, with the queued commits in reach", () => {
    const checkout = workflow.jobs.lint.steps.find(step => String(step.uses).startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("${{ github.event.merge_group.base_sha }}");
    expect(checkout.with["fetch-depth"]).toBe("${{ github.event_name == 'merge_group' && '0' || '1' }}");
  });

  it("never checks out the pull request's own head", () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) expect(JSON.stringify(step.with ?? {})).not.toMatch(/pull_request\.head/);
    }
  });

  it("hands the script every rule the workflow sets, through the environment", () => {
    const action = read(".github/actions/pr-title/action.yml");
    const env = action.runs.steps[0].env;
    for (const name of ["TYPES", "SCOPES", "REQUIRE_SCOPE", "SUBJECT_PATTERN", "SUBJECT_PATTERN_ERROR"]) {
      expect(Object.keys(env)).toContain(name);
    }
    const passed = workflow.jobs.lint.steps.find(step => step.id === "lint_pr_title").with;
    for (const [input, spec] of Object.entries(action.inputs)) {
      if (spec.required) expect(Object.keys(passed), input).toContain(input);
    }
  });
});
