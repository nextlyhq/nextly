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
 * run and, where the job's log names them, the failing tests. It closes once
 * every job it names has since passed, having run its test: a job skipped or
 * cancelled (a superseded push), or one that decided a commit could not affect
 * it, proved nothing. A job that passed is struck off even while the others
 * wait, so runs that each prove one close it between them. The issue records
 * the commit it was last written for, closed or not, and a run on an older
 * commit (runs on `main` can finish out of order) leaves it alone; the job
 * runs one at a time, so two runs never write it interleaved.
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
 * What the advisory jobs in one run say, by job id: which failed, and which
 * passed having run their test. A job may decide inside itself that a commit
 * cannot affect it and still succeed; it says so in a `tested` output, and a
 * success with `tested` false proves nothing.
 *
 * @returns {{ failed: string[], passed: string[] }}
 */
export function verdict(results) {
  const ids = Object.keys(ADVISORY);
  return {
    failed: ids.filter(id => results[id]?.result === "failure"),
    passed: ids.filter(id => results[id]?.result === "success" && results[id]?.outputs?.tested !== "false"),
  };
}

/** The commit and failed jobs an issue was last written for, from its marker, or null. */
function recorded(issue) {
  const match = /<!-- main-red (\{.*?\}) -->/.exec(issue.body ?? "");
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Whether `sha` is older than the commit the issue records, by GitHub's own comparison. */
async function olderThan(sha, state, { repository, context }) {
  if (!state?.sha || state.sha === sha) return false;
  const { status } = await githubJson(`repos/${repository}/compare/${state.sha}...${sha}`, context);
  return status === "behind";
}

/** Opens, updates or closes the issue for this run, and returns the exit code. */
export async function main(env = process.env, { fetchImpl = fetch } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const context = { token: env.GH_TOKEN, fetchImpl };
  const sha = env.GITHUB_SHA;
  const runUrl = `${env.GITHUB_SERVER_URL}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`;
  try {
    const { failed, passed } = verdict(JSON.parse(env.RESULTS ?? "{}"));
    if (failed.length === 0 && passed.length === 0) {
      console.log("main-red-issue: no advisory job failed or ran its test; nothing to report");
      return 0;
    }
    // The newest labelled issue, open or closed, records the newest commit
    // any run wrote for; a closed one still orders a run that finishes late.
    // A second is opened only while none is open, so an open one is the newest.
    const [newest] = (
      await githubJson(`repos/${repository}/issues?labels=${LABEL}&state=all&sort=created&direction=desc&per_page=10`, context)
    ).filter(issue => !issue.pull_request);
    const state = newest ? recorded(newest) : null;
    if (newest && (await olderThan(sha, state, { repository, context }))) {
      console.log(`main-red-issue: ${sha.slice(0, 9)} is older than #${newest.number}'s ${state.sha.slice(0, 9)}; leaving it`);
      return 0;
    }
    const current = newest?.state === "open" ? newest : null;
    const run = { sha, runUrl, runId: env.GITHUB_RUN_ID, repository, context };
    if (failed.length === 0) {
      if (current) await closeIfProven(current, state, passed, run);
    } else {
      await report(current, state, { failed, passed }, run);
    }
    return 0;
  } catch (error) {
    console.log(`::error title=Main red issue::${commandText(`could not report main's advisory jobs (${error.message})`)}`);
    return 1;
  }
}

/**
 * Closes the open issue once every job it names has passed, having run its
 * test. A job that passed here is struck from the issue even while others are
 * not yet tested, so runs that each prove a different job close it between
 * them. Either way the issue records this commit, to order later runs.
 */
async function closeIfProven(current, state, passed, { sha, runUrl, repository, context }) {
  const named = state?.jobs ?? Object.keys(ADVISORY);
  const unproven = named.filter(id => !passed.includes(id));
  const path = `repos/${repository}/issues/${current.number}`;
  if (unproven.length > 0) {
    if (unproven.length < named.length) {
      await write(path, context, "PATCH", {
        title: retitled(current.title, unproven),
        body: withMarker(current.body, { sha, jobs: unproven }),
      });
    }
    console.log(`main-red-issue: #${current.number} stays open; not yet passed: ${unproven.map(id => ADVISORY[id] ?? id).join(", ")}`);
    return;
  }
  await write(`${path}/comments`, context, "POST", {
    body: `${named.map(id => ADVISORY[id] ?? id).join(", ")} passed on ${sha.slice(0, 9)} (${runUrl}).`,
  });
  await write(path, context, "PATCH", {
    state: "closed",
    state_reason: "completed",
    body: withMarker(current.body, { sha, jobs: [] }),
  });
  console.log(`main-red-issue: green on ${sha.slice(0, 9)}; closed #${current.number}`);
}

/** The issue's text with its marker recording `state` instead. */
function withMarker(body, state) {
  const marker = `<!-- main-red ${JSON.stringify(state)} -->`;
  const text = body ?? "";
  return /<!-- main-red \{.*?\} -->/.test(text) ? text.replace(/<!-- main-red \{.*?\} -->/, marker) : `${marker}\n${text}`;
}

/** The issue's title naming only the jobs still red, keeping the commit it was opened for. */
function retitled(title, jobs) {
  const commit = / on [0-9a-f]{9}$/.exec(title ?? "")?.[0] ?? "";
  return `main is red: ${jobs.map(id => ADVISORY[id] ?? id).join(", ")}${commit}`;
}

/** Opens the issue for this run's failures, or updates the open one. */
async function report(current, state, { failed, passed }, { sha, runUrl, runId, repository, context }) {
  // A job the issue names stays named until a run has tested it and it
  // passed, whatever else this run failed: a run that did not test it says
  // nothing about it.
  const carried = (state?.jobs ?? []).filter(id => id in ADVISORY && !failed.includes(id) && !passed.includes(id));
  const jobs = Object.keys(ADVISORY).filter(id => failed.includes(id) || carried.includes(id));
  const names = failed.map(id => ADVISORY[id]);
  const tests = await failingTests(runId, names, { repository, context });
  const title = `main is red: ${jobs.map(id => ADVISORY[id]).join(", ")} on ${sha.slice(0, 9)}`;
  const body = issueBody({ sha, jobs }, names, carried.map(id => ADVISORY[id]), runUrl, tests);
  if (current) {
    await write(`repos/${repository}/issues/${current.number}`, context, "PATCH", { title, body });
    console.log(`main-red-issue: updated #${current.number}: ${title}`);
    return;
  }
  await ensureLabel({ repository, context });
  await write(`repos/${repository}/issues`, context, "POST", { title, body, labels: [LABEL] });
  console.log(`main-red-issue: opened: ${title}`);
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
 * read. Playwright's GitHub reporter, which the browser jobs use on CI, prints
 * each failure as an error line `N) [project] › file:line:col › title`, once
 * per attempt; its list reporter marks one `✘`. Each test is listed once.
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
        const match =
          /##\[error\]\s+\d+\) (\[[^\]]+\] › .+?)\s*$/.exec(line) ??
          /✘\s+\d+\s+(\[[^\]]+\]\s+›\s+.*?)(?:\s+\(retry #\d+\))?\s+\([\d.]+m?s\)\s*$/.exec(line);
        if (match) tests.add(match[1]);
      }
    }
    return read ? [...tests] : null;
  } catch {
    return null;
  }
}

