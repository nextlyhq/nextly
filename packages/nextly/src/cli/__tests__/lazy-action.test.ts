/**
 * A command's action is loaded when the command runs, and the start-up
 * timing can stop a run at the moment it has loaded.
 *
 * With the start-up probe set, the run says its code has loaded, once the
 * action's module is imported, and ends there: the action itself never runs,
 * so a timed run does no work and touches no database. Without it, or with
 * any other value, the action runs as loaded, given every argument.
 *
 * What would separate a correct probe from a broken one:
 * - the line written before the module is imported (a time that measures nothing);
 * - the run ended before the line is out: standard error may be a pipe, whose
 *   writes finish later, and an exit drops what is still pending;
 * - the action run after the line (a timed run that does the command's work);
 * - the run going on after the line, into the program's after-action hooks;
 * - a stopped run exiting 0, as a run that did its work does;
 * - a probe that answers to any value, or that changes a run without it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lazyAction } from "../lazy-action";

// The variable and line the start-up timing script uses, from the one module it loads them from.
import {
  CODE_LOADED_LINE,
  STARTUP_PROBE_ENV,
  STARTUP_PROBE_EXIT,
} from "./helpers/startup-checks";

/** Thrown by the stand-in for `process.exit`, so the run stops where it would. */
class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

let kept: string | undefined;
let written: string[];
let events: string[];

beforeEach(() => {
  kept = process.env[STARTUP_PROBE_ENV];
  delete process.env[STARTUP_PROBE_ENV];
  written = [];
  events = [];
  // Like a pipe: the write is taken now and finishes on a later turn, when
  // its callback runs.
  vi.spyOn(process.stderr, "write").mockImplementation(
    (chunk: unknown, ...rest: unknown[]) => {
      written.push(String(chunk));
      events.push("line");
      const done = rest.find(each => typeof each === "function");
      setTimeout(() => {
        events.push("written");
        if (typeof done === "function") done();
      }, 0);
      return true;
    }
  );
  vi.spyOn(process, "exit").mockImplementation(code => {
    events.push("exit");
    throw new Exited(code === undefined ? undefined : Number(code));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (kept === undefined) delete process.env[STARTUP_PROBE_ENV];
  else process.env[STARTUP_PROBE_ENV] = kept;
});

/** An action whose module load and call are recorded in order with the run's other events. */
function recordedAction() {
  const action = vi.fn((..._args: unknown[]) => {
    events.push("run");
  });
  const load = vi.fn(async () => {
    events.push("loaded");
    return action;
  });
  return { action, load, handler: lazyAction(load) };
}

describe("lazyAction", () => {
  it("loads the action when the command runs and gives it every argument", async () => {
    const { action, load, handler } = recordedAction();
    expect(load).not.toHaveBeenCalled();

    await handler("a", { dryRun: true });

    expect(action).toHaveBeenCalledWith("a", { dryRun: true });
    expect(events).toEqual(["loaded", "run"]);
    expect(written).toEqual([]);
  });

  it("under the start-up probe, says the code has loaded and ends the run with its own code, without running it", async () => {
    process.env[STARTUP_PROBE_ENV] = "loaded";
    const { action, handler } = recordedAction();

    const ended = await handler("a").catch((error: unknown) => error);

    expect(ended).toBeInstanceOf(Exited);
    // Its own code, which no command exits with otherwise (exit-codes.test.ts).
    expect((ended as Exited).code).toBe(STARTUP_PROBE_EXIT);
    expect(STARTUP_PROBE_EXIT).toBe(4);
    expect(action).not.toHaveBeenCalled();
    // The line comes once the module is imported, and the run ends once it is out.
    expect(events).toEqual(["loaded", "line", "written", "exit"]);
    expect(written).toEqual([`${CODE_LOADED_LINE}\n`]);
  });

  it("runs the action as usual under any other value of the probe", async () => {
    process.env[STARTUP_PROBE_ENV] = "1";
    const { action, handler } = recordedAction();

    await handler();

    expect(action).toHaveBeenCalledOnce();
    expect(written).toEqual([]);
  });
});
