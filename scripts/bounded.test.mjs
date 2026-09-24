/**
 * What makes a heavy command bounded, each case one way it stops being so.
 *
 * The process cases run the real script with harmless commands — a stub
 * `turbo` that prints what it was given, and `node -e` one-liners that sleep —
 * against a temporary slot directory, and judge processes by pid. They are
 * POSIX-only: Windows has no process groups, and the script runs directly
 * there, which it says.
 *
 * Every process a case starts is killed after it, pass or fail.
 *
 * @module bounded.test
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CI_MARKERS,
  descendantsIn,
  isAlive,
  isCi,
  isGone,
  parseProcessTable,
  processTable,
  release,
  runMembers,
  slotCount,
  slotDir,
  tryAcquire,
  waitingChain,
  withWorkerCap,
} from "./bounded.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOUNDED = path.join(HERE, "bounded.mjs");
const POSIX = process.platform !== "win32";

/**
 * perl can move a process into a group of its own without leaving its
 * session — what turbo does with every task, and what neither Node nor a
 * shell without a terminal can do.
 */
const HAS_PERL = POSIX && spawnSync("perl", ["-e", "1"]).status === 0;

const LINUX = process.platform === "linux";

/** A Linux process's state letter, from /proc; null once it is gone. */
function stateOf(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    return text.slice(text.lastIndexOf(")") + 2).split(" ")[0];
  } catch {
    return null;
  }
}

/** A Linux process's group, from /proc. */
function groupOf(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(text.slice(text.lastIndexOf(")") + 2).split(" ")[2]);
}

let dir;
const spawned = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bounded-test-"));
});

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is what the case wanted.
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A pid that existed and has exited. */
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

const record = (pid, extra = {}) => ({
  pid,
  leader: null,
  command: "turbo run test",
  cwd: "/checkouts/nextly-a",
  started: "2026-09-24T10:00:00.000Z",
  ...extra,
});

/**
 * The environment a run starts from. A test run under `pnpm test:scripts` is
 * itself bounded and passes on what that set — NEXTLY_BOUNDED would make every
 * run here a nested one, and the limits would read as this script's own — and
 * CI makes every run a pass-through.
 */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  // Every CI marker, not just CI: GitHub Actions sets GITHUB_ACTIONS too, and
  // any one of them makes a run a pass-through.
  for (const name of [...CI_MARKERS, "NEXTLY_BOUNDED", "TURBO_CONCURRENCY", "TURBO_UI"]) delete env[name];
  return { ...env, NEXTLY_HEAVY_SLOT_DIR: dir, ...extra };
}

function runBounded(args, extra = {}) {
  const child = spawn(process.execPath, [BOUNDED, ...args], {
    env: cleanEnv(extra),
    stdio: ["ignore", "pipe", "pipe"],
  });
  spawned.push(child.pid);
  child.out = "";
  child.err = "";
  child.stdout.on("data", chunk => (child.out += chunk));
  child.stderr.on("data", chunk => (child.err += chunk));
  child.done = new Promise(resolve =>
    child.on("close", (code, signal) => resolve({ code, signal }))
  );
  return child;
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return condition();
}

/** A command that starts a sleeping child of its own, prints its pid, and sleeps. */
const WITH_GRANDCHILD = [
  process.execPath,
  "-e",
  [
    'const { spawn } = require("node:child_process");',
    'const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    "console.log(c.pid);",
    "setInterval(() => {}, 1000);",
  ].join(" "),
];

/**
 * A process that has exited and that its parent will never collect.
 *
 * 🔴 The first version backgrounded a child that exited AT ONCE, and passed
 * locally but not in CI: the shell collected it before becoming `sleep`, so no
 * zombie ever existed there. The child now outlives the shell's exec, so its
 * parent is `sleep` when it exits — and the case waits until /proc says Z.
 */
