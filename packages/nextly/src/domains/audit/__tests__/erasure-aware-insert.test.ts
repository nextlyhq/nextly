/**
 * Which account rows an erasure-aware write locks on Postgres and MySQL.
 *
 * Driven with a recording database rather than a real one, because the
 * property is the set of `FOR SHARE` reads issued — a lock nobody needed costs
 * a round trip and contends with the deletion, and nothing in the stored row
 * shows that it was taken.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  insertErasureAware,
  type ErasureAwareDb,
  type ErasureAwareInsert,
} from "../erasure-aware-insert";

const users = pgTable("users", { id: text("id").primaryKey() });
const trail = pgTable("trail", {
  id: text("id").primaryKey(),
  metadata: text("metadata"),
  identityErasedAt: timestamp("identity_erased_at"),
});

/** What `.limit()` hands back: awaitable, or lockable with `.for()`. */
type AccountQuery = ReturnType<
  ReturnType<
    ReturnType<ReturnType<ErasureAwareDb["select"]>["from"]>["where"]
  >["limit"]
>;

/**
 * A database holding the accounts `existing`, recording each account read and
 * whether it was locked, and the row inserted.
 */
function recordingDb(existing: string[]) {
  const reads: { locked: boolean }[] = [];
  const inserted: Record<string, unknown>[] = [];
  const db: ErasureAwareDb = {
    insert: () => ({
      values: async data => {
        inserted.push(data as Record<string, unknown>);
      },
    }),
    select: () => ({
      from: () => ({
        where: condition => ({
          limit: () => {
            // The id the read asks for is the one bound parameter of `eq`.
            const chunks = (condition as { queryChunks: unknown[] })
              .queryChunks;
            const id = chunks
              .map(chunk => (chunk as { value?: unknown }).value)
              .find(value => typeof value === "string");
            const rows = existing.includes(id as string) ? [{ id }] : [];
            const read = (locked: boolean) => {
              reads.push({ locked });
              return Promise.resolve(rows);
            };
            // Lazy, as Drizzle's builders are: awaiting it reads unlocked,
            // `.for("share")` reads locked, and neither happens before.
            const query = {
              then: <T>(
                resolve: (value: Record<string, unknown>[]) => T,
                reject: (reason: unknown) => T
              ) => read(false).then(resolve, reject),
              for: () => read(true),
            };
            return query as unknown as AccountQuery;
          },
        }),
      }),
    }),
  };
  return { db, reads, inserted };
}

function input(extra: Partial<ErasureAwareInsert>): ErasureAwareInsert {
  return {
    table: trail,
    users,
    row: { id: "row-1" },
    actorUserId: "actor",
    ...extra,
  };
}

describe("the locks an erasure-aware write takes on Postgres", () => {
  it("locks only the actor when no column names either party", async () => {
    // A core row with a target has nothing the target's deletion clears, so
    // locking the target only waited on a deletion for no reason.
    const { db, reads } = recordingDb(["actor", "target"]);
    await insertErasureAware(
      db,
      "postgresql",
      input({ targetUserId: "target" })
    );
    expect(reads).toEqual([{ locked: true }]);
  });

  it("locks the target too when a column names either party", async () => {
    // The control: a write that never locked the target would pass the case
    // above while letting a plugin row race the target's deletion.
    const { db, reads } = recordingDb(["actor", "target"]);
    await insertErasureAware(
      db,
      "postgresql",
      input({ targetUserId: "target", namesEitherParty: { metadata: "{}" } })
    );
    expect(reads).toEqual([{ locked: true }, { locked: true }]);
  });

  it("reports a target with no account, and stores its columns as NULL", async () => {
    const { db, inserted } = recordingDb(["actor"]);
    const outcome = await insertErasureAware(
      db,
      "postgresql",
      input({ targetUserId: "nobody", namesEitherParty: { metadata: "{}" } })
    );
    expect(outcome).toEqual({ targetAbsent: true });
    expect(inserted[0]?.metadata).toBeNull();
  });

  it("reports nothing while the target exists", async () => {
    const { db, inserted } = recordingDb(["actor", "target"]);
    const outcome = await insertErasureAware(
      db,
      "postgresql",
      input({ targetUserId: "target", namesEitherParty: { metadata: "{}" } })
    );
    expect(outcome).toEqual({ targetAbsent: false });
    expect(inserted[0]?.metadata).toBe("{}");
  });
});
