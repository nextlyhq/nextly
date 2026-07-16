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

import * as mysqlBundle from "../schemas/_dialect-bundles/mysql";
import {
  buildMysqlEdges,
  relations as mysqlRelations,
} from "../schemas/_dialect-bundles/mysql.relations";
import * as postgresBundle from "../schemas/_dialect-bundles/postgres";
import {
  buildPostgresEdges,
  relations as postgresRelations,
} from "../schemas/_dialect-bundles/postgres.relations";
import * as sqliteBundle from "../schemas/_dialect-bundles/sqlite";
import {
  buildSqliteEdges,
  relations as sqliteRelations,
} from "../schemas/_dialect-bundles/sqlite.relations";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * A relation edge contributed by a dynamic entity at registration time.
 * `fromColumn`/`toColumn` are the builder property names (camelCase);
 * `targetTable` is the key the target is registered under (a static
 * bundle export name like "users", or another dynamic SQL table name).
 */
export interface DynamicRelationEdge {
  key: string;
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
  [tableKey: string]: Record<string, unknown> | DynamicEdgeBuilder["one"];
}

export class SchemaRegistry {
  private dialect: SupportedDialect;
  // Keyed by SQL table name (e.g., "dynamic_collections", not "dynamicCollections")
  private staticSchemas: Record<string, unknown> = {};
  private dynamicSchemas: Map<string, unknown> = new Map();
  private dynamicEdges: Map<string, DynamicRelationEdge[]> = new Map();
  // Cached defineRelations output; null = needs rebuild.
  private relationsCache: AnyRelations | null = null;

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

    const { bundle, prebuilt, buildEdges } = this.dialectRelationsSource();

    if (this.dynamicEdges.size === 0) {
      this.relationsCache = prebuilt;
      return prebuilt;
    }

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
    this.relationsCache = defineRelationsDynamic(merged, helper => {
      const staticEdges = buildEdges(helper);
      const r = helper as DynamicEdgeBuilder;
      const dynamicConfig: Record<string, Record<string, unknown>> = {};
      for (const [tableKey, edges] of edgesByTable) {
        const tableEdges: Record<string, unknown> = {};
        for (const edge of edges) {
          const fromCols = r[tableKey];
          const toCols = r[edge.targetTable];
          const oneFn = r.one[edge.targetTable];
          if (!fromCols || !toCols || typeof oneFn !== "function") continue;
          tableEdges[edge.key] = oneFn({
            from: fromCols[edge.fromColumn],
            to: toCols[edge.toColumn ?? "id"],
          });
        }
        if (Object.keys(tableEdges).length > 0) {
          dynamicConfig[tableKey] = tableEdges;
        }
      }
      return { ...staticEdges, ...dynamicConfig };
    });
    return this.relationsCache;
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
    switch (this.dialect) {
      case "postgresql":
        return {
          bundle: postgresBundle,
          prebuilt: postgresRelations,
          buildEdges: helper =>
            buildPostgresEdges(
              helper as Parameters<typeof buildPostgresEdges>[0]
            ),
        };
      case "mysql":
        return {
          bundle: mysqlBundle,
          prebuilt: mysqlRelations,
          buildEdges: helper =>
            buildMysqlEdges(helper as Parameters<typeof buildMysqlEdges>[0]),
        };
      case "sqlite":
        return {
          bundle: sqliteBundle,
          prebuilt: sqliteRelations,
          buildEdges: helper =>
            buildSqliteEdges(helper as Parameters<typeof buildSqliteEdges>[0]),
        };
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
