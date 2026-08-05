/**
 * The companion migration against a database that already has the companion.
 *
 * 🔴 This is the ordinary state, not an edge case. `ensureCompanionTable` runs at boot and on every
 * `db:sync`, so any project that ran the dev server before graduating to migrations reaches
 * `nextly migrate` with the companion already present. Before this suite the run died on the
 * `CREATE TABLE` **after** committing the files before it, leaving the operator to work out by hand
 * which ones had landed.
 *
 * Driven through the real `runFileMigrations` rather than by asserting on generated SQL, because
 * the property under test is what the database does with the statements, not what they look like.
 * The unit suite covers the text; only a server can say whether a replay collides.
 *
 * A file whose statements partly landed is what makes replays reachable. The runner does wrap them
 * in a transaction, so the tear is not a missing BEGIN: on MySQL `CREATE TABLE` commits implicitly
 * and escapes that transaction, so a later statement failing rolls back only the rest and leaves
 * the companion behind with the file recorded as NOT applied. The operator's only move is to run
 * `migrate` again, which replays every statement in the file. Cases that need such a state
 * construct it by pre-executing the file's own statements, since it cannot be produced organically
 * on the dialects this suite runs.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { splitStatements } from "../../../schema/pipeline/sql-statement-utils";
import { getSchemaEventsDdl } from "../../../schema/events/schema-events-ddl";
import {
  buildLocalizationUpSql,
  buildLocalizationUpStatements,
} from "../generate-up";
import type { CompanionMigrationSpec } from "../types";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
  getDrizzle<T = unknown>(): T;
}

const DIALECTS: {
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}[] = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
};

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`companion migration idempotency (${entry.dialect})`, () => {
    // Per-file prefix so a shared container cannot let two suites collide on a table name.
    const tag = randomBytes(5).toString("hex");
    const mainTable = `dc_pages${tag}`;
    const companionTable = `${mainTable}_locales`;

    let adapter: TestAdapter;
    let migrationsDir: string;

    const q = (id: string) => `"${id}"`;

    const spec = (): CompanionMigrationSpec => ({
      dialect: entry.dialect as CompanionMigrationSpec["dialect"],
      collection: "pages",
      mainTable,
      companionTable,
      defaultLocale: "en",
      parentIdType: "TEXT",
      columns: [{ name: "body", kind: "text" }],
    });

    async function drop(): Promise<void> {
      for (const table of [companionTable, mainTable, "nextly_schema_events"]) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(table)}`);
      }
    }

    /**
     * The main table with two rows of real content, as a pre-localization project has it.
     *
     * Built by the production collection generator rather than a hand-written CREATE: a copied
     * definition drifts from the shape Nextly actually creates, and the test would then exercise a
     * layout no real database has.
     */
    async function createMain(
      options: { withLocalizedColumn: boolean } = { withLocalizedColumn: true }
    ): Promise<void> {
      const schemaService = new DynamicCollectionSchemaService(
        undefined,
        entry.dialect
      );
      // A collection localized from BIRTH never carried the translatable column on main — its
      // values only ever lived in the companion. Building main with the column would describe a
      // collection that was localized LATER, which is the other scenario entirely.
      const fields = options.withLocalizedColumn
        ? [{ name: "body", type: "text" }]
        : [];
      for (const statement of splitStatements([
        schemaService.generateMigrationSQL(mainTable, fields as never),
      ])) {
        await adapter.executeQuery(statement);
      }
      const cols = options.withLocalizedColumn
        ? `(${q("id")}, ${q("body")}, ${q("title")}, ${q("slug")})`
        : `(${q("id")}, ${q("title")}, ${q("slug")})`;
      const vals = options.withLocalizedColumn
        ? `('p1', 'Hello', 'p1', 'p1'), ('p2', 'World', 'p2', 'p2')`
        : `('p1', 'p1', 'p1'), ('p2', 'p2', 'p2')`;
      await adapter.executeQuery(
        `INSERT INTO ${q(mainTable)} ${cols} VALUES ${vals}`
      );
    }

    /**
     * The companion as a dev-server boot actually leaves it, through the real entry point.
     *
     * 🔴 Driven by `ensureCompanionTable` rather than by executing the generated CREATE, because
     * that function refuses some states outright. Without a `sourceLocale` it cannot say which
     * language existing content is in, so `creatingWouldHideContent` stops it from creating an
     * empty companion over a main table that still holds translatable columns AND rows — the
     * caller is told to run `db:sync` or `migrate` instead.
     *
     * Executing the raw statement would therefore set up a state boot prevents, and the case would
     * certify behaviour against a database no project can reach.
     */
    async function bootProvisionsCompanion(
      fields: { name: string; type: string; localized?: boolean }[]
    ): Promise<void> {
      const { companionTableExists, ensureCompanionTable } = await import(
        "../../runtime/companion-io"
      );
      // A refusal is reported, never thrown: the function hands its reason to `onError` and returns
      // false. Left unchecked, the companion would simply be absent, the migration below would
      // create it, and the case would pass having exercised none of what it names. Captured rather
      // than merely asserted so a future refusal explains itself instead of reading as `false`.
      let refusal: unknown;
      const provisioned = await ensureCompanionTable(
        adapter as never,
        {
          builtBy: "codeFirst" as const,
          slug: mainTable,
          tableName: mainTable,
          fields,
          dialect: entry.dialect,
        },
        error => {
          refusal = error;
        }
      );
      expect(
        provisioned,
        `boot did not provision the companion: ${String(refusal)}`
      ).toBe(true);
      // Separately confirmed, because a true return says the statements ran, not that the table
      // they were meant to build is there to be found.
      expect(await companionTableExists(adapter as never, companionTable)).toBe(
        true
      );
    }

    /** A create-only companion file, as `migrate:create` emits for a collection localized from birth. */
    async function writeCreateOnlyFile(): Promise<void> {
      const { buildCompanionCreateOnlySql } = await import("../generate-up");
      await writeFile(
        join(migrationsDir, "20260802_000002_fresh_localized.sql"),
        `-- Migration: fresh_localized\n-- UP\n${buildCompanionCreateOnlySql(spec(), { emittedToFile: true })}\n\n-- DOWN\nSELECT 1;\n`,
        "utf8"
      );
    }

    async function writeMigrationFile(): Promise<void> {
      const upSql = buildLocalizationUpSql(spec());
      await writeFile(
        join(migrationsDir, "20260802_000001_enable_localization.sql"),
        `-- Migration: enable_localization\n-- UP\n${upSql}\n\n-- DOWN\nSELECT 1;\n`,
        "utf8"
      );
    }

    async function migrate(): Promise<number> {
      return runFileMigrations({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect: entry.dialect,
        migrationsDir,
        logger: logger as never,
      });
    }

    async function companionRows(): Promise<Record<string, unknown>[]> {
      return adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q("_parent")}, ${q("_locale")}, ${q("body")} FROM ${q(companionTable)} ORDER BY ${q("_parent")}`
      );
    }

    beforeEach(async () => {
      if (adapter === undefined) {
        adapter = entry.make(entry.url as string);
        await adapter.connect();
      }
      migrationsDir = await mkdtemp(join(tmpdir(), "nextly-077-"));
      await drop();
      for (const statement of getSchemaEventsDdl(entry.dialect)) {
        await adapter.executeQuery(statement);
      }
      vi.clearAllMocks();
    });

    afterAll(async () => {
      await drop();
      await adapter.disconnect();
      if (migrationsDir)
        await rm(migrationsDir, { recursive: true, force: true });
    });

    // 🔴 A collection localized from birth, whose companion the dev server has already made.
    //
    // This is the state the guard exists for, and it is ordinary rather than exotic: the main table
    // never carried translatable columns, so boot creates the companion freely, and `migrate:create`
    // emits a create-only file. Without the guard that file's bare CREATE aborts the run — after
    // committing every migration ahead of it.
    //
    // Create-only carries no seed and no drops, so this scenario is closed completely here: there is
    // no later statement that can still collide or destroy anything.
    it("applies a create-only companion file when boot already made the table", async () => {
      await createMain({ withLocalizedColumn: false });
      await bootProvisionsCompanion([
        { name: "body", type: "text", localized: true },
      ]);
      await writeCreateOnlyFile();

      await expect(migrate()).resolves.toBe(1);

      // The table is usable afterwards, not merely present.
      await adapter.executeQuery(
        `INSERT INTO ${q(companionTable)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) ` +
          `VALUES ('p1', 'en', 'Hello')`
      );
      expect(await companionRows()).toHaveLength(1);
    });

    // The control: the guard must not have turned the create into a no-op on a database that
    // genuinely lacks the table. Without this, a generator emitting nothing at all would pass above.
    it("applies a create-only companion file when the table is absent", async () => {
      await createMain({ withLocalizedColumn: false });
      await writeCreateOnlyFile();

      await expect(migrate()).resolves.toBe(1);

      await adapter.executeQuery(
        `INSERT INTO ${q(companionTable)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) ` +
          `VALUES ('p1', 'en', 'Hello')`
      );
      expect(await companionRows()).toHaveLength(1);
    });

    // 🔴 An ENABLE file replayed after it was interrupted between its CREATE and its seed.
    //
    // The companion is present and EMPTY while main still holds the column and its rows, and the
    // whole file runs again. Everything the interrupted run owed has to happen on that second pass:
    // the create is skipped, the content is copied, and only then is main's column dropped. This is
    // the case the guard is answerable for beyond merely not colliding.
    //
    // Constructed by pre-executing the file's own CREATE. Boot refuses to leave an empty companion
    // over content-bearing main, and the tear that does produce this state is MySQL's implicit DDL
    // commit, which cannot be induced on the dialects here.
    it("replays an interrupted enable migration over the companion it already created", async () => {
      await createMain();
      await writeMigrationFile();
      // Selected with `filter` rather than `find` so the precondition can be asserted instead of
      // guarded: an array needs no narrowing, and "exactly one create" is the stronger claim — a
      // plan that emitted none, or a second one, would both leave this case testing something else.
      const creates = buildLocalizationUpStatements(spec(), {
        emittedToFile: true,
      }).filter(statement => statement.startsWith("CREATE TABLE"));
      expect(creates).toHaveLength(1);
      for (const statement of creates) await adapter.executeQuery(statement);
      expect(await companionRows()).toHaveLength(0);

      await expect(migrate()).resolves.toBe(1);

      const rows = await companionRows();
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.body)).toEqual(["Hello", "World"]);
      expect(rows.every(r => r._locale === "en")).toBe(true);
      // The drops ran too. Skipping the create must not have cost the file the rest of its work,
      // which is what would leave the column on main and the project half-migrated for good.
      await expect(
        adapter.executeQuery(`SELECT ${q("body")} FROM ${q(mainTable)}`)
      ).rejects.toThrow();
    });

    // 🔴 What an ENABLE file does when the companion already holds default-locale rows — the state
    // `db:sync` leaves, since it seeds while retaining main's columns. It stops loudly, and main is
    // left intact.
    //
    // The file cannot know whether those rows are an interrupted copy to keep or the stale remains
    // of a disable, with main authoritative ever since — only the transition record says, and a
    // static file has none. Skipping them and proceeding to the drops would silently revert every
    // edit made while localization was off. Colliding costs a re-run; guessing costs data.
    it("stops on an already-seeded companion instead of dropping main's columns", async () => {
      await createMain();
      await writeMigrationFile();
      const statements = buildLocalizationUpStatements(spec());
      for (const statement of statements) {
        if (statement.includes("DROP COLUMN")) break;
        await adapter.executeQuery(statement);
      }
      expect(await companionRows()).toHaveLength(2);

      await expect(migrate()).rejects.toThrow();

      // The load-bearing half: nothing was dropped, so the operator still has every value.
      const main = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q("body")} FROM ${q(mainTable)} ORDER BY ${q("id")}`
      );
      expect(main.map(r => r.body)).toEqual(["Hello", "World"]);
    });

    // The guard belongs to the runtime, which HAS read the transition record. Driven through the
    // generated statements so the property is asserted against a real server rather than a string.
    it("completes a partially seeded companion when the caller asks for the guard", async () => {
      await createMain();
      // Created directly rather than through boot: this case needs a companion over a main table
      // that still holds content, which is exactly what boot declines to produce.
      const create = buildLocalizationUpStatements(spec()).find(statement =>
        statement.startsWith("CREATE TABLE")
      );
      await adapter.executeQuery(create ?? "");
      await adapter.executeQuery(
        `INSERT INTO ${q(companionTable)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) ` +
          `VALUES ('p1', 'en', 'Edited since')`
      );

      const plan = buildLocalizationUpStatements(spec(), {
        guardSeed: true,
        dropSeededColumns: false,
      });
      // The CREATE is dropped exactly as `resumeInterruptedSeed` drops it: the interrupted run
      // already made the table, and the runtime form is deliberately not `IF NOT EXISTS` so that
      // `ensureCompanionTable` can still detect a lost create race.
      for (const statement of plan.filter(
        statement => !statement.startsWith("CREATE TABLE")
      )) {
        await adapter.executeQuery(statement);
      }

      const rows = await companionRows();
      expect(rows).toHaveLength(2);
      // The row already present is kept as it stands: it may hold an edit made after the
      // interrupted copy, and re-copying from main would discard it.
      expect(rows.map(r => r.body)).toEqual(["Edited since", "World"]);
    });
  });
}
