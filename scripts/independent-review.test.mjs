/**
 * The merge queue's independent-review gate: which pull requests a queue run
 * lands, what counts as each reviewer's verdict on the exact revision landing,
 * and the command end to end over a real repository's queued commits.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODEX, REVIEW_BOT, coverage, main, queuedPullNumbers, reviewBotCoversHead } from "./independent-review.mjs";
import { readGit } from "./workflow-context.mjs";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const AFTER = "2026-09-25T02:00:00Z";

const codexReview = (sha, submitted_at = AFTER) => ({ user: { login: CODEX }, commit_id: sha, state: "COMMENTED", submitted_at, body: `**Reviewed commit:** \`${sha.slice(0, 10)}\`` });
const summary = sha => ({
  user: { login: CODEX },
  created_at: AFTER,
  body: `<!-- codex-pull-request-review-summary -->\n\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n| 📝 **Code Review** | ✅ **Completed** ${AFTER} | \`${sha.slice(0, 7)}\` | New commits |\n`,
});
const botReview = (sha, { login = REVIEW_BOT, commit = sha, header = true, state = "COMMENTED", submitted_at = AFTER } = {}) => ({
  user: { login },
  commit_id: commit,
  state,
  submitted_at,
  body: `${header ? "## Nextly Review Bot: round 1 - approve\n\n" : ""}<!-- pr-review-agent round:1 head:${sha} -->\n\nNo findings.`,
});
const baseMovedAt = at => [[{ event: "base_ref_changed", created_at: at }]];

/** Evidence for one pull request whose head is HEAD, with OLD before it. */
const evidence = ({ reviews = [], comments = [], timeline = [[]] } = {}) => ({
  number: 7,
  pr: { head: { sha: HEAD }, commits: 2 },
  reviews,
  comments,
  commits: [{ sha: OLD }, { sha: HEAD }],
  timeline,
});

describe("which pull requests a queue run lands", () => {
  it("reads each squash commit's number, in order", () => {
    expect(queuedPullNumbers(["feat(admin): add a dialog (#12)", "fix: handle it (#7)"])).toEqual({ numbers: [12, 7] });
  });

  it("refuses a commit it cannot name, rather than letting it land unasked", () => {
    expect(queuedPullNumbers(["feat: add a dialog (#12)", "Merge pull request #3 from someone/branch"]).problem).toMatch(/"Merge pull request #3 from someone\/branch"/);
  });
});

describe("the review bot's verdict", () => {
  it("counts its header and a marker naming the head, on a submitted review of the head", () => {
    expect(reviewBotCoversHead([botReview(HEAD)], HEAD)).toBe(true);
  });

  it("refuses anything short of that, whatever else the review says", () => {
    const shortOf = [
      botReview(HEAD, { header: false }),
      botReview(OLD, { commit: HEAD }),
      botReview(HEAD, { commit: OLD }),
      botReview(HEAD, { login: "someone" }),
      botReview(HEAD, { state: "DISMISSED" }),
      botReview(HEAD, { state: "PENDING" }),
    ];
    for (const review of shortOf) expect(reviewBotCoversHead([review], HEAD), JSON.stringify(review)).toBe(false);
  });

  it("refuses a review made before the base last moved", () => {
    expect(reviewBotCoversHead([botReview(HEAD, { submitted_at: "2026-09-25T01:00:00Z" })], HEAD, "2026-09-25T01:30:00Z")).toBe(false);
  });
});

describe("coverage of one queued pull request", () => {
  it("is missing with no review, or with a review of an earlier revision only", () => {
    expect(coverage(evidence()).covered).toBe(false);
    expect(coverage(evidence({ reviews: [codexReview(OLD)] })).covered).toBe(false);
  });

  it("is Codex's, from a review of the head or from its summary of a clean one", () => {
    expect(coverage(evidence({ reviews: [codexReview(HEAD)] }))).toEqual({ number: 7, head: HEAD, covered: true, by: "Codex" });
    expect(coverage(evidence({ comments: [summary(HEAD)] })).by).toBe("Codex");
  });

  it("is the substitute's when Codex was held up and the review bot reviewed the head", () => {
    expect(coverage(evidence({ reviews: [botReview(HEAD)] })).by).toBe("the Nextly review bot");
  });

  it("does not count a workflow's review that lacks the bot's header, though it names the head", () => {
    expect(coverage(evidence({ reviews: [botReview(HEAD, { header: false })] })).covered).toBe(false);
  });

  it("is missing when the base moved after the only review", () => {
    expect(coverage(evidence({ reviews: [codexReview(HEAD, "2026-09-25T01:00:00Z")], timeline: baseMovedAt("2026-09-25T01:30:00Z") })).covered).toBe(false);
  });
});

