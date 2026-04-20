// ESM-safe wrapper for drizzle-kit/api programmatic imports.
// drizzle-kit/api has an ESM import bug (https://github.com/drizzle-team/drizzle-orm/issues/2853).
// Uses createRequire() as a workaround for the ESM bug.
// All code that needs drizzle-kit/api should import from this file.

import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Runtime-computed module name prevents Turbopack/webpack from statically
// resolving drizzle-kit/api (which imports @libsql native binaries that
// are unavailable during production builds).
const DK_API = ["drizzle-kit", "api"].join("/");

// Cached kit instances (resolved once per process)
let _pgKit: PgDrizzleKit | null = null;
let _mysqlKit: MySQLDrizzleKit | null = null;
let _sqliteKit: SQLiteDrizzleKit | null = null;

// Result returned by pushSchema() before calling apply()
export interface PushSchemaResult {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
  apply: () => Promise<void>;
}

// PostgreSQL drizzle-kit API
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

// MySQL drizzle-kit API
export interface MySQLDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown,
    databaseName: string
  ) => Promise<PushSchemaResult>;
  // NOTE: generateMySQLDrizzleJson is ASYNC (returns Promise), unlike the
  // PG version which is sync. Must be awaited before passing to generateMigration.
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    casing?: string
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

// SQLite drizzle-kit API
export interface SQLiteDrizzleKit {
  pushSchema: (
    imports: Record<string, unknown>,
    drizzleInstance: unknown
  ) => Promise<PushSchemaResult>;
  // NOTE: generateSQLiteDrizzleJson is ASYNC (returns Promise), same as MySQL.
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    casing?: string
  ) => Promise<unknown>;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
}

export function requireDrizzleKit(): PgDrizzleKit {
  if (_pgKit) return _pgKit;

  const {
    pushSchema,
    generateDrizzleJson,
    generateMigration,
    upPgSnapshot,
  } = require(DK_API);

  _pgKit = {
    pushSchema,
    generateDrizzleJson,
    generateMigration,
    upSnapshot: upPgSnapshot,
  };

  return _pgKit;
}

export function requireDrizzleKitMySQL(): MySQLDrizzleKit {
  if (_mysqlKit) return _mysqlKit;

  const {
    pushMySQLSchema,
    generateMySQLDrizzleJson,
    generateMySQLMigration,
  } = require(DK_API);

  _mysqlKit = {
    pushSchema: pushMySQLSchema,
    generateDrizzleJson: generateMySQLDrizzleJson,
    generateMigration: generateMySQLMigration,
  };

  return _mysqlKit;
}

export function requireDrizzleKitSQLite(): SQLiteDrizzleKit {
  if (_sqliteKit) return _sqliteKit;

  const {
    pushSQLiteSchema,
    generateSQLiteDrizzleJson,
    generateSQLiteMigration,
  } = require(DK_API);

  _sqliteKit = {
    pushSchema: pushSQLiteSchema,
    generateDrizzleJson: generateSQLiteDrizzleJson,
    generateMigration: generateSQLiteMigration,
  };

  return _sqliteKit;
}

// Helper: get the right kit for a dialect
export function requireDrizzleKitForDialect(
  dialect: "postgresql" | "mysql" | "sqlite"
): PgDrizzleKit | MySQLDrizzleKit | SQLiteDrizzleKit {
  switch (dialect) {
    case "postgresql":
      return requireDrizzleKit();
    case "mysql":
      return requireDrizzleKitMySQL();
    case "sqlite":
      return requireDrizzleKitSQLite();
  }
}
