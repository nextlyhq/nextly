/**
 * One load per key in flight: callers asking for a key whose load is under
 * way are handed that load; a failure reaches every one of them and is never
 * kept.
 */
import { describe, expect, it } from "vitest";

import { coalesce } from "../coalesce";

/** A load held open until `settle` or `fail`, counting how often it started. */
function held<T>(): {
  load: () => Promise<T>;
  settle: (value: T) => void;
  fail: (error: Error) => void;
  starts: () => number;
} {
  let starts = 0;
  const pending: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }> = [];
  return {
    load: () => {
      starts += 1;
      return new Promise<T>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    settle: value => pending.shift()?.resolve(value),
    fail: error => pending.shift()?.reject(error),
    starts: () => starts,
  };
}

describe("coalesce", () => {
  it("starts one load for every caller of a key while it runs", async () => {
    const inFlight = new Map<string, Promise<number>>();
    const source = held<number>();
    const callers = Array.from({ length: 16 }, () =>
      coalesce(inFlight, "a", source.load)
    );
    expect(source.starts()).toBe(1);

    source.settle(1);
    expect(await Promise.all(callers)).toEqual(Array(16).fill(1));
  });

  it("starts a load of its own for each key", async () => {
    const inFlight = new Map<string, Promise<string>>();
    const source = held<string>();
    const a = coalesce(inFlight, "a", source.load);
    const b = coalesce(inFlight, "b", source.load);
    expect(source.starts()).toBe(2);
    source.settle("for a");
    source.settle("for b");
    expect([await a, await b]).toEqual(["for a", "for b"]);
  });

  it("keeps nothing once the load settles: the next caller loads again", async () => {
    const inFlight = new Map<string, Promise<number>>();
    const source = held<number>();
    const first = coalesce(inFlight, "a", source.load);
    source.settle(1);
    await first;
    expect(inFlight.size).toBe(0);

    const second = coalesce(inFlight, "a", source.load);
    expect(source.starts()).toBe(2);
    source.settle(2);
    expect(await second).toBe(2);
  });

  it("rejects every caller of a failed load, and loads again for the next", async () => {
    const inFlight = new Map<string, Promise<number>>();
    const source = held<number>();
    const callers = [
      coalesce(inFlight, "a", source.load),
      coalesce(inFlight, "a", source.load),
    ];
    source.fail(new Error("refused"));
    for (const caller of callers) {
      await expect(caller).rejects.toThrow("refused");
    }
    expect(inFlight.size).toBe(0);

    const next = coalesce(inFlight, "a", source.load);
    expect(source.starts()).toBe(2);
    source.settle(3);
    expect(await next).toBe(3);
  });

  it("rejects a load that throws rather than rejecting, and keeps nothing", async () => {
    const inFlight = new Map<string, Promise<number>>();
    await expect(
      coalesce(inFlight, "a", () => {
        throw new Error("no load");
      })
    ).rejects.toThrow("no load");
    expect(inFlight.size).toBe(0);
  });
});
