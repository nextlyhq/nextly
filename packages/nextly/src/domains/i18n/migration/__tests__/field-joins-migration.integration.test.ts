/**
 * The migrations `nextly migrate:create` writes for a shared field that becomes translated,
 * applied through the real runner, on every dialect.
 *
 * The collection is built from migrations alone, as a code-first project builds it: a first
 * `migrate:create` makes the main table, with the field shared, and its companion; an entry goes
 * in; a second `migrate:create` makes the field translated. The field's value has to become the
 * default language's value in the companion before the main table loses its column.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { reconcileCore } from "../../../schema/migrate/core-reconcile";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../../schema/migrate-create/generate";

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
        adapter = entry.make(entry.url ?? "");
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
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(companion)}`);
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(table)}`);
        await adapter.disconnect();
        await rm(migrationsDir, { recursive: true, force: true });
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
