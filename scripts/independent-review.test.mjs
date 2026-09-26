/**
 * The merge queue's independent-review gate: which pull requests a queue run
 * lands, what counts as a review of the exact revision landing and what cannot,
 * and the command end to end over a real repository's queued commits.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODEX, REVIEW_BOT, codexHeldUp, coverage, main, queuedPullNumbers } from "./independent-review.mjs";
import { readGit } from "./workflow-context.mjs";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const AFTER = "2026-09-25T02:00:00Z";
/** The login every workflow in a repository posts as. */
const WORKFLOWS = "github-actions[bot]";

const codexReview = (sha, submitted_at = AFTER) => ({ user: { login: CODEX }, commit_id: sha, state: "COMMENTED", submitted_at, body: `**Reviewed commit:** \`${sha.slice(0, 10)}\`` });
const summary = (sha, login = CODEX) => ({
  user: { login },
  created_at: AFTER,
  body: `<!-- codex-pull-request-review-summary -->\n\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n| 📝 **Code Review** | ✅ **Completed** ${AFTER} | \`${sha.slice(0, 7)}\` | New commits |\n`,
});
/** A review exactly as the Nextly review bot writes one, posted under the workflows' shared login unless another is named. */
const botReview = (sha, login = WORKFLOWS) => ({
  user: { login },
  commit_id: sha,
  state: "COMMENTED",
  submitted_at: AFTER,
  body: `## Nextly Review Bot: round 1 - approve\n\n<!-- pr-review-agent round:1 head:${sha} -->\n\nNo findings.`,
});
/** The notice Codex posts in place of a review once its quota is spent, as it wrote it on 2026-09-12. */
const limitNotice = (created_at = "2026-09-25T03:00:00Z", login = CODEX) => ({
  user: { login },
  created_at,
  updated_at: created_at,
  body: "You have reached your Codex usage limits for code reviews. You can see your limits in the [Codex usage dashboard](https://chatgpt.com/codex/cloud/settings/usage).",
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

/** The API's answer for a route: its body, a status it fails with, or 404. */
function respond(routes, path) {
  if (!Object.hasOwn(routes, path)) return { ok: false, status: 404 };
  const answer = routes[path];
  return typeof answer === "number" ? { ok: false, status: answer } : { ok: true, status: 200, json: async () => answer };
}

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));

/** Runs the command's queue path from an isolated copy, answering the API from the routes it is given, as `respond` does. */
const DRIVER = [
  'import { main } from "./scripts/independent-review.mjs";',
  "const routes = JSON.parse(process.env.ROUTES);",
  respond.toString(),
  'process.exitCode = await main(process.env, { fetchImpl: async url => respond(routes, url.replace("https://api.github.com/", "")) });',
].join("\n");

