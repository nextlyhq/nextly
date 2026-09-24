/**
 * Which commits a run compares, for each event, and what it decides from the
 * files between them. Each case builds a small repository, so a range is judged
 * against real history rather than against a stub of git.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { changedFiles, decide, diffRange, filesThatRun, main, summary } from "./change-scope.mjs";
import { readGit } from "./workflow-context.mjs";

const SCRIPT = fileURLToPath(new URL("./change-scope.mjs", import.meta.url));
const INERT = /^(docs\/|[^/]*\.md$)/;
let repo;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "change-scope-"));
  run("init", "-q", "-b", "main");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function run(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** Git as the script calls it, pointed at the test repository. */
const inRepo = args => readGit(args, { cwd: repo });

function commit(files, message = "change") {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  run("add", "-A");
  run("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
  return run("rev-parse", "HEAD");
}

describe("the range each event tests", () => {
  it("compares a pull request from its merge base, and the queue exactly as given", () => {
    const pull = { pull_request: { base: { sha: "b1" }, head: { sha: "h1" } } };
    expect(diffRange({ event: "pull_request", payload: pull })).toEqual({ base: "b1", head: "h1", mergeBase: true });
    const queue = { merge_group: { base_sha: "b2", head_sha: "h2" } };
    expect(diffRange({ event: "merge_group", payload: queue })).toEqual({ base: "b2", head: "h2", mergeBase: false });
  });

  it("compares a push with the last commit the workflow tested", () => {
    expect(diffRange({ event: "push", lastTestedSha: "t", sha: "s" })).toEqual({ base: "t", head: "s", mergeBase: false });
  });

  it("has no rule for any other event, including a name every object carries", () => {
    for (const event of ["schedule", "workflow_dispatch", "constructor", "toString", undefined]) {
      expect(diffRange({ event, payload: {} })).toEqual({ reason: `no rule for a ${event ?? "missing"} event` });
    }
  });
});

describe("the files a range changed", () => {
  it("lists exactly what the merge queue's head adds to its base", () => {
    const base = commit({ "a.ts": "a" });
    const head = commit({ "packages/x.ts": "x", "docs/page.md": "p" });
    expect(changedFiles({ base, head, mergeBase: false }, inRepo)).toEqual({ base, head, files: ["docs/page.md", "packages/x.ts"] });
  });

  it("leaves out what the base branch gained after a pull request branched", () => {
    commit({ "a.ts": "a" });
    run("checkout", "-q", "-b", "feature");
    const head = commit({ "mine.ts": "mine" });
    run("checkout", "-q", "main");
    const base = commit({ "theirs.ts": "theirs" });
    expect(changedFiles({ base, head, mergeBase: true }, inRepo).files).toEqual(["mine.ts"]);
    // The control: from the base branch's tip, their file reads as the branch's own.
    expect(changedFiles({ base, head, mergeBase: false }, inRepo).files).toEqual(["mine.ts", "theirs.ts"]);
  });

  it("lists a path git would quote exactly as it is spelled", () => {
    const base = commit({ "a.ts": "a" });
    const head = commit({ "docs/a page.md": "p", "docs/café.md": "c" });
    expect(changedFiles({ base, head, mergeBase: false }, inRepo).files).toEqual(["docs/a page.md", "docs/café.md"]);
  });

  it("gives a reason, never a list, when the comparison cannot be made", () => {
    const base = commit({ "a.ts": "a" });
    expect(changedFiles({ base: undefined, head: base, mergeBase: false }, inRepo)).toEqual({ reason: "no base or no head commit for this event" });
    const absent = "0".repeat(40);
    expect(changedFiles({ base: absent, head: base, mergeBase: false }, inRepo)).toEqual({ reason: `base ${absent} is not present` });
    expect(changedFiles({ base, head: base, mergeBase: false }, inRepo)).toEqual({ reason: "the diff listed no files" });
  });
});

describe("deciding whether the jobs run", () => {
  const queued = (base, head) => ({ event: "merge_group", payload: { merge_group: { base_sha: base, head_sha: head } } });

  it("skips a run whose every changed file is inert, and runs one with any other", () => {
    const base = commit({ "a.ts": "a" });
    const docs = commit({ "docs/page.md": "p", "README.md": "r" });
    expect(decide({ ...queued(base, docs), inert: INERT }, inRepo)).toMatchObject({ inert: true, files: ["README.md", "docs/page.md"] });
    const code = commit({ "packages/x.ts": "x" });
    expect(decide({ ...queued(base, code), inert: INERT }, inRepo)).toMatchObject({ inert: false, running: ["packages/x.ts"] });
  });

  it("runs for a path it always runs for, though the pattern calls it inert", () => {
    const base = commit({ "a.ts": "a" });
    const head = commit({ "AGENTS.md": "rules" });
    expect(decide({ ...queued(base, head), inert: INERT }, inRepo).inert).toBe(true);
    expect(decide({ ...queued(base, head), inert: INERT, alwaysRun: /^AGENTS\.md$/ }, inRepo).inert).toBe(false);
  });

  it("runs everything for an event it has no rule for", () => {
    expect(decide({ event: "schedule", payload: {}, inert: INERT }, inRepo)).toEqual({ inert: false, reason: "no rule for a schedule event" });
  });

  it("skips a superseded run without comparing anything", () => {
    const refuse = () => {
      throw new Error("a superseded run must not read history");
    };
    expect(decide({ event: "push", superseded: "true", inert: INERT }, refuse)).toEqual({ inert: true, superseded: true });
  });

  it("keeps only the files that require the run", () => {
    expect(filesThatRun(["docs/a.md", "x.ts", "AGENTS.md"], { inert: INERT, alwaysRun: /^AGENTS\.md$/ })).toEqual(["x.ts", "AGENTS.md"]);
  });
});

describe("the evidence it writes", () => {
  it("names every inert file, and at most twenty of the files that require a run", () => {
    const inert = summary({ inert: true, base: "b", head: "h", files: ["docs/a.md"], running: [] }, "CI scope");
    expect(inert).toContain("- `docs/a.md`");
    const many = Array.from({ length: 25 }, (_, n) => `f${n}.ts`);
    const full = summary({ inert: false, base: "b", head: "h", files: many, running: many }, "CI scope");
    expect(full).toContain("- `f19.ts`");
    expect(full).not.toContain("- `f20.ts`");
    expect(full).toContain("- …and 5 more");
  });
});

describe("the command", () => {
  function event(payload) {
    const file = join(repo, "event.json");
    writeFileSync(file, JSON.stringify(payload));
    return file;
  }

  it("writes its decision for a merge-queue run as a workflow reads it", () => {
    const base = commit({ "a.ts": "a" });
    const head = commit({ "docs/page.md": "p" });
    const output = join(repo, "output");
    const env = {
      ...process.env,
      GITHUB_EVENT_NAME: "merge_group",
      GITHUB_EVENT_PATH: event({ merge_group: { base_sha: base, head_sha: head } }),
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: join(repo, "summary"),
      INERT_PATHS: "^docs/",
    };
    const done = spawnSync(process.execPath, [SCRIPT], { cwd: repo, env, encoding: "utf8" });
    expect(done.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("inert=true\n");
    expect(readFileSync(join(repo, "summary"), "utf8")).toContain("- `docs/page.md`");
  });

  it("refuses to decide without the paths it may skip for", () => {
    expect(main({ GITHUB_EVENT_NAME: "push" })).toBe(64);
  });
});
