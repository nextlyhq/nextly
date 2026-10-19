/**
 * Which runs a closed pull request's cancellation may touch, and what it does
 * with the API's answers, against a stand-in for the GitHub API that answers
 * only the routes a case gives it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main, runsOf } from "./cancel-closed-pull-request-runs.mjs";

const REPO = "nextlyhq/nextly";
const PULL = { number: 7, head: { ref: "feat/x", repo: { full_name: REPO } } };

const run = (id, fields = {}) => ({ id, name: `workflow ${id}`, event: "pull_request", head_branch: "feat/x", head_repository: { full_name: REPO }, pull_requests: [{ number: 7 }], ...fields });

/** A fetch answering every unfinished state from `byStatus`, each cancel with `cancelStatus`, recording the calls. */
function api(byStatus, cancelStatus = () => 202) {
  const calls = [];
  const fetchImpl = async (url, { method = "GET" } = {}) => {
    const path = url.replace("https://api.github.com/", "");
    calls.push(`${method} ${path}`);
    return method === "POST" ? cancelled(path, cancelStatus) : listed(path, byStatus);
  };
  return { fetchImpl, calls };
}

/** A cancel's answer, for the run id in `.../runs/<id>/cancel`. */
function cancelled(path, cancelStatus) {
  const status = cancelStatus(Number(path.split("/").at(-2)));
  return { ok: status < 300, status };
}

/** One page of runs in a state and of an event, as GitHub filters them: all on the first page, none after, with their total. */
function listed(path, byStatus) {
  const { searchParams } = new URL(path, "https://api.github.com/");
  const all = (byStatus[searchParams.get("status")] ?? []).filter(run => run.event === searchParams.get("event"));
  const items = searchParams.get("page") === "1" ? all : [];
  return { ok: true, status: 200, json: async () => ({ total_count: all.length, workflow_runs: items }) };
}

describe("the runs that belong to the closed pull request", () => {
  it("takes its own pull-request and pull_request_target runs", () => {
    const runs = [run(1), run(2, { event: "pull_request_target" })];
    expect(runsOf(PULL, runs, 99).map(r => r.id)).toEqual([1, 2]);
  });

  it("never takes a push to main, the merge queue or a schedule", () => {
    const runs = ["push", "merge_group", "schedule", "workflow_dispatch"].map((event, at) => run(at + 1, { event }));
    expect(runsOf(PULL, runs, 99)).toEqual([]);
  });

  it("never takes another pull request's runs, even on the same branch name", () => {
    expect(runsOf(PULL, [run(1, { pull_requests: [{ number: 8 }] })], 99)).toEqual([]);
  });

  it("takes a fork's run, which lists no pull request, only from the head branch in the head repository", () => {
    const fork = { number: 7, head: { ref: "feat/x", repo: { full_name: "someone/nextly" } } };
    const forkRun = run(1, { pull_requests: [], head_repository: { full_name: "someone/nextly" } });
    const sameNameHere = run(2, { pull_requests: [], head_repository: { full_name: REPO } });
    const otherBranch = run(3, { pull_requests: [], head_branch: "feat/y", head_repository: { full_name: "someone/nextly" } });
    expect(runsOf(fork, [forkRun, sameNameHere, otherBranch], 99).map(r => r.id)).toEqual([1]);
  });

  it("leaves a run created after the pull request closed, which belongs to its reopening", () => {
    const closed = { ...PULL, closed_at: "2026-10-18T17:47:00Z" };
    const runs = [run(1, { created_at: "2026-10-18T17:40:00Z" }), run(2, { created_at: "2026-10-18T17:48:11Z" })];
    expect(runsOf(closed, runs, 99).map(r => r.id)).toEqual([1]);
  });

  it("leaves the run doing the cancelling alone", () => {
    expect(runsOf(PULL, [run(1), run(2)], 2).map(r => r.id)).toEqual([1]);
  });
});

