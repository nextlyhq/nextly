/**
 * Migration Generator Service
 *
 * Generates dialect-specific SQL migration files from collection definition changes.
 * Supports PostgreSQL, MySQL, and SQLite dialects with proper CREATE TABLE, ALTER TABLE,
 * DROP TABLE, index, and foreign key operations.
 *
 * @module services/schema/migration-generator
 * @since 1.0.0
 */

import { createHash } from "crypto";

import type { FieldConfig, DataFieldConfig } from "@nextly/collections";

import {
  isTextField,
  isTextareaField,
  isRichTextField,
  isEmailField,
  isPasswordField,
  isCodeField,
  isNumberField,
  isCheckboxField,
  isDateField,
  isSelectField,
  isRadioField,
  isUploadField,
  isRelationshipField,
  isArrayField,
  isGroupField,
  isJSONField,
  isChipsField,
  isDataField,
} from "../../../collections/fields/guards";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";

import type { SupportedDialect } from "./schema-generator";

// ============================================================
// Types
// ============================================================

/**
 * Type of migration operation.
 */
export type MigrationOperationType =
  | "create_table"
  | "drop_table"
  | "add_column"
  | "drop_column"
  | "modify_column"
  | "add_index"
  | "drop_index"
  | "add_foreign_key"
  | "drop_foreign_key";

/**
 * Represents a single schema change detected during diff.
 */
export interface SchemaChange {
  /** Type of change */
  type: MigrationOperationType;

  /** Table affected */
  tableName: string;

  /** Column name (for column operations) */
  columnName?: string;

  /** Field configuration (for add/modify operations) */
  field?: DataFieldConfig;

  /** Previous field configuration (for modify operations) */
  previousField?: DataFieldConfig;

  /** Index name (for index operations) */
  indexName?: string;

  /** Constraint name (for FK operations) */
  constraintName?: string;

  /** Referenced table (for FK operations) */
  referencedTable?: string;
}

/**
 * Result of comparing two collection schemas.
 */
export interface SchemaDiff {
  /** Collection slug */
  collectionSlug: string;

  /** Table name */
  tableName: string;

  /** Whether this is a new collection */
  isNew: boolean;

  /** Whether the collection was deleted */
  isDeleted: boolean;

  /** List of detected changes */
  changes: SchemaChange[];

  /** Human-readable description of changes */
  description: string;
}

/**
 * Generated migration result.
 */
export interface GeneratedMigration {
  /** Migration name (e.g., "20250123_120000_create_posts") */
  name: string;

  /** UP migration SQL */
  up: string;

  /** DOWN migration SQL (rollback) */
  down: string;

  /** SHA-256 checksum of UP + DOWN SQL */
  checksum: string;

  /** Human-readable description */
  description: string;

  /** Database dialect */
  dialect: SupportedDialect;

  /** Timestamp when generated */
  generatedAt: Date;
}

/**
 * Options for migration generation.
 */
export interface MigrationGeneratorOptions {
  /** Database dialect to generate for */
  dialect: SupportedDialect;

  /** Whether to include foreign key constraints (default: true) */
  includeForeignKeys?: boolean;

  /** Whether to include indexes (default: true) */
  includeIndexes?: boolean;
}

// ============================================================
// SQL Column Type Mappings
// ============================================================

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
 * Default value for UUID primary key by dialect.
 */
