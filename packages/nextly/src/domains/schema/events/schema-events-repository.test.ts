/**
 * @module domains/schema/events/schema-events-repository.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";

import { SchemaEventsRepository } from "./schema-events-repository";

describe("SchemaEventsRepository — C3 additions", () => {
  let testDb: TestDb;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
  });

  it("findFileApplies returns all file_apply rows for a filename", async () => {
    await repo.insertEvent({
      eventType: "file_apply",
      status: "failed",
      source: "cli-migrate",
      filename: "001_x.sql",
      startedAt: new Date(1),
    });
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "001_x.sql",
      startedAt: new Date(2),
      statementsExecuted: 0,
      note: "manual-resolve",
    });
    // unrelated file
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "002_y.sql",
      startedAt: new Date(3),
    });

    const rows = await repo.findFileApplies("001_x.sql");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.status).sort()).toEqual(["applied", "failed"]);
    expect(rows.find(r => r.status === "applied")?.note).toBe("manual-resolve");
  });

  it("markRolledBack flips a row to rolled_back with a note", async () => {
    const id = await repo.insertEvent({
      eventType: "file_apply",
      status: "failed",
      source: "cli-migrate",
      filename: "003_z.sql",
      startedAt: new Date(1),
    });

    await repo.markRolledBack(id, { note: "manual-resolve" });

    const row = await repo.findById(id);
    expect(row?.status).toBe("rolled_back");
    expect(row?.note).toBe("manual-resolve");
  });
});
