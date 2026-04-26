// What: lazy accessor for drizzle-kit/api. Used only by domains/schema/services/.
// Why: drizzle-kit/api pulls @libsql native binaries that fail to resolve
// during `next build`. The webpackIgnore + turbopackIgnore magic comments
// tell the bundler to leave the import as a runtime-only call. The lazy
// accessor pattern matches Nextly's existing init.ts singleton convention
// (globalThis-backed cache survives Turbopack HMR module re-execution).

// Result returned by drizzle-kit's pushSchema before apply() runs.
export interface PushSchemaResult {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
  apply: () => Promise<void>;
}

// PostgreSQL drizzle-kit API surface.
export interface PgDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown,
    schemaFilters?: string[],
    tablesFilter?: string[],
    extensionsFilters?: string[]
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    schemaFilters?: string[],
    casing?: string
  ) => unknown;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
  upSnapshot: (snapshot: Record<string, unknown>) => unknown;
}

// MySQL drizzle-kit API surface. NOTE: generateDrizzleJson is async here
// (unlike PG); callers must await before passing to generateMigration.
export interface MySQLDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown,
    databaseName: string
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    casing?: string
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

// SQLite drizzle-kit API surface. Same async caveat as MySQL.
export interface SQLiteDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown
  ) => Promise<PushSchemaResult>;
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    casing?: string
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

// Raw module type. We type it as a record of unknowns instead of
// `typeof import("drizzle-kit/api")` because the magic-comment-protected
// dynamic import is intentionally opaque to the bundler; type-only imports
// are tolerated and Nextly's TypeScript config can resolve them at compile
// time, but the runtime type does not need to be perfectly aligned to
// preserve the load-once invariant.
type DrizzleKitRawModule = {
  pushSchema: PgDrizzleKit["pushSchema"];
  pushMySQLSchema: MySQLDrizzleKit["pushSchema"];
  pushSQLiteSchema: SQLiteDrizzleKit["pushSchema"];
  generateDrizzleJson: PgDrizzleKit["generateDrizzleJson"];
  generateMySQLDrizzleJson: MySQLDrizzleKit["generateDrizzleJson"];
  generateSQLiteDrizzleJson: SQLiteDrizzleKit["generateDrizzleJson"];
  generateMigration: PgDrizzleKit["generateMigration"];
  generateMySQLMigration: MySQLDrizzleKit["generateMigration"];
  generateSQLiteMigration: SQLiteDrizzleKit["generateMigration"];
  upPgSnapshot: PgDrizzleKit["upSnapshot"];
};

// Process-wide cache lives on globalThis so it survives Turbopack HMR
// module re-execution (matches Nextly's init.ts pattern and Payload's
// global._payload pattern).
type DrizzleKitCache = {
  __nextly_drizzleKitModule?: DrizzleKitRawModule;
  __nextly_drizzleKitPg?: PgDrizzleKit;
  __nextly_drizzleKitMySQL?: MySQLDrizzleKit;
  __nextly_drizzleKitSQLite?: SQLiteDrizzleKit;
};

const g = globalThis as DrizzleKitCache;

// Loads drizzle-kit/api once per process. The webpackIgnore + turbopackIgnore
// magic comments are documented Next.js features that prevent the bundler
// from tracing through this dynamic import (Next.js 16.2 docs:
// https://nextjs.org/docs/app/guides/lazy-loading#skip-bundling-with-webpackignore-and-turbopackignore-magic-comments).
async function loadModule(): Promise<DrizzleKitRawModule> {
  if (g.__nextly_drizzleKitModule) return g.__nextly_drizzleKitModule;
  const mod = (await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    "drizzle-kit/api"
  )) as DrizzleKitRawModule;
  g.__nextly_drizzleKitModule = mod;
  return mod;
}

export async function getPgDrizzleKit(): Promise<PgDrizzleKit> {
  if (g.__nextly_drizzleKitPg) return g.__nextly_drizzleKitPg;
  const m = await loadModule();
  g.__nextly_drizzleKitPg = {
    pushSchema: m.pushSchema,
    generateDrizzleJson: m.generateDrizzleJson,
    generateMigration: m.generateMigration,
    upSnapshot: m.upPgSnapshot,
  };
  return g.__nextly_drizzleKitPg;
}

export async function getMySQLDrizzleKit(): Promise<MySQLDrizzleKit> {
  if (g.__nextly_drizzleKitMySQL) return g.__nextly_drizzleKitMySQL;
  const m = await loadModule();
  g.__nextly_drizzleKitMySQL = {
    pushSchema: m.pushMySQLSchema,
    generateDrizzleJson: m.generateMySQLDrizzleJson,
    generateMigration: m.generateMySQLMigration,
  };
  return g.__nextly_drizzleKitMySQL;
}

export async function getSQLiteDrizzleKit(): Promise<SQLiteDrizzleKit> {
  if (g.__nextly_drizzleKitSQLite) return g.__nextly_drizzleKitSQLite;
  const m = await loadModule();
  g.__nextly_drizzleKitSQLite = {
    pushSchema: m.pushSQLiteSchema,
    generateDrizzleJson: m.generateSQLiteDrizzleJson,
    generateMigration: m.generateSQLiteMigration,
  };
  return g.__nextly_drizzleKitSQLite;
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
