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

/** A database created beside the integration one, and how to remove it. */
export interface ScratchDatabase {
  /** The integration database's URL, pointed at this database instead. */
  url: string;
  /** Drop it and close the connection that created it. Never throws. */
  drop(): Promise<void>;
}

/**
 * Create a database of a test's own beside the integration database, for a
 * suite that connects to it by URL, through the product's adapter, rather than
 * through the pool `withFreshDatabase` hands its body.
 *
 * The name is a prefix; the database created is per run, so two runs — or a
 * run and an unrelated database of the same name — never collide. A failure
 * while creating it still closes the connection, so nothing is left open.
 */
export async function createScratchDatabase(
  dialect: "postgresql" | "mysql",
  name: string
): Promise<ScratchDatabase> {
  const adminUrl = readDialectUrl(dialect);
  if (adminUrl === null) {
    throw new Error(
      `${dialect === "postgresql" ? "TEST_POSTGRES_URL" : "TEST_MYSQL_URL"} is unset`
    );
  }
  const dbName = `${name}_${randomBytes(8).toString("hex")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  if (dialect === "postgresql") {
    const { Pool } = await import("pg");
    const admin = new Pool({ connectionString: adminUrl });
    const drop = async (): Promise<void> => {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
      await admin.end().catch(() => {});
    };
    try {
      await admin.query(`CREATE DATABASE ${dbName}`);
    } catch (error) {
      await drop();
      throw error;
    }
    return { url: url.toString(), drop };
  }
  const { createPool } = await import("mysql2");
  const admin = createPool({ uri: adminUrl });
  const drop = async (): Promise<void> => {
    await admin
      .promise()
      .query(`DROP DATABASE IF EXISTS ${dbName}`)
      .catch(() => {});
    await new Promise<void>(resolve => admin.end(() => resolve()));
  };
  try {
    await admin.promise().query(`CREATE DATABASE ${dbName}`);
  } catch (error) {
    await drop();
    throw error;
  }
  return { url: url.toString(), drop };
}

/**
 * What the integration database itself holds for `tables`, so a suite that
 * works in a scratch database can show it left the shared ones as it found
 * them: each table present, its columns, its indexes (its primary key among
 * them), and the constraints on it or pointing at it. Each table's identity is
 * read too, so one dropped and rebuilt in place reads differently even with the
 * same shape: its oid on Postgres, and on MySQL its creation time, to the
 * second, read with the session's statistics cache off, since MySQL otherwise
 * serves that column from a cache that can outlive the table. Null on SQLite, whose in-memory
 * database is already a suite's own.
 */
export async function describeSharedTables(
  dialect: SupportedDialect,
  tables: string[]
): Promise<unknown[] | null> {
  if (dialect === "sqlite") return null;
  const url = readDialectUrl(dialect);
  if (url === null) return null;
  if (dialect === "postgresql") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    try {
      // `contype` and `attname` are Postgres's own `"char"` and `name` types,
      // which `||` cannot join to text without a cast.
      const { rows } = await pool.query(
        `SELECT c.relname::text AS tbl, c.oid::text AS obj,
           (SELECT string_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END, ', ' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS cols,
           (SELECT string_agg(con.conname::text || ' on ' || con.conrelid::regclass::text || ': ' || pg_get_constraintdef(con.oid), ', ' ORDER BY con.conname)
              FROM pg_constraint con WHERE con.conrelid = c.oid OR con.confrelid = c.oid) AS refs,
           (SELECT string_agg(pg_get_indexdef(i.indexrelid), ', ' ORDER BY i.indexrelid::regclass::text)
              FROM pg_index i WHERE i.indrelid = c.oid) AS idx
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = ANY($1::text[])
         ORDER BY c.relname`,
        [tables]
      );
      return rows;
    } finally {
      await pool.end();
    }
  }
  const { createPool } = await import("mysql2");
  const pool = createPool({ uri: url });
  try {
    const connection = await pool.promise().getConnection();
    try {
      // One connection, so the setting holds for the query that reads it.
      await connection.query("SET SESSION information_schema_stats_expiry = 0");
      const [rows] = await connection.query(
        `SELECT t.TABLE_NAME AS tbl, CAST(t.CREATE_TIME AS CHAR) AS obj,
           (SELECT GROUP_CONCAT(CONCAT(c.COLUMN_NAME, ' ', c.COLUMN_TYPE, IF(c.IS_NULLABLE = 'NO', ' not null', '')) ORDER BY c.ORDINAL_POSITION SEPARATOR ', ')
              FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS cols,
           (SELECT GROUP_CONCAT(CONCAT(k.CONSTRAINT_NAME, ' on ', k.TABLE_NAME, ' to ', k.REFERENCED_TABLE_NAME, ' ', k.DELETE_RULE) ORDER BY k.CONSTRAINT_NAME SEPARATOR ', ')
              FROM information_schema.REFERENTIAL_CONSTRAINTS k
              WHERE k.CONSTRAINT_SCHEMA = t.TABLE_SCHEMA AND (k.TABLE_NAME = t.TABLE_NAME OR k.REFERENCED_TABLE_NAME = t.TABLE_NAME)) AS refs,
           (SELECT GROUP_CONCAT(CONCAT(s.INDEX_NAME, IF(s.NON_UNIQUE = 0, ' unique ', ' '), COALESCE(s.COLUMN_NAME, '')) ORDER BY s.INDEX_NAME, s.SEQ_IN_INDEX SEPARATOR ', ')
              FROM information_schema.STATISTICS s WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME) AS idx
         FROM information_schema.TABLES t
         WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME IN (?)
         ORDER BY t.TABLE_NAME`,
        [tables]
      );
      return rows as unknown[];
    } finally {
      connection.release();
    }
  } finally {
    await new Promise<void>(resolve => pool.end(() => resolve()));
  }
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
      const scratch = await createScratchDatabase(dialect, name);
      try {
        const pool = new Pool({ connectionString: scratch.url });
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
        await scratch.drop();
      }
      return;
    }
    case "mysql": {
      const { createPool } = await import("mysql2");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const scratch = await createScratchDatabase(dialect, name);
      try {
        const pool = createPool({ uri: scratch.url });
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
        await scratch.drop();
      }
      return;
    }
    default: {
      const exhaustive: never = dialect;
      throw new Error(`unknown dialect ${String(exhaustive)}`);
    }
  }
}