const UUID_DEFAULT: Record<SupportedDialect, string> = {
  postgresql: "DEFAULT gen_random_uuid()",
  mysql: "", // UUID generated at application level
  sqlite: "", // UUID generated at application level
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
// MigrationGenerator Class
// ============================================================

/**
 * Generates SQL migration files from collection definition changes.
 *
 * The generator calculates diffs between schema versions and produces
 * dialect-specific SQL for CREATE TABLE, ALTER TABLE, and DROP TABLE
 * operations.
 *
 * @example
 * ```typescript
 * const generator = new MigrationGenerator({ dialect: 'postgresql' });
 *
 * // Generate migration for a new collection
 * const migration = generator.generateCreateMigration(postsCollection);
 * console.log(migration.up);
 * console.log(migration.down);
 *
 * // Generate migration from diff
 * const diff = generator.calculateDiff(oldCollection, newCollection);
 * const migration = generator.generateFromDiff(diff);
 * ```
 */
export class MigrationGenerator {
  private readonly dialect: SupportedDialect;
  private readonly includeForeignKeys: boolean;
  private readonly includeIndexes: boolean;
  private readonly q: string; // Quote character

  constructor(options: MigrationGeneratorOptions) {
    this.dialect = options.dialect;
    this.includeForeignKeys = options.includeForeignKeys ?? true;
    this.includeIndexes = options.includeIndexes ?? true;
    this.q = QUOTE_CHAR[this.dialect];
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Generates a CREATE TABLE migration for a new collection.
   *
   * @param collection - The collection to create
   * @param description - Optional description override
   * @returns Generated migration with UP and DOWN SQL
   */
  generateCreateMigration(
    collection: DynamicCollectionRecord,
    description?: string
  ): GeneratedMigration {
    const tableName = collection.tableName;
    const desc = description || `create_${collection.slug}`;

    const upParts: string[] = [];
    const downParts: string[] = [];

    // Generate CREATE TABLE
    upParts.push(this.generateCreateTable(collection));

    // Generate indexes (as separate statements)
    if (this.includeIndexes) {
      const indexStatements = this.generateIndexStatements(collection);
      if (indexStatements.length > 0) {
        upParts.push("");
        upParts.push("-- Indexes");
        upParts.push(...indexStatements);
      }
    }

    // Generate foreign keys (as separate statements with comments)
    if (this.includeForeignKeys) {
      const fkStatements = this.generateForeignKeyStatements(collection);
      if (fkStatements.length > 0) {
        upParts.push("");
        upParts.push(
          "-- Foreign key constraints (run after all tables are created)"
        );
        upParts.push(...fkStatements);
      }
    }

    // Generate DROP TABLE for down migration
    downParts.push(this.generateDropTable(tableName));

    const up = upParts.join("\n");
    const down = downParts.join("\n");

    return this.createMigrationResult(desc, up, down);
  }

  /**
   * Generates a DROP TABLE migration for deleting a collection.
   *
   * @param collection - The collection to drop
   * @param description - Optional description override
   * @returns Generated migration with UP and DOWN SQL
   */
  generateDropMigration(
    collection: DynamicCollectionRecord,
    description?: string
  ): GeneratedMigration {
    const tableName = collection.tableName;
    const desc = description || `drop_${collection.slug}`;

    // UP: Drop the table (with warning)
    const upParts: string[] = [];
    upParts.push(
      `-- ⚠️ WARNING: This will permanently delete the "${tableName}" table and all its data`
    );
    upParts.push(this.generateDropTable(tableName));

    // DOWN: Recreate the table
    const downParts: string[] = [];
    downParts.push(
      "-- Recreate table (restore from backup if data recovery needed)"
    );
    downParts.push(this.generateCreateTable(collection));

    if (this.includeIndexes) {
      const indexStatements = this.generateIndexStatements(collection);
      if (indexStatements.length > 0) {
        downParts.push("");
        downParts.push("-- Indexes");
        downParts.push(...indexStatements);
      }
    }

    const up = upParts.join("\n");
    const down = downParts.join("\n");

    return this.createMigrationResult(desc, up, down);
  }

  /**
   * Calculates the diff between two collection versions.
   *
   * @param previousFields - Previous field definitions (null for new collection)
   * @param currentCollection - Current collection definition
   * @returns Schema diff with all detected changes
   */
  calculateDiff(
    previousFields: FieldConfig[] | null,
    currentCollection: DynamicCollectionRecord
  ): SchemaDiff {
    const changes: SchemaChange[] = [];
    const tableName = currentCollection.tableName;

    // New collection
    if (!previousFields) {
      return {
        collectionSlug: currentCollection.slug,
        tableName,
        isNew: true,
        isDeleted: false,
        changes: [{ type: "create_table", tableName }],
        description: `Create table ${tableName}`,
      };
    }

    // Build field maps for comparison
    const prevFieldMap = this.buildFieldMap(previousFields);
    const currFieldMap = this.buildFieldMap(currentCollection.fields);

    // Find added fields
    for (const [name, field] of currFieldMap) {
      if (!prevFieldMap.has(name)) {
        changes.push({
          type: "add_column",
          tableName,
          columnName: this.toSnakeCase(name),
          field,
        });

        // Check if field needs an index
        if (this.includeIndexes && this.fieldHasIndex(field)) {
          changes.push({
            type: "add_index",
            tableName,
            columnName: this.toSnakeCase(name),
            indexName: this.generateIndexName(tableName, name, field),
            field,
          });
        }

        // Check if field needs a foreign key
        if (this.includeForeignKeys && this.fieldHasForeignKey(field)) {
          const refTable = this.getReferencedTable(field);
          if (refTable) {
            changes.push({
              type: "add_foreign_key",
              tableName,
              columnName: this.toSnakeCase(name),
              constraintName: `${tableName}_${this.toSnakeCase(name)}_fkey`,
              referencedTable: refTable,
              field,
            });
          }
        }
      }
    }

    // Find removed fields
    for (const [name, field] of prevFieldMap) {
      if (!currFieldMap.has(name)) {
        // Drop index first if it exists
        if (this.includeIndexes && this.fieldHasIndex(field)) {
          changes.push({
            type: "drop_index",
            tableName,
            columnName: this.toSnakeCase(name),
            indexName: this.generateIndexName(tableName, name, field),
          });
        }

        // Drop foreign key first if it exists
        if (this.includeForeignKeys && this.fieldHasForeignKey(field)) {
          changes.push({
            type: "drop_foreign_key",
            tableName,
            columnName: this.toSnakeCase(name),
            constraintName: `${tableName}_${this.toSnakeCase(name)}_fkey`,
          });
        }

        changes.push({
          type: "drop_column",
          tableName,
          columnName: this.toSnakeCase(name),
          field,
        });
      }
    }

    // Find modified fields (type changes, constraints, etc.)
    for (const [name, currField] of currFieldMap) {
      const prevField = prevFieldMap.get(name);
      if (prevField && this.hasFieldChanged(prevField, currField)) {
        changes.push({
          type: "modify_column",
          tableName,
          columnName: this.toSnakeCase(name),
          field: currField,
          previousField: prevField,
        });
      }
    }

    // Generate description
    const descriptions: string[] = [];
    const addedCount = changes.filter(c => c.type === "add_column").length;
    const removedCount = changes.filter(c => c.type === "drop_column").length;
    const modifiedCount = changes.filter(
      c => c.type === "modify_column"
    ).length;

    if (addedCount > 0)
      descriptions.push(`add ${addedCount} column${addedCount > 1 ? "s" : ""}`);
    if (removedCount > 0)
      descriptions.push(
        `remove ${removedCount} column${removedCount > 1 ? "s" : ""}`
      );
    if (modifiedCount > 0)
      descriptions.push(
        `modify ${modifiedCount} column${modifiedCount > 1 ? "s" : ""}`
      );

    return {
      collectionSlug: currentCollection.slug,
      tableName,
      isNew: false,
      isDeleted: false,
      changes,
      description:
        descriptions.length > 0
          ? `${tableName}: ${descriptions.join(", ")}`
          : `No changes to ${tableName}`,
    };
  }

  /**
   * Generates a migration from a calculated diff.
   *
   * @param diff - Schema diff to generate migration from
   * @param description - Optional description override
   * @returns Generated migration with UP and DOWN SQL
   */
  generateFromDiff(diff: SchemaDiff, description?: string): GeneratedMigration {
    // Handle new collection
    if (diff.isNew) {
      throw new Error(
        "Use generateCreateMigration() for new collections. Diff indicates a new collection."
      );
    }

    // Handle deleted collection
    if (diff.isDeleted) {
      throw new Error(
        "Use generateDropMigration() for deleted collections. Diff indicates a deleted collection."
      );
    }

    // No changes
    if (diff.changes.length === 0) {
      return this.createMigrationResult(
        `no_changes_${diff.collectionSlug}`,
        "-- No changes detected",
        "-- No changes to rollback"
      );
    }

    const upStatements: string[] = [];
    const downStatements: string[] = [];
    const desc = description || this.generateMigrationName(diff);

    // Process each change
    for (const change of diff.changes) {
      const { up, down } = this.generateChangeSQL(change);
      if (up) upStatements.push(up);
      if (down) downStatements.unshift(down); // Reverse order for rollback
    }

    const up = upStatements.join("\n\n");
    const down = downStatements.join("\n\n");

    return this.createMigrationResult(desc, up, down);
  }

  /**
   * Generates migrations for multiple collections at once.
   *
   * @param diffs - Array of schema diffs
   * @returns Single combined migration
   */
  generateBatchMigration(
    diffs: SchemaDiff[],
    description?: string
  ): GeneratedMigration {
    const upStatements: string[] = [];
    const downStatements: string[] = [];

    for (const diff of diffs) {
      if (diff.changes.length === 0) continue;

      upStatements.push(`-- ${diff.description}`);

      for (const change of diff.changes) {
        const { up, down } = this.generateChangeSQL(change);
        if (up) upStatements.push(up);
        if (down) downStatements.unshift(down);
      }

      upStatements.push("");
    }

    const desc = description || `batch_migration_${diffs.length}_collections`;
    const up = upStatements.join("\n").trim();
    const down = downStatements.join("\n\n").trim();

    return this.createMigrationResult(desc, up, down);
  }

  // ============================================================
  // CREATE TABLE Generation
  // ============================================================

  /**
   * Generates CREATE TABLE SQL for a collection.
   */
  private generateCreateTable(collection: DynamicCollectionRecord): string {
    const tableName = collection.tableName;
    const lines: string[] = [];

    lines.push(`CREATE TABLE IF NOT EXISTS ${this.q}${tableName}${this.q} (`);

    // Primary key column
    lines.push(this.generatePrimaryKeySQL());

    // Field columns
    for (const field of collection.fields) {
      if (!isDataField(field)) continue;

      const columnSQL = this.generateColumnSQL(field);
      if (columnSQL) {
        lines.push(`  ${columnSQL},`);
      }
    }

    // Timestamp columns
    if (collection.timestamps) {
      lines.push(this.generateTimestampColumnsSQL());
    }

    // Remove trailing comma from last column
    const lastIndex = lines.length - 1;
    lines[lastIndex] = lines[lastIndex].replace(/,$/, "");

    lines.push(");");

    return lines.join("\n");
  }

  /**
   * Generates primary key column SQL.
   */
  private generatePrimaryKeySQL(): string {
    const types = SQL_COLUMN_TYPES[this.dialect];
    const defaultVal = UUID_DEFAULT[this.dialect];

    return (
      `  ${this.q}id${this.q} ${types.uuid} PRIMARY KEY ${defaultVal}`.trim() +
      ","
    );
  }

  /**
   * Generates timestamp columns SQL.
   */
  private generateTimestampColumnsSQL(): string {
    const types = SQL_COLUMN_TYPES[this.dialect];
    const defaultVal = TIMESTAMP_DEFAULT[this.dialect];

    const lines = [
      `  ${this.q}created_at${this.q} ${types.timestamp} NOT NULL ${defaultVal},`,
      `  ${this.q}updated_at${this.q} ${types.timestamp} NOT NULL ${defaultVal},`,
    ];

    return lines.join("\n");
  }

  /**
   * Generates column SQL for a field.
   */
  private generateColumnSQL(field: DataFieldConfig): string | null {
    if (!("name" in field) || !field.name) {
      return null;
    }

    const columnName = this.toSnakeCase(field.name);
    const columnType = this.getColumnType(field);

    if (!columnType) return null;

    const parts = [`${this.q}${columnName}${this.q}`, columnType];

    // NOT NULL constraint
    if ("required" in field && field.required) {
      parts.push("NOT NULL");
    }

    // Default value for boolean/checkbox
    if (isCheckboxField(field) && field.defaultValue !== undefined) {
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

  /**
   * Gets the SQL column type for a field.
   */
  private getColumnType(field: DataFieldConfig): string | null {
    const types = SQL_COLUMN_TYPES[this.dialect];

    if (isTextField(field)) {
      if (field.hasMany) return types.json;
      return field.maxLength ? types.varchar(field.maxLength) : types.text;
    }
    if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
      return types.text;
    }
    if (isEmailField(field)) {
      return types.varchar(255);
    }
    if (isPasswordField(field)) {
      return types.varchar(255);
    }
    if (isNumberField(field)) {
      if (field.hasMany) return types.json;
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
    if (isUploadField(field) || isRelationshipField(field)) {
      if (Array.isArray(field.relationTo) || field.hasMany) {
        return types.json;
      }
      return types.uuid;
    }
    if (isArrayField(field) || isGroupField(field)) {
      return types.json;
    }
    if (isJSONField(field)) {
      return types.json;
    }
    if (isChipsField(field)) {
      return types.json;
    }

    return null;
  }

  // ============================================================
  // DROP TABLE Generation
  // ============================================================

  /**
   * Generates DROP TABLE SQL.
   */
  private generateDropTable(tableName: string): string {
    if (this.dialect === "postgresql") {
      return `DROP TABLE IF EXISTS ${this.q}${tableName}${this.q} CASCADE;`;
    }
    return `DROP TABLE IF EXISTS ${this.q}${tableName}${this.q};`;
  }

  // ============================================================
  // ALTER TABLE Generation
  // ============================================================

  /**
   * Generates SQL for a single schema change.
   */
  private generateChangeSQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    switch (change.type) {
      case "add_column":
        return this.generateAddColumnSQL(change);
      case "drop_column":
        return this.generateDropColumnSQL(change);
      case "modify_column":
        return this.generateModifyColumnSQL(change);
      case "add_index":
        return this.generateAddIndexSQL(change);
      case "drop_index":
        return this.generateDropIndexSQL(change);
      case "add_foreign_key":
        return this.generateAddForeignKeySQL(change);
      case "drop_foreign_key":
        return this.generateDropForeignKeySQL(change);
      default:
        return { up: "", down: "" };
    }
  }

  /**
   * Generates ADD COLUMN SQL.
   */
  private generateAddColumnSQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (!change.field || !change.columnName) {
      return { up: "", down: "" };
    }

    const columnType = this.getColumnType(change.field);
    if (!columnType) return { up: "", down: "" };

    const parts = [`${this.q}${change.columnName}${this.q}`, columnType];

    // NOT NULL constraint
    if ("required" in change.field && change.field.required) {
      parts.push("NOT NULL");
    }

    const up = `ALTER TABLE ${this.q}${change.tableName}${this.q} ADD COLUMN ${parts.join(" ")};`;
    const down = `-- ⚠️ WARNING: Dropping column "${change.columnName}" - ensure data is backed up\nALTER TABLE ${this.q}${change.tableName}${this.q} DROP COLUMN ${this.q}${change.columnName}${this.q};`;

    return { up, down };
  }

  /**
   * Generates DROP COLUMN SQL.
   */
  private generateDropColumnSQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (!change.columnName) {
      return { up: "", down: "" };
    }

    const up = `-- ⚠️ WARNING: Dropping column "${change.columnName}" - ensure data is backed up or migrated\nALTER TABLE ${this.q}${change.tableName}${this.q} DROP COLUMN ${this.q}${change.columnName}${this.q};`;

    // DOWN: Attempt to recreate (may need manual adjustment)
    let down = `-- Recreate dropped column (data cannot be restored automatically)`;
    if (change.field) {
      const columnType = this.getColumnType(change.field);
      if (columnType) {
        down = `ALTER TABLE ${this.q}${change.tableName}${this.q} ADD COLUMN ${this.q}${change.columnName}${this.q} ${columnType};`;
      }
    }

    return { up, down };
  }

  /**
   * Generates MODIFY COLUMN SQL.
   */
  private generateModifyColumnSQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (!change.field || !change.previousField || !change.columnName) {
      return { up: "", down: "" };
    }

    const newType = this.getColumnType(change.field);
    const oldType = this.getColumnType(change.previousField);

    if (!newType || !oldType) return { up: "", down: "" };

    let up: string;
    let down: string;

    if (this.dialect === "postgresql") {
      up = `ALTER TABLE ${this.q}${change.tableName}${this.q} ALTER COLUMN ${this.q}${change.columnName}${this.q} TYPE ${newType};`;
      down = `ALTER TABLE ${this.q}${change.tableName}${this.q} ALTER COLUMN ${this.q}${change.columnName}${this.q} TYPE ${oldType};`;
    } else if (this.dialect === "mysql") {
      // MySQL requires full column definition
      const modifiers: string[] = [];
      if ("required" in change.field && change.field.required) {
        modifiers.push("NOT NULL");
      }
      up =
        `ALTER TABLE ${this.q}${change.tableName}${this.q} MODIFY COLUMN ${this.q}${change.columnName}${this.q} ${newType} ${modifiers.join(" ")}`.trim() +
        ";";

      const prevModifiers: string[] = [];
      if ("required" in change.previousField && change.previousField.required) {
        prevModifiers.push("NOT NULL");
      }
      down =
        `ALTER TABLE ${this.q}${change.tableName}${this.q} MODIFY COLUMN ${this.q}${change.columnName}${this.q} ${oldType} ${prevModifiers.join(" ")}`.trim() +
        ";";
    } else {
      // SQLite doesn't support ALTER COLUMN directly
      up = `-- SQLite does not support ALTER COLUMN. Consider recreating the table.\n-- New type: ${newType}`;
      down = `-- SQLite does not support ALTER COLUMN. Consider recreating the table.\n-- Old type: ${oldType}`;
    }

    return { up, down };
  }

  // ============================================================
  // Index Generation
  // ============================================================

  /**
   * Generates CREATE INDEX statements for a collection.
   *
   * Creates indexes from two sources:
   * 1. Field-level: `index: true` or `unique: true` on individual fields
   * 2. Collection-level: `indexes` array for compound (multi-column) indexes
   */
  private generateIndexStatements(
    collection: DynamicCollectionRecord
  ): string[] {
    const statements: string[] = [];
    const tableName = collection.tableName;

    // 1. Generate single-field indexes from field definitions
    for (const field of collection.fields) {
      if (!isDataField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const columnName = this.toSnakeCase(field.name);

      if ("unique" in field && field.unique) {
        const indexName = `${tableName}_${columnName}_unique`;
        statements.push(
          `CREATE UNIQUE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q} (${this.q}${columnName}${this.q});`
        );
      } else if ("index" in field && field.index) {
        const indexName = `${tableName}_${columnName}_idx`;
        statements.push(
          `CREATE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q} (${this.q}${columnName}${this.q});`
        );
      }
    }

    // 2. Generate compound indexes from collection-level indexes config
    if (collection.indexes && collection.indexes.length > 0) {
      for (const indexConfig of collection.indexes) {
        if (!indexConfig.fields || indexConfig.fields.length === 0) continue;

        // Generate column names (convert camelCase to snake_case)
        const columnNames = indexConfig.fields.map(f => this.toSnakeCase(f));

        // Generate index name: custom name or auto-generated
        const indexName =
          indexConfig.name ||
          `${tableName}_${columnNames.join("_")}_${indexConfig.unique ? "unique" : "idx"}`;

        // Generate column list for SQL
        const columnsSQL = columnNames
          .map(col => `${this.q}${col}${this.q}`)
          .join(", ");

        // Generate CREATE INDEX statement
        const uniqueKeyword = indexConfig.unique ? "UNIQUE " : "";
        statements.push(
          `CREATE ${uniqueKeyword}INDEX ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q} (${columnsSQL});`
        );
      }
    }

    return statements;
  }

  /**
   * Generates ADD INDEX SQL.
   */
  private generateAddIndexSQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (!change.indexName || !change.columnName) {
      return { up: "", down: "" };
    }

    const isUnique =
      change.field && "unique" in change.field && change.field.unique;
    const createKeyword = isUnique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";

    const up = `${createKeyword} ${this.q}${change.indexName}${this.q} ON ${this.q}${change.tableName}${this.q} (${this.q}${change.columnName}${this.q});`;
    const down = `DROP INDEX ${this.dialect === "mysql" ? `${this.q}${change.indexName}${this.q} ON ${this.q}${change.tableName}${this.q}` : `${this.q}${change.indexName}${this.q}`};`;

    return { up, down };
  }

  /**
   * Generates DROP INDEX SQL.
   */
  private generateDropIndexSQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (!change.indexName || !change.columnName) {
      return { up: "", down: "" };
    }

    const up = `DROP INDEX ${this.dialect === "mysql" ? `${this.q}${change.indexName}${this.q} ON ${this.q}${change.tableName}${this.q}` : `${this.q}${change.indexName}${this.q}`};`;

    // DOWN: Recreate index
    const isUnique =
      change.field && "unique" in change.field && change.field.unique;
    const createKeyword = isUnique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
    const down = `${createKeyword} ${this.q}${change.indexName}${this.q} ON ${this.q}${change.tableName}${this.q} (${this.q}${change.columnName}${this.q});`;

    return { up, down };
  }

  // ============================================================
  // Foreign Key Generation
  // ============================================================

  /**
   * Generates foreign key constraint statements for a collection.
   */
  private generateForeignKeyStatements(
    collection: DynamicCollectionRecord
  ): string[] {
    const statements: string[] = [];
    const tableName = collection.tableName;

    for (const field of collection.fields) {
      if (!isDataField(field)) continue;
      if (!this.fieldHasForeignKey(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const refTable = this.getReferencedTable(field);
      if (!refTable) continue;

      const columnName = this.toSnakeCase(field.name);
      const constraintName = `${tableName}_${columnName}_fkey`;

      // Generate as commented SQL (safer for execution order)
      statements.push(
        `-- ALTER TABLE ${this.q}${tableName}${this.q} ADD CONSTRAINT ${this.q}${constraintName}${this.q} FOREIGN KEY (${this.q}${columnName}${this.q}) REFERENCES ${this.q}${refTable}${this.q}(${this.q}id${this.q});`
      );
    }

    return statements;
  }

  /**
   * Generates ADD FOREIGN KEY SQL.
   */
  private generateAddForeignKeySQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (
      !change.constraintName ||
      !change.columnName ||
      !change.referencedTable
    ) {
      return { up: "", down: "" };
    }

    const up = `-- Foreign key constraint (ensure referenced table exists)\nALTER TABLE ${this.q}${change.tableName}${this.q} ADD CONSTRAINT ${this.q}${change.constraintName}${this.q} FOREIGN KEY (${this.q}${change.columnName}${this.q}) REFERENCES ${this.q}${change.referencedTable}${this.q}(${this.q}id${this.q});`;

    let down: string;
    if (this.dialect === "mysql") {
      down = `ALTER TABLE ${this.q}${change.tableName}${this.q} DROP FOREIGN KEY ${this.q}${change.constraintName}${this.q};`;
    } else {
      down = `ALTER TABLE ${this.q}${change.tableName}${this.q} DROP CONSTRAINT ${this.q}${change.constraintName}${this.q};`;
    }

    return { up, down };
  }

  /**
   * Generates DROP FOREIGN KEY SQL.
   */
  private generateDropForeignKeySQL(change: SchemaChange): {
    up: string;
    down: string;
  } {
    if (!change.constraintName || !change.columnName) {
      return { up: "", down: "" };
    }

    let up: string;
    if (this.dialect === "mysql") {
      up = `ALTER TABLE ${this.q}${change.tableName}${this.q} DROP FOREIGN KEY ${this.q}${change.constraintName}${this.q};`;
    } else {
      up = `ALTER TABLE ${this.q}${change.tableName}${this.q} DROP CONSTRAINT ${this.q}${change.constraintName}${this.q};`;
    }

    // DOWN: Would need to recreate FK (requires knowing referenced table)
    const down = `-- Recreate foreign key constraint if needed`;

    return { up, down };
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Creates the final migration result object.
   */
  private createMigrationResult(
    description: string,
    up: string,
    down: string
  ): GeneratedMigration {
    const now = new Date();
    const name = this.generateMigrationFileName(description, now);
    const checksum = this.calculateChecksum(up, down);

    return {
      name,
      up,
      down,
      checksum,
      description,
      dialect: this.dialect,
      generatedAt: now,
    };
  }

  /**
   * Generates migration file name with timestamp.
   */
  private generateMigrationFileName(description: string, date: Date): string {
    const timestamp = date
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14)
      .replace(/(\d{8})(\d{6})/, "$1_$2");

    const sanitizedDesc = description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    return `${timestamp}_${sanitizedDesc}`;
  }

  /**
   * Generates migration name from diff.
   */
  private generateMigrationName(diff: SchemaDiff): string {
    const parts: string[] = [];

    const addedColumns = diff.changes.filter(c => c.type === "add_column");
    const droppedColumns = diff.changes.filter(c => c.type === "drop_column");
    const modifiedColumns = diff.changes.filter(
      c => c.type === "modify_column"
    );

    if (addedColumns.length > 0) {
      parts.push(`add_${addedColumns.map(c => c.columnName).join("_")}`);
    }
    if (droppedColumns.length > 0) {
      parts.push(`drop_${droppedColumns.map(c => c.columnName).join("_")}`);
    }
    if (modifiedColumns.length > 0) {
      parts.push(`modify_${modifiedColumns.map(c => c.columnName).join("_")}`);
    }

    return parts.length > 0
      ? `${diff.tableName}_${parts.join("_")}`
      : `update_${diff.tableName}`;
  }

  /**
   * Calculates SHA-256 checksum of migration content.
   */
  private calculateChecksum(up: string, down: string): string {
    const content = `${up}\n---\n${down}`;
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Builds a map of field names to field configs.
   */
  private buildFieldMap(fields: FieldConfig[]): Map<string, DataFieldConfig> {
    const map = new Map<string, DataFieldConfig>();

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      map.set(field.name, field);
    }

    return map;
  }

  /**
   * Checks if a field has changed between versions.
   */
  private hasFieldChanged(
    prev: DataFieldConfig,
    curr: DataFieldConfig
  ): boolean {
    // Compare type
    if (prev.type !== curr.type) return true;

    // Compare required
    const prevRequired = "required" in prev && prev.required;
    const currRequired = "required" in curr && curr.required;
    if (prevRequired !== currRequired) return true;

    // Compare unique
    const prevUnique = "unique" in prev && prev.unique;
    const currUnique = "unique" in curr && curr.unique;
    if (prevUnique !== currUnique) return true;

    // Compare index
    const prevIndex = "index" in prev && prev.index;
    const currIndex = "index" in curr && curr.index;
    if (prevIndex !== currIndex) return true;

    // Compare maxLength for text fields
    if (isTextField(prev) && isTextField(curr)) {
      if (prev.maxLength !== curr.maxLength) return true;
    }

    // Compare hasMany for select/relationship fields
    if (
      (isSelectField(prev) && isSelectField(curr)) ||
      (isRelationshipField(prev) && isRelationshipField(curr)) ||
      (isUploadField(prev) && isUploadField(curr))
    ) {
      if (prev.hasMany !== curr.hasMany) return true;
    }

    return false;
  }

  /**
   * Checks if a field has an index.
   */
  private fieldHasIndex(field: DataFieldConfig): boolean {
    return (
      ("unique" in field && Boolean(field.unique)) ||
      ("index" in field && Boolean(field.index))
    );
  }

  /**
   * Checks if a field represents a foreign key.
   */
  private fieldHasForeignKey(field: DataFieldConfig): boolean {
    if (!isRelationshipField(field) && !isUploadField(field)) {
      return false;
    }

    // Only single, non-polymorphic relationships create FK columns
    return (
      !Array.isArray(field.relationTo) &&
      !field.hasMany &&
      typeof field.relationTo === "string"
    );
  }

  /**
   * Gets the referenced table name for a relationship field.
   */
  private getReferencedTable(field: DataFieldConfig): string | null {
    if (!isRelationshipField(field) && !isUploadField(field)) {
      return null;
    }

    if (typeof field.relationTo === "string") {
      return field.relationTo;
    }

    return null;
  }

  /**
   * Generates index name for a field.
   */
  private generateIndexName(
    tableName: string,
    fieldName: string,
    field: DataFieldConfig
  ): string {
    const columnName = this.toSnakeCase(fieldName);
    const suffix = "unique" in field && field.unique ? "unique" : "idx";
    return `${tableName}_${columnName}_${suffix}`;
  }

  /**
   * Converts camelCase to snake_case.
   */
  private toSnakeCase(name: string): string {
    return name
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "");
  }
}
