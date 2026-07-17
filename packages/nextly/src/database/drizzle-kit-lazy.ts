// What: lazy accessor for drizzle-kit's per-dialect programmatic API.
// Used only by domains/schema/services/.
// Why: drizzle-kit pulls @libsql native binaries that fail to resolve
// during `next build`. We need the import to (a) survive bundling without
// pulling drizzle-kit's full dep tree into the client bundle and (b)
// resolve correctly at runtime regardless of where the bundler placed
// the importing chunk.
//
// Drizzle V1 (1.0.0-rc.4): the old single-module kit API was
// removed and split per dialect. The complete programmatic surface lives
// under `drizzle-kit/payload/{postgres,mysql,sqlite}` (built for Payload
// CMS's embedded use case — identical to Nextly's). Each module exports
// the SAME symbol names: `pushSchema`, `generateDrizzleJson`,
// `generateMigration`, `up`, `startStudioServer`. The api-mysql/api-sqlite
// entrypoints ship Studio only, and the `drizzle-kit/cli` SDK is
// config-file/credential driven — neither fits the in-memory pipeline.
//
// v1 pushSchema contract changes absorbed here (verified 2026-07-15,
// plan PHASE 1 FINDINGS):
// - result: { sqlStatements, hints, apply } — `hasDataLoss` REMOVED,
//   `statementsToExecute`→`sqlStatements`, `warnings`→`hints`. Destructive
//   statements are now INCLUDED in sqlStatements with EMPTY hints; the
//   data-loss guard lives in the pipeline (destructive-statement scan),
//   not in this wrapper.
// - MySQL/SQLite take a RAW client, not a Drizzle instance. The wrapper
//   keeps accepting the Drizzle instance and derives the raw handle from
//   `db.$client` (guaranteed identical to the client passed to the v1
//   object-form `drizzle({ client })` constructor).
//
// Resolution mechanism: `createRequire(import.meta.url)(subpath)`.
// createRequire anchors to the calling source file's URL; Turbopack treats
// createRequire as opaque and leaves it untouched, falling back to Node's
// CJS resolver which finds drizzle-kit wherever pnpm hoisted it. See the
// original rationale in api/with-error-handler.ts (Phase 4 step 1).
//
// Lazy + globalThis-backed cache: matches Nextly's existing init.ts
// singleton convention so HMR module re-execution doesn't re-resolve
// modules on every save. Dialect modules load independently — a consumer
// app has one dialect; never load the other two.

import { createRequire } from "node:module";

// A single non-fatal hint attached to a generated statement.
export interface KitHint {
  hint: string;
  statement?: string;
}

// Result returned by drizzle-kit v1's pushSchema before apply() runs.
// v1 names adopted outright — no aliasing to the pre-v1 field names.
export interface PushSchemaResult {
  sqlStatements: string[];
  hints: KitHint[];
  apply: () => Promise<void>;
}

// PG pushSchema filter config (replaces the pre-v1 positional
// schemaFilters/tablesFilter/extensionsFilters args). All fields optional
// upstream (zod-optional unions of string | string[]).
export interface PgEntitiesFilter {
  schemas?: string | string[];
  tables?: string | string[];
}

// PostgreSQL drizzle-kit API surface (drizzle-kit/payload/postgres).
export interface PgDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown,
    entitiesConfig?: PgEntitiesFilter
  ) => Promise<PushSchemaResult>;
  // Async in v1 (was sync pre-v1); the `casing` param is gone.
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    schemaFilters?: string[]
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

// MySQL drizzle-kit API surface (drizzle-kit/payload/mysql).
// Accepts the DRIZZLE instance; the raw `{ query }` client the v1 kit
// wants is derived from `drizzleInstance.$client` internally.
export interface MySQLDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown,
    databaseName: string
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

// SQLite drizzle-kit API surface (drizzle-kit/payload/sqlite).
// Same $client derivation as MySQL.
export interface SQLiteDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

