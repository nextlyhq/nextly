// Manages all Drizzle table objects (static system tables + dynamic collections).
// On boot: loads definitions from DB, generates Drizzle objects, stores them.
// All code that needs a Drizzle table object for a query gets it from here.
//
// IMPORTANT: Tables are stored by their SQL table name (snake_case),
// NOT by their JS export name (camelCase). This is because the adapter's
// CRUD methods call getTable("dynamic_collections") using the SQL name.
//
// Relations (drizzle v2): the registry is also the single assembly point
// for the schema-wide `defineRelations` config that powers `db.query`.
// Static edges come from the dialect bundle's exported edge builder;
// dynamic entities can contribute edges at registration time. The
// assembled object is cached and MUST be invalidated whenever a table
// object is (re)registered — relations close over table objects, so a
// rename that rebuilds a table would otherwise leave RQB serving the
// pre-change table (the "500s until restart" bug class, May 2026).

import { defineRelations, getTableName, is } from "drizzle-orm";
import type { AnyRelations } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { PgTable } from "drizzle-orm/pg-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

import { NextlyError } from "../errors/nextly-error";

import { loadedDialect } from "./dialect-tables";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * A relation edge contributed by a dynamic entity at registration time.
 * `fromColumn`/`toColumn` are the builder property names (camelCase);
 * `targetTable` is the key the target is registered under (a static
 * bundle export name like "users", or another dynamic SQL table name).
 *
 * `kind` decides the edge's cardinality, and with it which end holds the
 * reference. A `one` edge (the default, which is what every edge a
 * collection contributes is) joins this table's `fromColumn` to the
 * target's `toColumn`, `id` when omitted. A `many` edge joins this table's
 * `fromColumn` to the target rows whose `toColumn` holds it, so `toColumn`
 * is required: the target's `id` is never the column pointing back.
 */
export interface DynamicRelationEdge {
  key: string;
  kind?: "one" | "many";
  fromColumn: string;
  targetTable: string;
  toColumn?: string;
}

// Minimal structural view of the relations builder used for composing
// dynamic edges over runtime-registered tables. The full RelationsBuilder
// generic is keyed by the static schema type, which cannot know runtime
// table names — this narrow shape captures exactly the two capabilities
// dynamic-edge assembly uses.
interface DynamicEdgeBuilder {
  one: Record<
    string,
    (config?: { from?: unknown; to?: unknown; alias?: string }) => unknown
  >;
  many: DynamicEdgeBuilder["one"];
  [tableKey: string]: Record<string, unknown> | DynamicEdgeBuilder["one"];
}

/** A dynamic edge the registry cannot resolve: its table, its key, and why. */
export interface UnresolvedRelationEdge {
  table: string;
  edge: string;
  /** Completes "the relation <edge> on <table> …". */
  problem: string;
}

/**
 * One dynamic edge as drizzle's relation, or why it cannot be built.
 *
 * Every end is looked up in the namespace the relations are assembled over,
 * so a table that is not registered, or a column its table does not have, is
 * found here rather than built into a relation that joins on nothing.
 */
function buildDynamicEdge(
  r: DynamicEdgeBuilder,
  tableKey: string,
  edge: DynamicRelationEdge
): { relation: unknown } | { problem: string } {
  const fromCols = r[tableKey];
  const toCols = r[edge.targetTable];
  const many = edge.kind === "many";
  const edgeFn = (many ? r.many : r.one)[edge.targetTable];
  if (!fromCols || !toCols || typeof edgeFn !== "function") {
    return {
      problem: `targets the table "${!fromCols ? tableKey : edge.targetTable}", which is not registered`,
    };
  }
  // Only a one-edge may default its target column to `id`: that is the
  // column a reference points AT. A many-edge's target column is the one
  // pointing back, which has no default, and substituting `id` would join
  // the target's key to this table's key.
  if (many && edge.toColumn === undefined) {
    return {
      problem: `is a many relation that names no column on "${edge.targetTable}" pointing back`,
    };
  }
  const toColumn = edge.toColumn ?? "id";
  const fromCol = fromCols[edge.fromColumn];
  if (fromCol === undefined) {
    return {
      problem: `joins from the column "${edge.fromColumn}", which "${tableKey}" does not have`,
    };
  }
  const toCol = toCols[toColumn];
  if (toCol === undefined) {
    return {
      problem: `joins to the column "${toColumn}", which "${edge.targetTable}" does not have`,
    };
  }
  return { relation: edgeFn({ from: fromCol, to: toCol }) };
}

