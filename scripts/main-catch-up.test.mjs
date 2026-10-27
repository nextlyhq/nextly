/**
 * When the catch-up starts a run on main's newest commit, against a stand-in
 * for the GitHub API that answers only the routes a case gives it.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { MAX_VERDICT_AGE_MS, WORKFLOWS, main } from "./main-catch-up.mjs";

const REPO = "nextlyhq/nextly";
const SHA = "c".repeat(40);
const env = { GITHUB_REPOSITORY: REPO };
/** The clock every case reads, and times relative to it. */
const NOW = Date.parse("2026-10-27T12:00:00Z");
const hoursAgo = hours => new Date(NOW - hours * 3_600_000).toISOString();

const runsOf = workflow => `GET repos/${REPO}/actions/workflows/${workflow}/runs?branch=main&head_sha=${SHA}&per_page=20`;
const recentOf = workflow => `GET repos/${REPO}/actions/workflows/${workflow}/runs?branch=main&per_page=50`;
const catchUpsOf = workflow => `GET repos/${REPO}/actions/workflows/${workflow}/runs?branch=main&event=workflow_dispatch&per_page=20`;
const jobsOf = id => `GET repos/${REPO}/actions/runs/${id}/jobs?per_page=100`;
const dispatchOf = workflow => `POST repos/${REPO}/actions/workflows/${workflow}/dispatches`;

/** A fetch answering each route given, 204 to a dispatch, and 404 to anything else, recording every call and body. */
function api(routes) {
  const calls = [];
  const fetchImpl = async (url, { method = "GET", body } = {}) => {
    const key = `${method} ${url.replace("https://api.github.com/", "")}`;
    calls.push({ key, body });
    if (method === "POST") return { ok: true, status: 204 };
    const answer = routes[key];
    return answer === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => answer };
  };
  return { fetchImpl, calls, dispatched: () => calls.filter(call => call.key.startsWith("POST")).map(call => call.key) };
}

const head = { [`GET repos/${REPO}/commits/main`]: { sha: SHA } };
/** A job by its listed name; a matrix name (ending " (") gets an instance's value. */
const job = (name, conclusion) => ({ name: name.endsWith(" (") ? `${name}ubuntu-latest)` : name, conclusion });
const testedJobs = workflow => ({ jobs: WORKFLOWS[workflow].map(name => job(name, "success")) });
const skippedJobs = workflow => ({ jobs: WORKFLOWS[workflow].map(name => job(name, "skipped")) });

/**
 * Every workflow with the given runs on the newest commit, and those runs'
 * jobs. Main's recent runs are those plus an earlier commit's run that tested
 * it `lastVerdict` hours ago (one hour, unless a case says otherwise), and any
 * `extra` runs a case adds.
 */
function routesWith(runFor, jobsFor, { lastVerdict = 1, extra = () => [] } = {}) {
  const routes = { ...head };
  for (const [at, workflow] of Object.keys(WORKFLOWS).entries()) {
    // A case may give the newest commit one run or several.
    const onHead = [].concat(runFor(workflow, at + 1) ?? []);
    routes[runsOf(workflow)] = { workflow_runs: onHead };
    for (const run of onHead) routes[jobsOf(run.id)] = jobsFor(workflow);
    const earlier = { id: 100 + at, event: "push", status: "completed", updated_at: hoursAgo(lastVerdict) };
    routes[jobsOf(earlier.id)] = testedJobs(workflow);
    routes[recentOf(workflow)] = { workflow_runs: [...extra(workflow, at), ...onHead, earlier] };
    routes[catchUpsOf(workflow)] = { workflow_runs: [...extra(workflow, at), ...onHead].filter(run => run.event === "workflow_dispatch") };
  }
  return routes;
}

