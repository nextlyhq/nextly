/**
 * What a workflow step's script reads about the run it is in: the event that
 * started it, and git, asked a question whose failure is an answer.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The event's payload, or an empty one when the script is run by hand. */
export function eventPayload(env = process.env) {
  return env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
}

/**
 * Git's output, or `ok: false` when git refused: an absent commit, or a range
 * it cannot read. A refusal is for the caller to decide about, not a crash.
 */
export function readGit(args, { cwd } = {}) {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
  } catch {
    return { ok: false, out: "" };
  }
}
