/**
 * An applied app migration carries the checksum of its file's whole text, and
 * a file edited after it ran stops `nextly migrate` before it changes
 * anything, on PostgreSQL, MySQL and SQLite.
 *
 * - `nextly migrate` and `migrate:resolve --applied` record the checksum.
 * - An edit to an applied file's UP, or to its down section alone, is refused
 *   with `MIGRATION_TAMPERED` (exit code 2), naming every edited file, with
 *   the schema and the ledger as they were.
 * - `migrate:resolve --applied` accepts an intended edit: it records the new
 *   checksum, and later runs go on; `migrate:status` reads the file applied,
 *   not modified.
 * - A row an earlier version recorded without a checksum, or with the text
 *   `null` an earlier ledger backfill wrote, is taken as matching, and the
 *   run records the file's checksum on it.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../../domains/schema/events/schema-events-repository";
import { checksumOf } from "../../../domains/schema/migrate/applied-checksums";
import { resolveMigration } from "../../../domains/schema/migrate/resolve";
import { marksNoTransaction } from "../../../domains/schema/migrate/split-sql";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { CliError } from "../../errors";
import { createLogger } from "../../utils/logger";
import { migrateCore, migrateExitCode, previewMigrate } from "../migrate";
import {
  buildMigrationStatuses,
  migrationEntries,
  readStatusLedger,
} from "../migrate-status";

/** Every table a lock keeps its row in: not part of what a run leaves behind. */
const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const logger = createLogger({ quiet: true });

