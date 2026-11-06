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
    declared: Parameters<typeof previewMigrate>[0]["plugins"] = plugins,
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
      plugins: declared,
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

  describe("a column made required", () => {
    // SQLite makes a column NOT NULL by rebuilding its table, as `migrate:create` writes it.
    const rebuildRequired = [
      "CREATE TABLE __new_notes (id TEXT PRIMARY KEY, label TEXT NOT NULL);",
      "INSERT INTO __new_notes (id, label) SELECT id, label FROM notes;",
      "DROP TABLE notes;",
      "ALTER TABLE __new_notes RENAME TO notes;",
    ].join("\n");
    const verdicts = () => lines.filter(line => line.startsWith("    ✖"));

    beforeEach(() => {
      testDb.sqlite.exec(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, label TEXT); INSERT INTO notes VALUES ('n1', NULL)"
      );
    });

    it("is counted for the first pending migration, against the database as it is", async () => {
      rmSync(join(dir, "20260101_000000_000_init.sql"));
      writeFileSync(
        join(dir, "20260102_000000_000_require.sql"),
        `-- UP\n${rebuildRequired}`
      );
      await preview(undefined, []);
      expect(verdicts()).toEqual([
        "    ✖ a real run would refuse it: Table 'notes': column 'label' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the column nullable.",
      ]);
    });

    // The database a later migration meets is the one the migrations before it leave, which a
    // preview runs none of: a fill in an earlier file would read as a refusal of this one.
    it("is not counted for a later one, which says it is counted when the run reaches it", async () => {
      writeFileSync(
        join(dir, "20260102_000000_000_fill.sql"),
        "-- UP\nUPDATE notes SET label = 'filled' WHERE label IS NULL;"
      );
      writeFileSync(
        join(dir, "20260103_000000_000_require.sql"),
        `-- UP\n${rebuildRequired}`
      );
      await preview(undefined, []);
      expect(verdicts()).toEqual([]);
      const at = lines.indexOf("  • 20260103_000000_000_require.sql");
      expect(lines.slice(at + 2)).toEqual([
        "    • its required columns are counted when the run reaches it, after the migrations before it",
      ]);
      // Nothing ran: the row is still null.
      expect(testDb.sqlite.prepare("SELECT label FROM notes").get()).toEqual({
        label: null,
      });
    });

    it("is not counted for an app file the plugins' pending modules run before", async () => {
      rmSync(join(dir, "20260101_000000_000_init.sql"));
      writeFileSync(
        join(dir, "20260102_000000_000_require.sql"),
        `-- UP\n${rebuildRequired}`
      );
      await preview();
      expect(verdicts()).toEqual([]);
      expect(lines).toContain(
        "    • its required columns are counted when the run reaches it, after the migrations before it"
      );
    });
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
