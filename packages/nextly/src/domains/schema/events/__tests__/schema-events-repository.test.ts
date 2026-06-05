/**
 * @module domains/schema/events/__tests__/schema-events-repository
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createTestDb, type TestDb } from "../../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../schema-events-repository";

describe("SchemaEventsRepository (sqlite)", () => {
  let testDb: TestDb;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
  });

  it("records an in_progress event and returns its id", async () => {
    const id = await repo.recordStart({
      eventType: "dev_push",
      source: "dev-server",
      scopeKind: "collection",
      scopeSlug: "posts",
    });
    expect(typeof id).toBe("string");
    const row = await repo.findById(id);
    expect(row?.status).toBe("in_progress");
  });

  it("markApplied transitions the row and sets statementsExecuted", async () => {
    const id = await repo.recordStart({
      eventType: "dev_push",
      source: "dev-server",
    });
    await repo.markApplied(id, { statementsExecuted: 3, durationMs: 12 });
    const row = await repo.findById(id);
    expect(row?.status).toBe("applied");
    expect(row?.statementsExecuted).toBe(3);
  });

  it("isFileApplied returns true only for an applied file_apply row", async () => {
    expect(await repo.isFileApplied("0001_init.sql")).toBe(false);
    const id = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: "0001_init.sql",
    });
    await repo.markApplied(id, {});
    expect(await repo.isFileApplied("0001_init.sql")).toBe(true);
  });

  it("isFileApplied is latest-status-wins: a later rolled_back un-applies it", async () => {
    const id = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: "0001_init.sql",
    });
    await repo.markApplied(id, {});
    expect(await repo.isFileApplied("0001_init.sql")).toBe(true);

    // What `migrate:resolve --rolled-back` does: append a later rolled_back event.
    await repo.insertEvent({
      eventType: "file_apply",
      status: "rolled_back",
      source: "cli-migrate",
      filename: "0001_init.sql",
      startedAt: new Date(Date.now() + 1000),
      endedAt: new Date(Date.now() + 1000),
    });
    expect(await repo.isFileApplied("0001_init.sql")).toBe(false);
  });

  it("supersede links consumed rows and prune never deletes them", async () => {
    const consumedId = await repo.recordStart({
      eventType: "dev_push",
      source: "dev-server",
    });
    await repo.markApplied(consumedId, {});
    const fileId = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: "0002.sql",
    });
    await repo.markApplied(fileId, {});
    await repo.supersede({ supersededEventIds: [consumedId], byEventId: fileId });

    // Even with a 1-day retention and far-future "now", the consumed row is
    // protected because it is referenced by the file_apply row.
    const deleted = await repo.prune({
      retentionDays: 1,
      now: new Date("2099-01-01"),
    });
    expect(deleted).not.toContain(consumedId);
  });
});
