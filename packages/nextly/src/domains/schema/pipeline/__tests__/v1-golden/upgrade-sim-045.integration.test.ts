// Phase 7 Task 4 — the "existing user upgrades" simulation.
//
// Every current Nextly user has a database whose DDL was emitted by
// drizzle-kit 0.31 (drizzle-orm 0.45). The nightmare upgrade: they update
// Nextly, boot, and v1's differ sees PHANTOM differences in their untouched
// schema and proposes changes on every run, forever.
//
// fixtures-045/*.json hold the EXACT statements 0.31 emitted for the full
// static core schema + one dynamic collection (captured from an origin/main
// scratch worktree; MySQL via generateMigration because 0.31's MySQL
// pushSchema returned empty lists — the W1 bug). This test replays them into
// a fresh database and pins the upgrade contract per dialect:
//
//   PostgreSQL — v1 proposes NOTHING. Strict zero (spike 1.4,
//     institutionalized).
//   MySQL — ONE reconcile: 0.31-era schema defs baked module-load-time
//     literal datetime defaults (`.default(new Date())`, latent main bug the
//     broken 0.31 MySQL differ never surfaced). The v1-branch defs normalize
//     to DEFAULT CURRENT_TIMESTAMP (D4), so the first pass emits only
//     metadata `MODIFY COLUMN … DEFAULT CURRENT_TIMESTAMP` statements; after
//     apply, the second pass is ZERO and data survives.
//   SQLite — ONE reconcile: 0.31 emitted standalone UNIQUE indexes where v1
//     represents inline UNIQUE, so the first pass rebuilds the affected
//     metadata tables via the data-preserving __new_ block (which the
//     destructive-statement scanner must NOT flag); after apply, the second
//     pass is ZERO and data survives.
//
// Re-runs on every future Drizzle pin bump — wording/convention drift in a
// new version shows up here before any user hits it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool } from "mysql2";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
  getSQLiteDrizzleKit,
} from "../../../../../database/drizzle-kit-lazy";
import * as mysqlTables from "../../../../../schemas/_dialect-bundles/mysql";
import * as pgTables from "../../../../../schemas/_dialect-bundles/postgres";
import * as sqliteTables from "../../../../../schemas/_dialect-bundles/sqlite";
import {
  generateRuntimeSchema,
  type FieldDefinition,
} from "../../../services/runtime-schema-generator";
import { findUnexpectedDestructiveStatements } from "../../filter-unsafe-statements";

interface Fixture {
  capturedFrom: string;
  dynamicFields: FieldDefinition[];
  statements: string[];
}

function loadFixture(dialect: string): Fixture {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures-045", `${dialect}.json`), "utf-8")
  ) as Fixture;
}

// The bundles are pure table modules since Phase 4, but keep the guard so a
// future re-export of something non-table doesn't silently join the diff.
function onlyTables(bundle: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bundle)) {
    if (!k.toLowerCase().includes("relations")) out[k] = v;
  }
  return out;
}

