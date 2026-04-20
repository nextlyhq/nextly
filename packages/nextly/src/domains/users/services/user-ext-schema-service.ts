/**
 * UserExtSchemaService
 *
 * Generates database schemas for the `user_ext` table that stores custom user fields.
 * Handles SQL migration generation, Drizzle TypeScript schema code generation,
 * runtime Drizzle table object creation, and schema hashing for change detection.
 *
 * The `user_ext` table extends the built-in `users` table with custom fields defined
 * via `defineConfig({ users: { fields: [...] } })` or the admin UI.
 *
 * Base columns:
 * - `id`: text PK
 * - `user_id`: text FK → users.id (unique, NOT NULL, cascade delete)
 * - `created_at`, `updated_at`: timestamps
 *
 * Supports PostgreSQL, MySQL, and SQLite dialects.
 *
 * @module services/users/user-ext-schema-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const schemaService = new UserExtSchemaService('postgresql');
 *
 * // Generate SQL migration for the user_ext table
 * const sql = schemaService.generateMigrationSQL(userConfig.fields);
 *
 * // Generate Drizzle TypeScript schema code
 * const code = schemaService.generateSchemaCode(userConfig.fields);
 *
 * // Generate runtime Drizzle table object for querying
 * const table = schemaService.generateRuntimeSchema(userConfig.fields);
 *
 * // Compute schema hash for change detection
 * const hash = schemaService.computeSchemaHash(userConfig.fields);
 * ```
 */

import type { Table, Column } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  mysqlTable,
  text as mysqlText,
  boolean as mysqlBoolean,
  timestamp as mysqlTimestamp,
  json as mysqlJson,
  varchar as mysqlVarchar,
  double as mysqlDouble,
  uniqueIndex as mysqlUniqueIndex,
} from "drizzle-orm/mysql-core";
import {
  pgTable,
  text as pgText,
  boolean as pgBoolean,
  timestamp as pgTimestamp,
  jsonb as pgJsonb,
  doublePrecision as pgDoublePrecision,
  uniqueIndex as pgUniqueIndex,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  isTextField,
  isTextareaField,
  isEmailField,
  isNumberField,
  isCheckboxField,
  isDateField,
  isSelectField,
  isRadioField,
  isDataField,
} from "../../../collections/fields/guards";
import type {
  DataFieldConfig,
  FieldConfig,
} from "../../../collections/fields/types";
import { env } from "../../../lib/env";
import type { UserFieldDefinitionRecord } from "../../../schemas/user-field-definitions/types";
import type { UserFieldConfig } from "../../../users/config/types";
import { calculateSchemaHash } from "../../schema/services/schema-hash";

import type { UserFieldDefinitionService } from "./user-field-definition-service";

// ============================================================
// Constants
// ============================================================

const TABLE_NAME = "user_ext";

// ============================================================
// Drizzle Runtime Types
// ============================================================

/**
 * Runtime-generated Drizzle table — columns are dynamic so we cannot
 * express the full shape statically. Property access (e.g., `table.user_id`)
 * uses the `Record<string, unknown>` intersection.
 */
type DrizzleRuntimeTable = Table & Record<string, unknown>;

// ============================================================
// Types
// ============================================================

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * SQL column type definitions for each dialect.
 */
const SQL_COLUMN_TYPES: Record<
  SupportedDialect,
  {
    uuid: string;
    text: string;
    varchar: (length: number) => string;
    boolean: string;
    integer: string;
    real: string;
    timestamp: string;
    json: string;
  }
> = {
  postgresql: {
    uuid: "UUID",
    text: "TEXT",
    varchar: (length: number) => `VARCHAR(${length})`,
    boolean: "BOOLEAN",
    integer: "INTEGER",
    real: "REAL",
    timestamp: "TIMESTAMP WITH TIME ZONE",
    json: "JSONB",
  },
  mysql: {
    uuid: "VARCHAR(36)",
    text: "TEXT",
    varchar: (length: number) => `VARCHAR(${length})`,
    boolean: "BOOLEAN",
    integer: "INT",
    real: "DOUBLE",
    timestamp: "DATETIME",
    json: "JSON",
  },
  sqlite: {
    uuid: "TEXT",
    text: "TEXT",
    varchar: () => "TEXT",
    boolean: "INTEGER",
    integer: "INTEGER",
    real: "REAL",
    timestamp: "INTEGER",
    json: "TEXT",
  },
};

/**
 * Identifier quote characters for each dialect.
 */
const QUOTE_CHAR: Record<SupportedDialect, string> = {
  postgresql: '"',
  mysql: "`",
  sqlite: '"',
};

/**
 * Timestamp default value by dialect.
 */
const TIMESTAMP_DEFAULT: Record<SupportedDialect, string> = {
  postgresql: "DEFAULT NOW()",
  mysql: "DEFAULT CURRENT_TIMESTAMP",
  sqlite: "DEFAULT (strftime('%s', 'now'))",
};

// ============================================================
// UserExtSchemaService
// ============================================================

export class UserExtSchemaService {
  private readonly dialect: SupportedDialect;
  private readonly q: string;
  private readonly fieldDefService?: UserFieldDefinitionService;

