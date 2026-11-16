/**
 * What a production start compares its build with is the stored version as this process last read
 * it (`latestStoredSchemaVersion`), not a second read of the same row: but never one a change made
 * since could have left behind.
 *
 * A start reads the version before it loads its definitions, and again where boot migrations
 * stored a new one; the comparison takes the newest of those. A change this process marks after a
 * read began (its own registry write, or the boot migrations storing a version) makes that read
 * one the comparison must not use, so it is answered undefined and the comparison reads the row.
 *
 * The handle is read through the real reader, its stored row held in a variable the test moves, and
 * its read held open where a case needs a change to land while it runs.
 */
import { describe, expect, it } from "vitest";

import {
  latestStoredSchemaVersion,
  markSchemaChanged,
  storedSchemaSeq,
} from "../stored-schema-seq";

/** A database handle whose stored row is `row.version`, its reads held while `row.hold` is set. */
function database(migration: string, seq: number) {
  const row: {
    version: { migration: string; seq: number };
    hold?: Promise<void>;
  } = { version: { migration, seq } };
  const drizzle = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const read = JSON.stringify(row.version);
            await row.hold;
            return [{ value: read }];
          },
        }),
      }),
    }),
  };
  return {
    row,
    handle: {
      getDrizzle: () => drizzle,
      getCapabilities: () => ({ dialect: "sqlite" }),
    },
  };
}

describe("the stored version a start compares with", () => {
  it("is the whole row the last read found, migration and count", async () => {
    const { handle } = database("20260101_000000_000_first", 4);

    expect(latestStoredSchemaVersion(handle)).toBeUndefined();
    await storedSchemaSeq(handle, { fresh: true });

    expect(latestStoredSchemaVersion(handle)).toEqual({
      present: true,
      version: { migration: "20260101_000000_000_first", seq: 4 },
    });
  });

  it("is the newer row once a later read found one", async () => {
    const { row, handle } = database("20260101_000000_000_first", 4);
    await storedSchemaSeq(handle, { fresh: true });

    // Boot migrations stored a new version, and the reload after them read it.
    row.version = { migration: "20260102_000000_000_second", seq: 5 };
    await storedSchemaSeq(handle, { fresh: true });

    expect(latestStoredSchemaVersion(handle)).toEqual({
      present: true,
      version: { migration: "20260102_000000_000_second", seq: 5 },
    });
  });

  it("is none once this process marked a change after the read", async () => {
    const { handle } = database("20260101_000000_000_first", 4);
    await storedSchemaSeq(handle, { fresh: true });

    markSchemaChanged();

    expect(latestStoredSchemaVersion(handle)).toBeUndefined();
  });

  it("is none where a change was marked while the read ran", async () => {
    const { row, handle } = database("20260101_000000_000_first", 4);
    let release: () => void = () => undefined;
    row.hold = new Promise<void>(resolve => {
      release = resolve;
    });

    const reading = storedSchemaSeq(handle, { fresh: true });
    // The read has taken the row as it stood; a change lands before it answers.
    await Promise.resolve();
    markSchemaChanged();
    release();
    await reading;

    expect(latestStoredSchemaVersion(handle)).toBeUndefined();
  });
});
