/**
 * Which account rows an erasure-aware write locks on Postgres and MySQL, with
 * which lock, and in which order.
 *
 * Driven with a recording database rather than a real one, because the
 * property is the set of locked reads issued — a lock nobody needed costs a
 * round trip and contends with the deletion, and nothing in the stored row
 * shows that it was taken.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  insertErasureAware,
  type ErasureAwareDb,
  type ErasureAwareInsert,
} from "../erasure-aware-insert";
import type { RowLockStrength } from "../../../shared/lib/row-lock";

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

/** One account read: the id asked for, and the lock taken, if any. */
interface AccountRead {
  id: unknown;
  lock: RowLockStrength | null;
}

/**
 * A database holding the accounts `existing`, recording each account read and
 * the lock it took, and the row inserted.
 */
function recordingDb(existing: string[]) {
  const reads: AccountRead[] = [];
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
            const read = (lock: RowLockStrength | null) => {
              reads.push({ id, lock });
              return Promise.resolve(rows);
            };
            // Lazy, as Drizzle's builders are: awaiting it reads unlocked,
            // `.for(strength)` reads under that lock, and neither happens
            // before.
            const query = {
              then: <T>(
                resolve: (value: Record<string, unknown>[]) => T,
                reject: (reason: unknown) => T
              ) => read(null).then(resolve, reject),
              for: (strength: RowLockStrength) => read(strength),
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
      { dialect: "postgresql" },
      input({ targetUserId: "target" })
    );
    expect(reads).toEqual([{ id: "actor", lock: "share" }]);
  });

  it("locks the target too when a column names either party", async () => {
    // The control: a write that never locked the target would pass the case
    // above while letting a plugin row race the target's deletion.
    const { db, reads } = recordingDb(["actor", "target"]);
    await insertErasureAware(
      db,
      { dialect: "postgresql" },
      input({ targetUserId: "target", namesEitherParty: { metadata: "{}" } })
    );
    expect(reads).toEqual([
      { id: "actor", lock: "share" },
      { id: "target", lock: "share" },
    ]);
  });

  it("reports a target with no account, and stores its columns as NULL", async () => {
    const { db, inserted } = recordingDb(["actor"]);
    const outcome = await insertErasureAware(
      db,
      { dialect: "postgresql" },
      input({ targetUserId: "nobody", namesEitherParty: { metadata: "{}" } })
    );
    expect(outcome).toEqual({ targetAbsent: true });
    expect(inserted[0]?.metadata).toBeNull();
  });

  it("reports nothing while the target exists", async () => {
    const { db, inserted } = recordingDb(["actor", "target"]);
    const outcome = await insertErasureAware(
      db,
      { dialect: "postgresql" },
      input({ targetUserId: "target", namesEitherParty: { metadata: "{}" } })
    );
    expect(outcome).toEqual({ targetAbsent: false });
    expect(inserted[0]?.metadata).toBe("{}");
  });
});

describe("the locks an erasure-aware write takes on MySQL", () => {
  it("takes FOR SHARE on a server that accepts it", async () => {
    // MySQL 8, Aurora and Vitess: concurrent writes naming one account share
    // its row rather than queueing on it.
    const { db, reads } = recordingDb(["actor", "target"]);
    await insertErasureAware(
      db,
      { dialect: "mysql", sharedRowLock: true },
      input({ targetUserId: "target", namesEitherParty: { metadata: "{}" } })
    );
    expect(reads).toEqual([
      { id: "actor", lock: "share" },
      { id: "target", lock: "share" },
    ]);
  });

  it.each([
    ["a server that rejects FOR SHARE", false],
    ["a server not yet known", undefined],
  ])("takes FOR UPDATE on %s", async (_, sharedRowLock) => {
    // MariaDB and TiDB refuse `FOR SHARE` as a syntax error, so asking them
    // for it failed every write that named an account.
    const { db, reads } = recordingDb(["actor", "target"]);
    await insertErasureAware(
      db,
      { dialect: "mysql", sharedRowLock },
      input({ targetUserId: "target", namesEitherParty: { metadata: "{}" } })
    );
    expect(reads).toEqual([
      { id: "actor", lock: "update" },
      { id: "target", lock: "update" },
    ]);
  });

  it("locks the two accounts in id order, whichever is the actor", async () => {
    // A write by `zed` about `amy` and one by `amy` about `zed` lock the same
    // row first. Actor first, each could hold one exclusive lock while
    // waiting for the other's.
    const { db, reads } = recordingDb(["zed", "amy"]);
    await insertErasureAware(
      db,
      { dialect: "mysql", sharedRowLock: false },
      input({
        actorUserId: "zed",
        targetUserId: "amy",
        namesEitherParty: { metadata: "{}" },
      })
    );
    expect(reads).toEqual([
      { id: "amy", lock: "update" },
      { id: "zed", lock: "update" },
    ]);
  });
});
