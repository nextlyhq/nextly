/**
 * Schema Generator Service
 *
 * Generates dialect-specific Drizzle ORM schema files from collection and single definitions.
 * Supports PostgreSQL, MySQL, and SQLite dialects with proper column type mapping,
 * primary keys, timestamps, indexes, and relations.
 *
 * @module services/schema/schema-generator
 * @since 1.0.0
 */

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
  isRepeaterField,
  isGroupField,
  isJSONField,
  isChipsField,
  isDataField,
} from "../../../collections/fields/guards";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";

// ============================================================
// Types
// ============================================================

/**
 * Supported database dialects for schema generation.
 */
export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Result of generating a schema for a collection.
 */
export interface GeneratedSchema {
  /** Collection slug */
  collectionSlug: string;

  /** Database table name */
  tableName: string;

  /** Generated TypeScript code for the schema */
  code: string;

  /** Suggested filename (e.g., "posts.schema.ts") */
  filename: string;
}

/**
 * Result of generating a schema for a Single.
 */
export interface GeneratedSingleSchema {
  /** Single slug */
  singleSlug: string;

  /** Database table name */
  tableName: string;

  /** Generated TypeScript code for the schema */
  code: string;

  /** Suggested filename (e.g., "site-settings.schema.ts") */
  filename: string;
}

/**
 * Result of generating an index file that exports all schemas.
 */
export interface GeneratedIndexFile {
  /** Generated TypeScript code for the index file */
  code: string;

  /** Suggested filename (always "index.ts") */
  filename: string;
}

/**
 * Options for schema generation.
 */
export interface SchemaGeneratorOptions {
  /** Database dialect to generate for */
  dialect: SupportedDialect;

  /** Whether to include relation definitions (default: true) */
  includeRelations?: boolean;

  /** Custom schema name/prefix for PostgreSQL (optional) */
  schemaName?: string;
}

// ============================================================
// Dialect-Specific Configuration
// ============================================================

/**
 * Import paths for each dialect.
 */
const DIALECT_IMPORTS: Record<SupportedDialect, string> = {
  postgresql: "drizzle-orm/pg-core",
  mysql: "drizzle-orm/mysql-core",
  sqlite: "drizzle-orm/sqlite-core",
};

/**
 * Table function names for each dialect.
 */
const TABLE_FUNCTIONS: Record<SupportedDialect, string> = {
  postgresql: "pgTable",
  mysql: "mysqlTable",
  sqlite: "sqliteTable",
};

/**
 * Column type mappings for each dialect.
 */
/**
 * Column type definition with function name and optional config.
 */
interface ColumnTypeDef {
  fn: string;
  options?: string;
}

const COLUMN_TYPES: Record<
  SupportedDialect,
  {
    // Core types
    uuid: ColumnTypeDef;
    text: ColumnTypeDef;
    varchar: (length?: number) => ColumnTypeDef;
    boolean: ColumnTypeDef;
    integer: ColumnTypeDef;
    bigint: ColumnTypeDef;
    real: ColumnTypeDef;
    doublePrecision: ColumnTypeDef;
    timestamp: ColumnTypeDef;
    json: ColumnTypeDef;
    jsonb: ColumnTypeDef;
    // Special types
    serial: ColumnTypeDef;
    bigserial: ColumnTypeDef;
  }
