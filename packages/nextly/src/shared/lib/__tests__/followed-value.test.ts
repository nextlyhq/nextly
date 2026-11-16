/**
 * The followed value: an install-wide value read at most once per interval,
 * the read shared by the callers that arrive while it runs, and read again
 * at once after this process marks a change.
 *
 * Each case counts the reads a stub makes. The clock is the real monotonic
 * one, faked through `performance.now` so an interval can pass without a
 * wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  followedState,
  followValue,
  markFollowedChanged,
  type FollowOptions,
  type FollowedState,
} from "../followed-value";

const INTERVAL = 2000;

let now = 1_000_000;
let state: FollowedState<number>;
let database: object;
let name = 0;

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  name += 1;
  state = followedState<number>(`__nextly_followedValueTest${name}`);
  database = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A read that answers each value in turn, counting how often it ran. */
function counted(...values: Array<number | undefined>): {
  read: () => Promise<number | undefined>;
  calls: () => number;
} {
  let calls = 0;
  return {
    read: () => {
      calls += 1;
      return Promise.resolve(values[Math.min(calls, values.length) - 1]);
    },
    calls: () => calls,
  };
}

/** Reads held open until each is settled, in the order they began. */
function held(): {
  read: () => Promise<number | undefined>;
  settle: (value: number) => void;
  fail: (error: Error) => void;
  calls: () => number;
} {
  let calls = 0;
  const pending: Array<{
    resolve: (value: number) => void;
    reject: (error: Error) => void;
  }> = [];
  return {
    read: () => {
      calls += 1;
      return new Promise<number>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    settle: value => pending.shift()?.resolve(value),
    fail: error => pending.shift()?.reject(error),
    calls: () => calls,
  };
}

function follow(
  read: () => Promise<number | undefined>,
  options: Partial<FollowOptions> = {}
): Promise<number | undefined> {
  return followValue(state, database, read, {
    intervalMs: INTERVAL,
    ...options,
  });
}

describe("followValue", () => {
  it("shares one read among callers that arrive while it runs", async () => {
    const source = held();
    const callers = Array.from({ length: 16 }, () => follow(source.read));
    source.settle(7);

    expect(await Promise.all(callers)).toEqual(Array(16).fill(7));
    expect(source.calls()).toBe(1);
  });

  it("reads nothing within the interval, and reads again after it", async () => {
    const source = counted(1, 2);
    expect(await follow(source.read)).toBe(1);

    now += INTERVAL - 1;
    expect(await follow(source.read)).toBe(1);
    expect(source.calls()).toBe(1);

    now += 1;
    expect(await follow(source.read)).toBe(2);
    expect(source.calls()).toBe(2);
  });

  it("times the interval from when the read finished", async () => {
    const source = held();
    const first = follow(source.read);
    now += INTERVAL + 500;
    source.settle(1);
    await first;

    // Begun more than an interval ago, finished just now: still current.
    now += INTERVAL - 1;
    expect(await follow(source.read)).toBe(1);
    expect(source.calls()).toBe(1);
  });

  it("reads again at once after a change is marked", async () => {
    const source = counted(1, 2);
    expect(await follow(source.read)).toBe(1);

    markFollowedChanged(state);

    expect(await follow(source.read)).toBe(2);
    expect(source.calls()).toBe(2);
  });

  it("does not hand a read begun before a mark to a caller after it", async () => {
    const source = held();
    const before = follow(source.read);
    markFollowedChanged(state);
    const after = follow(source.read);

    expect(source.calls()).toBe(2);
    source.settle(1);
    source.settle(2);
    expect(await before).toBe(1);
    expect(await after).toBe(2);
    // The read from before the mark is not what later callers are answered.
    expect(await follow(source.read)).toBe(2);
    expect(source.calls()).toBe(2);
  });

  it("keeps a slow older read from replacing a newer one", async () => {
    const older = held();
    const newer = held();
    const first = follow(older.read);
    const second = follow(newer.read, { alone: true });

    // The newer read finishes first; the older one, finishing late, must
    // not put its value back for another interval.
    newer.settle(2);
    expect(await second).toBe(2);
    older.settle(1);
    expect(await first).toBe(1);

    const after = counted(3);
    expect(await follow(after.read)).toBe(2);
    expect(after.calls()).toBe(0);
  });

  it("joins a read under way for a fresh caller, and reads for one with none", async () => {
    const source = held();
    const first = follow(source.read);
    const fresh = follow(source.read, { fresh: true });
    expect(source.calls()).toBe(1);
    source.settle(1);
    expect(await first).toBe(1);
    expect(await fresh).toBe(1);

    // Within the interval, yet read again: nothing under way to share.
    const again = follow(source.read, { fresh: true });
    expect(source.calls()).toBe(2);
    source.settle(2);
    expect(await again).toBe(2);
  });

  it("never hands a caller reading alone a read begun before it, and keeps what it read", async () => {
    const source = held();
    const first = follow(source.read);
    const alone = follow(source.read, { alone: true });
    expect(source.calls()).toBe(2);

    source.settle(1);
    source.settle(2);
    expect(await first).toBe(1);
    expect(await alone).toBe(2);
    // What the caller reading alone found is kept for everyone.
    expect(await follow(source.read)).toBe(2);
    expect(source.calls()).toBe(2);
  });

  it("rejects every caller that shared a failed read, and keeps nothing", async () => {
    const source = held();
    const callers = [follow(source.read), follow(source.read)];
    source.fail(new Error("unreachable"));

    for (const caller of callers) {
      await expect(caller).rejects.toThrow("unreachable");
    }
    expect(source.calls()).toBe(1);

    // The next caller reads again, at once.
    const next = follow(source.read);
    expect(source.calls()).toBe(2);
    source.settle(3);
    expect(await next).toBe(3);
  });

  it("keeps an unknown answer for the interval, like a value", async () => {
    const source = counted(undefined, 4);
    expect(await follow(source.read)).toBeUndefined();
    expect(await follow(source.read)).toBeUndefined();
    expect(source.calls()).toBe(1);

    now += INTERVAL;
    expect(await follow(source.read)).toBe(4);
  });

  it("reads nothing for a database never read here when asked for a followed value only", async () => {
    const source = counted(5);
    expect(await follow(source.read, { followedOnly: true })).toBeUndefined();
    expect(source.calls()).toBe(0);

    expect(await follow(source.read)).toBe(5);
    expect(await follow(source.read, { followedOnly: true })).toBe(5);
  });

  it("follows each database on its own", async () => {
    const source = counted(1, 2);
    expect(await follow(source.read)).toBe(1);
    database = {};
    expect(await follow(source.read)).toBe(2);
    expect(source.calls()).toBe(2);
  });

  it("is one state per name for every copy of the module", () => {
    expect(followedState(`__nextly_followedValueTest${name}`)).toBe(state);
  });

  it("schedules nothing: it reads only when asked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    const source = counted(1, 2);
    await follow(source.read);
    markFollowedChanged(state);
    await follow(source.read);

    expect(vi.getTimerCount()).toBe(0);
  });
});
