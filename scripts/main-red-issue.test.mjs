/**
 * The issue that says main is red on a job that does not block a merge,
 * against a stand-in for the GitHub API that answers only the routes a case
 * gives it.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { ADVISORY, LABEL, main, verdict } from "./main-red-issue.mjs";

const REPO = "nextlyhq/nextly";
const SHA = "a".repeat(40);
const RUN = "4242";
const env = (results, extra = {}) => ({
  GITHUB_REPOSITORY: REPO,
  GITHUB_SHA: SHA,
  GITHUB_RUN_ID: RUN,
  GITHUB_SERVER_URL: "https://github.com",
  RESULTS: JSON.stringify(results),
  ...extra,
});

/** Every advisory job with one result, and `overrides` on top. */
const all = (result, overrides = {}) =>
  Object.fromEntries(Object.keys(ADVISORY).map(id => [id, { result: overrides[id] ?? result, outputs: {} }]));

const openIssues = `GET repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=10`;
const runJobs = `GET repos/${REPO}/actions/runs/${RUN}/jobs?per_page=100`;
const label = { [`GET repos/${REPO}/labels/${LABEL}`]: { name: LABEL } };

/** A fetch answering each route given (a string answers as text), recording every call and body. */
function api(routes) {
  const calls = [];
  const fetchImpl = async (url, { method = "GET", body } = {}) => {
    const key = `${method} ${url.replace("https://api.github.com/", "")}`;
    calls.push({ key, body: body === undefined ? undefined : JSON.parse(body) });
    if (method !== "GET") return { ok: true, status: method === "POST" ? 201 : 200, json: async () => ({}) };
    const answer = routes[key];
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    return { ok: true, status: 200, json: async () => answer, text: async () => String(answer) };
  };
  return { fetchImpl, calls, writes: () => calls.filter(call => !call.key.startsWith("GET")) };
}

describe("what the advisory jobs on a main run say", () => {
  it("is red when any of them failed, naming each", () => {
    expect(verdict(all("success", { e2e: "failure", "scaffold-smoke": "failure" }))).toEqual({
      state: "red",
      failed: [ADVISORY.e2e, ADVISORY["scaffold-smoke"]],
    });
  });

  it("is green only when every one of them passed", () => {
    expect(verdict(all("success")).state).toBe("green");
  });

  it("says nothing when one was skipped or cancelled and none failed: a superseded run tested nothing", () => {
    expect(verdict(all("success", { e2e: "skipped" })).state).toBe("unknown");
    expect(verdict(all("success", { "dev-reload": "cancelled" })).state).toBe("unknown");
  });
});

