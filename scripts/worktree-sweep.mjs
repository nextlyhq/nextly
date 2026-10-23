/**
 * Find the disk idle checkouts hold, and free it only when asked and only
 * where nobody's work can be touched.
 *
 * A worktree per pull request outruns every cleanup that waits for a person:
 * on the machine this was measured on, fourteen worktrees held 1.4–3.5 GB
 * each, and the fallow base snapshots of live ones another 1.3 GB. Three kinds
 * of that are safe to take back once a checkout has gone quiet:
 *
 * - the base snapshot fallow's audit keeps for a live checkout, which fallow
 *   rebuilds on the next audit (`sweep` already takes the ones whose checkout
 *   is gone);
 * - build output in an idle checkout — `dist`, `.next`, `.turbo`, coverage and
 *   test reports — which the next build writes again;
 * - a stale checkout whose work is all on a remote or already in `main`.
 *
 * 🔴 Each is reported and nothing is removed until `--apply`. Removing is the
 * one direction that cannot be undone, so a run that was not told to apply
 * changes nothing on disk, whatever it finds.
 *
 * And with `--apply`, a checkout is touched only when every in-use question
 * has an answer and every answer is no: no process runs inside it, no heavy
 * job holds a `bounded.mjs` slot there, none of its slot's ports answers, and
 * it has been idle for the kind's threshold. A question that cannot be
 * answered — no `lsof`, an unreadable git state — counts as yes, so the
 * checkout is skipped with the reason. "I cannot tell" is not "nobody".
 *
 * A stale checkout is removed through `worktree remove` without `--force`, so
 * the same refusal that protects uncommitted work from a person protects it
 * from this, and its slot, databases and snapshot go back in the same step.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve, sep } from "node:path";

import { heldRecords } from "./bounded.mjs";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long each kind must have been left alone before it is offered. */
export const IDLE_DAYS = { snapshot: 1, builds: 3, stale: 7 };

/** The ref a stale checkout's work must already be in, when it is on no remote. */
const MAIN_REF = "origin/main";

/**
 * Ignored directories that a build or a test run writes and the next one
 * writes again. Only these: an ignored `.env` or a local database is work,
 * not output, and `node_modules` is a reinstall rather than a rebuild.
 */
const BUILD_OUTPUT = new Set(["dist", ".next", ".turbo", "coverage", "playwright-report", "test-results", "blob-report"]);

/** Whether a path git reports as ignored is build output this may remove. */
export function isBuildOutput(relativePath) {
  const parts = relativePath.replace(/\/$/, "").split("/");
  if (parts.includes("node_modules")) return false;
  const name = parts.at(-1);
  // `.next-e2e` and `.next-lighthouse` are the playground's throwaway distDirs.
  return BUILD_OUTPUT.has(name) || name.startsWith(".next-");
}

