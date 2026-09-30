/**
 * The collector of what became of the review bot's findings, read against a
 * stand-in for GitHub: which comments count as findings, how readers rated
 * them net of the bot's own seeded pair, whether their threads were resolved,
 * and whether their lines changed before the merge.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BOT, changedRanges, collectPull, findingTag, ratings, summarize, table } from "./review-bot-collect.mjs";

const REPO = "o/r";
const REVIEWED = "a".repeat(40);
const MERGE = "m".repeat(40);
const HEAD = "h".repeat(40);
const tag = (n, severity, lens) => `\n\n<!-- nrb v1 id:2.${n} sev:${severity} lens:${lens} -->\n\n<!-- nextly-review-bot run:9 -->`;

describe("a finding's tag", () => {
  it("reads its round, number, severity and lens", () => {
    expect(findingTag(`**[P1] Fix it**${tag(3, "P1", "L3")}`)).toEqual({ round: 2, n: 3, severity: "P1", lens: "L3" });
    expect(findingTag("x <!-- nrb v1 id:1.1 sev:P2 lens:A12 -->").lens).toBe("A12");
  });

  it("is absent from a comment the protocol did not tag", () => {
    for (const body of ["**[P1] an older finding**", "", null, "<!-- nrb v1 id:1.1 sev:P9 lens:L3 -->"]) expect(findingTag(body), JSON.stringify(body)).toBeNull();
  });
});

describe("readers' ratings", () => {
  it("leave out the pair the bot seeded, so an unrated finding reads as unrated", () => {
    const seeded = [
      { user: { login: BOT }, content: "+1" },
      { user: { login: BOT }, content: "-1" },
    ];
    expect(ratings(seeded)).toEqual({ up: 0, down: 0 });
    expect(ratings([...seeded, { user: { login: "a" }, content: "+1" }, { user: { login: "b" }, content: "+1" }, { user: { login: "c" }, content: "-1" }, { user: { login: "d" }, content: "heart" }])).toEqual({ up: 2, down: 1 });
  });
});

describe("the lines a later commit changed", () => {
  it("are each hunk's old-side lines, and the line an addition follows", () => {
    expect(changedRanges("@@ -3,4 +3,5 @@\n x\n@@ -20 +21 @@\n y\n@@ -30,0 +32,2 @@\n+z")).toEqual([
      [3, 6],
      [20, 20],
      [30, 30],
    ]);
    expect(changedRanges(undefined)).toEqual([]);
  });
});

describe("one pull request's findings", () => {
  /**
   * A stand-in for `gh api`: each path it is asked for, and what GitHub would
   * answer, or a function of the request that gives the answer.
   */
  function github(answers) {
    const asked = [];
    const fetch = request => {
      // A GraphQL read comes as its query and variables.
      const path = typeof request === "object" ? "graphql" : request;
      asked.push(path);
      const key = Object.keys(answers).find(prefix => path.startsWith(prefix));
      if (key === undefined) throw new Error(`unexpected read: ${path}`);
      return typeof answers[key] === "function" ? answers[key](request) : answers[key];
    };
    return { fetch, asked };
  }

  const inline = { id: 1, user: { login: BOT }, path: "src/a.ts", original_line: 5, original_commit_id: REVIEWED, body: `**[P1] Guard it**${tag(1, "P1", "L3")}` };
  const fileLevel = { id: 2, user: { login: BOT }, path: "docs/b.md", original_commit_id: REVIEWED, body: `**[P2] Date it**${tag(2, "P2", "A3")}` };
  const answers = {
    [`repos/${REPO}/pulls/7/comments`]: [
      inline,
      fileLevel,
      // A reply of the bot's is an answer, not a finding, even tagged.
      { id: 3, user: { login: BOT }, in_reply_to_id: 1, path: "src/a.ts", body: `still open${tag(9, "P1", "L3")}` },
      // Neither is a finding: one the protocol did not tag, and another reviewer's.
      { id: 4, user: { login: BOT }, path: "src/a.ts", body: "**[P2] an older finding**" },
      { id: 5, user: { login: "chatgpt-codex-connector[bot]" }, path: "src/a.ts", body: `**[P1] Codex's**${tag(1, "P1", "L3")}` },
    ],
    [`repos/${REPO}/pulls/7`]: { merged_at: "2026-09-30T10:00:00Z", merge_commit_sha: MERGE, head: { sha: HEAD } },
    [`repos/${REPO}/pulls/comments/1/reactions`]: [{ user: { login: BOT }, content: "+1" }, { user: { login: BOT }, content: "-1" }, { user: { login: "a" }, content: "+1" }],
    [`repos/${REPO}/pulls/comments/2/reactions`]: [{ user: { login: BOT }, content: "+1" }, { user: { login: BOT }, content: "-1" }],
    [`repos/${REPO}/compare/${REVIEWED}...${HEAD}`]: { files: [{ filename: "src/a.ts", patch: "@@ -4,3 +4,4 @@\n a\n-b\n+c\n+d" }] },
    graphql: { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ isResolved: true, comments: { nodes: [{ databaseId: 1 }] } }, { isResolved: false, comments: { nodes: [{ databaseId: 2 }] } }] } } } } },
  };

  it("are the bot's own tagged findings, with their ratings, resolution and whether their lines changed", () => {
    const { fetch } = github(answers);
    expect(collectPull(fetch, REPO, 7)).toEqual([
      { pull: 7, round: 2, n: 1, severity: "P1", lens: "L3", path: "src/a.ts", ratings: { up: 1, down: 0 }, resolved: true, changed: true },
      { pull: 7, round: 2, n: 2, severity: "P2", lens: "A3", path: "docs/b.md", ratings: { up: 0, down: 0 }, resolved: false, changed: false },
    ]);
  });

  /** The findings when the compare from the reviewed commit to the last head lists `files`. */
  const withCompare = files => collectPull(github({ ...answers, [`repos/${REPO}/compare/${REVIEWED}...${HEAD}`]: { files } }).fetch, REPO, 7);

  it("counts a finding unchanged when the commits after it touched other lines of its file", () => {
    expect(withCompare([{ filename: "src/a.ts", patch: "@@ -40,2 +40,3 @@\n a" }])[0].changed).toBe(false);
  });

  it("compares to the last head, not to a squash merge's commit, which would count the lines the pull request added before the review", () => {
    // From the reviewed commit, a squash merge's compare runs from where the branch left main.
    const squash = { files: [{ filename: "src/a.ts", patch: "@@ -1,50 +1,60 @@\n a" }] };
    const { fetch } = github({ ...answers, [`repos/${REPO}/compare/${REVIEWED}...${MERGE}`]: squash, [`repos/${REPO}/compare/${REVIEWED}...${HEAD}`]: { files: [] } });
    expect(collectPull(fetch, REPO, 7).map(finding => finding.changed)).toEqual([false, false]);
  });

  it("follows a file the commits after the finding renamed", () => {
    expect(withCompare([{ filename: "src/moved.ts", previous_filename: "src/a.ts", patch: "@@ -5 +5 @@\n-x\n+y" }])[0].changed).toBe(true);
  });

  it("cannot tell, rather than counting unchanged, when the compare lists its most files and not the finding's", () => {
    const others = Array.from({ length: 300 }, (_, i) => ({ filename: `other/${i}.ts`, patch: "@@ -1 +1 @@" }));
    expect(withCompare(others).map(finding => finding.changed)).toEqual([null, null]);
    // The control: a shorter list is the whole of it, so a file not in it did not change.
    expect(withCompare(others.slice(1)).map(finding => finding.changed)).toEqual([false, false]);
  });

  it("cannot tell a finding's lines when GitHub left out its file's patch, and still counts a file-level finding changed", () => {
    expect(withCompare([{ filename: "src/a.ts" }, { filename: "docs/b.md" }]).map(finding => finding.changed)).toEqual([null, true]);
  });

  it("reads every page of the threads before saying which were resolved", () => {
    const afters = [];
    const pages = request => {
      afters.push(request.variables.after);
      const page = request.variables.after === null ? { hasNextPage: true, endCursor: "c1", id: 1, isResolved: false } : { hasNextPage: false, endCursor: "c2", id: 2, isResolved: true };
      const { hasNextPage, endCursor, id, isResolved } = page;
      return { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage, endCursor }, nodes: [{ isResolved, comments: { nodes: [{ databaseId: id }] } }] } } } } };
    };
    const { fetch } = github({ ...answers, graphql: pages });
    expect(collectPull(fetch, REPO, 7).map(finding => finding.resolved)).toEqual([false, true]);
    expect(afters).toEqual([null, "c1"]);
  });

  it("only reads", () => {
    const { fetch, asked } = github(answers);
    collectPull(fetch, REPO, 7);
    // The control: it did read.
    expect(asked.length).toBeGreaterThan(0);
    for (const path of asked) expect(path, path).not.toMatch(/--method|-X /);
  });
});