describe("the issue on main", () => {
  it("opens one, labelled, when main turns red and none is open", async () => {
    const { fetchImpl, writes } = api({ ...label, [openIssues]: [], [runJobs]: { jobs: [] } });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(0);
    const [created] = writes();
    expect(created.key).toBe(`POST repos/${REPO}/issues`);
    expect(created.body.labels).toEqual([LABEL]);
    expect(created.body.title).toBe(`main is red: Browser tests on ${SHA.slice(0, 9)}`);
    expect(created.body.body).toContain(`https://github.com/${REPO}/actions/runs/${RUN}`);
    expect(writes()).toHaveLength(1);
  });

  it("creates the label first when the repository has none, so the issue can be found again", async () => {
    const { fetchImpl, writes } = api({ [openIssues]: [], [runJobs]: { jobs: [] } });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(0);
    expect(writes().map(call => call.key)).toEqual([`POST repos/${REPO}/labels`, `POST repos/${REPO}/issues`]);
    expect(writes()[0].body.name).toBe(LABEL);
  });

  it("updates the open one rather than opening a second", async () => {
    const { fetchImpl, writes } = api({ [openIssues]: [{ number: 7 }], [runJobs]: { jobs: [] } });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(0);
    expect(writes().map(call => call.key)).toEqual([`PATCH repos/${REPO}/issues/7`]);
    expect(writes()[0].body.title).toBe(`main is red: Browser tests on ${SHA.slice(0, 9)}`);
  });

  it("closes the open one, saying which commit is green, when every advisory job passes", async () => {
    const { fetchImpl, writes } = api({ [openIssues]: [{ number: 7 }] });
    expect(await main(env(all("success")), { fetchImpl })).toBe(0);
    expect(writes().map(call => call.key)).toEqual([`POST repos/${REPO}/issues/7/comments`, `PATCH repos/${REPO}/issues/7`]);
    expect(writes()[0].body.body).toContain(SHA.slice(0, 9));
    expect(writes()[1].body).toEqual({ state: "closed", state_reason: "completed" });
  });

  it("touches nothing when green and none is open, or when the run tested nothing", async () => {
    for (const results of [all("success"), all("skipped")]) {
      const { fetchImpl, writes } = api({ [openIssues]: [] });
      expect(await main(env(results), { fetchImpl })).toBe(0);
      expect(writes()).toEqual([]);
    }
  });

  it("lists the failing tests a failed job's log names, and still reports when the log cannot be read", async () => {
    const log = [
      "2026-10-27T01:00:00.000Z   ✓  1 [chromium] › tests/a.spec.ts:3:1 › passes (1.0s)",
      "2026-10-27T01:00:01.000Z   ✘  2 [chromium] › tests/dashboard/cards.spec.ts:40:5 › draws the saved layout (5.1s)",
      "2026-10-27T01:00:02.000Z   ✘  2 [chromium] › tests/dashboard/cards.spec.ts:40:5 › draws the saved layout (retry #1) (5.0s)",
    ].join("\n");
    const jobs = { jobs: [{ id: 91, name: "Browser tests", conclusion: "failure" }] };
    const read = api({ ...label, [openIssues]: [], [runJobs]: jobs, [`GET repos/${REPO}/actions/jobs/91/logs`]: log });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl: read.fetchImpl })).toBe(0);
    const body = read.writes()[0].body.body;
    expect(body).toContain("tests/dashboard/cards.spec.ts:40:5 › draws the saved layout");
    expect(body).not.toContain("tests/a.spec.ts");
    expect(body.match(/draws the saved layout/g)).toHaveLength(1);

    const unreadable = api({ ...label, [openIssues]: [], [runJobs]: jobs });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl: unreadable.fetchImpl })).toBe(0);
    expect(unreadable.writes()[0].body.body).toContain("could not be read");
  });

  it("fails, writing nothing, when the open issues cannot be read", async () => {
    const { fetchImpl, writes } = api({});
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(1);
    expect(writes()).toEqual([]);
  });
});

describe("the job that runs it", () => {
  const ci = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
  const job = Object.values(ci.jobs).find(entry => String(entry.steps?.map(step => step.run).join(" ")).includes("main-red-issue.mjs"));

  it("needs exactly the advisory jobs, each named as ci.yml names it", () => {
    expect(job).toBeDefined();
    expect([...job.needs].sort()).toEqual(Object.keys(ADVISORY).sort());
    for (const [id, name] of Object.entries(ADVISORY)) expect(String(ci.jobs[id].name).replace(/ \(\$\{\{[^}]*\}\}\)$/, "")).toBe(name);
  });

  it("runs on pushes to main only, whatever the jobs before it did, with issues write and nothing more", () => {
    expect(job.if).toContain("always()");
    expect(job.if).toContain("github.event_name == 'push'");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.permissions).toEqual({ contents: "read", actions: "read", issues: "write" });
  });

  it("is none of the jobs CI gate needs: reporting main's state never blocks a merge", () => {
    const id = Object.keys(ci.jobs).find(key => ci.jobs[key] === job);
    expect(ci.jobs.gate.needs).not.toContain(id);
  });
});