async function zombie() {
  const parent = spawn("sh", ["-c", "sleep 0.3 & echo $!; exec sleep 8"], { stdio: ["ignore", "pipe", "ignore"] });
  spawned.push(parent.pid);
  const out = { out: "" };
  parent.stdout.on("data", chunk => (out.out += chunk));
  await waitUntil(() => /^\d+\n/.test(out.out), 5000);
  const pid = Number(out.out.split("\n")[0]);
  await waitUntil(() => stateOf(pid) === "Z", 5000);
  return pid;
}

async function grandchildOf(child) {
  await waitUntil(() => /^\d+\n/.test(child.out), 5000);
  const pid = Number(child.out.split("\n")[0]);
  spawned.push(pid);
  return pid;
}

describe("passing Vitest its worker cap", () => {
  it("puts it after `--` for turbo, which forwards it to every task", () => {
    expect(withWorkerCap(["turbo", "run", "test"], 2)).toEqual([
      "turbo",
      "run",
      "test",
      "--",
      "--maxWorkers=2",
    ]);
  });

  it("adds it to the arguments turbo already forwards", () => {
    expect(withWorkerCap(["turbo", "run", "test", "--", "-t", "locks"], 2)).toEqual([
      "turbo",
      "run",
      "test",
      "--",
      "-t",
      "locks",
      "--maxWorkers=2",
    ]);
  });

  /*
   * 🔴 The opposite of turbo: vitest reads everything after `--` as a test
   * filter, so a cap placed there is accepted and ignored and the run reports
   * success uncapped. `verify.mjs` measured this with a deliberately invalid
   * flag.
   */
  it("puts it before `--` for vitest called directly", () => {
    expect(withWorkerCap(["vitest", "run", "--dir", "scripts", "--", "bounded"], 3)).toEqual([
      "vitest",
      "run",
      "--dir",
      "scripts",
      "--maxWorkers=3",
      "--",
      "bounded",
    ]);
  });

  it("leaves a cap the caller chose alone, in either spelling", () => {
    const chosen = ["turbo", "run", "test", "--", "--maxWorkers=1"];
    expect(withWorkerCap(chosen, 4)).toBe(chosen);
    const spaced = ["vitest", "run", "--maxWorkers", "1"];
    expect(withWorkerCap(spaced, 4)).toBe(spaced);
  });

  /*
   * 🔴 A cap anywhere used to count. `pnpm test:scripts -- --maxWorkers=1`
   * reaches vitest after `--`, where it is a test-name filter, and the run
   * went uncapped; before turbo's `--` a cap is turbo's own flag.
   */
  it("counts a caller's cap only where the runner that reads it parses it", () => {
    expect(withWorkerCap(["vitest", "run", "--dir", "scripts", "--", "--maxWorkers=1"], 2)).toEqual([
      "vitest", "run", "--dir", "scripts", "--maxWorkers=2", "--", "--maxWorkers=1",
    ]);
    expect(withWorkerCap(["turbo", "run", "test", "--maxWorkers=1"], 2)).toEqual([
      "turbo", "run", "test", "--maxWorkers=1", "--", "--maxWorkers=2",
    ]);
    expect(withWorkerCap(["turbo", "run", "test", "--maxWorkers=1", "--", "-t", "x"], 2)).toEqual([
      "turbo", "run", "test", "--maxWorkers=1", "--", "-t", "x", "--maxWorkers=2",
    ]);
  });
});