  /** Cached merged fields from both code and UI sources */
  private mergedFields: UserFieldConfig[] | null = null;

  constructor(
    dialect?: SupportedDialect,
    fieldDefService?: UserFieldDefinitionService
  ) {
    this.dialect =
      dialect || (env.DB_DIALECT as SupportedDialect) || "postgresql";
    this.q = QUOTE_CHAR[this.dialect];
    this.fieldDefService = fieldDefService;
  }

  // ============================================================
  // Merged Fields (Code + UI)
  // ============================================================

  /**
   * Load merged fields from both code (`defineConfig()`) and UI
   * (`user_field_definitions` table) sources.
   *
   * Must be called after `syncCodeFields()` so the database reflects
   * the latest code-defined fields. The result is cached internally
   * and exposed via `getMergedFieldConfigs()`.
   *
   * If no `UserFieldDefinitionService` was provided, this is a no-op.
   */
  async loadMergedFields(): Promise<void> {
    if (!this.fieldDefService) return;

    const records = await this.fieldDefService.getMergedFields();
    this.mergedFields = records.map(r => this.convertRecordToFieldConfig(r));
  }

  /**
   * Reload merged fields from the database, clearing any stale cache.
   *
   * Called after field CRUD operations (create, update, delete) to
   * ensure the in-memory merged fields reflect the latest DB state.
   */
  async reloadMergedFields(): Promise<void> {
    this.mergedFields = null;
    await this.loadMergedFields();
  }

  /**
   * Ensure the `user_ext` table exists and has columns for all
   * current merged fields.
   *
   * Executes CREATE TABLE IF NOT EXISTS followed by ALTER TABLE
   * ADD COLUMN for each field. Safe to call multiple times (idempotent).
   *
   * @param db - Drizzle database instance for executing raw SQL
   */
  async ensureUserExtSchema(db: unknown): Promise<void> {
    // db is a Drizzle database instance — type varies by dialect
    const drizzleDb = db as { execute(query: unknown): Promise<unknown> };
    const fields = this.getMergedFieldConfigs();
    if (fields.length === 0) return;

    // 1. CREATE TABLE IF NOT EXISTS (with all columns)
    const createSQL = this.generateMigrationSQL(fields);
    const createStatements = createSQL.split("\n--> statement-breakpoint\n");
    for (const stmt of createStatements) {
      // Strip leading SQL comment lines (e.g. "-- Create user extension table")
      // so the actual DDL statement is executed
      const executable = stmt
        .split("\n")
        .filter(line => {
          const t = line.trim();
          return t && !t.startsWith("--");
        })
        .join("\n")
        .trim();
      if (!executable) continue;

      try {
        await drizzleDb.execute(sql.raw(executable));
      } catch {
        // Table/index/constraint may already exist — safe to ignore
      }
    }

    // 2. ALTER TABLE ADD COLUMN for each field (handles case where
    //    table exists but is missing columns for newly created fields)
    for (const field of fields) {
      if (!("name" in field) || !field.name) continue;

      const columnName = this.toSnakeCase(field.name);
      const columnType = this.getColumnType(field as DataFieldConfig);
      if (!columnType) continue;

      let alterSQL: string;
      if (this.dialect === "postgresql") {
        alterSQL = `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ADD COLUMN IF NOT EXISTS ${this.q}${columnName}${this.q} ${columnType}`;
      } else {
        // MySQL and SQLite don't support IF NOT EXISTS for ADD COLUMN
        alterSQL = `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ADD COLUMN ${this.q}${columnName}${this.q} ${columnType}`;
      }

      try {
        await drizzleDb.execute(sql.raw(alterSQL));
      } catch {
        // Column already exists — safe to ignore
      }
    }
  }

  /**
   * Get the cached merged field configs.
   *
   * Returns field configs from both code and UI sources (loaded via
   * `loadMergedFields()`). Returns an empty array if not yet loaded
   * or if no fields exist.
   */
  getMergedFieldConfigs(): UserFieldConfig[] {
    return this.mergedFields ?? [];
  }

  /**
   * Check whether merged fields have been loaded and contain at least one field.
   */
  hasMergedFields(): boolean {
    return this.mergedFields !== null && this.mergedFields.length > 0;
  }

