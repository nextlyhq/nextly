// The framework's static tables and relations for one SQL dialect, loaded only
// for the dialect a process runs on.
//
// Each dialect's bundle is a few dozen table modules, and loading all three
// eagerly put every dialect's tables into every process, test file and build
// that touched the database layer. They are loaded instead when an adapter is
// created (`createAdapter`, and `registerServices` for an adapter it was
// handed), since the adapter is the one thing that knows the dialect. Reads
// stay synchronous: once a dialect is loaded, `getDialectTables` and
// `getStaticRelations` answer from what is loaded here.
//
// Lives in its own module, not database/index, so test suites that vi.mock the
// database barrel do not have to know about it.

import type { AnyRelations } from "drizzle-orm";

import { NextlyError } from "../errors/nextly-error";
import type * as MysqlTables from "../schemas/_dialect-bundles/mysql";
import type * as MysqlRelations from "../schemas/_dialect-bundles/mysql.relations";
import type * as PostgresTables from "../schemas/_dialect-bundles/postgres";
import type * as PostgresRelations from "../schemas/_dialect-bundles/postgres.relations";
import type * as SqliteTables from "../schemas/_dialect-bundles/sqlite";
import type * as SqliteRelations from "../schemas/_dialect-bundles/sqlite.relations";
import type * as MysqlAudit from "../schemas/audit/mysql";
import type * as PostgresAudit from "../schemas/audit/postgres";
import type * as SqliteAudit from "../schemas/audit/sqlite";
import type { buildDynamicFieldGroupsMysql } from "../schemas/dynamic-field-groups/mysql";
import type { buildDynamicFieldGroupsPg } from "../schemas/dynamic-field-groups/postgres";
import type { buildDynamicFieldGroupsSqlite } from "../schemas/dynamic-field-groups/sqlite";
import type * as MysqlJobs from "../schemas/jobs/mysql";
import type * as PostgresJobs from "../schemas/jobs/postgres";
import type * as SqliteJobs from "../schemas/jobs/sqlite";
import type * as MysqlMedia from "../schemas/media/mysql";
import type * as PostgresMedia from "../schemas/media/postgres";
import type * as SqliteMedia from "../schemas/media/sqlite";
import type * as MysqlUsers from "../schemas/users/mysql";
import type * as PostgresUsers from "../schemas/users/postgres";
import type * as SqliteUsers from "../schemas/users/sqlite";

/** The dialects whose tables are loaded here. */
type LoadableDialect = "postgresql" | "mysql" | "sqlite";

/** One dialect's static tables, keyed by their export names. */
export type DialectTables =
  | typeof PostgresTables
  | typeof MysqlTables
  | typeof SqliteTables;

/**
 * A dialect's tables, the relations defined over them, its builders for
 * tables named at run time, and the modules declaring the columns of the core
 * tables a hook may extend.
 */
export type LoadedDialect =
  | {
      dialect: "postgresql";
      tables: typeof PostgresTables;
      relations: typeof PostgresRelations;
      columnModules: {
        audit: typeof PostgresAudit;
        jobs: typeof PostgresJobs;
        media: typeof PostgresMedia;
        users: typeof PostgresUsers;
      };
      builders: { buildDynamicFieldGroups: typeof buildDynamicFieldGroupsPg };
    }
  | {
      dialect: "mysql";
      tables: typeof MysqlTables;
      relations: typeof MysqlRelations;
      columnModules: {
        audit: typeof MysqlAudit;
        jobs: typeof MysqlJobs;
        media: typeof MysqlMedia;
        users: typeof MysqlUsers;
      };
      builders: {
        buildDynamicFieldGroups: typeof buildDynamicFieldGroupsMysql;
      };
    }
  | {
      dialect: "sqlite";
      tables: typeof SqliteTables;
      relations: typeof SqliteRelations;
      columnModules: {
        audit: typeof SqliteAudit;
        jobs: typeof SqliteJobs;
        media: typeof SqliteMedia;
        users: typeof SqliteUsers;
      };
      builders: {
        buildDynamicFieldGroups: typeof buildDynamicFieldGroupsSqlite;
      };
    };

/**
 * The dialects loaded so far. On `globalThis`, so that every copy of this
 * module in one process reads the same answer: a bundler can load the module
 * more than once (a server and a rendering layer, a reload in development),
 * and a copy whose own map was empty would refuse tables another copy had
 * loaded when its adapter was created.
 */
const store = globalThis as unknown as {
  __nextly_dialectTables?: Map<LoadableDialect, LoadedDialect>;
};
const loaded = (store.__nextly_dialectTables ??= new Map());
const loading = new Map<LoadableDialect, Promise<LoadedDialect>>();

/**
 * A dialect's spelling as callers pass it, or undefined for one this module
 * does not load. `postgres` is accepted beside `postgresql`, as
 * `getStaticRelations` always has.
 */
function loadable(dialect: string | undefined): LoadableDialect | undefined {
  if (dialect === "postgresql" || dialect === "postgres") return "postgresql";
  if (dialect === "mysql" || dialect === "sqlite") return dialect;
  return undefined;
}

