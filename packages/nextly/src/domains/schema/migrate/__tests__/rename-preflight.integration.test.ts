/**
 * `nextly migrate` applying a file that renames a column or a table onto one that is already
 * there, on every dialect, through the real command core (`migrateCore`) and a migrations folder
 * of the test's own.
 *
 * - A column renamed onto a column the table has, and a table renamed onto a table that exists:
 *   refused before any statement of the run, naming the file, the table and both names. The
 *   ledger records nothing, both names stay, and the value is read under the old name. A
 *   statement on another table before the rename did not run either: on MySQL, which commits each
 *   schema statement as it runs, the database's own refusal used to leave it applied.
 * - `migrate --dry-run` names the refusal.
 * - Controls: a rename onto a free name runs and the value follows; a rename already made (the old
 *   name gone, the new one there) is not refused; a file that drops the column in the way before
 *   renaming onto it runs, since a rename after another change to its table in the run is not
 *   judged.
 *
 * The file is written by `migrate:create`'s own formatter. Each test runs on a database of its
 * own, because each runs the whole command.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  migrateCore,
  pendingPluginDeletions,
  previewMigrate,
} from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { NextlyError } from "../../../../errors/nextly-error";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { ensureSchemaEventsTable } from "../../events/schema-events-ddl";
import { formatMigrationFile } from "../../migrate-create/format-file";
import { NO_CONSENT, resolveDataLossConsent } from "../data-loss-consent";
import { SchemaOwnersRepository } from "../../ownership/schema-owners-repository";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { queryLiveColumnTypes } from "../../pipeline/live-column-types";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import {
  migrationChecksum,
  type MigrationContent,
} from "../plugin/plugin-migration";
import { renamesOntoTakenTargets } from "../rename-preflight";
import { readIdentifierCaseRules } from "../../utils/read-identifier-case";

const logger = createLogger({ quiet: true });
const NAME = "20261111_000001_rename";
const FILE = `${NAME}.sql`;

// Test-owned tables, under this file's prefix.
const NOTES = "rtp_notes";
const OTHER = "rtp_other";
const ARCHIVE = "rtp_archive";

describe.each(LOCK_DIALECTS)(
  "nextly migrate renaming onto a name already there on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    let acceptAll: boolean;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const id = dialect === "mysql" ? "varchar(36)" : "text";

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-rename-preflight-"));
      acceptAll = false;
      // Nextly's own tables, so the file is all a run has left to do.
      await migrate();
      await run([
        `CREATE TABLE ${q(NOTES)} (${q("id")} ${id} PRIMARY KEY, ${q("heading")} text, ${q("headline")} text)`,
        `CREATE TABLE ${q(OTHER)} (${q("id")} ${id} PRIMARY KEY)`,
        `CREATE TABLE ${q(ARCHIVE)} (${q("id")} ${id} PRIMARY KEY)`,
        `INSERT INTO ${q(NOTES)} (${q("id")}, ${q("heading")}, ${q("headline")}) VALUES ('n1', 'Kept', 'Other')`,
      ]);
    }, 120_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    function migrate(extra: Partial<Parameters<typeof migrateCore>[0]> = {}) {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
        consent: acceptAll
          ? resolveDataLossConsent({ flag: true, env: {} })
          : NO_CONSENT,
        ...extra,
      });
    }

    /** Plugin `rtx` with one pending module whose UP is `up` on every dialect. */
    function pluginSet(up: string[]) {
      const none = { tables: [] };
      const sides = { postgresql: none, mysql: none, sqlite: none };
      const content: MigrationContent = {
        name: "20261111_000002_rtx_rename",
        schemaVersion: 1,
        dialects: {
          postgresql: { up, down: [] },
          mysql: { up, down: [] },
          sqlite: { up, down: [] },
        },
        snapshot: sides,
        before: sides,
      };
      return [
        {
          pluginName: "rtx",
          pluginVersion: "1.0.0",
          migrations: [{ ...content, checksum: migrationChecksum(content) }],
        },
      ];
    }

    /** `tables` as plugin `rtx`'s own, as its earlier module recorded them: a plugin changes only what it owns. */
    async function ownedByPlugin(tables: string[]): Promise<void> {
      await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert(
        tables.map(tableName => ({
          tableName,
          ownerKind: "plugin" as const,
          ownerId: "rtx",
          migratedBy: "plugin:rtx",
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "active" as const,
        }))
      );
    }

    async function run(statements: string[]): Promise<void> {
      for (const statement of statements) await adapter.executeQuery(statement);
    }

    /** The file as `migrate:create` writes it. */
    function writeFile(statements: string[]): void {
      writeFileSync(
        join(migrationsDir, FILE),
        formatMigrationFile({
          name: NAME,
          dialect,
          sqlStatements: statements,
          downSqlStatements: [],
          collections: [],
          singles: [],
          components: [],
          hasUserExt: false,
        }),
        "utf8"
      );
    }

    async function refusal(): Promise<NextlyError> {
      const error = await migrate().then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(error)).toBe(true);
      return error as NextlyError;
    }

    /** The refusal's entries, or the error's own code and message when it carries none. */
    function entries(error: NextlyError) {
      const data = error.publicData as
        | { errors?: Array<{ path: string; code: string; message: string }> }
        | undefined;
      return (
        data?.errors ?? [{ code: error.code, message: error.publicMessage }]
      );
    }

    async function ledger(): Promise<string[]> {
      const rows = await new SchemaEventsRepository(
        adapter.getDrizzle(),
        dialect
      ).findFileApplies(FILE);
      return rows.map(row => row.status);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const live = await queryLiveColumnTypes(adapter.getDrizzle(), dialect, [
        table,
      ]);
      return [...(live.get(table)?.keys() ?? [])].sort();
    }

    async function tableExists(table: string): Promise<boolean> {
      return (
        await queryLiveColumnTypes(adapter.getDrizzle(), dialect, [table])
      ).has(table);
    }

    async function valueOf(column: string): Promise<unknown> {
      const [row] = await adapter.executeQuery<{ v: unknown }>(
        `SELECT ${q(column)} AS v FROM ${q(NOTES)}`
      );
      return row?.v;
    }

    /** Whether this server compares table names by their case: MySQL with `lower_case_table_names=0`. */
    async function tablesKeepCase(): Promise<boolean> {
      if (dialect !== "mysql") return false;
      const rules = await readIdentifierCaseRules({
        dialect,
        getDrizzle: <T>() => adapter.getDrizzle() as T,
      });
      return rules.tables === "preserve";
    }

    const renameColumn = (from: string, to: string) =>
      `ALTER TABLE ${q(NOTES)} RENAME COLUMN ${q(from)} TO ${q(to)}`;

    it("refuses a column renamed onto one the table has, before any statement of the run", async () => {
      writeFile([
        `ALTER TABLE ${q(OTHER)} ADD COLUMN ${q("extra")} text`,
        renameColumn("heading", "headline"),
      ]);
      const notesBefore = await columnsOf(NOTES);

      const error = await refusal();

      // What the database holds first: the statement before the rename, on another table, did
      // not run, which MySQL would otherwise have committed before the rename failed.
      expect(await columnsOf(OTHER)).toEqual(["id"]);
      expect(await ledger()).toEqual([]);
      expect(await columnsOf(NOTES)).toEqual(notesBefore);
      expect(await valueOf("heading")).toBe("Kept");
      expect(entries(error)).toEqual([
        {
          path: FILE,
          code: "RENAME_TARGET_TAKEN",
          message: `Column 'heading' cannot be renamed to 'headline': table '${NOTES}' already has a column 'headline'.`,
        },
      ]);
      expect(error.publicMessage).toContain(
        "refused before any of its statements ran"
      );
    });

    it("refuses a table renamed onto a table that exists, where the server's table names are judged", async () => {
      const statement = `ALTER TABLE ${q(NOTES)} RENAME TO ${q(ARCHIVE)}`;
      writeFile([statement]);
      if (await tablesKeepCase()) {
        // A MySQL server comparing table names by case: a statement's names are read lower-cased,
        // so the check steps aside and the database refuses the rename when it runs.
        expect(
          await renamesOntoTakenTargets(
            [{ label: FILE, statements: [statement] }],
            adapter.getDrizzle(),
            dialect
          )
        ).toEqual([]);
        return;
      }

      const error = await refusal();

      expect(await ledger()).toEqual([]);
      expect(await valueOf("heading")).toBe("Kept");
      expect(await columnsOf(ARCHIVE)).toEqual(["id"]);
      expect(entries(error)).toEqual([
        {
          path: FILE,
          code: "RENAME_TARGET_TAKEN",
          message: `Table '${NOTES}' cannot be renamed to '${ARCHIVE}': a table '${ARCHIVE}' already exists.`,
        },
      ]);
    });

    it("names the refusal in a dry run, changing nothing", async () => {
      writeFile([renameColumn("heading", "headline")]);
      const lines: string[] = [];

      await previewMigrate({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect,
        migrationsDir,
        plugins: [],
        logger: {
          ...logger,
          info: (m: string) => {
            lines.push(m);
          },
        } as never,
      });

      expect(lines).toContain(
        `  ✖ a real run would refuse ${FILE}: Column 'heading' cannot be renamed to 'headline': table '${NOTES}' already has a column 'headline'.`
      );
      expect(await ledger()).toEqual([]);
      expect(await valueOf("heading")).toBe("Kept");
    });

    // A plugin's module runs before the app's files, through the same runner, so its renames are
    // judged with the run's.
    it("refuses a plugin's module renaming a column onto one its table has, before any statement", async () => {
      await ownedByPlugin([NOTES, OTHER]);

      const error = await migrate({
        pluginMigrationSets: pluginSet([
          `ALTER TABLE ${q(OTHER)} ADD COLUMN ${q("extra")} text`,
          renameColumn("heading", "headline"),
        ]),
      }).then(
        () => undefined,
        (thrown: unknown) => thrown
      );

      expect(NextlyError.is(error)).toBe(true);
      expect(await columnsOf(OTHER)).toEqual(["id"]);
      expect(await valueOf("heading")).toBe("Kept");
      expect(entries(error as NextlyError)).toEqual([
        {
          path: expect.stringContaining("rtx"),
          code: "RENAME_TARGET_TAKEN",
          message: `Column 'heading' cannot be renamed to 'headline': table '${NOTES}' already has a column 'headline'.`,
        },
      ]);
    });

    // `--step` counts a plugin's modules first: a file the step leaves for a later run is not
    // judged by this one, so the plugin's module still runs on its own.
    it("does not refuse a file the step leaves for a later run", async () => {
      await ownedByPlugin([OTHER]);
      writeFile([renameColumn("heading", "headline")]);

      await migrate({
        step: 1,
        pluginMigrationSets: pluginSet([
          `ALTER TABLE ${q(OTHER)} ADD COLUMN ${q("extra")} text`,
        ]),
      });

      expect(await columnsOf(OTHER)).toEqual(["extra", "id"]);
      expect(await ledger()).toEqual([]);
      expect(await valueOf("heading")).toBe("Kept");
    });

    // MySQL renames the pairs of one RENAME TABLE in order, so a swap through a spare name runs;
    // a pair after another of the same name is not judged against the database as it was.
    it.runIf(dialect === "mysql")(
      "runs a swap of two tables' names through a spare one",
      async () => {
        writeFile([
          `RENAME TABLE ${q(NOTES)} TO ${q("rtp_spare")}, ${q(ARCHIVE)} TO ${q(NOTES)}, ${q("rtp_spare")} TO ${q(ARCHIVE)}`,
        ]);

        await migrate();

        expect(await ledger()).toEqual(["applied"]);
        expect(await columnsOf(ARCHIVE)).toEqual(["heading", "headline", "id"]);
        expect(await columnsOf(NOTES)).toEqual(["id"]);
      }
    );

    // PostgreSQL's search_path decides which table an unqualified name reaches, so a rename after
    // a statement setting it is not judged against the tables the run started with.
    it.runIf(dialect === "postgresql")(
      "does not judge a rename after search_path is set, and judges one after another setting",
      async () => {
        const after = (setting: string) =>
          renamesOntoTakenTargets(
            [
              {
                label: FILE,
                statements: [setting, renameColumn("heading", "headline")],
              },
            ],
            adapter.getDrizzle(),
            dialect
          );

        expect(
          await after(`SET LOCAL search_path TO rtp_side, public`)
        ).toEqual([]);
        expect(await after(`SET LOCAL statement_timeout = 0`)).toHaveLength(1);
      }
    );

    // MySQL and SQLite compare names without regard to case, quoted or not.
    it.runIf(dialect !== "postgresql")(
      "refuses a rename spelled in another case onto a column the table has",
      async () => {
        writeFile([
          `ALTER TABLE ${q(NOTES)} RENAME COLUMN ${q("Heading")} TO ${q("HeadLine")}`,
        ]);

        const error = await refusal();

        expect(await ledger()).toEqual([]);
        expect(await valueOf("heading")).toBe("Kept");
        expect(entries(error)).toEqual([
          {
            path: FILE,
            code: "RENAME_TARGET_TAKEN",
            message: `Column 'heading' cannot be renamed to 'headline': table '${NOTES}' already has a column 'headline'.`,
          },
        ]);
      }
    );

    // PostgreSQL gives a table the name space of every relation in its schema, and SQLite one name
    // space for the whole database: an index holds a name a table cannot take.
    it.runIf(dialect !== "mysql")(
      "refuses a table renamed onto an index's name",
      async () => {
        await run([
          `CREATE INDEX ${q("rtp_held")} ON ${q(OTHER)} (${q("id")})`,
        ]);
        writeFile([`ALTER TABLE ${q(NOTES)} RENAME TO ${q("rtp_held")}`]);

        const error = await refusal();

        expect(await ledger()).toEqual([]);
        expect(await valueOf("heading")).toBe("Kept");
        expect(entries(error)).toEqual([
          {
            path: FILE,
            code: "RENAME_TARGET_TAKEN",
            message: `Table '${NOTES}' cannot be renamed to 'rtp_held': an index 'rtp_held' already exists.`,
          },
        ]);
      }
    );

    // An install applies a plugin's modules through the same phase as `nextly migrate`, after
    // reading what they delete (`pendingPluginDeletions`), so their renames are judged there too.
    it("refuses an install's module renaming a column onto one its table has, before it applies", async () => {
      const error = await pendingPluginDeletions(
        pluginSet([renameColumn("heading", "headline")]),
        { adapter: adapter as never, db: adapter.getDrizzle(), dialect }
      ).then(
        () => undefined,
        (thrown: unknown) => thrown
      );

      expect(NextlyError.is(error)).toBe(true);
      expect(entries(error as NextlyError)).toEqual([
        {
          path: expect.stringContaining("rtx"),
          code: "RENAME_TARGET_TAKEN",
          message: `Column 'heading' cannot be renamed to 'headline': table '${NOTES}' already has a column 'headline'.`,
        },
      ]);
      expect(await valueOf("heading")).toBe("Kept");
    });

    // PostgreSQL and SQLite give a table the name space of indexes too: a run that drops the index
    // holding a name before a table takes it would run, so it is not refused.
    it.runIf(dialect !== "mysql")(
      "runs a table rename onto an index's name after the run drops the index",
      async () => {
        await run([
          `CREATE INDEX ${q("rtp_held")} ON ${q(OTHER)} (${q("id")})`,
        ]);
        writeFile([
          `DROP INDEX ${q("rtp_held")}`,
          `ALTER TABLE ${q(NOTES)} RENAME TO ${q("rtp_held")}`,
        ]);

        await migrate();

        expect(await ledger()).toEqual(["applied"]);
        expect(await tableExists("rtp_held")).toBe(true);
        expect(await tableExists(NOTES)).toBe(false);
      }
    );

    // `SET SCHEMA` is PostgreSQL's alias for setting search_path.
    it.runIf(dialect === "postgresql")(
      "does not judge a rename after SET SCHEMA",
      async () => {
        expect(
          await renamesOntoTakenTargets(
            [
              {
                label: FILE,
                statements: [
                  `SET SCHEMA 'rtp_side'`,
                  renameColumn("heading", "headline"),
                ],
              },
            ],
            adapter.getDrizzle(),
            dialect
          )
        ).toEqual([]);
      }
    );

    // A PostgreSQL table may have no column, so it is found in the catalog rather than among the
    // tables with columns.
    it.runIf(dialect === "postgresql")(
      "refuses a table with no column renamed onto a table that exists",
      async () => {
        await run([`CREATE TABLE ${q("rtp_bare")} ()`]);
        writeFile([`ALTER TABLE ${q("rtp_bare")} RENAME TO ${q(ARCHIVE)}`]);

        const error = await refusal();

        expect(await ledger()).toEqual([]);
        expect(await columnsOf(ARCHIVE)).toEqual(["id"]);
        expect(entries(error)).toEqual([
          {
            path: FILE,
            code: "RENAME_TARGET_TAKEN",
            message: `Table 'rtp_bare' cannot be renamed to '${ARCHIVE}': a table '${ARCHIVE}' already exists.`,
          },
        ]);
      }
    );

    // A MySQL server comparing table names by case keeps `RTP_ARCHIVE` apart from `rtp_archive`,
    // so the rename runs; one folding them refuses it before the run.
    it.runIf(dialect === "mysql")(
      "judges a table rename onto a name in another case as the server compares table names",
      async () => {
        writeFile([`RENAME TABLE ${q(NOTES)} TO ${q("RTP_ARCHIVE")}`]);

        if (await tablesKeepCase()) {
          await migrate();
          expect(await ledger()).toEqual(["applied"]);
          const [row] = await adapter.executeQuery<{ v: unknown }>(
            `SELECT ${q("heading")} AS v FROM ${q("RTP_ARCHIVE")}`
          );
          expect(row?.v).toBe("Kept");
          return;
        }
        const error = await refusal();
        expect(entries(error)).toEqual([
          expect.objectContaining({ code: "RENAME_TARGET_TAKEN" }),
        ]);
      }
    );

    // A rename naming the one identifier twice changes nothing, and SQLite runs it: its new name is
    // the column it renames, never one in the way.
    it("does not judge a rename onto the name it already has", async () => {
      const same = [
        renameColumn("heading", "heading"),
        renameColumn(
          "heading",
          dialect === "postgresql" ? "heading" : "HEADING"
        ),
      ];
      expect(
        await renamesOntoTakenTargets(
          [{ label: FILE, statements: same }],
          adapter.getDrizzle(),
          dialect
        )
      ).toEqual([]);
      if (dialect === "sqlite") {
        writeFile([renameColumn("heading", "heading")]);
        await migrate();
        expect(await ledger()).toEqual(["applied"]);
        expect(await valueOf("heading")).toBe("Kept");
      }
    });

    // A `$user` in PostgreSQL's search path follows the role, so a rename after the role changes
    // is not judged against the tables the run started with.
    it.runIf(dialect === "postgresql")(
      "does not judge a rename after SET ROLE or SET SESSION AUTHORIZATION",
      async () => {
        for (const setting of [
          `SET ROLE postgres`,
          `SET SESSION AUTHORIZATION postgres`,
        ]) {
          expect(
            await renamesOntoTakenTargets(
              [
                {
                  label: FILE,
                  statements: [setting, renameColumn("heading", "headline")],
                },
              ],
              adapter.getDrizzle(),
              dialect
            )
          ).toEqual([]);
        }
      }
    );

    // A run may find a dev push already standing at a later module's snapshot and adopt the modules
    // without running them, so a module's rename whose two names a snapshot holds together is not
    // judged.
    it("does not refuse a plugin's module a run would adopt at a later module's snapshot", async () => {
      const columns = (...names: string[]) =>
        names.map(name => ({ name, type: "text", nullable: true }));
      const module = (
        name: string,
        up: string[],
        tables: { name: string; columns: { name: string }[] }[]
      ) => {
        const snapshot = { tables } as never;
        const none = { tables: [] } as never;
        const content: MigrationContent = {
          name,
          schemaVersion: 1,
          dialects: {
            postgresql: { up, down: [] },
            mysql: { up, down: [] },
            sqlite: { up, down: [] },
          },
          snapshot: { postgresql: snapshot, mysql: snapshot, sqlite: snapshot },
          before: { postgresql: none, mysql: none, sqlite: none },
        };
        return { ...content, checksum: migrationChecksum(content) };
      };
      const sets = [
        {
          pluginName: "rtx",
          pluginVersion: "1.0.0",
          migrations: [
            module(
              "20261111_000003_rename",
              [renameColumn("heading", "headline")],
              [{ name: NOTES, columns: columns("id", "headline") }]
            ),
            module(
              "20261111_000004_heading_again",
              [`ALTER TABLE ${q(NOTES)} ADD COLUMN ${q("heading")} text`],
              [{ name: NOTES, columns: columns("id", "heading", "headline") }]
            ),
          ],
        },
      ];

      await expect(
        pendingPluginDeletions(sets, {
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
        })
      ).resolves.toBeDefined();
    });

    // `--step 1` reaches only the first module, but a run looks for where the database stands over
    // the plugin's whole history first: standing at the second module's snapshot, it adopts the
    // first without running its rename.
    it("does not refuse a module within the step that a run adopts at a snapshot past it", async () => {
      await ownedByPlugin([NOTES]);
      const [live] = (
        await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [NOTES])
      ).tables;
      const at = (spec: typeof live) => ({
        postgresql: { tables: [spec] },
        mysql: { tables: [spec] },
        sqlite: { tables: [spec] },
      });
      const nothing = { tables: [] };
      const sides = { postgresql: nothing, mysql: nothing, sqlite: nothing };
      const afterRename = {
        ...live,
        columns: live.columns.filter(column => column.name !== "heading"),
      };
      const module = (
        name: string,
        up: string[],
        before: ReturnType<typeof at> | typeof sides,
        snapshot: ReturnType<typeof at>
      ) => {
        const content: MigrationContent = {
          name,
          schemaVersion: 1,
          dialects: {
            postgresql: { up, down: [] },
            mysql: { up, down: [] },
            sqlite: { up, down: [] },
          },
          snapshot,
          before,
        };
        return { ...content, checksum: migrationChecksum(content) };
      };

      await migrate({
        step: 1,
        pluginMigrationSets: [
          {
            pluginName: "rtx",
            pluginVersion: "1.0.0",
            migrations: [
              module(
                "20261111_000005_rename",
                [renameColumn("heading", "headline")],
                sides,
                at(afterRename)
              ),
              module(
                "20261111_000006_heading_again",
                [`ALTER TABLE ${q(NOTES)} ADD COLUMN ${q("heading")} text`],
                at(afterRename),
                at(live)
              ),
            ],
          },
        ],
      });

      expect(await valueOf("heading")).toBe("Kept");
      expect(await columnsOf(NOTES)).toEqual(["heading", "headline", "id"]);
    });

    // SQLite keeps a trigger's name apart from a table's.
    it.runIf(dialect === "sqlite")(
      "runs a table rename onto a trigger's name",
      async () => {
        await run([
          `CREATE TRIGGER ${q("rtp_trig")} AFTER INSERT ON ${q(OTHER)} BEGIN SELECT 1; END`,
        ]);
        writeFile([`ALTER TABLE ${q(NOTES)} RENAME TO ${q("rtp_trig")}`]);

        await migrate();

        expect(await ledger()).toEqual(["applied"]);
        expect(await tableExists("rtp_trig")).toBe(true);
      }
    );

    // `ALTER TABLE … SET SCHEMA` takes a table's indexes with it, freeing their names here.
    it.runIf(dialect === "postgresql")(
      "runs a table rename onto the name of an index moved away with its table",
      async () => {
        await run([
          `CREATE SCHEMA ${q("rtp_away")}`,
          `CREATE INDEX ${q("rtp_moved")} ON ${q(OTHER)} (${q("id")})`,
        ]);
        writeFile([
          `ALTER TABLE ${q(OTHER)} SET SCHEMA ${q("rtp_away")}`,
          `ALTER TABLE ${q(NOTES)} RENAME TO ${q("rtp_moved")}`,
        ]);

        await migrate();

        expect(await ledger()).toEqual(["applied"]);
        expect(await tableExists("rtp_moved")).toBe(true);
      }
    );

    // Controls.

    it("runs a rename onto a free name, and the value follows", async () => {
      writeFile([renameColumn("heading", "title")]);

      await migrate();

      expect(await ledger()).toEqual(["applied"]);
      expect(await valueOf("title")).toBe("Kept");
    });

    it("does not refuse a rename this database already made", async () => {
      await run([
        `ALTER TABLE ${q(NOTES)} DROP COLUMN ${q("headline")}`,
        renameColumn("heading", "headline"),
      ]);

      expect(
        await renamesOntoTakenTargets(
          [
            {
              label: FILE,
              statements: [renameColumn("heading", "headline")],
            },
          ],
          adapter.getDrizzle(),
          dialect
        )
      ).toEqual([]);
      expect(await tableExists(NOTES)).toBe(true);
    });

    it("runs a file that drops the column in the way before renaming onto it", async () => {
      acceptAll = true;
      writeFile([
        `ALTER TABLE ${q(NOTES)} DROP COLUMN ${q("headline")}`,
        renameColumn("heading", "headline"),
      ]);

      await migrate();

      expect(await ledger()).toEqual(["applied"]);
      expect(await valueOf("headline")).toBe("Kept");
    });
  }
);