/** `path` itself or anything below it, compared resolved so a link still finds its target. */
function isInside(path, dir) {
  const child = canonical(path);
  const parent = canonical(dir);
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Why `path` is in use, or an empty list when nothing is. `facts` holds what
 * was read once for the whole run: the working directory of every process
 * (null when it could not be read), the heavy jobs running and where, the
 * ports of this checkout's slot that answered, and when it was last active
 * (null when that could not be read).
 */
export function inUseReasons(path, facts) {
  return [processReason, heldReason, portReason, idleReason].map(check => check(path, facts)).filter(Boolean);
}

function processReason(path, { processCwds }) {
  if (processCwds === null) return "cannot tell which processes run inside it";
  const inside = processCwds.find(cwd => isInside(cwd, path));
  return inside ? `a process runs inside it (${inside})` : null;
}

function heldReason(path, { heldCwds }) {
  if (heldCwds.includes(null)) return "a heavy job is starting and its directory is not known yet";
  return heldCwds.some(cwd => isInside(cwd, path)) ? "a heavy job holds a bounded slot there" : null;
}

function portReason(path, { answering }) {
  return answering.length > 0 ? `its slot's port ${answering.join(", ")} answers` : null;
}

function idleReason(path, { lastActive, idleDays, now }) {
  if (lastActive === null) return "cannot read when it was last used";
  if (now - lastActive >= idleDays * DAY_MS) return null;
  return `used ${formatAge(now - lastActive)} ago, under ${idleDays} d idle`;
}

function formatAge(ms) {
  const hours = ms / (60 * 60 * 1000);
  return hours < 48 ? `${Math.max(0, Math.round(hours))} h` : `${Math.round(hours / 24)} d`;
}

/**
 * The working directory of every process this user can read, or null when
 * they cannot be read at all. Linux names them under `/proc`; macOS through
 * `lsof`, which exits 1 when some processes are not readable and still prints
 * the rest. Anywhere else, null: the platform has no answer here, and no
 * answer means every checkout is treated as in use.
 */
export function processCwds(platform = process.platform) {
  const read = CWD_READERS[platform] ?? (() => null);
  return read();
}

const CWD_READERS = { linux: procCwds, darwin: lsofCwds };

function lsofCwds() {
  const run = spawnSync("lsof", ["-a", "-d", "cwd", "-F", "n"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return lsofAnswered(run) ? parseLsofCwds(run.stdout) : null;
}

/** Exit 0, or 1 with output: lsof's way of saying some processes were not readable. */
function lsofAnswered(run) {
  return !run.error && [0, 1].includes(run.status) && Boolean(run.stdout);
}

/** The `n` lines of `lsof -F n` output, which name each process's directory. */
export function parseLsofCwds(out) {
  return out
    .split("\n")
    .filter(line => line.startsWith("n"))
    .map(line => line.slice(1));
}

function procCwds() {
  let pids;
  try {
    pids = readdirSync("/proc").filter(name => /^\d+$/.test(name));
  } catch {
    return null;
  }
  const cwds = [];
  for (const pid of pids) {
    try {
      cwds.push(readlinkSync(`/proc/${pid}/cwd`));
    } catch {
      // Another user's process, or one that exited while this read the list.
    }
  }
  return cwds;
}

/** The directories heavy jobs run in right now, with null for one not known yet. */
export function heldCwds(slotDirectory) {
  return heldRecords(slotDirectory).map(record => record.cwd ?? null);
}

/** Which of `ports` answer on 127.0.0.1: a server of that checkout's slot is up. */
export async function answeringPorts(ports, timeoutMs = 300) {
  const results = await Promise.all(ports.map(port => answers(port, timeoutMs)));
  return ports.filter((_, index) => results[index]);
}

function answers(port, timeoutMs) {
  return new Promise(done => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = result => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** Run git in `cwd` with the hook environment cleared, as `worktree.mjs` does. */
function git(args, cwd) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * When a checkout was last used, as the newest of its directory, its HEAD,
 * its index and its HEAD's log: a commit, a checkout, a staged change or a
 * file made at its top all move one. Null when git cannot name its git
 * directory, so the gate skips it rather than guessing.
 */
export function lastActivity(checkout) {
  let gitDir;
  try {
    gitDir = git(["rev-parse", "--absolute-git-dir"], checkout);
  } catch {
    return null;
  }
  return Math.max(
    modifiedAt(checkout),
    ...["HEAD", "index", join("logs", "HEAD")].map(name => modifiedAt(join(gitDir, name)))
  );
}

/** The ignored build output in a checkout, relative paths without the trailing slash. */
export function buildOutputIn(checkout) {
  const listed = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], checkout);
  return listed
    .split("\n")
    .filter(Boolean)
    .filter(isBuildOutput)
    .map(path => path.replace(/\/$/, ""));
}

/**
 * Why a checkout is not stale, or an empty list when it is: no uncommitted or
 * untracked change, and no commit that is on no remote and not already in
 * `mainRef`. "Already in" is the merged tree, not ancestry: a squash merge
 * leaves the branch's commits unmerged to git while `main` holds their content,
 * and merging HEAD into `mainRef` then changes nothing.
 */
export function staleReasons(checkout, mainRef = MAIN_REF) {
  const state = gitState(checkout);
  if (state === null) return ["cannot read its git state"];
  return [dirtyReason(state), aheadReason(checkout, state, mainRef)].filter(Boolean);
}

/** Its uncommitted changes and how many commits are on no remote, or null when git cannot say. */
function gitState(checkout) {
  try {
    return {
      // `--no-optional-locks` keeps status from refreshing the index, which
      // would move the index's time and make the checkout read as just used.
      status: git(["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], checkout),
      ahead: Number(git(["rev-list", "--count", "HEAD", "--not", "--remotes"], checkout)),
    };
  } catch {
    return null;
  }
}

function dirtyReason({ status }) {
  return status === "" ? null : "it has uncommitted or untracked changes";
}

function aheadReason(checkout, { ahead }, mainRef) {
  if (ahead === 0) return null;
  const inMain = contentInMain(checkout, mainRef);
  if (inMain === null) return `cannot compare it with ${mainRef}`;
  return inMain ? null : `${ahead} commit(s) on no remote and not in ${mainRef}`;
}

/** Whether merging HEAD into `mainRef` leaves `mainRef`'s tree as it is; null when git cannot say. */
function contentInMain(checkout, mainRef) {
  let mainTree;
  try {
    mainTree = git(["rev-parse", `${mainRef}^{tree}`], checkout);
  } catch {
    return null;
  }
  const merge = spawnSync("git", ["merge-tree", "--write-tree", mainRef, "HEAD"], { cwd: checkout, encoding: "utf8" });
  // Exit 1 is a conflicted merge: the checkout holds a change `main` lacks.
  if (merge.status === 1) return false;
  if (merge.status !== 0) return null;
  return merge.stdout.split("\n")[0].trim() === mainTree;
}

/**
 * Bytes on disk per path, from one `du` run, so a file hard-linked into
 * several of `paths` is counted once, under the first that holds it. A path
 * `du` could not size maps to null, and so does every path where there is no
 * `du` to ask.
 */
export function diskUsage(paths) {
  const sizes = new Map(paths.map(path => [path, null]));
  for (const [path, bytes] of duSizes(paths)) if (sizes.has(path)) sizes.set(path, bytes);
  return sizes;
}

/** `[path, bytes]` for each path one `du -sk` run could size. */
function duSizes(paths) {
  if (paths.length === 0 || process.platform === "win32") return [];
  const run = spawnSync("du", ["-sk", ...paths], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return String(run.stdout ?? "")
    .split("\n")
    .map(line => line.match(/^(\d+)\t(.+)$/))
    .filter(Boolean)
    .map(match => [match[2], Number(match[1]) * 1024]);
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "size unknown";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Move a directory aside, then remove it. A failed move means it is left
 * exactly as it was: on Windows an open handle refuses the rename, and that is
 * a process still using it. A move that succeeds but cannot be finished leaves
 * the renamed copy, and says where.
 */
export function moveAsideAndRemove(dir, now = Date.now()) {
  const trash = `${dir}.nextly-trash-${now}`;
  try {
    renameSync(dir, trash);
  } catch (error) {
    return { removed: false, reason: `could not move it aside (${errorText(error)})` };
  }
  try {
    rmSync(trash, { recursive: true, force: true });
    return { removed: true };
  } catch (error) {
    return { removed: false, reason: `moved to ${trash} but not removed (${errorText(error)})` };
  }
}

export function errorText(error) {
  return error.code ?? error.message;
}

/** Append one removal to the shared log, so what a sweep took can be read back later. */
export function logRemoval(commonDir, kind, path, bytes) {
  appendFileSync(join(commonDir, "nextly-sweep.log"), `${new Date().toISOString()}\t${kind}\t${bytes ?? "?"}\t${path}\n`);
}
