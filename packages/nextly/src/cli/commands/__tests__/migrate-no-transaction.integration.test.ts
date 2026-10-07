/**
 * Migration files and plugin modules marked to run outside a transaction,
 * run by `nextly migrate` on every configured dialect.
 *
 * Each unit runs whole in one transaction unless it is marked: a file by
 * `-- nextly:no-transaction` as its first line, a module by
 * `transaction: false`. A marked unit runs statement by statement, so a
 * statement a transaction refuses can run at all, and a failure part-way
 * leaves the statements before it applied. Asked of the database, because
 * what stayed applied is only visible in the rows.
 *
 * The failing units change rows, not schema: MySQL commits a schema statement
 * as it runs, inside a transaction or not, so only a data statement shows the
 * difference on all three dialects. The table is created before the run.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  migrationChecksum,
  type MigrationContent,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { runFileMigrations, runPluginPhase } from "../migrate";

/** One migration file in the shape `migrate:create` writes, maybe marked. */
function writeMigration(
  dir: string,
  name: string,
  up: string[],
  marked: boolean
): void {
  writeFileSync(
    join(dir, `${name}.sql`),
    `${marked ? "-- nextly:no-transaction\n" : ""}-- Migration: ${name}\n\n-- UP\n${up
      .map(s => `${s};`)
      .join("\n")}\n\n-- DOWN\n`,
    "utf8"
  );
}

/** A module whose UP is `up` on every dialect and changes no table. */
function module(
  name: string,
  up: string[],
  transaction?: boolean
): PluginMigration {
  const none = { tables: [] };
  const sides = { postgresql: none, mysql: none, sqlite: none };
  const statements = { up, down: [] };
  const content: MigrationContent = {
    name,
    schemaVersion: 1,
    ...(transaction === undefined ? {} : { transaction }),
    dialects: {
      postgresql: statements,
      mysql: statements,
      sqlite: statements,
    },
    snapshot: sides,
    before: sides,
  };
  return { ...content, checksum: migrationChecksum(content) };
}

/** Two statements: one that runs, then one that fails on every dialect. */
const FAILS_SECOND = [
  "INSERT INTO nt_marks (id) VALUES ('kept')",
  "INSERT INTO nt_missing (id) VALUES ('never')",
];