describe("the catch-up on main's newest commit", () => {
  it("starts nothing when a run already tested it", async () => {
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), testedJobs));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("counts a failed test job as tested: it judged the commit, and main shows it red", async () => {
    const failed = workflow => ({ jobs: WORKFLOWS[workflow].map(name => job(name, "failure")) });
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), failed));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("starts nothing while a run is still on its way, which may yet test it", async () => {
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "queued" }), skippedJobs));
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  /*
   * Under runner starvation the newest commit's push run is always still
   * queued when the catch-up looks, and is superseded by the time it starts:
   * waiting for it would wait forever while merges keep coming. Past the
   * verdict's age limit, a dispatched run tests main whatever is queued, and
   * a dispatched run is never skipped as superseded.
   */
  it("starts a run when one is still queued but main's last verdict is four hours old", async () => {
    expect(MAX_VERDICT_AGE_MS).toBe(3 * 3_600_000);
    const { fetchImpl, dispatched } = api(
      routesWith((_, id) => ({ id, event: "push", status: "queued" }), skippedJobs, { lastVerdict: 4 })
    );
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual(Object.keys(WORKFLOWS).map(dispatchOf));
  });

  it("starts nothing while a catch-up run is still on its way, however old the last verdict", async () => {
    const pending = (_, at) => [{ id: 200 + at, event: "workflow_dispatch", status: "queued" }];
    const { fetchImpl, dispatched } = api(
      routesWith((_, id) => ({ id, event: "push", status: "queued" }), skippedJobs, { lastVerdict: 10, extra: pending })
    );
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("starts nothing for a commit whose catch-up already ran, though its push run is still queued and the verdict old", async () => {
    const both = (_, id) => [
      { id, event: "push", status: "queued" },
      { id: 300 + id, event: "workflow_dispatch", status: "completed" },
    ];
    const { fetchImpl, dispatched } = api(routesWith(both, skippedJobs, { lastVerdict: 10 }));
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("starts nothing while a catch-up on an older commit is on its way, whatever the newest commit's runs did", async () => {
    // The newest commit's push run finished superseded, so it tested nothing;
    // one catch-up at a time still holds.
    const pending = (_, at) => [{ id: 200 + at, event: "workflow_dispatch", status: "in_progress" }];
    const { fetchImpl, dispatched } = api(
      routesWith((_, id) => ({ id, event: "push", status: "completed" }), skippedJobs, { extra: pending })
    );
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("starts nothing while a catch-up is on its way, though fifty newer push runs push it off main's recent runs", async () => {
    // Under starvation a queued catch-up can sit behind more push runs than
    // one page of main's recent runs holds; it still counts.
    const pending = (_, at) => [{ id: 200 + at, event: "workflow_dispatch", status: "queued" }];
    const routes = routesWith((_, id) => ({ id, event: "push", status: "queued" }), skippedJobs, { lastVerdict: 10, extra: pending });
    for (const workflow of Object.keys(WORKFLOWS)) {
      routes[recentOf(workflow)].workflow_runs = routes[recentOf(workflow)].workflow_runs.filter(run => run.event === "push");
    }
    const { fetchImpl, dispatched } = api(routes);
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("leaves a push run that has started to finish, however old the last verdict", async () => {
    // Only a run still waiting for a runner can be superseded before it
    // starts; one in progress is already testing the commit.
    const { fetchImpl, dispatched } = api(
      routesWith((_, id) => ({ id, event: "push", status: "in_progress" }), skippedJobs, { lastVerdict: 10 })
    );
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("counts a CI run whose Browser tests were cancelled as not tested", async () => {
    const browserCancelled = workflow => ({
      jobs: WORKFLOWS[workflow].map(name => job(name, name === "Browser tests" ? "cancelled" : "success")),
    });
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), browserCancelled));
    expect(await main(env, { fetchImpl, now: NOW })).toBe(0);
    expect(dispatched()).toEqual([dispatchOf("ci.yml")]);
  });

  it("starts a run of each workflow on main when the newest commit's runs were superseded", async () => {
    const { fetchImpl, calls, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), skippedJobs));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual(Object.keys(WORKFLOWS).map(dispatchOf));
    for (const call of calls.filter(entry => entry.key.startsWith("POST"))) expect(JSON.parse(call.body)).toEqual({ ref: "main" });
  });

  it("starts one when the commit has no run at all, and ignores runs of other events", async () => {
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "schedule", status: "completed" }), testedJobs));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual(Object.keys(WORKFLOWS).map(dispatchOf));
  });

  it("does not count a run missing one of its substantive jobs as tested", async () => {
    const partial = workflow => ({ jobs: WORKFLOWS[workflow].slice(0, -1).map(name => job(name, "success")) });
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), partial));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toContain(dispatchOf("integration.yml"));
  });

  it("does not count a run as tested when a job the gate needs was cancelled, though the build passed", async () => {
    const oneCancelled = workflow => ({ jobs: WORKFLOWS[workflow].map(name => job(name, name === "Unit tests (nextly)" ? "cancelled" : "success")) });
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), oneCancelled));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual([dispatchOf("ci.yml")]);
  });

  it("needs every instance of a matrix job to reach a verdict", async () => {
    const instanceTimedOut = workflow => ({
      jobs: [...WORKFLOWS[workflow].map(name => job(name, "success")), ...(workflow === "ci.yml" ? [{ name: "CLI entry guard (windows-latest)", conclusion: "timed_out" }] : [])],
    });
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "push", status: "completed" }), instanceTimedOut));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual([dispatchOf("ci.yml")]);
  });

  it("starts a commit's catch-up once: a finished catch-up run that tested nothing is left to stand", async () => {
    const { fetchImpl, dispatched } = api(routesWith((_, id) => ({ id, event: "workflow_dispatch", status: "completed" }), skippedJobs));
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual([]);
  });

  it("fails, starting nothing, when main's runs cannot be read", async () => {
    const { fetchImpl, dispatched } = api({});
    expect(await main(env, { fetchImpl })).toBe(1);
    expect(dispatched()).toEqual([]);
  });
});

