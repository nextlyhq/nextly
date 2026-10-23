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
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";

import { load } from "js-yaml";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { describe, expect, it } from "vitest";

import { filesThatRun } from "./change-scope.mjs";

const read = path => load(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
/** A JSON file of the repository, such as a package manifest. */
const readJson = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
/** js-yaml reads the bare key `on` as the boolean `true`, as YAML 1.1 does. */
const triggersOf = workflow => workflow.on ?? workflow[true];

/** The required checks each workflow carries, by the names the ruleset requires. */
const QUEUE_CHECKS = {
  ".github/workflows/ci.yml": ["CI gate", "Comment convention (describes code, not process)"],
  ".github/workflows/integration.yml": ["Integration (postgres)", "Integration (mysql)", "Integration (sqlite)"],
  ".github/workflows/small-checks.yml": ["Small checks (title, AI credit, secret scan, review)"],
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
  it("counts a run as tested only when every job that runs the suite reached a verdict", () => {
    const workflow = read(".github/workflows/integration.yml");
    // The jobs that run a lane, under the names their runs carry: GitHub
    // appends a matrix job's value to a name with no expression in it, so a
    // sharded leg is one name per shard.
    const runsTheSuite = job => (job.steps ?? []).some(step => /\blane:test:integration:/.test(String(step.run)));
    const legs = Object.values(workflow.jobs)
      .filter(runsTheSuite)
      .flatMap(job => (job.strategy?.matrix?.shard ?? [null]).map(shard => (shard === null ? job.name : `${job.name} (${shard})`)));
    const ask = workflow.jobs.changes.steps.find(step => step.id === "newer");
    // A floor, so a reader that found no jobs cannot pass by comparing nothing.
    expect(legs.length).toBeGreaterThanOrEqual(3);
    expect(ask.with["substantive-job"].split("\n").map(name => name.trim()).filter(Boolean).sort()).toEqual(legs.sort());
  });
});

describe("the Windows and macOS legs", () => {
  /*
   * A pull request runs them only when it changes a platform-sensitive path or
   * asks with the `ci:all-os` label; every other event runs them all, so the
   * merge queue and `main` never skip a platform. Held on the expression
   * itself, evaluated, and on every job that can land on a non-Linux runner.
   */
  const ci = read(".github/workflows/ci.yml");
  const allOs = ci.jobs.changes.outputs["all-os"];
  const answer = (event, { inert = "true", labels = [] } = {}) =>
    String(
      evaluate(conditionTokens(allOs.replace(/^\$\{\{|\}\}$/g, "")), allOs, {
        "github.event_name": event,
        "steps.os.outputs.inert": inert,
        "github.event.pull_request.labels.*.name": labels,
      })
    );

  it("runs every platform off a pull request, whatever the change", () => {
    for (const event of ["push", "merge_group", "workflow_dispatch"]) expect(answer(event, { inert: "true" }), event).toBe("true");
  });

  it("runs Linux alone on a pull request that touches no platform-sensitive path", () => {
    expect(answer("pull_request", { inert: "true" })).toBe("false");
  });

  it("runs every platform on a pull request that touches one, asks with the label, or could not be decided", () => {
    expect(answer("pull_request", { inert: "false" })).toBe("true");
    expect(answer("pull_request", { inert: "true", labels: ["ci:all-os"] })).toBe("true");
    // A step that failed or never ran has no output.
    expect(answer("pull_request", { inert: "" })).toBe("true");
  });

  // What a Windows gate job decides, from both answers it reads, evaluated as
  // the job's own `if:`: the label adds the legs to a pull request whose CI
  // runs, and an inert change runs no test job on any operating system.
  it("adds the Windows gate jobs to a pull request's CI when it carries the label", () => {
    const gate = ci.jobs["windows-gates"].if;
    const runs = ({ inert, osInert, labels = [] }) =>
      String(
        evaluate(conditionTokens(gate), gate, {
          "needs.changes.outputs.inert": inert,
          "needs.changes.outputs.all-os": answer("pull_request", { inert: osInert, labels }),
        })
      );
    expect(runs({ inert: "false", osInert: "true" })).toBe("false");
    expect(runs({ inert: "false", osInert: "true", labels: ["ci:all-os"] })).toBe("true");
    expect(runs({ inert: "false", osInert: "false" })).toBe("true");
    expect(runs({ inert: "true", osInert: "true", labels: ["ci:all-os"] })).toBe("false");
  });

  // The step's own patterns, read by the same function `change-scope.mjs` runs
  // them through: each platform-sensitive path asks for the legs on its own,
  // and a pull request of product code and docs asks for none.
  it("asks for them from the paths where the platforms differ, and only those", () => {
    const { env } = ci.jobs.changes.steps.find(step => step.id === "os");
    const running = files => filesThatRun(files, { inert: new RegExp(env.INERT_PATHS), alwaysRun: new RegExp(env.ALWAYS_RUN_PATHS) });
    const sensitive = [
      "packages/create-nextly-app/src/utils/template.ts",
      "templates/blank/package.json",
      "packages/nextly/src/cli/commands/add.ts",
      "packages/admin-css/bin/nextly-build-admin-css.mjs",
      "scripts/bounded.mjs",
      ".husky/pre-push",
      ".github/workflows/ci.yml",
      "package.json",
      "apps/playground/package.json",
      "e2e/package.json",
      "pnpm-lock.yaml",
      "turbo.jsonc",
      ".gitattributes",
      "packages/ui/scripts/build-css.mjs",
      "apps/playground/scripts/provision-empty.ts",
      "packages/nextly/tsdown.config.ts",
      "packages/admin/tsup.config.ts",
      "packages/ui/vitest.config.ts",
      "vitest.config.ts",
      "eslint.config.mjs",
      "apps/playground/vitest.config.ts",
      "apps/playground/next.config.ts",
      "packages/telemetry/src/environment.ts",
      "packages/nextly/src/storage/adapters/local-adapter.ts",
      "packages/nextly/src/shared/lib/generated-output-paths.ts",
      "packages/nextly/src/plugins/codegen/component-import-map.ts",
      "packages/nextly/src/domains/widgets/declaration/component-map-check.ts",
    ];
    for (const file of sensitive) expect(running([file]), file).toEqual([file]);
    const neutral = [
      "packages/nextly/src/domains/schema/pipeline/classifier/type-widening.ts",
      "packages/admin/src/components/features/dashboard/TeamSummary.tsx",
      "packages/ui/src/components/button.tsx",
      "packages/nextly/src/domains/schema/services/field-column-descriptor.ts",
      "docs/guides/deployment.mdx",
      "AGENTS.md",
      ".changeset/a-change.md",
    ];
    expect(running(neutral)).toEqual([]);
  });

  /** Everything that decides where a job runs and whether it does: its `if:`, `runs-on` and matrix. */
  const placement = job => `${job.if ?? ""} ${job["runs-on"]} ${JSON.stringify(job.strategy?.matrix ?? {})}`;

  it("gates every job that can land on Windows or macOS by that answer", () => {
    const nonLinux = Object.entries(ci.jobs).filter(([, job]) => /windows|macos/.test(placement(job)));
    // A floor, so a reader that matched no jobs cannot pass by checking none.
    expect(nonLinux.length).toBeGreaterThanOrEqual(6);
    for (const [id, job] of nonLinux) {
      expect(placement(job), id).toContain("needs.changes.outputs.all-os");
      expect([job.needs].flat(), id).toContain("changes");
    }
  });
});

describe("the labels the workflows read", () => {
  // `labels-sync.yml` creates every label in this file, and GitHub's label API
  // refuses a description over 100 characters, which fails the whole sync: a
  // label a workflow reads, such as `ci:all-os`, then never exists to apply.
  it("each fit GitHub's 100-character description limit", () => {
    const labels = read(".github/labels.yml");
    expect(labels.length).toBeGreaterThan(0);
    const over = labels
      .filter(label => (label.description ?? "").length > 100)
      .map(label => `${label.name}: ${label.description.length}`);
    expect(over).toEqual([]);
  });
});

describe("which runs a pull-request workflow's concurrency group cancels", () => {
  /*
   * A group cancels its running and pending runs when a newer run joins it.
   * So each workflow that a pull request starts keys its group by that pull
   * request and by itself: a push to the same pull request cancels the older
   * run of the same workflow, and nothing else does. The groups are evaluated
   * here for the events each workflow runs on, rather than read by spelling.
   */
  const WORKFLOWS = readdirSync(new URL("../.github/workflows/", import.meta.url)).filter(file => /\.ya?ml$/.test(file));
  const pullRequestWorkflows = WORKFLOWS.map(file => [file, read(`.github/workflows/${file}`)]).filter(
    ([, workflow]) => Object.keys(triggersOf(workflow)).some(event => PULL_REQUEST_EVENTS.includes(event)) && !onlyOnClose(triggersOf(workflow))
  );

  /** The value of a `${{ }}`-templated field, under the given context. */
  const valueOf = (template, known) =>
    String(template).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(conditionTokens(expression), expression, known)));

  /** A run's context: which workflow, which event, which pull request and which commit. */
  const context = (workflow, event, { pull = 1, sha = "s1" } = {}) => ({
    "github.workflow": workflow.name,
    "github.event_name": event,
    // As GitHub sets it: a pull request's merge ref, the queue's own branch for
    // each queued entry, and the base branch for `pull_request_target` and a push.
    "github.ref": { pull_request: `refs/pull/${pull}/merge`, merge_group: `refs/heads/gh-readonly-queue/main/pr-${pull}-${sha}` }[event] ?? "refs/heads/main",
    "github.event.pull_request.number": event.startsWith("pull_request") ? pull : null,
    "github.sha": sha,
    "github.run_id": `run-${pull}-${sha}`,
  });

  it("finds the pull-request workflows", () => {
    expect(pullRequestWorkflows.map(([file]) => file)).toEqual(expect.arrayContaining(["ci.yml", "integration.yml", "small-checks.yml", "labeler.yml"]));
  });

  for (const [file, workflow] of pullRequestWorkflows) {
    const events = Object.keys(triggersOf(workflow));
    const pullEvent = events.find(event => PULL_REQUEST_EVENTS.includes(event));

    it(`${file}: a newer push to the same pull request cancels its older run`, () => {
      expect(workflow.concurrency, "no concurrency group").toBeTruthy();
      const { group, "cancel-in-progress": cancels } = workflow.concurrency;
      expect(valueOf(group, context(workflow, pullEvent, { sha: "s1" }))).toBe(valueOf(group, context(workflow, pullEvent, { sha: "s2" })));
      expect(valueOf(cancels, context(workflow, pullEvent))).toBe("true");
    });

    it(`${file}: another pull request's run, or another workflow's, is never in its group`, () => {
      const { group } = workflow.concurrency;
      expect(valueOf(group, context(workflow, pullEvent, { pull: 1 }))).not.toBe(valueOf(group, context(workflow, pullEvent, { pull: 2 })));
      for (const [otherFile, other] of pullRequestWorkflows.filter(([candidate]) => candidate !== file)) {
        const otherEvent = Object.keys(triggersOf(other)).find(event => PULL_REQUEST_EVENTS.includes(event));
        expect(valueOf(group, context(workflow, pullEvent)), otherFile).not.toBe(valueOf(other.concurrency?.group ?? "", context(other, otherEvent)));
      }
    });

    for (const event of events.filter(candidate => candidate === "push" || candidate === "merge_group")) {
      it(`${file}: a ${event} run is never cancelled by another run`, () => {
        const { group, "cancel-in-progress": cancels } = workflow.concurrency;
        const first = valueOf(group, context(workflow, event, { sha: "s1" }));
        expect(first).not.toBe(valueOf(group, context(workflow, event, { sha: "s2" })));
        // A pull request's run never shares a group with it either.
        expect(first).not.toBe(valueOf(group, context(workflow, pullEvent, { sha: "s1" })));
        if (String(cancels).includes("${{")) expect(valueOf(cancels, context(workflow, event))).toBe("false");
      });
    }
  }

  it("leaves a closed pull request's runs to one workflow, which cancels with the API", () => {
    const closing = read(".github/workflows/cancel-closed-pull-request-runs.yml");
    expect(triggersOf(closing)).toEqual({ pull_request: { branches: ["main"], types: ["closed"] } });
    expect(closing.permissions).toEqual({});
    const [job] = Object.values(closing.jobs);
    expect(job.permissions).toEqual({ contents: "read", actions: "write" });
    expect(job.steps.at(-1).run).toBe("node scripts/cancel-closed-pull-request-runs.mjs");
    // The script holding `actions: write` comes from the default branch, never the closed pull request.
    expect(job.steps.find(step => String(step.uses).startsWith("actions/checkout@")).with.ref).toBe("${{ github.event.repository.default_branch }}");
  });
});

/** A workflow that runs only when a pull request closes, which no newer run replaces. */
function onlyOnClose(triggers) {
  const events = Object.entries(triggers);
  return events.length === 1 && String(events[0][1]?.types) === "closed";
}