describe("the machine-wide heavy slot", () => {
  it("is taken by the first run, and records who took it", () => {
    const taken = tryAcquire(dir, 1, record(process.pid));
    expect(taken.path).toBeDefined();
    expect(JSON.parse(readFileSync(taken.path, "utf8")).pid).toBe(process.pid);
  });

  it("makes a second run wait, and says who holds it", () => {
    tryAcquire(dir, 1, record(process.pid));
    const second = tryAcquire(dir, 1, record(process.pid, { command: "turbo run lint" }));
    expect(second.path).toBeUndefined();
    expect(second.holders).toEqual([
      expect.objectContaining({ pid: process.pid, command: "turbo run test" }),
    ]);
  });

  /*
   * A run killed with SIGKILL, or one that crashed, never gives its slot back.
   * Without this, one bad exit would stop every heavy command on the machine
   * until someone found the file.
   */
  it("takes over a slot whose holder died without giving it back", () => {
    tryAcquire(dir, 1, record(deadPid()));
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeDefined();
  });

  it("does not take it over while the run's group leader is still stopping it", () => {
    tryAcquire(dir, 1, record(deadPid(), { leader: process.pid }));
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeUndefined();
  });

  it("allows as many runs as NEXTLY_HEAVY_SLOTS says, and one by default", () => {
    expect(slotCount({})).toBe(1);
    expect(slotCount({ NEXTLY_HEAVY_SLOTS: "2" })).toBe(2);
    // Malformed is ignored rather than honoured, as local-limits does.
    expect(slotCount({ NEXTLY_HEAVY_SLOTS: "lots" })).toBe(1);

    tryAcquire(dir, 2, record(process.pid));
    expect(tryAcquire(dir, 2, record(process.pid)).path).toBeDefined();
    expect(tryAcquire(dir, 2, record(process.pid)).holders).toHaveLength(2);
  });

  it("treats a record still being written as held, and one abandoned mid-write as free", () => {
    // The create and the write are two steps, so an empty record is normally
    // a run that has not finished claiming the slot yet.
    const slot = path.join(dir, "slot-0.json");
    writeFileSync(slot, "");
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeUndefined();

    const minuteAgo = new Date(Date.now() - 60_000);
    utimesSync(slot, minuteAgo, minuteAgo);
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBe(slot);
  });

  /*
   * 🔴 A record naming only a pid: after a run is killed, a zombie or an
   * unrelated process given the same number kept the slot "held", and every
   * heavy command on the machine waited on something that was not a run.
   */
  it.runIf(LINUX)("takes over a slot whose recorded process now has another start time", () => {
    tryAcquire(dir, 1, record(process.pid, { start: "1" }));
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeDefined();
  });

  it.runIf(LINUX)("keeps a slot whose recorded process is still the same one", () => {
    const [self] = waitingChain();
    tryAcquire(dir, 1, record(process.pid, { start: self.start }));
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeUndefined();
  });

  it.runIf(LINUX)("takes over a slot whose holder is a zombie", async () => {
    tryAcquire(dir, 1, record(await zombie()));
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeDefined();
  });

  /*
   * 🔴 Judging a dead record and removing it are two steps. Two waiters could
   * both remove it, the second removing the record the first had just written,
   * and both would run. One reclaims at a time; the other judges again later.
   */
  it("leaves a dead slot alone while another waiter is reclaiming it", () => {
    const slot = path.join(dir, "slot-0.json");
    tryAcquire(dir, 1, record(deadPid()));
    writeFileSync(`${slot}.reclaim`, JSON.stringify({ pid: process.pid }));

    expect(tryAcquire(dir, 1, record(process.pid)).path).toBeUndefined();
    expect(existsSync(slot)).toBe(true);
  });

  it("clears a reclaim its waiter abandoned, and takes the slot", () => {
    const slot = path.join(dir, "slot-0.json");
    tryAcquire(dir, 1, record(deadPid()));
    writeFileSync(`${slot}.reclaim`, JSON.stringify({ pid: deadPid() }));
    const minuteAgo = new Date(Date.now() - 60_000);
    utimesSync(`${slot}.reclaim`, minuteAgo, minuteAgo);

    expect(tryAcquire(dir, 1, record(process.pid)).path).toBe(slot);
    expect(existsSync(`${slot}.reclaim`)).toBe(false);
  });

  /*
   * 🔴 The default lives in the system temp directory, which every local user
   * can write to. A directory someone else made first could hold a record
   * naming a live process of theirs and block every heavy command here.
   */
  it.runIf(POSIX)("keeps the default slots in a directory named for this user", () => {
    expect(slotDir({})).toMatch(new RegExp(`nextly-heavy-slots-${process.getuid()}$`));
  });

  it.runIf(POSIX)("refuses a slot directory other users can write to", () => {
    const open = path.join(dir, "open");
    mkdirSync(open);
    chmodSync(open, 0o777);
    expect(() => tryAcquire(open, 1, record(process.pid))).toThrow(/is not a private directory/);
  });

  it.runIf(POSIX)("refuses a slot directory that is a symbolic link", () => {
    const real = path.join(dir, "real");
    mkdirSync(real, { mode: 0o700 });
    const link = path.join(dir, "link");
    symlinkSync(real, link);
    expect(() => tryAcquire(link, 1, record(process.pid))).toThrow(/is not a private directory/);
  });

  it("gives back only its own slot", () => {
    const { path: slot } = tryAcquire(dir, 1, record(process.pid));
    release(slot, deadPid());
    expect(existsSync(slot)).toBe(true);
    release(slot, process.pid);
    expect(existsSync(slot)).toBe(false);
  });
});