> = {
  postgresql: {
    uuid: { fn: "uuid" },
    text: { fn: "text" },
    varchar: (length?: number) =>
      length
        ? { fn: "varchar", options: `{ length: ${length} }` }
        : { fn: "varchar" },
    boolean: { fn: "boolean" },
    integer: { fn: "integer" },
    bigint: { fn: "bigint" },
    real: { fn: "real" },
    doublePrecision: { fn: "doublePrecision" },
    timestamp: { fn: "timestamp" },
    json: { fn: "json" },
    jsonb: { fn: "jsonb" },
    serial: { fn: "serial" },
    bigserial: { fn: "bigserial" },
  },
  mysql: {
    uuid: { fn: "varchar", options: "{ length: 36 }" },
    text: { fn: "text" },
    varchar: (length?: number) => ({
      fn: "varchar",
      options: `{ length: ${length || 255} }`,
    }),
    boolean: { fn: "boolean" },
    integer: { fn: "int" },
    bigint: { fn: "bigint" },
    real: { fn: "real" },
    doublePrecision: { fn: "double" },
    timestamp: { fn: "timestamp" },
    json: { fn: "json" },
    jsonb: { fn: "json" },
    serial: { fn: "serial" },
    bigserial: { fn: "bigint", options: "{ mode: 'number', unsigned: true }" },
  },
  sqlite: {
    uuid: { fn: "text" },
    text: { fn: "text" },
    varchar: () => ({ fn: "text" }),
    boolean: { fn: "integer", options: "{ mode: 'boolean' }" },
    integer: { fn: "integer" },
    bigint: { fn: "integer" },
    real: { fn: "real" },
    doublePrecision: { fn: "real" },
    timestamp: { fn: "integer", options: "{ mode: 'timestamp' }" },
    json: { fn: "text", options: "{ mode: 'json' }" },
    jsonb: { fn: "text", options: "{ mode: 'json' }" },
    serial: { fn: "integer" },
    bigserial: { fn: "integer" },
  },
};

// ============================================================
// SchemaGenerator Class
// ============================================================

/**
 * Generates Drizzle ORM schema files from collection and Single definitions.
 *
 * The generator creates TypeScript code that can be written to files and
 * used with Drizzle ORM for database operations. Supports both Collections
 * (multi-document entities) and Singles (single-document configurations).
 *
 * @example
 * ```typescript
 * const generator = new SchemaGenerator({ dialect: 'postgresql' });
 *
 * // Generate schema for a collection
 * const schema = generator.generateSchema(postsCollection);
 * console.log(schema.code);
 *
 * // Generate schemas for all collections
 * const schemas = generator.generateAllSchemas(collections);
 *
 * // Generate schema for a Single
 * const singleSchema = generator.generateSingleSchema(siteSettings);
 * console.log(singleSchema.code);
 *
 * // Generate schemas for all Singles
 * const singleSchemas = generator.generateAllSingleSchemas(singles);
 *
 * // Generate combined index file (collections + singles)
 * const indexFile = generator.generateCombinedIndexFile(collections, singles);
 * ```
 */
export class SchemaGenerator {
  private readonly dialect: SupportedDialect;
  private readonly includeRelations: boolean;
  private readonly schemaName?: string;

