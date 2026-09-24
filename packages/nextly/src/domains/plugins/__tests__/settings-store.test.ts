/**
 * What the settings store turns a patch into: one transaction that both READS
 * and writes, the row lock that makes the read safe, and the upsert spelling
 * the dialect accepts.
 */
import { describe, expect, it } from "vitest";

import type { PluginSettingRow } from "../settings-service";
import { createPluginSettingsStore, OWNER_LOCK_KEY } from "../settings-store";

/** A fake Drizzle handle that records what was issued, and against what. */
function recordingDb(options: { failOnRow?: number } = {}) {
  const applied: string[] = [];
  const spelling: string[] = [];
  const locks: string[] = [];
  // An ORDERED log, because "was the read inside the transaction" is a
  // question about sequence. A flag checked from within the callback is
  // satisfied by a read taken beforehand too, since the transaction is open
  // by the time the callback runs — which is the exact defect under test.
  const events: string[] = [];
  const claimed: string[] = [];
  const claimedRows: PluginSettingRow[] = [];
  const deleted: string[] = [];
  let transactions = 0;
  let issued = 0;
  const stored: PluginSettingRow[] = [];

  const writer = {
    select: () => ({
      from: () => ({
        where: () => {
          events.push("select");
          return Promise.resolve(stored.slice());
        },
      }),
    }),
    insert: () => ({
      values: (row: unknown) => {
        const key = (row as PluginSettingRow).key;
        const values = row as PluginSettingRow;
        const runOne = async (how: string) => {
          issued += 1;
          if (options.failOnRow === issued) {
            throw new Error(`upsert failed on row ${String(issued)}`);
          }
          spelling.push(how);
          applied.push(key);
        };
        return {
          // The CLAIM is a no-op `DO UPDATE` on every dialect now, because
          // `DO NOTHING` takes no lock on an existing row. Told apart from
          // the real upsert by what it sets.
          onConflictDoUpdate: (args: unknown) => {
            const set = (args as { set: Record<string, unknown> }).set;
            if (!("value" in set)) {
              claimed.push(key);
              claimedRows.push(values);
              events.push("claim");
              return Promise.resolve();
            }
            return runOne("onConflictDoUpdate");
          },
          // On MySQL the CLAIM is spelled `onDuplicateKeyUpdate` too, so the
          // two are told apart by what they set: the claim assigns the key to
          // itself as a no-op, the upsert writes the value and its metadata.
          // Counting them together made the spelling assertions meaningless.
          onDuplicateKeyUpdate: (args: unknown) => {
            const set = (args as { set: Record<string, unknown> }).set;
            if (!("value" in set)) {
              claimed.push(key);
              claimedRows.push(values);
              events.push("claim");
              return Promise.resolve();
            }
            return runOne("onDuplicateKeyUpdate");
          },
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({
      where: async () => {
        deleted.push("row");
      },
    }),
  };

  return {
    applied,
    spelling,
    locks,
    events,
    claimed,
    claimedRows,
    deleted,
    stored,
    transactions: () => transactions,
    db: {
      ...writer,
      // The rollback a real transaction performs, modelled as discarding what
      // the body recorded. A fake that kept the rows would report a
      // sequential loop and a transaction identically.
      transaction: async <T>(run: (tx: typeof writer) => Promise<T>) => {
        events.push("begin");
        transactions += 1;
        const before = applied.length;
        try {
          return await run(writer);
        } catch (err) {
          applied.length = before;
          throw err;
        }
      },
    },
  };
}

function rows(...keys: string[]): PluginSettingRow[] {
  return keys.map(key => ({
    owner: "@test/p",
    key,
    value: JSON.stringify({ v: key }),
    isSecret: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updatedBy: null,
  }));
}

describe("a settings update is one transaction", () => {
  it("applies nothing when a later row fails", async () => {
    // Each upsert committing on its own left a failure partway through with
    // the earlier keys applied while the caller was told the write failed —
    // settings nobody chose, which the plugin's schema need not accept.
    const fake = recordingDb({ failOnRow: 2 });
    const store = createPluginSettingsStore(fake.db, "sqlite");

    await expect(
      store.mutate("@test/p", ["alpha", "beta"], () => rows("alpha", "beta"))
    ).rejects.toThrow("upsert failed on row 2");

    expect(fake.applied).toEqual([]);
    expect(fake.transactions()).toBe(1);
  });

  it("applies every row when none fails", async () => {
    // The control: a store that wrote nothing at all would satisfy the
    // assertion above.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "sqlite").mutate(
      "@test/p",
      ["alpha", "beta"],
      () => rows("alpha", "beta")
    );

    expect(fake.applied).toEqual(["alpha", "beta"]);
    // ONE transaction for the whole update, not one per row.
    expect(fake.transactions()).toBe(1);
  });

  it("READS inside the same transaction, and hands those rows to the caller", async () => {
    // The lost-update fix. Reading outside meant two callers patching
    // different nested fields under one key both started from the same stored
    // value, and the second write restored what the first had just changed.
    const fake = recordingDb();
    fake.stored.push(...rows("existing"));
    let seen: PluginSettingRow[] | undefined;

    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha"],
      (current: PluginSettingRow[]) => {
        seen = current;
        return rows("alpha");
      }
    );

    // ORDER, not a flag: `begin` must come first. Checking the transaction
    // count from inside the callback passes even when the read was taken
    // beforehand, because the transaction is open by then — so that assertion
    // could not see the defect it was written for.
    expect(fake.events[0]).toBe("begin");
    expect(fake.events.indexOf("select")).toBeGreaterThan(
      fake.events.indexOf("begin")
    );
    expect(seen?.map(r => r.key)).toEqual(["existing"]);
  });
});

describe("the upsert spelling follows the dialect it was given", () => {
  it("uses MySQL's spelling on MySQL", async () => {
    // MySQL has no `onConflictDoUpdate`. A context that could not tell which
    // dialect it was on defaulted to SQLite and the write failed outright.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "mysql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.spelling).toEqual(["onDuplicateKeyUpdate"]);
  });

  it("uses the conflict-target spelling on Postgres", async () => {
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.spelling).toEqual(["onConflictDoUpdate"]);
  });
});

describe("every writer for one plugin contends on ONE row", () => {
  it("claims the owner lock BEFORE reading anything", async () => {
    // Per-key locks were not enough, and the validation is why: `computeRows`
    // validates the COMPLETE settings object, so it reads keys this update
    // will not write. Two patches to different keys each read the other's old
    // value, each validated against it, and both committed — leaving a
    // combination the schema rejects, which the next `get()` throws on.
    const fake = recordingDb();

    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["zeta", "alpha"],
      () => rows("zeta", "alpha")
    );

    // ONE claim, and it is the lock row rather than any settings key.
    expect(fake.claimed).toEqual([OWNER_LOCK_KEY]);
    expect(fake.events[0]).toBe("begin");
    expect(fake.events.indexOf("claim")).toBeLessThan(
      fake.events.indexOf("select")
    );
  });

  it("claims it on SQLite too", async () => {
    // SQLite skips the row LOCK, not the serialization: its write transaction
    // begins only at the first write, so two readers can still interleave
    // before either writes.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "sqlite").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.claimed).toEqual([OWNER_LOCK_KEY]);
  });

  it("DELETES the lock row before committing", async () => {
    // It is not settings and must never be read as any. Left behind, the next
    // read would decode a placeholder as a plugin's stored value.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.deleted).toHaveLength(1);
  });

  it("still writes every row the update produced", async () => {
    // The control: a store that only took the lock and wrote nothing would
    // satisfy all three assertions above.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha", "beta"],
      () => rows("alpha", "beta")
    );
    expect(fake.applied).toEqual(["alpha", "beta"]);
  });
});

