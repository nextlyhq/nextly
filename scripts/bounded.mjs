#!/usr/bin/env node

/**
 * Runs one heavy command bounded: sized to this machine, one heavy job at a
 * time across every checkout on it, in a session of its own, and stopped when
 * whatever started it is gone.
 *
 * `local-limits.mjs` sizes a run, and the hook and `verify.mjs` applied that
 * size. Four gaps were left, each measured on the machine that lost sessions to
 * them:
 *
 * 🔴 The commands agents are TOLD to run were the unbounded ones. `pnpm test`,
 * `lint`, `check-types`, `build` and `test:integration*` were bare
 * `turbo run`, so turbo's default of 10 package tasks met Vitest's default of
 * one worker per core — the arithmetic the hook's bound exists to stop.
 *
 * 🔴 No bound was machine-wide. Two worktrees pushing at once each derived the
 * whole machine's budget and took it, which is exactly the parallel-checkout
 * workflow `pnpm worktree` exists to make safe. So heavy jobs take a SLOT: one
 * at a time by default, across every checkout, and a second waits and says
 * what it is waiting for.
 *
 * 🔴 Killing a push did not kill what its hook started. An agent's harness
 * kills the `git push` it launched; the hook's turbo and Vitest processes were
 * orphaned and ran to completion with nobody waiting, and were found still
 * holding the machine afterwards. So the run gets a session and a process
 * group of its own and a leader that watches everything above it — while it
 * waits for the slot as well as while it runs: when any of those processes is
 * gone, nothing is waiting for the answer, and the run is stopped or never
 * started.
 *
 * 🔴 "The run" is the SESSION, not the group. turbo starts every task in a
 * process group of its own — measured: `pnpm run test` and the vitest under it
 * sat in their own group, inside the run's session — so a signal to the run's
 * group reaches turbo alone. Killed before its graceful shutdown had finished,
 * turbo left its tasks running: a killed push took fifteen seconds to stop,
 * most of it a build nothing was waiting for.
 *
 * 🔴 A session of its own escapes the caller's group, which is how a harness
 * normally stops a command tree — so the watch is not optional. Without it,
 * bounding a command would make it outlive the thing that started it.
 *
 * In CI it is a pass-through: CI's lanes size themselves (`lane:*`), and a
 * runner is a dedicated machine with nothing else to protect.
 *
 * Usage:
 *   node scripts/bounded.mjs [--vitest-workers] <command> [args...]
 *
 *   --vitest-workers  pass the derived worker cap to Vitest: after `--` for
 *                     turbo, which forwards it to every task it runs, or
 *                     directly for vitest itself
 *
 * Environment:
 *   NEXTLY_HEAVY_SLOTS     heavy jobs this machine may run at once (default 1)
 *   NEXTLY_HEAVY_SLOT_DIR  where the slots are recorded (default: a private
 *                          directory of this user's in the OS temp directory)
 *   NEXTLY_LOCAL_CONCURRENCY, NEXTLY_LOCAL_MAX_WORKERS — see local-limits.mjs
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { localLimits, parseOverride } from "./local-limits.mjs";

const SELF = fileURLToPath(import.meta.url);

/** Set on everything a bounded run starts, so a bounded command inside it runs directly. */
const NESTED = "NEXTLY_BOUNDED";

/** How often a run checks that something is still waiting for it, and retries the slot. */
const POLL_MS = 1000;

/** How long a stopped run gets to exit cleanly before it is killed. */
const GRACE_MS = 5000;

/** How often a waiting run repeats who holds the slot. */
const WAIT_REPORT_MS = 60_000;

/**
 * A slot record that cannot be read is normally one being written — the create
 * and the write are two steps. Past this age it is a crash between them.
 */
const TORN_RECORD_MS = 10_000;

/** The exit status of a run abandoned because nothing was waiting for it: 128 + SIGTERM. */
const ABANDONED = 143;

/** States of a process that has exited, however it still appears. */
const EXITED = new Set(["Z", "X"]);

