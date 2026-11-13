/**
 * The stored schema version's readings survive a dev server's module reload
 * on `globalThis`, so a reading kept by an older build of this module is
 * still there when the new one runs. The new module must not read that
 * older shape as its own: before the readings moved onto the shared followed
 * value, each database's reading held its read under way as a promise or
 * null (`inFlight`), where the followed value holds a map, and a dev server
 * that reloaded across the change threw on every request until restarted.
 */
import { afterEach, describe, expect, it } from "vitest";

import { storedSchemaSeq } from "../stored-schema-seq";

const holder = globalThis as unknown as Record<string, unknown>;
const LEGACY_KEY = "__nextly_storedSchemaSeq";

/** A database handle whose stored count reads `seq` through the real reader. */
function databaseAt(seq: number) {
  const drizzle = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { value: JSON.stringify({ migration: null, seq }) },
          ],
        }),
      }),
    }),
  };
  return {
    getDrizzle: () => drizzle,
    getCapabilities: () => ({ dialect: "sqlite" }),
  };
}

let previous: unknown;
afterEach(() => {
  if (previous === undefined) delete holder[LEGACY_KEY];
  else holder[LEGACY_KEY] = previous;
});

describe("the stored schema version across a module reload", () => {
  it("reads past a reading an older build of the module left on globalThis", async () => {
    previous = holder[LEGACY_KEY];
    const database = databaseAt(7);
    // What the module kept before its readings moved onto the followed
    // value: one reading per database, its read under way a promise or null.
    const legacy = new WeakMap<object, unknown>();
    legacy.set(database, {
      seq: 3,
      readAt: undefined,
      marks: -1,
      inFlight: null,
      inFlightMarks: -1,
    });
    holder[LEGACY_KEY] = { marks: 0, byDatabase: legacy };

    await expect(storedSchemaSeq(database, { fresh: true })).resolves.toBe(7);
    await expect(storedSchemaSeq(database)).resolves.toBe(7);
  });
});
