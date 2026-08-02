/**
 * What `nextly migrate` does with a companion migration whose declared intent it cannot read.
 *
 * 🔴 Driven through the real `runFileMigrations` rather than through the parser, because the
 * property under test is not what the parser throws — it is whether that throw survives the
 * per-file catch in migration discovery. A refusal that is caught and logged as a warning drops
 * the file from the run, so `migrate` applies everything after it and reports success while the
 * transition the file describes never happened. The parser cannot observe that; only a run can.
 *
 * SQLite alone: file parsing decides the outcome before any statement reaches a server, so the
 * dialects would differ in nothing.
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { getSchemaEventsDdl } from "../../../schema/events/schema-events-ddl";
import { splitStatements } from "../../../schema/pipeline/sql-statement-utils";
import { LOCALIZATION_INTENT_HEADER } from "../migration-intent";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
  getDrizzle<T = unknown>(): T;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
};

describe("a migration whose declared intent cannot be read", () => {
  let adapter: TestAdapter;
  let migrationsDir: string;

  /**
   * A plain migration that leaves a mark, so "was it applied?" is answerable from the database.
   *
   * Its DDL comes from the production collection generator rather than a hand-written CREATE: a
   * copied definition drifts from the shape Nextly actually creates, and this file would then prove
   * something about a table layout no real database has.
   */
  async function writeMarkerMigration(name: string, table: string) {
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    );
    const up = splitStatements([
      schemaService.generateMigrationSQL(table, [] as never),
    ]).join("\n");
    await writeFile(
      join(migrationsDir, `${name}.sql`),
      `-- Migration: ${name}\n\n-- UP\n${up}\n\n-- DOWN\nDROP TABLE "${table}";\n`,
      "utf8"
    );
  }

  async function writeCorruptIntentMigration(name: string) {
    await writeFile(
      join(migrationsDir, `${name}.sql`),
      `-- Migration: ${name}\n-- Collections: posts\n` +
        `${LOCALIZATION_INTENT_HEADER} {"version":1,"kind":"enable","entity":"collection","spec":{}}\n\n` +
        `-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n`,
      "utf8"
    );
  }

  const tableExists = async (name: string): Promise<boolean> =>
    (
      await adapter.executeQuery(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`
      )
    ).length > 0;

  beforeEach(async () => {
    if (adapter === undefined) {
      adapter = createSqliteAdapter({ memory: true }) as unknown as TestAdapter;
      await adapter.connect();
    }
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-intent-"));
    for (const table of ["mark_before", "mark_after", "nextly_schema_events"]) {
      await adapter.executeQuery(`DROP TABLE IF EXISTS "${table}"`);
    }
    for (const statement of getSchemaEventsDdl("sqlite")) {
      await adapter.executeQuery(statement);
    }
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await adapter.disconnect();
    if (migrationsDir)
      await rm(migrationsDir, { recursive: true, force: true });
  });

  // 🔴 The load-bearing case. Names are ordered so the corrupt file sits between two good ones.
  it("stops the run instead of skipping the file", async () => {
    await writeMarkerMigration("20260101_000001_before", "mark_before");
    await writeCorruptIntentMigration("20260101_000002_corrupt");
    await writeMarkerMigration("20260101_000003_after", "mark_after");

    await expect(
      runFileMigrations({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect: "sqlite",
        migrationsDir,
        logger: logger as never,
      })
    ).rejects.toThrow();

    // The half that matters: the run did not carry on past the file it could not understand.
    // Skipping it would have created this table and reported a clean migrate.
    expect(await tableExists("mark_after")).toBe(false);
  });

  // The control. A file this build genuinely cannot parse keeps its existing treatment, so the
  // refusal above is specific to an unreadable INTENT rather than a new blanket strictness.
  it("still tolerates a file carrying no intent at all", async () => {
    await writeMarkerMigration("20260101_000001_before", "mark_before");
    await writeMarkerMigration("20260101_000003_after", "mark_after");

    await expect(
      runFileMigrations({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect: "sqlite",
        migrationsDir,
        logger: logger as never,
      })
    ).resolves.toBe(2);
    expect(await tableExists("mark_after")).toBe(true);
  });
});