/**
 * Whether this is a CI run, where the local safety — the slot, the limits and
 * the pre-push gates — does not apply. The pre-push hook asks this function
 * rather than deciding for itself, so the two cannot disagree.
 *
 * Only `CI` counts, with the value rule `detectIsCi` applies: set to anything
 * but empty, "0" or "false". `detectIsCi` in packages/telemetry also counts
 * platform variables such as `VERCEL` and `NETLIFY`, and that is right for the
 * question it answers — whether a telemetry event came from automation, where
 * a wrong guess mislabels an event. Here a wrong guess switches the safety
 * off: a developer whose shell loads `VERCEL=1` from a pulled `.env` would push
 * with no gates at all. Every CI provider sets `CI`, and this repository's
 * GitHub Actions does; a CI host that does not set it gets the local bounds,
 * which is slower and never unsafe.
 */
export function isCi(env = process.env) {
  const value = env.CI;
  return typeof value === "string" && value !== "" && value !== "0" && value !== "false";
}

// ---------------------------------------------------------------------------
// The worker cap
// ---------------------------------------------------------------------------

/**
 * The command with Vitest's worker cap added, unless it already names one.
 *
 * turbo forwards whatever follows `--` to every task it runs, so the cap goes
 * after a separator. vitest invoked directly is the opposite: it reads what
 * follows `--` as test-name filters, so the cap goes before any separator. That
 * difference is measured, not assumed — `verify.mjs` records it.
 *
 * An explicit `--maxWorkers` wins, so a person narrowing one run is not
 * overridden by the derived default.
 */
export function withWorkerCap(argv, workers) {
  const flag = `--maxWorkers=${workers}`;
  return isTurbo(argv[0]) ? afterSeparator(argv, flag) : beforeSeparator(argv, flag);
}

function isTurbo(command) {
  return /(^|[\\/])turbo(\.cmd|\.exe)?$/.test(String(command));
}

function isWorkerCap(arg) {
  return /^--maxWorkers(=|$)/.test(arg);
}

/**
 * For turbo, a cap counts only after `--`, where turbo forwards it; before the
 * separator it is turbo's own flag, not Vitest's.
 */
function afterSeparator(argv, flag) {
  const at = argv.indexOf("--");
  if (at === -1) return [...argv, "--", flag];
  return argv.slice(at + 1).some(isWorkerCap) ? argv : [...argv, flag];
}

/**
 * For vitest itself, a cap counts only before `--`. After it, vitest reads
 * the cap as a test-name filter — `pnpm test:scripts -- --maxWorkers=1`
 * arrives that way — so the derived cap still goes in front.
 */
function beforeSeparator(argv, flag) {
  const at = argv.indexOf("--");
  const options = at === -1 ? argv : argv.slice(0, at);
  if (options.some(isWorkerCap)) return argv;
  return at === -1 ? [...argv, flag] : [...argv.slice(0, at), flag, ...argv.slice(at)];
}

// ---------------------------------------------------------------------------
// Reading processes
// ---------------------------------------------------------------------------

/** Whether a process exists. EPERM means it exists and belongs to someone else. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** A Linux process's state, parent, session and start time, from /proc; null when gone. */
function procStat(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name is in parentheses and may itself contain spaces or
    // parentheses, so the fields are read after the LAST closing one.
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], ppid: Number(fields[1]), session: Number(fields[3]), start: fields[19] };
  } catch {
    return null;
  }
}

/**
 * Every process's parent, state and start time from one `ps` call — the
 * portable way to read them where there is no /proc. `lstart` is a
 * fixed-format date, so it is read as the rest of the line.
 *
 * 🔴 A `ps` that fails answers `undefined` — nothing known — never an empty
 * table. An empty table reads every live process as gone: a waiting run would
 * take a slot another run is using, and a run whose caller is alive would be
 * stopped.
 */
export function processTable() {
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,state=,lstart="], { encoding: "utf8" });
    return parseProcessTable(out);
  } catch {
    return undefined;
  }
}

export function parseProcessTable(out) {
  const table = new Map();
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]), state: match[3][0], start: match[4] });
  }
  return table;
}

/**
 * How this platform describes processes: `null` to read /proc one process at a
 * time (Linux), a `ps` table (other POSIX systems), or `false` where nothing
 * beyond a process's existence can be known — Windows, or a `ps` that failed.
 */
export function processView(platform = viewPlatform()) {
  if (platform === "linux") return null;
  return platform === "win32" ? false : processTable() ?? false;
}

/**
 * The platform whose way of reading processes applies. Tests set
 * NEXTLY_BOUNDED_PS to run the `ps` path — macOS's — on Linux, end to end.
 */