  constructor(options: SchemaGeneratorOptions) {
    this.dialect = options.dialect;
    this.includeRelations = options.includeRelations ?? true;
    this.schemaName = options.schemaName;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Generates a Drizzle schema for a single collection.
   *
   * @param collection - The collection record to generate schema for
   * @returns Generated schema with code, filename, and metadata
   */
  generateSchema(collection: DynamicCollectionRecord): GeneratedSchema {
    const imports = this.generateImports(collection);
    const tableDefinition = this.generateTableDefinition(collection);
    const relations = this.includeRelations
      ? this.generateRelations(collection)
      : "";

    const code = [imports, "", tableDefinition, relations]
      .filter(Boolean)
      .join("\n");

    return {
      collectionSlug: collection.slug,
      tableName: collection.tableName,
      code,
      filename: `${collection.slug}.schema.ts`,
    };
  }

  /**
   * Generates Drizzle schemas for multiple collections.
   *
   * @param collections - Array of collection records
   * @returns Array of generated schemas
   */
  generateAllSchemas(
    collections: DynamicCollectionRecord[]
  ): GeneratedSchema[] {
    return collections.map(collection => this.generateSchema(collection));
  }

  /**
   * Generates an index file that exports all collection schemas.
   *
   * @param collections - Array of collection records
   * @returns Generated index file with exports
   */
  generateIndexFile(
    collections: DynamicCollectionRecord[]
  ): GeneratedIndexFile {
    const exports = collections
      .map(c => `export * from "./${c.slug}.schema";`)
      .sort()
      .join("\n");

    const code = [
      "/**",
      " * Generated Drizzle Schema Index",
      " *",
      " * Auto-generated by Nextly SchemaGenerator.",
      " * Do not edit this file manually.",
      " *",
      " * @generated",
      " */",
      "",
      exports,
      "",
    ].join("\n");

    return {
      code,
      filename: "index.ts",
    };
  }

  // ============================================================
  // Singles Public API
  // ============================================================

  /**
   * Generates a Drizzle schema for a Single.
   *
   * Singles are single-document entities for site-wide configuration.
   * They always have an `id` and `updatedAt` column, but no `createdAt`.
   *
   * @param single - The Single record to generate schema for
   * @returns Generated schema with code, filename, and metadata
   */
  generateSingleSchema(single: DynamicSingleRecord): GeneratedSingleSchema {
    const imports = this.generateSingleImports(single);
    const tableDefinition = this.generateSingleTableDefinition(single);
    const relations = this.includeRelations
      ? this.generateSingleRelations(single)
      : "";

    const code = [imports, "", tableDefinition, relations]
      .filter(Boolean)
      .join("\n");

    return {
      singleSlug: single.slug,
      tableName: single.tableName,
      code,
      filename: `${single.slug}.schema.ts`,
    };
  }

  /**
   * Generates Drizzle schemas for multiple Singles.
   *
   * @param singles - Array of Single records
   * @returns Array of generated schemas
   */
  generateAllSingleSchemas(
    singles: DynamicSingleRecord[]
  ): GeneratedSingleSchema[] {
    return singles.map(single => this.generateSingleSchema(single));
  }

  /**
   * Generates an index file that exports all Single schemas.
   *
   * @param singles - Array of Single records
   * @returns Generated index file with exports
   */
  generateSingleIndexFile(singles: DynamicSingleRecord[]): GeneratedIndexFile {
    const exports = singles
      .map(s => `export * from "./${s.slug}.schema";`)
      .sort()
      .join("\n");

    const code = [
      "/**",
      " * Generated Drizzle Schema Index (Singles)",
      " *",
      " * Auto-generated by Nextly SchemaGenerator.",
      " * Do not edit this file manually.",
      " *",
      " * @generated",
      " */",
      "",
      exports,
      "",
    ].join("\n");

    return {
      code,
      filename: "index.ts",
    };
  }

  /**
   * Generates a combined index file that exports both collection and Single schemas.
   *
   * @param collections - Array of collection records
   * @param singles - Array of Single records
   * @returns Generated index file with all exports
   */
  generateCombinedIndexFile(
    collections: DynamicCollectionRecord[],
    singles: DynamicSingleRecord[]
  ): GeneratedIndexFile {
    const collectionExports = collections
      .map(c => `export * from "./collections/${c.slug}.schema";`)
      .sort();

    const singleExports = singles
      .map(s => `export * from "./singles/${s.slug}.schema";`)
      .sort();

    const code = [
      "/**",
      " * Generated Drizzle Schema Index",
      " *",
      " * Auto-generated by Nextly SchemaGenerator.",
      " * Do not edit this file manually.",
      " *",
      " * @generated",
      " */",
      "",
      "// Collections",
      ...collectionExports,
      "",
      "// Singles",
      ...singleExports,
      "",
    ].join("\n");

    return {
      code,
      filename: "index.ts",
    };
  }

  // ============================================================
  // Import Generation
  // ============================================================

  /**
   * Generates import statements for the schema file.
   */
  private generateImports(collection: DynamicCollectionRecord): string {
    const dialectImport = DIALECT_IMPORTS[this.dialect];
    const tableFunction = TABLE_FUNCTIONS[this.dialect];

    // Collect all column types needed
    const columnTypes = new Set<string>([tableFunction]);

    // Always need primary key type
    if (this.dialect === "postgresql") {
      columnTypes.add("uuid");
    } else if (this.dialect === "mysql") {
      columnTypes.add("varchar");
    } else {
      columnTypes.add("text");
    }

    // Add timestamp types if collection has timestamps
    if (collection.timestamps) {
      columnTypes.add(this.dialect === "sqlite" ? "integer" : "timestamp");
    }

    // Add the resolved column type for the status column when Draft/Published
    // is on. Mirrors select/radio: stored as a constrained string
    // ('draft' | 'published') instead of a DB-level enum to avoid Postgres
    // enum migration headaches and stay consistent across dialects.
    if (collection.status) {
      columnTypes.add(COLUMN_TYPES[this.dialect].varchar(20).fn);
    }

    // Collect types from fields
    this.collectFieldTypes(collection.fields, columnTypes);

    // Check if we need relations import
    const hasRelations =
      this.includeRelations && this.hasRelationshipFields(collection.fields);

    // Build import statements
    const imports: string[] = [];

    // Drizzle core imports
    const sortedTypes = Array.from(columnTypes).sort();
    imports.push(
      `import { ${sortedTypes.join(", ")} } from "${dialectImport}";`
    );

    // Relations import if needed
    if (hasRelations) {
      imports.push(`import { relations } from "drizzle-orm";`);
    }

    return imports.join("\n");
  }

  /**
   * Collects all column type names needed for the schema.
   */
  private collectFieldTypes(fields: FieldConfig[], types: Set<string>): void {
    for (const field of fields) {
      if (!isDataField(field)) continue;

      const columnType = this.getColumnTypeName(field);
      if (columnType) {
        types.add(columnType);
      }

      // Handle unique indexes
      if ("unique" in field && field.unique) {
        types.add("uniqueIndex");
      }

      // Handle regular indexes
      if ("index" in field && field.index) {
        types.add("index");
      }

      // Recursively handle nested fields
      if (isRepeaterField(field) || isGroupField(field)) {
        // Repeater and group fields store as JSON
        types.add(this.dialect === "postgresql" ? "jsonb" : "json");
      }
    }
  }

  /**
   * Gets the column type name for imports.
   */
  private getColumnTypeName(field: DataFieldConfig): string | null {
    if (isTextField(field)) {
      if (field.hasMany)
        return this.dialect === "postgresql" ? "jsonb" : "json";
      return field.maxLength ? "varchar" : "text";
    }
    if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
      return "text";
    }
    if (isEmailField(field)) {
      return "varchar";
    }
    if (isPasswordField(field)) {
      return "varchar";
    }
    if (isNumberField(field)) {
      if (field.hasMany)
        return this.dialect === "postgresql" ? "jsonb" : "json";
      return this.dialect === "sqlite" ? "integer" : "real";
    }
    if (isCheckboxField(field)) {
      return this.dialect === "sqlite" ? "integer" : "boolean";
    }
    if (isDateField(field)) {
      return this.dialect === "sqlite" ? "integer" : "timestamp";
    }
    if (isSelectField(field)) {
      return field.hasMany
        ? this.dialect === "postgresql"
          ? "jsonb"
          : "json"
        : "varchar";
    }
    if (isRadioField(field)) {
      // Radio fields are always single value (no hasMany)
      return "varchar";
    }
    if (isUploadField(field) || isRelationshipField(field)) {
      // Foreign key column
      if (this.dialect === "postgresql") {
        return "uuid";
      }
      return "varchar";
    }
    if (isRepeaterField(field) || isGroupField(field)) {
      return this.dialect === "postgresql" ? "jsonb" : "json";
    }
    if (isJSONField(field)) {
      return this.dialect === "postgresql" ? "jsonb" : "json";
    }
    if (isChipsField(field)) {
      return this.dialect === "postgresql" ? "jsonb" : "json";
    }

    return null;
  }

