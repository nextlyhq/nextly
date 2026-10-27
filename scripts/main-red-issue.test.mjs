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
const OLDER = "b".repeat(40);
const RUN = "4242";
const env = (results, extra = {}) => ({
  GITHUB_REPOSITORY: REPO,
  GITHUB_SHA: SHA,
  GITHUB_RUN_ID: RUN,
  GITHUB_SERVER_URL: "https://github.com",
  RESULTS: JSON.stringify(results),
  ...extra,
});

/** Every advisory job with one result, and `overrides` on top; `outputs` per job id. */
const all = (result, overrides = {}, outputs = {}) =>
  Object.fromEntries(Object.keys(ADVISORY).map(id => [id, { result: overrides[id] ?? result, outputs: outputs[id] ?? {} }]));

const openIssues = `GET repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=10`;
const runJobs = `GET repos/${REPO}/actions/runs/${RUN}/jobs?per_page=100`;
const label = { [`GET repos/${REPO}/labels/${LABEL}`]: { name: LABEL } };
/** How the compare API places this run's commit against the one the open issue records. */
const placed = status => ({ [`GET repos/${REPO}/compare/${OLDER}...${SHA}`]: { status } });
/** An open issue recording the commit and jobs it was last written for. */
const issue = (jobs, sha = OLDER) => ({ number: 7, body: `<!-- main-red ${JSON.stringify({ sha, jobs })} -->\nmain is red` });

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
  it("names each job that failed", () => {
    expect(verdict(all("success", { e2e: "failure", "scaffold-smoke": "failure" })).failed).toEqual(["e2e", "scaffold-smoke"]);
  });

  it("counts a job as passed only when it succeeded and ran its test", () => {
    // Dev reload decides inside the job whether a commit can affect it, and
    // succeeds without testing when it cannot.
    const untested = all("success", {}, { "dev-reload": { tested: "false" } });
    expect(verdict(untested).passed).not.toContain("dev-reload");
    expect(verdict(all("success", {}, { "dev-reload": { tested: "true" } })).passed).toContain("dev-reload");
    expect(verdict(all("success", { e2e: "skipped", "dev-script-smoke": "cancelled" })).passed).not.toEqual(
      expect.arrayContaining(["e2e"])
    );
  });
});

