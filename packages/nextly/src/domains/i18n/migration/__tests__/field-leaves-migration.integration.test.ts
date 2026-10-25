/**
 * The migrations `nextly migrate:create` writes for a field that stops being translated, applied
 * and rolled back through the real runner, on every dialect.
 *
 * The collection is built from migrations alone, as a code-first project builds it: a first
 * `migrate:create` makes the main table and its translated companion, content goes in two
 * languages, and a second `migrate:create` makes the field shared. That writes three files: the
 * archive writes, the main table's new column, and the copy and companion drop. Applying them must
 * keep every language; rolling them back must put the translated field back as it was; applying
 * them again must change nothing more.
 *
 * A file that fails is the runner's to handle: PostgreSQL and SQLite run it in one transaction, so
 * it runs again cleanly, and MySQL, which commits each schema statement as it runs, refuses to run
 * it again and says how to tell whether it landed.
 *
 * Each case runs on a database of its own. The runner refuses a database that already holds tables
 * it did not make (drift), which is the behaviour under test, so a shared database another suite
 * left tables in would fail these cases for a reason that is not theirs.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseSqlSections,
  previewMigrate,
  runFileMigrations,
} from "../../../../cli/commands/migrate";
import {
  downDatabaseDeps,
  migrateDownCore,
} from "../../../../cli/commands/migrate-down";
import { createLogger } from "../../../../cli/utils/logger";
import { reconcileCore } from "../../../schema/migrate/core-reconcile";
import { marksNoTransaction } from "../../../schema/migrate/split-sql";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../../schema/migrate-create/generate";
import { withMigrateLock } from "../../../schema/pipeline/locks";
import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";

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
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

const quiet = createLogger({ quiet: true });

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(
    `a field leaving translation through migrations (${entry.dialect})`,
    () => {
      const { dialect } = entry;
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      let adapter: TestAdapter;
      let scratch: ScratchDatabase | null = null;
      let migrationsDir: string;
      // Per-run names, so a shared database cannot let two runs collide.
      let slug: string;
      let table: string;
      let companion: string;
      let translated: MinimalConfigEntity;
      let shared: MinimalConfigEntity;
      let created = 0;

      beforeEach(async () => {
        const tag = randomBytes(4).toString("hex");
        slug = `docs${tag}`;
        table = `dc_docs${tag}`;
        companion = `${table}_locales`;
        translated = {
          slug,
          tableName: table,
          localized: true,
          fields: [
            { name: "body", type: "text", localized: true },
            { name: "price", type: "number" },
          ],
        };
        shared = {
          ...translated,
          fields: [
            { name: "body", type: "text", localized: false },
            { name: "price", type: "number" },
          ],
        };
        created = 0;
        // SQLite runs in memory; a server dialect gets an empty database for the case.
        scratch =
          dialect === "sqlite"
            ? null
            : await createScratchDatabase(dialect, "field_leaves");
        adapter = entry.make(scratch?.url ?? entry.url ?? "");
        await adapter.connect();
        // What `nextly migrate` creates first: the ledger, the owner registry and the archive.
        await reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
        });
        migrationsDir = await mkdtemp(join(tmpdir(), "nextly-field-leaves-"));
      });

      afterEach(async () => {
        // The case's database and folder go even when closing the connection fails.
        try {
          await adapter.disconnect();
        } finally {
          await scratch?.drop();
          scratch = null;
          await rm(migrationsDir, { recursive: true, force: true });
        }
      });

      /** `nextly migrate:create` for the entity as it is now. */
      async function migrateCreate(entity: MinimalConfigEntity): Promise<void> {
        created += 1;
        await generateMigration({
          name: `${slug}_${created}`,
          dialect,
          migrationsDir,
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(Date.UTC(2026, 9, 16, 10, created)),
        });
      }

      /** `nextly migrate`, optionally `--step`. */
      function migrate(step?: number): Promise<number> {
        return runFileMigrations({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger: quiet,
          ...(step === undefined ? {} : { step }),
        });
      }

      /** `nextly migrate:down --step <n> --allow-data-loss --yes`, reading each file's DOWN. */
      async function migrateDown(step: number): Promise<string[]> {
        const result = await migrateDownCore({
          ...(await downDatabaseDeps({
            adapter: adapter as unknown as DrizzleAdapter,
            dialect,
          })),
          nodeEnv: "test",
          logger: quiet,
          options: {
            step,
            allowDataLoss: true,
            yes: true,
            dryRun: false,
          },
          fileExists: () => Promise.resolve(true),
          readDownSql: async filename => {
            const name = filename.endsWith(".sql")
              ? filename
              : `${filename}.sql`;
            const content = await readFile(
              resolve(migrationsDir, name),
              "utf-8"
            );
            return {
              sql: parseSqlSections(content).downSql,
              transaction: !marksNoTransaction(content),
            };
          },
          withLock: withMigrateLock,
        });
        return result.rolledBack;
      }

      /** One entry with a value in each language, written as the translated collection keeps it. */
      async function seed(): Promise<void> {
        await adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e1', 'One', 'one')`
        );
        await adapter.executeQuery(
          `INSERT INTO ${q(companion)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('e1', 'en', 'Hello'), ('e1', 'es', 'Hola')`
        );
      }

      async function columnsOf(name: string): Promise<string[]> {
        if (dialect === "sqlite") {
          const rows = await adapter.executeQuery<{ name: string }>(
            `PRAGMA table_info("${name}")`
          );
          return rows.map(row => row.name);
        }
        const rows = await adapter.executeQuery<{ name: string }>(
          dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${name}'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${name}'`
        );
        return rows.map(row => row.name);
      }

      async function archived(): Promise<{ locale: string; value: string }[]> {
        return adapter.executeQuery<{ locale: string; value: string }>(
          `SELECT ${q("locale")} AS locale, ${q("value")} AS value FROM ${q("nextly_i18n_archive")} ` +
            `WHERE ${q("collection")} = '${slug}' AND ${q("field")} = 'body' ORDER BY ${q("id")}`
        );
      }

      /** What the field leaving translation must leave behind. */
      async function expectShared(): Promise<void> {
        const [main] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(table)} WHERE ${q("id")} = 'e1'`
        );
        expect(main?.body).toBe("Hello");
        expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
        expect(await columnsOf(companion)).not.toContain("body");
      }

      it("keeps every language: up, then down, then up again", async () => {
        await migrateCreate(translated);
        await migrate();
        await seed();
        await migrateCreate(shared);

        await migrate();
        await expectShared();

        // An entry made while the field is shared, with no translated row of its own.
        await adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e2', 'Two', 'two', 'Fresh')`
        );

        // The shared file, the main file and the archive file, newest first.
        expect(await migrateDown(3)).toHaveLength(3);
        const [fresh] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(companion)} WHERE ${q("_parent")} = 'e2' AND ${q("_locale")} = 'en'`
        );
        expect(fresh?.body).toBe("Fresh");
        const back = await adapter.executeQuery<{
          locale: string;
          body: string;
        }>(
          `SELECT ${q("_locale")} AS locale, ${q("body")} AS body FROM ${q(companion)} WHERE ${q("_parent")} = 'e1' ORDER BY ${q("_locale")}`
        );
        expect(back).toEqual([
          { locale: "en", body: "Hello" },
          { locale: "es", body: "Hola" },
        ]);
        expect(await columnsOf(table)).not.toContain("body");

        // Applied again, it changes nothing more: the archive still holds one row.
        await migrate();
        await expectShared();
      });

      it("adds no archive rows when the archive file runs again", async () => {
        await migrateCreate(translated);
        await migrate();
        await seed();
        await migrateCreate(shared);
        // The archive file alone, as a run that stopped after it leaves the database; the companion
        // still has the column its statements read.
        await migrate(1);
        expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);

        const file = (await readdir(migrationsDir)).find(f =>
          f.endsWith(`_archive_localization_${slug}.sql`)
        );
        if (!file) throw new Error("no archive file was written");
        const { upSql } = parseSqlSections(
          await readFile(resolve(migrationsDir, file), "utf-8")
        );
        for (const statement of upSql
          .split(";")
          .map(s => s.trim())
          .filter(Boolean)) {
          await adapter.executeQuery(statement);
        }

        expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
      });

      it("shows both moves in a dry run, and changes nothing", async () => {
        await migrateCreate(translated);
        await migrate();
        await seed();
        await migrateCreate(shared);
        const printed: string[] = [];
        const capture = new Proxy(
          {},
          {
            get:
              () =>
              (...parts: unknown[]) => {
                printed.push(parts.map(String).join(" "));
              },
          }
        ) as Parameters<typeof previewMigrate>[0]["logger"];

        await previewMigrate({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          plugins: [],
          logger: capture,
        });

        const output = printed.join("\n");
        expect(output).toContain(`INSERT INTO ${q("nextly_i18n_archive")}`);
        expect(output).toContain(`ALTER TABLE ${q(table)} ADD COLUMN`);
        expect(output).toContain(
          `ALTER TABLE ${q(companion)} DROP COLUMN ${q("body")}`
        );
        expect(await archived()).toEqual([]);
        expect(await columnsOf(companion)).toContain("body");
      });

      /** The shared file made to fail: its companion column renamed out from under it. */
      async function failTheSharedFile(): Promise<void> {
        await migrateCreate(translated);
        await migrate();
        await seed();
        await migrateCreate(shared);
        // The archive file and the main file.
        await migrate(2);
        await adapter.executeQuery(
          `ALTER TABLE ${q(companion)} RENAME COLUMN ${q("body")} TO ${q("body_moved")}`
        );
        await expect(migrate()).rejects.toThrow();
        await adapter.executeQuery(
          `ALTER TABLE ${q(companion)} RENAME COLUMN ${q("body_moved")} TO ${q("body")}`
        );
      }

      if (dialect === "mysql") {
        it("refuses a value too long for the shared column before dropping its source", async () => {
          // A companion made before the renderer emitted TEXT holds long text as LONGTEXT; the
          // shared column is TEXT, as the snapshot says. MySQL's strict mode refuses the copy,
          // which runs before the drop, so the value stays where it was.
          await migrateCreate(translated);
          await migrate();
          await seed();
          await adapter.executeQuery(
            `ALTER TABLE ${q(companion)} MODIFY COLUMN ${q("body")} LONGTEXT`
          );
          const long = "x".repeat(70_000);
          await adapter.executeQuery(
            `UPDATE ${q(companion)} SET ${q("body")} = '${long}' WHERE ${q("_locale")} = 'en'`
          );
          await migrateCreate(shared);

          await expect(migrate()).rejects.toThrow();

          const [kept] = await adapter.executeQuery<{ size: number | string }>(
            `SELECT LENGTH(${q("body")}) AS size FROM ${q(companion)} WHERE ${q("_locale")} = 'en'`
          );
          expect(Number(kept?.size)).toBe(70_000);
        });

        it("refuses to run a failed shared file again, naming the file and the column", async () => {
          await failTheSharedFile();

          const sharedFile = (await readdir(migrationsDir)).find(f =>
            f.endsWith(`_shared_localization_${slug}.sql`)
          );
          if (!sharedFile) throw new Error("no shared file was written");
          await expect(migrate()).rejects.toThrow(
            new RegExp(
              `${sharedFile.replace(/\.sql$/, "")}[\\s\\S]*still has "body"`
            )
          );
        });
      } else {
        it("runs a failed shared file again, from where it started", async () => {
          await failTheSharedFile();

          await migrate();

          await expectShared();
        });
      }
    }
  );
}