describe("Integration on request", () => {
  /*
   * A pull request runs the database legs only while it carries the
   * `run-integration` label; the queue and `main` always run them. One step of
   * the `changes` job answers (`scripts/integration-request.mjs`, tested on its
   * own), so each leg's condition reads the same for every event, as the queue
   * checks below require. Adding the label is a separate workflow's job, so no
   * other label ever starts an Integration run.
   */
  const workflow = read(".github/workflows/integration.yml");
  const request = read(".github/workflows/integration-request.yml");

  it("asks one unconditional step, whose output is the answer", () => {
    const step = workflow.jobs.changes.steps.find(candidate => candidate.id === "requested");
    expect(step.run).toBe("node scripts/integration-request.mjs requested");
    expect(step.if).toBeUndefined();
    expect(workflow.jobs.changes.outputs.requested).toBe("${{ steps.requested.outputs.requested }}");
    expect(workflow.jobs.changes.permissions["pull-requests"]).toBe("read");
  });

  it("skips a leg only on an answer of no, so a question that failed still runs it", () => {
    // Every job of a leg, the shards that run the suite and the required check
    // that reads them, so neither runs where the other skips.
    const legs = Object.values(workflow.jobs).filter(job => String(job.name).startsWith("Integration ("));
    for (const check of QUEUE_CHECKS[".github/workflows/integration.yml"]) expect(legs.map(leg => leg.name)).toContain(check);
    for (const leg of legs) expect(leg.if, leg.name).toContain("needs.changes.outputs.requested != 'false'");
  });

  it("is not started by a label, so another label cannot repeat, cancel or hide a run", () => {
    const types = triggersOf(workflow).pull_request?.types;
    expect(types ?? ["opened", "synchronize", "reopened"]).not.toContain("labeled");
  });

  it("leaves adding the label to a workflow that only re-runs, and only for that label", () => {
    expect(triggersOf(request)).toEqual({ pull_request: { branches: ["main"], types: ["labeled"] } });
    const jobs = Object.values(request.jobs);
    expect(jobs.length).toBe(1);
    expect(jobs[0].if).toBe("github.event.label.name == 'run-integration'");
    expect(jobs[0].steps.at(-1).run).toBe("node scripts/integration-request.mjs rerun");
    expect(request.permissions).toEqual({ contents: "read" });
    expect(jobs[0].permissions).toEqual({ contents: "read", actions: "write" });
  });

  it("keys the request by the label too, so another label never cancels a waiting request", () => {
    const group = String(request.concurrency.group);
    const groupFor = (label, run) =>
      group.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) =>
        String(evaluate(conditionTokens(expression), expression, { "github.event.pull_request.number": 7, "github.event.label.name": label, "github.run_id": run, "github.sha": `sha-${run}` }))
      );
    expect(groupFor("run-integration", 1)).not.toBe(groupFor("enhancement", 1));
    // Two separate requests for the same pull request share one group, so the later replaces the earlier.
    expect(groupFor("run-integration", 1)).toBe(groupFor("run-integration", 2));
    expect(request.concurrency["cancel-in-progress"]).toBe(true);
  });
});

describe("when the Release job runs", () => {
  /*
   * A push to `main` runs it only for the Version Packages merge, the moment to
   * publish; a dispatch from `main` runs it on demand, versioning pending
   * changesets into that pull request or publishing when none are pending.
   * Release health then skips the runs where Release itself skipped. Each
   * condition is evaluated for the events it meets, not read by spelling.
   */
  const decide = (condition, known) =>
    String(evaluate(conditionTokens(condition), condition, { "github.repository": "nextlyhq/nextly", "github.ref": "refs/heads/main", ...known }));
  const workflow = read(".github/workflows/release.yml");
  const job = workflow.jobs.release;
  const release = job.if;
  const health = read(".github/workflows/release-health.yml").jobs.finalized.if;

  it("runs on the Version Packages merge, stable or pre-release", () => {
    for (const message of ["chore: version packages (#2400)", "chore: version packages (alpha) (#2295)"]) {
      expect(decide(release, { "github.event_name": "push", "github.event.head_commit.message": message }), message).toBe("true");
    }
  });

  it("skips every other push to main, and runs on a dispatch", () => {
    expect(decide(release, { "github.event_name": "push", "github.event.head_commit.message": "fix(nextly): type the send-test error (#2563)" })).toBe("false");
    expect(decide(release, { "github.event_name": "workflow_dispatch", "github.event.head_commit.message": "" })).toBe("true");
  });

  it("runs a dispatch only from main, since the job publishes whatever ref it checks out", () => {
    for (const ref of ["refs/heads/feature/try-a-release", "refs/tags/v0.0.2-alpha.66"]) {
      expect(decide(release, { "github.event_name": "workflow_dispatch", "github.ref": ref }), ref).toBe("false");
    }
    expect(decide(release, { "github.event_name": "workflow_dispatch", "github.ref": "refs/heads/main" })).toBe("true");
  });

  it("never runs in a fork", () => {
    expect(decide(release, { "github.repository": "someone/nextly", "github.event_name": "workflow_dispatch" })).toBe("false");
  });

  it("queues releases on the job, so a push whose job skips never displaces a waiting release", () => {
    // A workflow-level group is entered by every run, skipped job or not.
    expect(workflow.concurrency).toBeUndefined();
    expect(job.concurrency).toMatchObject({ group: expect.stringMatching(/\S/), "cancel-in-progress": false, queue: "max" });
  });

  /*
   * Which of the job's steps a run takes, in order. Each step's `if:` is
   * evaluated with what the steps before it left: its outcome, the
   * `hasChangesets` the Changesets action reports (`pending`, on a run that
   * reaches it), and each `name=$VAR` a run step writes to `$GITHUB_OUTPUT`,
   * valued from that step's `env:`. A skipped step leaves empty outputs.
   */
  const valueOf = (template, known) =>
    String(template).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => decide(expression, known));
  const isChangesetsAction = step => String(step.uses).startsWith("changesets/action@");
  const publishesDirectly = step => String(step.run).includes("pnpm release:publish");
  const verifies = step => String(step.run).includes("pnpm release:verify");
  const finalizes = step => String(step.run).includes("gh release create");
  const OUTPUT_LINE = /([\w-]+)=\$\{?(\w+)\}?"?\s*>>\s*"?\$GITHUB_OUTPUT/g;
  /** The outputs a step sets when it runs, by lowercased name. */
  const outputsOf = (step, known, pending) => [
    ...(isChangesetsAction(step) ? [["haschangesets", String(pending)]] : []),
    ...[...String(step.run ?? "").matchAll(OUTPUT_LINE)].map(([, name, variable]) => [name.toLowerCase(), valueOf(step.env?.[variable], known)]),
  ];
  /** What a step leaves for the steps after it, under its id: its outcome, and its outputs, empty when it was skipped. */
  const leftBy = (step, runs, known, pending) => {
    const at = `steps.${step.id.toLowerCase()}`;
    const outputs = outputsOf(step, known, pending).map(([name, value]) => [`${at}.outputs.${name}`, runs ? value : ""]);
    return Object.fromEntries([[`${at}.outcome`, runs ? "success" : "skipped"], ...outputs]);
  };
  const stepsRun = (event, { pending, publish = null }) => {
    const known = {
      "github.event_name": event,
      "github.event.head_commit.message": event === "push" ? "chore: version packages (alpha) (#2600)" : null,
      // A push carries no inputs, so the context reads null there.
      "inputs.publish": event === "workflow_dispatch" ? publish ?? false : null,
    };
    expect(decide(release, known), event).toBe("true");
    return job.steps.filter(step => {
      const runs = decide(String(step.if ?? ""), known) === "true";
      if (step.id) Object.assign(known, leftBy(step, runs, known, pending));
      return runs;
    });
  };

  it("publishes the Version Packages merge whatever changesets landed after it, then verifies and finalizes it", () => {
    const ran = stepsRun("push", { pending: true });
    expect(ran.some(publishesDirectly)).toBe(true);
    expect(ran.some(isChangesetsAction)).toBe(false);
    expect(ran.some(verifies)).toBe(true);
    expect(ran.some(finalizes)).toBe(true);
  });

  it("on a dispatch with changesets pending, versions them and neither publishes nor finalizes", () => {
    const ran = stepsRun("workflow_dispatch", { pending: true });
    expect(ran.some(isChangesetsAction)).toBe(true);
    expect(ran.some(publishesDirectly)).toBe(false);
    expect(ran.some(verifies)).toBe(false);
    expect(ran.some(finalizes)).toBe(false);
  });

  it("on a dispatch with none pending, publishes through the action, then verifies and finalizes", () => {
    const ran = stepsRun("workflow_dispatch", { pending: false });
    expect(ran.some(isChangesetsAction)).toBe(true);
    expect(ran.some(publishesDirectly)).toBe(false);
    expect(ran.some(verifies)).toBe(true);
    expect(ran.some(finalizes)).toBe(true);
  });

  it("on a dispatch asked to publish, publishes the current manifests directly with changesets pending, then verifies and finalizes", () => {
    // The recovery path after a partial publish: the action would version
    // the pending changesets instead, and the failed version would never finish.
    const ran = stepsRun("workflow_dispatch", { pending: true, publish: true });
    expect(ran.some(publishesDirectly)).toBe(true);
    expect(ran.some(isChangesetsAction)).toBe(false);
    expect(ran.some(verifies)).toBe(true);
    expect(ran.some(finalizes)).toBe(true);
  });

  it("offers that publish as a dispatch input that is off unless chosen", () => {
    expect(triggersOf(workflow).workflow_dispatch?.inputs?.publish).toMatchObject({ type: "boolean", default: false });
  });

  it("publishes on a push with the environment the action publishes with", () => {
    const direct = job.steps.find(publishesDirectly);
    const action = job.steps.find(isChangesetsAction);
    expect(direct?.env).toEqual(action.env);
    expect(String(direct?.run)).toContain(action.with.publish);
  });

  /*
   * A Release run whose only job skipped concludes `success`, as a skipped job
   * reports success, so Release health tells the runs apart by what started
   * them: every value below is one a real `workflow_run` payload carries,
   * conclusion included.
   */
  const releaseRun = ({ event = "push", branch = "main", message = "fix(nextly): type the send-test error (#2563)" } = {}) => ({
    "github.event_name": "workflow_run",
    "github.event.workflow_run.conclusion": "success",
    "github.event.workflow_run.event": event,
    "github.event.workflow_run.head_branch": branch,
    "github.event.workflow_run.head_commit.message": message,
  });

  it("runs Release health after a Release run that released, or was dispatched, from main", () => {
    expect(decide(health, releaseRun({ message: "chore: version packages (alpha) (#2600)" }))).toBe("true");
    expect(decide(health, releaseRun({ event: "workflow_dispatch", message: "fix(nextly): anything (#1)" }))).toBe("true");
  });

  it("skips Release health after an ordinary push, whose skipped job still concludes success", () => {
    expect(decide(health, releaseRun())).toBe("false");
  });

  it("skips Release health after a dispatch from another ref", () => {
    for (const branch of ["feature/try-a-release", "v0.0.2-alpha.66"]) {
      expect(decide(health, releaseRun({ event: "workflow_dispatch", branch })), branch).toBe("false");
    }
  });

  it("runs Release health on its schedule and on its own dispatch, and never in a fork", () => {
    expect(decide(health, { "github.event_name": "schedule" })).toBe("true");
    expect(decide(health, { "github.event_name": "workflow_dispatch" })).toBe("true");
    expect(decide(health, { ...releaseRun({ event: "workflow_dispatch" }), "github.repository": "someone/nextly" })).toBe("false");
  });
});

describe("a Version Packages pull request that went stale", () => {
  /*
   * A public package added to `main` after that pull request was last
   * refreshed keeps its old version while every other package takes the next
   * one, and the merge's publish would then refuse the release. The queue's
   * run checks the combined tree, so the check there keeps it from merging.
   */
  const steps = read(".github/workflows/ci.yml").jobs.ci.steps;
  const step = steps.find(candidate => /\bnode scripts\/release\/check-lockstep\.mjs\b/.test(String(candidate.run)));

  it("checks every pull request's and every queued group's packages share one version", () => {
    expect(step, "a ci step runs check-lockstep.mjs").toBeDefined();
    expect(String(step.if)).not.toMatch(/event_name/);
  });
});