describe("the command a workflow step runs", () => {
  let dir;
  let env;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cancel-closed-"));
    writeFileSync(join(dir, "event.json"), JSON.stringify({ pull_request: PULL }));
    env = { GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: "99" };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("cancels each of the pull request's unfinished runs, and nothing else", async () => {
    const { fetchImpl, calls } = api({ queued: [run(1), run(5, { event: "push" })], in_progress: [run(2), run(99)] });
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(calls.filter(call => call.startsWith("POST"))).toEqual([`POST repos/${REPO}/actions/runs/1/cancel`, `POST repos/${REPO}/actions/runs/2/cancel`]);
  });

  it("reads every unfinished state, so a run waiting or pending is cancelled too", async () => {
    const { fetchImpl, calls } = api({ waiting: [run(3)], pending: [run(4)] });
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(calls).toContain(`POST repos/${REPO}/actions/runs/3/cancel`);
    expect(calls).toContain(`POST repos/${REPO}/actions/runs/4/cancel`);
  });

  it("counts a run that finished in the meantime as done, and fails on a refused cancel", async () => {
    const finished = api({ queued: [run(1)] }, () => 409);
    expect(await main(env, { fetchImpl: finished.fetchImpl })).toBe(0);
    const refused = api({ queued: [run(1)] }, () => 403);
    expect(await main(env, { fetchImpl: refused.fetchImpl })).toBe(1);
  });

  it("cancels nothing when the pull request is open again by the time this runs", async () => {
    const posts = [];
    const fetchImpl = async (url, { method = "GET" } = {}) => {
      if (method === "POST") {
        posts.push(url);
        return { ok: true, status: 202 };
      }
      if (url.endsWith(`/pulls/${PULL.number}`)) return { ok: true, status: 200, json: async () => ({ state: "open" }) };
      return { ok: true, status: 200, json: async () => ({ total_count: 1, workflow_runs: url.includes("status=queued&") && url.includes("event=pull_request&") ? [run(1)] : [] }) };
    };
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(posts).toEqual([]);
  });

  it("fails, cancelling nothing, when the runs cannot be read", async () => {
    const calls = [];
    const fetchImpl = async (url, { method = "GET" } = {}) => {
      calls.push(method);
      return { ok: false, status: 500, json: async () => ({}) };
    };
    expect(await main(env, { fetchImpl })).toBe(1);
    expect(calls).not.toContain("POST");
  });

  it("cancels what a short list holds, and still fails when the lists stay shorter than GitHub's totals", async () => {
    const posts = [];
    const fetchImpl = async (url, { method = "GET" } = {}) => {
      if (method === "POST") {
        posts.push(Number(url.split("/").at(-2)));
        return { ok: true, status: 202 };
      }
      const queued = url.includes("status=queued&") && url.includes("event=pull_request&");
      return { ok: true, status: 200, json: async () => ({ total_count: queued ? 5 : 0, workflow_runs: queued ? [run(1)] : [] }) };
    };
    expect(await main(env, { fetchImpl })).toBe(1);
    expect(posts).toEqual([1]);
  });

  it("succeeds when a list that came back short is whole on the next scan", async () => {
    // A run arrived while the first scan read the queued list, so its total was one ahead.
    let queuedReads = 0;
    const posts = [];
    const fetchImpl = async (url, { method = "GET" } = {}) => {
      if (method === "POST") {
        posts.push(Number(url.split("/").at(-2)));
        return { ok: true, status: 202 };
      }
      const queued = url.includes("status=queued&") && url.includes("event=pull_request&");
      if (queued) queuedReads += 1;
      const total = queued ? (queuedReads === 1 ? 2 : 1) : 0;
      return { ok: true, status: 200, json: async () => ({ total_count: total, workflow_runs: queued ? [run(1)] : [] }) };
    };
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(posts).toEqual([1]);
  });

  it("keeps scanning while the lists are short, even when a scan finds nothing new", async () => {
    // Short on the first two scans, whole on the third: only then may it report success.
    let queuedReads = 0;
    const fetchImpl = async (url, { method = "GET" } = {}) => {
      if (method === "POST") return { ok: true, status: 202 };
      const queued = url.includes("status=queued&") && url.includes("event=pull_request&");
      if (queued) queuedReads += 1;
      const total = queued ? (queuedReads <= 2 ? 2 : 1) : 0;
      return { ok: true, status: 200, json: async () => ({ total_count: total, workflow_runs: queued ? [run(1)] : [] }) };
    };
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(queuedReads).toBe(3);
  });

  it("fails past the API's 1,000-run window, which a full page through page 10 cannot see beyond, having cancelled what it could see", async () => {
    const page = Array.from({ length: 100 }, (_, at) => run(1000 + at));
    let posts = 0;
    const fetchImpl = async (url, { method = "GET" } = {}) => {
      if (method === "POST") {
        posts += 1;
        return { ok: true, status: 202 };
      }
      const full = url.includes("status=queued&") && url.includes("event=pull_request&");
      return { ok: true, status: 200, json: async () => ({ total_count: full ? 1500 : 0, workflow_runs: full ? page : [] }) };
    };
    expect(await main(env, { fetchImpl })).toBe(1);
    expect(posts).toBe(100);
  });

  it("scans again, so a run that moved between states while the list was read is still cancelled", async () => {
    let reads = 0;
    const byStatus = {
      queued: [run(1)],
      // Read twice a scan, once per event: run 9 is there from the second scan on.
      get in_progress() {
        reads += 1;
        return reads > 2 ? [run(9)] : [];
      },
    };
    const { fetchImpl, calls } = api(byStatus);
    expect(await main(env, { fetchImpl })).toBe(0);
    expect(calls.filter(call => call.startsWith("POST"))).toEqual([`POST repos/${REPO}/actions/runs/1/cancel`, `POST repos/${REPO}/actions/runs/9/cancel`]);
  });
});
