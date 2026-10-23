/**
 * Find the disk idle checkouts hold, and free it only when asked and only
 * where nobody's work can be touched.
 *
 * A worktree per pull request outruns every cleanup that waits for a person:
 * on the machine this was measured on, fourteen worktrees held 1.4–3.5 GB
 * each. Two kinds of that are safe to take back once a checkout has gone
 * quiet:
 *
 * - build output in an idle checkout, as its `turbo.jsonc` declares it, plus
 *   turbo's logs and the browser suites' reports, which the next build or run
 *   writes again;
 * - a stale checkout whose work is all on a remote or already in `main`, and
 *   which holds no ignored file that might be someone's work.
 *
 * 🔴 Each is reported and nothing is removed until `--apply`. Removing is the
 * one direction that cannot be undone, so a run that was not told to apply
 * changes nothing on disk, whatever it finds.
 *
 * And with `--apply`, a checkout is touched only when every in-use question
 * has an answer and every answer is no, asked once to find it and again just
 * before it goes: no process runs inside it, no heavy job holds a
 * `bounded.mjs` slot there, none of its slot's ports answers, and it — and its
 * build output — has been idle for the kind's threshold. A question that cannot be
 * answered — no `lsof`, an unreadable git state — counts as yes, so the
 * checkout is skipped with the reason. "I cannot tell" is not "nobody".
 *
 * A stale checkout is removed through `worktree remove` without `--force`, so
 * the same refusal that protects uncommitted work from a person protects it
 * from this, and its slot, databases and snapshot go back in the same step.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { connect } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";

import { heldRecords } from "./bounded.mjs";
import { parseJsonc } from "./jsonc.mjs";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long each kind must have been left alone before it is offered. */
export const IDLE_DAYS = { builds: 3, stale: 7 };

/** The ref a stale checkout's work must already be in, when it is on no remote. */
const MAIN_REF = "origin/main";

/**
 * What a checkout's builds and tools write and write again, so a sweep may
 * take it. Build output comes from the checkout's own `turbo.jsonc`: each
 * task's declared `outputs`, matched against the package an ignored path sits
 * in, with a `name#task` entry applying to that package alone. The
 * declaration is where the repository says what a build makes, so an output
 * declared there is covered here without a second list to keep in step. A
 * checkout whose config cannot be read declares nothing, and its build output
 * then reads as work: the safe direction.
 */
export function outputClassifier(checkout) {
  const declared = declaredOutputs(checkout);
  const packages = new Map();
  const isBuildOutput = path =>
    !inDependencies(path) && (isOtherOutput(path) || isDeclaredOutput(checkout, path, declared, packages));
  return { isBuildOutput, isRegenerated: path => isBuildOutput(path) || isToolCache(path) };
}

/**
 * Output no turbo task declares: turbo's own logs, the browser suites'
 * reports and saved session, Lighthouse's reports, and the playground's extra
 * distDirs (`.next-e2e`, `.next-lighthouse`) the browser suites build.
 */
const OTHER_OUTPUT = new Set([".turbo", "playwright-report", "test-results", "blob-report", "lighthouse-reports", ".playwright"]);

function isOtherOutput(path) {
  const name = path.split("/").at(-1);
  return OTHER_OUTPUT.has(name) || name.startsWith(".next-");
}

/** Regenerated, but not build output: dependencies, husky's hook shims and fallow's cache. */
function isToolCache(path) {
  return inDependencies(path) || path.startsWith(".husky/_") || path === ".fallow" || path.startsWith(".fallow/");
}

function inDependencies(path) {
  return path.split("/").includes("node_modules");
}

/** Every task's `outputs` in the checkout's turbo config: those for any package, and those for one by name. */
function declaredOutputs(checkout) {
  const declared = { generic: [], byPackage: new Map() };
  for (const [task, settings] of turboTasks(checkout)) addOutputs(declared, task, outputsOf(settings));
  return declared;
}

function turboTasks(checkout) {
  for (const name of ["turbo.jsonc", "turbo.json"]) {
    const config = readJsoncQuietly(join(checkout, name));
    if (config !== null) return Object.entries(config.tasks ?? {});
  }
  return [];
}

/** A task's output patterns, without its exclusions: an excluded cache is regenerated all the same. */
function outputsOf(settings) {
  return Array.isArray(settings?.outputs) ? settings.outputs.filter(pattern => !String(pattern).startsWith("!")) : [];
}

