/**
 * @module cli/commands/__tests__/upgrade
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { runUpgrade, type UpgradeAdapter } from "../upgrade";

/** Fake adapter over the in-memory SQLite fixture. */
function makeAdapter(testDb: TestDb): UpgradeAdapter {
  return {
    tableExists: name =>
      Promise.resolve(
        !!testDb.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
          )
          .get(name)
      ),
    getDrizzle: () => testDb.db,
    dropTable: (name, options) => {
      const ifExists = options?.ifExists !== false ? "IF EXISTS " : "";
      testDb.sqlite.exec(`DROP TABLE ${ifExists}"${name}"`);
      return Promise.resolve();
    },
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  };
}

function tableExistsSync(testDb: TestDb, name: string): boolean {
  return !!testDb.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

describe("nextly upgrade (sqlite)", () => {
  let testDb: TestDb;
  let adapter: UpgradeAdapter;

  beforeEach(async () => {
    testDb = await createTestDb();
    adapter = makeAdapter(testDb);
    // Start from an existing alpha DB: legacy ledger present, no events table.
    testDb.sqlite.exec("DROP TABLE IF EXISTS nextly_schema_events");
    testDb.sqlite.exec(`
      CREATE TABLE nextly_migrations (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL,
        applied_at INTEGER, applied_by TEXT, duration_ms INTEGER,
        status TEXT NOT NULL, error_json TEXT
      );
      INSERT INTO nextly_migrations (id, filename, sha256, status)
      VALUES ('1', '0001.sql', 'aa', 'applied');
    `);
  });

  it("creates the events table, backfills file_apply rows, and drops the legacy table", async () => {
    await runUpgrade({ confirmBackedUp: true }, { adapter });

    expect(tableExistsSync(testDb, "nextly_schema_events")).toBe(true);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(false);

    const repo = new SchemaEventsRepository(testDb.db, "sqlite");
    expect(await repo.isFileApplied("0001.sql")).toBe(true);
  });

  it("is idempotent — a second run reports already-upgraded and does not throw", async () => {
    await runUpgrade({ confirmBackedUp: true }, { adapter });
    await expect(
      runUpgrade({ confirmBackedUp: true }, { adapter })
    ).resolves.toBeUndefined();
  });

  it("aborts on a foreign nextly_schema_events table (collision)", async () => {
    testDb.sqlite.exec("DROP TABLE IF EXISTS nextly_migrations");
    testDb.sqlite.exec("CREATE TABLE nextly_schema_events (totally_wrong INTEGER)");
    await expect(
      runUpgrade({ confirmBackedUp: true }, { adapter })
    ).rejects.toMatchObject({ code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION" });
  });

  it("requires --confirm-backed-up in non-TTY", async () => {
    await expect(
      runUpgrade({ confirmBackedUp: false }, { adapter, isTTY: false })
    ).rejects.toBeTruthy();
  });
});