/**
 * The issue's text: a marker recording the commit and the jobs still red (read
 * back to order later runs and to know what must pass), the jobs this run
 * failed and those still red from an earlier one, the commit and run, then the
 * failing tests or why they are missing.
 */
function issueBody(state, failed, carried, runUrl, tests) {
  const { sha } = state;
  const lines = [
    `<!-- main-red ${JSON.stringify(state)} -->`,
    `The run on \`main\` at ${sha.slice(0, 9)} failed jobs that do not block a merge:`,
    "",
    ...failed.map(name => `- **${name}**`),
    "",
  ];
  if (carried.length > 0) {
    lines.push("Still red from an earlier run, and not tested again since:", "", ...carried.map(name => `- **${name}**`), "");
  }
  lines.push(`Commit: ${sha}`, `Run: ${runUrl}`, "");
  if (tests === null) lines.push("The failed jobs' logs could not be read; the run above has the failures.");
  else if (tests.length === 0) lines.push("The logs name no failing test; the run above has the failures.");
  else {
    lines.push("Failing tests:", "");
    lines.push(...tests.slice(0, MAX_TESTS).map(test => `- \`${test}\``));
    if (tests.length > MAX_TESTS) lines.push(`- and ${tests.length - MAX_TESTS} more`);
  }
  lines.push("", "This issue is updated while `main` stays red, and closed once each of these jobs has passed again.");
  return lines.join("\n");
}

if (isCliEntry(import.meta.url)) process.exit(await main());
