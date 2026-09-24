#!/usr/bin/env node

/**
 * Runs one heavy command bounded: sized to this machine, one heavy job at a
 * time across every checkout on it, in its own process group, and stopped when
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
 * group of its own and a leader that watches everything above it: when any of
 * those processes is gone, nothing is waiting for the answer, and the whole
 * run is stopped.
 *
 * 🔴 "The whole run" is the SESSION, not the group. turbo starts every task in
 * a process group of its own — measured: `pnpm run test` and the vitest under
 * it sat in their own group, inside the run's session — so a signal to the
 * run's group reaches turbo alone. Killed before its graceful shutdown had
 * finished, turbo left its tasks running: a killed push took fifteen seconds
 * to stop, most of it a build nothing was waiting for.
 *
 * 🔴 A group of its own escapes the caller's group, which is how a harness
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
 *   NEXTLY_HEAVY_SLOT_DIR  where the slots are recorded (default: the OS temp dir)
 *   NEXTLY_LOCAL_CONCURRENCY, NEXTLY_LOCAL_MAX_WORKERS — see local-limits.mjs
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { localLimits, parseOverride } from "./local-limits.mjs";

const SELF = fileURLToPath(import.meta.url);

/** Set on everything a bounded run starts, so a bounded command inside it runs directly. */
const NESTED = "NEXTLY_BOUNDED";

/** How often the leader checks that something is still waiting for the run. */
const POLL_MS = 1000;

/** How long a stopped run gets to exit cleanly before the group is killed. */
const GRACE_MS = 5000;

/** How often a waiting run repeats who holds the slot. */
const WAIT_REPORT_MS = 60_000;

/**
 * A slot record that cannot be read is normally one being written — the create
 * and the write are two steps. Past this age it is a crash between them.
 */
const TORN_RECORD_MS = 10_000;

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
  if (argv.some(arg => /^--maxWorkers(=|$)/.test(arg))) return argv;
  const flag = `--maxWorkers=${workers}`;
  return isTurbo(argv[0]) ? afterSeparator(argv, flag) : beforeSeparator(argv, flag);
}

function isTurbo(command) {
  return /(^|[\\/])turbo(\.cmd|\.exe)?$/.test(String(command));
}

function afterSeparator(argv, flag) {
  return argv.includes("--") ? [...argv, flag] : [...argv, "--", flag];
}

function beforeSeparator(argv, flag) {
  const at = argv.indexOf("--");
  return at === -1 ? [...argv, flag] : [...argv.slice(0, at), flag, ...argv.slice(at)];
}

// ---------------------------------------------------------------------------
// The machine-wide heavy slot
// ---------------------------------------------------------------------------

export function slotDir(env = process.env) {
  return env.NEXTLY_HEAVY_SLOT_DIR || join(os.tmpdir(), "nextly-heavy-slots");
}

export function slotCount(env = process.env) {
  return parseOverride(env.NEXTLY_HEAVY_SLOTS) ?? 1;
}

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

/** Removes a stale record, but only if it is still the record that was judged. */
function removeIfUnchanged(path, raw) {
  const now = readRecord(path);
  if (!now.missing && now.raw === raw) unlinkQuietly(path);
}