describe("Turborepo's shared remote cache", () => {
  /*
   * Only `main`'s pushes and the merge queue write to it: every later run
   * starts from what they built, and a pull request's own build must not
   * become an entry another pull request replays. TURBO_CACHE asks for that,
   * but the code under test could ask otherwise, so the credentials are
   * secrets of an environment GitHub admits only those refs to. Each
   * expression is evaluated for the events it meets, not read by spelling.
   */
  const valueOf = (template, known) => {
    const expression = String(template);
    return evaluate(conditionTokens(expression), expression, known);
  };
  const MAIN = { "github.event_name": "push", "github.ref": "refs/heads/main" };
  const QUEUE = { "github.event_name": "merge_group", "github.ref": "refs/heads/gh-readonly-queue/main/pr-1-abc" };
  const PULL = { "github.event_name": "pull_request", "github.ref": "refs/pull/1/merge" };
  const DISPATCH = { "github.event_name": "workflow_dispatch", "github.ref": "refs/heads/main" };
  const SECRETS = { "secrets.turbo_token": "t", "secrets.turbo_remote_cache_signature_key": "k".repeat(64) };
  const CREDENTIAL = /\bsecrets\.TURBO_(TOKEN|REMOTE_CACHE_SIGNATURE_KEY)\b/;

  for (const path of [".github/workflows/ci.yml", ".github/workflows/integration.yml"]) {
    const workflow = read(path);
    const holders = Object.entries(workflow.jobs).filter(([, job]) => CREDENTIAL.test(JSON.stringify(job.env ?? {})));

    it(`${path}: main and the queue write, every other run only reads`, () => {
      expect(valueOf(workflow.env.TURBO_CACHE, MAIN)).toBe("local:rw,remote:rw");
      expect(valueOf(workflow.env.TURBO_CACHE, QUEUE)).toBe("local:rw,remote:rw");
      expect(valueOf(workflow.env.TURBO_CACHE, PULL)).toBe("local:rw,remote:r");
      expect(valueOf(workflow.env.TURBO_CACHE, DISPATCH)).toBe("local:rw,remote:r");
    });

    it(`${path}: reads the credentials only inside jobs, never at the workflow level`, () => {
      expect(JSON.stringify(workflow.env ?? {})).not.toMatch(CREDENTIAL);
      expect(holders.length, "jobs that hold the cache credentials").toBeGreaterThan(0);
    });

    it(`${path}: every job holding them names the write environment only on main and in the queue`, () => {
      for (const [name, job] of holders) {
        expect(job.environment, name).toMatchObject({ deployment: false });
        expect(valueOf(job.environment.name, MAIN), name).toBe("turbo-cache");
        expect(valueOf(job.environment.name, QUEUE), name).toBe("turbo-cache");
        expect(valueOf(job.environment.name, PULL), name).toBe("turbo-cache-read");
        expect(valueOf(job.environment.name, DISPATCH), name).toBe("turbo-cache-read");
      }
    });

    it(`${path}: hands turbo the token only with a signing key beside it`, () => {
      for (const [name, job] of holders) {
        expect(valueOf(job.env.TURBO_TOKEN, { ...MAIN, ...SECRETS }), name).toBe("t");
        expect(valueOf(job.env.TURBO_TOKEN, { ...MAIN, ...SECRETS, "secrets.turbo_remote_cache_signature_key": "" }), name).toBe("");
      }
    });
  }

  it("signs every artifact", () => {
    const config = load(
      readFileSync(new URL("../turbo.jsonc", import.meta.url), "utf8")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\s\/\/ .*$/gm, "")
    );
    expect(config.remoteCache).toMatchObject({ signature: true });
  });

  it("is never used by a release, which builds what it publishes from its own checkout", () => {
    expect(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")).not.toMatch(/TURBO_(TOKEN|TEAM|API)\b/);
  });
});

describe("a dispatched run and the push run of one commit", () => {
  /*
   * main-catch-up.yml dispatches CI and Integration on a commit whose push run
   * may still be queued. Sharing one group, whichever started later cancelled
   * the other, and the commit lost the run meant to test it. Each workflow's
   * group and cancellation are evaluated for both events on one commit.
   */
  const valueFor = (workflow, template, event) =>
    String(template).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) =>
      String(evaluate(conditionTokens(expression), expression, { "github.workflow": workflow.name, "github.event_name": event, "github.ref": "refs/heads/main", "github.sha": "s1", "github.event.pull_request.number": null }))
    );

  it.each([".github/workflows/ci.yml", ".github/workflows/integration.yml"])("%s keeps them in separate groups, and a dispatch cancels nothing", path => {
    const workflow = read(path);
    const { group, "cancel-in-progress": cancels } = workflow.concurrency;
    expect(valueFor(workflow, group, "workflow_dispatch")).not.toBe(valueFor(workflow, group, "push"));
    expect(valueFor(workflow, cancels, "workflow_dispatch")).toBe("false");
  });
});