  /**
   * Convert a `UserFieldDefinitionRecord` (DB row) to a `UserFieldConfig`
   * compatible with the field type system.
   *
   * Maps DB record properties to the discriminated union shape expected
   * by schema generation, runtime table creation, and field type guards.
   */
  private convertRecordToFieldConfig(
    record: UserFieldDefinitionRecord
  ): UserFieldConfig {
    const base: Record<string, unknown> = {
      name: record.name,
      label: record.label,
      required: record.required,
    };

    // Map admin options (placeholder → admin.placeholder, description → admin.description)
    const adminOpts: Record<string, unknown> = {};
    if (record.placeholder) adminOpts.placeholder = record.placeholder;
    if (record.description) adminOpts.description = record.description;
    if (Object.keys(adminOpts).length > 0) base.admin = adminOpts;

    switch (record.type) {
      case "text":
        return {
          ...base,
          type: "text",
          defaultValue: record.defaultValue ?? undefined,
        } as UserFieldConfig;
      case "textarea":
        return {
          ...base,
          type: "textarea",
          defaultValue: record.defaultValue ?? undefined,
        } as UserFieldConfig;
      case "email":
        return {
          ...base,
          type: "email",
          defaultValue: record.defaultValue ?? undefined,
        } as UserFieldConfig;
      case "number":
        return {
          ...base,
          type: "number",
          defaultValue: record.defaultValue
            ? Number(record.defaultValue)
            : undefined,
        } as UserFieldConfig;
      case "checkbox":
        return {
          ...base,
          type: "checkbox",
          defaultValue:
            record.defaultValue === "true" || record.defaultValue === "1",
        } as unknown as UserFieldConfig;
      case "date":
        return { ...base, type: "date" } as UserFieldConfig;
      case "select":
        return {
          ...base,
          type: "select",
          options: record.options || [],
          defaultValue: record.defaultValue ?? undefined,
        } as UserFieldConfig;
      case "radio":
        return {
          ...base,
          type: "radio",
          options: record.options || [],
          defaultValue: record.defaultValue ?? undefined,
        } as UserFieldConfig;
      default:
        return {
          ...base,
          type: "text",
          defaultValue: record.defaultValue ?? undefined,
        } as UserFieldConfig;
    }
  }

  // ============================================================
  // SQL Migration Generation
  // ============================================================

  /**
   * Generate SQL migration for creating the `user_ext` table.
   *
   * Creates a table with:
   * - Base columns: id, user_id (FK → users.id, unique)
   * - Field columns: generated from UserFieldConfig definitions
   * - Timestamp columns: created_at, updated_at
   * - Unique index on user_id
   *
   * @param fields - User field definitions
   * @returns SQL migration string
   */
  generateMigrationSQL(fields: UserFieldConfig[]): string {
    const types = SQL_COLUMN_TYPES[this.dialect];
    const tsDefault = TIMESTAMP_DEFAULT[this.dialect];

    const lines: string[] = [];
    lines.push(`-- Create user extension table: ${TABLE_NAME}`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${this.q}${TABLE_NAME}${this.q} (`);

    // Primary key
    if (this.dialect === "mysql") {
      lines.push(`  ${this.q}id${this.q} varchar(36) PRIMARY KEY NOT NULL,`);
    } else {
      lines.push(`  ${this.q}id${this.q} text PRIMARY KEY NOT NULL,`);
    }

    // user_id FK (unique, NOT NULL, cascade delete)
    if (this.dialect === "mysql") {
      lines.push(`  ${this.q}user_id${this.q} varchar(36) NOT NULL,`);
    } else {
      lines.push(`  ${this.q}user_id${this.q} text NOT NULL,`);
    }

    // Field columns
    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;

      const columnSQL = this.generateColumnSQL(field);
      if (columnSQL) {
        lines.push(`  ${columnSQL},`);
      }
    }

    // Timestamp columns
    lines.push(
      `  ${this.q}created_at${this.q} ${types.timestamp} NOT NULL ${tsDefault},`
    );
    lines.push(
      `  ${this.q}updated_at${this.q} ${types.timestamp} NOT NULL ${tsDefault}`
    );

    lines.push(");");

    let sql = lines.join("\n");

    // Indexes
    const indexStatements: string[] = [];

    // Unique index on user_id
    const userIdIndexName = `uq_${TABLE_NAME}_user_id`;
    if (this.dialect === "mysql") {
      indexStatements.push(
        `CREATE UNIQUE INDEX ${this.q}${userIdIndexName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}user_id${this.q});`
      );
    } else {
      indexStatements.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${this.q}${userIdIndexName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}user_id${this.q});`
      );
    }

    // Foreign key constraint (PostgreSQL and MySQL only — SQLite has limited ALTER TABLE)
    if (this.dialect === "postgresql") {
      indexStatements.push(
        `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ADD CONSTRAINT ${this.q}fk_${TABLE_NAME}_user_id${this.q} FOREIGN KEY (${this.q}user_id${this.q}) REFERENCES ${this.q}users${this.q}(${this.q}id${this.q}) ON DELETE CASCADE;`
      );
    } else if (this.dialect === "mysql") {
      indexStatements.push(
        `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ADD CONSTRAINT ${this.q}fk_${TABLE_NAME}_user_id${this.q} FOREIGN KEY (${this.q}user_id${this.q}) REFERENCES ${this.q}users${this.q}(${this.q}id${this.q}) ON DELETE CASCADE;`
      );
    }

    // Field-level unique indexes
    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;
      if (!("name" in field) || !field.name) continue;
      if (!("unique" in field && field.unique)) continue;

      const columnName = this.toSnakeCase(field.name);
      const indexName = `uq_${TABLE_NAME}_${columnName}`;

