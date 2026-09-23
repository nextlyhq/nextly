/**
 * What the settings store turns a patch into: one transaction that both READS
 * and writes, the row lock that makes the read safe, and the upsert spelling
 * the dialect accepts.
 */
import { describe, expect, it } from "vitest";

import type { PluginSettingRow } from "../settings-service";
import { createPluginSettingsStore } from "../settings-store";

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

describe("locks are taken in one consistent order", () => {
  it("claims keys SORTED, whatever order the caller names them in", async () => {
    // Two patches sharing keys in opposite orders would each hold what the
    // other waits for, and the database would abort one. Sorting is what
    // makes the order the same for every writer.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["zeta", "alpha", "mu"],
      () => rows("zeta", "alpha", "mu")
    );
    expect(fake.claimed).toEqual(["alpha", "mu", "zeta"]);
  });

  it("does not lock the owner's other rows", async () => {
    // Claiming its own keys and then locking every row for the owner is what
    // deadlocked two concurrent patches to DIFFERENT keys. A key this update
    // never writes is read, not held.
    const fake = recordingDb();
    fake.stored.push(...rows("untouched"));
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.claimed).toEqual(["alpha"]);
    expect(fake.locks).toEqual([]);
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

describe("a key that does not exist yet is claimed before the read", () => {
  it("claims every key the update will write, BEFORE locking", async () => {
    // `FOR UPDATE` can only lock a row that exists. Two first writes for the
    // same plugin — or two patches adding the same top-level key — both found
    // nothing to lock, both merged from an empty value, and the later upsert
    // replaced the earlier one. Inserting the key first makes the second
    // transaction block on the primary key until this one commits.
    const fake = recordingDb();

    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha", "beta"],
      () => rows("alpha", "beta")
    );

    expect(fake.claimed).toEqual(["alpha", "beta"]);
    // ORDER is the whole point: a claim taken after the read would leave the
    // read unprotected, which is the defect.
    expect(fake.events.indexOf("claim")).toBeLessThan(
      fake.events.indexOf("select")
    );
    // And still inside the transaction.
    expect(fake.events[0]).toBe("begin");
  });

  it("claims on SQLite too", async () => {
    // The control for the dialect branch: SQLite skips the row LOCK, not the
    // claim, and reading that as "SQLite needs nothing" would leave its first
    // writes racing on a database that does serialize them only once a write
    // has begun.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "sqlite").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.claimed).toEqual(["alpha"]);
  });

  it("removes a claim the update did not go on to write", async () => {
    // Otherwise the placeholder commits as a real row holding `null`, which
    // the next read would decode as the plugin's stored setting.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha", "ghost"],
      () => rows("alpha")
    );

    expect(fake.claimed).toEqual(["alpha", "ghost"]);
    expect(fake.applied).toEqual(["alpha"]);
    // Exactly one delete: for `ghost`, not for the key that was written.
    expect(fake.deleted).toHaveLength(1);
  });

  it("deletes nothing when every claim was written", async () => {
    // The control: deleting unconditionally would satisfy the assertion above
    // while removing the row the update just wrote.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").mutate(
      "@test/p",
      ["alpha"],
      () => rows("alpha")
    );
    expect(fake.deleted).toEqual([]);
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
