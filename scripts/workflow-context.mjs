/**
 * What a workflow step's script reads about the run it is in: the event that
 * started it, and git, asked a question whose failure is an answer.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Text inside a workflow command, where `%`, CR and LF would otherwise be read as syntax. */
export function commandText(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** The event's payload, or an empty one when the script is run by hand. */
export function eventPayload(env = process.env) {
  return env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
}

/**
 * Git's output, or `ok: false` when git refused: an absent commit, or a range
 * it cannot read. A refusal is for the caller to decide about, not a crash.
 */
export function readGit(args, { cwd, maxBuffer } = {}) {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "ignore"] }) };
  } catch {
    return { ok: false, out: "" };
  }
}

/**
 * The subjects of the commits the merge queue would put on `main`, oldest
 * first, following `main`'s own line: the first parent at each step, so a
 * commit reachable only through a merge's second parent is not one that lands
 * there. The queue lands the commits it tested, so under squash merging each is
 * one queued pull request's commit, its subject the title and `(#number)`.
 *
 * @returns {{ subjects: string[] } | { problem: string }}
 */
export function queuedCommitSubjects(payload, git = readGit) {
  const range = payload?.merge_group ?? {};
  return bothEnds(range) ? subjectsBetween(range.base_sha, range.head_sha, git) : { problem: "The merge-queue event names no base or no head commit." };
}

function bothEnds({ base_sha: base, head_sha: head }) {
  return Boolean(base && head);
}

function subjectsBetween(base, head, git) {
  const log = git(["log", "--first-parent", "--reverse", "--format=%s%x00", `${base}..${head}`]);
  if (!log.ok) return { problem: `Could not read the commits between the queue's base ${base} and its head ${head}.` };
  const subjects = log.out.split("\0").map(subject => subject.trim()).filter(Boolean);
  return subjects.length > 0 ? { subjects } : { problem: "The merge queue's head adds no commits to its base." };
}
