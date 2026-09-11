/**
 * A database nothing else has touched, on whichever dialect a test asks for.
 *
 * The core tables have fixed names, so a test that builds the whole core
 * schema cannot share the integration database with the ~160 suites beside
 * it: it needs its own. Postgres and MySQL get a per-run database created and
 * dropped here; SQLite is in-memory. The test sees one shape for all three, so
 * a property it asserts on SQLite is asserted on the other two by adding a
 * dialect to a list rather than by writing a second test.
 *
 * Postgres and MySQL are skipped, not failed, when their URL is unset: the
 * canonical root scripts set exactly one, and a dialect nobody asked for is
 * not a broken one.
 */
import { randomBytes } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { readDialectUrl } from "../../database/__tests__/integration/helpers/test-db";
import { getDrizzleKitForDialect } from "../../database/drizzle-kit-lazy";
import {
  getDialectTables,
  getDialectTablesForPush,
} from "../../database/index";

export interface FreshDatabase {
  dialect: SupportedDialect;
  /** The drizzle instance the product code takes for this dialect. */
  db: unknown;
  /** The dialect's own drizzle table objects, for typed inserts. */
  tables: ReturnType<typeof getDialectTables>;
  /** Run one raw statement. */
  exec(statement: string): Promise<void>;
  /** The column names a table currently has, in the live database. */
  columnsOf(table: string): Promise<string[]>;
}

/** Every dialect that has a URL in this run, with SQLite always present. */
export function availableDialects(): SupportedDialect[] {
  return (["sqlite", "postgresql", "mysql"] as const).filter(
    dialect => dialect === "sqlite" || readDialectUrl(dialect) !== null
  );
}

/**
 * Create the current core schema the way a fresh install is created —
 * drizzle-kit's own migration from nothing to the canonical definitions —
 * so the only differences a test then introduces are the ones it means to.
 */
export async function buildCurrentCoreSchema(
  fresh: FreshDatabase
): Promise<void> {
  const kit = await getDrizzleKitForDialect(fresh.dialect);
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson(getDialectTablesForPush(fresh.dialect, {}))
  );
  for (const statement of statements) await fresh.exec(statement);
}

/**
 * Run `body` against a fresh database on `dialect`, then tear it down.
 *
 * The name is a prefix; the database created is per run, so two runs — or a
 * run and an unrelated database of the same name — never collide.
 */
export async function withFreshDatabase(
  dialect: SupportedDialect,
  name: string,
  body: (fresh: FreshDatabase) => Promise<void>
): Promise<void> {
  const tables = getDialectTables(dialect);
  switch (dialect) {
    case "sqlite": {
      const { default: Database } = await import("better-sqlite3");
      const { drizzle } = await import("drizzle-orm/better-sqlite3");
      const sqlite = new Database(":memory:");
      try {
        await body({
          dialect,
          db: drizzle({ client: sqlite }),
          tables,
          exec: async statement => {
            sqlite.exec(statement);
          },
          columnsOf: async table =>
            (
              sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
                name: string;
              }>
            ).map(column => column.name),
        });
      } finally {
        sqlite.close();
      }
      return;
    }
    case "postgresql": {
      const { Pool } = await import("pg");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const adminUrl = readDialectUrl(dialect);
      if (adminUrl === null) throw new Error("TEST_POSTGRES_URL is unset");
      const dbName = `${name}_${randomBytes(8).toString("hex")}`;
      const admin = new Pool({ connectionString: adminUrl });
      try {
        await admin.query(`CREATE DATABASE ${dbName}`);
        const url = new URL(adminUrl);
        url.pathname = `/${dbName}`;
        const pool = new Pool({ connectionString: url.toString() });
        try {
          await body({
            dialect,
            db: drizzle({ client: pool }),
            tables,
            exec: async statement => {
              await pool.query(statement);
            },
            columnsOf: async table =>
              (
                await pool.query<{ column_name: string }>(
                  "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
                  [table]
                )
              ).rows.map(row => row.column_name),
          });
        } finally {
          await pool.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
        await admin.end();
      }
      return;
    }
    case "mysql": {
      const { createPool } = await import("mysql2");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const adminUrl = readDialectUrl(dialect);
      if (adminUrl === null) throw new Error("TEST_MYSQL_URL is unset");
      const dbName = `${name}_${randomBytes(8).toString("hex")}`;
      const admin = createPool({ uri: adminUrl });
      try {
        await admin.promise().query(`CREATE DATABASE ${dbName}`);
        const url = new URL(adminUrl);
        url.pathname = `/${dbName}`;
        const pool = createPool({ uri: url.toString() });
        try {
          await body({
            dialect,
            db: drizzle({ client: pool }),
            tables,
            exec: async statement => {
              await pool.promise().query(statement);
            },
            columnsOf: async table => {
              const [rows] = await pool
                .promise()
                .query(
                  "SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
                  [table]
                );
              return (rows as Array<{ column_name: string }>).map(
                row => row.column_name
              );
            },
          });
        } finally {
          await new Promise<void>(resolve => pool.end(() => resolve()));
        }
      } finally {
        await admin
          .promise()
          .query(`DROP DATABASE IF EXISTS ${dbName}`)
          .catch(() => {});
        await new Promise<void>(resolve => admin.end(() => resolve()));
      }
      return;
    }
    default: {
      const exhaustive: never = dialect;
      throw new Error(`unknown dialect ${String(exhaustive)}`);
    }
  }
}
