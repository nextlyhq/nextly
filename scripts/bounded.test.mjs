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
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isAlive,
  isGone,
  release,
  slotCount,
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
  const {
    CI: _ci,
    NEXTLY_BOUNDED: _nested,
    TURBO_CONCURRENCY: _concurrency,
    TURBO_UI: _ui,
    ...env
  } = process.env;
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

  it("gives back only its own slot", () => {
    const { path: slot } = tryAcquire(dir, 1, record(process.pid));
    release(slot, deadPid());
    expect(existsSync(slot)).toBe(true);
    release(slot, process.pid);
    expect(existsSync(slot)).toBe(false);
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
   * would read as waiting. The shell here backgrounds a child that exits at
   * once, then becomes `sleep`, which never collects it.
   */
  it.runIf(process.platform === "linux")("reads an exited process its parent has not collected as gone", async () => {
    const parent = spawn("sh", ["-c", "(exit 0) & echo $!; exec sleep 5"], { stdio: ["ignore", "pipe", "ignore"] });
    spawned.push(parent.pid);
    const out = { out: "" };
    parent.stdout.on("data", chunk => (out.out += chunk));
    await waitUntil(() => /^\d+\n/.test(out.out), 5000);
    const zombie = Number(out.out.split("\n")[0]);
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(isAlive(zombie)).toBe(true);
    expect(isGone({ pid: zombie, start: null })).toBe(true);
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
    expect(child.err).toMatch(/waiting for the heavy slot — pid \d+ since .*: turbo run lint, in \/checkouts\/nextly-a/);

    release(held, process.pid);
    expect((await child.done).code).toBe(0);
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

  it("passes Ctrl-C on to the run, whose group the terminal does not reach", async () => {
    const child = runBounded(WITH_GRANDCHILD);
    const grandchild = await grandchildOf(child);

    process.kill(child.pid, "SIGINT");

    expect((await child.done).code).toBe(130);
    expect(await waitUntil(() => isGone({ pid: grandchild, start: null }), 5000)).toBe(true);
  });
});
