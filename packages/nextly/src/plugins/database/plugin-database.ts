/**
 * `ctx.db` — typed, portable, owner-checked access to a plugin's own tables.
 *
 * Three properties, each earned:
 *
 * **Typed** without codegen, from the DSL's phantom types. A plugin reads a
 * row and gets the shape it declared, so a renamed column is a compile error
 * rather than an undefined at runtime.
 *
 * **Portable by construction.** The surface is narrowed to what behaves the
 * same on all three dialects. A first attempt typed these tables as Postgres,
 * which made `.returning()` and `onConflictDoNothing` type-check and then fail
 * on MySQL — a shape that compiles and cannot run is worse than one that does
 * not compile. `insertReturning` is the portable replacement for RETURNING.
 *
 * **Owner-checked in every method**, which is what makes it a boundary rather
 * than a convention. See `access.ts` for why the check is not hoisted.
 *
 * @module plugins/database/plugin-database
 * @since 1.0.0
 */
import type { AnyColumn, SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";

import type { SupportedDialect } from "../../database/schema-registry";
import type {
  InferInsert,
  InferRow,
  TableDefinition,
} from "../../domains/schema/extension/dsl";
import type { SchemaOwner } from "../../domains/schema/extension/types";
import { NextlyError } from "../../errors/nextly-error";
import { uuidV7 } from "../../utils/uuid-v7";

import {
  assertTableAccess,
  canAccessTable,
  type TableAccessRules,
} from "./access";

/** What a caller may narrow a read or a write with. */
export interface PortableWhere<TResult> {
  where(condition: SQL): Promise<TResult>;
}

export interface PortableSelect<TDefinition> {
  where(condition: SQL): PortableSelect<TDefinition>;
  orderBy(...columns: SQL[]): PortableSelect<TDefinition>;
  limit(count: number): PortableSelect<TDefinition>;
  offset(count: number): PortableSelect<TDefinition>;
  all(): Promise<InferRow<TDefinition>[]>;
  first(): Promise<InferRow<TDefinition> | null>;
}

export interface PluginDatabaseDeps {
  dialect: SupportedDialect;
  owner: SchemaOwner;
  dependsOn: ReadonlySet<string>;
  /** Table name → owner, from the compiled schema. Read per call, not captured. */
  owners: () => ReadonlyMap<string, SchemaOwner>;
  /** SQL name → Drizzle table, from the compiled schema. */
  tables: () => Record<string, unknown>;
  /** The compiled tables, for resolving an authored name to its SQL one. */
  tableList: () => readonly {
    name: string;
    authored: string;
    owner: SchemaOwner;
  }[];
  /** The Drizzle handle. */
  db: () => unknown;
  /**
   * The relations-enabled Drizzle handle (`db.query` lives here). The plain
   * `db` above is constructed without a relations config, whose query
   * namespace is empty — this one is built per call with the registry's
   * current relations, exactly as core services build theirs.
   */
  relationalDb: () => unknown;
  /** The adapter's transaction, which serialises correctly on SQLite. */
  transaction: <R>(fn: (tx: unknown) => Promise<R>) => Promise<R>;
}

/**
 * The SQL name a definition refers to, for this caller.
 *
 * Read from the compiled schema's recorded AUTHORED name rather than by
 * splitting the SQL name on the prefix separator. The split was a proxy for
 * the naming rules, and would have disagreed with them for any table whose
 * authored name contained the separator.
 *
 * Ambiguity — two reachable tables sharing an authored name — resolves to the
 * caller's OWN table. A plugin naming a table `notes` means its own `notes`,
 * whatever a dependency also calls its table.
 */
function sqlNameOf(
  definition: TableDefinition,
  deps: PluginDatabaseDeps
): string {
  const candidates = deps
    .tableList()
    .filter(table => table.authored === definition.name);

  const own = candidates.find(table => isSameOwner(table.owner, deps.owner));
  if (own) return own.name;

  // Not the caller's own. Return the single remaining candidate so the access
  // check can decide; returning the authored name instead would produce a
  // "not declared" message for a table that exists.
  return candidates[0]?.name ?? definition.name;
}

function isSameOwner(a: SchemaOwner, b: SchemaOwner): boolean {
  if (a.kind === "plugin" && b.kind === "plugin") return a.id === b.id;
  return a.kind === "app" && b.kind === "app";
}

function rulesOf(deps: PluginDatabaseDeps): TableAccessRules {
  return {
    owner: deps.owner,
    dependsOn: deps.dependsOn,
    owners: deps.owners(),
  };
}

/**
 * The Drizzle table for a definition, after the access check.
 *
 * Both halves matter and neither is optional: resolving without checking hands
 * a plugin somebody else's table, and checking without resolving checks a name
 * that is not the one the query will use.
 */
function resolveTable(
  definition: TableDefinition,
  deps: PluginDatabaseDeps
): { name: string; table: unknown } {
  const name = sqlNameOf(definition, deps);
  assertTableAccess(name, rulesOf(deps));

  const table = deps.tables()[name];
  if (table === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "declared table has no compiled handle",
        table: name,
      },
    });
  }
  return { name, table };
}

