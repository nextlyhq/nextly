/**
 * Two ways a retention pass fails without anyone finding out.
 *
 * The first is timing. A runner built at boot outlives every hot reload, so an
 * interval copied into the pass when it was constructed keeps its boot-time
 * value forever. Shortening it leaves pruning delayed for hours; lengthening it
 * keeps pruning too often. Both the in-process eligibility clock and the stored
 * gate read that number, so a stale one is wrong in two places at once, and the
 * configuration file says otherwise the whole time.
 *
 * The second is reporting. Everything between a prune and the write path that
 * offered it catches and then logs — and the value being logged is one this
 * code did not create. Reducing an error to `error.message` is a property
 * access on a foreign object, and a getter that throws does so while the
 * argument list is being built: OUTSIDE the guard, which is the one place a
 * guard cannot help. The escape then reaches a caller that only offered a pass
 * out of courtesy.
 */

import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../../../shared/types";
import { RetentionRunner, type RetentionPass } from "../runner";
import { warnQuietly } from "../safe-log";

/** A gate that always grants the turn, so timing is the only variable. */
const alwaysClaims = { claim: async () => true };

function passWith(intervalMs: () => number, ran: string[]): RetentionPass {
  return {
    key: "test.retention.lastPassAt",
    intervalMs,
    run: async () => {
      ran.push("ran");
    },
  };
}

describe("how often a pass is offered", () => {
  it("asks the pass for its interval on every offer", async () => {
    // Not "the interval is correct once" — that a CHANGE is picked up without
    // rebuilding the runner, which is the only thing a hot reload can do.
    const asked: number[] = [];
    let interval = 60_000;
    const ran: string[] = [];
    let clock = 0;

    const runner = new RetentionRunner({
      passes: [
        passWith(() => {
          asked.push(interval);
          return interval;
        }, ran),
      ],
      gate: alwaysClaims,
      now: () => new Date(clock),
    });

    await runner.maybeRun();
    expect(ran).toHaveLength(1);

    // Well inside the old interval, and outside the new one.
    clock = 10_000;
    interval = 5_000;
    await runner.maybeRun();

    expect(ran).toHaveLength(2);
    expect(asked).toEqual([60_000, 5_000]);
  });

  it("still holds a pass off inside its current interval", async () => {
    // The control. A runner that simply ignored the interval would pass the
    // case above by running every time.
    const ran: string[] = [];
    let clock = 0;

    const runner = new RetentionRunner({
      passes: [passWith(() => 60_000, ran)],
      gate: alwaysClaims,
      now: () => new Date(clock),
    });

    await runner.maybeRun();
    clock = 1_000;
    await runner.maybeRun();

    expect(ran).toHaveLength(1);
  });
});

describe("reporting a pass that could not start", () => {
  it("does not reject when the error's message accessor throws", async () => {
    // Contrived to write, and free to defend against. The point is the SHAPE:
    // any coercion of a foreign value performed while building the log call
    // happens outside the guard that is supposed to contain this.
    const hostile = new Error("ignored");
    Object.defineProperty(hostile, "message", {
      configurable: true,
      get() {
        throw new Error("message accessor failed");
      },
    });

    const runner = new RetentionRunner({
      passes: [
        {
          key: "test.retention.lastPassAt",
          intervalMs: () => 1_000,
          run: async () => {
            throw hostile;
          },
        },
      ],
      gate: alwaysClaims,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger,
    });

    await expect(runner.maybeRun()).resolves.toBeUndefined();
  });

  it("does not reject when the interval accessor itself throws", async () => {
    // Reading the interval is now a CALL, and a call is a new way for a pass
    // to fail before its own body runs. It must be inside the containment like
    // everything else.
    const runner = new RetentionRunner({
      passes: [
        {
          key: "test.retention.lastPassAt",
          intervalMs: () => {
            throw new Error("policy read exploded");
          },
          run: async () => undefined,
        },
      ],
      gate: alwaysClaims,
    });

    await expect(runner.maybeRun()).resolves.toBeUndefined();
  });

  it("still reports when the logger works", () => {
    // The control against containment degrading into silence.
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    warnQuietly(logger, "something", { detail: 1 });

    expect(logger.warn).toHaveBeenCalledWith("something", { detail: 1 });
  });
});