describe.each(LOCK_DIALECTS)(
  "an applied migration's checksum on %s",
  dialect => {
    const P = `mac_${randomBytes(3).toString("hex")}`;
    const ONE = `20261102_000001_${P}_one`;
    const TWO = `20261102_000002_${P}_two`;
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-applied-checksum-"));
      // Nextly's own tables first, so the files are all a run has to do.
      await migrate();
      writeFile(
        ONE,
        `CREATE TABLE ${P}_one (id integer)`,
        `DROP TABLE ${P}_one`
      );
      writeFile(
        TWO,
        `CREATE TABLE ${P}_two (id integer)`,
        `DROP TABLE ${P}_two`
      );
      expect((await migrate()).applied).toBe(2);
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
      });
    }

    /** A migration file in the shape `migrate:create` writes. */
    function writeFile(name: string, up: string, down: string): void {
      writeFileSync(
        join(migrationsDir, `${name}.sql`),
        `-- Migration: ${name}\n\n-- UP\n${up};\n\n-- DOWN\n${down};\n`,
        "utf8"
      );
    }

    function fileText(name: string): string {
      return readFileSync(join(migrationsDir, `${name}.sql`), "utf8");
    }

    const repo = () =>
      new SchemaEventsRepository(adapter.getDrizzle(), dialect);

    /** The migration's applied row. */
    async function appliedRow(name: string): Promise<SchemaEventRow> {
      const rows = await repo().findFileApplies(`${name}.sql`);
      const applied = rows.filter(row => row.status === "applied");
      expect(applied).toHaveLength(1);
      return applied[0] as SchemaEventRow;
    }

    /** Every table with its row count, and the ledger: what a refused run must leave as it was. */
    async function databaseState() {
      const tables: Record<string, number> = {};
      for (const name of (await adapter.listTables()).sort()) {
        if (LOCK_TABLES.has(name)) continue;
        const rows = await adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${name}`
        );
        tables[name] = Number(rows[0]?.n ?? 0);
      }
      const ledger = (await repo().listFileApplies())
        .map(row => [row.id, row.status, row.sha256, row.note])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return { tables, ledger };
    }

    /** `nextly migrate:resolve --applied`, as the command runs it. */
    function resolveApplied(name: string) {
      return resolveMigration({
        mode: "applied",
        filename: `${name}.sql`,
        dialect,
        repo: repo(),
        skipVerify: true,
        fileExists: () => Promise.resolve(true),
        loadTargetSnapshot: () => Promise.resolve(null),
        marksNoTransaction: () =>
          Promise.resolve(marksNoTransaction(fileText(name))),
        fileChecksum: () => Promise.resolve(checksumOf(fileText(name))),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
    }

    /** What `migrate:status` lists for the app's files. */
    async function statuses() {
      const files = await migrationEntries({
        plugins: [],
        migrationsDir,
        dialect,
      });
      const { applied } = await readStatusLedger(adapter, dialect);
      return Object.fromEntries(
        buildMigrationStatuses(files, applied).map(s => [s.filename, s.status])
      );
    }

    /** The refusal a run ended with: its code, exit code and the files it names. */
    async function refusalOf(work: Promise<unknown>) {
      const error = await work.then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(error).toBeInstanceOf(CliError);
      const refusal = error as CliError;
      return {
        code: refusal.code,
        exit: migrateExitCode(refusal),
        files: refusal.logContext?.files,
      };
    }

    it("records the checksum of each file's whole text when it is applied", async () => {
      expect((await appliedRow(ONE)).sha256).toBe(checksumOf(fileText(ONE)));
      expect((await appliedRow(TWO)).sha256).toBe(checksumOf(fileText(TWO)));
    }, 120_000);

    it("refuses an edited UP, and an edit to the down section alone, naming every edited file and changing nothing", async () => {
      writeFile(
        ONE,
        `CREATE TABLE ${P}_one (id bigint)`,
        `DROP TABLE ${P}_one`
      );
      writeFile(
        TWO,
        `CREATE TABLE ${P}_two (id integer)`,
        `DROP TABLE IF EXISTS ${P}_two`
      );
      // A new file after them is not run either.
      writeFile(
        `20261102_000003_${P}_three`,
        `CREATE TABLE ${P}_three (id integer)`,
        `DROP TABLE ${P}_three`
      );
      const before = await databaseState();
      expect(await refusalOf(migrate())).toEqual({
        code: "MIGRATION_TAMPERED",
        exit: 2,
        files: [`${ONE}.sql`, `${TWO}.sql`],
      });
      expect(await databaseState()).toEqual(before);
      expect((await statuses())[ONE]).toBe("applied (modified)");
    }, 120_000);

    it("goes on once migrate:resolve --applied accepts the edit, recording the new checksum", async () => {
      writeFile(
        ONE,
        `CREATE TABLE ${P}_one (id integer)`,
        `DROP TABLE IF EXISTS ${P}_one`
      );
      const recorded = (await appliedRow(ONE)).sha256;
      expect((await refusalOf(migrate())).files).toEqual([`${ONE}.sql`]);

      expect(await resolveApplied(ONE)).toMatchObject({
        kind: "checksum-accepted",
        previous: recorded,
      });
      const accepted = await appliedRow(ONE);
      expect(accepted.sha256).toBe(checksumOf(fileText(ONE)));
      expect(accepted.note).toContain(`checksum accepted (was ${recorded})`);

      expect((await migrate()).applied).toBe(0);
      expect((await statuses())[ONE]).toBe("applied");
    }, 120_000);

    it("records the checksum when migrate:resolve --applied records a file that never ran", async () => {
      const name = `20261102_000003_${P}_by_hand`;
      writeFile(
        name,
        `CREATE TABLE ${P}_by_hand (id integer)`,
        `DROP TABLE ${P}_by_hand`
      );
      await adapter.executeQuery(`CREATE TABLE ${P}_by_hand (id integer)`);
      expect(await resolveApplied(name)).toMatchObject({ kind: "applied" });
      expect((await appliedRow(name)).sha256).toBe(checksumOf(fileText(name)));
      expect((await statuses())[name]).toBe("applied");
      expect((await migrate()).applied).toBe(0);
    }, 120_000);

    it("records no missing checksum when it refuses: a refused run writes nothing", async () => {
      const row = await appliedRow(TWO);
      await adapter.executeQuery(
        `UPDATE nextly_schema_events SET sha256 = NULL WHERE id = '${row.id}'`
      );
      writeFile(
        ONE,
        `CREATE TABLE ${P}_one (id bigint)`,
        `DROP TABLE ${P}_one`
      );
      const before = await databaseState();
      expect((await refusalOf(migrate())).files).toEqual([`${ONE}.sql`]);
      expect(await databaseState()).toEqual(before);
      expect((await appliedRow(TWO)).sha256).toBeNull();
    }, 120_000);

    it("names an edited applied file in a dry run, which writes nothing", async () => {
      writeFile(
        ONE,
        `CREATE TABLE ${P}_one (id bigint)`,
        `DROP TABLE ${P}_one`
      );
      const lines: string[] = [];
      const before = await databaseState();
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
      expect(lines.join("\n")).toContain(
        `\`${ONE}.sql\` has changed since it was applied (exit code 2)`
      );
      expect(await databaseState()).toEqual(before);
    }, 120_000);

    it.each([
      ["no checksum", null],
      ["the text an older ledger backfill wrote", "null"],
    ] as const)(
      "takes an applied row with %s as matching, and the run records the file's checksum",
      async (_name, legacy) => {
        const row = await appliedRow(ONE);
        await adapter.executeQuery(
          `UPDATE nextly_schema_events SET sha256 = ${legacy === null ? "NULL" : `'${legacy}'`} WHERE id = '${row.id}'`
        );
        // Not modified, as the run reads it.
        expect((await statuses())[ONE]).toBe("applied");
        expect((await migrate()).applied).toBe(0);
        const recorded = await appliedRow(ONE);
        expect(recorded.sha256).toBe(checksumOf(fileText(ONE)));
        expect(recorded.note).toContain("checksum recorded (none was)");
        // Recorded once: an edit after it is caught.
        writeFile(
          ONE,
          `CREATE TABLE ${P}_one (id bigint)`,
          `DROP TABLE ${P}_one`
        );
        expect((await refusalOf(migrate())).files).toEqual([`${ONE}.sql`]);
      },
      120_000
    );
  }
);