// Raw per-dialect module shapes. Typed as records of the wrapper-visible
// call signatures rather than `typeof import(...)` because the
// createRequire load is intentionally opaque to the bundler.
type PayloadPgModule = {
  pushSchema: (
    imports: Record<string, unknown>,
    db: unknown,
    entitiesConfig?: PgEntitiesFilter,
    migrationsConfig?: { table?: string; schema?: string }
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: PgDrizzleKit["generateDrizzleJson"];
  generateMigration: PgDrizzleKit["generateMigration"];
  up: (snapshot: Record<string, unknown>) => unknown; // present upstream; deliberately not exposed (no Nextly caller — D-2.1)
};

type PayloadMySqlModule = {
  pushSchema: (
    imports: Record<string, unknown>,
    db: MySqlKitClient,
    database: string,
    migrationsConfig?: { table?: string; schema?: string }
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: MySQLDrizzleKit["generateDrizzleJson"];
  generateMigration: MySQLDrizzleKit["generateMigration"];
  up: (it: Record<string, unknown>) => unknown;
};

type PayloadSqliteModule = {
  pushSchema: (
    imports: Record<string, unknown>,
    db: SqliteKitClient,
    migrationsConfig?: { table?: string; schema?: string }
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: SQLiteDrizzleKit["generateDrizzleJson"];
  generateMigration: SQLiteDrizzleKit["generateMigration"];
  up: (it: Record<string, unknown>) => unknown;
};

// v1 kit's raw-client contracts (from drizzle-kit's shipped .d.ts).
interface MySqlKitClient {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
}
interface SqliteKitClient {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  run: (query: string) => Promise<void>;
  batch: (statements: string[]) => Promise<void>;
}

// Derives the v1 `{ query }` client from a drizzle-orm/mysql2 instance.
// The adapter hands drizzle the CALLBACK pool (v1 rejects the promise
// wrapper), so `$client` is callback-style — promote it via `.promise()`
// when available; a promise client passes through. `.query` resolves to
// [rows, fields].
function mysqlKitClient(drizzleInstance: unknown): MySqlKitClient {
  const raw = (drizzleInstance as { $client: unknown }).$client as {
    promise?: () => unknown;
    query: unknown;
  };
  const pool = (typeof raw.promise === "function" ? raw.promise() : raw) as {
    query: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  };
  return {
    query: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      const [rows] = await pool.query(sql, params);
      return rows as T[];
    },
  };
}

// Derives the v1 `{ query, run, batch }` client from a
// drizzle-orm/better-sqlite3 instance.
//
// IMPORTANT (#5782): `batch` executes statements SEQUENTIALLY, never inside
// a better-sqlite3 transaction — v1 emits `PRAGMA foreign_keys=OFF/ON`
// inside the statement stream, and SQLite silently ignores that pragma
// inside an open transaction, which is exactly the data-loss bug the
// sqlite-cascade regression test pins.
function sqliteKitClient(drizzleInstance: unknown): SqliteKitClient {
  const db = (
    drizzleInstance as {
      $client: {
        prepare: (sql: string) => {
          reader: boolean;
          all: (...params: unknown[]) => unknown[];
          run: (...params: unknown[]) => unknown;
        };
      };
    }
  ).$client;
  return {
    query: <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      const stmt = db.prepare(sql);
      if (stmt.reader) return Promise.resolve(stmt.all(...params) as T[]);
      stmt.run(...params);
      return Promise.resolve([] as T[]);
    },
    run: (query: string): Promise<void> => {
      db.prepare(query).run();
      return Promise.resolve();
    },
    batch: (statements: string[]): Promise<void> => {
      for (const s of statements) db.prepare(s).run();
      return Promise.resolve();
    },
  };
}

// Process-wide caches live on globalThis so they survive Turbopack HMR
// module re-execution (matches Nextly's init.ts pattern).
type DrizzleKitCache = {
  __nextly_drizzleKitPgMod?: PayloadPgModule;
  __nextly_drizzleKitMySqlMod?: PayloadMySqlModule;
  __nextly_drizzleKitSqliteMod?: PayloadSqliteModule;
  __nextly_drizzleKitPg?: PgDrizzleKit;
  __nextly_drizzleKitMySQL?: MySQLDrizzleKit;
  __nextly_drizzleKitSQLite?: SQLiteDrizzleKit;
};

const g = globalThis as DrizzleKitCache;

// Each dialect loads through its own LITERAL specifier. Routing the subpath
// through a variable makes the bundler see `createRequire(...)(expr)` and
// fail first-run setup with "Cannot find module as expression is too
// dynamic" (caught live by the Phase 7 dev-server exercise) — Turbopack only
// treats createRequire as opaque when the argument is a string literal.
const requirePgKit = (): unknown =>
  createRequire(import.meta.url)("drizzle-kit/payload/postgres");
const requireMySqlKit = (): unknown =>
  createRequire(import.meta.url)("drizzle-kit/payload/mysql");
const requireSqliteKit = (): unknown =>
  createRequire(import.meta.url)("drizzle-kit/payload/sqlite");

// Accessors keep a Promise signature even though `require()` is sync —
// callers already `await` them, and keeping the signature stable avoids churn.

export function getPgDrizzleKit(): Promise<PgDrizzleKit> {
  if (g.__nextly_drizzleKitPg) return Promise.resolve(g.__nextly_drizzleKitPg);
  const m = (g.__nextly_drizzleKitPgMod ??= requirePgKit() as PayloadPgModule);
  g.__nextly_drizzleKitPg = {
    pushSchema: (imports, db, entitiesConfig) =>
      m.pushSchema(imports, db, entitiesConfig),
    generateDrizzleJson: m.generateDrizzleJson,
    generateMigration: m.generateMigration,
  };
  return Promise.resolve(g.__nextly_drizzleKitPg);
}

export function getMySQLDrizzleKit(): Promise<MySQLDrizzleKit> {
  if (g.__nextly_drizzleKitMySQL)
    return Promise.resolve(g.__nextly_drizzleKitMySQL);
  const m = (g.__nextly_drizzleKitMySqlMod ??=
    requireMySqlKit() as PayloadMySqlModule);
  g.__nextly_drizzleKitMySQL = {
    pushSchema: (imports, db, databaseName) =>
      m.pushSchema(imports, mysqlKitClient(db), databaseName),
    generateDrizzleJson: m.generateDrizzleJson,
    generateMigration: m.generateMigration,
  };
  return Promise.resolve(g.__nextly_drizzleKitMySQL);
}

export function getSQLiteDrizzleKit(): Promise<SQLiteDrizzleKit> {
  if (g.__nextly_drizzleKitSQLite)
    return Promise.resolve(g.__nextly_drizzleKitSQLite);
  const m = (g.__nextly_drizzleKitSqliteMod ??=
    requireSqliteKit() as PayloadSqliteModule);
  g.__nextly_drizzleKitSQLite = {
    pushSchema: (imports, db) => m.pushSchema(imports, sqliteKitClient(db)),
    generateDrizzleJson: m.generateDrizzleJson,
    generateMigration: m.generateMigration,
  };
  return Promise.resolve(g.__nextly_drizzleKitSQLite);
}

export async function getDrizzleKitForDialect(
  dialect: "postgresql" | "mysql" | "sqlite"
): Promise<PgDrizzleKit | MySQLDrizzleKit | SQLiteDrizzleKit> {
  switch (dialect) {
    case "postgresql":
      return getPgDrizzleKit();
    case "mysql":
      return getMySQLDrizzleKit();
    case "sqlite":
      return getSQLiteDrizzleKit();
  }
}
