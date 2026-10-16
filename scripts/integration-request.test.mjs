/**
 * Whether Integration's legs were asked for, and what adding the label does to
 * the head's run, against a stand-in for the GitHub API that answers only the
 * routes a case gives it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ASKING_STEP, DECIDING_JOB, LABEL, main, requested, rerunDecision } from "./integration-request.mjs";

const REPO = "nextlyhq/nextly";
const SHA = "a".repeat(40);
const PULL = { pull_request: { number: 7, head: { sha: SHA } } };

/** A fetch that answers each route it is given, records every call, and fails any other with 404. */
function api(routes) {
  const calls = [];
  const fetchImpl = async (url, { method = "GET" } = {}) => {
    const path = url.replace("https://api.github.com/", "");
    calls.push(`${method} ${path}`);
    const answer = routes[`${method} ${path}`];
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof answer === "number") return { ok: answer < 400, status: answer, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answer };
  };
  return { fetchImpl, calls };
}

const LABELS = `GET repos/${REPO}/issues/7/labels?per_page=100`;
const RUNS = `GET repos/${REPO}/actions/workflows/integration.yml/runs?event=pull_request&head_sha=${SHA}&per_page=20`;
const jobsOf = id => `GET repos/${REPO}/actions/runs/${id}/jobs?per_page=100`;
const rerunOf = id => `POST repos/${REPO}/actions/runs/${id}/rerun`;

const deciding = (status = "completed", asked = status) => ({
  name: DECIDING_JOB,
  status,
  conclusion: status === "completed" ? "success" : null,
  steps: [{ name: ASKING_STEP, status: asked }],
});
const leg = (dialect, conclusion, status = conclusion ? "completed" : "queued") => ({ name: `Integration (${dialect})`, status, conclusion });
const skippedLegs = ["postgres", "mysql", "sqlite"].map(dialect => leg(dialect, "skipped"));

describe("whether the legs were asked for", () => {
  it("always, in the merge queue and on a push, without asking the API", async () => {
    for (const event of ["merge_group", "push"]) {
      const { fetchImpl, calls } = api({});
      expect((await requested({ event, payload: {}, repository: REPO, fetchImpl })).requested, event).toBe(true);
      expect(calls).toEqual([]);
    }
  });

  it("on a pull request, only while its labels read now include the label", async () => {
    const without = api({ [LABELS]: [{ name: "enhancement" }] });
    expect((await requested({ event: "pull_request", payload: PULL, repository: REPO, fetchImpl: without.fetchImpl })).requested).toBe(false);
    const labelled = api({ [LABELS]: [{ name: "enhancement" }, { name: LABEL }] });
    expect((await requested({ event: "pull_request", payload: PULL, repository: REPO, fetchImpl: labelled.fetchImpl })).requested).toBe(true);
  });

  it("reads the labels from the API, not the event's copy fixed at the push", async () => {
    const payload = { pull_request: { ...PULL.pull_request, labels: [{ name: LABEL }] } };
    const { fetchImpl } = api({ [LABELS]: [] });
    expect((await requested({ event: "pull_request", payload, repository: REPO, fetchImpl })).requested).toBe(false);
  });

  it("runs the legs when the labels cannot be read, or the event names no pull request", async () => {
    const { fetchImpl } = api({ [LABELS]: 500 });
    const failed = await requested({ event: "pull_request", payload: PULL, repository: REPO, fetchImpl });
    expect(failed.requested).toBe(true);
    expect(failed.reason).toMatch(/could not read/);
    expect((await requested({ event: "pull_request", payload: {}, repository: REPO, fetchImpl })).requested).toBe(true);
  });
});

