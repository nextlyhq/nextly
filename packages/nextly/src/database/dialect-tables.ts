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

/** The dialects whose tables are loaded here. */
type LoadableDialect = "postgresql" | "mysql" | "sqlite";

/** One dialect's static tables, keyed by their export names. */
export type DialectTables =
  | typeof PostgresTables
  | typeof MysqlTables
  | typeof SqliteTables;

/** A dialect's tables and the relations defined over them. */
export type LoadedDialect =
  | {
      dialect: "postgresql";
      tables: typeof PostgresTables;
      relations: typeof PostgresRelations;
    }
  | {
      dialect: "mysql";
      tables: typeof MysqlTables;
      relations: typeof MysqlRelations;
    }
  | {
      dialect: "sqlite";
      tables: typeof SqliteTables;
      relations: typeof SqliteRelations;
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
      const [tables, relations] = await Promise.all([
        import("../schemas/_dialect-bundles/postgres"),
        import("../schemas/_dialect-bundles/postgres.relations"),
      ]);
      return { dialect, tables, relations };
    }
    case "mysql": {
      const [tables, relations] = await Promise.all([
        import("../schemas/_dialect-bundles/mysql"),
        import("../schemas/_dialect-bundles/mysql.relations"),
      ]);
      return { dialect, tables, relations };
    }
    case "sqlite": {
      const [tables, relations] = await Promise.all([
        import("../schemas/_dialect-bundles/sqlite"),
        import("../schemas/_dialect-bundles/sqlite.relations"),
      ]);
      return { dialect, tables, relations };
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
 * fails here, naming the cause, rather than as a missing table far from it:
 * the tables are loaded when the adapter is created, so a read before that
 * is a read before the database layer exists.
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
        `createAdapter loads them, so read tables after the adapter exists, ` +
        `or await loadDialectTables("${known}") first`,
    },
  });
}

/** The prebuilt static relations of a loaded dialect. */
export function loadedRelations(dialect: string | undefined): AnyRelations {
  return loadedDialect(dialect).relations.relations;
}
