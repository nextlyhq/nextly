/**
 * The secret scan's range, for every event it runs on: the step's own script,
 * read from the workflow, run over a real repository with a stand-in scanner
 * that records what it was asked to scan.
 *
 * gitleaks passes a range that holds no commits, and a step that picked no
 * range would pass having scanned nothing, so the refusals matter as much as
 * the ranges: each one fails the step, names its reason, and scans nothing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { load } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WORKFLOW = load(readFileSync(new URL("../.github/workflows/secret-scan.yml", import.meta.url), "utf8"));
const STEP = WORKFLOW.jobs.gitleaks.steps.find(step => step.name === "Run gitleaks on the commits this run adds");
const ZERO = "0".repeat(40);
const UNKNOWN = "f".repeat(40);

describe("the secret scan's inputs", () => {
  it("takes each value from the event field it names", () => {
    expect(STEP.env).toEqual({
      EVENT: "${{ github.event_name }}",
      BASE_REF: "${{ github.base_ref }}",
      PUSH_BEFORE: "${{ github.event.before }}",
      PUSH_AFTER: "${{ github.event.after }}",
      QUEUE_BASE: "${{ github.event.merge_group.base_sha }}",
      QUEUE_HEAD: "${{ github.event.merge_group.head_sha }}",
    });
  });

  it("reads them from the environment, never spliced into the script's text", () => {
    expect(STEP.run).not.toContain("${{");
  });
});

describe.runIf(process.platform !== "win32")("the range the secret scan reads", () => {
  let dir;
  let repo;
  let base;
  let head;

  // A variable git reads from the environment, such as GIT_DIR inside a hook,
  // would point these commands at another repository.
  const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "secret-scan-"));
    repo = join(dir, "repo");
    mkdirSync(join(dir, "bin"));
    // The stand-in records its arguments and exits as told, so a test can ask
    // both what was scanned and what a finding does to the step.
    writeFileSync(join(dir, "bin", "gitleaks"), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$SCANNED"\nexit "${SCANNER_EXIT:-0}"\n');
    chmodSync(join(dir, "bin", "gitleaks"), 0o755);
    const git = (...args) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8", env: cleanEnv() }).trim();
    execFileSync("git", ["init", "-q", "-b", "main", repo], { env: cleanEnv() });
    const shas = ["the base", "one change", "another change"].map(message => {
      git("commit", "-q", "--allow-empty", "-m", message);
      return git("rev-parse", "HEAD");
    });
    [base, , head] = shas;
    git("update-ref", "refs/remotes/origin/main", base);
    writeFileSync(join(dir, "step.sh"), STEP.run);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs the step as GitHub's default bash shell does, with only the event's values set. */
  function scan(event, { scannerExit = 0 } = {}) {
    const scanned = join(dir, "scanned");
    rmSync(scanned, { force: true });
    const env = { PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}`, HOME: dir, SCANNED: scanned, SCANNER_EXIT: String(scannerExit), ...event };
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")], { cwd: repo, encoding: "utf8", env });
    return { status: result.status, output: result.stdout + result.stderr, scans: existsSync(scanned) ? readFileSync(scanned, "utf8").trim().split("\n") : [] };
  }

  function expectScanOf(result, range) {
    expect(result.status, result.output).toBe(0);
    expect(result.scans).toHaveLength(1);
    expect(result.scans[0].split(" ")).toEqual(expect.arrayContaining(["detect", `--log-opts=${range}`, "--redact"]));
  }

  it("scans a pull request's own commits, from the base branch it targets", () => {
    expectScanOf(scan({ EVENT: "pull_request", BASE_REF: "main" }), "origin/main..HEAD");
  });

  it("scans a push's range, and the head commit alone on a branch's first push", () => {
    expectScanOf(scan({ EVENT: "push", PUSH_BEFORE: base, PUSH_AFTER: head }), `${base}..${head}`);
    expectScanOf(scan({ EVENT: "push", PUSH_BEFORE: ZERO, PUSH_AFTER: head }), `${head}~1..${head}`);
  });

  it("scans everything the queue would merge, from its base to its head", () => {
    // A group's head holds every member's commits. A range from the head's
    // parent would scan the last member only and pass the others unread.
    expectScanOf(scan({ EVENT: "merge_group", QUEUE_BASE: base, QUEUE_HEAD: head }), `${base}..${head}`);
  });

  it("fails when the scanner reports a finding", () => {
    const result = scan({ EVENT: "merge_group", QUEUE_BASE: base, QUEUE_HEAD: head }, { scannerExit: 1 });
    expect(result.status).toBe(1);
    expect(result.scans).toHaveLength(1);
  });

  it("refuses, scanning nothing, whenever it has no range to scan", () => {
    const refusals = [
      [{ EVENT: "schedule" }, "no range to scan for a schedule event"],
      [{}, "no range to scan for a unnamed event"],
      [{ EVENT: "pull_request" }, "a pull_request event with no base branch"],
      [{ EVENT: "push", PUSH_BEFORE: base }, "a push event with no head commit"],
      [{ EVENT: "merge_group", QUEUE_BASE: base }, "a merge_group event with no base or no head commit"],
      [{ EVENT: "merge_group", QUEUE_BASE: head, QUEUE_HEAD: head }, `the range ${head}..${head} holds no commits`],
      [{ EVENT: "merge_group", QUEUE_BASE: UNKNOWN, QUEUE_HEAD: head }, `cannot read the range ${UNKNOWN}..${head}`],
    ];
    for (const [event, reason] of refusals) {
      const result = scan(event);
      expect(result.status, JSON.stringify(event)).toBe(1);
      expect(result.output, JSON.stringify(event)).toContain(`::error title=Secret scan::${reason}`);
      expect(result.scans, JSON.stringify(event)).toEqual([]);
    }
  });
});