  // ============================================================
  // Table Definition Generation
  // ============================================================

  /**
   * Generates the table definition code.
   */
  private generateTableDefinition(collection: DynamicCollectionRecord): string {
    const tableFunction = TABLE_FUNCTIONS[this.dialect];
    const tableName = collection.tableName;
    // Use dc_ prefix for export name to match dynamic collection convention
    const exportName = `dc_${collection.slug.replace(/-/g, "_")}`;

    const lines: string[] = [];

    // Table comment
    lines.push(`/**`);
    lines.push(` * ${collection.labels.singular} table schema.`);
    if (collection.description) {
      lines.push(` *`);
      lines.push(` * ${collection.description}`);
    }
    lines.push(` *`);
    lines.push(` * @generated by Nextly SchemaGenerator`);
    lines.push(` */`);

    // Table definition start
    lines.push(
      `export const ${exportName} = ${tableFunction}("${tableName}", {`
    );

    // Primary key column
    lines.push(this.generatePrimaryKeyColumn());

    // Field columns
    for (const field of collection.fields) {
      if (!isDataField(field)) continue;

      const columnDef = this.generateColumnDefinition(field, false);
      if (columnDef) {
        lines.push(columnDef);
      }
    }

    // Timestamp columns
    if (collection.timestamps) {
      lines.push(this.generateTimestampColumns());
    }

    // Status column (Draft / Published)
    if (collection.status) {
      lines.push(this.generateStatusColumn());
    }

    // Check if we need indexes callback
    const indexedFields = collection.fields.filter(
      f =>
        isDataField(f) &&
        (("unique" in f && f.unique) || ("index" in f && f.index))
    );

    if (indexedFields.length > 0) {
      // Close columns object, add indexes callback
      lines.push(`}, (table) => [`);
      for (const field of indexedFields) {
        if (!isDataField(field)) continue;
        const indexDef = this.generateIndexDefinition(
          field as DataFieldConfig,
          tableName
        );
        if (indexDef) {
          lines.push(indexDef);
        }
      }
      lines.push(`]);`);
    } else {
      // Just close the table
      lines.push(`});`);
    }

    return lines.join("\n");
  }