describe("a sharded leg", () => {
  /*
   * The lane check takes a matrix job that hands the lane its own shard as
   * calling the lane (scripts/check-test-lanes.mjs), in whichever workflow it
   * reads. That is true only when the matrix lists every shard, 1 to n, has no
   * other axis (which would make `strategy.job-total` count combinations, and
   * hand out some shards twice and others never), and none is cancelled
   * because another failed: then between them the jobs run all of it.
   */
  it("runs every shard of the lane it hands out, in every workflow", async () => {
    const { MATRIX_SHARD } = await import("./check-test-lanes.mjs");
    const dir = new URL("../.github/workflows/", import.meta.url);
    const sharded = readdirSync(dir)
      .filter(name => /\.ya?ml$/.test(name))
      .flatMap(name =>
        Object.entries(read(`.github/workflows/${name}`).jobs ?? {})
          .filter(([, job]) => (job.steps ?? []).some(step => String(step.run).includes(MATRIX_SHARD.trim())))
          .map(([id, job]) => [`${name}#${id}`, job])
      );
    // A floor: every integration leg is sharded.
    expect(sharded.map(([id]) => id).sort()).toEqual([
      "integration.yml#integration-mysql-shards",
      "integration.yml#integration-postgres-shards",
      "integration.yml#integration-sqlite-shards",
    ]);
    for (const [id, job] of sharded) {
      const matrix = job.strategy?.matrix ?? {};
      expect(Object.keys(matrix), id).toEqual(["shard"]);
      const shards = matrix.shard;
      expect(shards, id).toEqual(Array.from({ length: shards.length }, (_, i) => i + 1));
      expect(shards.length, id).toBeGreaterThanOrEqual(2);
      expect(job.strategy["fail-fast"], id).toBe(false);
    }
  });

  /*
   * Turbo hands every package of the lane the same `--shard`, and vitest
   * refuses a shard count larger than a package's number of test files unless
   * the package passes with none: a one-file suite fails each shard before a
   * test runs. So each package either has a file for every shard or lets an
   * empty shard pass. The packages are read from the lane's own `--filter`s.
   */
  it("hands the shard only to packages that have a file for every shard, or pass with none", async () => {
    const { MATRIX_SHARD } = await import("./check-test-lanes.mjs");
    const lanes = readJson("package.json").scripts;
    const dirs = packageDirsByName();
    const legs = Object.values(read(".github/workflows/integration.yml").jobs).flatMap(job => shardedLane(job, MATRIX_SHARD.trim()));
    const checked = [];
    for (const { lane, shards } of legs) {
      for (const [, name] of String(lanes[lane]).matchAll(/--filter=['"]?([^'"\s]+)/g)) {
        const dir = dirs.get(name);
        expect(dir, `${lane} names ${name}, which no package is`).toBeDefined();
        const suite = integrationSuite(dir);
        // The one include every integration config uses, so the count is the
        // set vitest shards; another pattern fails here, not silently.
        expect(suite.config, dir).toMatch(/include: \["src\/\*\*\/\*\.integration\.test\.ts"\]/);
        expect(suite.files >= shards || suite.passesWithNone, `${dir}: ${suite.files} file(s) for ${shards} shards of ${lane}`).toBe(true);
        checked.push(dir);
      }
    }
    // A floor, so a reader that matched no lane cannot pass by checking nothing.
    expect(checked.length).toBeGreaterThanOrEqual(3);
  });
});

/** Each workspace package's directory, by the name its manifest gives it. */
function packageDirsByName() {
  return new Map(
    readdirSync(new URL("../packages/", import.meta.url))
      .filter(dir => existsSync(new URL(`../packages/${dir}/package.json`, import.meta.url)))
      .map(dir => [readJson(`packages/${dir}/package.json`).name, `packages/${dir}`])
  );
}

/** The lane a job hands its matrix shard and how many shards it has, or none. */
function shardedLane(job, handOff) {
  const line = (job.steps ?? []).flatMap(step => String(step.run).split("\n")).find(text => text.includes(handOff));
  return line ? [{ lane: /pnpm (\S+) --/.exec(line)[1], shards: job.strategy.matrix.shard.length }] : [];
}

/** A package's integration config, its file count, and whether a shard with no file passes. */
function integrationSuite(dir) {
  const script = readJson(`${dir}/package.json`).scripts["test:integration"];
  const config = readFileSync(new URL(`../${dir}/${/--config (\S+)/.exec(script)[1]}`, import.meta.url), "utf8");
  const files = readdirSync(new URL(`../${dir}/src/`, import.meta.url), { recursive: true }).filter(file => String(file).endsWith(".integration.test.ts"));
  return { config, files: files.length, passesWithNone: script.includes("--passWithNoTests") || /^\s*passWithNoTests: true\b/m.test(config) };
}

describe("a sharded leg's required check", () => {
  /*
   * The required check reads the shards' result and fails unless every shard
   * passed. It must run whatever happened to them: a shard stopped by its own
   * backstop is cancelled, and a verdict guarded by `!cancelled()` could then
   * be skipped, which the merge gate reads as a pass. So it runs under
   * `always()`, with the same conditions as the shards otherwise.
   */
  it("runs whatever happened to the shards, on the shards' own conditions", () => {
    const workflow = read(".github/workflows/integration.yml");
    const verdicts = Object.entries(workflow.jobs).filter(([, job]) =>
      (job.needs ?? []).some?.(need => String(need).endsWith("-shards"))
    );
    expect(verdicts.map(([id]) => id).sort()).toEqual(["integration-mysql", "integration-postgres", "integration-sqlite"]);
    for (const [id, job] of verdicts) {
      const shards = workflow.jobs[`${id}-shards`];
      expect(String(job.if), id).toMatch(/^\$\{\{\s*always\(\)/);
      expect(String(job.if), id).not.toMatch(/cancelled\(\)/);
      expect(String(job.if).replace(/always\(\)/, ""), id).toBe(String(shards.if).replace(/!cancelled\(\)/, ""));
    }
  });
});

describe("the MySQL leg's database", () => {
  /*
   * The core suite commits many small transactions, and MySQL's default
   * durability made the leg wait on disk writes until it overran its budget
   * with every test green. The leg relaxes it before the suite runs.
   */
  it("enlarges the redo log and stops forcing each commit to disk before the suite starts", () => {
    // The job that runs the MySQL lane, whatever it is called.
    const job = Object.values(read(".github/workflows/integration.yml").jobs).find(candidate =>
      (candidate.steps ?? []).some(step => /\blane:test:integration:mysql\b/.test(String(step.run)))
    );
    const steps = job.steps.map(step => step.name);
    const room = job.steps.findIndex(step => step.name === "Give the test database room to write");
    const suite = job.steps.findIndex(step => step.name === "Run integration tests (mysql)");
    expect(room, steps.join(", ")).toBeGreaterThanOrEqual(0);
    expect(room).toBeLessThan(suite);
    for (const setting of ["innodb_redo_log_capacity = 1073741824", "innodb_flush_log_at_trx_commit = 2", "sync_binlog = 0"]) {
      expect(job.steps[room].run).toContain(setting);
    }
  });
});

describe("conditions that skip the queue's run", () => {
  /*
   * A step that runs on a pull request's own run but not in the queue is
   * skipped there while its job still reports success, and a job like that
   * reports `skipped`, which the gate accepts; either way the queue would merge
   * on a check that did less there than it does for a pull request. So no
   * condition in a job a required check stands on may run for a pull request's
   * event and not for the queue's.
   */
  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    it(`${path} does in the queue whatever it does on a pull request, in every job its required checks stand on`, () => {
      const workflow = read(path);
      expect(skippedInTheQueue(workflow, requiredJobs(workflow, checks))).toEqual([]);
    });
  }

  it("decides a condition by evaluating it for each event, not by its spelling", () => {
    const skips = [
      "github.event_name == 'pull_request'",
      "${{ always() && github.event_name == 'pull_request_target' }}",
      "github.event_name != 'merge_group'",
      "!(github.event_name == 'merge_group')",
      "contains(fromJSON('[\"push\", \"pull_request\"]'), github.event_name)",
      "startsWith(github.event_name, 'pull_request')",
      "GITHUB.EVENT_NAME == 'Pull_Request'",
      // False in the queue whatever the unknown side is.
      "needs.changes.outputs.inert != 'true' && github.event_name == 'pull_request'",
      // Runs for a pull request whatever the output is, and in the queue only for some of its values.
      "needs.changes.outputs.inert != 'true' || github.event_name == 'pull_request'",
      "!cancelled() || github.event_name == 'pull_request'",
      // An output between two numbers, and two calls of one function that may differ.
      "needs.x.outputs.n > 5 && needs.x.outputs.n < 10 && github.event_name == 'pull_request'",
      "hashFiles('a') != hashFiles('b') && github.event_name == 'pull_request'",
      // A call may return text, and what it returns for the event its arguments read; run on the values tried for an unknown, it skips where one of them does.
      "format('{0}', needs.changes.outputs.flag) == 'ready' && github.event_name == 'pull_request'",
      "format('{0}', github.event_name) == 'pull_request'",
      // An output holding neither text, both at once, or the event's name.
      "contains(needs.changes.outputs.flags, 'e') || github.event_name == 'pull_request'",
      "contains(needs.changes.outputs.flags, 'a') && contains(needs.changes.outputs.flags, 'b') && github.event_name == 'pull_request'",
      "needs.changes.outputs.target == github.event_name",
      // An output read as JSON, where text that is not JSON decides nothing.
      "fromJSON(needs.changes.outputs.run) && github.event_name == 'pull_request'",
      // The queue's payload holds no pull request, so a condition on one can skip it without reading the event's name.
      "github.event.pull_request.head.repo.full_name == github.repository",
      // Any other name under `github` may differ between the runs.
      "github.event.action == 'synchronize'",
      // One output that must pass two text tests at once, of literals or of the event's name.
      "startsWith(needs.x.outputs.value, 'a') && endsWith(needs.x.outputs.value, 'b') && github.event_name == 'pull_request'",
      "startsWith(needs.x.outputs.v, github.event_name) && endsWith(needs.x.outputs.v, 'b') && github.event_name != 'merge_group'",
      // `format` reads `{{` and `}}` as braces.
      "format('{{{0}}}', github.event_name) == '{pull_request}'",
      // A function GitHub runs is run here from its arguments, the event's name among them.
      "toJSON(github.event_name) == '\"pull_request\"'",
    ];
    const runs = [
      "",
      "github.event_name == 'pull_request' || github.event_name == 'merge_group'",
      "github.event_name == 'merge_group'",
      // Runs on neither, so it does no less in the queue.
      "github.event_name == 'push'",
      // Turns on an output alone, which reads the same for both events.
      "!cancelled()",
      "needs.changes.outputs.inert != 'true'",
      // Runs in the queue whenever it runs for a pull request, whatever the output is.
      "needs.changes.outputs.inert != 'true' || github.event_name == 'merge_group'",
      "needs.changes.outputs.inert == 'false' && (github.event_name == 'pull_request' || github.event_name == 'merge_group')",
      // Never reads the event's name, however many outputs it reads: nothing to try.
      Array.from({ length: 12 }, (_, n) => `needs.job${n}.result == 'success'`).join(" && "),
      // A pull request's fields are null in the queue; null equals false, and reads as empty text, not as the word null.
      "github.event.pull_request.head.repo.fork == false",
      "github.event.pull_request.head.repo.fork == false || startsWith(github.event_name, 'pull_request')",
      "!contains(github.event.pull_request.title, 'null')",
      // The queue group's fields are null in a pull request's run, so this runs in the queue alone.
      "github.event.merge_group.base_sha != ''",
      // The repository's own names read alike in both runs.
      "github.repository == 'nextlyhq/nextly'",
      // So do the names the workflow file fixes.
      "github.workflow == 'CI'",
      // `format` runs from its arguments: this runs in the queue alone, and this in both.
      "format('{0}', github.event_name) == 'merge_group'",
      "format('{0}', github.event_name) != ''",
      // `join` and `toJSON` run from their arguments too, so these hold in both runs; an unknown result would not.
      "join(fromJSON('[\"a\", \"b\"]'), '-') == 'a-b' || github.event_name == 'pull_request'",
      "toJSON('a') == '\"a\"' || github.event_name == 'pull_request'",
      // Whatever a function makes of an unknown, this runs in the queue.
      "format('x{0}', needs.x.outputs.v) != 'xa' || github.event_name == 'merge_group'",
    ];
    for (const condition of skips) expect(skipsTheQueue(condition), condition).toBe(true);
    for (const condition of runs) expect(skipsTheQueue(condition), condition).toBe(false);
  });

  it("refuses a condition it cannot read, rather than passing it", () => {
    expect(() => skipsTheQueue("github.event_name == 'pull_request' &&")).toThrow(/cannot read the condition/);
    expect(() => skipsTheQueue("github.event_name == ")).toThrow(/cannot read the condition/);
    expect(() => skipsTheQueue("github.event_name 'pull_request'")).toThrow(/cannot read the condition/);
    // Whatever it reads: one that reads nothing of the event is read too.
    expect(() => skipsTheQueue("needs.changes.outputs.inert ==")).toThrow(/cannot read the condition/);
  });

  // Every assignment of twelve outputs is far too many to try; the condition is refused, not passed.
  it("refuses a condition with too many unknowns to decide, rather than passing it", () => {
    const many = [...Array.from({ length: 12 }, (_, n) => `needs.job${n}.result == 'success'`), "github.event_name == 'pull_request'"].join(" && ");
    expect(() => skipsTheQueue(many)).toThrow(/cannot decide the condition/);
    // A call this evaluator does not run, reading the event, could return anything in each run.
    expect(() => skipsTheQueue("hashFiles(github.event_name) != ''")).toThrow(/cannot decide the condition.*reads the event/);
    // So could a function run on a name that differs between the runs, whose value there is no value tried.
    expect(() => skipsTheQueue("format('x{0}', github.event.action) == 'xopened'")).toThrow(/cannot decide the condition.*reads the event/);
    // Run on an unknown, a function may make the literal it is compared with from a value no value tried is, as these do,
    // or never make it, as the last does; which of the two cannot be told, so both are refused, neither passed nor failed.
    const transformed = [
      "format('x{0}', needs.x.outputs.v) != 'xa' || github.event_name == 'pull_request'",
      "fromJSON(needs.x.outputs.v) != 'xa' || github.event_name == 'pull_request'",
      "toJSON(needs.x.outputs.v) != '\"a\"' || github.event_name == 'pull_request'",
      "join(fromJSON('[\"a\", \"b\"]'), needs.x.outputs.separator) != 'a+b' || github.event_name == 'pull_request'",
      "format('x{0}', needs.x.outputs.v) == 'y' && github.event_name == 'pull_request'",
      // Nor where the call's value is tied to its argument's, which the call read as a value of its own is not:
      // both of these run in the queue whatever the output is, and neither is failed as a skip.
      "format('{0}', needs.x.outputs.v) != 'a' || needs.x.outputs.v != 'b' || github.event_name == 'pull_request'",
      "format('x{0}', needs.x.outputs.v) != 'xa' || needs.x.outputs.v == 'a' || github.event_name == 'pull_request'",
    ];
    for (const condition of transformed) expect(() => skipsTheQueue(condition), condition).toThrow(/cannot decide the condition.*makes a value no value tried/);
    // Three text tests of one value may need a value no two literals make.
    const threeTests = "startsWith(needs.x.outputs.v, 'a') && contains(needs.x.outputs.v, 'b') && endsWith(needs.x.outputs.v, 'c') && github.event_name == 'pull_request'";
    expect(() => skipsTheQueue(threeTests)).toThrow(/cannot decide the condition.*3 text tests/);
  });

  it("reads a gate's dependencies as part of it, and leaves a job no required check stands on out", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(requiredJobs(ci, QUEUE_CHECKS[".github/workflows/ci.yml"])).toEqual(expect.arrayContaining(["gate", "ci", "changes", "comments"]));
    const small = read(".github/workflows/small-checks.yml");
    expect(requiredJobs(small, QUEUE_CHECKS[".github/workflows/small-checks.yml"])).toEqual(["checks"]);
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

/** The given jobs, and the steps in them, whose condition skips the queue's run. */
function skippedInTheQueue(workflow, ids) {
  return ids.flatMap(id => [...skippingJob(id, workflow.jobs[id]), ...skippingSteps(id, workflow.jobs[id])]);
}

function skippingJob(id, job) {
  return skipsTheQueue(String(job.if ?? "")) ? [id] : [];
}

function skippingSteps(id, job) {
  return (job.steps ?? []).filter(step => skipsTheQueue(String(step.if ?? ""))).map(step => `${id}: ${step.name}`);
}

/**
 * Whether a condition can run for a pull request's event, `pull_request` or
 * `pull_request_target`, and not for the queue's. It is evaluated, not matched
 * by its spelling. Each name and call it reads but does not know is given, in
 * turn, each value that could change its outcome, and it skips the queue if
 * any one assignment runs it for a pull request and not in the queue. Most
 * names read alike in both runs, so a condition that turns on an output alone
 * is no skip, while one that runs for a pull request whatever the output is,
 * and in the queue only for some of its values, is. The event's own names do
 * not (`readingOf`), and a condition that reads none of them, nor the event's
 * name, reads alike in both runs under any one assignment, so it needs none
 * tried. Every condition is read once first, so one that cannot be read is
 * refused whatever it reads. A function this evaluator runs is run on the
 * values tried for its arguments, so a skip found that way is one; where an
 * argument is unknown, `skipsThroughATransform` decides what that search could
 * not reach.
 */
function skipsTheQueue(condition) {
  const tokens = conditionTokens(condition);
  evaluate(tokens, condition, {});
  if (!tokens.some(readsTheEvent)) return false;
  textTestsDecidable(tokens, condition);
  return skipFound(tokens, condition, readingsIn(tokens, condition, unknownName)) || skipsThroughATransform(tokens, condition);
}

/** Whether any assignment of the given readings runs the condition for a pull request and not in the queue. */
function skipFound(tokens, condition, readings) {
  for (const values of assignments(condition, readings, candidateValues(literalsIn(tokens)))) if (skipsUnder(tokens, condition, readings, values)) return true;
  return false;
}

/**
 * A condition that calls a function that `transforms` on an unknown, when no value
 * tried for the unknown skips the queue. The call may still make a value no
 * value tried makes it make, as `format('x{0}', v)` makes `xa` only from `a`,
 * so it is tried again with each call's result as an unknown of its own, which
 * over-reaches: every value the call can make is among those tried, and so are
 * some it cannot, since `format('x{0}', v)` never makes `y`. No skip then is
 * none; a skip then may need a value the call cannot make, so the condition
 * is refused as undecidable rather than passed or failed on a guess.
 */
function skipsThroughATransform(tokens, condition) {
  const calls = tokens.flatMap((token, at) => (transformsAnUnknown(tokens, at) ? [callKey(token.name, argumentsOf(tokens, at))] : []));
  if (calls.length === 0 || !skipFound(tokens, condition, readingsIn(tokens, condition, readsAnUnknown))) return false;
  throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: it skips the queue only if ${calls.join(" or ")} makes a value no value tried for its arguments makes it make`);
}

const PULL_REQUEST_EVENTS = ["pull_request", "pull_request_target"];
const QUEUE_EVENT = "merge_group";

function skipsUnder(tokens, condition, readings, values) {
  const outcome = (run, event) => truth(evaluate(tokens, condition, { ...knownIn(run, readings, values), "github.event_name": event }));
  return PULL_REQUEST_EVENTS.some(event => outcome("pull request", event) !== false) && outcome("queue", QUEUE_EVENT) === false;
}

/** Whether a function tests text (`FUNCTIONS`), so that one value may have to pass several of its tests at once. */
const testsText = name => Object.hasOwn(FUNCTIONS, name) && FUNCTIONS[name].tests === true;

/**
 * Refuses a condition that holds one unknown to more text tests than its
 * values can pass together. A value is tried joined from two text literals at
 * most, which passes any two tests at once where one value can, so a third
 * test of the same value may need a value that is never tried.
 */
function textTestsDecidable(tokens, condition) {
  const counts = new Map();
  for (const name of textTestOperands(tokens)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const crowded = [...counts].find(([, count]) => count > 2);
  if (crowded) throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: it holds ${crowded[0]} to ${crowded[1]} text tests`);
}

/** Each unknown a text test reads, once for every test that reads it. */
const textTestOperands = tokens => tokens.flatMap((token, at) => (isTextTest(tokens, at) ? [...new Set(argumentsOf(tokens, at).filter(isUnknownName).map(nameOf))] : []));

const isTextTest = (tokens, at) => testsText(nameOf(tokens[at])) && tokens[at + 1] === "(";

/** What one run reads under an assignment: each unknown's value there, fixed or the one its choice was given. */
function knownIn(run, readings, values) {
  return Object.fromEntries(readings.map(({ key, runs }) => [key, "value" in runs[run] ? runs[run].value : values[runs[run].choice]]));
}

/** The names the repository or the workflow file fixes, which read alike in both runs. */
const FIXED_NAMES = new Set([
  "github.repository",
  "github.repository_id",
  "github.repository_owner",
  "github.repository_owner_id",
  "github.workflow",
  "github.job",
  "github.server_url",
  "github.api_url",
  "github.graphql_url",
]);

/** Objects one run's payload lacks, so that every name under one reads as null in that run. */
const ABSENT = [
  ["github.event.pull_request", "queue"],
  ["github.event.merge_group", "pull request"],
];

/**
 * How the two runs read a name. Any name under `github` may differ between
 * them, apart from those the repository or the workflow file fixes, so each
 * run takes a value of its own; the queue's payload holds no pull request and
 * a pull request's holds no queue group, so a name under either is null in the
 * run without it. Every other name, such as an output, reads alike in both.
 */
function readingOf(name) {
  const reading = differsBetweenRuns(name) ? ownInEach(name) : sharedBy(name);
  for (const [object, run] of ABSENT) if (within(name, object)) reading[run] = { value: null };
  return reading;
}

const differsBetweenRuns = name => within(name, "github") && !FIXED_NAMES.has(name);

const within = (name, object) => name === object || name.startsWith(`${object}.`);

const own = (run, key) => ({ choice: `${run}: ${key}` });

const ownInEach = key => ({ "pull request": own("pull request", key), queue: own("queue", key) });

const sharedBy = key => ({ "pull request": { choice: key }, queue: { choice: key } });

/** Whether a token reads the event: its name, or a name the two runs read differently. */
const readsTheEvent = token => nameOf(token) === "github.event_name" || (isUnknownName(token) && differs(readingOf(nameOf(token))));

const differs = reading => reading.queue.choice !== reading["pull request"].choice;

/** A value equal to no literal a condition could compare it with, as a number or as text. */
const NONE_OF_THEM = "none of the condition's values";

/** More assignments than this are not tried: the condition is refused as undecidable, not passed. */
const MOST_ASSIGNMENTS = 20_000;

/**
 * Every assignment of candidate values to the choices the readings make, made
 * one at a time so the first that skips the queue ends the search. A name both
 * runs share is one choice, and a name each run reads for itself is one in
 * each. A call read as an unknown is a choice too, and may return any of the
 * values, text as well as `true` and `false`.
 */
function* assignments(condition, readings, values) {
  const choices = [...new Set(readings.flatMap(({ runs }) => Object.values(runs).flatMap(run => ("choice" in run ? [run.choice] : []))))];
  const count = values.length ** choices.length;
  if (count > MOST_ASSIGNMENTS) throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: ${count} assignments of what it reads but does not know`);
  yield* assigned(choices, values, 0, {});
}

function* assigned(choices, values, index, assignment) {
  if (index === choices.length) return yield assignment;
  for (const value of values) yield* assigned(choices, values, index + 1, { ...assignment, [choices[index]]: value });
}

/**
 * The values each choice is tried with: each literal the condition holds and
 * each event's name, which a name may be compared with too; a number below,
 * between and above its numeric ones; `true`, `false`, empty text, which every
 * text starts with, ends with and contains, and a value equal to none of them;
 * and each ordered pair of its texts run together, its literals and the
 * events' names, so that any two tests of one value that one value can pass
 * together are passed. Between them they give each comparison every outcome it
 * can have.
 */
function candidateValues(literals) {
  const numbers = [...new Set(literals.filter(value => value !== "").map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const between = numbers.slice(1).map((number, at) => (numbers[at] + number) / 2);
  const around = numbers.length > 0 ? [numbers[0] - 1, numbers.at(-1) + 1] : [];
  const texts = [...new Set([...literals.filter(value => typeof value === "string"), ...PULL_REQUEST_EVENTS, QUEUE_EVENT])];
  const pairs = texts.flatMap(first => texts.map(second => first + second));
  return [...new Set([...literals, ...PULL_REQUEST_EVENTS, QUEUE_EVENT, ...between, ...around, true, false, "", NONE_OF_THEM, ...pairs])];
}

/** Each name and call a condition reads that `readsAsUnknown` reads as unknown, with how the two runs read it; a call is keyed by its arguments. */
function readingsIn(tokens, condition, readsAsUnknown) {
  const readings = new Map();
  tokens.forEach((token, at) => {
    if (!readsAsUnknown(tokens, at)) return;
    const [key, runs] = tokens[at + 1] === "(" ? callReading(tokens, at, condition) : [nameOf(token), readingOf(nameOf(token))];
    readings.set(key, runs);
  });
  return [...readings].map(([key, runs]) => ({ key, runs }));
}

/** Whether the token at `at` is a name or a call this evaluator does not know. */
const unknownName = (tokens, at) => isUnknownName(tokens[at]);

/** Whether the token at `at` is read as an unknown where a call's result may be any value: an unknown name, or a call that makes something of one. */
const readsAnUnknown = (tokens, at) => unknownName(tokens, at) || transformsAnUnknown(tokens, at);

/** Whether a function this evaluator runs makes text or a value of its arguments: every one of `FUNCTIONS` that does not test them. */
const transforms = name => Object.hasOwn(FUNCTIONS, name) && FUNCTIONS[name].tests !== true;

/**
 * Whether the token at `at` calls a function that `transforms` on an argument that
 * holds an unknown. The values an unknown is tried with give every comparison
 * of that unknown each outcome it can have, but not every comparison of what a
 * function makes of it: `format('x{0}', v) == 'xa'` holds only where `v` is
 * `a`, and no value tried is (`skipsThroughATransform`). On arguments it
 * knows, such as the event's name, the call is only ever run.
 */
const transformsAnUnknown = (tokens, at) => transforms(nameOf(tokens[at])) && tokens[at + 1] === "(" && argumentsOf(tokens, at).some(isUnknownName);

/**
 * A call's key and reading, for a call read as an unknown. Its result is read
 * alike in both runs; one whose arguments read the event could return
 * something different in each, which no value given here would stand for, so
 * the condition is refused rather than decided on an invented result.
 */
function callReading(tokens, at, condition) {
  const argumentTokens = argumentsOf(tokens, at);
  const key = callKey(tokens[at].name, argumentTokens);
  if (argumentTokens.some(readsTheEvent)) throw new Error(`cannot decide the condition ${JSON.stringify(condition)}: ${key} reads the event, and what it returns is not known`);
  return [key, sharedBy(key)];
}

const literalsIn = tokens => tokens.filter(token => typeof token === "object" && "value" in token).map(token => token.value);

function conditionTokens(condition) {
  const text = condition.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").trim();
  return text === "" ? [] : tokenize(text, condition);
}

const nameOf = token => (typeof token === "object" && "name" in token ? token.name.toLowerCase() : undefined);

const isUnknownName = token => nameOf(token) !== undefined && !isKnown(nameOf(token));

const isKnown = key => key === "github.event_name" || Object.hasOwn(LITERALS, key) || Object.hasOwn(FUNCTIONS, key);

/** A call's key: its name and the tokens of its arguments, so two calls of one function with different arguments are two unknowns. */
const callKey = (name, argumentTokens) => `${name.toLowerCase()}(${argumentTokens.map(tokenText).join(" ")})`;

const tokenText = token => (typeof token === "string" ? token : (nameOf(token) ?? JSON.stringify(token.value)));

/** The tokens between the parentheses of the call whose name is at `at`. */
const argumentsOf = (tokens, at) => tokens.slice(at + 2, closingParen(tokens, at + 1));

/** The index of the parenthesis that closes the one at `open`. */
function closingParen(tokens, open) {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    depth += depthStep(tokens[at]);
    if (depth === 0) return at;
  }
  return tokens.length;
}

const depthStep = token => (token === "(" ? 1 : token === ")" ? -1 : 0);

const UNKNOWN = Symbol("unknown");
const TOKEN = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|(==|!=|<=|>=|&&|\|\||[!<>(),])|([A-Za-z_][\w-]*(?:\.[\w*-]+)*))/y;
const LITERALS = { true: true, false: false, null: null };
const RELATIONS = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b };

/**
 * The expression functions a condition can be decided by, each with how it
 * runs and whether it tests text (`tests`); every other one makes a value of
 * its arguments (`transforms`), which is also what one added without saying
 * is taken to do, the reading that refuses rather than passes. Any function
 * not here, such as `success()`, is unknown, and so is one that transforms an
 * unknown.
 */
const FUNCTIONS = {
  always: { run: () => true },
  contains: { tests: true, run: (within, item) => (Array.isArray(within) ? within.some(entry => looseEqual(entry, item)) : lower(within).includes(lower(item))) },
  startswith: { tests: true, run: (text, prefix) => lower(text).startsWith(lower(prefix)) },
  endswith: { tests: true, run: (text, suffix) => lower(text).endsWith(lower(suffix)) },
  fromjson: { run: text => parsed(textOf(text)) },
  format: { run: (template, ...values) => formatted(textOf(template), values) },
  join: { run: (array, separator = ",") => (Array.isArray(array) ? array.map(textOf).join(textOf(separator)) : textOf(array)) },
  tojson: { run: value => JSON.stringify(value, null, 2) },
};

/**
 * `format`'s text: each `{n}` replaced by the nth value as text, and `{{` and
 * `}}` by a brace. A reference past the values fails GitHub's evaluation,
 * which decides nothing here.
 */
function formatted(template, values) {
  const references = [...template.matchAll(/\{\{|\}\}|\{(\d+)\}/g)].filter(match => match[1] !== undefined);
  if (references.some(match => Number(match[1]) >= values.length)) return UNKNOWN;
  return template.replace(/\{\{|\}\}|\{(\d+)\}/g, (match, index) => (index === undefined ? match[0] : textOf(values[Number(index)])));
}

/** A JSON document's value; text that is not one fails GitHub's evaluation, which decides nothing here. */
function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return UNKNOWN;
  }
}

/** A condition's value from its tokens (`conditionTokens`); no condition always runs. */
function evaluate(tokens, condition, known) {
  if (tokens.length === 0) return true;
  const parser = { tokens, at: 0, known, condition };
  const value = parseOr(parser);
  if (parser.at !== parser.tokens.length) unreadable(parser.condition);
  return value;
}

function tokenize(text, condition) {
  const pattern = new RegExp(TOKEN.source, "y");
  const tokens = [];
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text) ?? unreadable(condition);
    tokens.push(tokenOf(match));
  }
  return tokens;
}

function tokenOf([, string, number, operator, name]) {
  if (string !== undefined) return { value: string.slice(1, -1).replaceAll("''", "'") };
  if (number !== undefined) return { value: Number(number) };
  return operator ?? { name };
}

function unreadable(condition) {
  throw new Error(`cannot read the condition ${JSON.stringify(condition)}`);
}

function parseOr(parser) {
  let left = parseAnd(parser);
  while (take(parser, "||")) left = or3(left, parseAnd(parser));
  return left;
}

function parseAnd(parser) {
  let left = parseEquality(parser);
  while (take(parser, "&&")) left = and3(left, parseEquality(parser));
  return left;
}

function parseEquality(parser) {
  let left = parseRelation(parser);
  for (let operator = takeAny(parser, ["==", "!="]); operator; operator = takeAny(parser, ["==", "!="])) {
    const equal = operator === "==";
    left = known2(left, parseRelation(parser), (a, b) => looseEqual(a, b) === equal);
  }
  return left;
}

function parseRelation(parser) {
  let left = parseUnary(parser);
  for (let operator = takeAny(parser, Object.keys(RELATIONS)); operator; operator = takeAny(parser, Object.keys(RELATIONS))) {
    const relation = RELATIONS[operator];
    left = known2(left, parseUnary(parser), (a, b) => relation(Number(a), Number(b)));
  }
  return left;
}

function parseUnary(parser) {
  if (!take(parser, "!")) return parsePrimary(parser);
  const operand = parseUnary(parser);
  return operand === UNKNOWN ? UNKNOWN : !operand;
}

function parsePrimary(parser) {
  if (take(parser, "(")) return closed(parser, parseOr(parser));
  const token = nextOperand(parser);
  if ("value" in token) return token.value;
  if (!take(parser, "(")) return lookUp(token.name, parser.known);
  const from = parser.at;
  const values = parseArguments(parser);
  return call(token.name, values, parser.known, callKey(token.name, parser.tokens.slice(from, parser.at - 1)));
}

/** A literal or a name; an operator, or nothing, where one belongs cannot be read. */
function nextOperand(parser) {
  const token = parser.tokens[parser.at];
  if (typeof token !== "object") unreadable(parser.condition);
  parser.at += 1;
  return token;
}

function parseArguments(parser) {
  const values = [];
  if (take(parser, ")")) return values;
  do values.push(parseOr(parser));
  while (take(parser, ","));
  return closed(parser, values);
}

function closed(parser, value) {
  if (!take(parser, ")")) unreadable(parser.condition);
  return value;
}

function take(parser, operator) {
  if (parser.tokens[parser.at] !== operator) return false;
  parser.at += 1;
  return true;
}

function takeAny(parser, operators) {
  return operators.find(operator => take(parser, operator));
}

function lookUp(name, known) {
  const key = name.toLowerCase();
  if (Object.hasOwn(LITERALS, key)) return LITERALS[key];
  return Object.hasOwn(known, key) ? known[key] : UNKNOWN;
}

/** A call's value: one an assignment gave that call (`readsAnUnknown`), one the evaluator can decide, or unknown. */
function call(name, values, known, key) {
  if (Object.hasOwn(known, key)) return known[key];
  const fn = name.toLowerCase();
  return Object.hasOwn(FUNCTIONS, fn) && !values.includes(UNKNOWN) ? FUNCTIONS[fn].run(...values) : UNKNOWN;
}

/** `&&` with an unknown side: false when the other side is, since either way the result is. */
function and3(left, right) {
  if (left === UNKNOWN) return truth(right) === false ? false : UNKNOWN;
  return left ? right : left;
}

/** `||` with an unknown side: true when the other side is, since either way the result is. */
function or3(left, right) {
  if (left === UNKNOWN) return truth(right) === true ? true : UNKNOWN;
  return left || right;
}

function known2(left, right, operation) {
  return left === UNKNOWN || right === UNKNOWN ? UNKNOWN : operation(left, right);
}

/** GitHub's `==`: strings ignore case, and values of different types compare as numbers. */
function looseEqual(a, b) {
  if (typeof a === "string" && typeof b === "string") return lower(a) === lower(b);
  return typeof a === typeof b ? a === b : Number(a) === Number(b);
}

/** A value as text, as GitHub reads one: null is empty. */
const textOf = value => (value === null ? "" : String(value));

function lower(value) {
  return textOf(value).toLowerCase();
}

function truth(value) {
  return value === UNKNOWN ? UNKNOWN : Boolean(value);
}

describe("the independent-review gate", () => {
  const workflow = read(".github/workflows/small-checks.yml");
  const job = workflow.jobs.checks;
  const step = job.steps.find(candidate => candidate.name === "Independent review of the revision being merged");

  /*
   * The queue is where the reviews a pull request will get have had time to
   * arrive, and where the gate decides. It judges from the queue's base with
   * read-only access, so no queued change can rewrite what counts as a review
   * of itself.
   */
  it("decides in the queue, from the queue's base, with read access only", () => {
    expect(step.if).toBe("${{ !cancelled() && github.event_name == 'merge_group' }}");
    const checkout = job.steps.find(candidate => String(candidate.uses).startsWith("actions/checkout@"));
    expect(checkout.with.path).toBeUndefined();
    expect(checkout.with.ref).toBe("${{ github.event.merge_group.base_sha }}");
    expect(checkout.with["fetch-depth"]).toBe("${{ github.event_name == 'merge_group' && '0' || '1' }}");
    expect(workflow.permissions).toEqual({});
    expect(Object.values(job.permissions)).toEqual(["read", "read", "read"]);
    // From the workspace root, the queue base's copy, never the change's.
    expect(step["working-directory"]).toBeUndefined();
    expect(step.run).toBe("node scripts/independent-review.mjs");
  });

  // The job installs no packages, so the script must run with none; that is
  // proven beside the script, by running it from a copy with none above it.
  it("installs no packages for the script it runs", () => {
    expect(job.steps.some(candidate => /\binstall\b/.test(String(candidate.run)) && !/gitleaks/.test(String(candidate.run)))).toBe(false);
  });
});

describe("the title check's permissions", () => {
  const workflow = read(".github/workflows/small-checks.yml");
  const writes = job => Object.values(job.permissions ?? {}).includes("write");
  const titleStep = workflow.jobs.checks.steps.find(step => step.id === "lint_pr_title");

  it("grants nothing at the workflow level, so each job holds only what it declares", () => {
    expect(workflow.permissions).toEqual({});
  });

  it("checks the title with a read-only token", () => {
    const checks = Object.values(workflow.jobs).find(job => job.name === "Small checks (title, AI credit, secret scan, review)");
    expect(writes(checks)).toBe(false);
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
   * In the queue the change's tree holds the queued changes, so a queued
   * change to the validator would judge its own title. The validator comes
   * from the workspace root, checked out at the queue's base, with the history
   * the queued commits are read from.
   */
  it("runs the queue's check from the queue's base, with the queued commits in reach", () => {
    const checkout = workflow.jobs.checks.steps.find(step => String(step.uses).startsWith("actions/checkout@"));
    expect(checkout.with.path).toBeUndefined();
    expect(checkout.with.ref).toBe("${{ github.event.merge_group.base_sha }}");
    expect(checkout.with["fetch-depth"]).toBe("${{ github.event_name == 'merge_group' && '0' || '1' }}");
  });

  // The pull request's head is checked out for the steps that only read it,
  // under its own path; the title's validator never runs from there.
  it("runs the validator from the root's checkout, never the pull request's head", () => {
    expect(titleStep.uses).toBe("./.github/actions/pr-title");
    expect(titleStep["working-directory"]).toBeUndefined();
    const action = read(".github/actions/pr-title/action.yml");
    expect(action.runs.steps[0].run).toBe('node "$GITHUB_WORKSPACE/scripts/pr-title.mjs"');
    const heads = workflow.jobs.checks.steps.filter(step => JSON.stringify(step.with ?? {}).includes("refs/pull/"));
    expect(heads.map(step => step.with.path)).toEqual(["change"]);
  });

  it("hands the script every rule the workflow sets, through the environment", () => {
    const action = read(".github/actions/pr-title/action.yml");
    const env = action.runs.steps[0].env;
    for (const name of ["TYPES", "SCOPES", "REQUIRE_SCOPE", "SUBJECT_PATTERN", "SUBJECT_PATTERN_ERROR"]) {
      expect(Object.keys(env)).toContain(name);
    }
    for (const [input, spec] of Object.entries(action.inputs)) {
      if (spec.required) expect(Object.keys(titleStep.with), input).toContain(input);
    }
  });
});

describe("who owns what the required checks run", () => {
  /*
   * A pull request runs its own copy of every workflow, action, script and
   * configuration a required check uses, so a change to any of them can change
   * what the check decides. `main`'s ruleset requires a code owner's review,
   * and it applies only to a path CODEOWNERS names, so each of them has to
   * have an owner there.
   */
  const rules = codeOwners(readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8"));

  // An owner GitHub cannot resolve, or none at all, leaves a path unowned
  // however well the pattern matches, so each entry names an approved owner.
  it("names only approved owners, on every entry", () => {
    for (const rule of rules) expect(rule.owners.length > 0 && rule.owners.every(owner => APPROVED_OWNERS.includes(owner)), `${rule.pattern} ${rule.owners.join(" ")}`).toBe(true);
  });

  it("owns itself, the hooks, the package scripts and the configuration the checks read", () => {
    for (const path of [".github/CODEOWNERS", ".husky/pre-commit", ".husky/commit-msg", ".husky/pre-push", "package.json", ...CHECK_CONFIGURATION]) {
      expect(ownersOf(rules, path), path).not.toEqual([]);
    }
  });

  for (const [path, checks] of Object.entries(QUEUE_CHECKS)) {
    it(`owns ${path}, and every action and script its required jobs run`, () => {
      const workflow = read(path);
      for (const used of [path, ...pathsRunBy(workflow, requiredJobs(workflow, checks))]) expect(ownersOf(rules, used), used).not.toEqual([]);
    });
  }

  // A lane runs the test script a manifest names, with the configuration
  // beside it, over the task graph Turbo reads, so each of those is a check
  // definition too, wherever it sits.
  it("owns every manifest, task graph, and test, compiler, lint and build configuration in the repository", () => {
    const definitions = trackedFiles().filter(path => LANE_DEFINITIONS.test(path));
    // The control: the walk finds the repository's manifests and configurations, not nothing,
    // and a tsdown configuration by its name alone, as `tsdown` finds one without being told.
    expect(definitions.length).toBeGreaterThan(50);
    expect(definitions).toContain("packages/nextly/tsdown.config.ts");
    // And every Next.js configuration, wherever it sits: the playground's,
    // which the required build builds, and each template's.
    expect(definitions).toEqual(expect.arrayContaining(["apps/playground/next.config.ts", "templates/base/next.config.ts", "templates/plugin/dev/next.config.ts"]));
    for (const path of definitions) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // A configuration runs with whatever it extends or imports, so that is a
  // check definition too; each is found from the configurations themselves.
  it("owns every shared configuration a compiler or lint configuration extends or imports", () => {
    const files = trackedFiles();
    const packages = workspacePackages(files);
    const shared = files.filter(path => SHARING_CONFIGURATION.test(path)).flatMap(path => sharedConfigurationOf(path, packages));
    // The control: the walk reaches the shared packages, not nothing.
    expect(shared.some(path => path.startsWith("packages/tsconfig/"))).toBe(true);
    // And the lint configuration's plugins, a workspace package by name and a
    // module of the repository's own by path.
    expect(shared).toEqual(expect.arrayContaining(["packages/eslint-plugin/package.json", "lint/guards.mjs"]));
    for (const path of new Set(shared)) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // A package's build can run a script or a configuration of its own, named
  // only in its manifest, and what that file does is part of what the check
  // decides.
  it("owns every file a package's own scripts run for the tasks the required checks run", () => {
    const tasks = tasksRequiredChecksRun();
    // The control: the lanes' tasks, and what the task graph adds to them, but no task only a developer runs.
    expect([...tasks]).toEqual(expect.arrayContaining(["build", "check-types", "test", "test:integration", "build:surface-declarations"]));
    expect(tasks.has("dev")).toBe(false);
    // Every task reached is one the task graph defines: a dependency on
    // another package's task (`^build`) or a named package's (`nextly#build`)
    // is that task, never a name of its own that no script answers to.
    const graph = parsedJsonc(readRepositoryFile("turbo.jsonc")).tasks;
    expect([...tasks].filter(task => !Object.hasOwn(graph, task))).toEqual([]);
    const files = trackedFiles();
    const tracked = new Set(files);
    const run = files.filter(path => WORKSPACE_MANIFEST.test(path)).flatMap(manifest => filesTasksRun(manifest, tracked, tasks));
    // The control: the build steps a package runs from its own directory, directly and through `pnpm run`.
    expect(run).toEqual(expect.arrayContaining(["packages/nextly/scripts/postbuild.cjs", "packages/ui/scripts/check-server-safe-artifacts.ts"]));
    for (const path of new Set(run)) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // An owned lint rule can import another module, or read a file beside it,
  // and a change there changes what the rule reports as much as a change to
  // the rule itself.
  it("owns every file an owned lint configuration loads, however deep the chain goes", () => {
    const files = trackedFiles();
    const tracked = new Set(files);
    const loaded = loadedThrough(files.filter(path => LINT_CONFIGURATION.test(path)), tracked);
    // The control: the repository's own rules, which oxlint loads as a plugin, and the allowlists the configuration reads.
    expect(loaded).toEqual(expect.arrayContaining(["lint/guards.mjs", "packages/nextly/bare-error-allowlist.json", "packages/nextly/console-allowlist.json"]));
    for (const path of loaded) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // A setup module runs before every test in its lane, so it can decide what
  // the tests pass on.
  it("owns every setup module a test configuration loads", () => {
    const files = trackedFiles();
    const tracked = new Set(files);
    const setups = files.filter(path => TEST_CONFIGURATION.test(path)).flatMap(path => setupModulesOf(path, tracked));
    // The control: a package's own setup module, the shared one at the root, a
    // global setup, and the one the browser tests' Playwright configuration runs.
    expect(setups).toEqual(expect.arrayContaining(["packages/nextly/src/__tests__/setup.ts", "scripts/vitest-dom-setup.ts", "packages/blocks-react/vitest.global-setup.ts", "e2e/global-setup.ts"]));
    for (const path of new Set(setups)) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // A package script or a setup module can import a helper, and a change to
  // that helper changes what the check decides as much as one to the file
  // that imports it. Only test and tooling files are followed: a product
  // module keeps the review its package gives it.
  it("owns every test or tooling file a package script or setup module imports", () => {
    const files = trackedFiles();
    const tracked = new Set(files);
    const tasks = tasksRequiredChecksRun();
    const entries = [
      ...files.filter(path => WORKSPACE_MANIFEST.test(path)).flatMap(manifest => filesTasksRun(manifest, tracked, tasks)),
      ...files.filter(path => TEST_CONFIGURATION.test(path)).flatMap(path => setupModulesOf(path, tracked)),
    ];
    const imported = toolingImportedBy(entries, tracked);
    // The control: the guard the UI surface check's build script imports from
    // a test directory, as `.js` for its `.ts` source.
    expect(imported).toContain("packages/ui/src/__tests__/ensure-declarations.ts");
    // The boundary: the product module the nextly setup imports is not followed.
    expect(imported).not.toContain("packages/nextly/src/plugins/aborted-transaction-sightings.ts");
    for (const path of new Set(imported)) expect(ownersOf(rules, path), path).not.toEqual([]);
  });

  // The readers behind the tests above take forms this repository does not use
  // today, so those tests cannot fail on them; each form is held here instead.
  it("follows a root script through the root scripts it runs, to the Turbo tasks at the end", () => {
    const scripts = { "ci:generate": "pnpm generate --force", generate: "turbo run generate", unrelated: "turbo run dev" };
    expect([...commandsRunBy(["pnpm ci:generate"], scripts)].flatMap(turboTasksIn)).toEqual(["generate"]);
  });

  it("reads a task's package-scoped definitions as well as its shared one", () => {
    const graph = { test: { dependsOn: ["^build"] }, "some-package#test": { dependsOn: ["generate"] }, "other#lint": { dependsOn: ["format"] } };
    expect(dependenciesOf(graph, "test").sort()).toEqual(["build", "generate"]);
  });

  it("reads every form in which a module loads a file beside it", () => {
    const text = [
      'import rule from "./rule.js";',
      'import "./side-effect.js";',
      'export { other } from "./re-export.js";',
      'const required = require("./required.cjs");',
      'const dynamic = await import("./dynamic.mjs");',
      'const list = readFileSync(new URL("./list.json", import.meta.url), "utf8");',
      'import shared from "@scope/shared";',
    ].join("\n");
    const loads = loadsIn(text, "packages/a/eslint.config.mjs");
    expect(loads.map(load => load.target).sort()).toEqual(["dynamic.mjs", "list.json", "re-export.js", "required.cjs", "rule.js", "side-effect.js"].map(file => `packages/a/${file}`));
    // A file it reads is not an import, and is not held to resolving.
    expect(loads.filter(load => !load.imported).map(load => load.specifier)).toEqual(["././list.json"]);
  });

  it("reads an oxlint configuration's JS plugins as imports, and not the names they are given", () => {
    const text = [
      "export default defineConfig({",
      "  jsPlugins: [",
      '    "eslint-plugin-turbo",',
      '    // "./commented-out.mjs"',
      '    { name: "renamed", specifier: "./renamed.mjs" },',
      '    "./guards.mjs",',
      "  ],",
      "});",
    ].join("\n");
    expect(jsPluginsIn(text)).toEqual(["eslint-plugin-turbo", "./renamed.mjs", "./guards.mjs"]);
    expect(loadsIn(text, "oxlint.config.mjs").map(load => [load.target, load.imported])).toEqual([["renamed.mjs", true], ["guards.mjs", true]]);
  });

  it("takes nothing for an import that sits in a comment or a string", () => {
    // The shapes the repository held on 2026-09-26: a comment naming a file,
    // and a child process's source in a string.
    const text = [
      '// a rollup plugin rewrites `from "./foo.js"` in the declarations',
      "/* require(\"../bar.cjs\") */",
      "execSync(`node -e \"import('./dist/index.mjs')\"`);",
      "const example = 'import(\"./a\")';",
      'import real from "./real.js";',
    ].join("\n");
    expect(loadsIn(text, "packages/a/scripts/x.ts").map(load => load.specifier)).toEqual(["./real.js"]);
  });

  it("fails on a relative import no tracked file answers, naming the import and the module", () => {
    const files = { "packages/x/eslint.config.mjs": 'import rule from "./rule.js";\nimport gone from "./gone.js";', "packages/x/rule.ts": "" };
    const walk = () => loadedThrough(["packages/x/eslint.config.mjs"], new Set(Object.keys(files)), path => files[path]);
    expect(walk).toThrow('packages/x/eslint.config.mjs imports "./gone.js", which names no tracked file');
    const tooling = { "packages/x/scripts/build.ts": 'import { helper } from "./helper.js";' };
    expect(() => toolingImportedBy(["packages/x/scripts/build.ts"], new Set(Object.keys(tooling)), path => tooling[path])).toThrow('packages/x/scripts/build.ts imports "./helper.js"');
  });

  it("leaves out a file a module reads that is not tracked, since a build can write it", () => {
    const files = { "packages/x/eslint.config.mjs": 'const list = readFileSync("generated.json", "utf8");' };
    expect(loadedThrough(["packages/x/eslint.config.mjs"], new Set(Object.keys(files)), path => files[path])).toEqual([]);
  });

  it.each([
    ["a JavaScript import of its TypeScript source", "d/x.js", "d/x.ts"],
    ["a JavaScript import of its TSX source", "d/x.js", "d/x.tsx"],
    ["a JSX import of its TSX source", "d/x.jsx", "d/x.tsx"],
    ["an ES module import of its TypeScript source", "d/x.mjs", "d/x.mts"],
    ["a CommonJS import of its TypeScript source", "d/x.cjs", "d/x.cts"],
    ["an import with no extension, of a JSX file", "d/x", "d/x.jsx"],
    ["an import with no extension, of a CommonJS TypeScript file", "d/x", "d/x.cts"],
    ["a directory's TSX index", "d/x", "d/x/index.tsx"],
    ["a directory's ES module index", "d/x", "d/x/index.mjs"],
  ])("resolves %s", (_, imported, file) => {
    expect(resolvedModules(imported, new Set([file]))).toEqual([file]);
  });

  it("resolves an import to every file it can name, whichever of them the tool that loads it picks", () => {
    // TypeScript compiles `./x.jsx` from `x.tsx`, and a runtime that loads it
    // as written gets `x.jsx`, so a change to either changes what runs.
    expect(resolvedModules("d/x.jsx", new Set(["d/x.jsx", "d/x.tsx"])).sort()).toEqual(["d/x.jsx", "d/x.tsx"]);
  });

  it("reads the imports of every module a lint configuration's walk reaches, in any module extension", () => {
    // The configuration imports a helper written in TSX, which alone imports the rule.
    const files = {
      "packages/x/eslint.config.mjs": 'import { helper } from "./helper.jsx";',
      "packages/x/helper.tsx": 'import rule from "./rule.js";',
      "packages/x/rule.ts": "",
    };
    expect(loadedThrough(["packages/x/eslint.config.mjs"], new Set(Object.keys(files)), path => files[path]).sort()).toEqual(["packages/x/helper.tsx", "packages/x/rule.ts"]);
  });

  it("follows a test or tooling file's imports into the ones it imports in turn, and never through a product module", () => {
    // No such chain is in the repository today, so the files are given here:
    // the entry imports a helper, which alone imports the guard, and a product
    // module, which alone imports another test file.
    const files = {
      "packages/x/scripts/build.ts": 'import { helper } from "./helper.js";',
      "packages/x/scripts/helper.ts": 'import { guard } from "../src/__tests__/guard.js";\nimport { product } from "../src/product.js";',
      "packages/x/src/__tests__/guard.tsx": "",
      "packages/x/src/product.ts": 'import { other } from "./__tests__/other.js";',
      "packages/x/src/__tests__/other.ts": "",
    };
    const imported = toolingImportedBy(["packages/x/scripts/build.ts"], new Set(Object.keys(files)), path => files[path]);
    expect(imported.sort()).toEqual(["packages/x/scripts/helper.ts", "packages/x/src/__tests__/guard.tsx"]);
  });

  it("reads a setup key given a string or strings, and refuses any other form rather than read it as naming nothing", () => {
    const config = "packages/a/vitest.config.ts";
    expect(setupModulesIn('test: { setupFiles: ["./setup.ts", "../shared.ts"], globalSetup: "./global.ts" }', config)).toEqual(["packages/a/setup.ts", "packages/shared.ts", "packages/a/global.ts"]);
    expect(setupModulesIn('globalTeardown: "./teardown.ts",', "e2e/playwright.config.ts")).toEqual(["e2e/teardown.ts"]);
    for (const unread of ["setupFiles: [setup]", 'globalSetup: require.resolve("./global.ts")', "test: { setupFiles }", "setupFiles: setups,"]) {
      expect(() => setupModulesIn(unread, config), unread).toThrow(/cannot read/);
    }
  });

  it("names a program a package script runs in any JavaScript or TypeScript form", () => {
    const named = script => [...script.matchAll(LOCAL_FILE)].map(([, file]) => file);
    expect(named("tsx scripts/generate.mts && node ./bin/run.cts && tsx src/cli.tsx --check scripts/x.js")).toEqual(["scripts/generate.mts", "./bin/run.cts", "src/cli.tsx", "scripts/x.js"]);
  });

  it("reads a step's shell and the inputs it hands an action, not its name or a whole-line comment", () => {
    expect(stepTexts({ name: "turbo run dev", run: "# turbo run dev\npnpm test" })).toEqual(["\npnpm test"]);
    expect(stepTexts({ uses: "actions/github-script@v7", with: { script: "require('./scripts/x.cjs')" } })).toEqual(["", "require('./scripts/x.cjs')"]);
  });

  it("reads what a local action's steps run, never the prose around them", () => {
    const integration = read(".github/workflows/integration.yml");
    const { actions, texts } = runBy(integration, requiredJobs(integration, QUEUE_CHECKS[".github/workflows/integration.yml"]));
    const setup = ".github/actions/integration-setup/action.yml";
    const action = load(readRepositoryFile(setup));
    // The control: the jobs use the action, and what its steps run is read.
    expect(actions).toContain(setup);
    expect(texts).toEqual(expect.arrayContaining(action.runs.steps.filter(step => step.run).map(step => step.run)));
    expect(texts.some(text => text.includes(action.description.slice(0, 40)))).toBe(false);
  });

  // The control: the walk reaches the scripts a required job runs, named
  // directly and through a package script, so an owned list is not an empty one.
  it("finds the scripts the CI gate's jobs run, directly and through a package script", () => {
    const ci = read(".github/workflows/ci.yml");
    const paths = pathsRunBy(ci, requiredJobs(ci, QUEUE_CHECKS[".github/workflows/ci.yml"]));
    expect(paths).toEqual(expect.arrayContaining(["scripts/change-scope.mjs", "scripts/check-comment-convention.mjs", "package.json"]));
  });

  it("reads only the patterns it understands, and refuses any other rather than guess", () => {
    for (const unread of ["**/x.mjs @a", "docs/x.md @a", "x?.md @a", "[ab].md @a", "!x.md @a"]) expect(() => codeOwners(unread), unread).toThrow(/reads only anchored paths and directories, and file names at any depth/);
    expect(ownersOf(codeOwners("/scripts/ @a\n/scripts/x.mjs @b"), "scripts/x.mjs")).toEqual(["@b"]);
    expect(ownersOf(codeOwners("/scripts/ @a\n/scripts/x.mjs"), "scripts/x.mjs")).toEqual([]);
    // A file name matches at any depth; an anchored path only where it is; a star never crosses a slash.
    expect(ownersOf(codeOwners("package.json @a"), "packages/nextly/package.json")).toEqual(["@a"]);
    expect(ownersOf(codeOwners("/package.json @a"), "packages/nextly/package.json")).toEqual([]);
    expect(ownersOf(codeOwners("vitest*.config.* @a"), "packages/ui/vitest.integration.config.ts")).toEqual(["@a"]);
    expect(ownersOf(codeOwners("/packages/*.json @a"), "packages/nextly/package.json")).toEqual([]);
  });
});

/** Who may approve a change to the checks. Adding an owner is a decision about that, made here and in CODEOWNERS together. */
const APPROVED_OWNERS = ["@mobeenabdullah"];

/** Configuration a required check reads, where a change alters what it decides. */
const CHECK_CONFIGURATION = [
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".nvmrc",
  "turbo.jsonc",
  ".changeset/config.json",
  ".commitlintrc.json",
  ".fallowrc.jsonc",
  ".gitleaks.toml",
  "fallow-health-baseline.json",
  "lint-staged.config.mjs",
  "oxlint.config.mjs",
  "oxlint.scripts.config.mjs",
  "tsconfig.base.json",
  "vitest.config.ts",
];

/**
 * CODEOWNERS rules, in order. Two forms are read: an anchored path or
 * directory, whose segments may hold a `*` that stays within one segment, and
 * a bare file name, which matches at any depth. Any other pattern is refused
 * rather than guessed at, since a guess at what a glob matches is exactly the
 * reading that would pass an unowned path.
 */
function codeOwners(text) {
  return text
    .split("\n")
    .map(line => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map(line => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners, matches: matcherFor(readablePattern(pattern)) };
    });
}

const ANCHORED = /^\/[\w.*-]+(?:\/[\w.*-]+)*\/?$/;
const FILE_NAME = /^[\w.*-]+$/;

function readablePattern(pattern) {
  if (pattern.includes("**") || !(ANCHORED.test(pattern) || FILE_NAME.test(pattern))) {
    throw new Error(`this test reads only anchored paths and directories, and file names at any depth, not ${pattern}`);
  }
  return pattern;
}

function matcherFor(pattern) {
  const glob = part => part.split("*").map(text => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  if (FILE_NAME.test(pattern)) return new RegExp(`(?:^|/)${glob(pattern)}$`);
  return new RegExp(`^${glob(pattern.slice(1))}${pattern.endsWith("/") ? "" : "$"}`);
}

/** A path's owners: the last rule that matches it decides, and a rule with no owners leaves it unowned. */
function ownersOf(rules, path) {
  return rules.filter(rule => rule.matches.test(path)).at(-1)?.owners ?? [];
}

/** Manifests, task graphs, and the test, compiler, lint and build configuration the lanes run with. */
const LANE_DEFINITIONS = /(?:^|\/)(?:package\.json|turbo\.jsonc?|tsconfig[^/]*\.json|next\.config\.[^/]+|(?:vitest|playwright|eslint|oxlint|tsdown|rollup)[^/]*\.config\.[^/]+)$/;

/** A workspace package's manifest, whose scripts Turbo runs. */
const WORKSPACE_MANIFEST = /^(?:packages|apps)\/[^/]+\/package\.json$|^e2e\/package\.json$/;
const LINT_CONFIGURATION = /(?:^|\/)(?:eslint|oxlint)[^/]*\.config\.[^/]+$/;
const TEST_CONFIGURATION = /(?:^|\/)(?:vitest|playwright)[^/]*\.config\.[^/]+$/;
/** A file a package script names from the package's own directory, as a program in any JavaScript or TypeScript form, a shell script or data. */
const LOCAL_FILE = /(?:^|[\s="'])(\.{0,2}\/?[\w./-]+\.(?:[cm]?js|jsx|[cm]?ts|tsx|sh|json))(?=$|[\s"';&|)])/g;

/** A JSONC text as data: comments outside strings removed, and trailing commas. */
function parsedJsonc(text) {
  const withoutComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string) => string ?? "");
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * The Turbo tasks the required checks run: each `turbo run <task>` in the
 * required jobs, directly or through the root script a step names, with the
 * tasks those depend on in the task graph. A task only a developer runs, such
 * as `dev`, is left out, so what it names is not held to an owner.
 */
function tasksRequiredChecksRun() {
  const texts = Object.entries(QUEUE_CHECKS).flatMap(([path, checks]) => {
    const workflow = read(path);
    return runBy(workflow, requiredJobs(workflow, checks)).texts;
  });
  const named = [...commandsRunBy(texts)].flatMap(turboTasksIn);
  const graph = parsedJsonc(readRepositoryFile("turbo.jsonc")).tasks;
  return reachable(named, task => dependenciesOf(graph, task));
}

/** The tasks a command runs through Turbo: `turbo build` and `turbo run build` alike, each task it lists before its first flag. */
function turboTasksIn(text) {
  return [...text.matchAll(/\bturbo (?:run )?((?:\w[\w:-]*[ \t]*)+)/g)].flatMap(match => match[1].trim().split(/\s+/));
}

/**
 * The tasks one task depends on in the task graph: through its shared
 * definition and through each package's own (`<package>#<task>`), which can add
 * dependencies of its own. A dependency's `^` and `<package>#` prefixes are set
 * aside, since what is reached is the task.
 */
function dependenciesOf(graph, task) {
  const definitions = Object.entries(graph).filter(([name]) => name === task || name.endsWith(`#${task}`));
  return definitions.flatMap(([, definition]) => definition.dependsOn ?? []).map(dependency => dependency.replace(/^\^/, "").replace(/^.*#/, ""));
}

/**
 * Everything reachable from `starts` by following `next`, the starts
 * included, each item visited once: the one walk the task graph, a package's
 * scripts and a module's imports are each followed with.
 */
function reachable(starts, next) {
  const seen = new Set();
  const pending = [...starts];
  while (pending.length > 0) {
    const item = pending.pop();
    if (seen.has(item)) continue;
    seen.add(item);
    pending.push(...next(item));
  }
  return seen;
}

/**
 * The repository files a package's scripts name for the given tasks,
 * following `pnpm run <script>` to the scripts those call in the same package.
 */
function filesTasksRun(manifest, tracked, tasks) {
  const directory = posix.dirname(manifest);
  const scripts = JSON.parse(readRepositoryFile(manifest)).scripts ?? {};
  const run = reachable([...tasks].filter(task => task in scripts), name => scriptsCalledBy(scripts, name));
  const named = [...run].flatMap(name => [...scripts[name].matchAll(LOCAL_FILE)].map(([, file]) => posix.normalize(posix.join(directory, file))));
  return named.filter(path => tracked.has(path));
}

/** The scripts of the same package that one script runs with `pnpm run` or `npm run`. */
function scriptsCalledBy(scripts, name) {
  return [...scripts[name].matchAll(/\b(?:pnpm|npm)\s+(?:run\s+)?([\w:-]+)/g)].map(([, called]) => called).filter(called => called in scripts);
}

/**
 * The repository files a set of modules loads, however deep: each relative
 * import, resolved as a configuration's imports are, and each file a module
 * reads with `readFileSync`, which is how a rule reads its allowlist. A file
 * that is not a module, such as that allowlist, is reached but not read.
 */
function loadedThrough(roots, tracked, readFile = readRepositoryFile) {
  const reached = reachable(roots, path => (isModule(path) ? loadedBy(path, tracked, readFile) : []));
  return [...reached].filter(path => !roots.includes(path));
}

/**
 * The files a module loads, as tracked paths; `readFile` reads its text, the
 * repository's copy unless told otherwise. A relative import that names no
 * tracked file fails the walk, naming the import and the module: left out, the
 * file it was written for would go unowned. A file read with `readFileSync`
 * that is not tracked, such as one a build writes, is left out.
 */
function loadedBy(path, tracked, readFile = readRepositoryFile) {
  return loadsIn(readFile(path), path).flatMap(load => filesLoaded(load, path, tracked));
}

function filesLoaded({ specifier, target, imported }, from, tracked) {
  const files = resolvedModules(target, tracked);
  if (imported && files.length === 0) throw new Error(`${from} imports "${specifier}", which names no tracked file`);
  return files;
}

/** The TypeScript sources a JavaScript extension compiles from: `./x.js` is written for `./x.ts` or `./x.tsx`. */
const SOURCES_OF = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
/** Every extension a module is written with here, and so every one an import can leave out. */
const MODULE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/** Whether the walks read a file's imports: a module in any of those extensions, never a file it only reads, such as an allowlist. */
const isModule = path => MODULE_EXTENSIONS.some(extension => path.endsWith(extension));

/**
 * Every tracked file an import can name, resolved as TypeScript and Node
 * resolve it: as written, from the TypeScript source a JavaScript extension
 * names, or with an extension or an index file added, in any module
 * extension. All of them, not the first: which one runs depends on what loads
 * the module, since TypeScript compiles `./x.js` from `x.ts` where a runtime
 * that loads it as written gets `x.js`, and a change to either changes what
 * runs.
 */
function resolvedModules(path, tracked) {
  const [, stem, written] = /^(.*?)(\.[cm]?jsx?)?$/.exec(path);
  const typescript = (SOURCES_OF[written] ?? []).map(extension => `${stem}${extension}`);
  const added = [...MODULE_EXTENSIONS, ...MODULE_EXTENSIONS.map(extension => `/index${extension}`)].map(extension => `${path}${extension}`);
  return [path, ...typescript, ...added].filter(candidate => tracked.has(candidate));
}

/**
 * A test or tooling file: one under a `scripts/` or `__tests__/` directory.
 * What a check's own code imports from these is part of the check. A product
 * module it imports keeps the review its package gives it, and is not walked
 * through.
 */
const TOOLING = /(?:^|\/)(?:scripts|__tests__)\//;

/** The test and tooling files a set of modules imports, however deep, the modules themselves left out. */
function toolingImportedBy(roots, tracked, readFile = readRepositoryFile) {
  const reached = reachable(roots, path => (isModule(path) ? loadedBy(path, tracked, readFile).filter(target => TOOLING.test(target)) : []));
  return [...reached].filter(path => !roots.includes(path));
}

/**
 * The files beside it a module's text loads: each relative import in any form,
 * and each file it reads with `readFileSync`, with the repository path it
 * names and whether it is an import.
 */
function loadsIn(text, path) {
  const beside = imported => specifier => ({ specifier, target: repositoryPathOf(specifier, path, new Map()), imported });
  const read = [...text.matchAll(/readFileSync\(([^;]*?)["']utf-?8["']/g)].flatMap(match => [...match[1].matchAll(/["']([^"']+)["']/g)].map(literal => `./${literal[1]}`));
  const modules = [...importsIn(text), ...jsPluginsIn(text)];
  return [...modules.filter(specifier => specifier.startsWith(".")).map(beside(true)), ...read.map(beside(false))];
}

/** The modules a test configuration's setup keys name, as repository paths. */
function setupModulesOf(path, tracked) {
  return setupModulesIn(readRepositoryFile(path), path).filter(module => tracked.has(module));
}

/**
 * The modules `setupFiles`, `globalSetup` and `globalTeardown` name in a
 * configuration's text. Only a string, or an array of strings, can be read
 * from the text; a key given a variable, a call or anything else is refused
 * rather than read as naming nothing, which would leave its module unowned.
 */
function setupModulesIn(text, path) {
  const shorthand = SETUP_SHORTHAND.exec(text);
  if (shorthand) throw new Error(`${path} gives ${shorthand[1]} a variable, which this test cannot read`);
  return [...text.matchAll(SETUP_KEY)].flatMap(key => {
    const value = SETUP_VALUE.exec(text.slice(key.index + key[0].length));
    if (!value) throw new Error(`${path} declares ${key[1]} in a form this test cannot read: ${text.slice(key.index, key.index + 80)}`);
    return [...value[0].matchAll(/["']([^"']+)["']/g)].map(match => posix.normalize(posix.join(posix.dirname(path), match[1])));
  });
}

const SETUP_KEY = /\b(setupFiles|globalSetup|globalTeardown)\s*:\s*/g;
const SETUP_SHORTHAND = /\b(setupFiles|globalSetup|globalTeardown)\s*[,}]/;
const SETUP_VALUE = /^(?:\[\s*(?:["'][^"'\n]+["']\s*,?\s*)*\]|["'][^"'\n]+["'])/;

/** Compiler and lint configuration, which may extend or import shared configuration. */
const SHARING_CONFIGURATION = /(?:^|\/)(?:tsconfig[^/]*\.json|(?:eslint|oxlint)[^/]*\.config\.[^/]+)$/;
const EXTENDS = /"extends"\s*:\s*(\[[^\]]*\]|"[^"]*")/;
/**
 * The modules a module's text imports, as written: `import … from`,
 * `export … from`, a bare `import` for its side effects, `require()` and
 * `import()`. TypeScript's own scanner reads them, so text that only looks like
 * an import, in a comment or in a string such as a child process's source, is
 * never taken for one.
 */
function importsIn(text) {
  return ts.preProcessFile(text, true, true).importedFiles.map(file => file.fileName);
}

/**
 * The modules an oxlint configuration's `jsPlugins` names, which oxlint loads
 * as surely as an import: each string, or an entry's `specifier`, but never
 * the `name` an entry gives its plugin. Comments are set aside first, so one
 * naming a module is not taken for it.
 */
function jsPluginsIn(text) {
  const list = /\bjsPlugins\s*:\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? "";
  const entries = list.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\bname\s*:\s*["'][^"']*["']/g, "");
  return [...entries.matchAll(/["']([^"']+)["']/g)].map(match => match[1]);
}

function readRepositoryFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/** The workspace's packages by name, so a specifier naming one resolves to its directory. */
function workspacePackages(files) {
  const manifests = files.filter(path => /^packages\/[^/]+\/package\.json$/.test(path));
  return new Map(manifests.map(path => [JSON.parse(readRepositoryFile(path)).name, posix.dirname(path)]));
}

/** The repository files a configuration extends or imports: a relative path, or a workspace package by name. */
function sharedConfigurationOf(path, packages) {
  const text = readRepositoryFile(path);
  const extended = EXTENDS.exec(text)?.[1] ?? "";
  const specifiers = [...[...extended.matchAll(/"([^"]+)"/g)].map(match => match[1]), ...importsIn(text), ...jsPluginsIn(text)];
  return specifiers.map(specifier => repositoryPathOf(specifier, path, packages)).filter(Boolean);
}

function repositoryPathOf(specifier, from, packages) {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), specifier));
  const [scope, name, ...rest] = specifier.split("/");
  const directory = packages.get(`${scope}/${name}`);
  return directory ? `${directory}/${rest.join("/") || "package.json"}` : null;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" }).split("\0").filter(Boolean);
}

const PACKAGE_SCRIPTS = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
const SCRIPT_PATH = /\bscripts\/[\w./-]+\.(?:mjs|cjs|js|sh)\b/g;

/** What a set of jobs runs: the local actions it uses, however nested, and what each of its steps and theirs runs. */
function runBy(workflow, ids) {
  const steps = ids.flatMap(id => workflow.jobs[id].steps ?? []);
  const actions = [...reachable(localActionsOf(steps), action => localActionsOf(actionSteps(action)))];
  return { actions, texts: [...steps, ...actions.flatMap(actionSteps)].flatMap(stepTexts) };
}

/** The local actions a list of steps uses, as the paths of their definitions. */
function localActionsOf(steps) {
  return steps.map(step => String(step.uses ?? "")).filter(uses => uses.startsWith("./")).map(uses => `${uses.slice(2)}/action.yml`);
}

/** A composite action's steps, read from its definition, so its name and descriptions are never taken for commands. */
function actionSteps(path) {
  return load(readRepositoryFile(path))?.runs?.steps ?? [];
}

/**
 * What one step runs: its shell, and the inputs it hands an action, which can
 * be code, as the script `actions/github-script` runs is. A whole-line comment
 * in either runs nothing, so prose there that mentions a command is dropped.
 */
function stepTexts(step) {
  return [step.run ?? "", ...Object.values(step.with ?? {})].map(value => String(value).replace(/^[ \t]*#.*$/gm, ""));
}

/** The local actions a set of jobs uses, and the scripts their steps name, directly or through a package script. */
function pathsRunBy(workflow, ids) {
  const { actions, texts } = runBy(workflow, ids);
  return [...new Set([...actions, ...[...commandsRunBy(texts)].flatMap(scriptsNamedIn)])];
}

/** Each command step texts run: the texts themselves, and every root script they name, followed through the root scripts it names in turn. */
function commandsRunBy(texts, scripts = PACKAGE_SCRIPTS) {
  return reachable(texts, text => rootScriptsNamedIn(text, scripts));
}

/** The root package scripts a command runs with `pnpm <script>`, as their commands. */
function rootScriptsNamedIn(text, scripts = PACKAGE_SCRIPTS) {
  return [...text.matchAll(/\bpnpm (?:run )?([\w:-]+)/g)].map(match => scripts[match[1]]).filter(Boolean);
}

function scriptsNamedIn(text) {
  const viaPackage = rootScriptsNamedIn(text);
  return [...[text, ...viaPackage].flatMap(source => [...source.matchAll(SCRIPT_PATH)].map(match => match[0])), ...(viaPackage.length > 0 ? ["package.json"] : [])];
}
