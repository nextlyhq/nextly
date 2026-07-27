/**
 * `ensureWebhookSecretColumnRenamed` must rename `nextly_webhooks.secret_hash`
 * to `secret_ciphertext` in place on an existing install, preserve the stored
 * encrypted secrets, and be a safe no-op on re-runs, on fresh installs (table
 * already has the new column), and when the table does not exist yet.
 *
 * A destructive path here would drop every endpoint's signing secrets, so the
 * rename runs BEFORE the core diff and every branch is guarded. This suite
 * exercises all three dialects (self-skipping when a URL is unset).
 *
 * The fixture creates a minimal old-shape table (id + secret column) rather than
 * the full production schema: this tests the migration mechanic, and a column
 * RENAME is type-agnostic, so faithful column types are used but nothing else of
 * the endpoint shape is relevant here.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ensureWebhookSecretColumnRenamed } from "./secret-column-migration";

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

  suite(`ensureWebhookSecretColumnRenamed — ${entry.dialect}`, () => {
    let adapter: TestAdapter;
    const table = "nextly_webhooks";
    const q = entry.dialect === "mysql" ? "`" : '"';
    const idType = entry.dialect === "mysql" ? "varchar(191)" : "text";
    const jsonType =
      entry.dialect === "postgresql"
        ? "jsonb"
        : entry.dialect === "mysql"
          ? "json"
          : "text";
    const jsonValue =
      entry.dialect === "postgresql" ? `'["whsec_x"]'::jsonb` : `'["whsec_x"]'`;

    async function drop(): Promise<void> {
      // Drop the delivery child first: a residual FK from another webhook suite
      // in the shared throwaway DB would otherwise block dropping the parent.
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${q}nextly_webhook_deliveries${q}`
      );
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q}${table}${q}`);
    }

    async function createTable(secretColumn: string): Promise<void> {
      await adapter.executeQuery(
        `CREATE TABLE ${q}${table}${q} (` +
          `${q}id${q} ${idType} PRIMARY KEY, ` +
          `${q}${secretColumn}${q} ${jsonType} NOT NULL)`
      );
    }

    async function liveColumns(): Promise<Set<string>> {
      if (entry.dialect === "sqlite") {
        const rows = await adapter.executeQuery<{ name: string }>(
          `PRAGMA table_info("${table}")`
        );
        return new Set(rows.map(r => r.name));
      }
      if (entry.dialect === "mysql") {
        const rows = await adapter.executeQuery<{ name: string }>(
          `SELECT COLUMN_NAME AS name FROM information_schema.columns ` +
            `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
        );
        return new Set(rows.map(r => r.name));
      }
      const rows = await adapter.executeQuery<{ name: string }>(
        `SELECT column_name AS name FROM information_schema.columns ` +
          `WHERE table_schema = 'public' AND table_name = '${table}'`
      );
      return new Set(rows.map(r => r.name));
    }

    beforeEach(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();
      await drop();
    });

    afterAll(async () => {
      try {
        await drop();
      } catch {
        // best-effort cleanup
      }
      await adapter.disconnect();
    });

    it("renames secret_hash to secret_ciphertext and preserves the row", async () => {
      await createTable("secret_hash");
      await adapter.executeQuery(
        `INSERT INTO ${q}${table}${q} (${q}id${q}, ${q}secret_hash${q}) ` +
          `VALUES ('w1', ${jsonValue})`
      );

      const renamed = await ensureWebhookSecretColumnRenamed(
        adapter,
        entry.dialect
      );

      expect(renamed).toBe(true);
      const cols = await liveColumns();
      expect(cols.has("secret_ciphertext")).toBe(true);
      expect(cols.has("secret_hash")).toBe(false);

      const rows = await adapter.executeQuery<{ secret_ciphertext: unknown }>(
        `SELECT ${q}secret_ciphertext${q} FROM ${q}${table}${q} WHERE ${q}id${q} = 'w1'`
      );
      expect(rows).toHaveLength(1);
      expect(String(rows[0]?.secret_ciphertext)).toContain("whsec_x");
    });

    it("is idempotent — a second run does nothing", async () => {
      await createTable("secret_hash");
      expect(
        await ensureWebhookSecretColumnRenamed(adapter, entry.dialect)
      ).toBe(true);
      expect(
        await ensureWebhookSecretColumnRenamed(adapter, entry.dialect)
      ).toBe(false);
      const cols = await liveColumns();
      expect(cols.has("secret_ciphertext")).toBe(true);
    });

    it("is a no-op when the table already has the new column (fresh install)", async () => {
      await createTable("secret_ciphertext");
      expect(
        await ensureWebhookSecretColumnRenamed(adapter, entry.dialect)
      ).toBe(false);
    });

    it("is a no-op when the table does not exist", async () => {
      await drop();
      expect(
        await ensureWebhookSecretColumnRenamed(adapter, entry.dialect)
      ).toBe(false);
    });
  });
}