/** Creates a slot's record, or reports that the slot is taken. */
function create(path, record) {
  try {
    writeFileSync(path, JSON.stringify(record), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

/** Whether a record's run is still alive: its caller, or its group leader. */
function holdsSlot(record) {
  return isAlive(record.pid) || isAlive(record.leader);
}

function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * A record with no readable content: one still being written, which holds the
 * slot, or one a crash abandoned mid-write, which is cleared.
 */
function tornHolder(path, raw, now) {
  if (now - modifiedAt(path) < TORN_RECORD_MS) return { pid: null, command: "(a run that is starting)" };
  removeIfUnchanged(path, raw);
  return null;
}

/**
 * Who holds a slot — or null once the record has gone or has been cleared, so
 * the create can be retried. A record whose processes are all gone was left by
 * a run killed with SIGKILL, or by a crash, and it is cleared.
 */
function holderOf(path, now) {
  const seen = readRecord(path);
  if (seen.missing) return null;
  if (seen.record === null) return tornHolder(path, seen.raw, now);
  if (holdsSlot(seen.record)) return seen.record;
  removeIfUnchanged(path, seen.raw);
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
 * grants to exactly one caller. Two waiters that judge the same dead record in
 * the same instant can both take the slot; each run is still sized by
 * `local-limits.mjs`, so that race costs headroom, never the bound itself.
 *
 * @returns {{ path: string } | { holders: object[] }}
 */
export function tryAcquire(dir, count, record, now = Date.now()) {
  mkdirSync(dir, { recursive: true });
  const holders = [];
  for (let index = 0; index < count; index += 1) {
    const path = join(dir, `slot-${index}.json`);
    const outcome = claim(path, record, now);
    if (outcome.taken) return { path };
    holders.push(outcome.holder);
  }
  return { holders };
}

/** Gives a slot back, if it is still this process's. */
export function release(path, pid = process.pid) {
  const seen = readRecord(path);
  if (!seen.missing && seen.record?.pid === pid) unlinkQuietly(path);
}

function describeHolder({ pid, started, command, cwd }) {
  const since = started ? ` since ${started}` : "";
  const where = cwd ? `, in ${cwd}` : "";
  return `pid ${pid ?? "?"}${since}: ${command}${where}`;
}

function reportWaiting(holders, count) {
  for (const holder of holders) {
    process.stderr.write(`bounded: waiting for the heavy slot — ${describeHolder(holder)}\n`);
  }
  process.stderr.write(
    `  this machine runs ${count} heavy job(s) at a time; NEXTLY_HEAVY_SLOTS raises that\n`
  );
}

async function acquire(dir, count, record) {
  let lastReport = 0;
  for (;;) {
    const result = tryAcquire(dir, count, record);
    if (result.path) return result.path;
    if (Date.now() - lastReport >= WAIT_REPORT_MS) {
      lastReport = Date.now();
      reportWaiting(result.holders, count);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// ---------------------------------------------------------------------------
// What is waiting for the run
// ---------------------------------------------------------------------------

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

function psParent(pid) {
  try {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
    return Number(out.trim()) || null;
  } catch {
    return null;
  }
}

/** How each platform names a process's parent; elsewhere, only the direct parent is known. */
const PARENT = {
  linux: pid => procStat(pid)?.ppid ?? null,
  darwin: psParent,
};

function parentOf(pid) {
  if (pid === process.pid) return process.ppid;
  return PARENT[process.platform]?.(pid) ?? null;
}

function identify(pid) {
  return { pid, start: procStat(pid)?.start ?? null };
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
export function waitingChain(pid = process.pid) {
  const chain = [identify(pid)];
  for (let current = parentOf(pid); isAncestor(current, chain); current = parentOf(current)) {
    chain.push(identify(current));
  }
  return chain;
}

/** States of a process that has exited, however it still appears. */
const EXITED = new Set(["Z", "X"]);

/**
 * Whether /proc still shows the same living process under this pid. A zombie
 * has exited and only waits for its parent to collect it; a different start
 * time means the number now belongs to another process.
 */
function stillSame({ pid, start }) {
  const now = procStat(pid);
  if (!now || EXITED.has(now.state)) return false;
  return start === null || now.start === start;
}

/** Whether a watched process has gone: exited, a zombie, or its pid reused. */
export function isGone(entry) {
  if (!isAlive(entry.pid)) return true;
  return process.platform === "linux" && !stillSame(entry);
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

/** Every process in a session — on Linux, where /proc names each one's session. */
function sessionMembers(sid) {
  return readdirSync("/proc")
    .filter(entry => /^\d+$/.test(entry))
    .map(Number)
    .filter(pid => procStat(pid)?.session === sid);
}

/** Every process's parent, from `ps` — the portable way to read the process tree. */
function parentTable() {
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
    return out.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  } catch {
    return [];
  }
}

/**
 * A process and everything below it, as the tree stands now. A task already
 * orphaned by a killed turbo has left this tree, which is why Linux is asked
 * by session instead.
 */
function descendantsOf(root) {
  const table = parentTable();
  const found = [root];
  for (let i = 0; i < found.length; i += 1) {
    for (const [pid, ppid] of table) if (ppid === found[i]) found.push(pid);
  }
  return found;
}

/**
 * Signals every process of a run — its group, and each group turbo made for a
 * task. The leader started the run's session, so its pid is the session's id.
 */
function signalRun(leaderPid, signal) {
  signalGroup(leaderPid, signal);
  const members = process.platform === "linux" ? sessionMembers(leaderPid) : descendantsOf(leaderPid);
  for (const pid of members) sendSignal(pid, signal);
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
 * Stops the leader's own run: a polite signal, then a kill after the grace
 * period. The leader ignores the polite one, so it stays to deliver the second.
 */
function stopRun(argv, lost) {
  process.stderr.write(
    `\nbounded: pid ${lost.pid}, which was waiting for this run, is gone — stopping '${describe(argv)}'\n`
  );
  signalRun(process.pid, "SIGTERM");
  setTimeout(() => signalRun(process.pid, "SIGKILL"), GRACE_MS);
}

/**
 * The group leader: runs the command, and stops the whole group once nothing
 * is waiting for it.
 *
 * It ignores the signals it would otherwise die of, because the command is in
 * its group and receives them directly — the leader stays to report the
 * command's exit status, which is the only answer the caller gets.
 */
function lead(watch, argv) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => {});

  const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
  let stopping = false;

  const timer = setInterval(() => {
    const lost = stopping ? undefined : watch.find(isGone);
    if (!lost) return;
    stopping = true;
    stopRun(argv, lost);
  }, POLL_MS);

  child.on("error", error => {
    process.stderr.write(`bounded: could not start '${argv[0]}': ${error.message}\n`);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    clearInterval(timer);
    // Stopped because nobody is waiting: take anything the command left
    // running with it. This ends the leader too, which is the point.
    if (stopping) signalRun(process.pid, "SIGKILL");
    process.exit(exitCode(code, signal));
  });
}

/**
 * Starts the run's group and stays with it: passes on the signals the terminal
 * delivers here rather than there, kills a run that does not stop within the
 * grace period, and exits with the run's status.
 */
function runInGroup(command, env, onLeader) {
  const leader = spawn(
    process.execPath,
    [SELF, "--lead", JSON.stringify(waitingChain()), "--", ...command],
    { stdio: "inherit", env, detached: true }
  );
  onLeader(leader.pid);

  let escalation = null;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      // To the run's group, as a terminal would: turbo passes it on to its
      // tasks and shuts down in order.
      signalGroup(leader.pid, signal);
      escalation ??= setTimeout(() => signalRun(leader.pid, "SIGKILL"), GRACE_MS);
    });
  }

  leader.on("exit", (code, signal) => {
    clearTimeout(escalation);
    // Whatever the run left behind goes with it, in whichever group.
    signalRun(leader.pid, "SIGKILL");
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
    // that terminal into raw mode — a run stopped by the watch below would
    // leave it there for the person who typed the command.
    TURBO_UI: "false",
    [NESTED]: "1",
  };
}

/** Takes the heavy slot, then runs the command in its own group while holding it. */
async function runExclusively({ command, env, limits }) {
  const count = slotCount();
  const record = {
    pid: process.pid,
    leader: null,
    command: describe(command),
    cwd: process.cwd(),
    started: new Date().toISOString(),
  };
  const slot = await acquire(slotDir(), count, record);
  process.on("exit", () => release(slot));

  process.stderr.write(
    `bounded: ${limits.concurrency} package task(s) x ${limits.maxWorkers} worker(s), ` +
      `${count} heavy job(s) per machine — ${describe(command)}\n`
  );

  // Windows has no process groups to kill or signal, so the run keeps the
  // slot and the limits and runs directly.
  if (process.platform === "win32") process.exit(runDirect(command, env));

  runInGroup(command, env, leader => writeFileSync(slot, JSON.stringify({ ...record, leader })));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--lead") return lead(JSON.parse(argv[1]), argv.slice(argv.indexOf("--") + 1));

  const request = parseRequest(argv);
  if (process.env.CI) process.exit(runDirect(request.command, process.env));

  const limits = localLimits();
  const run = { command: boundedCommand(request, limits), env: boundedEnv(limits), limits };

  // Inside a bounded run — `pnpm run build` from the hook — the slot, the group
  // and the watch are already in place. Taking a second slot here would wait on
  // the run that is waiting on it.
  if (process.env[NESTED]) process.exit(runDirect(run.command, run.env));

  await runExclusively(run);
}

if (process.argv[1] && process.argv[1].endsWith("bounded.mjs")) {
  await main();
}
