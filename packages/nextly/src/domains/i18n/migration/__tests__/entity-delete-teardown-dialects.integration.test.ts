/**
 * Cross-dialect proof for the entity-delete i18n teardown.
 *
 * The SQLite suite next door proves the teardown's behavior, but it cannot prove the thing
 * that actually caused the singles leak: on PostgreSQL, dropping a table that a companion's
 * FK references FAILS unless the drop cascades. SQLite happily drops it either way, so a
 * SQLite-only test would pass against the buggy code.
 *
 * Each dialect therefore asserts both halves:
 *   1. The bug is real here — the exact statement the old singles path emitted
 *      (`DROP TABLE IF EXISTS <main>` with no CASCADE) against a live companion.
 *   2. The fix works here — after `teardownEntityI18n` the main table drops cleanly and
 *      neither table nor the entity's archive rows remain.
 *
 * Self-skips when the dialect's URL is unset (see .claude/rules/integration-tests.md).
 * Tables are prefixed per-run so the suite never collides with anything else in the database.
 */

import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive";
import { buildCompanionCreateOnlySql } from "../generate-up";
import { teardownEntityI18n } from "../teardown-entity-i18n";

/** Minimal adapter surface these tests drive. */
interface TestAdapter {
  dialect: SupportedDialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tableExists(name: string): Promise<boolean>;
  getDrizzle(): unknown;
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
    // SQLite needs no URL — in-memory is a real engine and still worth the parity check.
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

for (const entry of DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`entity delete teardown — ${entry.dialect}`, () => {
    let adapter: TestAdapter;
    // Per-run prefix so these tables can never collide with real ones in a shared database.
    const prefix = `dc_t${randomBytes(6).toString("hex")}`;
    const main = prefix;
    const companion = `${prefix}_locales`;
    const slug = prefix;

    // MySQL/Postgres identifier quoting differs; mirrors the production helper.
    const q = (id: string) =>
      entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;

    beforeAll(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();
      for (const stmt of getI18nArchiveDdl(entry.dialect)) {
        // The lookup index may already exist from a prior run on a reused database.
        // MySQL's CREATE INDEX has no IF NOT EXISTS and reports ER_DUP_KEYNAME
        // ("Duplicate key name"), so tolerate an already-present index on any dialect.
        try {
          await adapter.executeQuery(stmt);
        } catch (error) {
          if (!/exist|duplicate key name/i.test(String(error))) throw error;
        }
      }
    });

    afterAll(async () => {
      // Leave the database exactly as found, even if an assertion failed mid-suite.
      try {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(companion)}`);
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(main)}`);
        await adapter.executeQuery(
          `DELETE FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${slug}'`
        );
      } catch {
        // best-effort cleanup
      }
      await adapter.disconnect();
    });

    /** Builds a localized entity: main table + companion holding the FK to main.id. */
    async function createLocalizedEntity(): Promise<void> {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(companion)}`);
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(main)}`);
      const idType = entry.dialect === "postgresql" ? "text" : "varchar(191)";
      await adapter.executeQuery(
        `CREATE TABLE ${q(main)} (${q("id")} ${idType} PRIMARY KEY, ${q("price")} integer)`
      );
      await adapter.executeQuery(
        buildCompanionCreateOnlySql({
          dialect: entry.dialect,
          collection: slug,
          mainTable: main,
          companionTable: companion,
          defaultLocale: "en",
          parentIdType: idType,
          columns: [{ name: "body", kind: "longText" }],
        }).replace(/;$/, "")
      );
    }

    async function archiveCountForSlug(): Promise<number> {
      const rows = await adapter.executeQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${slug}'`
      );
      return Number(rows[0]?.n ?? 0);
    }

    it("reproduces the original bug: a non-cascading main drop is rejected while the companion exists", async () => {
      await createLocalizedEntity();

      // Verbatim the statement the old singles delete path emitted.
      const attempt = adapter.executeQuery(`DROP TABLE IF EXISTS ${q(main)}`);

      if (entry.dialect === "sqlite") {
        // SQLite does not enforce this at DDL time — documents WHY a SQLite-only
        // test could never have caught the singles regression.
        await expect(attempt).resolves.toBeDefined();
      } else {
        await expect(attempt).rejects.toThrow();
        // The main table survived the failed drop, which is what left singles stranded:
        // the old code swallowed this error and deleted the registry row regardless.
        expect(await adapter.tableExists(main)).toBe(true);
      }
    });

    it("teardown drops the companion and purges only this entity's archive rows", async () => {
      await createLocalizedEntity();
      await adapter.executeQuery(
        `INSERT INTO ${q("nextly_i18n_archive")} (${q("collection")}, ${q("entry_id")}, ${q("locale")}, ${q("field")}, ${q("value")}) VALUES ('${slug}', 'e1', 'fr', 'body', 'Bonjour')`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q("nextly_i18n_archive")} (${q("collection")}, ${q("entry_id")}, ${q("locale")}, ${q("field")}, ${q("value")}) VALUES ('${slug}_other', 'e1', 'fr', 'body', 'Keep me')`
      );

      const result = await teardownEntityI18n({
        adapter: adapter as never,
        slug,
        tableName: main,
      });

      expect(result.companionDropped).toBe(true);
      expect(await adapter.tableExists(companion)).toBe(false);
      expect(await archiveCountForSlug()).toBe(0);

      // The shared archive must keep every other entity's restore trail.
      const others = await adapter.executeQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${slug}_other'`
      );
      expect(Number(others[0]?.n ?? 0)).toBe(1);

      await adapter.executeQuery(
        `DELETE FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = '${slug}_other'`
      );
    });

    it("after teardown the main table drops cleanly — the end-to-end delete now completes", async () => {
      await createLocalizedEntity();

      await teardownEntityI18n({
        adapter: adapter as never,
        slug,
        tableName: main,
      });
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(main)}`);

      expect(await adapter.tableExists(main)).toBe(false);
      expect(await adapter.tableExists(companion)).toBe(false);
    });

    it("is a safe no-op for a non-localized entity", async () => {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(companion)}`);
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(main)}`);
      const idType = entry.dialect === "postgresql" ? "text" : "varchar(191)";
      await adapter.executeQuery(
        `CREATE TABLE ${q(main)} (${q("id")} ${idType} PRIMARY KEY)`
      );

      const result = await teardownEntityI18n({
        adapter: adapter as never,
        slug,
        tableName: main,
      });

      expect(result.companionDropped).toBe(false);
      expect(await adapter.tableExists(main)).toBe(true);
    });
  });
}
