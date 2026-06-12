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

  it("markApplied(uniqueFilename) refuses a 2nd applied row for the same file", async () => {
    // Replaces the SQLite partial unique index: the "one applied row per file"
    // guard, now enforced atomically in code (drizzle-kit can't round-trip a
    // SQLite partial index — drizzle-team/drizzle-orm#4688).
    const id1 = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: "0001_init.sql",
    });
    await repo.markApplied(id1, { uniqueFilename: "0001_init.sql" });
    expect((await repo.findById(id1))?.status).toBe("applied");

    // A racing second attempt for the same file is blocked from applying. Its
    // row is resolved to `superseded` (not left dangling at `in_progress`) so
    // `migrate:status` doesn't show a stuck row and callers don't read a false
    // "still running" state. markApplied returns false to signal the block.
    const id2 = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: "0001_init.sql",
    });
    const applied2 = await repo.markApplied(id2, {
      uniqueFilename: "0001_init.sql",
    });
    expect(applied2).toBe(false);
    expect((await repo.findById(id2))?.status).toBe("superseded");

    // Exactly one applied row exists for the file.
    const applies = await repo.findFileApplies("0001_init.sql");
    expect(applies.filter(r => r.status === "applied")).toHaveLength(1);
  });

  it("markApplied without uniqueFilename still applies unconditionally", async () => {
    const id = await repo.recordStart({ eventType: "dev_push", source: "ui" });
    await repo.markApplied(id, { statementsExecuted: 1 });
    expect((await repo.findById(id))?.status).toBe("applied");
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
    await repo.supersede({
      supersededEventIds: [consumedId],
      byEventId: fileId,
    });

    // Even with a 1-day retention and far-future "now", the consumed row is
    // protected because it is referenced by the file_apply row.
    const deleted = await repo.prune({
      retentionDays: 1,
      now: new Date("2099-01-01"),
    });
    expect(deleted).not.toContain(consumedId);
  });
});
