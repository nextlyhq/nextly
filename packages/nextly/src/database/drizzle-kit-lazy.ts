// What: lazy accessor for drizzle-kit/api. Used only by domains/schema/services/.
// Why: drizzle-kit/api pulls @libsql native binaries that fail to resolve
// during `next build`. We need the import to (a) survive bundling without
// pulling drizzle-kit's full dep tree into the client bundle and (b)
// resolve correctly at runtime regardless of where the bundler placed
// the importing chunk.
//
// Resolution mechanism: `createRequire(import.meta.url)("drizzle-kit/api")`.
// Same pattern as `next/navigation` resolution in `api/with-error-handler.ts`
// and `actions/with-action.ts` (Phase 4 step 1, 2026-04-30). createRequire
// anchors to the calling source file's URL; Turbopack treats createRequire
// as opaque and leaves it untouched. Falls back to Node's CJS resolver
// which finds drizzle-kit/api.js wherever pnpm hoisted it.
//
// Why this matters here specifically: when Turbopack rebundles nextly's
// dist into a chunk under `apps/<consumer>/.next/dev/server/chunks/...`
// (despite serverExternalPackages), a dynamic `import("drizzle-kit/api")`
// resolves relative to the chunk's location — and drizzle-kit lives at
// `packages/nextly/node_modules/drizzle-kit/`, unreachable from `.next/`.
// createRequire's resolution is anchored to `import.meta.url`, which the
// Turbopack runtime keeps pointing at the original module identity rather
// than the chunk file. End-users no longer have to install drizzle-kit
// in their consumer projects to make this work.
//
// Lazy + globalThis-backed cache: matches Nextly's existing init.ts
// singleton convention so HMR module re-execution doesn't re-resolve
// the module on every save.

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

// Loads drizzle-kit/api once per process via createRequire. The accessor
// stays async even though `require()` is sync — callers (getPgDrizzleKit
// etc.) already `await loadModule()` and changing them to sync would be
// a needless API churn for callers that have to await the rest of the
// pipeline anyway.
//
// Why CJS-via-createRequire instead of dynamic import("drizzle-kit/api"):
// see header comment. drizzle-kit ships both api.js (CJS) and api.mjs
// (ESM); createRequire grabs api.js (CJS). The exported names are
// identical between the two builds — same shape as DrizzleKitRawModule.
import { createRequire } from "node:module";

async function loadModule(): Promise<DrizzleKitRawModule> {
  if (g.__nextly_drizzleKitModule) return g.__nextly_drizzleKitModule;
  const require = createRequire(import.meta.url);
  const mod = require("drizzle-kit/api") as DrizzleKitRawModule;
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
