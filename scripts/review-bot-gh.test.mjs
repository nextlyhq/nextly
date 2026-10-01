/**
 * The review bot's gateway: its reads of the local history, run against a real
 * clone, and its posting, run against a stand-in for `gh`.
 *
 * The agent reads history through these subcommands instead of a `git`
 * prefix, because `git diff`, `git show` and `git log` take `--output=<file>`
 * and so write wherever the runner can. What separates the gateway from that
 * prefix is that no argument the agent passes can become a flag: each is
 * validated, then joined to a revision or a line range. So each refusal below
 * is asserted with the file it would have written, and the first test is the
 * control that shows this fixture sees such a write when one happens.
 *
 * The post job posts through the gateway once per run, so re-running a failed
 * job cannot post a review or a reply twice. Whether a re-run recognises its
 * own post is asked of the post itself: the stand-in keeps what the gateway
 * sent, and a test hands that back as what GitHub now lists.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { REVIEW_BOT } from "./independent-review.mjs";

const GATEWAY = fileURLToPath(new URL("../.github/scripts/review-bot-gh.sh", import.meta.url));
const MARK = "written-by-an-option";

let clone;
let first;
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: clone, encoding: "utf8" });
const gateway = (...args) =>
  spawnSync("bash", [GATEWAY, ...args], { cwd: clone, encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "owner/name" } });

beforeAll(() => {
  // `main` holds the first version of the file; the head changes its middle line.
  clone = mkdtempSync(join(tmpdir(), "review-bot-gh-"));
  git("init", "-q");
  writeFileSync(join(clone, "f.txt"), "one\ntwo\nthree\n");
  git("add", "f.txt");
  git("commit", "-qm", "first");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  first = git("rev-parse", "HEAD").trim();
  writeFileSync(join(clone, "f.txt"), "one\nTWO\nthree\n");
  git("commit", "-qam", "second");
});

afterAll(() => rmSync(clone, { recursive: true, force: true }));

describe("a model key in reach of the gateway", () => {
  // The review workflow says it had Claude Code scrub credentials from every
  // command the agent runs. The environment is built from nothing but what
  // each test names, so a key in the shell running the suite decides nothing.
  const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
  const run = (extra, ...args) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => ![...KEYS, "REVIEW_BOT_EXPECT_SCRUB"].includes(name)));
    return spawnSync("bash", [GATEWAY, ...args], { cwd: clone, encoding: "utf8", env: { ...env, GITHUB_REPOSITORY: "owner/name", ...extra } });
  };

  it.each(KEYS)("stops, and names no key, when the workflow expects a scrub and %s got through", name => {
    const stopped = run({ REVIEW_BOT_EXPECT_SCRUB: "1", [name]: "the-key" }, "base-file", "f.txt");
    expect(stopped.status).not.toBe(0);
    expect(stopped.stdout).toBe("");
    expect(stopped.stderr).toContain("a model key reached this command");
    expect(stopped.stderr).not.toContain("the-key");
  });

  it("answers when the workflow expects a scrub and no key got through", () => {
    const answered = run({ REVIEW_BOT_EXPECT_SCRUB: "1" }, "base-file", "f.txt");
    expect(answered.status).toBe(0);
    expect(answered.stdout).toBe("one\ntwo\nthree\n");
  });

  it("holds a caller that expects no scrub to nothing", () => {
    const answered = run({ ANTHROPIC_API_KEY: "the-key" }, "base-file", "f.txt");
    expect(answered.status).toBe(0);
    expect(answered.stdout).toBe("one\ntwo\nthree\n");
  });
});

describe("reading the local history through the gateway", () => {
  it("is needed: a git prefix given --output writes a file here", () => {
    git("diff", `--output=${MARK}`, first, "HEAD");
    expect(existsSync(join(clone, MARK))).toBe(true);
    rmSync(join(clone, MARK));
  });

  it("reads a file as main has it", () => {
    const run = gateway("base-file", "f.txt");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("one\ntwo\nthree\n");
  });

  it("shows what changed since a reviewed commit", () => {
    const run = gateway("delta", first);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("-two\n+TWO\n");
  });

  it("shows a line's history on the head, or on main when asked", () => {
    const commits = run => run.stdout.split("\n").filter(line => line.startsWith("commit ")).length;
    expect(commits(gateway("line-history", "2,2", "f.txt"))).toBe(2);
    expect(commits(gateway("line-history", "2,2", "f.txt", "main"))).toBe(1);
  });

  it.each([
    ["delta", `--output=${MARK}`],
    ["line-history", "1,2", `--output=${MARK}`],
    ["line-history", "1,2", "f.txt", `--output=${MARK}`],
    ["line-history", `--output=${MARK}`, "f.txt"],
    ["base-file", `--output=${MARK}`],
  ])("refuses %s given an option, and writes nothing", (...args) => {
    const run = gateway(...args);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/^review-bot-gh: expected /);
    expect(existsSync(join(clone, MARK))).toBe(false);
  });
});

/**
 * Stands in for `gh`: records each call, answers a list or the head from files
 * a test writes, and keeps the body each POST would have sent, read the way
 * `gh` reads it: from `--input` (a file, or `-` for stdin) or from `-F` fields.
 */
