/**
 * What the settings store turns a patch into: one transaction, and the upsert
 * spelling the dialect actually accepts.
 */
import { describe, expect, it } from "vitest";

import type { PluginSettingRow } from "../settings-service";
import { createPluginSettingsStore } from "../settings-store";

/** A fake Drizzle handle that records what was issued, and against what. */
function recordingDb(options: { failOnRow?: number } = {}) {
  const applied: string[] = [];
  const spelling: string[] = [];
  let transactions = 0;
  let issued = 0;

  const writer = {
    insert: () => ({
      values: (row: unknown) => {
        const key = (row as PluginSettingRow).key;
        const runOne = async (how: string) => {
          issued += 1;
          if (options.failOnRow === issued) {
            throw new Error(`upsert failed on row ${String(issued)}`);
          }
          spelling.push(how);
          applied.push(key);
        };
        return {
          onConflictDoUpdate: () => runOne("onConflictDoUpdate"),
          onDuplicateKeyUpdate: () => runOne("onDuplicateKeyUpdate"),
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };

  return {
    applied,
    spelling,
    transactions: () => transactions,
    db: {
      ...writer,
      select: () => ({ from: () => ({ where: async () => [] }) }),
      // The rollback a real transaction performs, modelled as discarding
      // whatever the body recorded. A fake that kept the rows would report a
      // sequential loop and a transaction identically, which is the whole
      // distinction under test.
      transaction: async <T>(run: (tx: typeof writer) => Promise<T>) => {
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

describe("a multi-key patch is one transaction", () => {
  it("applies nothing when a later row fails", async () => {
    // Each upsert committing on its own meant a failure partway through left
    // the earlier keys applied while the caller was told the update failed —
    // a settings object nobody chose, which the plugin's own schema need not
    // accept on the next read.
    const fake = recordingDb({ failOnRow: 2 });
    const store = createPluginSettingsStore(fake.db, "sqlite");

    await expect(store.write(rows("alpha", "beta"))).rejects.toThrow(
      "upsert failed on row 2"
    );

    expect(fake.applied).toEqual([]);
    expect(fake.transactions()).toBe(1);
  });

  it("applies every row when none fails", async () => {
    // The control: a store that wrote nothing at all would satisfy the
    // assertion above.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "sqlite").write(
      rows("alpha", "beta")
    );

    expect(fake.applied).toEqual(["alpha", "beta"]);
    // ONE transaction for the whole patch, not one per row — which would
    // commit each key independently and reproduce the defect above.
    expect(fake.transactions()).toBe(1);
  });
});

describe("the upsert spelling follows the dialect it was given", () => {
  it("uses MySQL's spelling on MySQL", async () => {
    // MySQL has no `onConflictDoUpdate`. A context that could not tell which
    // dialect it was on defaulted to SQLite and the write failed outright.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "mysql").write(rows("alpha"));
    expect(fake.spelling).toEqual(["onDuplicateKeyUpdate"]);
  });

  it("uses the conflict-target spelling on Postgres", async () => {
    // The control, and the case the SQLite default silently produced anyway —
    // so it only means anything beside the MySQL assertion above.
    const fake = recordingDb();
    await createPluginSettingsStore(fake.db, "postgresql").write(rows("alpha"));
    expect(fake.spelling).toEqual(["onConflictDoUpdate"]);
  });
});
