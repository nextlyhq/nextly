/**
 * The two readings a workflow step's script makes about its run: the event's
 * payload, and git, whose refusal comes back as an answer rather than a throw.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eventPayload, readGit } from "./workflow-context.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflow-context-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the event's payload", () => {
  it("is read from the file the runner names", () => {
    const file = join(dir, "event.json");
    writeFileSync(file, JSON.stringify({ merge_group: { head_sha: "h" } }));
    expect(eventPayload({ GITHUB_EVENT_PATH: file })).toEqual({ merge_group: { head_sha: "h" } });
  });

  it("is empty when no runner named one", () => {
    expect(eventPayload({})).toEqual({});
  });
});

describe("git, asked a question", () => {
  it("answers with its output, in the directory it is pointed at", () => {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    expect(readGit(["rev-parse", "--is-inside-work-tree"], { cwd: dir })).toEqual({ ok: true, out: "true\n" });
    // The control: outside a repository the same question is refused.
    expect(readGit(["rev-parse", "--is-inside-work-tree"], { cwd: tmpdir() }).ok).toBe(false);
  });

  it("answers a refusal with ok: false instead of throwing", () => {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    expect(readGit(["cat-file", "-e", `${"0".repeat(40)}^{commit}`], { cwd: dir })).toEqual({ ok: false, out: "" });
  });
});
