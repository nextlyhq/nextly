// The mark that records, while an old Schema Builder file can still be read,
// that a ledger row names one. It is its own record kind, so a migration's
// applied state, read from `file_apply` rows alone by this build and by every
// earlier one, never changes because of it.
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../schema-events-repository";

const FILE = "1730000000000_create_posts.sql";

describe("old Schema Builder file marks (sqlite)", () => {
  let testDb: TestDb;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
  });

  it("records a mark as its own kind, with the file's name and checksum", async () => {
    await repo.recordOldBuilderMark({
      filename: FILE,
      sha256: "a".repeat(64),
      source: "cli-migrate",
    });
    const marks = await repo.currentOldBuilderMarks();
    expect([...marks.keys()]).toEqual([FILE]);
    expect(marks.get(FILE)).toMatchObject({
      eventType: "old_builder_file",
      status: "applied",
      filename: FILE,
      sha256: "a".repeat(64),
    });
  });

  it("keeps the newest mark per file, so a new checksum replaces the old", async () => {
    await repo.recordOldBuilderMark({
      filename: FILE,
      sha256: "a".repeat(64),
      source: "cli-migrate",
    });
    await repo.recordOldBuilderMark({
      filename: FILE,
      sha256: "b".repeat(64),
      source: "cli-migrate",
    });
    expect((await repo.currentOldBuilderMarks()).get(FILE)?.sha256).toBe(
      "b".repeat(64)
    );
  });

  it("never changes whether the file reads as applied, or what the file_apply readers list", async () => {
    const applied = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: FILE,
    });
    await repo.markApplied(applied, { statementsExecuted: 1 });
    await repo.recordOldBuilderMark({
      filename: FILE,
      sha256: "a".repeat(64),
      source: "cli-migrate",
    });
    expect(await repo.isFileApplied(FILE)).toBe(true);
    expect((await repo.listFileApplies()).map(r => r.eventType)).toEqual([
      "file_apply",
    ]);

    const other = "1730000000001_create_pages.sql";
    await repo.recordOldBuilderMark({
      filename: other,
      sha256: "c".repeat(64),
      source: "cli-migrate",
    });
    expect(await repo.isFileApplied(other)).toBe(false);
  });

  it("lists no mark on a ledger that has none", async () => {
    expect((await repo.currentOldBuilderMarks()).size).toBe(0);
  });
});
