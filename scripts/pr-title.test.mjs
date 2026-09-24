/**
 * The title rules, judged with the rules the workflow actually passes, and
 * where the title comes from on each event: a pull request's own event, or,
 * in the merge queue, the queued pull request, read back from
 * GitHub so an edit made after it was queued is the title judged.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main, queuedPullNumber, rulesFrom, titleFor, titleProblem } from "./pr-title.mjs";

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
const SHA = "a".repeat(40);

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

describe("the pull request a merge-queue run is testing", () => {
  it("is read from the branch the queue made for it, whatever the base branch is called", () => {
    expect(queuedPullNumber(`refs/heads/gh-readonly-queue/main/pr-1903-${SHA}`)).toBe(1903);
    expect(queuedPullNumber(`refs/heads/gh-readonly-queue/release/1.x/pr-7-${SHA}`)).toBe(7);
  });

  it("is no number at all for a branch that only resembles one", () => {
    for (const ref of ["refs/heads/main", "refs/heads/gh-readonly-queue/main/pr-12", `refs/heads/feature/pr-12-${SHA}`, undefined]) {
      expect(queuedPullNumber(ref), String(ref)).toBeNull();
    }
  });
});

describe("where the title comes from", () => {
  const queued = { merge_group: { head_ref: `refs/heads/gh-readonly-queue/main/pr-1903-${SHA}` } };

  it("is the event itself on a pull request", async () => {
    expect(await titleFor({ event: "pull_request_target", payload: { pull_request: { title: "fix: x" } } })).toEqual({ title: "fix: x" });
    expect(await titleFor({ event: "pull_request", payload: {} })).toEqual({ problem: "The event carries no pull request title." });
  });

  it("is read back from the queued pull request in the merge queue, with the token", async () => {
    const calls = [];
    const fetchImpl = async (url, { headers }) => {
      calls.push({ url, authorization: headers.authorization });
      return { ok: true, json: async () => ({ title: "fix: the title as it is now" }) };
    };
    expect(await titleFor({ event: "merge_group", payload: queued, repository: "o/r", token: "t" }, fetchImpl)).toEqual({ title: "fix: the title as it is now" });
    expect(calls).toEqual([{ url: "https://api.github.com/repos/o/r/pulls/1903", authorization: "Bearer t" }]);
  });

  it("is a problem, never a pass, when the queued pull request cannot be read or named", async () => {
    const refused = async () => ({ ok: false, status: 404 });
    expect(await titleFor({ event: "merge_group", payload: queued, repository: "o/r" }, refused)).toEqual({ problem: "Could not read pull request #1903: HTTP 404." });
    const offline = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    expect((await titleFor({ event: "merge_group", payload: queued, repository: "o/r" }, offline)).problem).toMatch(/^Could not read pull request #1903/);
    const unnamed = { merge_group: { head_ref: "refs/heads/main" } };
    expect((await titleFor({ event: "merge_group", payload: unnamed }, refused)).problem).toMatch(/^Cannot tell which pull request/);
  });

  it("is a problem on any event that has no title, rather than a pass", async () => {
    for (const event of ["push", "schedule", "constructor", undefined]) {
      expect((await titleFor({ event, payload: {} })).problem, String(event)).toMatch(/^There is no pull request title to check on a/);
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

  it("fails a refused title and hands the reason to the comment job", async () => {
    expect(await main(env("feat(admin): Add a dialog"))).toBe(1);
    const output = readFileSync(join(dir, "output"), "utf8");
    expect(output).toMatch(/^error_message<<(EOF_[0-9a-f-]+)\nThe subject "Add a dialog" starts with an uppercase character\. Rewrite it lowercase to match Conventional Commits\.\n\1\n$/);
  });

  it("passes a good title and leaves the reason empty", async () => {
    expect(await main(env("feat(admin): add a dialog"))).toBe(0);
    expect(() => readFileSync(join(dir, "output"), "utf8")).toThrow(/ENOENT/);
  });
});