describe("existing-user upgrade sim (0.45 DDL → v1)", () => {
  it("sqlite: one data-preserving reconcile, then zero", async () => {
    const fixture = loadFixture("sqlite");
    const sqlite = new Database(":memory:");
    try {
      for (const stmt of fixture.statements) sqlite.exec(stmt);
      // Data that must survive the reconcile rebuild.
      sqlite
        .prepare(
          `INSERT INTO dynamic_collections
             (id, slug, labels, table_name, fields, schema_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "dc-1",
          "articles",
          "{}",
          "dc_upgrade_articles",
          "[]",
          "hash",
          1700000000,
          1700000000
        );

      const db = drizzleSqlite({ client: sqlite });
      const kit = await getSQLiteDrizzleKit();
      const { schemaRecord } = generateRuntimeSchema(
        "dc_upgrade_articles",
        fixture.dynamicFields,
        "sqlite"
      );
      const desired = { ...onlyTables(sqliteTables as never), ...schemaRecord };

      // Pass 1: the documented reconcile. Only data-preserving rebuild
      // blocks + index statements are acceptable — the scanner is the
      // arbiter of "data-preserving".
      const first = await kit.pushSchema(desired, db);
      expect(findUnexpectedDestructiveStatements(first.sqlStatements)).toEqual(
        []
      );
      expect(first.hints).toEqual([]);
      await first.apply();

      // Data survived the rebuild.
      const row = sqlite
        .prepare("SELECT slug FROM dynamic_collections WHERE id = 'dc-1'")
        .get() as { slug: string } | undefined;
      expect(row?.slug).toBe("articles");

      // Pass 2: silence.
      const second = await kit.pushSchema(desired, db);
      expect(second.sqlStatements).toEqual([]);
      expect(second.hints).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    "postgres: strict zero — v1 proposes nothing over a 0.31-created schema",
    async () => {
      const fixture = loadFixture("postgres");
      const admin = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      await admin.query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
      await admin.query("CREATE DATABASE nextly_upgrade_v1");
      const url = new URL(process.env.TEST_POSTGRES_URL as string);
      url.pathname = "/nextly_upgrade_v1";
      const pool = new Pool({ connectionString: url.toString() });
      try {
        for (const stmt of fixture.statements) await pool.query(stmt);
        const db = drizzlePg({ client: pool });
        const kit = await getPgDrizzleKit();
        const { schemaRecord } = generateRuntimeSchema(
          "dc_upgrade_articles",
          fixture.dynamicFields,
          "postgresql"
        );
        const result = await kit.pushSchema(
          { ...onlyTables(pgTables as never), ...schemaRecord },
          db,
          { schemas: ["public"] }
        );
        expect(result.sqlStatements).toEqual([]);
        expect(result.hints).toEqual([]);
      } finally {
        await pool.end();
        await admin.query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
        await admin.end();
      }
    }
  );

  it.skipIf(!process.env.TEST_MYSQL_URL)(
    "mysql: one metadata-only default reconcile, then zero",
    async () => {
      const fixture = loadFixture("mysql");
      const bootstrap = createPool({ uri: process.env.TEST_MYSQL_URL });
      await bootstrap
        .promise()
        .query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
      await bootstrap.promise().query("CREATE DATABASE nextly_upgrade_v1");
      const url = new URL(process.env.TEST_MYSQL_URL as string);
      url.pathname = "/nextly_upgrade_v1";
      const pool = createPool({ uri: url.toString() });
      try {
        const p = pool.promise();
        for (const stmt of fixture.statements) await p.query(stmt);
        // Data that must survive the reconcile.
        await p.query(
          "INSERT INTO roles (id, name, slug, level) VALUES ('r-1', 'Upgrader', 'upgrader', 5)"
        );

        const db = drizzleMysql({ client: pool });
        const kit = await getMySQLDrizzleKit();
        const { schemaRecord } = generateRuntimeSchema(
          "dc_upgrade_articles",
          fixture.dynamicFields,
          "mysql"
        );
        const desired = {
          ...onlyTables(mysqlTables as never),
          ...schemaRecord,
        };

        // Pass 1: ONLY the literal-default → CURRENT_TIMESTAMP MODIFYs
        // (metadata-only; instant; non-destructive).
        const first = await kit.pushSchema(desired, db, "nextly_upgrade_v1");
        expect(first.hints).toEqual([]);
        for (const s of first.sqlStatements) {
          expect(s, "unexpected reconcile statement shape").toMatch(
            /^ALTER TABLE `[^`]+` MODIFY COLUMN `[^`]+` datetime DEFAULT \(?CURRENT_TIMESTAMP\)? NOT NULL;?$/
          );
        }
        await first.apply();

        const [rows] = (await p.query(
          "SELECT slug FROM roles WHERE id = 'r-1'"
        )) as unknown as [Array<{ slug: string }>];
        expect(rows[0]?.slug).toBe("upgrader");

        // Pass 2: silence.
        const second = await kit.pushSchema(desired, db, "nextly_upgrade_v1");
        expect(second.sqlStatements).toEqual([]);
        expect(second.hints).toEqual([]);
      } finally {
        await new Promise<void>(res => pool.end(() => res()));
        await bootstrap
          .promise()
          .query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
        await new Promise<void>(res => bootstrap.end(() => res()));
      }
    }
  );
});