function viewPlatform() {
  return process.env.NEXTLY_BOUNDED_PS ? "ps" : process.platform;
}

/** A process as the view describes it, or null when it cannot be described. */
function describeProcess(pid, view) {
  if (view === null) return procStat(pid);
  return view instanceof Map ? view.get(pid) ?? null : null;
}

/** One property of a process, or null when it cannot be read. */
function fieldOf(pid, view, key) {
  return describeProcess(pid, view)?.[key] ?? null;
}

/** A process and what identifies it: its start time, where the platform can read one. */
function identify(pid, view = processView()) {
  return { pid, start: fieldOf(pid, view, "start") };
}

function parentOf(pid, view) {
  return pid === process.pid ? process.ppid : fieldOf(pid, view, "ppid");
}

function isAncestor(pid, chain) {
  return Boolean(pid) && pid > 1 && chain.length < 32;
}

/**
 * This process and everything above it, each with what identifies it.
 *
 * All of them, not just the parent: the harness kills the `git push` it
 * launched, which sits two levels above a hook, and a `pnpm` that is killed
 * leaves the shell it started behind it. Anything above that disappears means
 * nothing is waiting for the answer. The start time guards against a pid being
 * reused by an unrelated process while the run is in flight.
 */
export function waitingChain(pid = process.pid, view = processView()) {
  const chain = [identify(pid, view)];
  for (let current = parentOf(pid, view); isAncestor(current, chain); current = parentOf(current, view)) {
    chain.push(identify(current, view));
  }
  return chain;
}

/**
 * Whether a process is still the one that was recorded. A zombie has exited
 * and only waits for its parent to collect it; a different start time means
 * the number now belongs to another process.
 */
function sameProcess({ start }, now) {
  if (EXITED.has(now.state)) return false;
  return start === null || now.start === start;
}

/**
 * Whether a watched process has gone: exited, a zombie, or its pid now
 * another process's. A process that exists but cannot be described — a
 * platform that knows only existence, or a lookup that failed — is not
 * judged gone: not knowing is not the same as knowing it has ended.
 */
export function isGone(entry, view = processView()) {
  if (!isAlive(entry.pid)) return true;
  const now = describeProcess(entry.pid, view);
  return now !== null && !sameProcess(entry, now);
}

/** The first watched process that has gone, read in one pass. */
function firstGone(watch) {
  const view = processView();
  return watch.find(entry => isGone(entry, view));
}

// ---------------------------------------------------------------------------
// The machine-wide heavy slot
// ---------------------------------------------------------------------------

/** A name for this user that is safe in a path: the uid, where there is one. */
function userKey() {
  return typeof process.getuid === "function" ? String(process.getuid()) : os.userInfo().username;
}

export function slotDir(env = process.env) {
  return env.NEXTLY_HEAVY_SLOT_DIR || join(os.tmpdir(), `nextly-heavy-slots-${userKey()}`);
}

export function slotCount(env = process.env) {
  return parseOverride(env.NEXTLY_HEAVY_SLOTS) ?? 1;
}

function ownedByMe(stat) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

function closedToOthers(stat) {
  return process.platform === "win32" || (stat.mode & 0o077) === 0;
}

/**
 * Creates the slot directory as this user's alone, and refuses one that is not.
 *
 * The default lives in the system temp directory, which every local user can
 * write to. A directory someone else created first could hold a record naming
 * a live process of theirs, and every heavy command here would wait on it. A
 * symbolic link is refused for the same reason: it points somewhere this user
 * did not choose.
 */
function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (stat.isDirectory() && ownedByMe(stat) && closedToOthers(stat)) return;
  throw new Error(
    `bounded: ${dir} is not a private directory of this user's — remove it, or set NEXTLY_HEAVY_SLOT_DIR`
  );
}

function readRecord(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { missing: true };
    throw error;
  }
  try {
    return { raw, record: JSON.parse(raw) };
  } catch {
    return { raw, record: null };
  }
}

