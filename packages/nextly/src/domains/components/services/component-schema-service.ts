/**
 * ComponentSchemaService generates database schemas for component data tables (`comp_{slug}`).
 * Supports PostgreSQL, MySQL, and SQLite dialects.
 */

import {
  mysqlTable,
  text as mysqlText,
  int as mysqlInt,
  boolean as mysqlBoolean,
  timestamp as mysqlTimestamp,
  json as mysqlJson,
  varchar as mysqlVarchar,
  double as mysqlDouble,
  index as mysqlIndex,
} from "drizzle-orm/mysql-core";
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
  boolean as pgBoolean,
  timestamp as pgTimestamp,
  jsonb as pgJsonb,
  varchar as pgVarchar,
  doublePrecision as pgDoublePrecision,
  index as pgIndex,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
  index as sqliteIndex,
} from "drizzle-orm/sqlite-core";

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
  isComponentField,
  isDataField,
} from "../../../collections/fields/guards";
import type {
  FieldConfig,
  DataFieldConfig,
} from "../../../collections/fields/types";
import { env } from "../../../lib/env";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

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

const QUOTE_CHAR: Record<SupportedDialect, string> = {
  postgresql: '"',
  mysql: "`",
  sqlite: '"',
};

const TIMESTAMP_DEFAULT: Record<SupportedDialect, string> = {
  postgresql: "DEFAULT NOW()",
  mysql: "DEFAULT CURRENT_TIMESTAMP",
  sqlite: "DEFAULT (strftime('%s', 'now'))",
};

export class ComponentSchemaService {
  private readonly dialect: SupportedDialect;
  private readonly q: string;

  constructor(dialect?: SupportedDialect) {
    this.dialect =
      dialect || (env.DB_DIALECT as SupportedDialect) || "postgresql";
    this.q = QUOTE_CHAR[this.dialect];
  }

  /**
   * Generate SQL migration for creating a new component data table.
   */
  generateMigrationSQL(tableName: string, fields: FieldConfig[]): string {
    const types = SQL_COLUMN_TYPES[this.dialect];
    const tsDefault = TIMESTAMP_DEFAULT[this.dialect];

    const lines: string[] = [];
    lines.push(`-- Create component data table: ${tableName}`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${this.q}${tableName}${this.q} (`);

    if (this.dialect === "mysql") {
      lines.push(`  ${this.q}id${this.q} varchar(36) PRIMARY KEY NOT NULL,`);
    } else {
      lines.push(`  ${this.q}id${this.q} text PRIMARY KEY NOT NULL,`);
    }

    if (this.dialect === "mysql") {
      lines.push(`  ${this.q}_parent_id${this.q} varchar(36) NOT NULL,`);
    } else {
      lines.push(`  ${this.q}_parent_id${this.q} text NOT NULL,`);
    }
    lines.push(
      `  ${this.q}_parent_table${this.q} ${types.varchar(255)} NOT NULL,`
    );
    lines.push(
      `  ${this.q}_parent_field${this.q} ${types.varchar(255)} NOT NULL,`
    );
    lines.push(`  ${this.q}_order${this.q} ${types.integer} DEFAULT 0,`);
    lines.push(`  ${this.q}_component_type${this.q} ${types.varchar(255)},`);

    for (const field of fields) {
      if (!isDataField(field)) continue;
      // Skip component fields — data lives in the referenced component's table.
      if (isComponentField(field)) continue;

      const columnSQL = this.generateColumnSQL(field);
      if (columnSQL) {
        lines.push(`  ${columnSQL},`);
      }
    }

    lines.push(
      `  ${this.q}created_at${this.q} ${types.timestamp} NOT NULL ${tsDefault},`
    );
    lines.push(
      `  ${this.q}updated_at${this.q} ${types.timestamp} NOT NULL ${tsDefault}`
    );

    lines.push(");");

    let sql = lines.join("\n");

    const indexStatements: string[] = [];

    const parentIndexName = `idx_${tableName}_parent`;
    const parentColumns = [
      `${this.q}_parent_id${this.q}`,
      `${this.q}_parent_table${this.q}`,
      `${this.q}_parent_field${this.q}`,
    ].join(", ");

    if (this.dialect === "mysql") {
      indexStatements.push(
        `CREATE INDEX ${this.q}${parentIndexName}${this.q} ON ${this.q}${tableName}${this.q}(${parentColumns});`
      );
    } else {
      indexStatements.push(
        `CREATE INDEX IF NOT EXISTS ${this.q}${parentIndexName}${this.q} ON ${this.q}${tableName}${this.q}(${parentColumns});`
      );
    }

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      if (!this.fieldHasForeignKey(field)) continue;

      const columnName = this.toSnakeCase(field.name);
      const indexName = `idx_${tableName}_${columnName}`;

      if (this.dialect === "mysql") {
        indexStatements.push(
          `CREATE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
        );
      } else {
        indexStatements.push(
          `CREATE INDEX IF NOT EXISTS ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
        );
      }
    }

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      if (!("index" in field && field.index)) continue;
      if (this.fieldHasForeignKey(field)) continue;

      const columnName = this.toSnakeCase(field.name);
      const indexName = `idx_${tableName}_${columnName}`;

      if (this.dialect === "mysql") {
        indexStatements.push(
          `CREATE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
        );
      } else {
        indexStatements.push(
          `CREATE INDEX IF NOT EXISTS ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
        );
      }
    }

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      if (!("unique" in field && field.unique)) continue;

      const columnName = this.toSnakeCase(field.name);
      const indexName = `uq_${tableName}_${columnName}`;

      if (this.dialect === "mysql") {
        indexStatements.push(
          `CREATE UNIQUE INDEX ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
        );
      } else {
        indexStatements.push(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${this.q}${indexName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
        );
      }
    }

    if (indexStatements.length > 0) {
      sql += "\n--> statement-breakpoint\n";
      sql += indexStatements.join("\n--> statement-breakpoint\n");
    }

    return sql;
  }