describe("the command", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "independent-review-"));
    run("init", "-q", "-b", "main");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  function run(...args) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  }

  function commit(message) {
    run("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", message);
    return run("rev-parse", "HEAD");
  }

  /** A queue run over two squash commits, and an API that serves each pull request's evidence. */
  function queueOf(reviewsFor) {
    const base = commit("chore: the base");
    commit("feat(admin): add a dialog (#11)");
    const head = commit("fix(nextly): handle a timeout (#12)");
    const event = join(repo, "event.json");
    writeFileSync(event, JSON.stringify({ merge_group: { base_sha: base, head_sha: head } }));
    const heads = { 11: "1".repeat(40), 12: "2".repeat(40) };
    const routes = {};
    for (const number of [11, 12]) {
      routes[`repos/o/r/pulls/${number}`] = { head: { sha: heads[number] }, commits: 1 };
      routes[`repos/o/r/pulls/${number}/reviews?per_page=100&page=1`] = reviewsFor(number, heads[number]);
      routes[`repos/o/r/issues/${number}/comments?per_page=100&page=1`] = [];
      routes[`repos/o/r/pulls/${number}/commits?per_page=100&page=1`] = [{ sha: heads[number] }];
      routes[`repos/o/r/issues/${number}/timeline?per_page=100&page=1`] = [];
    }
    const fetchImpl = async url => {
      const path = url.replace("https://api.github.com/", "");
      return Object.hasOwn(routes, path) ? { ok: true, json: async () => routes[path] } : { ok: false, status: 404 };
    };
    const env = { GITHUB_EVENT_NAME: "merge_group", GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: "o/r" };
    return { env, deps: { git: args => readGit(args, { cwd: repo }), fetchImpl } };
  }

  const printed = () => console.log.mock.calls.map(call => call.join(" ")).join("\n");

  it("passes when every queued pull request was reviewed at its head", async () => {
    const { env, deps } = queueOf((number, head) => [codexReview(head)]);
    expect(await main(env, deps)).toBe(0);
    expect(printed()).toMatch(/#11 at 111111111 was reviewed by Codex/);
    expect(printed()).toMatch(/#12 at 222222222 was reviewed by Codex/);
  });

  it("fails naming the member of a group with no review of its head", async () => {
    const { env, deps } = queueOf((number, head) => (number === 11 ? [codexReview(head)] : [codexReview(OLD)]));
    expect(await main(env, deps)).toBe(1);
    expect(printed()).toMatch(/#12 has no independent review of 222222222/);
    expect(printed()).not.toMatch(/#11 has no independent review/);
  });

  it("fails, never passes, when it cannot read the evidence or name the queued pull requests", async () => {
    const unreadable = queueOf(() => []);
    expect(await main(unreadable.env, { ...unreadable.deps, fetchImpl: async () => ({ ok: false, status: 500 }) })).toBe(1);
    expect(printed()).toMatch(/Could not read the queued pull requests' reviews: GET repos\/o\/r\/pulls\/1[12]: HTTP 500/);
  });

  it("decides only in the queue, even over a queue whose every member was reviewed", async () => {
    const { env, deps } = queueOf((number, head) => [codexReview(head)]);
    expect(await main({ ...env, GITHUB_EVENT_NAME: "pull_request" }, deps)).toBe(1);
    expect(printed()).toMatch(/decides in the merge queue; a pull_request event has no queued revision/);
    // The control: the same queue, on the queue's own event, passes.
    expect(await main(env, deps)).toBe(0);
  });
});
