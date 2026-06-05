/**
 * DrizzleMigrationJournal now writes to `nextly_schema_events` (Plan C1).
 * The MigrationJournal interface is unchanged; only the backing store moved.
 *
 * @module domains/schema/journal/__tests__/migration-journal
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createTestDb, type TestDb } from "../../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { DrizzleMigrationJournal } from "../migration-journal";

describe("DrizzleMigrationJournal → nextly_schema_events", () => {
  let testDb: TestDb;
  let journal: DrizzleMigrationJournal;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    journal = new DrizzleMigrationJournal({
      db: testDb.db,
      dialect: "sqlite",
      logger: {},
    });
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
  });

  it("recordStart writes an in_progress dev_push event for source=code", async () => {
    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 2,
    });
    const row = await repo.findById(id);
    expect(row?.status).toBe("in_progress");
    expect(row?.eventType).toBe("dev_push");
  });

  it("recordStart maps source=ui → ui_save + scope", async () => {
    const id = await journal.recordStart({
      source: "ui",
      statementsPlanned: 1,
      scope: { kind: "collection", slug: "posts" },
    });
    const row = await repo.findById(id);
    expect(row?.eventType).toBe("ui_save");
    expect(row?.scopeKind).toBe("collection");
    expect(row?.scopeSlug).toBe("posts");
  });

  it("recordEnd(success) marks the event applied", async () => {
    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 1,
    });
    await journal.recordEnd(id, { success: true, statementsExecuted: 1 });
    const row = await repo.findById(id);
    expect(row?.status).toBe("applied");
    expect(row?.statementsExecuted).toBe(1);
  });

  it("recordEnd(failure) marks the event failed", async () => {
    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 1,
    });
    await journal.recordEnd(id, {
      success: false,
      statementsExecuted: 0,
      error: new Error("boom"),
    });
    const row = await repo.findById(id);
    expect(row?.status).toBe("failed");
  });

  it("maps scope.kind=fresh-push → events scopeKind=global", async () => {
    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 0,
      scope: { kind: "fresh-push" },
    });
    const row = await repo.findById(id);
    expect(row?.scopeKind).toBe("global");
  });

  it("recordEnd on a failed-sentinel id is a no-op (does not throw)", async () => {
    await expect(
      journal.recordEnd("journal-failed-xyz", {
        success: true,
        statementsExecuted: 0,
      })
    ).resolves.toBeUndefined();
  });
});
