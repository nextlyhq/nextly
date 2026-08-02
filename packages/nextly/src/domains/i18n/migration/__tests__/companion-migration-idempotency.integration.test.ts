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

import { runFileMigrations } from "../../../../cli/commands/migrate";
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

    /** The main table with two rows of real content, as a pre-localization project has it. */
    async function createMainWithContent(): Promise<void> {
      await adapter.executeQuery(
        `CREATE TABLE ${q(mainTable)} (${q("id")} TEXT PRIMARY KEY, ${q("title")} TEXT)`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q(mainTable)} (${q("id")}, ${q("title")}) VALUES ('p1', 'Hello'), ('p2', 'World')`
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

    // 🔴 The recovery path, modelled as the interruption that actually produces it.
    //
    // The file is applied statement by statement with no enclosing transaction, and MySQL commits
    // DDL implicitly regardless, so a failure part-way commits the statements before it and leaves
    // the file recorded as NOT applied. The operator re-runs `migrate`, which replays the whole
    // file. Here the run is interrupted after the seed and before the drops — the widest window,
    // because the seed is the statement a replay would otherwise collide on.
    //
    // Note what is NOT asserted: replaying a COMPLETED migration. That state is unreachable (the
    // journal skips applied files) and could not be made to work anyway — the drops have removed
    // the columns the seed reads, so the source data is gone by construction. Idempotency here
    // means "safe to re-run from the states an interruption can leave", not "the drops are
    // reversible".
    it("resumes after an interruption between the seed and the drops", async () => {
      const statements = buildLocalizationUpStatements(spec());
      for (const statement of statements) {
        if (statement.includes("DROP COLUMN")) break;
        await adapter.executeQuery(statement);
      }
      // The interrupted run got as far as a fully seeded companion.
      expect(await companionRows()).toHaveLength(2);

      // The replay: every statement again, including the two that already ran.
      await expect(migrate()).resolves.toBe(1);

      const rows = await companionRows();
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.title)).toEqual(["Hello", "World"]);
    });

    // A partially seeded companion — the state an interrupted copy leaves — must keep the row it
    // has and gain only the one it is missing. That is why the guard is row-level rather than a
    // table-level "skip the seed if the companion has any rows at all".
    it("completes a partially seeded companion rather than skipping it", async () => {
      await createCompanionAsBootDoes();
      await adapter.executeQuery(
        `INSERT INTO ${q(companionTable)} (${q("_parent")}, ${q("_locale")}, ${q("title")}) ` +
          `VALUES ('p1', 'en', 'Edited since')`
      );

      await expect(migrate()).resolves.toBe(1);

      const rows = await companionRows();
      expect(rows).toHaveLength(2);
      // The existing row is kept as it stands, not overwritten from main: it may hold an edit made
      // after the interrupted copy, and main stopped being the authority the moment it was written.
      expect(rows.map(r => r.title)).toEqual(["Edited since", "World"]);
    });
  });
}