describe("what adding the label does to the head's Integration run", () => {
  const decide = routes => rerunDecision({ payload: PULL, repository: REPO, fetchImpl: api(routes).fetchImpl });

  it("nothing when no run exists yet: the one that starts reads the label itself", async () => {
    expect((await decide({ [RUNS]: { workflow_runs: [] } })).action).toBe("none");
  });

  it("nothing while the newest run has yet to read the labels", async () => {
    const routes = { [RUNS]: { workflow_runs: [{ id: 2, status: "queued", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding("queued")] } };
    expect((await decide(routes)).action).toBe("none");
  });

  it("reads the labels as read once the asking step finished, though its job is still running", async () => {
    const routes = { [RUNS]: { workflow_runs: [{ id: 2, status: "in_progress", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding("in_progress", "completed"), ...skippedLegs] } };
    expect((await decide(routes)).action).toBe("wait");
    const notYet = { ...routes, [jobsOf(2)]: { jobs: [deciding("in_progress", "in_progress")] } };
    expect((await decide(notYet)).action).toBe("none");
  });

  it("waits while the deciding job finishes, since its legs sit queued then whichever way it read the labels", async () => {
    const queuedLegs = ["postgres", "mysql", "sqlite"].map(dialect => leg(dialect, null));
    const routes = { [RUNS]: { workflow_runs: [{ id: 2, status: "in_progress", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding("in_progress", "completed"), ...queuedLegs] } };
    expect((await decide(routes)).action).toBe("wait");
  });

  it("nothing when the legs ran or are running", async () => {
    for (const legs of [[leg("postgres", null), ...skippedLegs.slice(1)], [leg("postgres", "failure"), leg("mysql", "success"), leg("sqlite", "success")]]) {
      const routes = { [RUNS]: { workflow_runs: [{ id: 2, status: "in_progress", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding(), ...legs] } };
      expect((await decide(routes)).action).toBe("none");
    }
  });

  it("waits while a run that skipped its legs is still finishing", async () => {
    const routes = { [RUNS]: { workflow_runs: [{ id: 2, status: "in_progress", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding(), ...skippedLegs] } };
    expect((await decide(routes)).action).toBe("wait");
  });

  it("re-runs the newest run, by when it was created, once all its legs skipped", async () => {
    const runs = [
      { id: 1, status: "completed", created_at: "2026-10-16T09:00:00Z" },
      { id: 3, status: "completed", created_at: "2026-10-16T11:00:00Z" },
      { id: 2, status: "completed", created_at: "2026-10-16T10:00:00Z" },
    ];
    const routes = { [RUNS]: { workflow_runs: runs }, [jobsOf(3)]: { jobs: [deciding(), ...skippedLegs] } };
    expect(await decide(routes)).toMatchObject({ action: "rerun", run: 3 });
  });
});

describe("the commands a workflow step runs", () => {
  let dir;
  let env;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "integration-request-"));
    writeFileSync(join(dir, "event.json"), JSON.stringify(PULL));
    env = { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_REPOSITORY: REPO, GITHUB_OUTPUT: join(dir, "output"), GITHUB_STEP_SUMMARY: join(dir, "summary") };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("`requested` writes the answer, and says why in the summary when the legs skip", async () => {
    const { fetchImpl } = api({ [LABELS]: [] });
    expect(await main(["requested"], env, { fetchImpl })).toBe(0);
    expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("requested=false\n");
    expect(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toContain(LABEL);
  });

  it("`requested` stays quiet when the legs skip anyway, since the label would change nothing", async () => {
    const { fetchImpl } = api({ [LABELS]: [] });
    expect(await main(["requested"], { ...env, INERT: "true" }, { fetchImpl })).toBe(0);
    expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("requested=false\n");
    expect(() => readFileSync(env.GITHUB_STEP_SUMMARY, "utf8")).toThrow();
  });

  it("`rerun` re-runs the run once it finishes, waiting between looks", async () => {
    let looks = 0;
    const finishing = { [RUNS]: { workflow_runs: [{ id: 2, status: "in_progress", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding(), ...skippedLegs] } };
    const finished = { ...finishing, [RUNS]: { workflow_runs: [{ id: 2, status: "completed", created_at: "2026-10-16T10:00:00Z" }] }, [rerunOf(2)]: {} };
    const later = api(finished);
    const fetchImpl = (url, options) => (looks < 1 ? api(finishing).fetchImpl(url, options) : later.fetchImpl(url, options));
    const sleep = async () => {
      looks += 1;
    };
    expect(await main(["rerun"], env, { fetchImpl, sleep })).toBe(0);
    expect(looks).toBe(1);
    expect(later.calls).toContain(rerunOf(2));
  });

  it("`rerun` fails, saying what to do by hand, when the re-run is refused", async () => {
    const { fetchImpl } = api({ [RUNS]: { workflow_runs: [{ id: 2, status: "completed", created_at: "2026-10-16T10:00:00Z" }] }, [jobsOf(2)]: { jobs: [deciding(), ...skippedLegs] }, [rerunOf(2)]: 403 });
    expect(await main(["rerun"], env, { fetchImpl, sleep: async () => {} })).toBe(1);
  });

  it("refuses a command it does not know", async () => {
    expect(await main(["nonsense"], env)).toBe(64);
  });
});

describe("the label itself", () => {
  /*
   * `labels-sync.yml` makes `.github/labels.yml` the whole set and deletes any
   * other label, so a label made by hand would vanish on the next sync and
   * nobody could ask for the legs.
   */
  it("is in the catalog the label sync keeps", () => {
    const catalog = load(readFileSync(new URL("../.github/labels.yml", import.meta.url), "utf8"));
    expect(catalog.map(entry => entry.name)).toContain(LABEL);
  });

  it("names the job and step the workflow really has, so a rename fails here rather than in a run", () => {
    const changes = load(readFileSync(new URL("../.github/workflows/integration.yml", import.meta.url), "utf8")).jobs.changes;
    expect(changes.name).toBe(DECIDING_JOB);
    expect(changes.steps.map(step => step.name)).toContain(ASKING_STEP);
  });
});
