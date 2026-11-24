/**
 * A process a command started, stopped when the command is.
 *
 * While one runs, Ctrl+C, a request to end and a closed terminal (SIGINT,
 * SIGTERM, SIGHUP) ask it to stop, and its end is waited for, so nothing goes
 * on changing the project once the command has ended. One that does not end
 * within `STOP_GRACE_MS` is ended, and at once on a second signal. A command
 * that is itself killed (SIGKILL) cannot do any of this, and on Windows, which
 * has no process groups, what a process started may go on after it.
 *
 * @module cli/utils/stop-with-command
 */
import type { ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

/** How long a process asked to stop has to end. */
const STOP_GRACE_MS = 10_000;
/**
 * How long after the first signal another is taken for the same one: a Ctrl+C
 * comes from the terminal, and again from an npx or npm that passes it on.
 */
const SAME_SIGNAL_MS = 500;
/** How long one takes before the operator is told what is being waited for. */
const SAY_WAITING_MS = 1000;
/** How long one that was ended has to be gone, which it normally is at once. */
const GONE_MS = 2000;
/** How often a group is asked whether any of it is left. */
const ASK_AGAIN_MS = 100;

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** A process being watched. */
export interface Watched {
  /**
   * Resolves, once the process has closed, when all that was started with it
   * has ended too, with whether it was asked to stop.
   */
  ended(): Promise<boolean>;
}

interface Running {
  signalled(signal: NodeJS.Signals): void;
}

/** Every process watched now, under one set of listeners however many there are. */
const running = new Set<Running>();

/** How many pieces of work hold the signals now (`holdingSignals`), and the one held. */
let holders = 0;
let held: NodeJS.Signals | undefined;

const onSignal = (signal: NodeJS.Signals): void => {
  if (running.size === 0) held ??= signal;
  for (const each of running) each.signalled(signal);
};

/** Makes `change`, listening while anything is watched or held, however much is. */
function listen(change: () => void): void {
  const before = running.size + holders;
  change();
  const after = running.size + holders;
  if (before === 0 && after > 0) {
    for (const s of SIGNALS) process.on(s, onSignal);
  }
  if (before > 0 && after === 0) {
    held = undefined;
    for (const s of SIGNALS) process.off(s, onSignal);
  }
}

/**
 * Runs `work` with the signals held: one that comes while no process is
 * watched, such as before the first has started, stops the next as it starts
 * rather than ending the command half way through a change.
 */
export async function holdingSignals<T>(work: () => Promise<T>): Promise<T> {
  listen(() => {
    holders += 1;
  });
  try {
    return await work();
  } finally {
    listen(() => {
      holders -= 1;
    });
  }
}

/** The group a living process is in, by its record in `/proc`; none for one that has ended. */
export function livingIn(record: string): number | undefined {
  // The name, in brackets, may hold any character; what follows it does not.
  const [state, , group] = record.slice(record.lastIndexOf(")") + 2).split(" ");
  return state === "Z" || state === "X" || group === undefined
    ? undefined
    : Number(group);
}

/** The record of process `id`, or nothing where there is none. */
function recordOf(id: string): string {
  try {
    return readFileSync(`/proc/${id}/stat`, "utf8");
  } catch {
    return "";
  }
}

/**
 * Whether any of group `id` runs. A process that has ended answers a signal
 * until its parent reads it, which in a container may be never, so where the
 * system says what each process does it is asked that.
 */
function groupRuns(id: number): boolean {
  if (!answers(-id)) return false;
  if (process.platform !== "linux") return true;
  try {
    return readdirSync("/proc").some(
      name => /^\d+$/.test(name) && livingIn(recordOf(name)) === id
    );
  } catch {
    return true;
  }
}

const ignore = (): void => {};

/** What is said from here on may be read by nobody, as on a closed terminal: that ends nothing. */
function writeWhoeverReads(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.off("error", ignore);
    stream.on("error", ignore);
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Whether any process answers to `id`: a process, or a group where negative. */
function answers(id: number): boolean {
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    // Refused is an answer: something is there that is not ours to signal.
    return (error as { code?: unknown }).code === "EPERM";
  }
}

/**
 * Whether the group `child` leads is still there, and still that group. Until
 * its leader has been read as ended, its number is its own. After that the
 * number stays taken while any of the group is left; a process that answers
 * to it by itself is another, given it since.
 */
function groupRemains(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (child.exitCode === null && child.signalCode === null) return true;
  return !answers(child.pid) && groupRuns(child.pid);
}

/** Sends `signal` to `child`, or to all of the group it leads while that is there. */
function send(
  child: ChildProcess,
  group: boolean,
  signal: NodeJS.Signals
): void {
  if (!group) {
    child.kill(signal);
    return;
  }
  if (child.pid === undefined || !groupRemains(child)) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Gone between the question and the signal.
  }
}

/**
 * Stops `child` when this process is told to stop. `group` says it leads a
 * process group of its own (started `detached`), all of which is stopped; one
 * that shares the terminal is passed the signal itself.
 */
export function stopWithCommand(
  child: ChildProcess,
  { name, group }: { name: string; group: boolean }
): Watched {
  let askedAt = 0;
  let endedByUs = 0;
  const timers: NodeJS.Timeout[] = [];

  const end = (): void => {
    if (endedByUs === 0) endedByUs = Date.now();
    send(child, group, "SIGKILL");
    if (!group) return;
    // What was started with it may hold these open, and its close waits on
    // them. The whole group has been ended here; without one, the wait for
    // these is the only sign that what it started has ended too.
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  const each: Running = {
    signalled(signal) {
      if (askedAt > 0) {
        if (Date.now() - askedAt > SAME_SIGNAL_MS) end();
        return;
      }
      askedAt = Date.now();
      writeWhoeverReads();
      timers.push(
        setTimeout(() => {
          process.stderr.write(
            `\nWaiting for ${name} to stop. Press Ctrl+C again to end it at once.\n`
          );
        }, SAY_WAITING_MS),
        setTimeout(end, STOP_GRACE_MS)
      );
      // A Ctrl+C at a terminal reaches every process there by itself. Told
      // twice, one that is putting its work back would end at once instead.
      if (!group && signal === "SIGINT" && process.stdin.isTTY) return;
      send(child, group, group ? "SIGTERM" : signal);
    },
  };
  listen(() => {
    running.add(each);
  });
  if (held !== undefined) {
    const signal = held;
    held = undefined;
    each.signalled(signal);
  }

  return {
    async ended() {
      // A run nobody stopped owes nothing to what it left in its group.
      while (askedAt > 0 && group && groupRemains(child)) {
        if (endedByUs > 0 && Date.now() - endedByUs > GONE_MS) break;
        await pause(ASK_AGAIN_MS);
      }
      for (const timer of timers) clearTimeout(timer);
      listen(() => {
        running.delete(each);
      });
      return askedAt > 0;
    },
  };
}

/**
 * Ends a command that was stopped, once everything it started has ended: what
 * `unwind` puts back is put back, what it says is said, and the run exits 130.
 */
export async function exitStopped(unwind: () => string): Promise<never> {
  while (running.size > 0) await pause(ASK_AGAIN_MS);
  const said = unwind();
  // Standard error may be a pipe, whose writes finish later, and an exit drops
  // what is still pending: the run ends once the line is out.
  await new Promise<void>(resolve => {
    process.stderr.write(`\nInterrupted: ${said}\n`, () => resolve());
  });
  return process.exit(130);
}
