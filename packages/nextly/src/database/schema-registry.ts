// Manages all Drizzle table objects (static system tables + dynamic collections).
// On boot: loads definitions from DB, generates Drizzle objects, stores them.
// All code that needs a Drizzle table object for a query gets it from here.
//
// IMPORTANT: Tables are stored by their SQL table name (snake_case),
// NOT by their JS export name (camelCase). This is because the adapter's
// CRUD methods call getTable("dynamic_collections") using the SQL name.

import { getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { PgTable } from "drizzle-orm/pg-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

export class SchemaRegistry {
  private dialect: SupportedDialect;
  // Keyed by SQL table name (e.g., "dynamic_collections", not "dynamicCollections")
  private staticSchemas: Record<string, unknown> = {};
  private dynamicSchemas: Map<string, unknown> = new Map();

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
  registerDynamicSchema(tableName: string, table: unknown): void {
    this.dynamicSchemas.set(tableName, table);
  }

  // Look up a table object by SQL table name (for queries).
  // Checks dynamic schemas first since they may override static in edge cases.
  getTable(tableName: string): unknown | null {
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

  // Clear dynamic schemas (before reload on restart)
  clear(): void {
    this.dynamicSchemas.clear();
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