describe("the summary", () => {
  const finding = (severity, lens, up, down, resolved, changed) => ({ severity, lens, ratings: { up, down }, resolved, changed });

  it("sums the findings by one field", () => {
    const findings = [finding("P1", "L3", 2, 0, true, true), finding("P1", "L1", 0, 1, false, true), finding("P2", "L3", 0, 0, true, false), finding("P2", "L3", 0, 0, false, null)];
    expect(summarize(findings, "severity")).toEqual([
      { severity: "P1", findings: 2, up: 2, down: 1, resolved: 1, changed: 2, unknown: 0 },
      { severity: "P2", findings: 2, up: 0, down: 0, resolved: 1, changed: 0, unknown: 1 },
    ]);
    expect(table(summarize(findings, "lens"), "lens").split("\n")).toEqual([
      "| lens | findings | 👍 | 👎 | resolved | lines changed | could not tell |",
      "|---|---|---|---|---|---|---|",
      "| L1 | 1 | 0 | 1 | 0 | 1 | 0 |",
      "| L3 | 3 | 2 | 0 | 2 | 1 | 1 |",
    ]);
  });
});

describe("the command", () => {
  const COLLECT = fileURLToPath(new URL("./review-bot-collect.mjs", import.meta.url));
  /**
   * A stand-in for `gh api`, answering from the files in `$FAKE`. A list comes
   * as `gh --paginate --jq '.[]'` prints it: each item of each page, compact,
   * one to a line.
   */
  const FAKE_GH = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const read = name => JSON.parse(readFileSync(join(process.env.FAKE, name), "utf8"));
if (args[0] !== "api") process.exit(2);
if (args[1] === "graphql") process.stdout.write(JSON.stringify(read("threads.json")));
else if (args[1] === "--paginate") {
  if (args[3] !== "--jq" || args[4] !== ".[]") process.exit(3);
  const pages = read(args[2].includes("/reactions") ? "reactions.json" : "comments.json");
  for (const page of pages) for (const item of page) process.stdout.write(JSON.stringify(item) + "\\n");
} else process.stdout.write(JSON.stringify(read(args[1].includes("/compare/") ? "compare.json" : "pull.json")));
`;
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "review-bot-collect-"));
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "gh"), FAKE_GH);
    chmodSync(join(dir, "bin", "gh"), 0o755);
    const files = {
      // Brackets that once split a page inside a string: `][` in code and `] [` in prose.
      "comments.json": [
        [{ id: 1, user: { login: BOT }, path: "src/a.ts", original_line: 5, original_commit_id: REVIEWED, body: `**[P2] Index it as \`m[i][j]\`**${tag(1, "P2", "L5")}` }],
        [{ id: 2, user: { login: "someone" }, path: "src/a.ts", body: "see [this] [ref]" }],
      ],
      "reactions.json": [[{ user: { login: BOT }, content: "+1" }], [{ user: { login: "a" }, content: "+1" }]],
      "pull.json": { head: { sha: HEAD } },
      "compare.json": { files: [] },
      "threads.json": { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } },
    };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(content));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (...args) => spawnSync(process.execPath, [COLLECT, ...args], { encoding: "utf8", env: { ...process.env, PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}`, FAKE: dir } });

  it("reads every page of a list gh prints, whatever brackets a comment quotes", () => {
    const { status, stdout, stderr } = run("o/r", "--pr", "7", "--json");
    expect(status, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual([{ pull: 7, round: 2, n: 1, severity: "P2", lens: "L5", path: "src/a.ts", ratings: { up: 1, down: 0 }, resolved: false, changed: false }]);
  });

  it("prints the summaries by severity and by lens", () => {
    const { status, stdout } = run("o/r", "--pr", "7");
    expect(status).toBe(0);
    expect(stdout.split("\n")[0]).toBe("1 tagged findings");
    expect(stdout).toContain("| P2 | 1 | 1 | 0 | 0 | 0 | 0 |");
    expect(stdout).toContain("| L5 | 1 | 1 | 0 | 0 | 0 | 0 |");
  });

  it("refuses a call that names no pull request", () => {
    const { status, stderr } = run("o/r");
    expect(status).toBe(2);
    expect(stderr).toContain("usage:");
  });
});