describe.each(getConfiguredTestDialects())(
  "a migration marked to run outside a transaction (%s)",
  dialect => {
    let handle: TestNextly;
    let migrationsDir: string;
    let warnings: string[];

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // The ledger, as `nextly migrate` bootstraps it: only when absent.
      if (!(await handle.adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await handle.adapter.executeQuery(statement);
        }
      }
      await handle.adapter.executeQuery(
        "CREATE TABLE nt_marks (id varchar(36) PRIMARY KEY)"
      );
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-no-transaction-"));
      warnings = [];
    });

    afterEach(async () => {
      await handle?.adapter.executeQuery("DROP TABLE IF EXISTS nt_marks");
      await handle?.destroy();
      if (migrationsDir)
        rmSync(migrationsDir, { recursive: true, force: true });
    });

    const logger = () => ({
      ...createLogger({ quiet: true }),
      warn: (message: string) => {
        warnings.push(message);
      },
    });

    function migrate() {
      return runFileMigrations({
        adapter: handle.adapter as unknown as Parameters<
          typeof runFileMigrations
        >[0]["adapter"],
        db: handle.adapter.getDrizzle(),
        dialect,
        migrationsDir,
        logger: logger(),
      });
    }

    function migratePlugin(migrations: PluginMigration[]) {
      return runPluginPhase({
        extensionSchema: undefined,
        dialect,
        db: handle.adapter.getDrizzle(),
        adapter: handle.adapter as unknown as Parameters<
          typeof runPluginPhase
        >[0]["adapter"],
        migrationsDir: "unused",
        logger: logger(),
        pluginMigrationSets: [
          { pluginName: "ntx", pluginVersion: "1.0.0", migrations },
        ],
      });
    }

    async function marks(): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        "SELECT id FROM nt_marks"
      )) as Array<{ id: string }>;
      return rows.map(row => row.id).sort();
    }

    async function ledgerStatus(filename: string) {
      const rows = await new SchemaEventsRepository(
        handle.adapter.getDrizzle(),
        dialect
      ).listFileApplies();
      return rows
        .filter(row => row.filename === filename)
        .map(row => row.status);
    }

    it("leaves what ran before the failing statement of a marked file", async () => {
      writeMigration(
        migrationsDir,
        "20261001_000001_marks",
        FAILS_SECOND,
        true
      );

      await expect(migrate()).rejects.toThrow(
        /20261001_000001_marks\.sql ran outside a transaction, and its statement 2 of 2 failed: .*The 1 statement\(s\) before it stayed applied, and were not undone/
      );

      expect(await marks()).toEqual(["kept"]);
      expect(await ledgerStatus("20261001_000001_marks.sql")).toEqual([
        "failed",
      ]);
      // The run said which file had no all-or-nothing guarantee.
      expect(warnings.join("\n")).toContain(
        "20261001_000001_marks.sql runs outside a transaction"
      );
    });

    it("rolls back the same file unmarked, leaving nothing", async () => {
      writeMigration(
        migrationsDir,
        "20261001_000001_marks",
        FAILS_SECOND,
        false
      );

      await expect(migrate()).rejects.toThrow();

      expect(await marks()).toEqual([]);
      expect(warnings.join("\n")).not.toContain("outside a transaction");
    });

    it("refuses a marked file's own BEGIN and COMMIT, before anything runs", async () => {
      writeMigration(
        migrationsDir,
        "20261001_000001_bracketed",
        ["BEGIN", "INSERT INTO nt_marks (id) VALUES ('kept')", "COMMIT"],
        true
      );

      await expect(migrate()).rejects.toThrow(
        /20261001_000001_bracketed\.sql was refused, and nothing in it ran\. "BEGIN" opens or ends a transaction.*It needs a transaction, and this file runs outside one: move it to a file without `-- nextly:no-transaction` as its first line/
      );

      expect(await marks()).toEqual([]);
      // Refused before the ledger records an attempt.
      expect(await ledgerStatus("20261001_000001_bracketed.sql")).toEqual([]);
    });

    it("refuses a savepoint in a module marked transaction: false, before anything runs", async () => {
      await expect(
        migratePlugin([
          module(
            "0001_savepoint",
            ["SAVEPOINT s1", "INSERT INTO nt_marks (id) VALUES ('kept')"],
            false
          ),
        ])
      ).rejects.toThrow(
        /plugin:ntx\/0001_savepoint was refused, and nothing in it ran\. "SAVEPOINT s1" marks or returns to a savepoint.*move it to a module without `transaction: false`/
      );

      expect(await marks()).toEqual([]);
      expect(await ledgerStatus("plugin:ntx/0001_savepoint")).toEqual([]);
    });

    it("leaves what ran before the failing statement of a module marked transaction: false", async () => {
      const marked = module("0001_marks", FAILS_SECOND, false);

      await expect(migratePlugin([marked])).rejects.toThrow(
        /ran outside a transaction, and its statement 2 of 2 failed/
      );

      expect(await marks()).toEqual(["kept"]);
      expect(warnings.join("\n")).toContain(
        "plugin:ntx/0001_marks runs outside a transaction"
      );
    });

    it("rolls back the same module unmarked, leaving nothing", async () => {
      await expect(
        migratePlugin([module("0001_marks", FAILS_SECOND)])
      ).rejects.toThrow();

      expect(await marks()).toEqual([]);
    });

    if (dialect === "sqlite") {
      async function foreignKeysOn(): Promise<boolean> {
        const [row] = (await handle.adapter.executeQuery(
          "PRAGMA foreign_keys"
        )) as Array<{ foreign_keys: number }>;
        return Number(row?.foreign_keys) === 1;
      }

      /** A parent with one row, and a child whose row cascades from it. */
      async function parentAndChild(): Promise<void> {
        await handle.adapter.executeQuery("PRAGMA foreign_keys = ON");
        await handle.adapter.executeQuery(
          "CREATE TABLE nt_parent (id text PRIMARY KEY)"
        );
        await handle.adapter.executeQuery(
          "CREATE TABLE nt_child (id text PRIMARY KEY, parent_id text REFERENCES nt_parent (id) ON DELETE CASCADE)"
        );
        await handle.adapter.executeQuery(
          "INSERT INTO nt_parent (id) VALUES ('p1')"
        );
        await handle.adapter.executeQuery(
          "INSERT INTO nt_child (id, parent_id) VALUES ('c1', 'p1')"
        );
      }

      afterEach(async () => {
        await handle?.adapter.executeQuery("DROP TABLE IF EXISTS nt_child");
        await handle?.adapter.executeQuery("DROP TABLE IF EXISTS nt_parent");
      });

      it("leaves foreign keys on after a marked file fails", async () => {
        await handle.adapter.executeQuery("PRAGMA foreign_keys = ON");
        writeMigration(
          migrationsDir,
          "20261001_000001_marks",
          FAILS_SECOND,
          true
        );

        await expect(migrate()).rejects.toThrow(
          /ran outside a transaction, and its statement 2 of 2 failed/
        );

        expect(await foreignKeysOn()).toBe(true);
      });

      it("rebuilds a parent table in a marked file without cascading into its children", async () => {
        await parentAndChild();
        writeMigration(
          migrationsDir,
          "20261001_000001_rebuild",
          [
            "CREATE TABLE __new_nt_parent (id text PRIMARY KEY, label text)",
            "INSERT INTO __new_nt_parent (id) SELECT id FROM nt_parent",
            "DROP TABLE nt_parent",
            "ALTER TABLE __new_nt_parent RENAME TO nt_parent",
          ],
          true
        );

        await expect(migrate()).resolves.toBe(1);

        const children = (await handle.adapter.executeQuery(
          "SELECT id FROM nt_child"
        )) as Array<{ id: string }>;
        expect(children.map(row => row.id)).toEqual(["c1"]);
        expect(await foreignKeysOn()).toBe(true);
      });

      it("refuses a marked file that leaves a dangling reference, with its statements kept", async () => {
        await parentAndChild();
        writeMigration(
          migrationsDir,
          "20261001_000001_orphan",
          ["DELETE FROM nt_parent"],
          true
        );

        await expect(migrate()).rejects.toThrow(
          /20261001_000001_orphan\.sql ran outside a transaction, and left 1 row\(s\) referencing rows that do not exist \(nt_child → nt_parent\)\. Its statements stayed applied: repair or remove those rows, then mark it applied with `nextly migrate:resolve --applied 20261001_000001_orphan\.sql`/
        );

        // Enforcement was off, so the child row was not cascaded away; the
        // parent's delete stayed applied, and the ledger records the failure.
        const children = (await handle.adapter.executeQuery(
          "SELECT id FROM nt_child"
        )) as Array<{ id: string }>;
        expect(children.map(row => row.id)).toEqual(["c1"]);
        expect(
          await handle.adapter.executeQuery("SELECT id FROM nt_parent")
        ).toEqual([]);
        expect(await ledgerStatus("20261001_000001_orphan.sql")).toEqual([
          "failed",
        ]);
        expect(await foreignKeysOn()).toBe(true);
      });
    }

    if (dialect === "postgresql") {
      const concurrently =
        "CREATE INDEX CONCURRENTLY nt_marks_id_idx ON nt_marks (id)";

      async function indexIsValid(): Promise<boolean | undefined> {
        const rows = (await handle.adapter.executeQuery(
          "SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'nt_marks_id_idx'"
        )) as Array<{ valid: boolean }>;
        return rows[0]?.valid;
      }

      it("builds an index concurrently in a marked file", async () => {
        writeMigration(
          migrationsDir,
          "20261001_000001_index",
          [concurrently],
          true
        );

        await expect(migrate()).resolves.toBe(1);

        expect(await indexIsValid()).toBe(true);
        expect(await ledgerStatus("20261001_000001_index.sql")).toEqual([
          "applied",
        ]);
      });

      it("refuses the same file unmarked, before anything runs, naming the marker", async () => {
        writeMigration(
          migrationsDir,
          "20261001_000001_index",
          [concurrently],
          false
        );

        await expect(migrate()).rejects.toThrow(
          /20261001_000001_index\.sql was refused, and nothing in it ran\..*make `-- nextly:no-transaction` the file's first line/
        );
        expect(await indexIsValid()).toBeUndefined();
      });

      it("builds an index concurrently in a module marked transaction: false", async () => {
        await migratePlugin([module("0001_index", [concurrently], false)]);

        expect(await indexIsValid()).toBe(true);
        expect(await ledgerStatus("plugin:ntx/0001_index")).toEqual([
          "applied",
        ]);
      });
    }
  }
);