/**
 * Fill the columns the DSL says are maintained for the caller.
 *
 * A `uuidv7` id is generated when absent, and `created_at`/`updated_at` take
 * the current moment. Done here rather than as a database default because a
 * generated id has to be KNOWN to the caller — `insertReturning` on MySQL has
 * no RETURNING to read it back with, and selecting "the last row" is a race.
 */
function withGeneratedColumns(
  definition: TableDefinition,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...values };
  for (const column of definition.columns) {
    if (column.generated === "uuidv7" && out[column.key] === undefined) {
      out[column.key] = uuidV7();
    }
    if (
      typeof column.default === "object" &&
      column.default?.token === "now" &&
      out[column.key] === undefined
    ) {
      out[column.key] = new Date();
    }
  }
  return out;
}

/** The columns the DSL marks as refreshed on every update. */
function withUpdatedColumns(
  definition: TableDefinition,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...values };
  for (const column of definition.columns) {
    if (column.onUpdate === "now") {
      out[column.key] = new Date();
    }
  }
  return out;
}

/** Map an authored row onto the SQL column names the table uses. */
function toColumns(
  definition: TableDefinition,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of definition.columns) {
    if (values[column.key] !== undefined) {
      out[column.name] = values[column.key];
    }
  }
  return out;
}

/**
 * The Drizzle columns of a declared table, keyed as the author wrote them.
 *
 * `table()` returned `unknown`, which made the one thing it exists for —
 * naming a column in a `where` predicate — impossible without a cast. Every
 * other entry point on this surface is typed from the definition; this one
 * promised access to a column and handed back a value nothing could be read
 * from.
 *
 * `AnyColumn` rather than the precise per-column type: what a predicate needs
 * is something `eq`, `gt` and friends accept, and the phantom column map
 * carries builders rather than built columns.
 */
export type TableColumns<T> =
  T extends TableDefinition<string, infer TColumns>
    ? Record<keyof TColumns & string, AnyColumn>
    : Record<string, AnyColumn>;

export interface PluginDatabase {
  table<T extends TableDefinition>(definition: T): TableColumns<T>;
  select<T extends TableDefinition>(definition: T): PortableSelect<T>;
  insert<T extends TableDefinition>(
    definition: T,
    values: InferInsert<T> | InferInsert<T>[]
  ): Promise<void>;
  insertReturning<T extends TableDefinition>(
    definition: T,
    values: InferInsert<T>
  ): Promise<InferRow<T>>;
  update<T extends TableDefinition>(
    definition: T,
    set: Partial<InferInsert<T>>
  ): PortableWhere<number>;
  delete<T extends TableDefinition>(definition: T): PortableWhere<number>;
  transaction<R>(fn: (tx: PluginTransaction) => Promise<R>): Promise<R>;
  /**
   * Relational queries (`db.query.<table>.findMany({ with })`), keyed by
   * FINAL table name and owner-checked like every other method. The
   * relations config is resolved per access through the same path core
   * services use, so a registry invalidation (a Builder save, an extension
   * reload) propagates immediately rather than stranding a plugin on edges
   * that close over dropped table objects.
   */
  readonly query: RelationalQueries;
}

