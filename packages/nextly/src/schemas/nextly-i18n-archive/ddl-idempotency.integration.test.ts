/**
 * `getI18nArchiveDdl` must be safe to apply repeatedly.
 *
 * The three dispatchers run it immediately before every localization DISABLE, because a
 * Builder entity has no `nextly migrate` step to provision the archive. That call site has
 * no error handling and its comment asserts the DDL is idempotent — so if any statement
 * fails on a second application, disabling localization breaks permanently after the
 * first time.
 *
 * `CREATE TABLE IF NOT EXISTS` covers the table on every dialect. The index is the risk:
 * MySQL has no `IF NOT EXISTS` for `CREATE INDEX`, so any separate index statement there
 * raises ER_DUP_KEYNAME once the index exists. Applying twice is the whole test.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getI18nArchiveDdl } from "./ddl";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tableExists(name: string): Promise<boolean>;
}

const DIALECTS: Array<{
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}> = [
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

for (const entry of DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`getI18nArchiveDdl idempotency — ${entry.dialect}`, () => {
    let adapter: TestAdapter;
    const table = "nextly_i18n_archive";
    const q = entry.dialect === "mysql" ? "`" : '"';

    async function applyDdl(): Promise<void> {
      for (const stmt of getI18nArchiveDdl(entry.dialect)) {
        await adapter.executeQuery(stmt);
      }
    }

    beforeAll(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();
      // Start from nothing so the first application is a genuine fresh install.
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q}${table}${q}`);
    });

    afterAll(async () => {
      try {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q}${table}${q}`);
      } catch {
        // best-effort cleanup
      }
      await adapter.disconnect();
    });

    it("applies cleanly on a fresh database", async () => {
      await expect(applyDdl()).resolves.toBeUndefined();
      expect(await adapter.tableExists(table)).toBe(true);
    });

    it("applies again without error — every localization disable re-runs it", async () => {
      await expect(applyDdl()).resolves.toBeUndefined();
      // A third time, since the failure mode is "any run after the first".
      await expect(applyDdl()).resolves.toBeUndefined();
      expect(await adapter.tableExists(table)).toBe(true);
    });

    it("keeps the lookup index after repeated application", async () => {
      await applyDdl();

      // Ask the live catalog rather than trusting the statements.
      const indexes =
        entry.dialect === "postgresql"
          ? await adapter.executeQuery<{ indexname: string }>(
              `SELECT indexname FROM pg_indexes WHERE tablename = '${table}'`
            )
          : entry.dialect === "mysql"
            ? await adapter.executeQuery<{ Key_name: string }>(
                `SHOW INDEX FROM \`${table}\``
              )
            : await adapter.executeQuery<{ name: string }>(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`
              );

      const names = indexes.map(row =>
        String(
          (row as Record<string, unknown>).indexname ??
            (row as Record<string, unknown>).Key_name ??
            (row as Record<string, unknown>).name
        )
      );
      expect(names).toContain("nextly_i18n_archive_lookup_idx");
    });
  });
}
