/**
 * The migration ledger as an install made before plugin migrations stays
 * readable and writable by the commands an operator runs before
 * `nextly migrate`.
 *
 * The fixture builds `nextly_schema_events` from `getSchemaEventsDdl`, whose
 * columns `schemas/schema-events/__tests__/columns.test.ts` holds to the
 * canonical set, in every dialect. A column declared on the Drizzle table and absent from an
 * installed ledger fails every whole-row select and every insert, since
 * Drizzle names each declared column: status would see no applied history,
 * and `migrate:down` would run a DOWN and then fail to record it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { newestEvent } from "../../../domains/schema/events/newest-event";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { resolveMigration } from "../../../domains/schema/migrate/resolve";
import { readStatusLedger } from "../migrate-status";

describe("the migration ledger in the shape earlier releases created", () => {
  let testDb: TestDb;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
    // Seeded below Drizzle, so each case reaches the ledger only through
    // the read or write it is about.
    testDb.sqlite.exec(
      `INSERT INTO nextly_schema_events
         (id, event_type, status, source, filename, sha256, started_at)
       VALUES
         ('e1', 'file_apply', 'applied', 'cli-migrate', '001_init.sql', 'abc', 1000),
         ('e2', 'file_rollback', 'failed', 'cli-migrate', '001_init.sql', NULL, 2000)`
    );
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("lists the applied history rather than reporting it pending", async () => {
    const ledger = await readStatusLedger(testDb.adapter, "sqlite");

    expect(ledger.applied.map(r => [r.filename, r.status, r.sha256])).toEqual([
      ["001_init.sql", "applied", "abc"],
    ]);
    expect(ledger.rollbacks.map(r => r.filename)).toEqual(["001_init.sql"]);
  });

  it("records a rollback, as migrate:down does after running a DOWN", async () => {
    await resolveMigration({
      mode: "rolled-back",
      filename: "001_init.sql",
      dialect: "sqlite",
      repo,
      fileExists: () => Promise.resolve(true),
      loadTargetSnapshot: () => Promise.resolve(null),
      marksNoTransaction: () => Promise.resolve(false),
      introspectLive: () => Promise.resolve({ tables: [] }),
    });

    expect(
      newestEvent(await repo.findFileApplies("001_init.sql"))?.status
    ).toBe("rolled_back");
  });

  it("raises a ledger that is there but cannot be read", async () => {
    // A column every ledger has, gone: a broken table, not an install no
    // migrate has run on.
    testDb.sqlite.exec("ALTER TABLE nextly_schema_events DROP COLUMN sha256");

    await expect(readStatusLedger(testDb.adapter, "sqlite")).rejects.toThrow(
      /sha256/
    );
  });

  it("reads an absent ledger as nothing recorded", async () => {
    testDb.sqlite.exec("DROP TABLE nextly_schema_events");

    await expect(readStatusLedger(testDb.adapter, "sqlite")).resolves.toEqual({
      applied: [],
      rollbacks: [],
    });
  });
});