/** One table's relational-query entry point. */
export interface RelationalQuery {
  findMany: (config?: unknown) => Promise<unknown[]>;
  findFirst: (config?: unknown) => Promise<unknown>;
}

/** The relational-query namespace, keyed by final table name. */
export type RelationalQueries = Record<string, RelationalQuery>;

export type PluginTransaction = Omit<PluginDatabase, "transaction">;

/**
 * The relational-query namespace, behind the same check as every other method.
 *
 * Drizzle's namespace is schema-WIDE: it names core tables and every other
 * plugin's tables alongside the caller's own. Handing it back unwrapped was a
 * read path around the boundary the rest of this surface enforces —
 * `ctx.db.select(users)` refuses, and `ctx.db.query.users.findMany()`
 * answered. The check is the same `assertTableAccess`, so the two can only
 * disagree by someone changing the rule in one place, which there no longer
 * is one of.
 *
 * A Proxy rather than a filtered copy, for the reason the getter is not
 * cached: the namespace is rebuilt whenever the registry invalidates its
 * relations, and a copy taken here would name the tables of a schema that has
 * since been replaced.
 *
 * `has` and `ownKeys` answer for the same rule, so enumerating the namespace
 * does not advertise a table a call would refuse — except where a property is
 * non-configurable, which a Proxy may not hide. Drizzle builds these as plain
 * assignments, so that branch is a guard against a future shape, not a hole
 * in the current one.
 */
