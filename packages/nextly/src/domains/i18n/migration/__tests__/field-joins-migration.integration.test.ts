/**
 * The migrations `nextly migrate:create` writes for a shared field that becomes translated,
 * applied through the real runner, on every dialect.
 *
 * The collection is built from migrations alone, as a code-first project builds it: a first
 * `migrate:create` makes the main table, with the field shared, and its companion; an entry goes
 * in; a second `migrate:create` makes the field translated. The field's value has to become the
 * default language's value in the companion before the main table loses its column.
 *
 * Each case runs on a database of its own. The runner refuses a database that already holds tables
 * it did not make (drift), so a shared database another suite left tables in would fail these
 * cases for a reason that is not theirs.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
    `a shared field becoming translated through migrations (${entry.dialect})`,
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
      let shared: MinimalConfigEntity;
      let translated: MinimalConfigEntity;
      let created = 0;

      beforeEach(async () => {
        const tag = randomBytes(4).toString("hex");
        slug = `docs${tag}`;
        table = `dc_docs${tag}`;
        companion = `${table}_locales`;
        shared = {
          slug,
          tableName: table,
          localized: true,
          fields: [
            { name: "headline", type: "text", localized: true },
            { name: "body", type: "text", localized: false },
          ],
        };
        translated = {
          ...shared,
          fields: [
            { name: "headline", type: "text", localized: true },
            { name: "body", type: "text", localized: true },
          ],
        };
        created = 0;
        // SQLite runs in memory; a server dialect gets an empty database for the case.
        scratch =
          dialect === "sqlite"
            ? null
            : await createScratchDatabase(dialect, "field_joins");
        adapter = entry.make(scratch?.url ?? entry.url ?? "");
        await adapter.connect();
        // What `nextly migrate` creates first: the ledger, the owner registry and the archive.
        await reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
        });
        migrationsDir = await mkdtemp(join(tmpdir(), "nextly-field-joins-"));
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
          now: new Date(Date.UTC(2026, 9, 17, 10, created)),
        });
      }

      function migrate(): Promise<number> {
        return runFileMigrations({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger: quiet,
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
          options: { step, allowDataLoss: true, yes: true, dryRun: false },
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

      /** An entry whose `body` is shared, holding a value, before the field becomes translated. */
      async function seedShared(): Promise<void> {
        await migrateCreate(shared);
        await migrate();
        await adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e1', 'One', 'one', 'Hello')`
        );
        await adapter.executeQuery(
          `INSERT INTO ${q(companion)} (${q("_parent")}, ${q("_locale")}, ${q("headline")}) VALUES ('e1', 'en', 'Head'), ('e1', 'es', 'Cabeza')`
        );
      }

      it("rolls back to a shared field with English's value, keeping the others archived", async () => {
        await seedShared();
        await migrateCreate(translated);
        await migrate();
        // Translated now, Spanish gains a value of its own.
        await adapter.executeQuery(
          `UPDATE ${q(companion)} SET ${q("body")} = 'Hola' WHERE ${q("_parent")} = 'e1' AND ${q("_locale")} = 'es'`
        );

        // The main file, then the joins file before it.
        expect(await migrateDown(2)).toHaveLength(2);

        const [main] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(table)} WHERE ${q("id")} = 'e1'`
        );
        expect(main.body).toBe("Hello");
        const archived = await adapter.executeQuery<{
          locale: string;
          value: string | null;
        }>(
          `SELECT ${q("locale")} AS locale, ${q("value")} AS value FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${slug}' AND ${q("field")} = 'body'`
        );
        expect(archived).toEqual([{ locale: "es", value: "Hola" }]);

        // Translated again, the value moves back as English's.
        await migrate();
        const [en] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(companion)} WHERE ${q("_parent")} = 'e1' AND ${q("_locale")} = 'en'`
        );
        expect(en.body).toBe("Hello");
      });

      /**
       * The entity with `body` shared as given, holding "Hello" in it, and `headline` translated
       * or, with `translatedHeadline` false, shared too.
       */
      async function seedSharedBody(
        body: Record<string, unknown>,
        translatedHeadline = true
      ): Promise<MinimalConfigEntity> {
        const allShared: MinimalConfigEntity = {
          ...shared,
          fields: [
            { name: "headline", type: "text", localized: translatedHeadline },
            { name: "body", type: "text", localized: false, ...body },
          ],
        };
        await migrateCreate(allShared);
        await migrate();
        // A translated headline lives on the companion, so main holds only the shared columns.
        await adapter.executeQuery(
          translatedHeadline
            ? `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e1', 'One', 'one', 'Hello')`
            : `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("headline")}, ${q("body")}) VALUES ('e1', 'One', 'one', 'Head', 'Hello')`
        );
        return allShared;
      }

      async function companionTables(): Promise<string[]> {
        const rows = await adapter.executeQuery<{ name: string }>(
          dialect === "mysql"
            ? `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${companion}'`
            : dialect === "sqlite"
              ? `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${companion}'`
              : `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${companion}'`
        );
        return rows.map(r => r.name);
      }

      it("moves the entity's first translated field into a companion it creates, and back on the way down", async () => {
        // A translated entity whose fields were all shared has no companion, and the snapshot
        // records no translated columns for it, so its first translated field is planned as the
        // companion's ENABLE: created, filled from main, and main's column dropped, in one file.
        const allShared = await seedSharedBody({}, false);
        await migrateCreate({
          ...allShared,
          fields: [
            { name: "headline", type: "text", localized: false },
            { name: "body", type: "text", localized: true },
          ],
        });
        await migrate();

        const [en] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(companion)} WHERE ${q("_parent")} = 'e1' AND ${q("_locale")} = 'en'`
        );
        expect(en?.body).toBe("Hello");

        // The ENABLE file alone: the main file beside it is left with nothing to do.
        expect(await migrateDown(1)).toHaveLength(1);
        const [main] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(table)} WHERE ${q("id")} = 'e1'`
        );
        expect(main?.body).toBe("Hello");
        expect(await companionTables()).toEqual([]);
      });

      it("moves a field into the companion its last translated field left behind, and back on the way down", async () => {
        // The last translated field leaving drops its column and keeps the companion table, so the
        // next snapshot records no translated columns while the table is still there.
        await seedShared();
        const allShared: MinimalConfigEntity = {
          ...shared,
          fields: [
            { name: "headline", type: "text", localized: false },
            { name: "body", type: "text", localized: false },
          ],
        };
        await migrateCreate(allShared);
        await migrate();
        expect(await companionTables()).toEqual([companion]);

        await migrateCreate({
          ...allShared,
          fields: [
            { name: "headline", type: "text", localized: false },
            { name: "body", type: "text", localized: true },
          ],
        });
        await migrate();

        const [en] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(companion)} WHERE ${q("_parent")} = 'e1' AND ${q("_locale")} = 'en'`
        );
        expect(en?.body).toBe("Hello");

        // The main file, then the joins file before it: the value is back on main, and the table
        // the joins file did not create stays.
        expect(await migrateDown(2)).toHaveLength(2);
        const [main] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(table)} WHERE ${q("id")} = 'e1'`
        );
        expect(main?.body).toBe("Hello");
        expect(await companionTables()).toEqual([companion]);
      });

      it("rolls a Required field back to shared with its value, and Required again", async () => {
        // The main file's DOWN runs first and re-adds the column; made required there, before any
        // value is back, it would refuse every existing row.
        const allShared = await seedSharedBody({ required: true });
        await migrateCreate({
          ...allShared,
          fields: [
            { name: "headline", type: "text", localized: true },
            { name: "body", type: "text", localized: true, required: true },
          ],
        });
        await migrate();

        expect(await migrateDown(2)).toHaveLength(2);

        const [main] = await adapter.executeQuery<{ body: string | null }>(
          `SELECT ${q("body")} AS body FROM ${q(table)} WHERE ${q("id")} = 'e1'`
        );
        expect(main?.body).toBe("Hello");
        const nullRefused = await adapter
          .executeQuery(
            `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e2', 'Two', 'two', NULL)`
          )
          .then(
            () => false,
            () => true
          );
        expect(nullRefused).toBe(true);
      });

      it.skipIf(dialect !== "postgresql")(
        "fails the way down loudly, keeping every value, when an entry has no value to restore",
        async () => {
          const allShared = await seedSharedBody({ required: true });
          await migrateCreate({
            ...allShared,
            fields: [
              { name: "headline", type: "text", localized: true },
              { name: "body", type: "text", localized: true, required: true },
            ],
          });
          await migrate();
          // A second entry with no value in any language: the shared column gets none to restore.
          await adapter.executeQuery(
            `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e2', 'Two', 'two')`
          );

          await expect(migrateDown(2)).rejects.toThrow();

          const kept = await adapter.executeQuery<{
            locale: string;
            body: string | null;
          }>(
            `SELECT ${q("_locale")} AS locale, ${q("body")} AS body FROM ${q(companion)} ORDER BY ${q("_parent")}, ${q("_locale")}`
          );
          expect(kept).toEqual([{ locale: "en", body: "Hello" }]);
        }
      );

      it("refuses a field whose storage changes as it becomes translated, before writing a file", async () => {
        // Its value would be copied as it is into a companion column of the new type.
        await seedShared();
        const filesBefore = (await readdir(migrationsDir)).sort();

        await expect(
          migrateCreate({
            ...shared,
            fields: [
              { name: "headline", type: "text", localized: true },
              { name: "body", type: "number", localized: true },
            ],
          })
        ).rejects.toMatchObject({
          publicData: {
            errors: [
              {
                code: "RESHAPED_FIELD_JOINS_TRANSLATION",
                path: "fields.body",
              },
            ],
          },
        });
        expect((await readdir(migrationsDir)).sort()).toEqual(filesBefore);
      });

      it("keeps the shared value as English's", async () => {
        await migrateCreate(shared);
        await migrate();
        await adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e1', 'One', 'one', 'Hello')`
        );
        await adapter.executeQuery(
          `INSERT INTO ${q(companion)} (${q("_parent")}, ${q("_locale")}, ${q("headline")}) VALUES ('e1', 'en', 'Head'), ('e1', 'es', 'Cabeza')`
        );

        await migrateCreate(translated);
        await migrate();

        // English's row takes the value; Spanish, which never had one, is given none.
        const rows = await adapter.executeQuery<{
          locale: string;
          body: string | null;
        }>(
          `SELECT ${q("_locale")} AS locale, ${q("body")} AS body FROM ${q(companion)} WHERE ${q("_parent")} = 'e1' ORDER BY ${q("_locale")}`
        );
        expect(rows).toEqual([
          { locale: "en", body: "Hello" },
          { locale: "es", body: null },
        ]);
      });
    }
  );
}