describe("the jobs it reads as testing a commit", () => {
  /*
   * A commit is tested when every job its workflow's verdict stands on reached
   * one. For CI that is every job `CI gate` needs; reading a narrower list
   * would call a commit tested while one of the gate's jobs never ran.
   */
  const workflowFile = name => load(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
  const listedName = job => String(job.name).replace(/\$\{\{[^}]*\}\}\)$/, "");

  it("ci.yml: every job CI gate needs, a matrix job by its name before the matrix value, and Browser tests", () => {
    // Browser tests are not in the gate (they do not block a merge), but a
    // commit whose browser suite never reached a verdict is not tested: a red
    // browser run on main is how a broken admin first shows.
    const ci = workflowFile("ci.yml");
    expect(WORKFLOWS["ci.yml"]).toEqual([...ci.jobs.gate.needs.map(id => listedName(ci.jobs[id])), ci.jobs.e2e.name]);
  });

  it("integration.yml: every job that runs a suite, the same jobs its superseded check reads", () => {
    // A sharded leg's own job only reports its shards' verdict; the shards
    // are what run the suite, so they are what a tested commit needs.
    const integration = workflowFile("integration.yml");
    const ask = integration.jobs.changes.steps.find(step => String(step.uses).includes("superseded-on-main"));
    expect(String(ask.with["substantive-job"]).split("\n").map(name => name.trim()).filter(Boolean)).toEqual(WORKFLOWS["integration.yml"]);
    const sharded = Object.values(integration.jobs).filter(entry => entry.strategy?.matrix?.shard);
    for (const leg of sharded) {
      for (const shard of leg.strategy.matrix.shard) expect(WORKFLOWS["integration.yml"]).toContain(`${leg.name} (${shard})`);
    }
  });

  for (const name of Object.keys(WORKFLOWS)) {
    it(`${name} accepts a dispatched run`, () => {
      const parsed = workflowFile(name);
      expect(Object.keys(parsed.on ?? parsed[true])).toContain("workflow_dispatch");
    });
  }
});