/**
 * The boot's refusal of the edges `assertRelationsResolve` could not resolve.
 *
 * In the family of the other schema-configuration refusals: a generic public
 * message, and each edge named in `logMessage`, which a printed error shows
 * whole.
 */
function unresolvedRelationsError(
  unresolved: readonly UnresolvedRelationEdge[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_RELATION_UNRESOLVED",
    publicMessage: "Schema configuration is invalid.",
    logMessage: unresolved
      .map(
        edge =>
          `The relation "${edge.edge}" on "${edge.table}" ${edge.problem}.`
      )
      .join("\n"),
    logContext: {
      reason: "relation-unresolved",
      relations: unresolved.map(edge => `${edge.table}.${edge.edge}`),
    },
  });
}

/**
 * The dialect bundle the registry composes relations over: static tables
 * keyed by their EXPORT names, which is how a relation edge names a core
 * target. Exported so a compiler checking an edge against a core table reads
 * the same namespace this registry will resolve the edge in, rather than a
 * second list of core tables that could disagree with it.
 */
export function staticRelationTables(
  dialect: SupportedDialect
): Record<string, unknown> {
  // The bundle loaded for this dialect when its adapter was created.
  return loadedDialect(dialect).tables;
}

export class SchemaRegistry {
  private dialect: SupportedDialect;
  // Keyed by SQL table name (e.g., "dynamic_collections", not "dynamicCollections")
  private staticSchemas: Record<string, unknown> = {};
  private dynamicSchemas: Map<string, unknown> = new Map();
  private dynamicEdges: Map<string, DynamicRelationEdge[]> = new Map();
  // Cached defineRelations output; null = needs rebuild.
  private relationsCache: AnyRelations | null = null;
  // The edges an assembly left out, keyed by that assembly: a registration
  // that replaces the cache drops them with it, so nothing has to remember
  // to clear them beside it.
  private unresolvedIn = new WeakMap<object, UnresolvedRelationEdge[]>();

  constructor(dialect: SupportedDialect) {
    this.dialect = dialect;
  }

  getDialect(): SupportedDialect {
    return this.dialect;
  }

  // Register system tables from the dialect schema exports.
  // Converts from JS export names (camelCase) to SQL table names (snake_case)
  // so that getTable("dynamic_collections") works correctly.
  registerStaticSchemas(schemas: Record<string, unknown>): void {
    this.staticSchemas = {};
    this.relationsCache = null;

    for (const [key, value] of Object.entries(schemas)) {
      // Check if this is a Drizzle table object (pgTable, mysqlTable, sqliteTable)
      if (this.isDrizzleTable(value)) {
        // Use the actual SQL table name as the key
        try {
          const sqlName = getTableName(value as never);
          this.staticSchemas[sqlName] = value;
        } catch {
          // If getTableName fails, fall back to the export key
          this.staticSchemas[key] = value;
        }
      } else {
        // Non-table exports (relations, etc.) - store by export key
        this.staticSchemas[key] = value;
      }
    }
  }

  // Register a single dynamic collection's table object.
  // Called per collection when loading from dynamic_collections table.
  // tableName should be the SQL table name (e.g., "dc_products").
  // Optional `edges` contribute relations for the table into the
  // registry-assembled defineRelations config (see getRelations()).
  registerDynamicSchema(
    tableName: string,
    table: unknown,
    edges?: DynamicRelationEdge[]
  ): void {
    this.dynamicSchemas.set(tableName, table);
    if (edges && edges.length > 0) {
      this.dynamicEdges.set(tableName, edges);
    } else {
      this.dynamicEdges.delete(tableName);
    }
    // Relations close over table objects — a re-registered (rebuilt)
    // table must invalidate the assembled config or RQB reads keep
    // traversing the pre-change object.
    this.relationsCache = null;
  }