describe("which pull requests a queue run lands", () => {
  it("reads each squash commit's number, in order", () => {
    expect(queuedPullNumbers(["feat(admin): add a dialog (#12)", "fix: handle it (#7)"])).toEqual({ numbers: [12, 7] });
  });

  it("refuses a commit it cannot name, rather than letting it land unasked", () => {
    expect(queuedPullNumbers(["feat: add a dialog (#12)", "Merge pull request #3 from someone/branch"]).problem).toMatch(/"Merge pull request #3 from someone\/branch"/);
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

  /*
   * Any workflow on any pushed branch posts as the same login, so a review or
   * a summary under it proves nothing about who reviewed, however exactly it
   * reads like a reviewer's own.
   */
  it("does not count anything posted under the login every workflow shares", () => {
    expect(coverage(evidence({ reviews: [botReview(HEAD)] })).covered).toBe(false);
    expect(coverage(evidence({ comments: [summary(HEAD, WORKFLOWS)] })).covered).toBe(false);
  });

  it("is missing when the pull request moved to another base branch after the only review", () => {
    expect(coverage(evidence({ reviews: [codexReview(HEAD, "2026-09-25T01:00:00Z")], timeline: baseMovedAt("2026-09-25T01:30:00Z") })).covered).toBe(false);
  });

  /*
   * The standby stands in for a reviewer that cannot review, and only then:
   * its review counts while Codex's latest word is its usage-limit notice, and
   * only under the bot's own App login, which no workflow shares.
   */
  it("is the review bot's, under its own App login, while Codex is held up by its usage limit", () => {
    const result = coverage(evidence({ reviews: [botReview(HEAD, REVIEW_BOT)], comments: [limitNotice()] }));
    expect(result).toEqual({ number: 7, head: HEAD, covered: true, by: "the Nextly review bot, while Codex is held up by its usage limit" });
  });

  it("is missing when the review bot reviewed but Codex is not held up", () => {
    expect(coverage(evidence({ reviews: [botReview(HEAD, REVIEW_BOT)] })).covered).toBe(false);
  });

  it("never counts the login every workflow shares, even while Codex is held up", () => {
    expect(coverage(evidence({ reviews: [botReview(HEAD)], comments: [limitNotice()] })).covered).toBe(false);
  });

  it("is missing when the review bot reviewed only an earlier revision while Codex is held up", () => {
    expect(coverage(evidence({ reviews: [botReview(OLD, REVIEW_BOT)], comments: [limitNotice()] })).covered).toBe(false);
  });

  it("is Codex's again once Codex reviews the head after its notice", () => {
    const result = coverage(evidence({ reviews: [botReview(HEAD, REVIEW_BOT), codexReview(HEAD, "2026-09-25T04:00:00Z")], comments: [limitNotice()] }));
    expect(result.by).toBe("Codex");
  });
});

/*
 * The bot's login is written in three places: here, in the gateway that finds
 * the reviews its run posted, and in the protocol that finds its earlier
 * rounds. Were one to drift, the gateway would report no review posted, or the
 * bot would lose its rounds, while this check still counted.
 */
it("names the login the review bot's gateway and protocol look for", () => {
  const gateway = readFileSync(join(SCRIPTS, "..", ".github", "scripts", "review-bot-gh.sh"), "utf8");
  const protocol = readFileSync(join(SCRIPTS, "..", ".github", "review-prompt.md"), "utf8");
  expect(gateway).toContain(`select(.user.login == "${REVIEW_BOT}"`);
  expect(protocol).toContain(`filter author login \`${REVIEW_BOT}\``);
  expect(gateway).not.toContain(`"${WORKFLOWS}"`);
});

describe("whether Codex is held up by its usage limit", () => {
  it("is so while its usage-limit notice is its latest word", () => {
    expect(codexHeldUp([codexReview(OLD, "2026-09-25T01:00:00Z")], [summary(OLD), limitNotice()])).toBe(true);
  });

  it("is not once it has reviewed or updated its summary since the notice", () => {
    expect(codexHeldUp([codexReview(OLD, "2026-09-25T04:00:00Z")], [limitNotice()])).toBe(false);
    expect(codexHeldUp([], [limitNotice(), { ...summary(OLD), updated_at: "2026-09-25T04:00:00Z" }])).toBe(false);
  });

  it("is not with no notice, or with the notice's words under another login", () => {
    expect(codexHeldUp([], [summary(OLD)])).toBe(false);
    expect(codexHeldUp([], [limitNotice(undefined, WORKFLOWS)])).toBe(false);
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

  /**
   * A queue run over two squash commits, and an API that serves each pull
   * request's evidence: its reviews and comments, its timeline, and what
   * GitHub resolves an abbreviation to, a revision or 422.
   */
  function queueOf(reviewsFor, { commentsFor = () => [], timeline = [], resolves = {} } = {}) {
    const base = commit("chore: the base");
    commit("feat(admin): add a dialog (#11)");
    const head = commit("fix(nextly): handle a timeout (#12)");
    const event = join(repo, "event.json");
    writeFileSync(event, JSON.stringify({ merge_group: { base_sha: base, head_sha: head } }));
    const heads = { 11: "1".repeat(40), 12: "2".repeat(40) };
    const routes = {};
    for (const number of [11, 12]) {
      routes[`repos/o/r/pulls/${number}`] = { head: { sha: heads[number] }, commits: 1 };
      pagesOf(reviewsFor(number, heads[number])).forEach((page, index) => {
        routes[`repos/o/r/pulls/${number}/reviews?per_page=100&page=${index + 1}`] = page;
      });
      routes[`repos/o/r/issues/${number}/comments?per_page=100&page=1`] = commentsFor(number, heads[number]);
      routes[`repos/o/r/pulls/${number}/commits?per_page=100&page=1`] = [{ sha: heads[number] }];
      routes[`repos/o/r/issues/${number}/timeline?per_page=100&page=1`] = timeline;
    }
    for (const [abbreviation, answer] of Object.entries(resolves)) routes[`repos/o/r/commits/${abbreviation}`] = answer;
    const fetchImpl = async url => respond(routes, url.replace("https://api.github.com/", ""));
    const env = { GITHUB_EVENT_NAME: "merge_group", GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: "o/r" };
    return { env, routes, deps: { git: args => readGit(args, { cwd: repo }), fetchImpl } };
  }

  /** A list as the API pages it: 100 to a page, and an empty page after a full one. */
  function pagesOf(items) {
    const pages = [];
    for (let start = 0; start <= items.length; start += 100) pages.push(items.slice(start, start + 100));
    return pages;
  }

  const printed = () => console.log.mock.calls.map(call => call.join(" ")).join("\n");
  const rewritten = [{ event: "head_ref_force_pushed", created_at: "2026-09-25T01:00:00Z" }];
  const cleanPass = (number, head) => [summary(head)];

  // After a rewrite a clean pass is known only by its abbreviation, which the
  // repository itself resolves: to one commit, or with 422 to none.
  const resolves = { [`1`.repeat(7)]: { sha: "1".repeat(40) }, [`2`.repeat(7)]: { sha: "2".repeat(40) } };

  it("counts a clean pass after a force-push where GitHub resolves its abbreviation to the head", async () => {
    const { env, deps } = queueOf(() => [], { commentsFor: cleanPass, timeline: rewritten, resolves });
    expect(await main(env, deps)).toBe(0);
    expect(printed()).toMatch(/#12 at 222222222 was reviewed by Codex/);
  });

  it("does not count it where GitHub resolves the abbreviation to nothing, or to another commit", async () => {
    const ambiguous = queueOf(() => [], { commentsFor: cleanPass, timeline: rewritten, resolves: { [`1`.repeat(7)]: 422, [`2`.repeat(7)]: 422 } });
    expect(await main(ambiguous.env, ambiguous.deps)).toBe(1);
    // An abbreviation that names no single commit is unresolved, not unreadable.
    expect(printed()).toMatch(/#12 has no independent review of 222222222/);
    expect(printed()).not.toMatch(/Could not read/);
    const elsewhere = queueOf(() => [], { commentsFor: cleanPass, timeline: rewritten, resolves: { [`1`.repeat(7)]: { sha: OLD }, [`2`.repeat(7)]: { sha: OLD } } });
    expect(await main(elsewhere.env, elsewhere.deps)).toBe(1);
    expect(printed()).toMatch(/#12 has no independent review of 222222222/);
  });

  // A ref named like the abbreviation, wherever git's rules would find it,
  // could point it at any commit, such as one made to share a reviewed
  // revision's prefix.
  it("does not count it where a ref bears the abbreviation's name, in any place git reads a name from", async () => {
    const name = "2".repeat(7);
    for (const place of [name, `tags/${name}`, `heads/${name}`, `remotes/${name}`, `remotes/${name}/HEAD`]) {
      const shadowed = queueOf(() => [], { commentsFor: cleanPass, timeline: rewritten, resolves });
      shadowed.routes[`repos/o/r/git/ref/${place}`] = { ref: `refs/${place}`, object: { sha: "2".repeat(40) } };
      expect(await main(shadowed.env, shadowed.deps), place).toBe(1);
      expect(printed()).toMatch(/#11 at 111111111 was reviewed by Codex/);
      expect(printed()).toMatch(/#12 has no independent review of 222222222/);
    }
  });

  /** The queue path run by a plain Node process from a copy of the scripts outside the repository. */
  function runIsolated({ env, routes }) {
    const isolated = mkdtempSync(join(tmpdir(), "independent-review-isolated-"));
    try {
      mkdirSync(join(isolated, "scripts"));
      for (const file of readdirSync(SCRIPTS).filter(name => name.endsWith(".mjs") && !name.includes(".test."))) copyFileSync(join(SCRIPTS, file), join(isolated, "scripts", file));
      writeFileSync(join(isolated, "run.mjs"), DRIVER);
      return spawnSync(process.execPath, [join(isolated, "run.mjs")], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env, ROUTES: JSON.stringify(routes) } });
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  }

  /*
   * The job installs no packages, so the script has to run with none anywhere
   * above it. Run from a copy of the scripts with no packages anywhere above
   * it, any load of a package on the path taken fails, whatever form the load
   * takes. So each path a queue run can take is run: a review of the head, a
   * clean pass after a rewrite with GitHub's answers to its abbreviation, a
   * missing review, an unreadable API, and an event that is not a queue's.
   */
  it("runs every queue path from a copy of the scripts with no packages anywhere above it", () => {
    const reviewed = queueOf((number, head) => [codexReview(head)]);
    const runs = [
      [reviewed, 0, /#12 at 222222222 was reviewed by Codex/],
      [queueOf(() => [], { commentsFor: cleanPass, timeline: rewritten, resolves }), 0, /#12 at 222222222 was reviewed by Codex/],
      [queueOf(() => [], { commentsFor: cleanPass, timeline: rewritten, resolves: { [`1`.repeat(7)]: 422, [`2`.repeat(7)]: 422 } }), 1, /#12 has no independent review of 222222222/],
      [{ env: reviewed.env, routes: {} }, 1, /Could not read the queued pull requests' reviews/],
      [{ env: { ...reviewed.env, GITHUB_EVENT_NAME: "pull_request" }, routes: reviewed.routes }, 1, /decides in the merge queue/],
    ];
    for (const [queue, status, says] of runs) {
      const result = runIsolated(queue);
      expect(result.status, result.stderr).toBe(status);
      expect(`${result.stdout}${result.stderr}`).toMatch(says);
    }
  });

  it("passes when every queued pull request was reviewed at its head", async () => {
    const { env, deps } = queueOf((number, head) => [codexReview(head)]);
    expect(await main(env, deps)).toBe(0);
    expect(printed()).toMatch(/#11 at 111111111 was reviewed by Codex/);
    expect(printed()).toMatch(/#12 at 222222222 was reviewed by Codex/);
  });

  it("passes a pull request the review bot reviewed at its head while Codex was held up, and says so", async () => {
    const { env, deps } = queueOf((number, head) => (number === 11 ? [codexReview(head)] : [botReview(head, REVIEW_BOT)]), {
      commentsFor: number => (number === 12 ? [limitNotice()] : []),
    });
    expect(await main(env, deps)).toBe(0);
    expect(printed()).toMatch(/#11 at 111111111 was reviewed by Codex/);
    expect(printed()).toMatch(/#12 at 222222222 was reviewed by the Nextly review bot, while Codex is held up by its usage limit/);
  });

  it("fails naming the member of a group with no review of its head", async () => {
    const { env, deps } = queueOf((number, head) => (number === 11 ? [codexReview(head)] : [codexReview(OLD)]));
    expect(await main(env, deps)).toBe(1);
    expect(printed()).toMatch(/#12 has no independent review of 222222222/);
    expect(printed()).not.toMatch(/#11 has no independent review/);
    expect(console.error.mock.calls.flat().join(" ")).toMatch(/comment `@codex review` on that pull request/);
  });

  it("fails, never passes, when it cannot read the evidence or name the queued pull requests", async () => {
    const unreadable = queueOf(() => []);
    expect(await main(unreadable.env, { ...unreadable.deps, fetchImpl: async () => ({ ok: false, status: 500 }) })).toBe(1);
    expect(printed()).toMatch(/Could not read the queued pull requests' reviews: GET repos\/o\/r\/pulls\/1[12]: HTTP 500/);
  });

  it("reads a list that exactly fills the page ceiling, and refuses one past it", async () => {
    const withFiller = count => (number, head) => [...Array.from({ length: count }, () => codexReview(OLD)), codexReview(head)];
    const full = queueOf(withFiller(999));
    expect(await main(full.env, full.deps)).toBe(0);
    const past = queueOf(withFiller(1000));
    expect(await main(past.env, past.deps)).toBe(1);
    expect(printed()).toMatch(/GET repos\/o\/r\/pulls\/1[12]\/reviews: more than 1000 items/);
  });

  it("decides only in the queue, even over a queue whose every member was reviewed", async () => {
    const { env, deps } = queueOf((number, head) => [codexReview(head)]);
    expect(await main({ ...env, GITHUB_EVENT_NAME: "pull_request" }, deps)).toBe(1);
    expect(printed()).toMatch(/decides in the merge queue; a pull_request event has no queued revision/);
    // The control: the same queue, on the queue's own event, passes.
    expect(await main(env, deps)).toBe(0);
  });
});