  /**
   * Generates the primary key column definition.
   */
  private generatePrimaryKeyColumn(): string {
    const types = COLUMN_TYPES[this.dialect];

    if (this.dialect === "postgresql") {
      return `  id: ${types.uuid.fn}("id").primaryKey().defaultRandom(),`;
    }

    if (this.dialect === "mysql") {
      // MySQL uses varchar(36) for UUID
      const uuidType = types.uuid;
      const optionsStr = uuidType.options ? `, ${uuidType.options}` : "";
      return `  id: ${uuidType.fn}("id"${optionsStr}).primaryKey().$defaultFn(() => crypto.randomUUID()),`;
    }

    // SQLite
    return `  id: ${types.text.fn}("id").primaryKey().$defaultFn(() => crypto.randomUUID()),`;
  }

  /**
   * Generates the status column definition for Draft / Published.
   * Length 20 leaves headroom over the longest current value ("published" = 9).
   * Default 'draft' ensures existing rows backfill safely (no unintended
   * publishing) when the column is added. Uses the COLUMN_TYPES.varchar
   * helper so SQLite resolves to `text` while PG/MySQL get a length-bounded
   * varchar — matches the project's approach for select/radio columns.
   */
  private generateStatusColumn(): string {
    const colType = COLUMN_TYPES[this.dialect].varchar(20);
    const optionsStr = colType.options ? `, ${colType.options}` : "";
    return `  status: ${colType.fn}("status"${optionsStr}).notNull().default("draft"),`;
  }

  /**
   * Generates timestamp column definitions.
   */
  private generateTimestampColumns(): string {
    const types = COLUMN_TYPES[this.dialect];

    if (this.dialect === "sqlite") {
      const tsType = types.timestamp;
      const tsOptions = tsType.options ? `, ${tsType.options}` : "";
      return [
        `  createdAt: ${tsType.fn}("created_at"${tsOptions}).notNull().$defaultFn(() => new Date()),`,
        `  updatedAt: ${tsType.fn}("updated_at"${tsOptions}).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),`,
      ].join("\n");
    }

    return [
      `  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),`,
      `  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),`,
    ].join("\n");
  }