describe("deciding whether this is CI", () => {
  /*
   * One question, one answer: the list is telemetry's, copied because a root
   * script cannot import a package's TypeScript source — and held to it here,
   * so the copy cannot drift.
   */
  it("knows the same CI markers as the telemetry package", async () => {
    const source = readFileSync(path.join(HERE, "..", "packages", "telemetry", "src", "environment.ts"), "utf8");
    const list = /const CI_ENV_VARS = \[([^\]]*)\]/.exec(source)[1];
    expect(CI_MARKERS).toEqual([...list.matchAll(/"([A-Z_]+)"/g)].map(match => match[1]));
  });

  it("reads any of those markers as CI, as telemetry does", () => {
    expect(isCi({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCi({ JENKINS_URL: "https://ci.example" })).toBe(true);
    expect(isCi({ GITHUB_ACTIONS: "false", CI: "0" })).toBe(false);
  });

  /*
   * The telemetry package's rule: set, and neither "0" nor "false". A presence
   * test made `CI=false` in a developer's environment a pass-through, and the
   * heavy commands ran unbounded on their machine.
   */
  it("reads CI the way the telemetry package does", () => {
    expect(isCi({ CI: "true" })).toBe(true);
    expect(isCi({ CI: "1" })).toBe(true);
    for (const value of ["false", "0", ""]) expect(isCi({ CI: value })).toBe(false);
    expect(isCi({})).toBe(false);
  });
});

/*
 * Where there is no /proc — macOS — processes are read from one `ps` table.
 * Linux's `ps` prints the same columns, so the path runs here too.
 */
describe.runIf(POSIX)("reading processes from ps", () => {
  it("reads each row's pid, parent, state and start time", () => {
    const table = parseProcessTable(
      "  123     1 Ss   Tue Sep 24 10:00:00 2026\n  456   123 Z    Tue Sep 24 10:01:00 2026\nnot a row\n"
    );
    expect(table.get(123)).toEqual({ ppid: 1, state: "S", start: "Tue Sep 24 10:00:00 2026" });
    expect(table.get(456).state).toBe("Z");
    expect(table.size).toBe(2);
  });

  it("reads this machine's own ps output", () => {
    expect(processTable().get(process.pid)?.ppid).toBe(process.ppid);
  });

  /*
   * 🔴 From the tree alone, a task turbo left orphaned is nobody's descendant
   * by the time the run is stopped, and it survived. The run remembers what it
   * has seen — and by start time, so a pid given to another process since is
   * not killed in its place.
   */
  it("finds a run's processes, including one orphaned since it was seen", async () => {
    const parent = spawn(process.execPath, WITH_GRANDCHILD.slice(1), { stdio: ["ignore", "pipe", "ignore"] });
    spawned.push(parent.pid);
    const out = { out: "" };
    parent.stdout.on("data", chunk => (out.out += chunk));
    const child = await grandchildOf(out);
    const before = processTable();
    expect(descendantsIn(before, parent.pid)).toEqual(expect.arrayContaining([parent.pid, child]));

    process.kill(parent.pid, "SIGKILL");
    await waitUntil(() => processTable().get(child)?.ppid !== parent.pid, 5000);
    const after = processTable();

    expect(runMembers(parent.pid, new Map([[child, before.get(child).start]]), after)).toContain(child);
    expect(runMembers(parent.pid, new Map([[child, "another start"]]), after)).not.toContain(child);
  });
});

describe.runIf(POSIX)("knowing whether anything is still waiting", () => {
  it("watches this process and every process above it", () => {
    const chain = waitingChain();
    expect(chain[0].pid).toBe(process.pid);
    expect(chain.map(entry => entry.pid)).toContain(process.ppid);
  });

  it("reads a live process as waiting and an exited one as gone", () => {
    expect(isGone({ pid: process.pid, start: null })).toBe(false);
    expect(isGone({ pid: deadPid(), start: null })).toBe(true);
  });

  /*
   * A process that has exited but not been collected by its parent still
   * answers `kill 0`, so an exited `git push` whose shell has not reaped it yet
   * would read as waiting.
   */
  it.runIf(LINUX)("reads an exited process its parent has not collected as gone", async () => {
    const pid = await zombie();
    expect(stateOf(pid)).toBe("Z");
    expect(isAlive(pid)).toBe(true);
    expect(isGone({ pid, start: null })).toBe(true);
  });

  /*
   * 🔴 A failed `ps` once answered with an empty table, and every live process
   * read as gone: a waiting run could take a slot another run was using, and a
   * run whose caller was alive could be stopped. Not knowing is not gone.
   */
  it("does not read a live process as gone when it cannot be described", () => {
    expect(isGone({ pid: process.pid, start: "another start" }, new Map())).toBe(false);
    expect(isGone({ pid: process.pid, start: "another start" }, false)).toBe(false);
    expect(isGone({ pid: deadPid(), start: null }, new Map())).toBe(true);
  });

  it.runIf(process.platform === "linux")("reads a pid now used by another process as gone", () => {
    const [self] = waitingChain();
    expect(isGone({ ...self, start: `${Number(self.start) + 1}` })).toBe(true);
  });
});

describe.runIf(POSIX)("running a command bounded", () => {
  /** A stub turbo that prints its arguments and the limits it was given. */
  function stubTurbo() {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const turbo = path.join(bin, "turbo");
    writeFileSync(
      turbo,
      '#!/bin/sh\nprintf "%s\\n" "$@"\necho "TURBO_CONCURRENCY=$TURBO_CONCURRENCY"\necho "TURBO_UI=$TURBO_UI"\n'
    );
    chmodSync(turbo, 0o755);
    return turbo;
  }

  it("passes the command's exit status back and gives the slot up", async () => {
    const child = runBounded([process.execPath, "-e", "process.exit(7)"]);
    expect((await child.done).code).toBe(7);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("hands turbo the derived limits, and Vitest its worker cap", async () => {
    const child = runBounded(["--vitest-workers", stubTurbo(), "run", "test"], {
      NEXTLY_LOCAL_CONCURRENCY: "2",
      NEXTLY_LOCAL_MAX_WORKERS: "3",
    });
    expect((await child.done).code).toBe(0);
    expect(child.out.split("\n")).toEqual(
      expect.arrayContaining(["run", "test", "--", "--maxWorkers=3", "TURBO_CONCURRENCY=2", "TURBO_UI=false"])
    );
  });

  it("is a pass-through in CI, which sizes its own runs", async () => {
    tryAcquire(dir, 1, record(process.pid));
    const child = runBounded(["--vitest-workers", stubTurbo(), "run", "test"], { CI: "true" });
    expect((await child.done).code).toBe(0);
    expect(child.out).not.toMatch(/--maxWorkers/);
    expect(child.out).toMatch(/^TURBO_CONCURRENCY=$/m);
  });

  it("bounds a run whose CI is set to false", async () => {
    const child = runBounded(["--vitest-workers", stubTurbo(), "run", "test"], {
      CI: "false",
      NEXTLY_LOCAL_CONCURRENCY: "2",
      NEXTLY_LOCAL_MAX_WORKERS: "3",
    });
    expect((await child.done).code).toBe(0);
    expect(child.out).toMatch(/^--maxWorkers=3$/m);
    expect(child.out).toMatch(/^TURBO_CONCURRENCY=2$/m);
  });

  it("says plainly when its slot directory is not private, rather than running", async () => {
    const open = path.join(dir, "open");
    mkdirSync(open);
    chmodSync(open, 0o777);
    const child = runBounded([process.execPath, "-e", "process.exit(0)"], { NEXTLY_HEAVY_SLOT_DIR: open });
    expect((await child.done).code).toBe(1);
    expect(child.err).toMatch(/^bounded: .* is not a private directory/m);
  });

  /*
   * 🔴 The caller used to name the leader in the slot's record after spawning
   * it. Killed in between, it left a record naming only itself, dead, and a
   * waiting run could take the slot while the leader ran on.
   */
  it("names its leader in the slot's record before the command starts", async () => {
    const read = 'const r = JSON.parse(require("fs").readFileSync(require("path").join(process.env.NEXTLY_HEAVY_SLOT_DIR, "slot-0.json"), "utf8")); console.log(JSON.stringify(r))';
    const child = runBounded([process.execPath, "-e", read]);
    expect((await child.done).code).toBe(0);
    const seen = JSON.parse(child.out.trim().split("\n").pop());
    expect(seen.leader).toEqual(expect.any(Number));
    expect(seen.leader).not.toBe(child.pid);
  });

  it("does not start a command whose slot is no longer its caller's", async () => {
    const slot = path.join(dir, "slot-0.json");
    writeFileSync(slot, JSON.stringify(record(deadPid())));
    const marker = path.join(dir, "ran");
    const leader = spawn(
      process.execPath,
      [BOUNDED, "--lead", JSON.stringify([{ pid: process.pid, start: null }]), slot, "--",
        process.execPath, "-e", 'require("fs").writeFileSync(process.argv[1], "ran")', marker],
      { env: cleanEnv(), stdio: ["ignore", "ignore", "pipe"] }
    );
    spawned.push(leader.pid);
    let err = "";
    leader.stderr.on("data", chunk => (err += chunk));
    const code = await new Promise(resolve => leader.on("close", resolve));

    expect(code).toBe(143);
    expect(err).toMatch(/taken over before it started/);
    expect(existsSync(marker)).toBe(false);
  });

  /*
   * The `ps` path, end to end: turbo dies and leaves a task it put in a group
   * of its own. Once seen, the task is still found by start time, though it is
   * nobody's descendant any more.
   */
  it.runIf(LINUX && HAS_PERL)("on the ps path, stops a task left orphaned when the command dies", async () => {
    const child = runBounded(
      [
        process.execPath,
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          'const c = spawn("perl", ["-e", "setpgrp(0, 0); sleep 60"], { stdio: "ignore" });',
          'console.log(c.pid + " " + process.pid);',
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ],
      { NEXTLY_BOUNDED_PS: "1" }
    );
    await waitUntil(() => /^\d+ \d+\n/.test(child.out), 5000);
    const [task, command] = child.out.split("\n")[0].split(" ").map(Number);
    spawned.push(task, command);
    expect(await waitUntil(() => groupOf(task) === task, 5000)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 2500));

    process.kill(command, "SIGKILL");

    expect(await waitUntil(() => isGone({ pid: task, start: null }), 6000)).toBe(true);
  }, 20_000);

  /*
   * The hook runs `pnpm run build` inside its own bounded run. Waiting for the
   * slot there would wait on the run that is waiting for the build.
   */
  it("runs a bounded command inside a bounded run directly, without waiting on its slot", async () => {
    tryAcquire(dir, 1, record(process.pid));
    const child = runBounded([process.execPath, "-e", "process.exit(0)"], { NEXTLY_BOUNDED: "1" });
    expect((await child.done).code).toBe(0);
  });

  it("waits while another run holds the slot, says who, and runs once it is free", async () => {
    const { path: held } = tryAcquire(dir, 1, record(process.pid, { command: "turbo run lint" }));
    const child = runBounded([process.execPath, "-e", "process.exit(0)"]);

    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(child.exitCode).toBeNull();
    expect(child.err).toMatch(
      /waiting for the heavy slot — pid \d+ since .*: turbo run lint, in \/checkouts\/nextly-a \(.*slot-0\.json\)/
    );

    release(held, process.pid);
    expect((await child.done).code).toBe(0);
  });

  /*
   * 🔴 A push killed while it queued took the slot when it freed and ran every
   * gate for nobody: the caller was watched only once the command had started.
   */
  it("does not start at all when what was waiting for it is killed while it queues", async () => {
    const { path: held } = tryAcquire(dir, 1, record(process.pid));
    const marker = path.join(dir, "ran");
    const write = 'require("fs").writeFileSync(process.argv[1], "ran")';
    const shell = spawn("sh", ["-c", `"${process.execPath}" "${BOUNDED}" "${process.execPath}" -e '${write}' "${marker}"; true`], {
      env: cleanEnv(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    spawned.push(shell.pid);
    let err = "";
    shell.stderr.on("data", chunk => (err += chunk));
    await waitUntil(() => /waiting for the heavy slot/.test(err), 5000);

    process.kill(shell.pid, "SIGKILL");

    expect(await waitUntil(() => /is gone — not starting/.test(err), 5000)).toBe(true);
    release(held, process.pid);
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(existsSync(marker)).toBe(false);
  });

  /*
   * 🔴 The failure this exists for: an agent's harness kills the `git push` it
   * launched, and the hook's turbo and Vitest ran on with nobody waiting.
   * SIGKILL is what cannot be forwarded, so it is the case that matters.
   */
  it("stops everything the run started when the process that started it is killed", async () => {
    const child = runBounded(WITH_GRANDCHILD);
    const grandchild = await grandchildOf(child);
    expect(isGone({ pid: grandchild, start: null })).toBe(false);

    process.kill(child.pid, "SIGKILL");

    expect(await waitUntil(() => isGone({ pid: grandchild, start: null }), 10_000)).toBe(true);
  });

  /*
   * 🔴 turbo starts every task in a process group of its own, inside the run's
   * session, so a signal to the run's group reaches turbo alone. A killed push
   * took fifteen seconds to stop that way — most of it a build nobody was
   * waiting for, running on after turbo died.
   */
  it.runIf(process.platform === "linux" && HAS_PERL)(
    "stops a task that turbo would have put in a group of its own",
    async () => {
      const child = runBounded([
        process.execPath,
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          'const c = spawn("perl", ["-e", "setpgrp(0, 0); sleep 60"], { stdio: "ignore" });',
          "console.log(c.pid);",
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ]);
      const task = await grandchildOf(child);
      expect(await waitUntil(() => groupOf(task) === task, 5000)).toBe(true);

      process.kill(child.pid, "SIGKILL");

      expect(await waitUntil(() => isGone({ pid: task, start: null }), 10_000)).toBe(true);
    }
  );

  /*
   * 🔴 The leader signalled its own group first, and it is in that group, so
   * its SIGKILL ended it before it reached a task turbo had put in a group of
   * its own. A task that ignored the polite signal survived the kill.
   */
  it.runIf(LINUX && HAS_PERL)(
    "kills a task in a group of its own that ignores the polite signal",
    async () => {
      const child = runBounded([
        process.execPath,
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          `const c = spawn("perl", ["-e", "$SIG{TERM} = 'IGNORE'; setpgrp(0, 0); sleep 60"], { stdio: "ignore" });`,
          "console.log(c.pid);",
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ]);
      const task = await grandchildOf(child);
      expect(await waitUntil(() => groupOf(task) === task, 5000)).toBe(true);

      process.kill(child.pid, "SIGKILL");

      expect(await waitUntil(() => isGone({ pid: task, start: null }), 12_000)).toBe(true);
    },
    20_000
  );

  it("stops it when a process further up is killed, as a push two levels above a hook is", async () => {
    // `; true` keeps the shell as a separate parent rather than letting it
    // replace itself with the command.
    const shell = spawn("sh", ["-c", `"${process.execPath}" "${BOUNDED}" ${WITH_GRANDCHILD.map(a => `'${a}'`).join(" ")}; true`], {
      env: cleanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    spawned.push(shell.pid);
    const out = { out: "" };
    shell.stdout.on("data", chunk => (out.out += chunk));
    const grandchild = await grandchildOf(out);

    process.kill(shell.pid, "SIGKILL");

    expect(await waitUntil(() => isGone({ pid: grandchild, start: null }), 10_000)).toBe(true);
  });

  it("does not leave the slot held by a run that was killed", async () => {
    const child = runBounded(WITH_GRANDCHILD);
    const grandchild = await grandchildOf(child);
    process.kill(child.pid, "SIGKILL");
    await waitUntil(() => isGone({ pid: grandchild, start: null }), 10_000);

    const slot = path.join(dir, "slot-0.json");
    const { leader } = JSON.parse(readFileSync(slot, "utf8"));
    await waitUntil(() => isGone({ pid: leader, start: null }), 10_000);
    expect(tryAcquire(dir, 1, record(process.pid)).path).toBe(slot);
  });

  /*
   * A command can exit and leave something running — a worker it did not wait
   * for, a server it forgot. That process is in the run's group, and nothing
   * else would ever stop it.
   */
  it("takes down what the command left running when it exits", async () => {
    const child = runBounded([
      process.execPath,
      "-e",
      [
        'const { spawn } = require("node:child_process");',
        'const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        "c.unref();",
        "console.log(c.pid);",
      ].join(" "),
    ]);
    const leftBehind = await grandchildOf(child);

    expect((await child.done).code).toBe(0);
    expect(await waitUntil(() => isGone({ pid: leftBehind, start: null }), 5000)).toBe(true);
  });

  /*
   * A run that ignores Ctrl-C is told to stop after the grace period, and the
   * leader — the one process that can find all of the run on every platform —
   * takes it down.
   */
  it("stops a run that ignores Ctrl-C once the grace period is over", async () => {
    const child = runBounded([
      process.execPath,
      "-e",
      'process.on("SIGINT", () => {}); console.log(process.pid); setInterval(() => {}, 1000);',
    ]);
    const command = await grandchildOf(child);

    process.kill(child.pid, "SIGINT");

    const started = Date.now();
    expect(await waitUntil(() => isGone({ pid: command, start: null }), 8000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(8000);
    expect((await child.done).code).toBe(143);
  }, 15_000);

  it("passes Ctrl-C on to the run, whose group the terminal does not reach", async () => {
    const child = runBounded(WITH_GRANDCHILD);
    const grandchild = await grandchildOf(child);

    process.kill(child.pid, "SIGINT");

    expect((await child.done).code).toBe(130);
    expect(await waitUntil(() => isGone({ pid: grandchild, start: null }), 5000)).toBe(true);
  });
});