describe("the claim placeholder is storable on every dialect", () => {
  it("carries a timestamp MySQL accepts", async () => {
    // MySQL's `TIMESTAMP` range begins AFTER 1970-01-01 00:00:00, and under
    // the strict mode most installations run it rejects that value outright.
    // The epoch here failed the first write of any key before the real upsert
    // was reached, so no plugin setting could ever be created.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "mysql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );

    expect(fake.claimedRows).toHaveLength(1);
    expect(fake.claimedRows[0].updatedAt.getTime()).toBeGreaterThan(0);
  });

  it("still writes the real value over it", async () => {
    // The control: a claim carrying a valid timestamp is no use if the row it
    // leaves behind is the placeholder rather than the setting.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "mysql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.applied).toEqual(["alpha"]);
    expect(fake.spelling).toEqual(["onDuplicateKeyUpdate"]);
  });
});

describe("a SQLite-shaped transaction runner", () => {
  it("runs the whole mutation inside the provided runner, not Drizzles", async () => {
    // Drizzle's better-sqlite3 transaction callback is synchronous by driver
    // design — an async mutate failed with 'Transaction function cannot
    // return a promise' instead of committing. SQLite writes therefore ride
    // the adapter's manual BEGIN IMMEDIATE runner; this asserts the store
    // takes that path when one is supplied, with the statements still flowing
    // through the store's own handle.
    const order: string[] = [];
    const fake = recordingDb();
    const runner = async <T>(work: () => Promise<T>): Promise<T> => {
      order.push("begin");
      try {
        return await work();
      } finally {
        order.push("commit");
      }
    };

    const store = createPluginSettingsStore(fake.db, "sqlite", runner);
    await store.mutate("p", ["k"], async () => {
      order.push("work");
      return [];
    });

    expect(order[0]).toBe("begin");
    expect(order[order.length - 1]).toBe("commit");
    expect(order).toContain("work");
  });
});