const FAKE_GH = String.raw`#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const args = process.argv.slice(2);
const fake = file => join(process.env.FAKE, file);
const after = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
appendFileSync(fake("calls"), args.join(" ") + "\n");
// A review-thread read answers the pages the test wrote, one per line: all of
// them when asked with --paginate, as gh follows each page's cursor, and only
// the first when not. A thread's own comments are thread-<id>.
const query = args.find(arg => arg.startsWith("query=")) ?? "";
if (args[1] === "graphql" && /reviewThreads|PullRequestReviewThread/.test(query)) {
  const id = args.find(arg => arg.startsWith("id="))?.slice(3);
  const file = fake(id === undefined ? "threads" : "thread-" + id);
  if (!existsSync(file)) process.exit(1);
  const pages = readFileSync(file, "utf8").split("\n").filter(Boolean);
  process.stdout.write((args.includes("--paginate") ? pages : pages.slice(0, 1)).join("\n") + "\n");
  process.exit(0);
}
if (after("--method") === "POST") {
  const input = after("--input");
  const body = input === undefined ? {} : JSON.parse(readFileSync(input === "-" ? 0 : input, "utf8"));
  args.forEach((arg, i) => {
    if (arg !== "-F" && arg !== "-f") return;
    const [key, ...rest] = args[i + 1].split("=");
    const value = rest.join("=");
    // -f sends its value as a string, as gh does; -F reads a file or a number.
    if (arg === "-f") body[key] = value;
    else body[key] = value.startsWith("@") ? readFileSync(value.slice(1), "utf8") : /^\d+$/.test(value) ? Number(value) : value;
  });
  body.endpoint = args[args.indexOf("--method") + 2];
  appendFileSync(fake("posted"), JSON.stringify(body) + "\n");
  console.log('{"id": 1}');
} else if (args[1] === "--paginate") {
  if (existsSync(fake("unreadable"))) process.exit(1);
  // A list the test names by its last two path segments ("11-comments" for a
  // review's comments) comes first; otherwise the last one names it.
  const path = args[2].split("?")[0];
  const specific = fake(path.split("/").slice(-2).join("-"));
  process.stdout.write(readFileSync(existsSync(specific) ? specific : fake(basename(path)), "utf8"));
} else if (after("--jq") === ".head.sha") {
  process.stdout.write(readFileSync(fake("head"), "utf8"));
} else {
  console.error("gh stand-in: unexpected call: " + args.join(" "));
  process.exit(64);
}
`;