function ownedQueries(
  namespace: RelationalQueries,
  deps: PluginDatabaseDeps
): RelationalQueries {
  const hideable = (target: RelationalQueries, key: string): boolean => {
    if (!Object.hasOwn(target, key)) return false;
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return descriptor?.configurable !== false;
  };

  return new Proxy(namespace, {
    get(target, property, receiver) {
      if (typeof property === "string" && Object.hasOwn(target, property)) {
        assertTableAccess(property, rulesOf(deps));
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (typeof property === "string" && hideable(target, property)) {
        return canAccessTable(property, rulesOf(deps));
      }
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      const rules = rulesOf(deps);
      return Reflect.ownKeys(target).filter(
        key =>
          typeof key !== "string" ||
          !hideable(target, key) ||
          canAccessTable(key, rules)
      );
    },
  });
}

/** Build the database surface one owner sees. */
export function createPluginDatabase(deps: PluginDatabaseDeps): PluginDatabase {
  type AnyDb = {
    select: (...args: unknown[]) => never;
    insert: (table: unknown) => {
      values: (rows: unknown) => Promise<unknown>;
    };
    update: (table: unknown) => {
      set: (values: unknown) => { where: (c: SQL) => Promise<unknown> };
    };
    delete: (table: unknown) => { where: (c: SQL) => Promise<unknown> };
  };

  const surface: PluginDatabase = {
    table(definition) {
      // `resolveTable` carries the Drizzle object as `unknown` — it is built
      // by the compiler from the neutral model, which has no Drizzle types to
      // thread through. The cast is where that erasure is paid back, once,
      // rather than at every call site that wants to name a column.
      return resolveTable(definition, deps).table as TableColumns<
        typeof definition
      >;
    },

    select(definition) {
      const { table } = resolveTable(definition, deps);
      const state: {
        where?: SQL;
        orderBy: SQL[];
        limit?: number;
        offset?: number;
      } = { orderBy: [] };

      const build = (): PortableSelect<typeof definition> => ({
        where(condition) {
          state.where = condition;
          return build();
        },
        orderBy(...columns) {
          state.orderBy = columns;
          return build();
        },
        limit(count) {
          state.limit = count;
          return build();
        },
        offset(count) {
          state.offset = count;
          return build();
        },
        async all() {
          const db = deps.db() as {
            select: () => {
              from: (t: unknown) => Record<string, (...a: never[]) => unknown>;
            };
          };
          let query = db.select().from(table);
          if (state.where) {
            query = query.where(state.where as never) as typeof query;
          }
          if (state.orderBy.length > 0) {
            query = query.orderBy(
              ...(state.orderBy as never[])
            ) as typeof query;
          }
          if (state.limit !== undefined) {
            query = query.limit(state.limit as never) as typeof query;
          }
          if (state.offset !== undefined) {
            query = query.offset(state.offset as never) as typeof query;
          }
          return (await (query as unknown as Promise<unknown>)) as never;
        },
        async first() {
          const rows = await build().limit(1).all();
          return rows[0] ?? null;
        },
      });
      return build();
    },

    async insert(definition, values) {
      const { table } = resolveTable(definition, deps);
      const rows = (Array.isArray(values) ? values : [values]).map(row =>
        toColumns(
          definition,
          withGeneratedColumns(definition, row as Record<string, unknown>)
        )
      );
      await (deps.db() as AnyDb).insert(table).values(rows);
    },

    async insertReturning(definition, values) {
      const { table } = resolveTable(definition, deps);
      const filled = withGeneratedColumns(definition, values);
      await (deps.db() as AnyDb)
        .insert(table)
        .values(toColumns(definition, filled));

      // Read back by the id just generated, rather than with RETURNING.
      // MySQL has no RETURNING, and "the last inserted row" is a race under
      // any concurrency — so the portable path is the only path, on every
      // dialect, which also keeps the three behaving identically.
      const idColumn = definition.columns.find(c => c.primaryKey);
      if (!idColumn) {
        throw NextlyError.internal({
          logContext: {
            reason: "insertReturning needs a primary key",
            table: definition.name,
          },
        });
      }
      const handle = table as Record<string, unknown>;
      const row = await surface
        .select(definition)
        .where(
          eq(handle[idColumn.name] as never, filled[idColumn.key] as never)
        )
        .first();
      if (row === null) {
        throw NextlyError.internal({
          logContext: {
            reason: "inserted row could not be read back",
            table: definition.name,
          },
        });
      }
      return row;
    },

    update(definition, set) {
      const { table } = resolveTable(definition, deps);
      return {
        async where(condition) {
          const values = toColumns(
            definition,
            withUpdatedColumns(definition, set)
          );
          const result = await (deps.db() as AnyDb)
            .update(table)
            .set(values)
            .where(condition);
          return affectedRows(result);
        },
      };
    },

    delete(definition) {
      const { table } = resolveTable(definition, deps);
      return {
        async where(condition) {
          const result = await (deps.db() as AnyDb)
            .delete(table)
            .where(condition);
          return affectedRows(result);
        },
      };
    },

    async transaction(fn) {
      return deps.transaction(async tx => {
        // The same surface, reading the transaction's handle. Built rather
        // than mutated so a caller holding the outer `ctx.db` cannot
        // accidentally write outside the transaction.
        const scoped = createPluginDatabase({ ...deps, db: () => tx });
        return fn(scoped);
      });
    },

    // Resolved per access, never cached: the registry invalidates its
    // assembled relations when a table is re-registered, and that only
    // propagates if consumers re-resolve — the same rule core services
    // follow through BaseService.db.
    get query() {
      const db = deps.relationalDb() as { query: RelationalQueries };
      return ownedQueries(db.query, deps);
    },
  };

  return surface;
}

/**
 * How many rows a write touched, across three drivers that disagree.
 *
 * Postgres returns `rowCount`, MySQL `affectedRows`, and better-sqlite3
 * `changes`. Returning 0 for an unrecognised shape would report "nothing
 * matched" for a write that succeeded, so an unknown shape is -1: a value a
 * caller can test for rather than one that lies.
 */
function affectedRows(result: unknown): number {
  if (typeof result === "object" && result !== null) {
    const shape = result as {
      rowCount?: unknown;
      affectedRows?: unknown;
      changes?: unknown;
    };
    for (const value of [shape.rowCount, shape.affectedRows, shape.changes]) {
      if (typeof value === "number") return value;
    }
  }
  return -1;
}