  /**
   * Generates a column definition for a field.
   */
  private generateColumnDefinition(
    field: DataFieldConfig,
    isSingle: boolean = false
  ): string | null {
    // Skip fields without names (layout fields shouldn't get here, but check anyway)
    if (!("name" in field) || !field.name) {
      return null;
    }

    const fieldName = field.name;
    const columnName = this.toSnakeCase(fieldName);
    const types = COLUMN_TYPES[this.dialect];

    let columnType: ColumnTypeDef;
    const modifiers: string[] = [];

    // Handle required (not all field types have this property)
    if ("required" in field && field.required) {
      if (isSingle) {
        // For Singles, some fields default to null during auto-creation
        // even if they are required. We must relax DB constraints for these.
        if (
          isDateField(field) ||
          isRelationshipField(field) ||
          isUploadField(field)
        ) {
          // Skip notNull() for these types in Singles
        } else {
          modifiers.push("notNull()");
        }
      } else {
        // Collections always enforce notNull for required fields
        modifiers.push("notNull()");
      }
    }

    // Text fields
    if (isTextField(field)) {
      if (field.hasMany) {
        columnType = types.jsonb;
      } else if (field.maxLength) {
        columnType = types.varchar(field.maxLength);
      } else {
        columnType = types.text;
      }
    }
    // Textarea, RichText, Code
    else if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
      columnType = types.text;
    }
    // Email
    else if (isEmailField(field)) {
      columnType = types.varchar(255);
    }
    // Password
    else if (isPasswordField(field)) {
      columnType = types.varchar(255);
    }
    // Number
    else if (isNumberField(field)) {
      if (field.hasMany) {
        columnType = types.jsonb;
      } else {
        // Use real/doublePrecision for decimals, integer for whole numbers
        columnType = types.real;
      }
    }
    // Checkbox
    else if (isCheckboxField(field)) {
      columnType = types.boolean;
      // Set default for checkbox
      if (field.defaultValue !== undefined) {
        modifiers.push(`default(${field.defaultValue})`);
      }
    }
    // Date
    else if (isDateField(field)) {
      if (this.dialect === "sqlite") {
        columnType = types.timestamp;
      } else {
        // For PostgreSQL/MySQL, add withTimezone option
        columnType = { fn: "timestamp", options: "{ withTimezone: true }" };
      }
    }
    // Select field
    else if (isSelectField(field)) {
      if (field.hasMany) {
        // Store as JSON array
        columnType = types.jsonb;
      } else {
        // Single value as varchar
        columnType = types.varchar(255);
      }
    }
    // Radio field (always single value)
    else if (isRadioField(field)) {
      columnType = types.varchar(255);
    }
    // Upload (foreign key to media)
    else if (isUploadField(field)) {
      if (Array.isArray(field.relationTo)) {
        // Polymorphic - store as JSON
        columnType = types.jsonb;
      } else if (field.hasMany) {
        // Many uploads - store as JSON array
        columnType = types.jsonb;
      } else {
        // Single upload - foreign key
        if (this.dialect === "postgresql") {
          columnType = types.uuid;
        } else {
          columnType = types.varchar(36);
        }
      }
    }
    // Relationship (foreign key)
    else if (isRelationshipField(field)) {
      if (Array.isArray(field.relationTo)) {
        // Polymorphic - store as JSON
        columnType = types.jsonb;
      } else if (field.hasMany) {
        // Many relationships - store as JSON array
        columnType = types.jsonb;
      } else {
        // Single relationship - foreign key
        if (this.dialect === "postgresql") {
          columnType = types.uuid;
        } else {
          columnType = types.varchar(36);
        }
      }
    }
    // Repeater, Group - store as JSON
    else if (isRepeaterField(field) || isGroupField(field)) {
      columnType = types.jsonb;
    }
    // JSON field
    else if (isJSONField(field)) {
      columnType = types.jsonb;
    }
    // Chips field - stored as JSON array
    else if (isChipsField(field)) {
      columnType = types.jsonb;
    }
    // Unknown field type
    else {
      return null;
    }

    // Build the column line
    // Format: fieldName: fnName("columnName", { options }).modifiers()
    const modifiersStr = modifiers.length > 0 ? `.${modifiers.join(".")}` : "";
    const optionsStr = columnType.options ? `, ${columnType.options}` : "";

