/**
 * FieldGroupSchemaService generates database schemas for component data tables (`comp_{slug}`).
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
  decimal as mysqlDecimal,
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
  numeric as pgNumeric,
  index as pgIndex,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
  numeric as sqliteNumeric,
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
  isRepeaterField,
  isGroupField,
  isJSONField,
  isFieldGroupField,
  isDataField,
} from "../../../collections/fields/guards";
import type {
  FieldConfig,
  DataFieldConfig,
  NumberFieldConfig,
} from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import { env } from "../../../lib/env";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { pluginEmptyColumnDefault } from "../../../shared/lib/plugin-storage";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import {
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
} from "../../schema/services/field-column-descriptor";
import { uniquenessCanBeAnIndex } from "../../schema/services/index-name";
import {
  isPluginDataField,
  pluginStorageFieldType,
} from "../../schema/services/plugin-codegen";
import { quoteJsonSqlDefault } from "../../schema/utils/sql-literal";

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
    decimal: (precision: number, scale: number) => string;
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
    // float8, matching the `doublePrecision` column the runtime and the
    // generated Drizzle schema build for this field. Emitting REAL (float4)
    // here instead would create a table that never converges: every later diff
    // would see live float4 against desired float8 and try to alter it again.
    real: "DOUBLE PRECISION",
    decimal: (precision: number, scale: number) =>
      `NUMERIC(${precision}, ${scale})`,
    timestamp: "TIMESTAMP",
    json: "JSONB",
  },
  mysql: {
    uuid: "VARCHAR(36)",
    text: "TEXT",
    varchar: (length: number) => `VARCHAR(${length})`,
    boolean: "BOOLEAN",
    integer: "INT",
    real: "DOUBLE",
    decimal: (precision: number, scale: number) =>
      `DECIMAL(${precision}, ${scale})`,
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
    // SQLite has no fixed-precision decimal type; a NUMERIC column carries
    // NUMERIC affinity and stores the value best-effort.
    decimal: () => "NUMERIC",
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

/**
 * What `generateRuntimeSchema` needs beyond the fields.
 *
 * `typeColumn` is required rather than defaulted. The storage migration renames
 * the discriminator, so the right physical name is a property of the database in
 * front of us, and a default would let a call site that never learned to resolve
 * it compile and then silently project a column that is not there. Required
 * makes the type checker the completeness proof. Callers supply either the
 * resolved name from the catalog or, for a table this process just created,
 * `STORAGE_FORMAT.columns.type` — the same constant the DDL just wrote.
 */
export interface RuntimeSchemaOptions {
  localized?: boolean;
  typeColumn: string;
}

export class FieldGroupSchemaService {
  private readonly dialect: SupportedDialect;
  private readonly q: string;

  constructor(dialect?: SupportedDialect) {
    this.dialect = dialect || env.DB_DIALECT || "postgresql";
    this.q = QUOTE_CHAR[this.dialect];
  }