describe("the issue on main", () => {
  it("opens one, labelled, recording its commit and failed jobs, when main turns red and none is open", async () => {
    const { fetchImpl, writes } = api({ ...label, [openIssues]: [], [runJobs]: { jobs: [] } });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(0);
    const [created] = writes();
    expect(created.key).toBe(`POST repos/${REPO}/issues`);
    expect(created.body.labels).toEqual([LABEL]);
    expect(created.body.title).toBe(`main is red: Browser tests on ${SHA.slice(0, 9)}`);
    expect(created.body.body).toContain(`https://github.com/${REPO}/actions/runs/${RUN}`);
    expect(created.body.body).toContain(`<!-- main-red {"sha":"${SHA}","jobs":["e2e"]} -->`);
    expect(writes()).toHaveLength(1);
  });

  it("creates the label first when the repository has none, so the issue can be found again", async () => {
    const { fetchImpl, writes } = api({ [openIssues]: [], [runJobs]: { jobs: [] } });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(0);
    expect(writes().map(call => call.key)).toEqual([`POST repos/${REPO}/labels`, `POST repos/${REPO}/issues`]);
    expect(writes()[0].body.name).toBe(LABEL);
  });

  it("updates the open one rather than opening a second", async () => {
    const { fetchImpl, writes } = api({ [openIssues]: [issue(["e2e"])], ...placed("ahead"), [runJobs]: { jobs: [] } });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl })).toBe(0);
    expect(writes().map(call => call.key)).toEqual([`PATCH repos/${REPO}/issues/7`]);
    expect(writes()[0].body.title).toBe(`main is red: Browser tests on ${SHA.slice(0, 9)}`);
  });

  it("closes the open one once every job it names has passed, saying on which commit", async () => {
    // Only Browser tests is named; the others were skipped here, which is not
    // a reason to keep it open.
    const results = all("skipped", { e2e: "success" });
    const { fetchImpl, writes } = api({ [openIssues]: [issue(["e2e"])], ...placed("ahead") });
    expect(await main(env(results), { fetchImpl })).toBe(0);
    expect(writes().map(call => call.key)).toEqual([`POST repos/${REPO}/issues/7/comments`, `PATCH repos/${REPO}/issues/7`]);
    expect(writes()[0].body.body).toContain(SHA.slice(0, 9));
    expect(writes()[1].body).toEqual({ state: "closed", state_reason: "completed" });
  });

  it("keeps it open when a job it names succeeded without running its test", async () => {
    const results = all("success", {}, { "dev-reload": { tested: "false" } });
    const { fetchImpl, writes } = api({ [openIssues]: [issue(["dev-reload"])], ...placed("ahead") });
    expect(await main(env(results), { fetchImpl })).toBe(0);
    expect(writes()).toEqual([]);
  });

  it("leaves it alone when this run's commit is older than the one it records", async () => {
    // Each main commit runs in a concurrency group of its own, so an older
    // run can finish after a newer one; it must neither close nor rewrite it.
    for (const results of [all("success"), all("success", { e2e: "failure" })]) {
      const { fetchImpl, writes } = api({ [openIssues]: [issue(["e2e"])], ...placed("behind"), [runJobs]: { jobs: [] } });
      expect(await main(env(results), { fetchImpl })).toBe(0);
      expect(writes()).toEqual([]);
    }
  });

  it("touches nothing when nothing failed and none is open, or when the run tested nothing", async () => {
    for (const results of [all("success"), all("skipped")]) {
      const { fetchImpl, writes } = api({ [openIssues]: [] });
      expect(await main(env(results), { fetchImpl })).toBe(0);
      expect(writes()).toEqual([]);
    }
  });

  it("lists the failing tests a failed job's log names, in the reporters CI uses, and still reports when it cannot be read", async () => {
    // The GitHub reporter (what the browser jobs use on CI) prints each failure
    // as an error line, once per attempt; the list reporter marks it with ✘.
    const log = [
      "2026-10-26T19:25:48.5210695Z ##[error]  1) [chromium] › tests/dashboard-card-tiers.spec.ts:134:3 › a quarter card on a 1200px dashboard is small ",
      "2026-10-26T19:25:49.0000000Z ##[error]  1) [chromium] › tests/dashboard-card-tiers.spec.ts:134:3 › a quarter card on a 1200px dashboard is small ",
      "2026-10-26T19:25:50.0000000Z     Retry #1 ───────────────────────────────────",
      "2026-10-27T01:00:00.000Z   ✓  1 [chromium] › tests/a.spec.ts:3:1 › passes (1.0s)",
      "2026-10-27T01:00:01.000Z   ✘  2 [chromium] › tests/dashboard/cards.spec.ts:40:5 › draws the saved layout (5.1s)",
      "2026-10-27T01:00:02.000Z   ✘  2 [chromium] › tests/dashboard/cards.spec.ts:40:5 › draws the saved layout (retry #1) (5.0s)",
    ].join("\n");
    const jobs = { jobs: [{ id: 91, name: "Browser tests", conclusion: "failure" }] };
    const read = api({ ...label, [openIssues]: [], [runJobs]: jobs, [`GET repos/${REPO}/actions/jobs/91/logs`]: log });
    expect(await main(env(all("success", { e2e: "failure" })), { fetchImpl: read.fetchImpl })).toBe(0);
    const body = read.writes()[0].body.body;
    expect(body).toContain("tests/dashboard-card-tiers.spec.ts:134:3 › a quarter card on a 1200px dashboard is small");
    expect(body).toContain("tests/dashboard/cards.spec.ts:40:5 › draws the saved layout");
    expect(body).not.toContain("tests/a.spec.ts");
    expect(body.match(/a quarter card on a 1200px dashboard is small/g)).toHaveLength(1);
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

  it("hears from dev reload whether its test ran, which its own step decides", () => {
    expect(String(ci.jobs["dev-reload"].outputs?.tested)).toContain("steps.decide.outputs.inert");
  });
});
