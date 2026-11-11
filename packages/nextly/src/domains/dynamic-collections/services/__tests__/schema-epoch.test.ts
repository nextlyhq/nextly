/**
 * The schema epoch as one cache watches it: a move another instance made is reported once, a read
 * is reused for the epoch interval, and a database with no epoch (or no table for one) never
 * reads as moved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCHEMA_EPOCH_TTL_MS,
  SchemaEpochWatch,
  bumpSchemaEpoch,
} from "../schema-epoch";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A reader over one stored value, counting its reads; `undefined` stores no row. */
function storedEpoch(initial: unknown) {
  const state = { value: initial, reads: 0 };
  const reader = {
    select: vi.fn(async () => {
      state.reads += 1;
      return state.value === undefined ? [] : [{ value: state.value }];
    }),
  };
  return { state, reader: reader as never };
}

/** Moves the clock on past the epoch interval. */
function later(now: { at: number }): void {
  now.at += SCHEMA_EPOCH_TTL_MS + 1;
}

function frozenClock(): { at: number } {
  const now = { at: 1_000_000 };
  vi.spyOn(Date, "now").mockImplementation(() => now.at);
  return now;
}

describe("SchemaEpochWatch", () => {
  it("reports a move once, on the first look after the interval", async () => {
    const now = frozenClock();
    const { state, reader } = storedEpoch(JSON.stringify("first"));
    const watch = new SchemaEpochWatch();

    // The first look records the epoch: nothing was cached under an earlier one.
    expect(await watch.moved(reader)).toBe(false);
    state.value = JSON.stringify("second");
    // Within the interval the earlier read stands.
    expect(await watch.moved(reader)).toBe(false);
    expect(state.reads).toBe(1);

    later(now);
    expect(await watch.moved(reader)).toBe(true);
    later(now);
    expect(await watch.moved(reader)).toBe(false);
  });

  it("reads a generation MySQL encoded twice as the same generation", async () => {
    const now = frozenClock();
    const { state, reader } = storedEpoch(JSON.stringify("same"));
    const watch = new SchemaEpochWatch();
    await watch.moved(reader);

    state.value = JSON.stringify(JSON.stringify("same"));
    later(now);
    expect(await watch.moved(reader)).toBe(false);
  });

  it("reports the first epoch written where there was none", async () => {
    const now = frozenClock();
    const { state, reader } = storedEpoch(undefined);
    const watch = new SchemaEpochWatch();
    expect(await watch.moved(reader)).toBe(false);

    state.value = JSON.stringify("first");
    later(now);
    expect(await watch.moved(reader)).toBe(true);
  });

  it("never reads as moved where the table cannot be read", async () => {
    const now = frozenClock();
    const reader = {
      select: vi.fn(async () => {
        throw new Error("no such table: nextly_meta");
      }),
    } as never;
    const watch = new SchemaEpochWatch();
    expect(await watch.moved(reader)).toBe(false);
    later(now);
    expect(await watch.moved(reader)).toBe(false);
  });

  it("shares one read between the callers that ask at once", async () => {
    frozenClock();
    const { state, reader } = storedEpoch(JSON.stringify("first"));
    const watch = new SchemaEpochWatch();
    await Promise.all([watch.moved(reader), watch.moved(reader)]);
    expect(state.reads).toBe(1);
  });
});

describe("bumpSchemaEpoch", () => {
  it("writes a new generation each time, replacing the one stored", async () => {
    const upsert = vi.fn(async () => null);
    await bumpSchemaEpoch({ upsert } as never);
    await bumpSchemaEpoch({ upsert } as never);

    const calls = upsert.mock.calls as unknown as Array<
      [string, { key: string; value: string }, { conflictColumns: string[] }]
    >;
    expect(calls.map(([table]) => table)).toEqual([
      "nextly_meta",
      "nextly_meta",
    ]);
    expect(calls[0][1].key).toBe("schema-epoch");
    expect(calls[0][2].conflictColumns).toEqual(["key"]);
    expect(calls[0][1].value).not.toBe(calls[1][1].value);
  });
});
