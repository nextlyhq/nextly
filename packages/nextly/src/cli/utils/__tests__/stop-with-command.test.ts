/**
 * What watching a process a command started leaves behind, and whom it
 * signals. That the process and what it started are stopped is read end to end
 * in `commands/__tests__/stopped-command-stops-its-package-manager.test.ts`.
 *
 * What would separate a correct watch from a broken one:
 * - a listener left once the processes have ended, or one for each of them;
 * - a run nobody stopped taken for one that was;
 * - a signal sent to a group whose number another process has been given;
 * - one that came before the process was there, lost;
 * - a process at the terminal told twice of one Ctrl+C;
 * - a run taken for one nobody stopped, its end read before the signal;
 * - a group of which only zombies are left taken for one that runs.
 *
 * POSIX only: the groups and signals are.
 */
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  holdingSignals,
  livingIn,
  stopWithCommand,
} from "../stop-with-command";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

const started: ChildProcess[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const child of started.splice(0)) child.kill("SIGKILL");
});

/** A process that ends after `ms`, in a group of its own. */
function runsFor(ms: number): ChildProcess {
  const child = spawn(
    process.execPath,
    ["-e", `setTimeout(() => {}, ${String(ms)})`],
    { detached: true, stdio: "ignore" }
  );
  started.push(child);
  return child;
}

const counts = () => SIGNALS.map(signal => process.listenerCount(signal));
const closed = (child: ChildProcess) =>
  new Promise(resolve => child.once("close", resolve));

/** The listener added for SIGTERM since `before`, called as the signal would. */
function newListener(before: readonly unknown[]): (signal: string) => void {
  const added = process.listeners("SIGTERM").filter(l => !before.includes(l));
  expect(added).toHaveLength(1);
  return added[0] as (signal: string) => void;
}

describe.skipIf(process.platform === "win32")("a process watched", () => {
  it("is listened for once, however many there are, and not at all once they have ended", async () => {
    const before = counts();
    const children = [1, 2, 3].map(() => runsFor(200));
    const watched = children.map(child =>
      stopWithCommand(child, { name: "npm", group: true })
    );
    expect(counts()).toEqual(before.map(count => count + 1));

    await Promise.all(children.map(closed));
    const asked = await Promise.all(watched.map(each => each.ended()));

    // None of them was asked to stop.
    expect(asked).toEqual([false, false, false]);
    expect(counts()).toEqual(before);
  }, 20_000);

  it("is asked to stop on a signal, and said to have been", async () => {
    const before = process.listeners("SIGTERM");
    const child = runsFor(60_000);
    const watched = stopWithCommand(child, { name: "npm", group: true });

    newListener(before)("SIGTERM");

    await closed(child);
    expect(await watched.ended()).toBe(true);
    expect(process.listeners("SIGTERM")).toEqual(before);
  }, 20_000);

  it("is not signalled by a number another process has been given", async () => {
    const before = process.listeners("SIGTERM");
    const another = runsFor(60_000);
    const kill = vi.spyOn(process, "kill");
    // A process read as ended, whose number `another` leads a group by now.
    const ended = {
      pid: another.pid,
      exitCode: 0,
      signalCode: null,
      stdout: null,
      stderr: null,
    } as unknown as ChildProcess;
    const watched = stopWithCommand(ended, { name: "npm", group: true });
    const signal = newListener(before);

    signal("SIGTERM");
    signal("SIGTERM");

    expect(await watched.ended()).toBe(true);
    // Asked about, which signal 0 does, and nothing more.
    expect(kill.mock.calls.filter(([, sent]) => sent !== 0)).toEqual([]);
    expect(kill.mock.calls.length).toBeGreaterThan(0);
    expect(another.exitCode ?? another.signalCode).toBeNull();
  }, 20_000);

  it("was stopped where its end is read before the signal that ended it", async () => {
    const before = process.listeners("SIGTERM");
    // As a Ctrl+C at a terminal ends it, with the command still to hear of it.
    const ended = {
      pid: undefined,
      exitCode: null,
      signalCode: "SIGINT",
      kill: () => false,
    } as unknown as ChildProcess;
    const watched = stopWithCommand(ended, { name: "npm", group: false });
    const signal = newListener(before);

    const asked = watched.ended();
    setTimeout(() => signal("SIGINT"), 20);

    expect(await asked).toBe(true);
  });

  it("is not waited for where it ended well", async () => {
    const before = counts();
    const ended = { exitCode: 0, signalCode: null } as unknown as ChildProcess;
    const watched = stopWithCommand(ended, { name: "npm", group: false });
    const at = Date.now();

    expect(await watched.ended()).toBe(false);
    expect(Date.now() - at).toBeLessThan(50);
    expect(counts()).toEqual(before);
  });

  it("is asked to stop at once where the signal came before it was there", async () => {
    const before = process.listeners("SIGTERM");
    const asked = await holdingSignals(async () => {
      newListener(before)("SIGTERM");
      const child = runsFor(60_000);
      const watched = stopWithCommand(child, { name: "npm", group: true });
      await closed(child);
      return watched.ended();
    });
    expect(asked).toBe(true);
    expect(process.listeners("SIGTERM")).toEqual(before);
  }, 20_000);

  it("is not told of a Ctrl+C the terminal has told it of itself, only of what it has not", async () => {
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    try {
      const told = (isTTY: boolean, signal: string) => {
        Object.defineProperty(process.stdin, "isTTY", {
          value: isTTY,
          configurable: true,
        });
        const before = process.listeners("SIGTERM");
        const kill = vi.fn();
        const child = {
          // No number: a fake process must name none that is there.
          pid: undefined,
          kill,
          exitCode: 0,
          signalCode: null,
        };
        const watched = stopWithCommand(child as unknown as ChildProcess, {
          name: "npm",
          group: false,
        });
        newListener(before)(signal);
        return watched.ended().then(() => kill.mock.calls.flat());
      };
      expect(await told(true, "SIGINT")).toEqual([]);
      expect(await told(true, "SIGTERM")).toEqual(["SIGTERM"]);
      expect(await told(true, "SIGHUP")).toEqual(["SIGHUP"]);
      expect(await told(false, "SIGINT")).toEqual(["SIGINT"]);
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
});

describe("the group a process's record names it in", () => {
  it("is read past a name that holds brackets and spaces", () => {
    expect(livingIn("12 (a) b (c) S 1 99 99 0")).toBe(99);
    expect(livingIn("12 (sleep) R 1 7 7 0")).toBe(7);
  });

  it("is none for one that has ended and only waits to be read", () => {
    expect(livingIn("12 (sleep) Z 1 99 99 0")).toBeUndefined();
    expect(livingIn("12 (sleep) X 1 99 99 0")).toBeUndefined();
  });

  it("is none where there is no record", () => {
    expect(livingIn("")).toBeUndefined();
  });
});
