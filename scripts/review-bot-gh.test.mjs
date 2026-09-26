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
if (after("--method") === "POST") {
  const input = after("--input");
  const body = input === undefined ? {} : JSON.parse(readFileSync(input === "-" ? 0 : input, "utf8"));
  args.forEach((arg, i) => {
    if (arg !== "-F") return;
    const [key, ...rest] = args[i + 1].split("=");
    const value = rest.join("=");
    body[key] = value.startsWith("@") ? readFileSync(value.slice(1), "utf8") : /^\d+$/.test(value) ? Number(value) : value;
  });
  appendFileSync(fake("posted"), JSON.stringify(body) + "\n");
  console.log('{"id": 1}');
} else if (args[1] === "--paginate") {
  if (existsSync(fake("unreadable"))) process.exit(1);
  process.stdout.write(readFileSync(fake(basename(args[2].split("?")[0])), "utf8"));
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
    writeFileSync(join(fake, "head"), `${HEAD}\n`);
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
    const result = api("reply", "7", "101", file, run, String(place));
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

  it("posts a reply once per run and place in the payload", () => {
    const reply = repliedBy(RUN, 0);
    expect(reply.body.startsWith("the reply\n")).toBe(true);
    listed("comments", [reply]);
    const again = api("reply", "7", "101", join(fake, "reply.md"), RUN, "0");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stderr).toContain("already posted reply 0 as comment 21");
    expect(posts()).toHaveLength(1);
    repliedBy(RUN, 1);
    repliedBy(NEXT_RUN, 0);
  });

  it("counts a reply only in the thread it answers", () => {
    listed("comments", [{ ...repliedBy(RUN, 0), in_reply_to_id: 102 }]);
    repliedBy(RUN, 0);
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
    ["reply", "7", "101", "reply.md", "424242", "--place"],
    ["review-ids-at", "7", "a".repeat(40), "--run"],
  ])("refuses %s given anything but a number for the run or place, and asks GitHub nothing", (command, ...args) => {
    writeFileSync(join(fake, "review.json"), "{}");
    writeFileSync(join(fake, "reply.md"), "the reply\n");
    const result = api(command, ...args.map(arg => (arg.endsWith(".json") || arg.endsWith(".md") ? join(fake, arg) : arg)));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^review-bot-gh: expected a number/);
    expect(calls()).toEqual([]);
  });
});
