#!/usr/bin/env node
/**
 * Keeps one issue open while a job on `main` that does not block a merge is
 * red, and closes it once they are all green again.
 *
 * The browser tests and the smokes are not jobs `CI gate` needs: they never
 * block a merge, so a red one on `main` changes nothing anyone reads. A merge
 * that breaks them shows only as a red job inside a run whose gate passed, and
 * it stays unread for as long as nobody happens to open that run. This makes
 * it read: a run on `main` in which one of them failed opens the issue (or
 * updates it, so there is never a second), naming the jobs, the commit, the
 * run and, where the job's log names them, the failing tests. The first run in
 * which every one of them passed closes it. A run in which one was skipped or
 * cancelled and none failed (a superseded push, a cancelled run) tested
 * nothing, so it leaves the issue as it is.
 *
 * Usage, in a workflow step: node scripts/main-red-issue.mjs
 * Reads RESULTS (the `needs` context as JSON), GITHUB_REPOSITORY, GITHUB_SHA,
 * GITHUB_RUN_ID, GITHUB_SERVER_URL and GH_TOKEN.
 */
import { isCliEntry } from "./cli-entry.mjs";
import { githubJson, githubRequest } from "./github-api.mjs";
import { commandText } from "./workflow-context.mjs";

/**
 * The jobs it watches, by id in `ci.yml`, with the name each has there (a
 * matrix job by its name before the matrix value). A test holds both to the
 * workflow file and to the job's `needs`.
 */
export const ADVISORY = {
  e2e: "Browser tests",
  "e2e-production": "Production browser tests",
  "dev-reload": "Dev reload applies a saved schema edit",
  "scaffold-smoke": "Scaffold smoke",
  "dev-script-smoke": "Dev script starts every watcher",
};

/** The one label that marks the issue, and how a second is never opened. */
export const LABEL = "main-red";

/** How many failing tests the issue lists, so a mass failure stays readable. */
const MAX_TESTS = 20;

/**
 * What the advisory jobs in one run say: red with the failed jobs' names, green
 * when every one passed, unknown otherwise.
 *
 * @returns {{ state: "red" | "green" | "unknown", failed?: string[] }}
 */
export function verdict(results) {
  const failed = Object.keys(ADVISORY).filter(id => results[id]?.result === "failure");
  if (failed.length > 0) return { state: "red", failed: failed.map(id => ADVISORY[id]) };
  const green = Object.keys(ADVISORY).every(id => results[id]?.result === "success");
  return { state: green ? "green" : "unknown" };
}

/** Opens, updates or closes the issue for this run, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const context = { token: env.GH_TOKEN, fetchImpl };
  const sha = env.GITHUB_SHA;
  const runUrl = `${env.GITHUB_SERVER_URL}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`;
  try {
    const result = verdict(JSON.parse(env.RESULTS ?? "{}"));
    if (result.state === "unknown") {
      console.log("main-red-issue: no advisory job failed and not all passed; nothing to report");
      return 0;
    }
    const open = (await githubJson(`repos/${repository}/issues?labels=${LABEL}&state=open&per_page=10`, context)).filter(
      issue => !issue.pull_request
    );
    if (result.state === "green") {
      if (open.length === 0) return 0;
      for (const issue of open) {
        await write(`repos/${repository}/issues/${issue.number}/comments`, context, "POST", {
          body: `Every advisory job passed on ${sha.slice(0, 9)} (${runUrl}).`,
        });
        await write(`repos/${repository}/issues/${issue.number}`, context, "PATCH", { state: "closed", state_reason: "completed" });
      }
      console.log(`main-red-issue: green on ${sha.slice(0, 9)}; closed ${open.map(issue => `#${issue.number}`).join(", ")}`);
      return 0;
    }
    const tests = await failingTests(env.GITHUB_RUN_ID, result.failed, { repository, context });
    const title = `main is red: ${result.failed.join(", ")} on ${sha.slice(0, 9)}`;
    const body = issueBody(result.failed, sha, runUrl, tests);
    if (open.length > 0) {
      await write(`repos/${repository}/issues/${open[0].number}`, context, "PATCH", { title, body });
      console.log(`main-red-issue: updated #${open[0].number}: ${title}`);
    } else {
      await ensureLabel({ repository, context });
      await write(`repos/${repository}/issues`, context, "POST", { title, body, labels: [LABEL] });
      console.log(`main-red-issue: opened: ${title}`);
    }
    return 0;
  } catch (error) {
    console.log(`::error title=Main red issue::${commandText(`could not report main's advisory jobs (${error.message})`)}`);
    return 1;
  }
}

/** Creates the label on its first use, so the issue it marks can be found again. */
async function ensureLabel({ repository, context }) {
  const response = await githubRequest(`repos/${repository}/labels/${LABEL}`, context);
  if (response.ok) return;
  if (response.status !== 404) throw new Error(`GET repos/${repository}/labels/${LABEL}: HTTP ${response.status}`);
  await write(`repos/${repository}/labels`, context, "POST", {
    name: LABEL,
    color: "b60205",
    description: "main is red on a job that does not block a merge",
  });
}

/** A write whose failure throws. */
async function write(path, context, method, body) {
  const response = await githubRequest(path, context, method, body);
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
}

/**
 * The failing tests the failed jobs' logs name, or null when no log could be
 * read. Playwright's list reporter marks a failed test `✘`; a retry of the same
 * test is listed once.
 */
async function failingTests(runId, failedNames, { repository, context }) {
  try {
    const { jobs } = await githubJson(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`, context);
    const failedJobs = jobs.filter(job => job.conclusion === "failure" && failedNames.some(name => job.name.startsWith(name)));
    const tests = new Set();
    let read = false;
    for (const job of failedJobs) {
      const response = await githubRequest(`repos/${repository}/actions/jobs/${job.id}/logs`, context);
      if (!response.ok) continue;
      read = true;
      for (const line of (await response.text()).split("\n")) {
        const match = /✘\s+\d+\s+(\[[^\]]+\]\s+›\s+.*?)(?:\s+\(retry #\d+\))?\s+\([\d.]+m?s\)\s*$/.exec(line);
        if (match) tests.add(match[1]);
      }
    }
    return read ? [...tests] : null;
  } catch {
    return null;
  }
}

/** The issue's text: jobs, commit and run, then the failing tests or why they are missing. */
function issueBody(failed, sha, runUrl, tests) {
  const lines = [
    `The run on \`main\` at ${sha.slice(0, 9)} failed jobs that do not block a merge:`,
    "",
    ...failed.map(name => `- **${name}**`),
    "",
    `Commit: ${sha}`,
    `Run: ${runUrl}`,
    "",
  ];
  if (tests === null) lines.push("The failed jobs' logs could not be read; the run above has the failures.");
  else if (tests.length === 0) lines.push("The logs name no failing test; the run above has the failures.");
  else {
    lines.push("Failing tests:", "");
    lines.push(...tests.slice(0, MAX_TESTS).map(test => `- \`${test}\``));
    if (tests.length > MAX_TESTS) lines.push(`- and ${tests.length - MAX_TESTS} more`);
  }
  lines.push("", "This issue is updated while `main` stays red and closed by the first run in which these jobs all pass.");
  return lines.join("\n");
}

if (isCliEntry(import.meta.url)) process.exit(await main());