describe.runIf(process.platform !== "win32")("posting once per run", () => {
  const RUN = "424242";
  const NEXT_RUN = "424243";
  const HEAD = "a".repeat(40);
  /** The login the merge queue counts, so the gateway is held to the same spelling. */
  const BOT = REVIEW_BOT;
  let fake;

  beforeAll(() => {
    fake = mkdtempSync(join(tmpdir(), "review-bot-gh-api-"));
    mkdirSync(join(fake, "bin"));
    writeFileSync(join(fake, "bin", "gh"), FAKE_GH);
    chmodSync(join(fake, "bin", "gh"), 0o755);
  });

  afterAll(() => rmSync(fake, { recursive: true, force: true }));

  /** What a list endpoint answers, one array per page. */
  const listed = (endpoint, ...pages) =>
    writeFileSync(join(fake, endpoint), (pages.length > 0 ? pages : [[]]).map(page => JSON.stringify(page)).join("\n"));

  beforeEach(() => {
    for (const name of ["calls", "posted", "unreadable"]) rmSync(join(fake, name), { force: true });
    listed("reviews");
    listed("comments");
    listed("files", [{ filename: "src/a.ts" }]);
    writeFileSync(join(fake, "head"), `${HEAD}\n`);
    // A pull request without review threads, one page of none.
    writeFileSync(join(fake, "threads"), JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } }));
  });

  const api = (...args) =>
    spawnSync("bash", [GATEWAY, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(fake, "bin")}${delimiter}${process.env.PATH}`, FAKE: fake, GITHUB_REPOSITORY: "owner/name" },
    });
  /** Everything the gateway has POSTed since the test began. */
  const posts = () =>
    existsSync(join(fake, "posted"))
      ? readFileSync(join(fake, "posted"), "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line))
      : [];
  const calls = () => (existsSync(join(fake, "calls")) ? readFileSync(join(fake, "calls"), "utf8").trim().split("\n") : []);

  /** A review as the post job builds it from the payload. */
  function payload(body) {
    const file = join(fake, "review.json");
    writeFileSync(file, JSON.stringify({ commit_id: HEAD, event: "COMMENT", body, comments: [] }));
    return file;
  }

  /** Posts a review as `run`, requiring that it was sent, and returns it as GitHub would list it. */
  function postedBy(run, body = "the review") {
    const before = posts().length;
    const result = api("post-review", "7", payload(body), HEAD, run);
    expect(result.status, result.stderr).toBe(0);
    const sent = posts().slice(before);
    expect(sent, `run ${run} posts its review`).toHaveLength(1);
    return { id: 11, user: { login: BOT }, commit_id: HEAD, body: sent[0].body };
  }

  /** Posts reply `place` of `run`'s payload in thread 101, requiring that it was sent. */
  function repliedBy(run, place) {
    const file = join(fake, "reply.md");
    writeFileSync(file, "the reply\n");
    const before = posts().length;
    const result = api("reply", "7", HEAD, "101", file, run, String(place));
    expect(result.status, result.stderr).toBe(0);
    const sent = posts().slice(before);
    expect(sent, `reply ${place} of run ${run} is posted`).toHaveLength(1);
    expect(sent[0].in_reply_to).toBe(101);
    return { id: 21, user: { login: BOT }, in_reply_to_id: 101, body: sent[0].body };
  }

  it("posts a review as built, adding only a tag that renders as nothing", () => {
    const review = postedBy(RUN);
    expect(posts()[0]).toMatchObject({ commit_id: HEAD, event: "COMMENT", comments: [] });
    expect(review.body.startsWith("the review\n")).toBe(true);
    expect(review.body.slice("the review".length).trim()).toMatch(/^<!--(?:(?!-->)[^])*-->$/);
  });

  it("does not post a review again once this run's is listed, on any page", () => {
    const review = postedBy(RUN);
    listed("reviews", [{ id: 5, user: { login: "someone" }, commit_id: HEAD, body: "unrelated" }], [review]);
    const again = api("post-review", "7", payload("the review"), HEAD, RUN);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stderr).toContain("already posted review 11");
    expect(posts()).toHaveLength(1);
  });

  it("posts afresh for a new run on the same head", () => {
    listed("reviews", [postedBy(RUN)]);
    postedBy(NEXT_RUN);
  });

  it("counts only the bot's own review, at the head being posted", () => {
    const review = postedBy(RUN);
    listed("reviews", [
      { ...review, user: { login: "someone" } },
      { ...review, commit_id: "b".repeat(40) },
    ]);
    postedBy(RUN);
  });

  it("counts a run's tag only where the gateway puts it, last", () => {
    // The agent writes the review's text, so it can copy a later run's tag
    // into it. That must not make the later run skip its own review.
    const later = postedBy(NEXT_RUN, "a later run's review");
    const forged = postedBy(RUN, later.body);
    expect(forged.body.includes(later.body), "the later run's tag is in the text").toBe(true);
    listed("reviews", [forged]);
    postedBy(NEXT_RUN);
  });

  it("refuses to post, rather than guess, when the reviews cannot be read", () => {
    writeFileSync(join(fake, "unreadable"), "");
    const result = api("post-review", "7", payload("the review"), HEAD, RUN);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not read the reviews");
    expect(posts()).toEqual([]);
  });

  it("refuses to post once the head has moved", () => {
    writeFileSync(join(fake, "head"), `${"b".repeat(40)}\n`);
    const result = api("post-review", "7", payload("the review"), HEAD, RUN);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("head moved");
    expect(posts()).toEqual([]);
  });

  /** Posts file-level comment `place` of `run` on `path`, requiring that it was sent. */
  function filedBy(run, place, path = "src/a.ts") {
    const file = join(fake, "finding.md");
    writeFileSync(file, "the finding\n");
    const before = posts().length;
    const result = api("post-file-comment", "7", HEAD, path, file, run, String(place));
    expect(result.status, result.stderr).toBe(0);
    const sent = posts().slice(before);
    expect(sent, `file comment ${place} of run ${run} is posted`).toHaveLength(1);
    expect(sent[0]).toMatchObject({ commit_id: HEAD, path, subject_type: "file" });
    return { id: 31, user: { login: BOT }, path, body: sent[0].body };
  }

  it("posts a file-level comment on a changed file, once per run and place in the payload", () => {
    const comment = filedBy(RUN, 0);
    expect(comment.body.startsWith("the finding\n")).toBe(true);
    listed("comments", [comment]);
    const again = api("post-file-comment", "7", HEAD, "src/a.ts", join(fake, "finding.md"), RUN, "0");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stderr).toContain("already posted file comment 0 as comment 31");
    expect(posts()).toHaveLength(1);
    filedBy(RUN, 1);
    filedBy(NEXT_RUN, 0);
  });

  it("refuses a file-level comment on a file the change does not touch, and posts nothing", () => {
    writeFileSync(join(fake, "finding.md"), "the finding\n");
    const result = api("post-file-comment", "7", HEAD, "src/b.ts", join(fake, "finding.md"), RUN, "0");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("src/b.ts is not among the files the change touches");
    expect(posts()).toEqual([]);
  });

  it("refuses a file-level comment once the head has moved, and posts nothing", () => {
    writeFileSync(join(fake, "finding.md"), "the finding\n");
    writeFileSync(join(fake, "head"), `${"b".repeat(40)}\n`);
    const result = api("post-file-comment", "7", HEAD, "src/a.ts", join(fake, "finding.md"), RUN, "0");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("head moved");
    expect(posts()).toEqual([]);
  });

  it("posts a reply once per run and place in the payload", () => {
    const reply = repliedBy(RUN, 0);
    expect(reply.body.startsWith("the reply\n")).toBe(true);
    listed("comments", [reply]);
    const again = api("reply", "7", HEAD, "101", join(fake, "reply.md"), RUN, "0");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stderr).toContain("already posted reply 0 as comment 21");
    expect(posts()).toHaveLength(1);
    repliedBy(RUN, 1);
    repliedBy(NEXT_RUN, 0);
  });

  it("posts no reply once the head has moved from the one reviewed", () => {
    // The review refuses a moved head as it posts; a reply must too, or it
    // lands on a pull request whose review never did.
    writeFileSync(join(fake, "reply.md"), "the reply\n");
    writeFileSync(join(fake, "head"), `${"b".repeat(40)}\n`);
    const result = api("reply", "7", HEAD, "101", join(fake, "reply.md"), RUN, "0");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`head moved to ${"b".repeat(40)} since ${HEAD} was reviewed; not posting`);
    expect(posts()).toEqual([]);
  });

  it("asks for each thread's newest comments whole, and when every comment was made", () => {
    // The post job tells a thread that moved during the review by its newest
    // comment, and the agent reads that comment's argument before it
    // classifies the finding.
    api("threads", "7");
    const query = calls().join("\n");
    // The control: the call reached GitHub, with the thread query.
    expect(query).toContain("reviewThreads(first:100,after:$endCursor)");
    expect(query).toContain("recent: comments(last:10){ nodes{ author{login} body url databaseId createdAt } }");
    expect(query).toContain("comments(first:100){ totalCount nodes{ author{login} body url databaseId createdAt } }");
  });

  describe("reading every review thread", () => {
    const comment = id => ({ author: { login: "someone" }, body: `comment ${id}`, url: `https://example.test/${id}`, databaseId: id, createdAt: "2026-09-30T10:00:00Z" });
    /** A thread as the threads read returns it: its first page of comments, out of `total`. */
    const thread = (id, comments, total = comments.length) => ({
      id,
      isResolved: false,
      isOutdated: false,
      path: "src/a.ts",
      line: 1,
      comments: { totalCount: total, nodes: comments.map(comment) },
      recent: { nodes: comments.slice(-10).map(comment) },
    });
    /** One page of threads, with the cursor of the next when there is one. */
    const threadPage = (nodes, next) => ({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null }, nodes } } } } });
    /** One page of a thread's comments, read through its id. */
    const commentPage = (ids, next) => ({ data: { node: { comments: { pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null }, nodes: ids.map(comment) } } } });
    const pages = (file, ...answers) => writeFileSync(join(fake, file), answers.map(answer => JSON.stringify(answer)).join("\n"));
    /** Every call as the stand-in recorded it, whole: a query spans lines. */
    const asked = () => (existsSync(join(fake, "calls")) ? readFileSync(join(fake, "calls"), "utf8") : "");
    const read = () => {
      const result = api("threads", "7");
      return { ...result, threads: result.status === 0 ? JSON.parse(result.stdout).data.repository.pullRequest.reviewThreads.nodes : null };
    };

    beforeEach(() => {
      for (const name of ["threads", "thread-T2"]) rmSync(join(fake, name), { force: true });
    });

    it("reads every thread past the first page, and every comment past a thread's first page", () => {
      pages("threads", threadPage([thread("T1", [1, 2]), thread("T2", [3, 4], 5)], "c1"), threadPage([thread("T3", [8])]));
      pages("thread-T2", commentPage([3, 4], "d1"), commentPage([5, 6, 7]));
      const { status, stderr, threads } = read();
      expect(status, stderr).toBe(0);
      expect(threads.map(({ id, comments }) => [id, comments.nodes.map(c => c.databaseId)])).toEqual([
        ["T1", [1, 2]],
        ["T2", [3, 4, 5, 6, 7]],
        ["T3", [8]],
      ]);
      // The rest of each thread is as GitHub answered it, `recent` included.
      expect(threads[1].recent.nodes.map(c => c.databaseId)).toEqual([3, 4]);
      expect(threads[0].isResolved).toBe(false);
      // Only the thread with more comments than its first page is read again,
      // every page of it.
      expect(asked().split("PullRequestReviewThread")).toHaveLength(2);
      expect(asked()).toContain("api graphql --paginate -f id=T2 -f query=");
    });

    it("pages by the threads' own cursor: theirs comes first, and no connection inside them asks for one", () => {
      pages("threads", threadPage([thread("T1", [1])]));
      read();
      const query = asked();
      expect(query).toContain("api graphql --paginate -F owner=owner");
      expect(query).toContain("$endCursor:String");
      // gh follows the first pageInfo in an answer, so it must be the threads'.
      expect(query.indexOf("pageInfo")).toBeLessThan(query.indexOf("nodes"));
      expect(query.split("pageInfo")).toHaveLength(2);
    });

    it.each([
      ["a page of the threads", () => rmSync(join(fake, "threads"))],
      ["a page of a long thread's comments", () => rmSync(join(fake, "thread-T2"))],
    ])("prints nothing, and fails, when %s cannot be read", (_, unread) => {
      pages("threads", threadPage([thread("T1", [1]), thread("T2", [3], 2)]));
      pages("thread-T2", commentPage([3, 4]));
      unread();
      const result = read();
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^review-bot-gh: could not read/m);
    });

    it("refuses a thread id that is not a node id, and asks nothing with it", () => {
      pages("threads", threadPage([thread("T1 --hostname=elsewhere", [1], 2)]));
      const result = read();
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("expected a review thread's node id");
      expect(asked()).not.toContain("PullRequestReviewThread");
    });
  });

  it("counts a reply only in the thread it answers", () => {
    listed("comments", [{ ...repliedBy(RUN, 0), in_reply_to_id: 102 }]);
    repliedBy(RUN, 0);
  });

  it.each(["eyes", "+1", "rocket", "confused"])("reacts %s to the comment that asked, and nowhere else", reaction => {
    const result = api("react-request", "123", reaction);
    expect(result.status, result.stderr).toBe(0);
    expect(posts()).toEqual([{ content: reaction, endpoint: "repos/owner/name/issues/comments/123/reactions" }]);
  });

  it("reacts with none of the others, and to no comment but a number", () => {
    for (const [comment, reaction] of [["123", "heart"], ["123", "-1"], ["123", ""], ["12/../3", "eyes"], ["-1", "eyes"]]) {
      expect(api("react-request", comment, reaction).status, `${comment} ${reaction}`).toBe(2);
    }
    expect(posts()).toEqual([]);
  });

  it("seeds 👍 and 👎 on each finding a run posted, and on none of its replies or another run's", () => {
    const mine = postedBy(RUN);
    listed("reviews", [mine, { ...postedBy(NEXT_RUN), id: 12 }]);
    // The run's review holds two inline findings; the other run's one more.
    listed("11-comments", [{ id: 31 }, { id: 32 }]);
    listed("12-comments", [{ id: 99 }]);
    const tagged = (id, tag, extra = {}) => ({ id, user: { login: BOT }, body: `a finding\n\n<!-- nextly-review-bot run:${tag} -->`, ...extra });
    listed("comments", [tagged(41, `${RUN} file:0`), tagged(42, `${RUN} reply:0`, { in_reply_to_id: 101 }), tagged(43, `${NEXT_RUN} file:0`), { ...tagged(44, `${RUN} file:1`), user: { login: "someone" } }]);
    const before = posts().length;
    const result = api("seed-reactions", "7", HEAD, RUN);
    expect(result.status, result.stderr).toBe(0);
    const seeded = posts()
      .slice(before)
      .map(post => `${post.endpoint.split("/")[5]} ${post.content}`);
    expect(seeded).toEqual(["31 +1", "31 -1", "32 +1", "32 -1", "41 +1", "41 -1"]);
  });

  it("lists the reviews one run posted at one head, and no other", () => {
    const mine = postedBy(RUN);
    const next = { ...postedBy(NEXT_RUN), id: 12 };
    listed("reviews", [mine, next, { ...mine, id: 13, commit_id: "b".repeat(40) }]);
    const result = api("review-ids-at", "7", HEAD, RUN);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("11\n");
  });

  it.each([
    ["post-review", "7", "review.json", "a".repeat(40), "--run"],
    ["reply", "7", "a".repeat(40), "101", "reply.md", "424242", "--place"],
    ["review-ids-at", "7", "a".repeat(40), "--run"],
    ["post-file-comment", "7", "a".repeat(40), "src/a.ts", "reply.md", "424242", "--place"],
  ])("refuses %s given anything but a number for the run or place, and asks GitHub nothing", (command, ...args) => {
    writeFileSync(join(fake, "review.json"), "{}");
    writeFileSync(join(fake, "reply.md"), "the reply\n");
    const result = api(command, ...args.map(arg => (arg.endsWith(".json") || arg.endsWith(".md") ? join(fake, arg) : arg)));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^review-bot-gh: expected a number/);
    expect(calls()).toEqual([]);
  });
});