      if (this.dialect === "mysql") {
        indexStatements.push(
          `CREATE UNIQUE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}${columnName}${this.q});`
        );
      } else {
        indexStatements.push(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${this.q}${indexName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}${columnName}${this.q});`
        );
      }
    }

    // Field-level regular indexes
    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;
      if (!("name" in field) || !field.name) continue;
      if (!("index" in field && field.index)) continue;
      // Skip if already indexed as unique
      if ("unique" in field && field.unique) continue;

      const columnName = this.toSnakeCase(field.name);
      const indexName = `idx_${TABLE_NAME}_${columnName}`;

      if (this.dialect === "mysql") {
        indexStatements.push(
          `CREATE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}${columnName}${this.q});`
        );
      } else {
        indexStatements.push(
          `CREATE INDEX IF NOT EXISTS ${this.q}${indexName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}${columnName}${this.q});`
        );
      }
    }

    // Append indexes with statement breakpoints
    if (indexStatements.length > 0) {
      sql += "\n--> statement-breakpoint\n";
      sql += indexStatements.join("\n--> statement-breakpoint\n");
    }

    return sql;
  }

  /**
   * Generate ALTER TABLE migration for updating the `user_ext` table.
   *
   * Detects added, removed, and modified fields and generates
   * dialect-specific ALTER TABLE statements.
   *
   * @param oldFields - Previous field definitions
   * @param newFields - New field definitions
   * @returns SQL migration string
   */
  generateAlterTableMigration(
    oldFields: UserFieldConfig[],
    newFields: UserFieldConfig[]
  ): string {
    const statements: string[] = [
      `-- Update user extension table: ${TABLE_NAME}`,
    ];

    const oldFieldMap = this.buildFieldMap(oldFields);
    const newFieldMap = this.buildFieldMap(newFields);

    // Find added fields
    for (const [name, field] of newFieldMap) {
      if (oldFieldMap.has(name)) continue;

      const columnType = this.getColumnType(field);
      if (!columnType) continue;

      const columnName = this.toSnakeCase(name);
      const nullable = "required" in field && field.required ? "NOT NULL" : "";

      let defaultVal = "";
      if ("defaultValue" in field && field.defaultValue !== undefined) {
        // User fields are restricted to scalar types — defaultValue is string | number | boolean
        defaultVal = `DEFAULT ${this.formatDefaultValue(field.defaultValue as string | number | boolean, field.type)}`;
      } else if ("required" in field && field.required) {
        defaultVal = `DEFAULT ${this.getDefaultValueForType(field.type)}`;
      }

      statements.push(
        `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ADD COLUMN ${this.q}${columnName}${this.q} ${columnType} ${nullable} ${defaultVal};`.trim()
      );

      // Add unique constraint if specified
      if ("unique" in field && field.unique) {
        if (this.dialect === "sqlite") {
          statements.push(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${this.q}uq_${TABLE_NAME}_${columnName}${this.q} ON ${this.q}${TABLE_NAME}${this.q}(${this.q}${columnName}${this.q});`
          );
        } else {
          statements.push(
            `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ADD CONSTRAINT ${this.q}uq_${TABLE_NAME}_${columnName}${this.q} UNIQUE (${this.q}${columnName}${this.q});`
          );
        }
      }
    }

    // Find removed fields
    for (const [name] of oldFieldMap) {
      if (newFieldMap.has(name)) continue;

      const columnName = this.toSnakeCase(name);
      if (this.dialect === "sqlite") {
        statements.push(
          `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} DROP COLUMN ${this.q}${columnName}${this.q};`
        );
      } else {
        statements.push(
          `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} DROP COLUMN IF EXISTS ${this.q}${columnName}${this.q};`
        );
      }
    }

    // Find modified fields (skip for SQLite — doesn't support ALTER COLUMN)
    if (this.dialect !== "sqlite") {
      for (const [name, newField] of newFieldMap) {
        const oldField = oldFieldMap.get(name);
        if (!oldField) continue;
        if (!this.isFieldModified(oldField, newField)) continue;

        const columnName = this.toSnakeCase(name);
        const newType = this.getColumnType(newField);
        if (!newType) continue;

        statements.push(
          `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ALTER COLUMN ${this.q}${columnName}${this.q} TYPE ${newType};`
        );

        const oldRequired = "required" in oldField && oldField.required;
        const newRequired = "required" in newField && newField.required;

        if (oldRequired !== newRequired) {
          if (newRequired) {
            statements.push(
              `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ALTER COLUMN ${this.q}${columnName}${this.q} SET NOT NULL;`
            );
          } else {
            statements.push(
              `ALTER TABLE ${this.q}${TABLE_NAME}${this.q} ALTER COLUMN ${this.q}${columnName}${this.q} DROP NOT NULL;`
            );
          }
        }
      }
    }

    return statements.join("\n--> statement-breakpoint\n");
  }

  /**
   * Generate DROP TABLE migration for the `user_ext` table.
   *
   * @returns Object with SQL string and migration file name
   */
  generateDropTableMigration(): {
    migrationSQL: string;
    migrationFileName: string;
  } {
    const dropStatement =
      this.dialect === "sqlite"
        ? `DROP TABLE IF EXISTS ${this.q}${TABLE_NAME}${this.q};`
        : `DROP TABLE IF EXISTS ${this.q}${TABLE_NAME}${this.q} CASCADE;`;

    const migrationSQL = `-- Drop user extension table: ${TABLE_NAME}\n${dropStatement}`;

    return {
      migrationSQL,
      migrationFileName: `${Date.now()}_drop_${TABLE_NAME}.sql`,
    };
  }

  // ============================================================
  // Runtime Drizzle Table Generation
  // ============================================================

  /**
   * Generate a Drizzle table object at runtime for querying user_ext data.
   *
   * Used for UI-created custom user fields that don't have pre-compiled schemas.
   * The returned table object can be passed to Drizzle queries.
   *
   * @param fields - User field definitions
   * @returns A Drizzle table object
   *
   * @example
   * ```typescript
   * const table = schemaService.generateRuntimeSchema(userConfig.fields);
   * const rows = await db.select().from(table).where(eq(table.user_id, userId));
   * ```
   */
  generateRuntimeSchema(fields: UserFieldConfig[]): DrizzleRuntimeTable {
    switch (this.dialect) {
      case "postgresql":
        return this.generatePostgresSchema(fields);
      case "mysql":
        return this.generateMySQLSchema(fields);
      case "sqlite":
        return this.generateSQLiteSchema(fields);
      default:
        throw new Error(`Unsupported dialect: ${this.dialect}`);
    }
  }

  private generatePostgresSchema(
    fields: UserFieldConfig[]
  ): DrizzleRuntimeTable {
    const columns: Record<string, unknown> = {
      id: pgText("id").primaryKey(),
      user_id: pgText("user_id").notNull(),
      created_at: pgTimestamp("created_at").defaultNow().notNull(),
      updated_at: pgTimestamp("updated_at").defaultNow().notNull(),
    };

    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToPostgresColumn(field);
      if (column) {
        columns[field.name] = column;
      }
    }

    // Drizzle ORM requires dialect-specific column builders for columns — not publicly
    // exported, so a cast through `never` is unavoidable for runtime-generated column maps.

    return pgTable(
      TABLE_NAME,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires dialect-specific column type
      columns as any,
      (table: Record<string, Column>) => ({
        userIdIdx: pgUniqueIndex(`uq_${TABLE_NAME}_user_id`).on(
          table.user_id as never
        ),
      })
    ) as unknown as DrizzleRuntimeTable;
  }

  private generateMySQLSchema(fields: UserFieldConfig[]): DrizzleRuntimeTable {
    const columns: Record<string, unknown> = {
      id: mysqlVarchar("id", { length: 36 }).primaryKey(),
      user_id: mysqlVarchar("user_id", { length: 36 }).notNull(),
      created_at: mysqlTimestamp("created_at").defaultNow().notNull(),
      updated_at: mysqlTimestamp("updated_at").defaultNow().notNull(),
    };

    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToMySQLColumn(field);
      if (column) {
        columns[field.name] = column;
      }
    }

    // Drizzle ORM requires dialect-specific column builders for columns — not publicly
    // exported, so a cast through `never` is unavoidable for runtime-generated column maps.

    return mysqlTable(
      TABLE_NAME,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires dialect-specific column type
      columns as any,
      (table: Record<string, Column>) => ({
        userIdIdx: mysqlUniqueIndex(`uq_${TABLE_NAME}_user_id`).on(
          table.user_id as never
        ),
      })
    ) as unknown as DrizzleRuntimeTable;
  }

  private generateSQLiteSchema(fields: UserFieldConfig[]): DrizzleRuntimeTable {
    const columns: Record<string, unknown> = {
      id: sqliteText("id").primaryKey(),
      user_id: sqliteText("user_id").notNull(),
      created_at: sqliteInteger("created_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date()),
      updated_at: sqliteInteger("updated_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date()),
    };

    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToSQLiteColumn(field);
      if (column) {
        columns[field.name] = column;
      }
    }

    // Drizzle ORM requires dialect-specific column builders for columns — not publicly
    // exported, so a cast through `never` is unavoidable for runtime-generated column maps.

    return sqliteTable(
      TABLE_NAME,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires dialect-specific column type
      columns as any,
      (table: Record<string, Column>) => ({
        userIdIdx: sqliteUniqueIndex(`uq_${TABLE_NAME}_user_id`).on(
          table.user_id as never
        ),
      })
    ) as unknown as DrizzleRuntimeTable;
  }

  // ============================================================
  // Drizzle TypeScript Code Generation
  // ============================================================

  /**
   * Generate TypeScript/Drizzle schema code for the `user_ext` table.
   *
   * Produces a complete TypeScript file with imports, table definition,
   * indexes, and inferred types.
   *
   * @param fields - User field definitions
   * @returns TypeScript source code string
   */
  generateSchemaCode(fields: UserFieldConfig[]): string {
    const dialectConfig = this.getDialectConfig();

    // Determine required imports
    const baseImports = this.collectRequiredImports(fields);

    const imports = `import { ${dialectConfig.tableFunction}, ${baseImports.join(", ")} } from '${dialectConfig.importPath}';`;

    // Generate field columns
    // UserFieldConfig is already a subset of DataFieldConfig, no type predicate needed
    const fieldColumns = fields
      .filter(f => isDataField(f as FieldConfig) && "name" in f && !!f.name)
      .map(f => {
        const drizzleType = this.mapFieldToDrizzleCode(f);
        const modifiers: string[] = [];

        if ("required" in f && f.required) modifiers.push(".notNull()");
        if ("unique" in f && f.unique) modifiers.push(".unique()");

        const defaultValue = "defaultValue" in f ? f.defaultValue : undefined;
        if (defaultValue !== undefined && defaultValue !== null) {
          if (typeof defaultValue === "string") {
            modifiers.push(`.default('${defaultValue}')`);
          } else {
            modifiers.push(`.default(${defaultValue})`);
          }
        }

        return `  ${f.name}: ${drizzleType}${modifiers.join("")},`;
      })
      .join("\n");

    // Generate timestamp columns
    const timestampColumns = this.generateTimestampColumnsCode();

    // Generate base columns code
    const baseColumnsCode = this.generateBaseColumnsCode();

    // Generate unique index on user_id
    const indexCode = `  userIdIdx: uniqueIndex('uq_${TABLE_NAME}_user_id').on(table.user_id),`;

    // Field-level indexes (non-unique indexed fields only)
    const fieldIndexes = fields
      .filter(
        f =>
          isDataField(f as FieldConfig) &&
          "name" in f &&
          !!f.name &&
          "index" in f &&
          f.index &&
          !("unique" in f && f.unique)
      )
      .map(
        f =>
          `  ${f.name}Idx: index('idx_${TABLE_NAME}_${this.toSnakeCase(f.name)}').on(table.${f.name}),`
      )
      .join("\n");

    const allIndexes = fieldIndexes
      ? `${indexCode}\n${fieldIndexes}`
      : indexCode;

    return `${imports}

/**
 * User extension table: ${TABLE_NAME}
 * Stores custom user fields defined via defineConfig() or admin UI.
 * Generated by nextly
 */
export const ${TABLE_NAME} = ${dialectConfig.tableFunction}('${TABLE_NAME}', {
${baseColumnsCode}
${fieldColumns}
${timestampColumns}
}, (table) => ({
${allIndexes}
}));

export type UserExt = typeof ${TABLE_NAME}.$inferSelect;
export type NewUserExt = typeof ${TABLE_NAME}.$inferInsert;
`;
  }

  // ============================================================
  // Schema Hashing
  // ============================================================

  /**
   * Compute a deterministic hash for the given user fields.
   *
   * Reuses the existing schema hash utility that normalizes fields,
   * sorts keys, and produces a SHA-256 hash. Used for change detection
   * to determine when migrations are needed.
   *
   * @param fields - User field definitions
   * @returns 64-character hex string (SHA-256 hash)
   */
  computeSchemaHash(fields: UserFieldConfig[]): string {
    return calculateSchemaHash(fields as FieldConfig[]);
  }

  // ============================================================
  // Field Column Mapping (SQL)
  // ============================================================

  private generateColumnSQL(field: UserFieldConfig): string | null {
    if (!("name" in field) || !field.name) return null;

    const columnName = this.toSnakeCase(field.name);
    const columnType = this.getColumnType(field);
    if (!columnType) return null;

    const parts = [`${this.q}${columnName}${this.q}`, columnType];

    if ("required" in field && field.required) {
      parts.push("NOT NULL");
    }

    if (
      isCheckboxField(field as FieldConfig) &&
      field.defaultValue !== undefined
    ) {
      const defaultVal =
        this.dialect === "sqlite"
          ? field.defaultValue
            ? 1
            : 0
          : field.defaultValue;
      parts.push(`DEFAULT ${defaultVal}`);
    }

    return parts.join(" ");
  }

  private getColumnType(field: DataFieldConfig): string | null {
    const types = SQL_COLUMN_TYPES[this.dialect];

    if (isTextField(field)) {
      return field.maxLength ? types.varchar(field.maxLength) : types.text;
    }
    if (isTextareaField(field)) {
      return types.text;
    }
    if (isEmailField(field)) {
      return types.varchar(255);
    }
    if (isNumberField(field)) {
      return types.real;
    }
    if (isCheckboxField(field)) {
      return types.boolean;
    }
    if (isDateField(field)) {
      return types.timestamp;
    }
    if (isSelectField(field)) {
      return field.hasMany ? types.json : types.varchar(255);
    }
    if (isRadioField(field)) {
      return types.varchar(255);
    }

    return null;
  }

  // ============================================================
  // Field Column Mapping (Runtime Drizzle)
  // ============================================================

  private mapFieldToPostgresColumn(field: UserFieldConfig): unknown {
    if (!("name" in field) || !field.name) return null;
    const isRequired = "required" in field && field.required === true;
    const colName = this.toSnakeCase(field.name);

    if (isTextField(field) || isEmailField(field)) {
      return isRequired ? pgText(colName).notNull() : pgText(colName);
    }
    if (isTextareaField(field)) {
      return isRequired ? pgText(colName).notNull() : pgText(colName);
    }
    if (isNumberField(field)) {
      return isRequired
        ? pgDoublePrecision(colName).notNull()
        : pgDoublePrecision(colName);
    }
    if (isCheckboxField(field)) {
      return isRequired ? pgBoolean(colName).notNull() : pgBoolean(colName);
    }
    if (isDateField(field)) {
      return isRequired ? pgTimestamp(colName).notNull() : pgTimestamp(colName);
    }
    if (isSelectField(field)) {
      if (field.hasMany) {
        return isRequired ? pgJsonb(colName).notNull() : pgJsonb(colName);
      }
      return isRequired ? pgText(colName).notNull() : pgText(colName);
    }
    if (isRadioField(field)) {
      return isRequired ? pgText(colName).notNull() : pgText(colName);
    }

    return pgText(colName);
  }

  private mapFieldToMySQLColumn(field: UserFieldConfig): unknown {
    if (!("name" in field) || !field.name) return null;
    const isRequired = "required" in field && field.required === true;
    const colName = this.toSnakeCase(field.name);

    if (isTextField(field) || isEmailField(field)) {
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });
    }
    if (isTextareaField(field)) {
      return isRequired ? mysqlText(colName).notNull() : mysqlText(colName);
    }
    if (isNumberField(field)) {
      return isRequired ? mysqlDouble(colName).notNull() : mysqlDouble(colName);
    }
    if (isCheckboxField(field)) {
      return isRequired
        ? mysqlBoolean(colName).notNull()
        : mysqlBoolean(colName);
    }
    if (isDateField(field)) {
      return isRequired
        ? mysqlTimestamp(colName).notNull()
        : mysqlTimestamp(colName);
    }
    if (isSelectField(field)) {
      if (field.hasMany) {
        return isRequired ? mysqlJson(colName).notNull() : mysqlJson(colName);
      }
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });
    }
    if (isRadioField(field)) {
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });
    }

    return mysqlVarchar(colName, { length: 255 });
  }

  private mapFieldToSQLiteColumn(field: UserFieldConfig): unknown {
    if (!("name" in field) || !field.name) return null;
    const isRequired = "required" in field && field.required === true;
    const colName = this.toSnakeCase(field.name);

    if (
      isTextField(field) ||
      isEmailField(field) ||
      isTextareaField(field) ||
      isSelectField(field) ||
      isRadioField(field)
    ) {
      return isRequired ? sqliteText(colName).notNull() : sqliteText(colName);
    }
    if (isNumberField(field)) {
      return isRequired ? sqliteReal(colName).notNull() : sqliteReal(colName);
    }
    if (isCheckboxField(field)) {
      return isRequired
        ? sqliteInteger(colName, { mode: "boolean" }).notNull()
        : sqliteInteger(colName, { mode: "boolean" });
    }
    if (isDateField(field)) {
      return isRequired
        ? sqliteInteger(colName, { mode: "timestamp" }).notNull()
        : sqliteInteger(colName, { mode: "timestamp" });
    }

    return sqliteText(colName);
  }

  // ============================================================
  // Field Column Mapping (Drizzle Code Generation)
  // ============================================================

  private mapFieldToDrizzleCode(field: DataFieldConfig): string {
    if (!("name" in field) || !field.name) return "";
    const colName = this.toSnakeCase(field.name);

    if (this.dialect === "sqlite") {
      return this.mapFieldToSQLiteCode(field, colName);
    }
    if (this.dialect === "mysql") {
      return this.mapFieldToMySQLCode(field, colName);
    }
    return this.mapFieldToPostgresCode(field, colName);
  }

  private mapFieldToPostgresCode(
    field: DataFieldConfig,
    colName: string
  ): string {
    if (isTextField(field)) {
      return field.maxLength
        ? `varchar('${colName}', { length: ${field.maxLength} })`
        : `text('${colName}')`;
    }
    if (isTextareaField(field)) {
      return `text('${colName}')`;
    }
    if (isEmailField(field)) {
      return `varchar('${colName}', { length: 255 })`;
    }
    if (isNumberField(field)) {
      return `doublePrecision('${colName}')`;
    }
    if (isCheckboxField(field)) {
      return `boolean('${colName}')`;
    }
    if (isDateField(field)) {
      return `timestamp('${colName}')`;
    }
    if (isSelectField(field)) {
      return field.hasMany ? `jsonb('${colName}')` : `text('${colName}')`;
    }
    if (isRadioField(field)) {
      return `text('${colName}')`;
    }
    return `text('${colName}')`;
  }

  private mapFieldToMySQLCode(field: DataFieldConfig, colName: string): string {
    if (
      isTextField(field) ||
      isEmailField(field) ||
      isSelectField(field) ||
      isRadioField(field)
    ) {
      return `varchar('${colName}', { length: 255 })`;
    }
    if (isTextareaField(field)) {
      return `text('${colName}')`;
    }
    if (isNumberField(field)) {
      return `double('${colName}')`;
    }
    if (isCheckboxField(field)) {
      return `boolean('${colName}')`;
    }
    if (isDateField(field)) {
      return `timestamp('${colName}')`;
    }
    return `varchar('${colName}', { length: 255 })`;
  }

  private mapFieldToSQLiteCode(
    field: DataFieldConfig,
    colName: string
  ): string {
    if (isNumberField(field)) {
      return `real('${colName}')`;
    }
    if (isCheckboxField(field)) {
      return `integer('${colName}', { mode: 'boolean' })`;
    }
    if (isDateField(field)) {
      return `integer('${colName}', { mode: 'timestamp' })`;
    }
    return `text('${colName}')`;
  }

  // ============================================================
  // Code Generation Helpers
  // ============================================================

  private getDialectConfig(): { tableFunction: string; importPath: string } {
    switch (this.dialect) {
      case "mysql":
        return {
          tableFunction: "mysqlTable",
          importPath: "drizzle-orm/mysql-core",
        };
      case "sqlite":
        return {
          tableFunction: "sqliteTable",
          importPath: "drizzle-orm/sqlite-core",
        };
      case "postgresql":
      default:
        return {
          tableFunction: "pgTable",
          importPath: "drizzle-orm/pg-core",
        };
    }
  }

  private collectRequiredImports(fields: UserFieldConfig[]): string[] {
    const imports = new Set<string>(["text", "uniqueIndex"]);

    if (this.dialect === "sqlite") {
      imports.add("integer");
      imports.add("real");
    } else {
      imports.add("varchar");
      imports.add("timestamp");
    }

    // Check if any field needs index() (non-unique indexed fields)
    const hasNonUniqueIndex = fields.some(
      f =>
        isDataField(f as FieldConfig) &&
        "index" in f &&
        f.index &&
        !("unique" in f && f.unique)
    );
    if (hasNonUniqueIndex) {
      imports.add("index");
    }

    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;

      if (this.dialect === "sqlite") {
        if (isNumberField(field)) imports.add("real");
        if (isCheckboxField(field)) imports.add("integer");
        if (isDateField(field)) imports.add("integer");
      } else if (this.dialect === "mysql") {
        if (
          isTextField(field) ||
          isEmailField(field) ||
          isSelectField(field) ||
          isRadioField(field)
        ) {
          imports.add("varchar");
        }
        if (isNumberField(field)) imports.add("double");
        if (isCheckboxField(field)) imports.add("boolean");
        if (isDateField(field)) imports.add("timestamp");
        if (isSelectField(field) && field.hasMany) imports.add("json");
      } else {
        // PostgreSQL
        if (isTextField(field) && field.maxLength) imports.add("varchar");
        if (isEmailField(field)) imports.add("varchar");
        if (isNumberField(field)) imports.add("doublePrecision");
        if (isCheckboxField(field)) imports.add("boolean");
        if (isDateField(field)) imports.add("timestamp");
        if (isSelectField(field) && field.hasMany) imports.add("jsonb");
      }
    }

    return Array.from(imports);
  }

  private generateBaseColumnsCode(): string {
    if (this.dialect === "sqlite") {
      return `  // Base columns
  id: text('id').primaryKey().notNull(),
  user_id: text('user_id').notNull(),`;
    }

    if (this.dialect === "mysql") {
      return `  // Base columns
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  user_id: varchar('user_id', { length: 36 }).notNull(),`;
    }

    // PostgreSQL
    return `  // Base columns
  id: text('id').primaryKey().notNull(),
  user_id: text('user_id').notNull(),`;
  }

  private generateTimestampColumnsCode(): string {
    if (this.dialect === "sqlite") {
      return `  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),`;
    }

    return `  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),`;
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  private isFieldModified(
    oldField: DataFieldConfig,
    newField: DataFieldConfig
  ): boolean {
    if (oldField.type !== newField.type) return true;

    const oldRequired = "required" in oldField && oldField.required;
    const newRequired = "required" in newField && newField.required;
    if (oldRequired !== newRequired) return true;

    const oldUnique = "unique" in oldField && oldField.unique;
    const newUnique = "unique" in newField && newField.unique;
    if (oldUnique !== newUnique) return true;

    if (isTextField(oldField) && isTextField(newField)) {
      if (oldField.maxLength !== newField.maxLength) return true;
    }

    if (isSelectField(oldField) && isSelectField(newField)) {
      if (oldField.hasMany !== newField.hasMany) return true;
    }

    return false;
  }

  private buildFieldMap(
    fields: UserFieldConfig[]
  ): Map<string, DataFieldConfig> {
    const map = new Map<string, DataFieldConfig>();
    for (const field of fields) {
      if (!isDataField(field as FieldConfig)) continue;
      if (!("name" in field) || !field.name) continue;
      map.set(field.name, field);
    }
    return map;
  }

  private getDefaultValueForType(type: string): string {
    switch (type) {
      case "text":
      case "textarea":
      case "email":
      case "select":
      case "radio":
        return "''";
      case "number":
        return "0";
      case "checkbox":
        return this.dialect === "sqlite" ? "0" : "FALSE";
      case "date":
        if (this.dialect === "sqlite") {
          return String(Math.floor(Date.now() / 1000));
        }
        return "NOW()";
      default:
        return "''";
    }
  }

  private formatDefaultValue(
    value: string | number | boolean,
    type: string
  ): string {
    if (
      type === "text" ||
      type === "textarea" ||
      type === "email" ||
      type === "select" ||
      type === "radio"
    ) {
      return `'${value}'`;
    }
    if (type === "checkbox") {
      if (this.dialect === "sqlite") return value ? "1" : "0";
      return value ? "TRUE" : "FALSE";
    }
    if (type === "date") {
      if (this.dialect === "sqlite" && typeof value === "string") {
        return String(Math.floor(new Date(value).getTime() / 1000));
      }
      return `'${value}'`;
    }
    if (type === "number") {
      return String(value);
    }
    return String(value);
  }

  private toSnakeCase(name: string): string {
    return name
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "");
  }
}
