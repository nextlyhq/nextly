/**
 * The title rules, judged with the rules the workflow actually passes, and
 * where the titles come from on each event: a pull request's own event, or, in
 * the merge queue, the commits the queue would land, read from a real
 * repository's history.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main, rulesFrom, titleProblem, titlesFor, titlesProblem } from "./pr-title.mjs";
import { readGit } from "./workflow-context.mjs";

/** The inputs `.github/workflows/pr-title.yml` hands the action, as the action hands them on. */
function workflowEnv() {
  const workflow = load(readFileSync(new URL("../.github/workflows/pr-title.yml", import.meta.url), "utf8"));
  const inputs = workflow.jobs.lint.steps.find(step => step.id === "lint_pr_title").with;
  return {
    TYPES: inputs.types,
    SCOPES: inputs.scopes,
    REQUIRE_SCOPE: String(inputs.requireScope),
    SUBJECT_PATTERN: inputs.subjectPattern,
    SUBJECT_PATTERN_ERROR: inputs.subjectPatternError,
  };
}

const rules = rulesFrom(workflowEnv());

describe("the title rules the workflow sets", () => {
  it("accepts the examples its own failure comment gives, and the other shapes the grammar allows", () => {
    for (const title of [
      "feat(admin): add role manager dialog",
      "fix(adapter-postgres): handle connection pool exhaustion",
      "chore(deps): bump zod to 4.2.0",
      "ci: run the checks in the merge queue",
      "chore(root, ci): two scopes at once",
      "feat(nextly)!: remove the deprecated option",
    ]) {
      expect(titleProblem(title, rules), title).toBeNull();
    }
  });

  it("refuses a title with no type, no subject, or a type it does not know", () => {
    expect(titleProblem("add a dialog", rules)).toMatch(/^No release type found in pull request title "add a dialog"/);
    expect(titleProblem("feat: ", rules)).toBe('No subject found in pull request title "feat: ".');
    expect(titleProblem("feature(admin): add it", rules)).toMatch(/^Unknown release type "feature"/);
    // Types are exact: the capitalised spelling is a different, unknown type.
    expect(titleProblem("Feat: add it", rules)).toMatch(/^Unknown release type "Feat"/);
  });

  it("names every scope it does not know, one or several", () => {
    expect(titleProblem("feat(nope): add it", rules)).toMatch(/^Unknown scope "nope" found/);
    expect(titleProblem("feat(admin, nope, zilch): add it", rules)).toMatch(/^Unknown scopes "nope,zilch" found/);
  });

  it("refuses an uppercase subject with the workflow's own message", () => {
    expect(titleProblem("feat(admin): Add a dialog", rules)).toBe(
      'The subject "Add a dialog" starts with an uppercase character. Rewrite it lowercase to match Conventional Commits.'
    );
  });

  it("refuses a title marked [WIP], which would otherwise reach main as a commit message", () => {
    expect(titleProblem("[WIP] feat(admin): add it", rules)).toMatch(/is marked \[WIP\]/);
  });

  it("holds the whole subject to the pattern, not only a part of it, and can require a scope", () => {
    const partial = { ...rules, subjectPattern: /[a-z]+/, subjectPatternError: "" };
    expect(titleProblem("fix: abc DEF", partial)).toBe(`The subject "abc DEF" found in pull request title "fix: abc DEF" doesn't match the configured pattern "[a-z]+".`);
    expect(titleProblem("fix: abc", partial)).toBeNull();
    expect(titleProblem("fix: add it", { ...rules, requireScope: true })).toMatch(/^No scope found/);
  });
});

describe("where the titles come from", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "pr-title-queue-"));
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

  function commit(message) {
    run("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", message);
    return run("rev-parse", "HEAD");
  }

  const queued = (base, head) => ({ event: "merge_group", payload: { merge_group: { base_sha: base, head_sha: head } } });

  it("is the event itself on a pull request", () => {
    expect(titlesFor({ event: "pull_request_target", payload: { pull_request: { title: "fix: x" } } })).toEqual({ titles: ["fix: x"] });
    expect(titlesFor({ event: "pull_request", payload: {} })).toEqual({ problem: "The event carries no pull request title." });
  });

  it("is every commit the merge queue would land, for each member of a group", () => {
    const base = commit("chore: the base");
    commit("feat(admin): add a dialog (#1)");
    const head = commit("fix(nextly): handle a timeout (#2)");
    expect(titlesFor(queued(base, head), inRepo)).toEqual({ titles: ["feat(admin): add a dialog (#1)", "fix(nextly): handle a timeout (#2)"] });
  });

  it("refuses a group whose earlier member would land with a bad message, and a merge commit's", () => {
    const base = commit("chore: the base");
    commit("Add a dialog (#1)");
    commit("Merge pull request #3 from someone/branch");
    const head = commit("fix(nextly): handle a timeout (#2)");
    const { titles } = titlesFor(queued(base, head), inRepo);
    const problem = titlesProblem(titles, rules);
    expect(problem).toMatch(/No release type found in pull request title "Add a dialog \(#1\)"/);
    expect(problem).toMatch(/"Merge pull request #3 from someone\/branch"/);
    expect(problem).not.toMatch(/handle a timeout/);
  });

  it("is a problem, never a pass, when the queued commits cannot be read", () => {
    const base = commit("chore: the base");
    expect(titlesFor({ event: "merge_group", payload: { merge_group: { head_sha: base } } }, inRepo)).toEqual({ problem: "The merge-queue event names no base or no head commit." });
    const absent = "0".repeat(40);
    expect(titlesFor(queued(absent, base), inRepo).problem).toMatch(/^Could not read the commits between the queue's base/);
    expect(titlesFor(queued(base, base), inRepo)).toEqual({ problem: "The merge queue's head adds no commits to its base." });
  });

  it("is a problem on any event that has no title, rather than a pass", () => {
    for (const event of ["push", "schedule", "constructor", undefined]) {
      expect(titlesFor({ event, payload: {} }).problem, String(event)).toMatch(/^There is no pull request title to check on a/);
    }
  });
});

describe("the command", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pr-title-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function env(title) {
    const event = join(dir, "event.json");
    writeFileSync(event, JSON.stringify({ pull_request: { title } }));
    return { ...workflowEnv(), GITHUB_EVENT_NAME: "pull_request_target", GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: join(dir, "output") };
  }

  it("fails a refused title and hands the reason to the comment job", () => {
    expect(main(env("feat(admin): Add a dialog"))).toBe(1);
    const output = readFileSync(join(dir, "output"), "utf8");
    expect(output).toMatch(/^error_message<<(EOF_[0-9a-f-]+)\nThe subject "Add a dialog" starts with an uppercase character\. Rewrite it lowercase to match Conventional Commits\.\n\1\n$/);
  });

  it("passes a good title and leaves the reason empty", () => {
    expect(main(env("feat(admin): add a dialog"))).toBe(0);
    expect(() => readFileSync(join(dir, "output"), "utf8")).toThrow(/ENOENT/);
  });
});
