/**
 * The review bot's gateway to the local history, run against a real clone.
 *
 * The agent reads history through these subcommands instead of a `git`
 * prefix, because `git diff`, `git show` and `git log` take `--output=<file>`
 * and so write wherever the runner can. What separates the gateway from that
 * prefix is that no argument the agent passes can become a flag: each is
 * validated, then joined to a revision or a line range. So each refusal below
 * is asserted with the file it would have written, and the first test is the
 * control that shows this fixture sees such a write when one happens.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
