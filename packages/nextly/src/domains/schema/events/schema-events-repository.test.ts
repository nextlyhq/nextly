/**
 * @module domains/schema/events/schema-events-repository.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";

import { appliedFilenames } from "./newest-event";
import { SchemaEventsRepository } from "./schema-events-repository";

describe("SchemaEventsRepository — C3 additions", () => {
  let testDb: TestDb;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
  });

  it("records an app migration's removal, read back apart from its outcomes", async () => {
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "001_x.sql",
      sha256: "a".repeat(64),
      startedAt: new Date(1),
    });
    await repo.recordRemoval({ filename: "001_x.sql", sha256: "a".repeat(64) });

    const removals = await repo.listFileRemovals();
    expect(
      removals.map(r => [r.eventType, r.status, r.filename, r.sha256])
    ).toEqual([["file_removed", "recorded", "001_x.sql", "a".repeat(64)]]);
    // The removal is no outcome: the file's outcomes are its applied row alone.
    expect(
      (await repo.listFileApplies()).map(r => [r.filename, r.status])
    ).toEqual([["001_x.sql", "applied"]]);
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

    expect((await repo.findById(id))?.endedAt).toBeNull();
    await repo.markRolledBack(id, { note: "manual-resolve" });

    const row = await repo.findById(id);
    expect(row?.status).toBe("rolled_back");
    expect(row?.note).toBe("manual-resolve");
    // An attempt recorded with no end time is given one when it is cleared.
    expect(row?.endedAt).toBeInstanceOf(Date);
  });

  it("records a live event strictly after the file's newest one", async () => {
    // An apply whose start is at or past "now" — the same millisecond, or a
    // clock that stepped back. A rollback recorded now must still read as the
    // newer event; a tie had no defined answer, because the ledger is read
    // unordered and event ids are random.
    const applyAt = new Date(Date.now() + 60_000);
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "plugin:fx/001_x.sql",
      startedAt: applyAt,
    });
    await repo.insertEvent({
      eventType: "file_apply",
      status: "rolled_back",
      source: "cli-migrate",
      filename: "plugin:fx/001_x.sql",
    });

    const rows = await repo.findFileApplies("plugin:fx/001_x.sql");
    const rollback = rows.find(row => row.status === "rolled_back");
    expect(rollback!.startedAt.getTime()).toBe(applyAt.getTime() + 1);
    expect(appliedFilenames(rows).has("plugin:fx/001_x.sql")).toBe(false);
  });

  it("keeps an explicit startedAt as given", async () => {
    // History imported by the backfill is fact, not "now".
    const at = new Date(1_000);
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "001_y.sql",
      startedAt: new Date(5_000),
    });
    await repo.insertEvent({
      eventType: "file_apply",
      status: "failed",
      source: "cli-migrate",
      filename: "001_y.sql",
      startedAt: at,
    });
    const rows = await repo.findFileApplies("001_y.sql");
    expect(rows.find(row => row.status === "failed")!.startedAt.getTime()).toBe(
      1_000
    );
  });
});

describe("SchemaEventsRepository.deletePluginModuleRows", () => {
  it("deletes more rows than one statement may bind, in statements SQLite's default limit accepts", async () => {
    const testDb = await createTestDb();
    const repo = new SchemaEventsRepository(testDb.db, "sqlite");
    // More rows than SQLite's default 999 bound parameters.
    for (let at = 0; at < 1_200; at += 1) {
      await repo.insertEvent({
        eventType: "file_apply",
        status: at % 2 === 0 ? "applied" : "rolled_back",
        source: "cli-migrate",
        filename: "plugin:@acme/fx/0001_init",
        startedAt: new Date(at),
      });
    }
    // CONTROL: another plugin's row stays.
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "plugin:@acme/other/0001_init",
      startedAt: new Date(1),
    });
    // The bundled SQLite accepts far more than its default, so what the
    // statements bind is read where they are prepared.
    const prepare = vi.spyOn(testDb.sqlite, "prepare");

    await repo.deletePluginModuleRows("@acme/fx");

    const deletes = prepare.mock.calls
      .map(call => String(call[0]))
      .filter(source => /^delete/i.test(source.trim()));
    expect(deletes.length).toBeGreaterThan(1);
    for (const source of deletes) {
      expect((source.match(/\?/g) ?? []).length).toBeLessThanOrEqual(999);
    }
    const left = (await repo.listFileApplies()).map(row => row.filename);
    expect(left).toEqual(["plugin:@acme/other/0001_init"]);
    prepare.mockRestore();
    await testDb.close();
  });
});