function unlinkQuietly(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** Removes a record, but only if it is still the one that was judged. */
function removeIfUnchanged(path, raw) {
  const now = readRecord(path);
  if (!now.missing && now.raw === raw) unlinkQuietly(path);
}

/** Creates a record only if none exists, and reports whether it did. */
function create(path, record) {
  try {
    writeFileSync(path, JSON.stringify(record), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Whether a recorded process is still the one running: not exited, a zombie, or a reused pid. */
function stillRunning(pid, start, view) {
  return Number.isInteger(pid) && pid > 0 && !isGone({ pid, start: start ?? null }, view);
}

/** Whether a record's run is still alive: its caller, or its group leader. */
function holdsSlot(record) {
  const view = processView();
  return stillRunning(record.pid, record.start, view) || stillRunning(record.leader, record.leaderStart, view);
}

/** Clears a reclaim guard whose owner died mid-reclaim. A live one is left alone. */
function clearAbandonedGuard(guard, now) {
  const seen = readRecord(guard);
  if (!seen.missing && now - modifiedAt(guard) >= TORN_RECORD_MS) removeIfUnchanged(guard, seen.raw);
}

/**
 * Removes a dead run's record, one waiter at a time.
 *
 * 🔴 Judging a record and removing it are two steps. Two waiters that judged
 * the same dead record could both remove it — the second removing the record
 * the first had just written in its place — and both would run. A guard taken
 * with an exclusive create lets one waiter at a time do both; another finds
 * the guard and judges the slot again on its next pass.
 */
function reclaim(path, raw, now) {
  const guard = `${path}.reclaim`;
  if (!create(guard, { pid: process.pid })) return clearAbandonedGuard(guard, now);
  try {
    removeIfUnchanged(path, raw);
  } finally {
    unlinkQuietly(guard);
  }
}

/**
 * A record with no readable content: one still being written, which holds the
 * slot, or one a crash abandoned mid-write, which is reclaimed.
 */
function tornHolder(path, raw, now) {
  if (now - modifiedAt(path) < TORN_RECORD_MS) return { pid: null, command: "(a run that is starting)" };
  reclaim(path, raw, now);
  return null;
}

/**
 * Who holds a slot — or null once the record has gone or been reclaimed, so the
 * create can be retried. A record none of whose processes is still running was
 * left by a run killed with SIGKILL, or by a crash.
 */
function holderOf(path, now) {
  const seen = readRecord(path);
  if (seen.missing) return null;
  if (seen.record === null) return tornHolder(path, seen.raw, now);
  if (holdsSlot(seen.record)) return seen.record;
  reclaim(path, seen.raw, now);
  return null;
}

/** One slot: take it, or say who holds it. */
function claim(path, record, now) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (create(path, record)) return { taken: true };
    const holder = holderOf(path, now);
    if (holder) return { holder };
  }
  return { holder: { pid: null, command: "(a slot changing hands)" } };
}

/**
 * Takes a free slot, or reports who holds them all.
 *
 * A slot is a file created with an exclusive create, which the filesystem
 * grants to exactly one caller.
 *
 * @returns {{ path: string } | { holders: object[] }}
 */
export function tryAcquire(dir, count, record, now = Date.now()) {
  ensurePrivateDir(dir);
  const holders = [];
  for (let index = 0; index < count; index += 1) {
    const path = join(dir, `slot-${index}.json`);
    const outcome = claim(path, record, now);
    if (outcome.taken) return { path };
    holders.push({ ...outcome.holder, slot: path });
  }
  return { holders };
}

/** Gives a slot back, if it is still this process's. */
export function release(path, pid = process.pid) {
  const seen = readRecord(path);
  if (!seen.missing && seen.record?.pid === pid) unlinkQuietly(path);
}

function describeHolder({ pid, started, command, cwd, slot }) {
  const since = started ? ` since ${started}` : "";
  const where = cwd ? `, in ${cwd}` : "";
  return `pid ${pid ?? "?"}${since}: ${command}${where} (${slot})`;
}

function reportWaiting(holders, count) {
  for (const holder of holders) {
    process.stderr.write(`bounded: waiting for the heavy slot — ${describeHolder(holder)}\n`);
  }
  process.stderr.write(
    `  this machine runs ${count} heavy job(s) at a time; NEXTLY_HEAVY_SLOTS raises that\n`
  );
}

/** Exits without starting when something that was waiting for the run is gone. */
function abandonIfUnwatched(watch, command) {
  const lost = firstGone(watch);
  if (!lost) return;
  process.stderr.write(
    `bounded: pid ${lost.pid}, which was waiting for this run, is gone — not starting '${command}'\n`
  );
  process.exit(ABANDONED);
}

/**
 * Waits for a slot — and stops waiting once nothing is waiting for the run. A
 * push killed while it queued would otherwise take the slot when it freed and
 * run every gate for nobody.
 */
async function acquire(dir, count, record, watch) {
  let lastReport = 0;
  for (;;) {
    // Before each attempt, not after: a caller gone during the last wait must
    // not win the slot that just freed and start the command for nobody.
    abandonIfUnwatched(watch, record.command);
    const result = tryAcquire(dir, count, record);
    if (result.path) return result.path;
    if (Date.now() - lastReport >= WAIT_REPORT_MS) {
      lastReport = Date.now();
      reportWaiting(result.holders, count);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

// ---------------------------------------------------------------------------
// The members of a run
// ---------------------------------------------------------------------------

/** Every process in a session — on Linux, where /proc names each one's session. */
function sessionMembers(sid) {
  return readdirSync("/proc")
    .filter(entry => /^\d+$/.test(entry))
    .map(Number)
    .filter(pid => procStat(pid)?.session === sid);
}

/** A process and everything below it in a table of parents. */
export function descendantsIn(table, root) {
  const found = [root];
  for (let i = 0; i < found.length; i += 1) {
    for (const [pid, entry] of table) if (entry.ppid === found[i]) found.push(pid);
  }
  return found;
}

/**
 * Records every process the run has had, with its start time, so a task that
 * turbo left orphaned — reparented, and no longer anyone's descendant — is
 * still found when the run is stopped. Linux needs no record: it asks by
 * session.
 */
function remember(seen, leaderPid) {
  const view = processView();
  if (!(view instanceof Map)) return;
  for (const pid of descendantsIn(view, leaderPid)) seen.set(pid, view.get(pid)?.start);
}

/**
 * Every process of a run. On Linux, its session: the leader started it, so
 * the leader's pid is its id, and every process the run starts stays in it,
 * whichever group turbo gives a task. Elsewhere, the leader's descendants now,
 * and every process remembered earlier that is still the same process.
 */
export function runMembers(leaderPid, seen = new Map(), view = processView()) {
  if (view === null) return sessionMembers(leaderPid);
  if (!(view instanceof Map)) return [];
  const remembered = [...seen].filter(([pid, start]) => view.get(pid)?.start === start).map(([pid]) => pid);
  return [...new Set([...descendantsIn(view, leaderPid), ...remembered])];
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

function describe(argv) {
  const text = argv.join(" ");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function exitCode(code, signal) {
  return code ?? 128 + (os.constants.signals[signal] ?? 1);
}

/** Sends a signal to a pid, or to a group as a negative pid, ignoring one already gone. */
function sendSignal(target, signal) {
  try {
    process.kill(target, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function signalGroup(pgid, signal) {
  sendSignal(-pgid, signal);
}

/** Runs a command in this process's group and returns its exit code. */
function runDirect(argv, env) {
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    env,
    // Windows launchers such as `turbo.cmd` need a shell to start at all.
    shell: process.platform === "win32",
  });
  if (result.error) {
    process.stderr.write(`bounded: could not start '${argv[0]}': ${result.error.message}\n`);
    return 127;
  }
  return exitCode(result.status, result.signal);
}

/**
 * Signals every process of the run but the leader.
 *
 * 🔴 The leader's own group is not signalled: it is in that group, and a kill
 * sent to it would end the leader before it reached the processes turbo put in
 * groups of their own — the ones a group kill misses, which are the reason this
 * exists. Each member is signalled by pid instead, the leader last, by exiting.
 */
function signalOthers(seen, signal) {
  for (const pid of runMembers(process.pid, seen)) {
    if (pid !== process.pid) sendSignal(pid, signal);
  }
}

/**
 * Kills every other process of the run, then ends the leader with a status.
 * The run is sampled first: where there is no /proc, a task started since the
 * last sample would otherwise be missed.
 */
function finish(seen, status) {
  remember(seen, process.pid);
  signalOthers(seen, "SIGKILL");
  process.exit(status);
}

function stopRun(argv, lost, seen) {
  process.stderr.write(
    `\nbounded: pid ${lost.pid}, which was waiting for this run, is gone — stopping '${describe(argv)}'\n`
  );
  remember(seen, process.pid);
  signalOthers(seen, "SIGTERM");
  setTimeout(() => finish(seen, ABANDONED), GRACE_MS);
}

/**
 * Names this leader in the slot's record before anything starts.
 *
 * 🔴 The caller used to write the leader's pid after spawning it. Killed in
 * between, it left a record naming only itself — dead — so a waiting run took
 * the slot while the leader and its command ran on. The leader now writes
 * itself in, under the same guard a reclaim takes, and only if the record is
 * still its caller's: a slot already reclaimed means the caller is gone, and
 * the run must not start.
 */
async function publishLeader(slot, callerPid) {
  const guard = `${slot}.reclaim`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (create(guard, { pid: process.pid })) return writeLeaderUnder(guard, slot, callerPid);
    clearAbandonedGuard(guard, Date.now());
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

function writeLeaderUnder(guard, slot, callerPid) {
  try {
    const seen = readRecord(slot);
    if (seen.missing || seen.record?.pid !== callerPid) return false;
    writeFileSync(slot, JSON.stringify({ ...seen.record, leader: process.pid, leaderStart: identify(process.pid).start }));
    return true;
  } finally {
    unlinkQuietly(guard);
  }
}

/**
 * The run's leader: runs the command, keeps a record of the run's processes,
 * and ends the whole run once nothing is waiting for it.
 *
 * It ignores the signals it would otherwise die of, because the command is in
 * its group and receives them directly — the leader stays to report the
 * command's exit status, which is the only answer the caller gets. SIGUSR2 is
 * the caller's "stop now", after a Ctrl-C the run did not answer in time.
 */
async function lead(watch, slot, argv) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => {});
  if (!(await publishLeader(slot, watch[0].pid))) {
    process.stderr.write("bounded: this run's heavy slot was taken over before it started — not starting\n");
    process.exit(ABANDONED);
  }
  const seen = new Map();
  process.on("SIGUSR2", () => finish(seen, ABANDONED));

  const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
  let stopping = false;

  const timer = setInterval(() => {
    remember(seen, process.pid);
    const lost = stopping ? undefined : firstGone(watch);
    if (!lost) return;
    stopping = true;
    stopRun(argv, lost, seen);
  }, POLL_MS);

  child.on("error", error => {
    process.stderr.write(`bounded: could not start '${argv[0]}': ${error.message}\n`);
    process.exit(127);
  });
  // Whatever the command left running goes with it, in whichever group.
  child.on("exit", (code, signal) => {
    clearInterval(timer);
    finish(seen, exitCode(code, signal));
  });
}

/**
 * A run that has not stopped within the grace period after a Ctrl-C is told to
 * stop now — only the leader can find all of it on every platform — and one
 * whose leader does not answer is killed with its group.
 */
function escalate(leaderPid) {
  return {
    stopNow: setTimeout(() => sendSignal(leaderPid, "SIGUSR2"), GRACE_MS),
    lastResort: setTimeout(() => signalGroup(leaderPid, "SIGKILL"), GRACE_MS * 2),
  };
}

/** Anything a run left after its leader exited: its group, and on Linux its session. */
function sweep(leaderPid) {
  signalGroup(leaderPid, "SIGKILL");
  if (viewPlatform() !== "linux") return;
  for (const pid of sessionMembers(leaderPid)) sendSignal(pid, "SIGKILL");
}

/**
 * Starts the run's leader and stays with it: passes on the signals the
 * terminal delivers here rather than there, escalates a run that does not
 * stop, and exits with the run's status.
 */
function runInGroup(command, env, watch, slot) {
  const leader = spawn(process.execPath, [SELF, "--lead", JSON.stringify(watch), slot, "--", ...command], {
    stdio: "inherit",
    env,
    detached: true,
  });

  let escalation = null;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      // To the run's group, as a terminal would: turbo passes it on to its
      // tasks and shuts down in order.
      signalGroup(leader.pid, signal);
      escalation ??= escalate(leader.pid);
    });
  }

  leader.on("exit", (code, signal) => {
    clearTimeout(escalation?.stopNow);
    clearTimeout(escalation?.lastResort);
    sweep(leader.pid);
    process.exit(exitCode(code, signal));
  });
}

/** The command as the caller wrote it, and whether it asked for the worker cap. */
function parseRequest(argv) {
  const vitestWorkers = argv[0] === "--vitest-workers";
  const command = vitestWorkers ? argv.slice(1) : argv;
  if (command.length === 0) {
    process.stderr.write("bounded: usage — node scripts/bounded.mjs [--vitest-workers] <command> [args...]\n");
    process.exit(64);
  }
  return { command, vitestWorkers };
}

/**
 * Re-runs the calling script under the runner, unless it already is under one
 * or this is CI — the way the pre-push hook hands itself over. A script with a
 * heavy mode calls this before any heavy work, and everything it then starts
 * takes the slot, the limits and the watch.
 */
export function handOver(script, args, env = process.env) {
  if (env[NESTED] || isCi(env)) return;
  const result = spawnSync(process.execPath, [SELF, process.execPath, script, ...args], { stdio: "inherit", env });
  process.exit(exitCode(result.status, result.signal));
}

function boundedCommand(request, limits) {
  return request.vitestWorkers ? withWorkerCap(request.command, limits.maxWorkers) : request.command;
}

function boundedEnv(limits) {
  return {
    ...process.env,
    // turbo's own variable, so it reaches every nested invocation.
    TURBO_CONCURRENCY: String(limits.concurrency),
    // Streamed output rather than the interactive UI. The run is in a session
    // of its own, without the terminal as its controlling one, and the UI puts
    // that terminal into raw mode — a run stopped by the watch would leave it
    // there for the person who typed the command.
    TURBO_UI: "false",
    [NESTED]: "1",
  };
}

/** Takes the heavy slot, then runs the command in a session of its own while holding it. */
/**
 * Says so when the process tree cannot be read. Only the direct parent is then
 * known, so a killed caller further up — `git push`, above the hook's shell —
 * would not stop the run. A degraded watch is reported, never silent.
 */
function warnIfBlind(view) {
  if (view !== false || viewPlatform() === "win32") return;
  process.stderr.write(
    "bounded: could not read the process tree (ps failed) — only the direct parent is watched, so a killed caller further up will not stop this run\n"
  );
}

async function runExclusively({ command, env, limits }) {
  const count = slotCount();
  // Read before queueing, and watched while queued as well as while running.
  const view = processView();
  warnIfBlind(view);
  const watch = waitingChain(process.pid, view);
  const record = {
    pid: process.pid,
    start: watch[0].start,
    leader: null,
    leaderStart: null,
    command: describe(command),
    cwd: process.cwd(),
    started: new Date().toISOString(),
  };
  const slot = await acquire(slotDir(), count, record, watch);
  process.on("exit", () => release(slot));

  process.stderr.write(
    `bounded: ${limits.concurrency} package task(s) x ${limits.maxWorkers} worker(s), ` +
      `${count} heavy job(s) per machine — ${describe(command)}\n`
  );

  // Windows has no process groups or sessions to signal, so the run keeps the
  // slot and the limits and runs directly.
  if (process.platform === "win32") process.exit(runDirect(command, env));

  runInGroup(command, env, watch, slot);
}

/** The runner's own entry points: a run's leader, and the pre-push hook's CI question. */
const MODES = {
  "--lead": argv => lead(JSON.parse(argv[1]), argv[2], argv.slice(argv.indexOf("--") + 1)),
  "--is-ci": () => process.exit(isCi() ? 0 : 1),
};

async function main() {
  const argv = process.argv.slice(2);
  const mode = MODES[argv[0]];
  if (mode) return mode(argv);

  const request = parseRequest(argv);
  if (isCi()) process.exit(runDirect(request.command, process.env));

  const limits = localLimits();
  const run = { command: boundedCommand(request, limits), env: boundedEnv(limits), limits };

  // Inside a bounded run — `pnpm run build` from the hook — the slot, the
  // session and the watch are already in place. Taking a second slot here would
  // wait on the run that is waiting on it.
  if (process.env[NESTED]) process.exit(runDirect(run.command, run.env));

  await runExclusively(run);
}

if (process.argv[1] && process.argv[1].endsWith("bounded.mjs")) {
  try {
    await main();
  } catch (error) {
    // A refusal the runner can explain — a slot directory that is not private
    // — is said plainly. Anything else is a defect, and keeps its stack.
    if (!String(error?.message).startsWith("bounded:")) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