function addOutputs(declared, task, outputs) {
  const at = task.indexOf("#");
  if (at === -1) return declared.generic.push(...outputs);
  const name = task.slice(0, at);
  declared.byPackage.set(name, [...(declared.byPackage.get(name) ?? []), ...outputs]);
}

function readJsoncQuietly(file) {
  try {
    return parseJsonc(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Whether a declared output covers `path`, read relative to the package it sits in. */
function isDeclaredOutput(checkout, path, declared, packages) {
  const pkg = packageOf(checkout, path, packages);
  const patterns = [...declared.generic, ...(declared.byPackage.get(pkg.name) ?? [])];
  const inPackage = relative(pkg.dir, join(checkout, path)).split(sep).join("/");
  return patterns.some(pattern => globCovers(pattern, inPackage));
}

/** The nearest directory above `path` holding a `package.json`, and that package's name. */
function packageOf(checkout, path, cache) {
  let dir = dirname(join(checkout, path));
  while (dir !== checkout && !existsSync(join(dir, "package.json"))) dir = dirname(dir);
  return packageAt(dir, cache);
}

function packageAt(dir, cache) {
  if (!cache.has(dir)) cache.set(dir, { dir, name: readJsoncQuietly(join(dir, "package.json"))?.name ?? null });
  return cache.get(dir);
}

/**
 * Whether `pattern` covers `path`, for the two shapes turbo's outputs take
 * here: `dir/**`, the directory or anything under it, and `**` + `/*.ext`, a
 * file of that extension anywhere. Any other shape covers nothing, so an
 * output declared in a shape this does not read is treated as work and kept.
 */
export function globCovers(pattern, path) {
  const under = pattern.match(/^([^*?[\]{}!]+)\/\*\*$/);
  if (under) return path === under[1] || path.startsWith(`${under[1]}/`);
  const anywhere = pattern.match(/^\*\*\/\*(\.[^*?/[\]{}]+)$/);
  return Boolean(anywhere) && path.endsWith(anywhere[1]);
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
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Git's output untouched: `-z` output must not lose a name's leading or trailing spaces to a trim. */
function gitRaw(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
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
 * directory, so the gate skips it rather than guessing. The directory's own
 * time counts only after `ownUntil`: removing an output at its top moves that
 * time, and the sweep's own removal is not someone using the checkout.
 */
export function lastActivity(checkout, ownUntil = 0) {
  let gitDir;
  try {
    gitDir = git(["rev-parse", "--absolute-git-dir"], checkout);
  } catch {
    return null;
  }
  const top = modifiedAt(checkout);
  return Math.max(
    top > ownUntil ? top : 0,
    ...["HEAD", "index", join("logs", "HEAD")].map(name => modifiedAt(join(gitDir, name)))
  );
}

/**
 * Every ignored path in a checkout, without a trailing slash. Git names a
 * wholly ignored directory as one entry, which hides what it holds, so one
 * that is not regenerated is listed file by file: a `.claude` directory
 * holding only the slot's settings must be judged by that file. Regenerated
 * directories such as `node_modules` stay one entry and are never walked.
 */
export function ignoredIn(checkout, isRegenerated) {
  const entries = lsIgnored(checkout, ["--directory"]);
  const expanded = entries.flatMap(entry => (opaque(entry, isRegenerated) ? lsIgnored(checkout, ["--", entry]) : [entry]));
  return [...new Set(expanded)].map(withoutSlash);
}

/** Ignored paths, NUL-separated, so a name git would quote in line output is read as it is. */
function lsIgnored(checkout, args) {
  return gitRaw(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", ...args], checkout)
    .split("\0")
    .filter(Boolean);
}

function opaque(entry, isRegenerated) {
  return entry.endsWith("/") && !isRegenerated(withoutSlash(entry));
}

function withoutSlash(path) {
  return path.replace(/\/$/, "");
}

export function buildOutputOf(ignored, isBuildOutput) {
  return ignored.filter(isBuildOutput);
}

/**
 * Why a checkout's ignored files hold work, or null when every one is
 * regenerated. `isOwnSettings` says whether a path is a settings file this
 * tooling wrote and nobody added to, which `worktree new` leaves in each.
 */
export function ignoredWorkReason(checkout, ignored, { isOwnSettings, isRegenerated }) {
  const work = ignored.filter(path => !isRegenerated(path) && !isOwnSettings(join(checkout, path)));
  if (work.length === 0) return null;
  const more = work.length > 3 ? ` and ${work.length - 3} more` : "";
  return `it holds ignored files that may be work: ${work.slice(0, 3).join(", ")}${more}`;
}

/**
 * Why a checkout's build output says it is in use, or null: a build that only
 * overwrites files inside an existing `dist` moves none of the times
 * `lastActivity` reads, so the output itself is asked. Unknown counts as used.
 */
export function buildActivityReason(checkout, outputs, idleDays, now) {
  const since = now - idleDays * DAY_MS;
  const verdicts = outputs.map(relative => writtenSince(join(checkout, relative), since));
  if (verdicts.includes(null)) return "cannot tell when its build output was last written";
  return verdicts.includes(true) ? `its build output was written within ${idleDays} d` : null;
}

/**
 * Whether anything under `dir` was modified at or after `since`: true, false,
 * or null when it could not all be read or holds more than `limit` entries,
 * which is too many to have looked at every one.
 */
export function writtenSince(dir, since, limit = 50_000) {
  const walk = { stack: [dir], seen: 0, since, limit };
  try {
    let verdict = false;
    while (verdict === false && walk.stack.length > 0) verdict = step(walk);
    return verdict;
  } catch {
    return null;
  }
}

/** Look at one entry: true when it is new enough, null at the limit, false to keep going. */
function step(walk) {
  walk.seen += 1;
  if (walk.seen > walk.limit) return null;
  const entry = walk.stack.pop();
  const info = lstatSync(entry);
  return info.mtimeMs >= walk.since || expand(walk, entry, info);
}

function expand(walk, entry, info) {
  if (info.isDirectory()) walk.stack.push(...readdirSync(entry).map(name => join(entry, name)));
  return false;
}

/**
 * Why a checkout is not stale, or an empty list when it is: no uncommitted or
 * untracked change, and no commit that is on no remote and not already in
 * `mainRef`. "Already in" is content, not ancestry: a squash merge leaves the
 * branch's commits unmerged to git while `main` holds what they changed.
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

/**
 * Whether every path the branch changed since it left `mainRef` is the same in
 * `mainRef` as in HEAD; null when git cannot say. Only reads: a comparison
 * that wrote a merged tree would leave an object behind on a report run. Both
 * lists are read NUL-separated, since line output C-quotes a name with a
 * non-ASCII byte, a tab or a newline, and a quoted name matches no real path.
 * A path `main` has changed again since reads as different, which keeps the
 * checkout: the safe direction.
 */
function contentInMain(checkout, mainRef) {
  try {
    const base = git(["merge-base", mainRef, "HEAD"], checkout);
    const differing = new Set(changedNames(checkout, mainRef, "HEAD"));
    return !changedNames(checkout, base, "HEAD").some(path => differing.has(path));
  } catch {
    return null;
  }
}

/** The paths that differ between two commits, as git stores them. */
function changedNames(checkout, from, to) {
  return gitRaw(["diff", "-z", "--name-only", "--no-renames", from, to], checkout).split("\0").filter(Boolean);
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

/** Add one removal's size to the run's total, keeping count of the ones no size was read for. */
export function countFreed(tally, bytes) {
  if (bytes === null || bytes === undefined) tally.unknown += 1;
  else tally.freed += bytes;
}

/** The run's total, saying how many removals it could not size rather than counting them as nothing. */
export function describeFreed(verb, tally) {
  const unknown = tally.unknown > 0 ? `, plus ${tally.unknown} of unknown size` : "";
  return `${verb} ${formatBytes(tally.freed)} in all${unknown}`;
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

/**
 * Remove a candidate only if, asked again right now, nothing uses it. What
 * the run read at its start is minutes old by the time sizing, port probes
 * and earlier removals are done, and a shell or a build may have entered
 * since: neither a rename nor `git worktree remove` refuses a directory a
 * process merely sits in.
 */
export async function removeIfStillFree(candidate, { recheck, remove }) {
  const late = await recheck(candidate);
  if (late.length > 0) return { removed: false, skipped: true, reason: `in use by now: ${late.join("; ")}` };
  return remove(candidate);
}

function errorText(error) {
  return error.code ?? error.message;
}

/** Append one removal to the shared log, so what a sweep took can be read back later. */
export function logRemoval(commonDir, kind, path, bytes) {
  appendFileSync(join(commonDir, "nextly-sweep.log"), `${new Date().toISOString()}\t${kind}\t${bytes ?? "?"}\t${path}\n`);
}
