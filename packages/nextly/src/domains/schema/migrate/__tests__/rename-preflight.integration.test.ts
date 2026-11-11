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

import { migrateCore, previewMigrate } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { NextlyError } from "../../../../errors/nextly-error";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { ensureSchemaEventsTable } from "../../events/schema-events-ddl";
import { formatMigrationFile } from "../../migrate-create/format-file";
import { NO_CONSENT, resolveDataLossConsent } from "../data-loss-consent";
import { queryLiveColumnTypes } from "../../pipeline/live-column-types";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { renamesOntoTakenTargets } from "../rename-preflight";

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

    function migrate() {
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
      });
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

    it("refuses a table renamed onto a table that exists", async () => {
      writeFile([`ALTER TABLE ${q(NOTES)} RENAME TO ${q(ARCHIVE)}`]);

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
