/**
 * `nextly migrate --dry-run` previews both streams a real run executes: the
 * plugins' pending modules first, then the app's files, under one `--step`
 * budget, without writing anything.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  migrationChecksum,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { previewMigrate } from "../migrate";

/** A blank, sealed module: the shape `migrate:create --plugin --blank` writes. */
function blankModule(name: string): PluginMigration {
  const statements = { up: [`-- ${name}`], down: [] };
  const content = {
    name,
    schemaVersion: 1,
    dialects: {
      postgresql: statements,
      mysql: statements,
      sqlite: statements,
    },
    snapshot: {
      postgresql: { tables: [] },
      mysql: { tables: [] },
      sqlite: { tables: [] },
    },
    before: {
      postgresql: { tables: [] },
      mysql: { tables: [] },
      sqlite: { tables: [] },
    },
  };
  return { ...content, checksum: migrationChecksum(content) };
}

const plugins = [
  {
    name: "acme",
    version: "1.0.0",
    contributes: {
      schema: {
        migrations: [blankModule("002_more"), blankModule("001_init")],
      },
    },
  },
] as unknown as Parameters<typeof previewMigrate>[0]["plugins"];

describe("migrate --dry-run", () => {
  let testDb: TestDb;
  let dir: string;
  let lines: string[];

  beforeEach(async () => {
    testDb = await createTestDb();
    dir = mkdtempSync(join(tmpdir(), "nextly-dry-run-"));
    writeFileSync(
      join(dir, "20260101_000000_000_init.sql"),
      "-- UP\nSELECT 1;"
    );
    lines = [];
  });

  afterEach(async () => {
    await testDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function preview(step?: number): Promise<void> {
    const record = (message: string) => {
      lines.push(message);
    };
    return previewMigrate({
      adapter: testDb.adapter as unknown as Parameters<
        typeof previewMigrate
      >[0]["adapter"],
      db: testDb.db,
      dialect: "sqlite",
      migrationsDir: dir,
      plugins,
      step,
      logger: {
        info: record,
        keyValue: (key: string, value: string) => record(`${key}: ${value}`),
        newline: () => {},
        warn: record,
        debug: () => {},
      } as unknown as Parameters<typeof previewMigrate>[0]["logger"],
    });
  }

  it("lists the pending plugin modules, in run order, before the app's files", async () => {
    await preview();

    expect(lines).toEqual([
      "Pending: 3 migrations",
      "  • plugin:acme/001_init",
      "  • plugin:acme/002_more",
      "  • 20260101_000000_000_init.sql",
      // The file's UP section, as `migrate:down --dry-run` prints a rollback's SQL.
      "    UP, as written in the file:\nSELECT 1;",
    ]);
  });

  it("spends --step on the plugin modules first", async () => {
    await preview(2);

    expect(lines).toEqual([
      "Pending: 2 migrations",
      "  • plugin:acme/001_init",
      "  • plugin:acme/002_more",
    ]);
  });

  it("leaves out a module the ledger records as applied", async () => {
    const repo = new SchemaEventsRepository(testDb.db, "sqlite");
    await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: "plugin:acme/001_init",
      sha256: blankModule("001_init").checksum,
    });

    await preview(2);

    expect(lines).toEqual([
      "Pending: 2 migrations",
      "  • plugin:acme/002_more",
      "  • 20260101_000000_000_init.sql",
      // The file's UP section, as `migrate:down --dry-run` prints a rollback's SQL.
      "    UP, as written in the file:\nSELECT 1;",
    ]);
  });

  it("reads an absent ledger as nothing applied, and creates none", async () => {
    testDb.sqlite.exec("DROP TABLE nextly_schema_events");

    await preview();

    expect(lines[0]).toBe("Pending: 3 migrations");
    expect(await testDb.adapter.tableExists("nextly_schema_events")).toBe(
      false
    );
  });
});