/**
 * Loads one dialect's tables and relations. Each branch imports by a literal
 * path, so a bundler can split them, and only the dialect asked for is ever
 * imported. Loading a dialect twice reuses the first load.
 */
async function importDialect(dialect: LoadableDialect): Promise<LoadedDialect> {
  switch (dialect) {
    case "postgresql": {
      const [tables, relations, fieldGroups, audit, jobs, media, users] =
        await Promise.all([
          import("../schemas/_dialect-bundles/postgres"),
          import("../schemas/_dialect-bundles/postgres.relations"),
          import("../schemas/dynamic-field-groups/postgres"),
          import("../schemas/audit/postgres"),
          import("../schemas/jobs/postgres"),
          import("../schemas/media/postgres"),
          import("../schemas/users/postgres"),
        ]);
      const builders = {
        buildDynamicFieldGroups: fieldGroups.buildDynamicFieldGroupsPg,
      };
      const columnModules = { audit, jobs, media, users };
      return { dialect, tables, relations, builders, columnModules };
    }
    case "mysql": {
      const [tables, relations, fieldGroups, audit, jobs, media, users] =
        await Promise.all([
          import("../schemas/_dialect-bundles/mysql"),
          import("../schemas/_dialect-bundles/mysql.relations"),
          import("../schemas/dynamic-field-groups/mysql"),
          import("../schemas/audit/mysql"),
          import("../schemas/jobs/mysql"),
          import("../schemas/media/mysql"),
          import("../schemas/users/mysql"),
        ]);
      const builders = {
        buildDynamicFieldGroups: fieldGroups.buildDynamicFieldGroupsMysql,
      };
      const columnModules = { audit, jobs, media, users };
      return { dialect, tables, relations, builders, columnModules };
    }
    case "sqlite": {
      const [tables, relations, fieldGroups, audit, jobs, media, users] =
        await Promise.all([
          import("../schemas/_dialect-bundles/sqlite"),
          import("../schemas/_dialect-bundles/sqlite.relations"),
          import("../schemas/dynamic-field-groups/sqlite"),
          import("../schemas/audit/sqlite"),
          import("../schemas/jobs/sqlite"),
          import("../schemas/media/sqlite"),
          import("../schemas/users/sqlite"),
        ]);
      const builders = {
        buildDynamicFieldGroups: fieldGroups.buildDynamicFieldGroupsSqlite,
      };
      const columnModules = { audit, jobs, media, users };
      return { dialect, tables, relations, builders, columnModules };
    }
  }
}

/**
 * Loads `dialect`'s tables and relations, once. Awaited where an adapter is
 * created, and by a test that reads tables without creating one.
 */
export async function loadDialectTables(dialect: string): Promise<void> {
  const known = loadable(dialect);
  if (!known) {
    throw NextlyError.internal({
      logContext: {
        reason:
          `loadDialectTables: unsupported dialect "${String(dialect)}" ` +
          `(expected postgresql | mysql | sqlite)`,
      },
    });
  }
  if (loaded.has(known)) return;
  let pending = loading.get(known);
  if (!pending) {
    pending = importDialect(known);
    loading.set(known, pending);
  }
  try {
    loaded.set(known, await pending);
  } finally {
    loading.delete(known);
  }
}

/**
 * The loaded tables and relations of `dialect`. A dialect not loaded yet
 * fails here, naming the cause and the fix, rather than as a missing table
 * far from it: the tables are loaded when createAdapter or registerServices
 * meets the adapter, so an adapter built directly from an adapter package
 * (handed to `new ServiceContainer`, say) needs its dialect loaded first.
 */
export function loadedDialect(dialect: string | undefined): LoadedDialect {
  const known = loadable(dialect);
  if (!known) {
    throw NextlyError.internal({
      logContext: {
        reason:
          `unsupported dialect "${String(dialect)}" ` +
          `(expected postgresql | mysql | sqlite)`,
      },
    });
  }
  const found = loaded.get(known);
  if (found) return found;
  throw NextlyError.internal({
    logContext: {
      reason:
        `the ${known} tables were read before that dialect was loaded. ` +
        `createAdapter and registerServices load them; for an adapter built ` +
        `directly from an adapter package, or a read with no adapter, ` +
        `await loadDialectTables("${known}") first`,
    },
  });
}

/** The prebuilt static relations of a loaded dialect. */
export function loadedRelations(dialect: string | undefined): AnyRelations {
  return loadedDialect(dialect).relations.relations;
}

/**
 * The loaded dialect whose tables include `table`, for code handed a table
 * rather than a dialect. Undefined when no loaded dialect holds it: a table
 * of a dialect this process never loaded is not one it could have been handed
 * by its own adapter.
 */
export function loadedDialectHolding(
  table: unknown
): LoadedDialect | undefined {
  for (const found of loaded.values()) {
    if (Object.values(found.tables).includes(table)) return found;
  }
  return undefined;
}
