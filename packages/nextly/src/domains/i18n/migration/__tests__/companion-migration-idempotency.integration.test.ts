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
 * Replays are exercised by re-executing the UP statements directly. That is the honest model of the
 * recovery path: the file is applied statement by statement with no enclosing transaction, so a
 * failure part-way leaves the earlier statements committed and the file recorded as NOT applied —
 * and the operator's only move is to run `migrate` again, which replays every statement in it.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
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
      columns: [{ name: "title", kind: "text" }],
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
    async function createMainWithContent(): Promise<void> {
      const schemaService = new DynamicCollectionSchemaService(
        undefined,
        entry.dialect
      );
      for (const statement of splitStatements([
        schemaService.generateMigrationSQL(mainTable, [
          { name: "title", type: "text" },
        ] as never),
      ])) {
        await adapter.executeQuery(statement);
      }
      await adapter.executeQuery(
        `INSERT INTO ${q(mainTable)} (${q("id")}, ${q("title")}, ${q("slug")}) ` +
          `VALUES ('p1', 'Hello', 'p1'), ('p2', 'World', 'p2')`
      );
    }

    /**
     * The companion exactly as boot leaves it: created, and EMPTY.
     *
     * `di/register.ts` calls `ensureCompanionTable` without a `sourceLocale`, which that function
     * documents as creating an empty companion rather than performing a transition. Seeding it here
     * would test a state the product does not produce.
     */
    async function createCompanionAsBootDoes(): Promise<void> {
      const create = buildLocalizationUpStatements(spec()).find(s =>
        s.startsWith("CREATE TABLE")
      );
      if (create === undefined)
        throw new Error("no create statement generated");
      await adapter.executeQuery(create);
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
        `SELECT ${q("_parent")}, ${q("_locale")}, ${q("title")} FROM ${q(companionTable)} ORDER BY ${q("_parent")}`
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
      await createMainWithContent();
      await writeMigrationFile();
      vi.clearAllMocks();
    });

    afterAll(async () => {
      await drop();
      await adapter.disconnect();
      if (migrationsDir)
        await rm(migrationsDir, { recursive: true, force: true });
    });

    // 🔴 The reported failure. Before the guard this threw
    // `table "<companion>" already exists` and left the run part-applied.
    it("applies when the companion already exists, and still seeds it", async () => {
      await createCompanionAsBootDoes();

      await expect(migrate()).resolves.toBe(1);

      const rows = await companionRows();
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.title)).toEqual(["Hello", "World"]);
      expect(rows.every(r => r._locale === "en")).toBe(true);
    });

    // The control: the guard must not have turned the create into a no-op on a database that
    // genuinely lacks the table. Without this, a generator emitting nothing at all would pass above.
    it("applies when the companion does not exist, creating and seeding it", async () => {
      await expect(migrate()).resolves.toBe(1);

      const rows = await companionRows();
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.title)).toEqual(["Hello", "World"]);
    });

    // 🔴 What an emitted file does when the companion already holds default-locale rows: it stops
    // loudly, and main is left intact.
    //
    // The file cannot know whether those rows are an interrupted copy to keep or the stale remains
    // of a disable, with main authoritative ever since — only the transition record says, and a
    // static file has none. Skipping them and proceeding to the drops would silently revert every
    // edit made while localization was off. Colliding costs a re-run; guessing costs data.
    it("stops on an already-seeded companion instead of dropping main's columns", async () => {
      const statements = buildLocalizationUpStatements(spec());
      for (const statement of statements) {
        if (statement.includes("DROP COLUMN")) break;
        await adapter.executeQuery(statement);
      }
      expect(await companionRows()).toHaveLength(2);

      await expect(migrate()).rejects.toThrow();

      // The load-bearing half: nothing was dropped, so the operator still has every value.
      const main = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q("title")} FROM ${q(mainTable)} ORDER BY ${q("id")}`
      );
      expect(main.map(r => r.title)).toEqual(["Hello", "World"]);
    });

    // The guard belongs to the runtime, which HAS read the transition record. Driven through the
    // generated statements so the property is asserted against a real server rather than a string.
    it("completes a partially seeded companion when the caller asks for the guard", async () => {
      await createCompanionAsBootDoes();
      await adapter.executeQuery(
        `INSERT INTO ${q(companionTable)} (${q("_parent")}, ${q("_locale")}, ${q("title")}) ` +
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
      expect(rows.map(r => r.title)).toEqual(["Edited since", "World"]);
    });
  });
}