  /**
   * Forget one dynamic table, so the next lookup rebuilds it instead of adopting it.
   *
   * The counterpart `registerDynamicSchema` was missing. A caller that has changed a table's
   * storage and then FAILED part way cannot say what shape the table now has — the change may have
   * landed on one half and not the other — and there was previously no way to express that. Every
   * such caller had to bind SOME shape, because `ensureSingleRuntimeTable` adopts a registration it
   * did not make rather than rebuilding, so a wrong guess survived to the next restart.
   *
   * Retracting says the one thing such a caller always knows correctly: this is no longer
   * describable from here. The rebuild that follows asks the database where the columns physically
   * are, which is the answer a guess was standing in for.
   */
  retractDynamicSchema(tableName: string): void {
    this.dynamicSchemas.delete(tableName);
    this.dynamicEdges.delete(tableName);
    // Same reason the registration path invalidates it: relations close over table objects, so a
    // stale assembled config keeps traversing an object no longer registered.
    this.relationsCache = null;
  }

  // Look up a table object by SQL table name (for queries).
  // Checks dynamic schemas first since they may override static in edge cases.
  getTable(tableName: string): unknown {
    if (this.dynamicSchemas.has(tableName)) {
      return this.dynamicSchemas.get(tableName)!;
    }
    if (tableName in this.staticSchemas) {
      return this.staticSchemas[tableName];
    }
    return null;
  }

  // Get all schemas merged (for pushSchema() and drizzle() init).
  // Dynamic schemas override static schemas with the same key.
  getAllSchemas(): Record<string, unknown> {
    const dynamicObj: Record<string, unknown> = {};
    for (const [key, value] of this.dynamicSchemas) {
      dynamicObj[key] = value;
    }
    return { ...this.staticSchemas, ...dynamicObj };
  }

  // Get only dynamic table names (for cleanup, debugging)
  getDynamicTableNames(): string[] {
    return Array.from(this.dynamicSchemas.keys());
  }

  /**
   * The schema-wide drizzle v2 relations config for `drizzle({ relations })`
   * / `db.query`. Fast path: with no dynamic edges registered, returns the
   * dialect bundle's prebuilt static relations. Otherwise composes the
   * static edge builder with the registered dynamic edges over the merged
   * (static-by-export-name + dynamic-by-sql-name) table namespace in one
   * defineRelations call. Cached until any registration invalidates it.
   */
  getRelations(): AnyRelations {
    if (this.relationsCache) return this.relationsCache;
    // Fail FAST on malformed registration metadata: the assembled relations
    // are cached, so a silently-skipped edge (or an edge built from an
    // undefined column, which drizzle would treat as a bare inference hint
    // joining on the wrong column) surfaces far away at query time. Boot asks
    // the same question before anything queries (`assertRelationsResolve`).
    this.relationsCache = this.assembleRelations(edge => {
      throw NextlyError.internal({
        logContext: {
          reason: `SchemaRegistry: dynamic relation edge "${edge.edge}" on "${edge.table}" ${edge.problem}`,
        },
      });
    });
    return this.relationsCache;
  }

  /**
   * Assemble the relations now, and refuse every edge that cannot be
   * resolved, naming each.
   *
   * For boot, once every table is registered. The assembly otherwise first
   * runs on the first `db.query`, so a relation naming a table or column that
   * does not exist surfaced there — as an internal error, taking every
   * relational query down with it, far from the declaration. Asked by the same
   * assembly `getRelations` runs, so the boot and the query path cannot
   * disagree about an edge; the result is kept, and the first query reuses it.
   *
   * Kept even when some edges cannot be resolved, with those left out. Where
   * the boot refuses, nothing is served from it; where development reports
   * the edges and carries on, it is what keeps every other relational query
   * working, rather than each one failing on the edge already named. The
   * edges left out are remembered against that assembly, so asking again
   * refuses again until a registration replaces it.
   */
  assertRelationsResolve(): void {
    if (this.relationsCache === null) {
      const unresolved: UnresolvedRelationEdge[] = [];
      this.relationsCache = this.assembleRelations(edge => {
        unresolved.push(edge);
      });
      this.unresolvedIn.set(this.relationsCache, unresolved);
    }
    const unresolved = this.unresolvedIn.get(this.relationsCache) ?? [];
    if (unresolved.length > 0) throw unresolvedRelationsError(unresolved);
  }

