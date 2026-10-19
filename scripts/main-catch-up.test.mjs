/**
 * When the catch-up starts a run on main's newest commit, against a stand-in
 * for the GitHub API that answers only the routes a case gives it.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { WORKFLOWS, main } from "./main-catch-up.mjs";

const REPO = "nextlyhq/nextly";
const SHA = "c".repeat(40);
const env = { GITHUB_REPOSITORY: REPO };

const runsOf = workflow => `GET repos/${REPO}/actions/workflows/${workflow}/runs?branch=main&head_sha=${SHA}&per_page=20`;
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

/** Every workflow with the given runs, and those runs' jobs. */
function routesWith(runFor, jobsFor) {
  const routes = { ...head };
  for (const [at, workflow] of Object.keys(WORKFLOWS).entries()) {
    const run = runFor(workflow, at + 1);
    routes[runsOf(workflow)] = { workflow_runs: run ? [run] : [] };
    if (run) routes[jobsOf(run.id)] = jobsFor(workflow);
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
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(dispatched()).toEqual([]);
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

  it("ci.yml: every job CI gate needs, a matrix job by its name before the matrix value", () => {
    const ci = workflowFile("ci.yml");
    expect(WORKFLOWS["ci.yml"]).toEqual(ci.jobs.gate.needs.map(id => listedName(ci.jobs[id])));
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