  /**
   * Generate ALTER TABLE migration for updating a component data table.
   */
  generateAlterTableMigration(
    tableName: string,
    oldFields: FieldConfig[],
    newFields: FieldConfig[]
  ): string {
    const statements: string[] = [
      `-- Update component data table: ${tableName}`,
    ];

    const oldFieldMap = this.buildFieldMap(oldFields);
    const newFieldMap = this.buildFieldMap(newFields);

    for (const [name, field] of newFieldMap) {
      if (oldFieldMap.has(name)) continue;

      const columnType = this.getColumnType(field);
      if (!columnType) continue;

      const columnName = this.toSnakeCase(name);
      const nullable = "required" in field && field.required ? "NOT NULL" : "";

      // When adding NOT NULL columns to existing tables, provide a sensible default.
      let defaultVal = "";
      if ("defaultValue" in field && field.defaultValue !== undefined) {
        defaultVal = `DEFAULT ${this.formatDefaultValue(field.defaultValue, field.type)}`;
      } else if ("required" in field && field.required) {
        defaultVal = `DEFAULT ${this.getDefaultValueForType(field.type)}`;
      }

      statements.push(
        `ALTER TABLE ${this.q}${tableName}${this.q} ADD COLUMN ${this.q}${columnName}${this.q} ${columnType} ${nullable} ${defaultVal};`.trim()
      );

      if ("unique" in field && field.unique) {
        if (this.dialect === "sqlite") {
          statements.push(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${this.q}uq_${tableName}_${columnName}${this.q} ON ${this.q}${tableName}${this.q}(${this.q}${columnName}${this.q});`
          );
        } else {
          statements.push(
            `ALTER TABLE ${this.q}${tableName}${this.q} ADD CONSTRAINT ${this.q}uq_${tableName}_${columnName}${this.q} UNIQUE (${this.q}${columnName}${this.q});`
          );
        }
      }
    }

    for (const [name] of oldFieldMap) {
      if (newFieldMap.has(name)) continue;

      const columnName = this.toSnakeCase(name);
      if (this.dialect === "sqlite") {
        statements.push(
          `ALTER TABLE ${this.q}${tableName}${this.q} DROP COLUMN ${this.q}${columnName}${this.q};`
        );
      } else {
        statements.push(
          `ALTER TABLE ${this.q}${tableName}${this.q} DROP COLUMN IF EXISTS ${this.q}${columnName}${this.q};`
        );
      }
    }

    // SQLite doesn't support ALTER COLUMN, so skip modification detection there.
    if (this.dialect !== "sqlite") {
      for (const [name, newField] of newFieldMap) {
        const oldField = oldFieldMap.get(name);
        if (!oldField) continue;
        if (!this.isFieldModified(oldField, newField)) continue;

        const columnName = this.toSnakeCase(name);
        const newType = this.getColumnType(newField);
        if (!newType) continue;

        statements.push(
          `ALTER TABLE ${this.q}${tableName}${this.q} ALTER COLUMN ${this.q}${columnName}${this.q} TYPE ${newType};`
        );

        const oldRequired = "required" in oldField && oldField.required;
        const newRequired = "required" in newField && newField.required;

        if (oldRequired !== newRequired) {
          if (newRequired) {
            statements.push(
              `ALTER TABLE ${this.q}${tableName}${this.q} ALTER COLUMN ${this.q}${columnName}${this.q} SET NOT NULL;`
            );
          } else {
            statements.push(
              `ALTER TABLE ${this.q}${tableName}${this.q} ALTER COLUMN ${this.q}${columnName}${this.q} DROP NOT NULL;`
            );
          }
        }
      }
    }

    return statements.join("\n--> statement-breakpoint\n");
  }

  /**
   * Generate DROP TABLE migration for a component data table.
   */
  generateDropTableMigration(tableName: string): {
    migrationSQL: string;
    migrationFileName: string;
  } {
    const dropStatement =
      this.dialect === "sqlite"
        ? `DROP TABLE IF EXISTS ${this.q}${tableName}${this.q};`
        : `DROP TABLE IF EXISTS ${this.q}${tableName}${this.q} CASCADE;`;

    const componentSlug = tableName.replace(/^comp_/, "");
    const migrationSQL = `-- Drop component data table: ${tableName}\n${dropStatement}`;

    return {
      migrationSQL,
      migrationFileName: `${Date.now()}_drop_comp_${componentSlug}.sql`,
    };
  }

  /**
   * Generate a Drizzle table object at runtime for querying component data.
   */
  // Returns an opaque Drizzle table object (PgTable | MySqlTable | SQLiteTable).
  // Typed as `unknown` because the column shape is dynamic at compile time;
  // callers cast at the use site.
  generateRuntimeSchema(tableName: string, fields: FieldConfig[]): unknown {
    switch (this.dialect) {
      case "postgresql":
        return this.generatePostgresSchema(tableName, fields);
      case "mysql":
        return this.generateMySQLSchema(tableName, fields);
      case "sqlite":
        return this.generateSQLiteSchema(tableName, fields);
      default:
        throw new Error(`Unsupported dialect: ${this.dialect}`);
    }
  }

  private generatePostgresSchema(
    tableName: string,
    fields: FieldConfig[]
  ): unknown {
    // Required by Drizzle: pgTable() expects a `Record<string, PgColumnBuilderBase>`
    // but the column builders returned by helpers (pgText, pgInteger, ...) have
    // deeply nested generic types. Using `unknown` here keeps the call site clean
    // and doesn't leak Drizzle internals into the public API.
    const columns: Record<string, unknown> = {
      id: pgText("id").primaryKey(),
      _parent_id: pgText("_parent_id").notNull(),
      _parent_table: pgVarchar("_parent_table", { length: 255 }).notNull(),
      _parent_field: pgVarchar("_parent_field", { length: 255 }).notNull(),
      _order: pgInteger("_order").default(0),
      _component_type: pgVarchar("_component_type", { length: 255 }),
      created_at: pgTimestamp("created_at").defaultNow().notNull(),
      updated_at: pgTimestamp("updated_at").defaultNow().notNull(),
    };

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToPostgresColumn(field);
      if (column) {
        columns[field.name] = column;
      }
    }

    // Required by Drizzle: pgTable() is generic over the column shape, and
    // our columns map is dynamic (Record<string, unknown>). The index
    // callback's `table` arg would normally be inferred from that shape;
    // we cast to a typed indexer so Drizzle's fluent API still works.
    return pgTable(
      tableName,
      columns as Record<string, never>,
       
      (table: any) => ({
        parentIdx: pgIndex(`idx_${tableName}_parent`).on(
          table._parent_id,
          table._parent_table,
          table._parent_field
        ),
      })
    );
  }

  private generateMySQLSchema(
    tableName: string,
    fields: FieldConfig[]
  ): unknown {
    const columns: Record<string, unknown> = {
      id: mysqlVarchar("id", { length: 36 }).primaryKey(),
      _parent_id: mysqlVarchar("_parent_id", { length: 36 }).notNull(),
      _parent_table: mysqlVarchar("_parent_table", { length: 255 }).notNull(),
      _parent_field: mysqlVarchar("_parent_field", { length: 255 }).notNull(),
      _order: mysqlInt("_order").default(0),
      _component_type: mysqlVarchar("_component_type", { length: 255 }),
      created_at: mysqlTimestamp("created_at").defaultNow().notNull(),
      updated_at: mysqlTimestamp("updated_at").defaultNow().notNull(),
    };

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToMySQLColumn(field);
      if (column) {
        columns[field.name] = column;
      }
    }

    return mysqlTable(
      tableName,
      columns as Record<string, never>,
       
      (table: any) => ({
        parentIdx: mysqlIndex(`idx_${tableName}_parent`).on(
          table._parent_id,
          table._parent_table,
          table._parent_field
        ),
      })
    );
  }

  private generateSQLiteSchema(
    tableName: string,
    fields: FieldConfig[]
  ): unknown {
    const columns: Record<string, unknown> = {
      id: sqliteText("id").primaryKey(),
      _parent_id: sqliteText("_parent_id").notNull(),
      _parent_table: sqliteText("_parent_table").notNull(),
      _parent_field: sqliteText("_parent_field").notNull(),
      _order: sqliteInteger("_order").default(0),
      _component_type: sqliteText("_component_type"),
      created_at: sqliteInteger("created_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date()),
      updated_at: sqliteInteger("updated_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date()),
    };

    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToSQLiteColumn(field);
      if (column) {
        columns[field.name] = column;
      }
    }

    return sqliteTable(
      tableName,
      columns as Record<string, never>,
       
      (table: any) => ({
        parentIdx: sqliteIndex(`idx_${tableName}_parent`).on(
          table._parent_id,
          table._parent_table,
          table._parent_field
        ),
      })
    );
  }

  /**
   * Generate TypeScript/Drizzle schema code for a component data table.
   */
  generateSchemaCode(
    tableName: string,
    componentSlug: string,
    fields: FieldConfig[]
  ): string {
    const dialectConfig = this.getDialectConfig();

    const baseImports = this.collectRequiredImports(fields);

    const imports = `import { ${dialectConfig.tableFunction}, ${baseImports.join(", ")} } from '${dialectConfig.importPath}';`;

    const fieldColumns = fields
      .filter(
        (f): f is DataFieldConfig => isDataField(f) && !isComponentField(f)
      )
      .map(f => {
        const drizzleType = this.mapFieldToDrizzleCode(f);
        const modifiers: string[] = [];

        if ("required" in f && f.required) modifiers.push(".notNull()");
        if ("unique" in f && f.unique) modifiers.push(".unique()");

        const defaultValue = "defaultValue" in f ? f.defaultValue : undefined;
        if (defaultValue !== undefined && defaultValue !== null) {
          if (
            f.type === "json" ||
            f.type === "repeater" ||
            f.type === "group"
          ) {
            modifiers.push(`.default(${JSON.stringify(defaultValue)})`);
          } else if (typeof defaultValue === "string") {
            modifiers.push(`.default('${defaultValue}')`);
          } else {
            modifiers.push(`.default(${defaultValue})`);
          }
        }

        return `  ${f.name}: ${drizzleType}${modifiers.join("")},`;
      })
      .join("\n");

    const timestampColumns = this.generateTimestampColumnsCode();

    const fieldIndexes = fields
      .filter(
        (f): f is DataFieldConfig => isDataField(f) && !isComponentField(f)
      )
      .filter(
        (f): f is DataFieldConfig & { name: string } =>
          !!f.name &&
          !!(("index" in f && f.index) || this.fieldHasForeignKey(f))
      )
      .map(
        f =>
          `  ${f.name}Idx: index('idx_${tableName}_${this.toSnakeCase(f.name)}').on(table.${f.name}),`
      )
      .join("\n");

    const allIndexes = fieldIndexes
      ? `  parentIdx: index('idx_${tableName}_parent').on(table._parent_id, table._parent_table, table._parent_field),\n${fieldIndexes}`
      : `  parentIdx: index('idx_${tableName}_parent').on(table._parent_id, table._parent_table, table._parent_field),`;

    const baseColumnsCode = this.generateBaseColumnsCode();

    return `${imports}

/**
 * Component data table: ${componentSlug}
 * Generated by nextly
 */
export const ${tableName} = ${dialectConfig.tableFunction}('${tableName}', {
${baseColumnsCode}
${fieldColumns}
${timestampColumns}
}, (table) => ({
${allIndexes}
}));

export type ${this.toPascalCase(componentSlug)}Component = typeof ${tableName}.$inferSelect;
export type New${this.toPascalCase(componentSlug)}Component = typeof ${tableName}.$inferInsert;
`;
  }

  private generateColumnSQL(field: DataFieldConfig): string | null {
    if (!("name" in field) || !field.name) return null;

    const columnName = this.toSnakeCase(field.name);
    const columnType = this.getColumnType(field);
    if (!columnType) return null;

    const parts = [`${this.q}${columnName}${this.q}`, columnType];

    if ("required" in field && field.required) {
      parts.push("NOT NULL");
    }

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

  private getColumnType(field: DataFieldConfig): string | null {
    const types = SQL_COLUMN_TYPES[this.dialect];

    if (isTextField(field)) {
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

    return null;
  }

  // Returns a Drizzle column builder — typed as `unknown` to avoid
  // depending on Drizzle's internal column builder types from the public API.
  private mapFieldToPostgresColumn(field: DataFieldConfig): unknown {
    if (!("name" in field) || !field.name) return null;
    const isRequired = "required" in field && field.required === true;
    const colName = this.toSnakeCase(field.name);

    if (isTextField(field) || isEmailField(field) || isPasswordField(field)) {
      return isRequired ? pgText(colName).notNull() : pgText(colName);
    }
    if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
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
    if (isSelectField(field) || isRadioField(field)) {
      return isRequired ? pgText(colName).notNull() : pgText(colName);
    }
    if (isRelationshipField(field) || isUploadField(field)) {
      return pgText(colName);
    }
    if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
      return isRequired ? pgJsonb(colName).notNull() : pgJsonb(colName);
    }

    return pgText(colName);
  }

  private mapFieldToMySQLColumn(field: DataFieldConfig): unknown {
    if (!("name" in field) || !field.name) return null;
    const isRequired = "required" in field && field.required === true;
    const colName = this.toSnakeCase(field.name);

    if (isTextField(field) || isEmailField(field) || isPasswordField(field)) {
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });
    }
    if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
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
    if (isSelectField(field) || isRadioField(field)) {
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });
    }
    if (isRelationshipField(field) || isUploadField(field)) {
      return mysqlVarchar(colName, { length: 36 });
    }
    if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
      return isRequired ? mysqlJson(colName).notNull() : mysqlJson(colName);
    }

    return mysqlVarchar(colName, { length: 255 });
  }

  private mapFieldToSQLiteColumn(field: DataFieldConfig): unknown {
    if (!("name" in field) || !field.name) return null;
    const isRequired = "required" in field && field.required === true;
    const colName = this.toSnakeCase(field.name);

    if (
      isTextField(field) ||
      isEmailField(field) ||
      isPasswordField(field) ||
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field) ||
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
    if (isRelationshipField(field) || isUploadField(field)) {
      return sqliteText(colName);
    }
    if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
      return isRequired ? sqliteText(colName).notNull() : sqliteText(colName);
    }

    return sqliteText(colName);
  }

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
    if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
      return `text('${colName}')`;
    }
    if (isEmailField(field) || isPasswordField(field)) {
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
    if (isSelectField(field) || isRadioField(field)) {
      return `text('${colName}')`;
    }
    if (isRelationshipField(field) || isUploadField(field)) {
      return `text('${colName}')`;
    }
    if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
      return `jsonb('${colName}')`;
    }
    return `text('${colName}')`;
  }

  private mapFieldToMySQLCode(field: DataFieldConfig, colName: string): string {
    if (
      isTextField(field) ||
      isEmailField(field) ||
      isPasswordField(field) ||
      isSelectField(field) ||
      isRadioField(field)
    ) {
      return `varchar('${colName}', { length: 255 })`;
    }
    if (
      isTextareaField(field) ||
      isRichTextField(field) ||
      isCodeField(field)
    ) {
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
    if (isRelationshipField(field) || isUploadField(field)) {
      return `varchar('${colName}', { length: 36 })`;
    }
    if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
      return `json('${colName}')`;
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

  private collectRequiredImports(fields: FieldConfig[]): string[] {
    const imports = new Set<string>(["text", "index"]);

    if (this.dialect === "sqlite") {
      imports.add("integer");
      imports.add("real");
    } else {
      imports.add("varchar");
      imports.add("integer");
      imports.add("timestamp");
    }

    for (const field of fields) {
      if (!isDataField(field) || isComponentField(field)) continue;

      if (this.dialect === "sqlite") {
        if (isNumberField(field)) imports.add("real");
        if (isCheckboxField(field)) imports.add("integer");
        if (isDateField(field)) imports.add("integer");
      } else if (this.dialect === "mysql") {
        if (
          isTextField(field) ||
          isEmailField(field) ||
          isPasswordField(field) ||
          isSelectField(field) ||
          isRadioField(field) ||
          isRelationshipField(field) ||
          isUploadField(field)
        ) {
          imports.add("varchar");
        }
        if (isNumberField(field)) imports.add("double");
        if (isCheckboxField(field)) imports.add("boolean");
        if (isDateField(field)) imports.add("timestamp");
        if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
          imports.add("json");
        }
      } else {
        if (
          isTextField(field) ||
          isEmailField(field) ||
          isPasswordField(field)
        ) {
          if (isTextField(field) && field.maxLength) {
            imports.add("varchar");
          }
        }
        if (isNumberField(field)) imports.add("doublePrecision");
        if (isCheckboxField(field)) imports.add("boolean");
        if (isDateField(field)) imports.add("timestamp");
        if (isArrayField(field) || isGroupField(field) || isJSONField(field)) {
          imports.add("jsonb");
        }
      }
    }

    return Array.from(imports);
  }

  private generateBaseColumnsCode(): string {
    if (this.dialect === "sqlite") {
      return `  id: text('id').primaryKey().notNull(),
  _parent_id: text('_parent_id').notNull(),
  _parent_table: text('_parent_table').notNull(),
  _parent_field: text('_parent_field').notNull(),
  _order: integer('_order').default(0),
  _component_type: text('_component_type'),`;
    }

    if (this.dialect === "mysql") {
      return `  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  _parent_id: varchar('_parent_id', { length: 36 }).notNull(),
  _parent_table: varchar('_parent_table', { length: 255 }).notNull(),
  _parent_field: varchar('_parent_field', { length: 255 }).notNull(),
  _order: integer('_order').default(0),
  _component_type: varchar('_component_type', { length: 255 }),`;
    }

    return `  id: text('id').primaryKey().notNull(),
  _parent_id: text('_parent_id').notNull(),
  _parent_table: varchar('_parent_table', { length: 255 }).notNull(),
  _parent_field: varchar('_parent_field', { length: 255 }).notNull(),
  _order: integer('_order').default(0),
  _component_type: varchar('_component_type', { length: 255 }),`;
  }

  private generateTimestampColumnsCode(): string {
    if (this.dialect === "sqlite") {
      return `  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),`;
    }

    return `  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),`;
  }

  private fieldHasForeignKey(field: DataFieldConfig): boolean {
    if (!isRelationshipField(field) && !isUploadField(field)) return false;
    return (
      !Array.isArray(field.relationTo) &&
      !field.hasMany &&
      typeof field.relationTo === "string"
    );
  }

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

    if (
      (isSelectField(oldField) && isSelectField(newField)) ||
      (isRelationshipField(oldField) && isRelationshipField(newField)) ||
      (isUploadField(oldField) && isUploadField(newField))
    ) {
      if (oldField.hasMany !== newField.hasMany) return true;
    }

    return false;
  }

  private buildFieldMap(fields: FieldConfig[]): Map<string, DataFieldConfig> {
    const map = new Map<string, DataFieldConfig>();
    for (const field of fields) {
      if (!isDataField(field)) continue;
      if (isComponentField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      map.set(field.name, field);
    }
    return map;
  }

  // Used when adding NOT NULL columns to existing tables.
  private getDefaultValueForType(type: string): string {
    switch (type) {
      case "text":
      case "textarea":
      case "email":
      case "password":
      case "richText":
      case "code":
      case "select":
      case "radio":
        return "''";
      case "number":
        return "0";
      case "checkbox":
      case "boolean":
        return this.dialect === "sqlite" ? "0" : "FALSE";
      case "date":
        if (this.dialect === "sqlite") {
          return String(Math.floor(Date.now() / 1000));
        }
        return "NOW()";
      case "json":
      case "repeater":
      case "group":
        return "'{}'";
      case "relationship":
      case "upload":
        return "NULL";
      default:
        return "''";
    }
  }

  private formatDefaultValue(value: unknown, type: string): string {
    if (
      type === "text" ||
      type === "textarea" ||
      type === "email" ||
      type === "password" ||
      type === "richText" ||
      type === "code" ||
      type === "select" ||
      type === "radio"
    ) {
      return `'${value}'`;
    }
    if (type === "checkbox") {
      if (this.dialect === "sqlite") return value ? "1" : "0";
      return value ? "TRUE" : "FALSE";
    }
    if (type === "json" || type === "repeater" || type === "group") {
      return `'${typeof value === "string" ? value : JSON.stringify(value)}'`;
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

  private toPascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }
}
