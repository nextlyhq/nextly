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
const job = (name, conclusion) => ({ name, conclusion });
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

  it("fails, starting nothing, when main's runs cannot be read", async () => {
    const { fetchImpl, dispatched } = api({});
    expect(await main(env, { fetchImpl })).toBe(1);
    expect(dispatched()).toEqual([]);
  });
});

describe("the jobs it reads as testing a commit", () => {
  /*
   * Each workflow names the jobs whose verdicts mean it tested a commit, in
   * its superseded check. The catch-up must read the same jobs, or it would
   * call a commit tested that the next push treats as untested, or the reverse.
   */
  for (const [workflow, names] of Object.entries(WORKFLOWS)) {
    it(`${workflow}: the same jobs as its superseded check, and it accepts a dispatched run`, () => {
      const parsed = load(readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8"));
      const ask = parsed.jobs.changes.steps.find(step => String(step.uses).includes("superseded-on-main"));
      expect(String(ask.with["substantive-job"]).split("\n").map(name => name.trim()).filter(Boolean)).toEqual(names);
      expect(Object.keys(parsed.on ?? parsed[true])).toContain("workflow_dispatch");
    });
  }
});