    return `  ${fieldName}: ${columnType.fn}("${columnName}"${optionsStr})${modifiersStr},`;
  }

  /**
   * Generates index definition for a field.
   */
  private generateIndexDefinition(
    field: DataFieldConfig,
    tableName: string
  ): string | null {
    // Skip fields without names
    if (!("name" in field) || !field.name) {
      return null;
    }

    const fieldName = field.name;
    const columnName = this.toSnakeCase(fieldName);

    if ("unique" in field && field.unique) {
      const indexName = `${tableName}_${columnName}_unique`;
      return `  uniqueIndex("${indexName}").on(table.${fieldName}),`;
    }

    if ("index" in field && field.index) {
      const indexName = `${tableName}_${columnName}_idx`;
      return `  index("${indexName}").on(table.${fieldName}),`;
    }

    return null;
  }

  // ============================================================
  // Relations Generation
  // ============================================================

  /**
   * Checks if collection has any relationship fields.
   */
  private hasRelationshipFields(fields: FieldConfig[]): boolean {
    return fields.some(
      f =>
        isDataField(f) &&
        (isRelationshipField(f) || isUploadField(f)) &&
        !Array.isArray((f as { relationTo?: unknown }).relationTo) &&
        !(f as { hasMany?: boolean }).hasMany
    );
  }

  /**
   * Generates relations definition for a collection.
   */
  private generateRelations(collection: DynamicCollectionRecord): string {
    const relationFields = collection.fields.filter(
      f =>
        isDataField(f) &&
        (isRelationshipField(f) || isUploadField(f)) &&
        !Array.isArray((f as { relationTo?: unknown }).relationTo) &&
        !(f as { hasMany?: boolean }).hasMany
    );

    if (relationFields.length === 0) {
      return "";
    }

    // Use dc_ prefix for export name to match dynamic collection convention
    const exportName = `dc_${collection.slug.replace(/-/g, "_")}`;
    const relationsName = `${exportName}Relations`;

    const lines: string[] = [];
    lines.push("");
    lines.push(`/**`);
    lines.push(` * ${collection.labels.singular} relations.`);
    lines.push(` *`);
    lines.push(` * @generated by Nextly SchemaGenerator`);
    lines.push(` */`);
    lines.push(
      `export const ${relationsName} = relations(${exportName}, ({ one }) => ({`
    );

    for (const field of relationFields) {
      if (!isDataField(field)) continue;

      // Skip fields without names
      if (!("name" in field) || !field.name) continue;

      const relationTo = (field as { relationTo?: string | string[] })
        .relationTo;
      if (typeof relationTo !== "string") continue;

      // Use dc_ prefix for target table to match dynamic collection convention
      const targetTable = `dc_${relationTo.replace(/-/g, "_")}`;
      const fieldName = field.name;

      lines.push(`  ${fieldName}: one(${targetTable}, {`);
      lines.push(`    fields: [${exportName}.${fieldName}],`);
      lines.push(`    references: [${targetTable}.id],`);
      lines.push(`  }),`);
    }

    lines.push(`}));`);

    return lines.join("\n");
  }

  // ============================================================
  // Singles Import Generation
  // ============================================================

  /**
   * Generates import statements for a Single schema file.
   */
  private generateSingleImports(single: DynamicSingleRecord): string {
    const dialectImport = DIALECT_IMPORTS[this.dialect];
    const tableFunction = TABLE_FUNCTIONS[this.dialect];

    // Collect all column types needed
    const columnTypes = new Set<string>([tableFunction]);

    // Always need primary key type
    if (this.dialect === "postgresql") {
      columnTypes.add("uuid");
    } else if (this.dialect === "mysql") {
      columnTypes.add("varchar");
    } else {
      columnTypes.add("text");
    }

    // Singles always have updatedAt
    columnTypes.add(this.dialect === "sqlite" ? "integer" : "timestamp");

    // Status column type (Draft / Published) — opt-in per Single, mirrors
    // the collections path so SQLite resolves to text and PG/MySQL get varchar.
    if (single.status) {
      columnTypes.add(COLUMN_TYPES[this.dialect].varchar(20).fn);
    }

    // Collect types from fields
    this.collectFieldTypes(single.fields, columnTypes);

    // Check if we need relations import
    const hasRelations =
      this.includeRelations && this.hasRelationshipFields(single.fields);

    // Build import statements
    const imports: string[] = [];

    // Drizzle core imports
    const sortedTypes = Array.from(columnTypes).sort();
    imports.push(
      `import { ${sortedTypes.join(", ")} } from "${dialectImport}";`
    );

    // Relations import if needed
    if (hasRelations) {
      imports.push(`import { relations } from "drizzle-orm";`);
    }

    return imports.join("\n");
  }

  // ============================================================
  // Singles Table Definition Generation
  // ============================================================

  /**
   * Generates the table definition code for a Single.
   *
   * Singles have a simpler structure than collections:
   * - Always have `id` and `updatedAt` columns
   * - No `createdAt` column (Singles are auto-created once)
   * - No indexes callback (simpler structure)
   */
  private generateSingleTableDefinition(single: DynamicSingleRecord): string {
    const tableFunction = TABLE_FUNCTIONS[this.dialect];
    const tableName = single.tableName;
    // Use single_ prefix for export name to distinguish from collections
    const exportName = `single_${single.slug.replace(/-/g, "_")}`;

    const lines: string[] = [];

    // Table comment
    lines.push(`/**`);
    lines.push(` * ${single.label} table schema.`);
    if (single.description) {
      lines.push(` *`);
      lines.push(` * ${single.description}`);
    }
    lines.push(` *`);
    lines.push(` * @generated by Nextly SchemaGenerator`);
    lines.push(` */`);

    // Table definition start
    lines.push(
      `export const ${exportName} = ${tableFunction}("${tableName}", {`
    );

    // Primary key column
    lines.push(this.generatePrimaryKeyColumn());

    // System columns: title and slug (added automatically, matching
    // the UI-created path in dynamic-collection-schema-service.ts).
    // Only add if not already defined as user fields.
    const hasTitleField = single.fields.some(
      f => isDataField(f) && f.name === "title"
    );
    if (!hasTitleField) {
      lines.push(`  title: text("title").notNull(),`);
    }

    const hasSlugField = single.fields.some(
      f => isDataField(f) && f.name === "slug"
    );
    if (!hasSlugField) {
      lines.push(`  slug: text("slug").notNull(),`);
    }

    // Field columns
    for (const field of single.fields) {
      if (!isDataField(field)) continue;

      const columnDef = this.generateColumnDefinition(field, true);
      if (columnDef) {
        lines.push(columnDef);
      }
    }

    // Singles always have updatedAt (but not createdAt)
    lines.push(this.generateSingleUpdatedAtColumn());

    // Status column (Draft / Published) — opt-in per Single, same shape and
    // default semantics as Collections.
    if (single.status) {
      lines.push(this.generateStatusColumn());
    }

    // Close the table (Singles don't have indexes callback for simplicity)
    lines.push(`});`);

    return lines.join("\n");
  }

  /**
   * Generates the updatedAt column for Singles.
   * Singles only have updatedAt, not createdAt.
   */
  private generateSingleUpdatedAtColumn(): string {
    const types = COLUMN_TYPES[this.dialect];

    if (this.dialect === "sqlite") {
      const tsType = types.timestamp;
      const tsOptions = tsType.options ? `, ${tsType.options}` : "";
      return `  updatedAt: ${tsType.fn}("updated_at"${tsOptions}).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),`;
    }

    return `  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),`;
  }

  // ============================================================
  // Singles Relations Generation
  // ============================================================

  /**
   * Generates relations definition for a Single.
   */
  private generateSingleRelations(single: DynamicSingleRecord): string {
    const relationFields = single.fields.filter(
      f =>
        isDataField(f) &&
        (isRelationshipField(f) || isUploadField(f)) &&
        !Array.isArray((f as { relationTo?: unknown }).relationTo) &&
        !(f as { hasMany?: boolean }).hasMany
    );

    if (relationFields.length === 0) {
      return "";
    }

    // Use single_ prefix for export name
    const exportName = `single_${single.slug.replace(/-/g, "_")}`;
    const relationsName = `${exportName}Relations`;

    const lines: string[] = [];
    lines.push("");
    lines.push(`/**`);
    lines.push(` * ${single.label} relations.`);
    lines.push(` *`);
    lines.push(` * @generated by Nextly SchemaGenerator`);
    lines.push(` */`);
    lines.push(
      `export const ${relationsName} = relations(${exportName}, ({ one }) => ({`
    );

    for (const field of relationFields) {
      if (!isDataField(field)) continue;

      // Skip fields without names
      if (!("name" in field) || !field.name) continue;

      const relationTo = (field as { relationTo?: string | string[] })
        .relationTo;
      if (typeof relationTo !== "string") continue;

      // Relationships from Singles point to collections (dc_ prefix)
      const targetTable = `dc_${relationTo.replace(/-/g, "_")}`;
      const fieldName = field.name;

      lines.push(`  ${fieldName}: one(${targetTable}, {`);
      lines.push(`    fields: [${exportName}.${fieldName}],`);
      lines.push(`    references: [${targetTable}.id],`);
      lines.push(`  }),`);
    }

    lines.push(`}));`);

    return lines.join("\n");
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Converts a slug to a valid JavaScript variable name.
   * e.g., "blog-posts" -> "blogPosts"
   */
  private toVariableName(slug: string): string {
    return slug
      .split(/[-_]/)
      .map((part, index) =>
        index === 0
          ? part.toLowerCase()
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      )
      .join("");
  }

  /**
   * Converts a camelCase name to snake_case.
   * e.g., "createdAt" -> "created_at"
   */
  private toSnakeCase(name: string): string {
    return name
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "");
  }
}
