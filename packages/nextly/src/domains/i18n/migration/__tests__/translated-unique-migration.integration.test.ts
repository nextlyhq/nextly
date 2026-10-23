/**
 * The migration `nextly migrate:create` writes for a translated field that becomes unique,
 * applied through the real runner, on every dialect. Over a value a language already holds twice,
 * `nextly migrate` stops before any statement, naming the documents and never the value, and the
 * schema is as it was. Once the duplicate is gone, the same file applies and holds the rule.
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

import { throwawayDatabase } from "../../../../cli/commands/__tests__/helpers/sync-target";
import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { reconcileCore } from "../../../schema/migrate/core-reconcile";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../../schema/migrate-create/generate";
import { readIndexNames } from "../../../schema/pipeline/live-table-facts";
import { companionUniqueIndexName } from "../companion-unique-indexes";

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
    `a translated field becoming unique through migrations (${entry.dialect})`,
    () => {
      const { dialect } = entry;
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      let adapter: TestAdapter;
      let migrationsDir: string;
      // A database of its own for each test on a server dialect: `nextly migrate` judges the whole
      // database against its history, so a table another test left in a shared one reads as drift.
      let dropDatabase: () => Promise<void> = async () => {};
      // Per-run names, so a shared database cannot let two runs collide.
      let table: string;
      let companion: string;
      let entity: (unique: boolean) => MinimalConfigEntity;
      let created = 0;

      beforeEach(async () => {
        const tag = randomBytes(4).toString("hex");
        table = `dc_docs${tag}`;
        companion = `${table}_locales`;
        entity = unique => ({
          slug: `docs${tag}`,
          tableName: table,
          localized: true,
          fields: [{ name: "handle", type: "text", localized: true, unique }],
        });
        created = 0;
        if (dialect === "sqlite") {
          adapter = entry.make("");
          dropDatabase = async () => {};
        } else {
          const own = await throwawayDatabase(dialect);
          adapter = entry.make(own.url);
          dropDatabase = own.drop;
        }
        await adapter.connect();
        // What `nextly migrate` creates first: the ledger, the owner registry and the archive.
        await reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
        });
        migrationsDir = await mkdtemp(join(tmpdir(), "nextly-unique-mig-"));
      });

      afterEach(async () => {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(companion)}`);
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(table)}`);
        await adapter.disconnect();
        await dropDatabase();
        await rm(migrationsDir, { recursive: true, force: true });
      });

      async function migrateCreate(unique: boolean): Promise<void> {
        created += 1;
        await generateMigration({
          name: `${table}_${created}`,
          dialect,
          migrationsDir,
          defaultLocale: "en",
          collections: [entity(unique)],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(Date.UTC(2026, 9, 22, 12, created)),
        });
      }

      const migrate = () =>
        runFileMigrations({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger: quiet,
        });

      const indexes = () =>
        readIndexNames(adapter.getDrizzle(), dialect, companion);

      async function addEntry(id: string, handle: string): Promise<void> {
        await adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
        );
        await adapter.executeQuery(
          `INSERT INTO ${q(companion)} (${q("_parent")}, ${q("_locale")}, ${q("handle")}) VALUES ('${id}', 'en', '${handle}')`
        );
      }

      it("stops before any statement over a value held twice, then applies once it is gone", async () => {
        await migrateCreate(false);
        await migrate();
        await addEntry("e1", "Same");
        await addEntry("e2", "Same");
        await migrateCreate(true);
        const before = await indexes();

        const stopped = await migrate().then(
          () => "applied",
          (error: unknown) =>
            error instanceof Error ? error.message : String(error)
        );

        expect(stopped).toMatch(/TRANSLATED_UNIQUE_OVER_DUPLICATES/);
        expect(stopped).toContain("e1");
        expect(stopped).toContain("e2");
        expect(stopped).not.toContain("Same");
        expect(await indexes()).toEqual(before);

        await adapter.executeQuery(
          `UPDATE ${q(companion)} SET ${q("handle")} = 'Other' WHERE ${q("_parent")} = 'e2'`
        );
        await migrate();
        expect(await indexes()).toContain(
          companionUniqueIndexName(companion, "handle")
        );
        await expect(addEntry("e3", "Same")).rejects.toThrow(
          /unique|duplicate/i
        );
      });
    }
  );
}
