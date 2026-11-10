/**
 * A build stops, exit 3, while the ledger records an applied app migration its
 * migrations folder lacks: a newer build migrated the database, or the file
 * was removed. One with an unresolved attempt stops the same way, since the
 * database may hold part of it. A removal recorded on purpose is not missing,
 * and a plugin's rows are never app migrations.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { NextlyError } from "../../../errors/nextly-error";
import {
  assertAppliedFilesPresent,
  assertAppliedFilesUnchanged,
  historyRefusalOf,
  migrateExitCode,
} from "../migrate";

const PRESENT = "20260101_000000_000_init.sql";
const NEWER = "20260102_000000_000_newer.sql";

describe("applied app migrations the folder lacks", () => {
  let testDb: TestDb;
  let dir: string;
  let repo: SchemaEventsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SchemaEventsRepository(testDb.db, "sqlite");
    dir = mkdtempSync(join(tmpdir(), "nextly-files-present-"));
    writeFileSync(join(dir, PRESENT), "-- UP\nSELECT 1;");
  });

  afterEach(async () => {
    await testDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A ledger row for `filename`, at `at` milliseconds. */
  const row = (filename: string, status: string, at: number) =>
    repo.insertEvent({
      eventType: "file_apply",
      status,
      source: "cli-migrate",
      filename,
      sha256: "a".repeat(64),
      startedAt: new Date(at),
    });

  function check(): Promise<void> {
    const quiet = () => {};
    return assertAppliedFilesPresent({
      adapter: testDb.adapter as unknown as Parameters<
        typeof assertAppliedFilesPresent
      >[0]["adapter"],
      db: testDb.db,
      dialect: "sqlite",
      migrationsDir: dir,
      logger: {
        info: quiet,
        warn: quiet,
        debug: quiet,
      } as unknown as Parameters<typeof assertAppliedFilesPresent>[0]["logger"],
      command: "nextly migrate",
    });
  }

  it("stops, exit 3, naming each applied migration the folder lacks", async () => {
    await row(PRESENT, "applied", 1);
    await row(NEWER, "applied", 2);

    const refusal = await check().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refusal).toMatchObject({
      code: "MIGRATION_MISSING",
      what: expect.stringContaining(NEWER),
      why: expect.stringMatching(/newer build has migrated this database/),
      next: expect.stringContaining("migrate:resolve --removed"),
    });
    expect(migrateExitCode(refusal)).toBe(3);
  });

  it("stops, exit 3, for a missing migration a newer build tried and did not finish", async () => {
    await row(PRESENT, "applied", 1);
    await row(NEWER, "failed", 2);

    const refusal = await check().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refusal).toMatchObject({
      code: "MIGRATION_MISSING",
      what: expect.stringContaining(NEWER),
      why: expect.stringMatching(/newer build tried[\s\S]*may hold part/),
      next: expect.stringContaining("--file-missing"),
    });
    expect(migrateExitCode(refusal)).toBe(3);
  });

  it("does not count a removal recorded on purpose, and still stops for any other", async () => {
    const OTHER = "20260103_000000_000_other.sql";
    await row(PRESENT, "applied", 1);
    await row(NEWER, "applied", 2);
    await repo.recordRemoval({ filename: NEWER, sha256: "a".repeat(64) });
    await expect(check()).resolves.toBeUndefined();

    await row(OTHER, "applied", 3);
    const refusal = await check().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refusal).toMatchObject({ what: expect.stringContaining(OTHER) });
    expect((refusal as { what: string }).what).not.toContain(NEWER);
  });

  it("reports a history check's refusal for a dry run, and no other error", async () => {
    await row(NEWER, "applied", 1);
    const refusal = await check().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(historyRefusalOf(refusal)).toContain(NEWER);
    expect(
      historyRefusalOf(
        new NextlyError({ code: "INTERNAL_ERROR", publicMessage: "boom" })
      )
    ).toBeUndefined();
  });

  it("holds a removal to the applied outcome it was recorded for, not to the filename", async () => {
    await row(PRESENT, "applied", 1);
    await row(NEWER, "applied", 2);
    await repo.recordRemoval({ filename: NEWER, sha256: "a".repeat(64) });
    await expect(check()).resolves.toBeUndefined();

    // Rolled back and applied again since: the old removal covers nothing.
    await repo.insertEvent({
      eventType: "file_apply",
      status: "rolled_back",
      source: "cli-migrate",
      filename: NEWER,
      supersededEventIds: ["any"],
    });
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: NEWER,
      sha256: "a".repeat(64),
    });
    await expect(check()).rejects.toMatchObject({
      code: "MIGRATION_MISSING",
      what: expect.stringContaining(NEWER),
    });
  });

  it("refuses a missing applied file in the checksum check too, from the folder that check reads", async () => {
    await row(PRESENT, "applied", 1);
    await row(NEWER, "applied", 2);
    const quiet = () => {};
    await expect(
      assertAppliedFilesUnchanged({
        adapter: testDb.adapter as never,
        db: testDb.db,
        dialect: "sqlite",
        migrationsDir: dir,
        logger: { info: quiet, warn: quiet, debug: quiet } as never,
        command: "nextly migrate",
      })
    ).rejects.toMatchObject({ code: "MIGRATION_MISSING" });
  });

  it("counts no rolled-back migration, and no plugin's rows, as missing", async () => {
    await row(PRESENT, "applied", 1);
    await row(NEWER, "applied", 2);
    await repo.insertEvent({
      eventType: "file_apply",
      status: "rolled_back",
      source: "cli-migrate",
      filename: NEWER,
      startedAt: new Date(3),
      supersededEventIds: ["any"],
    });
    await row("plugin:@acme/notes/0001_init", "applied", 4);

    await expect(check()).resolves.toBeUndefined();
  });
});