  /**
   * The relations config, handing each dynamic edge it cannot resolve to
   * `onUnresolved` and leaving that edge out.
   */
  private assembleRelations(
    onUnresolved: (edge: UnresolvedRelationEdge) => void
  ): AnyRelations {
    const { bundle, prebuilt, buildEdges } = this.dialectRelationsSource();

    // Only with no dynamic TABLES at all. Keying this on edges returned the
    // static config whenever no dynamic table declared a relation, and
    // `defineRelations` builds the `db.query` namespace from the tables it is
    // handed, not from the edges — so every runtime-registered table without
    // an edge (a plugin's table, a collection) was simply absent from
    // `db.query`, and `ctx.db.query.<table>` was undefined.
    if (this.dynamicSchemas.size === 0) return prebuilt;

    const dynamicTables: Record<string, unknown> = {};
    for (const [key, value] of this.dynamicSchemas) {
      dynamicTables[key] = value;
    }
    // Static tables keep their EXPORT names here (defineRelations keys the
    // db.query namespace off object keys; the static edge builder
    // references those names). Dynamic tables use their SQL names.
    const merged = { ...bundle, ...dynamicTables };

    // defineRelations' generics key the config off the schema TYPE — a
    // namespace merged from runtime-registered tables has no static type,
    // so the generic contract cannot be expressed. This structural bridge
    // fixes the runtime-facing signature; correctness rests on the
    // superset argument above and is pinned by the registry unit tests.
    const defineRelationsDynamic = defineRelations as unknown as (
      schema: Record<string, unknown>,
      cb: (helper: unknown) => Record<string, unknown>
    ) => AnyRelations;

    const edgesByTable = this.dynamicEdges;
    return defineRelationsDynamic(merged, helper => {
      const staticEdges = buildEdges(helper);
      const r = helper as DynamicEdgeBuilder;
      const dynamicConfig: Record<string, Record<string, unknown>> = {};
      for (const [tableKey, edges] of edgesByTable) {
        const tableEdges: Record<string, unknown> = {};
        for (const edge of edges) {
          const built = buildDynamicEdge(r, tableKey, edge);
          if ("problem" in built) {
            onUnresolved({
              table: tableKey,
              edge: edge.key,
              problem: built.problem,
            });
            continue;
          }
          tableEdges[edge.key] = built.relation;
        }
        if (Object.keys(tableEdges).length > 0) {
          dynamicConfig[tableKey] = tableEdges;
        }
      }
      return { ...staticEdges, ...dynamicConfig };
    });
  }

  private dialectRelationsSource(): {
    bundle: Record<string, unknown>;
    prebuilt: AnyRelations;
    // Normalized signature: the merged runtime namespace is a strict
    // superset of the dialect bundle, so every key/column the static
    // builder touches exists — TS cannot relate the runtime-merged
    // generic to the bundle-specific builder param, hence the localized
    // per-dialect cast inside each arm.
    buildEdges: (helper: unknown) => Record<string, unknown>;
  } {
    // The dialect's tables and relations, loaded when its adapter was created.
    const loaded = loadedDialect(this.dialect);
    switch (loaded.dialect) {
      case "postgresql": {
        const { buildPostgresEdges, relations } = loaded.relations;
        return {
          bundle: loaded.tables,
          prebuilt: relations,
          buildEdges: helper =>
            buildPostgresEdges(
              helper as Parameters<typeof buildPostgresEdges>[0]
            ),
        };
      }
      case "mysql": {
        const { buildMysqlEdges, relations } = loaded.relations;
        return {
          bundle: loaded.tables,
          prebuilt: relations,
          buildEdges: helper =>
            buildMysqlEdges(helper as Parameters<typeof buildMysqlEdges>[0]),
        };
      }
      case "sqlite": {
        const { buildSqliteEdges, relations } = loaded.relations;
        return {
          bundle: loaded.tables,
          prebuilt: relations,
          buildEdges: helper =>
            buildSqliteEdges(helper as Parameters<typeof buildSqliteEdges>[0]),
        };
      }
    }
  }

  // Clear dynamic schemas (before reload on restart)
  clear(): void {
    this.dynamicSchemas.clear();
    this.dynamicEdges.clear();
    this.relationsCache = null;
  }

  // Check if a table exists in the registry
  hasTable(tableName: string): boolean {
    return (
      this.dynamicSchemas.has(tableName) || tableName in this.staticSchemas
    );
  }

  // Check if a value is a Drizzle table object
  private isDrizzleTable(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    try {
      return (
        is(value as never, PgTable) ||
        is(value as never, MySqlTable) ||
        is(value as never, SQLiteTable)
      );
    } catch {
      // If drizzle-orm's `is` function isn't available, check for common table properties
      const obj = value as Record<string, unknown>;
      return (
        "_" in obj &&
        typeof (obj._ as Record<string, unknown>)?.name === "string"
      );
    }
  }
}
