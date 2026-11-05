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
  return sealedModule(name, [`-- ${name}`]);
}

/** A sealed module whose UP runs `up` on every dialect. */
function sealedModule(name: string, up: string[]): PluginMigration {
  const statements = { up, down: [] };
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
        // In name order, as a plugin must list them
        // (`assertModulesInNameOrder`).
        migrations: [blankModule("001_init"), blankModule("002_more")],
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

  function preview(
    step?: number,
    planned: Parameters<typeof previewMigrate>[0]["plugins"] = plugins,
    readEventTriggers?: () => Promise<readonly string[]>
  ): Promise<void> {
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
      plugins: planned,
      step,
      readEventTriggers,
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

  it("lists what a pending module deletes, and judges the app's files after it", async () => {
    // A real run judges the modules and the files as one run, modules first:
    // the dry run shows the same deletions and consent.
    testDb.sqlite.exec("CREATE TABLE app_notes (id INTEGER)");
    testDb.sqlite.exec("INSERT INTO app_notes (id) VALUES (1)");
    writeFileSync(
      join(dir, "20260101_000000_000_init.sql"),
      "-- UP\nDELETE FROM acme_notes;"
    );
    const deleting = [
      {
        name: "acme",
        version: "1.0.0",
        contributes: {
          schema: {
            migrations: [
              sealedModule("001_init", [
                "CREATE TABLE acme_notes (id INTEGER)",
              ]),
              sealedModule("002_more", ["DROP TABLE app_notes"]),
            ],
          },
        },
      },
    ] as unknown as Parameters<typeof previewMigrate>[0]["plugins"];

    await preview(undefined, deleting);

    const more = lines.indexOf("  • plugin:acme/002_more");
    expect(lines[more + 1]).toMatch(
      /^ {4}⚠ deletes data: table app_notes\. A real run needs .*app_notes/
    );
    // The file deletes rows only from the table the module before it creates.
    expect(lines.join("\n")).not.toMatch(/deletes data:.*acme_notes/);
  });

  it("names the database's DDL event triggers, whose effects it cannot list", async () => {
    await preview(undefined, plugins, async () => ["audit_ddl"]);

    expect(lines).toContain(
      "  ⚠ This database has the DDL event trigger audit_ddl: it runs on schema changes, and Nextly cannot see what it does, so what it deletes is not listed."
    );
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