  /**
   * Generate SQL migration for creating a new component data table.
   */
  generateMigrationSQL(
    tableName: string,
    fields: FieldConfig[],
    options: { localized?: boolean } = {}
  ): string {
    const types = SQL_COLUMN_TYPES[this.dialect];
    const tsDefault = TIMESTAMP_DEFAULT[this.dialect];
    // i18n: a localized component omits its translatable columns from the main comp_ CREATE
    // (they live in the companion `comp_<slug>_locales` table, provisioned out-of-band).
    const localizedNames = options.localized
      ? new Set(
          resolveLocalizedFieldNames(
            fields as unknown as Parameters<
              typeof resolveLocalizedFieldNames
            >[0],
            true
          )
        )
      : new Set<string>();

    const lines: string[] = [];
    lines.push(`-- Create component data table: ${tableName}`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${this.q}${tableName}${this.q} (`);

    if (this.dialect === "mysql") {
      lines.push(`  ${this.q}id${this.q} varchar(36) PRIMARY KEY NOT NULL,`);
    } else {
      lines.push(`  ${this.q}id${this.q} text PRIMARY KEY NOT NULL,`);
    }

    if (this.dialect === "mysql") {
      lines.push(
        `  ${this.q}${STORAGE_FORMAT.columns.parentId}${this.q} varchar(36) NOT NULL,`
      );
    } else {
      lines.push(
        `  ${this.q}${STORAGE_FORMAT.columns.parentId}${this.q} text NOT NULL,`
      );
    }
    lines.push(
      `  ${this.q}${STORAGE_FORMAT.columns.parentTable}${this.q} ${types.varchar(255)} NOT NULL,`
    );
    lines.push(
      `  ${this.q}${STORAGE_FORMAT.columns.parentField}${this.q} ${types.varchar(255)} NOT NULL,`
    );
    lines.push(
      `  ${this.q}${STORAGE_FORMAT.columns.order}${this.q} ${types.integer} DEFAULT 0,`
    );
    lines.push(
      `  ${this.q}${STORAGE_FORMAT.columns.type}${this.q} ${types.varchar(255)},`
    );

    for (const field of fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      // Skip component fields — data lives in the referenced component's table.
      if (isFieldGroupField(field)) continue;
      // i18n: translatable columns live in the companion, not the main comp_ table.
      if ("name" in field && field.name && localizedNames.has(field.name)) {
        continue;
      }

      const columnSQL = this.generateColumnSQL(this.asMappableField(field));
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

    const parentIndexName = `${STORAGE_FORMAT.indexPrefix}${tableName}_parent`;
    const parentColumns = [
      `${this.q}${STORAGE_FORMAT.columns.parentId}${this.q}`,
      `${this.q}${STORAGE_FORMAT.columns.parentTable}${this.q}`,
      `${this.q}${STORAGE_FORMAT.columns.parentField}${this.q}`,
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
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      // Localized fields live in the companion, not the main comp_ table — no main index.
      if (localizedNames.has(field.name)) continue;
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
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      // Localized fields live in the companion, not the main comp_ table — no main index.
      if (localizedNames.has(field.name)) continue;
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
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      // Localized fields live in the companion, not the main comp_ table — no main index.
      if (localizedNames.has(field.name)) continue;
      if (!("unique" in field && field.unique)) continue;

      const columnName = this.toSnakeCase(field.name);
      const indexName = `uq_${tableName}_${columnName}`;

      // Asked through the same rule the collection generators and the desired schema use. A
      // dialect that cannot key the column cannot carry the uniqueness as an index, and emitting
      // one anyway installs the table and then fails on a statement it has already committed
      // past — leaving a component without the guarantee it declared.
      this.assertUniquenessEnforceable(field, tableName);

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

      // Mapped once and reused: the default formatting and the type default
      // both switch on `type`, so reading the raw plugin token there would
      // produce a literal for a type the column does not have.
      const mapped = this.asMappableField(field);
      const columnType = this.getColumnType(mapped);
      if (!columnType) continue;

      const columnName = this.toSnakeCase(name);
      const nullable = "required" in field && field.required ? "NOT NULL" : "";

      // When adding NOT NULL columns to existing tables, provide a sensible default.
      let defaultVal = "";
      // A function default produces a different value per row, which a single
      // DDL constant cannot express. Backfilling existing rows still needs
      // something, so a required column falls back to its type default rather
      // than trying to serialize the function itself.
      const hasConstantDefault =
        "defaultValue" in field &&
        field.defaultValue !== undefined &&
        typeof field.defaultValue !== "function";
      if (hasConstantDefault) {
        defaultVal = `DEFAULT ${this.formatDefaultValue(field.defaultValue, mapped.type)}`;
      } else if ("required" in field && field.required) {
        // The MAPPED type drives the switch and the ORIGINAL field carries the
        // declared token: a contributed type states its own empty value under
        // its own name, and `mapped` has already replaced that with the storage
        // primitive.
        defaultVal = `DEFAULT ${this.getDefaultValueForType(mapped.type, field)}`;
      }

      // Refused BEFORE the column statement, not after it. MySQL commits each DDL statement on
      // its own, so adding the column and then failing on its constraint leaves the column in
      // place without the guarantee — and a bare column is what the desired schema declares for
      // an unkeyable type, so the next reconcile sees nothing to fix.
      if ("unique" in field && field.unique) {
        this.assertUniquenessEnforceable(field, tableName);
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
        // Mapped like the added-column path: a field changed to a plugin type
        // would otherwise resolve no type here and the ALTER would be skipped,
        // leaving the column as whatever it was.
        const newType = this.getColumnType(this.asMappableField(newField));
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

    const componentSlug = tableName.startsWith(STORAGE_FORMAT.tablePrefix)
      ? tableName.slice(STORAGE_FORMAT.tablePrefix.length)
      : tableName;
    const migrationSQL = `-- Drop component data table: ${tableName}\n${dropStatement}`;

    return {
      migrationSQL,
      migrationFileName: `${Date.now()}_drop_${STORAGE_FORMAT.tablePrefix}${componentSlug}.sql`,
    };
  }

  /**
   * Generate a Drizzle table object at runtime for querying component data.
   */
  // Returns an opaque Drizzle table object (PgTable | MySqlTable | SQLiteTable).
  // Typed as `unknown` because the column shape is dynamic at compile time;
  // callers cast at the use site.
  generateRuntimeSchema(
    tableName: string,
    fields: FieldConfig[],
    options: RuntimeSchemaOptions
  ): unknown {
    // i18n: when the component is localized, its translatable fields live in the
    // companion `comp_<slug>_locales` table and are omitted from the main runtime
    // table — kept in lockstep with buildDesiredTableFromComponentFields' `localized`
    // option so the diff and the DDL agree.
    const localizedNames = options.localized
      ? new Set(
          resolveLocalizedFieldNames(
            fields as unknown as Parameters<
              typeof resolveLocalizedFieldNames
            >[0],
            true
          )
        )
      : new Set<string>();
    const mainFields = fields.filter(f => {
      const name = "name" in f ? (f as { name?: string }).name : undefined;
      return !name || !localizedNames.has(name);
    });
    const typeColumn = options.typeColumn;
    switch (this.dialect) {
      case "postgresql":
        return this.generatePostgresSchema(tableName, mainFields, typeColumn);
      case "mysql":
        return this.generateMySQLSchema(tableName, mainFields, typeColumn);
      case "sqlite":
        return this.generateSQLiteSchema(tableName, mainFields, typeColumn);
      default:
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  private generatePostgresSchema(
    tableName: string,
    fields: FieldConfig[],
    typeColumn: string
  ): unknown {
    // Required by Drizzle: pgTable() expects a `Record<string, PgColumnBuilderBase>`
    // but the column builders returned by helpers (pgText, pgInteger, ...) have
    // deeply nested generic types. Using `unknown` here keeps the call site clean
    // and doesn't leak Drizzle internals into the public API.
    const columns: Record<string, unknown> = {
      id: pgText("id").primaryKey(),
      _parent_id: pgText(STORAGE_FORMAT.columns.parentId).notNull(),
      _parent_table: pgVarchar(STORAGE_FORMAT.columns.parentTable, {
        length: 255,
      }).notNull(),
      _parent_field: pgVarchar(STORAGE_FORMAT.columns.parentField, {
        length: 255,
      }).notNull(),
      _order: pgInteger(STORAGE_FORMAT.columns.order).default(0),
      // 🔴 The Drizzle property key stays `STORAGE_FORMAT.columns.type` while the
      // physical name is resolved. The adapter addresses columns by property key
      // everywhere — rows come back keyed by it, `buildDrizzleWhere` and
      // `orderBy` look columns up by it — so every consumer downstream reads the
      // same key whichever spelling the storage carries, and keeps reading it
      // when the constant itself moves.
      [STORAGE_FORMAT.columns.type]: pgVarchar(typeColumn, { length: 255 }),
      created_at: pgTimestamp("created_at").defaultNow().notNull(),
      updated_at: pgTimestamp("updated_at").defaultNow().notNull(),
    };

    for (const field of fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToPostgresColumn(this.asMappableField(field));
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle table column accessor is dialect-typed
      (table: any) => ({
        parentIdx: pgIndex(
          `${STORAGE_FORMAT.indexPrefix}${tableName}_parent`
        ).on(table._parent_id, table._parent_table, table._parent_field),
      })
    );
  }

  private generateMySQLSchema(
    tableName: string,
    fields: FieldConfig[],
    typeColumn: string
  ): unknown {
    const columns: Record<string, unknown> = {
      id: mysqlVarchar("id", { length: 36 }).primaryKey(),
      _parent_id: mysqlVarchar(STORAGE_FORMAT.columns.parentId, {
        length: 36,
      }).notNull(),
      _parent_table: mysqlVarchar(STORAGE_FORMAT.columns.parentTable, {
        length: 255,
      }).notNull(),
      _parent_field: mysqlVarchar(STORAGE_FORMAT.columns.parentField, {
        length: 255,
      }).notNull(),
      _order: mysqlInt(STORAGE_FORMAT.columns.order).default(0),
      [STORAGE_FORMAT.columns.type]: mysqlVarchar(typeColumn, {
        length: 255,
      }),
      created_at: mysqlTimestamp("created_at").defaultNow().notNull(),
      updated_at: mysqlTimestamp("updated_at").defaultNow().notNull(),
    };

    for (const field of fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToMySQLColumn(this.asMappableField(field));
      if (column) {
        columns[field.name] = column;
      }
    }

    return mysqlTable(
      tableName,
      columns as Record<string, never>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle table column accessor is dialect-typed
      (table: any) => ({
        parentIdx: mysqlIndex(
          `${STORAGE_FORMAT.indexPrefix}${tableName}_parent`
        ).on(table._parent_id, table._parent_table, table._parent_field),
      })
    );
  }

  private generateSQLiteSchema(
    tableName: string,
    fields: FieldConfig[],
    typeColumn: string
  ): unknown {
    const columns: Record<string, unknown> = {
      id: sqliteText("id").primaryKey(),
      _parent_id: sqliteText(STORAGE_FORMAT.columns.parentId).notNull(),
      _parent_table: sqliteText(STORAGE_FORMAT.columns.parentTable).notNull(),
      _parent_field: sqliteText(STORAGE_FORMAT.columns.parentField).notNull(),
      _order: sqliteInteger(STORAGE_FORMAT.columns.order).default(0),
      [STORAGE_FORMAT.columns.type]: sqliteText(typeColumn),
      created_at: sqliteInteger("created_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date()),
      updated_at: sqliteInteger("updated_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date()),
    };

    for (const field of fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;

      const column = this.mapFieldToSQLiteColumn(this.asMappableField(field));
      if (column) {
        columns[field.name] = column;
      }
    }

    return sqliteTable(
      tableName,
      columns as Record<string, never>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle table column accessor is dialect-typed
      (table: any) => ({
        parentIdx: sqliteIndex(
          `${STORAGE_FORMAT.indexPrefix}${tableName}_parent`
        ).on(table._parent_id, table._parent_table, table._parent_field),
      })
    );
  }

  /**
   * A field as the column mappers below can read it.
   *
   * They switch on `field.type`, which for a plugin-contributed type matches no
   * case. Substituting the storage primitive's built-in type makes them emit
   * the column that type persists as — the same substitution
   * `getColumnDescriptor` makes for collections and singles, so a component
   * column matches what the schema pipeline creates for it.
   */
  /**
   * Refuse a `unique` field the dialect cannot enforce, before any DDL is generated for it.
   *
   * Asks the shared rule rather than restating it, so a component, a collection and the desired
   * schema cannot hold different opinions about the same column. MySQL refuses to key an
   * unbounded TEXT/BLOB in either spelling and cannot index JSON at all, and because it commits
   * each DDL statement separately there is no way to attempt the constraint without risking a
   * table that exists WITHOUT it. A bare column is also exactly what the desired schema declares
   * for an unkeyable type, so a half-applied add would read as converged and the guarantee would
   * disappear silently.
   */
  private assertUniquenessEnforceable(
    field: DataFieldConfig,
    tableName: string
  ): void {
    const columnType = this.getColumnType(this.asMappableField(field));
    if (columnType === null) return;
    if (uniquenessCanBeAnIndex(columnType, this.dialect)) return;

    const name = "name" in field && field.name ? String(field.name) : "";
    const type = "type" in field ? String(field.type) : "unknown";
    throw NextlyError.validation({
      errors: [
        {
          path: `fields.${name}`,
          code: "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT",
          message:
            `"${name}" is marked unique, but ${this.dialect} cannot enforce uniqueness on a ` +
            `${type} column. Store the value in a short-variant text field, which becomes a ` +
            `bounded VARCHAR the server can key, or remove the unique flag.`,
        },
      ],
      logContext: { tableName, field: name, type, dialect: this.dialect },
    });
  }

  private asMappableField(field: DataFieldConfig): DataFieldConfig {
    const storageType = pluginStorageFieldType(field);
    if (storageType === undefined) return field;
    const mapped: Record<string, unknown> = {
      ...(field as unknown as Record<string, unknown>),
      type: storageType,
    };
    // The keys below are how a BUILT-IN field states its physical shape, and
    // the mappers read them straight off the field. A plugin type's options are
    // its own and core does not interpret them, so one that happens to be named
    // `dbType` or `maxLength` would otherwise reshape the column here while the
    // canonical descriptor — which never sees them — kept mapping the primitive
    // as declared. The same field would then be one type in a component and
    // another in a collection.
    for (const physical of [
      "dbType",
      "precision",
      "scale",
      "maxLength",
      "options",
    ]) {
      delete mapped[physical];
    }
    return mapped as unknown as DataFieldConfig;
  }

  private generateColumnSQL(field: DataFieldConfig): string | null {
    if (!("name" in field) || !field.name) return null;

    const columnName = this.toSnakeCase(field.name);
    const columnType = this.getColumnType(this.asMappableField(field));
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
      parts.push(`DEFAULT ${String(defaultVal)}`);
    }

    return parts.join(" ");
  }

  // Classifies a number field's storage the same way collections and
  // migrate:create do (via the shared column descriptor): exact decimal for
  // `dbType: "decimal"`, floating point for a UI field's `options.format ===
  // "float"`, integer otherwise. Keeps a component's number column matching the
  // type the rest of the schema pipeline emits for the identical field.
  private numberColumnKind(
    field: NumberFieldConfig
  ): "integer" | "decimal" | "double" {
    if (field.dbType === "decimal") return "decimal";
    const format = (field as { options?: { format?: string } }).options?.format;
    return format === "float" ? "double" : "integer";
  }

  private decimalDimensions(field: NumberFieldConfig): {
    precision: number;
    scale: number;
  } {
    return {
      precision: field.precision ?? DEFAULT_DECIMAL_PRECISION,
      scale: field.scale ?? DEFAULT_DECIMAL_SCALE,
    };
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
      const kind = this.numberColumnKind(field);
      if (kind === "integer") return types.integer;
      if (kind === "decimal") {
        const { precision, scale } = this.decimalDimensions(field);
        return types.decimal(precision, scale);
      }
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
    if (isRepeaterField(field) || isGroupField(field)) {
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
      const kind = this.numberColumnKind(field);
      const column =
        kind === "integer"
          ? pgInteger(colName)
          : kind === "decimal"
            ? pgNumeric(colName, this.decimalDimensions(field))
            : pgDoublePrecision(colName);
      return isRequired ? column.notNull() : column;
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
    if (isRepeaterField(field) || isGroupField(field) || isJSONField(field)) {
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
      const kind = this.numberColumnKind(field);
      const column =
        kind === "integer"
          ? mysqlInt(colName)
          : kind === "decimal"
            ? mysqlDecimal(colName, this.decimalDimensions(field))
            : mysqlDouble(colName);
      return isRequired ? column.notNull() : column;
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
    if (isRepeaterField(field) || isGroupField(field) || isJSONField(field)) {
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
      const kind = this.numberColumnKind(field);
      const column =
        kind === "integer"
          ? sqliteInteger(colName)
          : kind === "decimal"
            ? sqliteNumeric(colName)
            : sqliteReal(colName);
      return isRequired ? column.notNull() : column;
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
    if (isRepeaterField(field) || isGroupField(field) || isJSONField(field)) {
      return isRequired ? sqliteText(colName).notNull() : sqliteText(colName);
    }

    return sqliteText(colName);
  }

  /**
   * The identifiers a rendered migration would put in front of the database, with their lengths.
   *
   * 🔴 Read out of the SQL rather than re-derived from the field list, and the difference is not
   * stylistic. An enumeration that walks the fields again is a SECOND transcription of the rules
   * this renderer applies — which index names it emits, which fields it skips because they are
   * localized and live in the companion, which get a `uq_` rather than an `idx_`, and that a column
   * name is itself an identifier. A first attempt at that missed unique indexes and plain column
   * names, and wrongly rejected localized fields for an index the renderer never emits. Three ways
   * to be wrong, in rules that had already been written down once.
   *
   * Scanning what was actually rendered cannot drift, because it IS the output. Every identifier
   * this service emits is quoted with `this.q`, and no dialect uses that character for string
   * literals — PostgreSQL and SQLite quote strings with `'`, MySQL identifiers are backticked — so
   * the quoted tokens are identifiers and nothing else.
   */
  identifiersIn(sql: string): string[] {
    const pattern = this.q === "`" ? /`([^`]+)`/g : /"([^"]+)"/g;
    const found = new Set<string>();
    for (const match of sql.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
    return [...found];
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

    // A number field keeps `type: "number"` while `dbType`, `precision`,
    // `scale` and `options.format` decide its physical column. Comparing only
    // `type` would report "unmodified" for a switch from integer to decimal and
    // leave the existing column at its old type forever.
    if (isNumberField(oldField) && isNumberField(newField)) {
      const oldKind = this.numberColumnKind(oldField);
      const newKind = this.numberColumnKind(newField);
      if (oldKind !== newKind) return true;
      if (oldKind === "decimal") {
        const oldDims = this.decimalDimensions(oldField);
        const newDims = this.decimalDimensions(newField);
        if (
          oldDims.precision !== newDims.precision ||
          oldDims.scale !== newDims.scale
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private buildFieldMap(fields: FieldConfig[]): Map<string, DataFieldConfig> {
    const map = new Map<string, DataFieldConfig>();
    for (const field of fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;
      if (isFieldGroupField(field)) continue;
      if (!("name" in field) || !field.name) continue;
      map.set(field.name, field);
    }
    return map;
  }

  // Used when adding NOT NULL columns to existing tables.
  private getDefaultValueForType(type: string, field?: FieldConfig): string {
    // A contributed type states its own backfill before the primitive's is
    // derived: `{}` satisfies a json column and then fails every read that
    // expects the structure the type actually stores. Read from the field as
    // DECLARED — `type` here may already be the storage primitive, under which
    // the contributed type is not registered and states nothing.
    const contributed = pluginEmptyColumnDefault(field ?? { type }, type, {
      json: serialized => quoteJsonSqlDefault(serialized, this.dialect),
      literal: (value, storageToken) =>
        this.formatDefaultValue(value, storageToken),
    });
    if (contributed !== undefined) return contributed;

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
        return this.dialect === "sqlite" ? "0" : "FALSE";
      case "date":
        if (this.dialect === "sqlite") {
          return String(Math.floor(Date.now() / 1000));
        }
        return "NOW()";
      case "json":
      case "repeater":
      case "group":
        // These share the blocks column type, so they share its restriction on
        // how a default may be written.
        return quoteJsonSqlDefault("{}", this.dialect);
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
      return `'${String(value)}'`;
    }
    if (type === "checkbox") {
      if (this.dialect === "sqlite") return value ? "1" : "0";
      return value ? "TRUE" : "FALSE";
    }
    if (
      type === "json" ||
      type === "repeater" ||
      type === "group" ||
      type === "blocks"
    ) {
      return quoteJsonSqlDefault(
        typeof value === "string" ? value : JSON.stringify(value),
        this.dialect
      );
    }
    if (type === "date") {
      if (this.dialect === "sqlite" && typeof value === "string") {
        return String(Math.floor(new Date(value).getTime() / 1000));
      }
      return `'${String(value)}'`;
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

/**
 * The longest slug this generator can turn into a legal identifier on every dialect.
 *
 * Derived rather than chosen. A slug is not the identifier: it is prefixed into a table name and
 * that table name is prefixed AND suffixed into an index name, so the longest thing the database
 * actually sees is
 *
 *   `idx_` + `comp_` + <slug> + `_parent`
 *
 * which is sixteen characters longer than the slug the caller typed. Bounding the slug at the
 * product's usual 50 therefore still produces a 66-character index name, and MySQL rejects any
 * identifier past 64 — the table is created, the index creation fails, and the field group is left
 * recorded as failed with an unbound table.
 *
 * The budget is PostgreSQL's 63 rather than MySQL's 64 because it is the tighter of the two, and
 * because its failure is the worse one: PostgreSQL does not reject an over-long identifier, it
 * silently TRUNCATES it, so the index it creates carries a name nothing else can address.
 *
 * Computed from the same constants the names are built from, so a change to either prefix or to the
 * suffix moves this bound with it instead of leaving a number behind that used to be right.
 */
/**
 * The longest identifier every supported dialect stores intact.
 *
 * PostgreSQL's 63 rather than MySQL's 64 because it is the tighter budget AND its failure is the
 * worse one: PostgreSQL does not reject an over-long identifier, it silently TRUNCATES it, leaving
 * an object under a name nothing else can address.
 */
export const MAX_IDENTIFIER_LENGTH = 63;

export const MAX_FIELD_GROUP_SLUG_LENGTH =
  MAX_IDENTIFIER_LENGTH -
  STORAGE_FORMAT.indexPrefix.length -
  STORAGE_FORMAT.tablePrefix.length -
  "_parent".length;
