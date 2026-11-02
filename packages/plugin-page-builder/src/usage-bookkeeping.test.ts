/**
 * What the bookkeeping decides before it writes: the fence, and the
 * transaction a health read asks for.
 *
 * Driven through a fake transaction that answers how many rows the fence's
 * update matched, because that count is the whole decision. What the tables
 * then hold on each dialect is the integration suite's
 * (`__tests__/usage-index-trust.integration.test.ts`).
 *
 * @module usage-bookkeeping.test
 */
import type { PluginTransaction } from "@nextlyhq/plugin-sdk/schema";
import { describe, expect, it } from "vitest";

import { isSupersededRun, usageBookkeeping } from "./usage-bookkeeping";

/** A transaction whose every update matches `matched` rows, recording calls. */
function fakeDatabase(matched: number) {
  const calls: string[] = [];
  const opened: unknown[] = [];
  const tx = {
    // Column stubs: the conditions are built, never run.
    table: () => new Proxy({}, { get: () => ({}) }),
    update: (_table: unknown, set: Record<string, unknown>) => ({
      where: async () => {
        calls.push(`update:${Object.keys(set).sort().join(",")}`);
        return matched;
      },
    }),
    insert: async () => {
      calls.push("insert");
    },
    delete: () => ({
      where: async () => {
        calls.push("delete");
        return 0;
      },
    }),
    select: () => ({
      where: () => ({
        first: async () => null,
        all: async () => [],
      }),
    }),
  } as unknown as PluginTransaction;
  const db = {
    transaction: <R>(
      fn: (handle: PluginTransaction) => Promise<R>,
      options?: unknown
    ): Promise<R> => {
      opened.push(options);
      return fn(tx);
    },
  };
  return { db, calls, opened };
}

describe("the fence on a pass's writes", () => {
  it("runs the write while its run is the current one", async () => {
    const { db } = fakeDatabase(1);
    let wrote = false;
    await usageBookkeeping(db, "postgresql").fenced("token-1", async () => {
      wrote = true;
    });
    expect(wrote).toBe(true);
  });

  it("REFUSES the write of a run a newer one replaced, before it runs", async () => {
    // The fault this closes: a pass that started under old bounds landing its
    // rows after the newer run had already walked the document.
    const { db } = fakeDatabase(0);
    let wrote = false;
    const refused = await usageBookkeeping(db, "postgresql")
      .fenced("token-old", async () => {
        wrote = true;
      })
      .catch((error: unknown) => error);

    expect({ superseded: isSupersededRun(refused), wrote }).toEqual({
      superseded: true,
      wrote: false,
    });
  });

  it("REFUSES when the driver cannot say how many rows matched", async () => {
    // A current run and a replaced one look alike then, and writing on a
    // guess is the failure the fence exists to prevent. Not reported as a
    // replaced run, which a pass would end quietly on.
    const { db } = fakeDatabase(-1);
    let wrote = false;
    const refused = await usageBookkeeping(db, "postgresql")
      .fenced("token-1", async () => {
        wrote = true;
      })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(Error);
    expect({ superseded: isSupersededRun(refused), wrote }).toEqual({
      superseded: false,
      wrote: false,
    });
  });

  it("fences a checkpoint the same way, so a replaced run records no cursor", async () => {
    const { db, calls } = fakeDatabase(0);
    const refused = await usageBookkeeping(db, "postgresql")
      .checkpoint("token-old", "scope", "doc-1")
      .catch((error: unknown) => error);

    expect(isSupersededRun(refused)).toBe(true);
    // Only the fence's own update ran; no progress row was touched.
    expect(calls).toEqual(["update:token"]);
  });

  it("is not fooled by an unrelated error", () => {
    expect(isSupersededRun(new Error("the database went away"))).toBe(false);
  });
});

describe("marking the index dirty", () => {
  it("records the mark even before any run has started", async () => {
    // A save can fail before the first backfill pass. `select().first()`
    // answers null here, so the mark arrives as a new run row; that the mark
    // also rotates an existing run's token is the integration suite's case.
    const { db, calls } = fakeDatabase(1);
    await usageBookkeeping(db, "postgresql", () => "token-new").markDirty();
    expect(calls).toEqual(["insert", "delete"]);
  });
});

describe("the read health makes", () => {
  it("asks for ONE snapshot", async () => {
    const { db, opened } = fakeDatabase(1);
    await usageBookkeeping(db, "postgresql").snapshot();
    expect(opened).toEqual([{ isolation: "snapshot" }]);
  });
});
