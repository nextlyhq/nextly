/**
 * DynamicCollectionSchemaService
 *
 * Handles all code and SQL generation for dynamic collections:
 * - SQL migration generation (CREATE TABLE, ALTER TABLE, DROP TABLE)
 * - TypeScript/Drizzle schema code generation
 * - Junction table generation for many-to-many relationships
 * - Type mapping between field types and SQL/Drizzle types
 *
 * Supports multiple database dialects: postgresql, mysql, sqlite
 *
 * @example
 * ```typescript
 * const schemaService = new DynamicCollectionSchemaService(validationService, 'sqlite');
 * const sql = schemaService.generateMigrationSQL('dc_posts', fields);
 * const code = schemaService.generateSchemaCode('dc_posts', 'posts', fields);
 * ```
 */

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { env } from "../../../shared/lib/env";

import { DynamicCollectionValidationService } from "./dynamic-collection-validation-service";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

export class DynamicCollectionSchemaService {
  private validationService: DynamicCollectionValidationService;
  private dialect: SupportedDialect;

  constructor(
    validationService?: DynamicCollectionValidationService,
    dialect?: SupportedDialect
  ) {
    this.validationService =
      validationService || new DynamicCollectionValidationService();
    this.dialect =
      dialect || (env.DB_DIALECT as SupportedDialect) || "postgresql";
  }

  /**
   * Quote identifier based on dialect
   */
  private quoteIdentifier(name: string): string {
    if (this.dialect === "mysql") {
      return `\`${name}\``;
    }
    return `"${name}"`;
  }

  /** Convert camelCase to snake_case (e.g., publishedAt → published_at) */
  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, "_$1").toLowerCase();
  }

  /**
   * Generate SQL migration for creating a new collection table
   *
   * @param tableName - The name of the table to create
   * @param fields - Field definitions for the table
   * @param options - Optional configuration (reserved for future use)
   */
  generateMigrationSQL(
    tableName: string,
    fields: FieldDefinition[],
    _options?: { isSingle?: boolean }
  ): string {
    const constraints: string[] = [];
    const checks: string[] = [];
    const junctionTables: string[] = [];

    const columns = fields
      .map(f => {
        // Skip many-to-many fields as they don't create columns in the main table
        if (f.type === "relation" && f.options?.relationType === "manyToMany") {
          return null;
        }

        const type = this.mapFieldTypeToSQL(
          f.type,
          f.length,
          f.options,
          f.validation
        );
        const nullable = f.required ? "NOT NULL" : "";

        // one-to-one relationships should be unique
        const unique =
          f.unique ||
          (f.type === "relation" && f.options?.relationType === "oneToOne")
            ? "UNIQUE"
            : "";

        // Handle default value (support both 'default' and 'defaultValue')
        const defaultValue =
          f.default !== undefined ? f.default : f.defaultValue;
        const defaultVal =
          defaultValue !== undefined && defaultValue !== null
            ? `DEFAULT ${this.formatDefaultValue(defaultValue, f.type)}`
            : "";

        // Add CHECK constraints for validation
        if (f.validation) {
          if (f.validation.min !== undefined) {
            checks.push(
              `${this.quoteIdentifier(f.name)} >= ${f.validation.min}`
            );
          }
          if (f.validation.max !== undefined) {
            checks.push(
              `${this.quoteIdentifier(f.name)} <= ${f.validation.max}`
            );
          }
          if (
            f.validation.minLength !== undefined &&
            (f.type === "text" ||
              f.type === "string" ||
              f.type === "email" ||
              f.type === "password")
          ) {
            checks.push(
              `LENGTH(${this.quoteIdentifier(f.name)}) >= ${f.validation.minLength}`
            );
          }
          if (f.validation.regex && this.dialect !== "sqlite") {
            // Validate regex pattern first
            // Note: SQLite doesn't have built-in regex support, so we skip this for SQLite
            this.validationService.validateRegexPattern(
              f.name,
              f.validation.regex
            );
            // Escape single quotes to prevent SQL injection
            const escapedRegex = f.validation.regex.replace(/'/g, "''");

            if (this.dialect === "mysql") {
              checks.push(
                `${this.quoteIdentifier(this.toSnakeCase(f.name))} REGEXP '${escapedRegex}'`
              );
            } else {
              checks.push(
                `${this.quoteIdentifier(this.toSnakeCase(f.name))} ~ '${escapedRegex}'`
              );
            }
          }
        }

        // Handle relations (foreign keys)
        if (f.type === "relation" && f.options?.target) {
          const relationType = f.options.relationType || "manyToOne"; // Default to many-to-one
          const targetTable = `dc_${f.options.target}`;

          // Handle oneToOne, manyToOne, and oneToMany (oneToMany is defined on the opposite side)
          if (
            relationType === "oneToOne" ||
            relationType === "manyToOne" ||
            relationType === "oneToMany"
          ) {
            const onDelete = this.mapOnDeleteAction(
              f.options.onDelete || "set null"
            );
            const onUpdate = this.mapOnUpdateAction(
              f.options.onUpdate || "no action"
            );

            const fkColName = this.toSnakeCase(f.name);
            constraints.push(
              `  CONSTRAINT ${this.quoteIdentifier(`fk_${tableName}_${fkColName}`)} FOREIGN KEY (${this.quoteIdentifier(fkColName)}) REFERENCES ${this.quoteIdentifier(targetTable)}(${this.quoteIdentifier("id")}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
            );
          }
        }

        // Convert camelCase field names to snake_case for column names
        // (matches the convention used by CollectionEntryService)
        const colName = this.toSnakeCase(f.name);
        return `  ${this.quoteIdentifier(colName)} ${type} ${nullable} ${unique} ${defaultVal}`.trim();
      })
      .filter(Boolean)
      .join(",\n");

    // Build table creation SQL
    let sql = `-- Create dynamic collection: ${tableName}
CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(tableName)} (
`;

    // Handle ID column based on dialect
    if (this.dialect === "mysql") {
      sql += `  ${this.quoteIdentifier("id")} varchar(36) PRIMARY KEY NOT NULL,\n`;
    } else {
      sql += `  ${this.quoteIdentifier("id")} text PRIMARY KEY NOT NULL,\n`;
    }

    // Add title column only if not defined as a collection field (to avoid duplicate columns)
    const hasTitleField = fields.some(f => f.name === "title");
    if (!hasTitleField) {
      if (this.dialect === "mysql") {
        sql += `  ${this.quoteIdentifier("title")} varchar(255) NOT NULL,\n`;
      } else {
        sql += `  ${this.quoteIdentifier("title")} text NOT NULL,\n`;
      }
    }

    // Add slug column only if not defined as a collection field (to avoid duplicate columns)
    const hasSlugField = fields.some(f => f.name === "slug");
    if (!hasSlugField) {
      if (this.dialect === "mysql") {
        sql += `  ${this.quoteIdentifier("slug")} varchar(255) NOT NULL,\n`;
      } else {
        sql += `  ${this.quoteIdentifier("slug")} text NOT NULL,\n`;
      }
    }

    sql += `${columns}`;

    // Add CHECK constraints
    if (checks.length > 0) {
      sql += `,\n  CONSTRAINT ${this.quoteIdentifier(`chk_${tableName}_validation`)} CHECK (${checks.join(" AND ")})`;
    }

    // Add foreign key constraints
    if (constraints.length > 0) {
      sql += `,\n${constraints.join(",\n")}`;
    }

    // Add timestamp columns with dialect-specific defaults
    if (this.dialect === "sqlite") {
      sql += `,
  ${this.quoteIdentifier("created_at")} integer DEFAULT (strftime('%s', 'now')) NOT NULL,
  ${this.quoteIdentifier("updated_at")} integer DEFAULT (strftime('%s', 'now')) NOT NULL
);`;
    } else if (this.dialect === "mysql") {
      sql += `,
  ${this.quoteIdentifier("created_at")} timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ${this.quoteIdentifier("updated_at")} timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;
    } else {
      sql += `,
  ${this.quoteIdentifier("created_at")} timestamp DEFAULT now() NOT NULL,
  ${this.quoteIdentifier("updated_at")} timestamp DEFAULT now() NOT NULL
);`;
    }

    // Generate many-to-many junction tables
    fields.forEach(f => {
      if (
        f.type === "relation" &&
        f.options?.relationType === "manyToMany" &&
        f.options?.target
      ) {
        const junctionTableSQL = this.generateJunctionTable(tableName, f);
        junctionTables.push(junctionTableSQL);
      }
    });

    // Add indexes for fields that benefit from indexing
    const indexStatements: string[] = [];

    // essential for JOIN performance, PostgreSQL does NOT automatically index foreign keys!
    fields.forEach(f => {
      if (f.type === "relation" && f.options?.relationType !== "manyToMany") {
        const indexName = `idx_${tableName}_${f.name}`;
        if (this.dialect === "mysql") {
          indexStatements.push(
            `CREATE INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(f.name)});`
          );
        } else {
          indexStatements.push(
            `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(f.name)});`
          );
        }
      }
    });

    // Add manual indexes requested by the user
    fields.forEach(f => {
      if (f.index && f.type !== "relation") {
        const indexName = `idx_${tableName}_${f.name}`;
        if (this.dialect === "mysql") {
          indexStatements.push(
            `CREATE INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(f.name)});`
          );
        } else {
          indexStatements.push(
            `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(f.name)});`
          );
        }
      }
    });

    // For now, we'll add it as it's a common pattern in most applications
    // This can be made configurable in the future via collection settings
    // Note: SQLite doesn't support DESC in CREATE INDEX, only in ORDER BY
    // Note: MySQL 5.7 doesn't support IF NOT EXISTS for CREATE INDEX
    let createdAtIndex = "";
    if (this.dialect === "sqlite") {
      createdAtIndex = `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(`idx_${tableName}_created_at`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_at")});`;
    } else if (this.dialect === "mysql") {
      createdAtIndex = `CREATE INDEX ${this.quoteIdentifier(`idx_${tableName}_created_at`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_at")} DESC);`;
    } else {
      createdAtIndex = `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(`idx_${tableName}_created_at`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_at")} DESC);`;
    }
    indexStatements.push(createdAtIndex);

    // Add unique index for slug column (automatically available for all collections and singles)
    let slugIndex = "";
    if (this.dialect === "sqlite") {
      slugIndex = `CREATE UNIQUE INDEX IF NOT EXISTS ${this.quoteIdentifier(`idx_${tableName}_slug`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("slug")});`;
    } else if (this.dialect === "mysql") {
      slugIndex = `CREATE UNIQUE INDEX ${this.quoteIdentifier(`idx_${tableName}_slug`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("slug")});`;
    } else {
      slugIndex = `CREATE UNIQUE INDEX IF NOT EXISTS ${this.quoteIdentifier(`idx_${tableName}_slug`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("slug")});`;
    }
    indexStatements.push(slugIndex);

    // Append index statements
    if (indexStatements.length > 0) {
      sql += "\n--> statement-breakpoint\n";
      sql += indexStatements.join("\n--> statement-breakpoint\n");
    }

    // Append junction tables
    if (junctionTables.length > 0) {
      sql += "\n--> statement-breakpoint\n";
      sql += junctionTables.join("\n--> statement-breakpoint\n");
    }

    return sql;
  }

  /**
   * Generate ALTER TABLE migration for updating a collection
   *
   * Note: SQLite has very limited ALTER TABLE support:
   * - ADD COLUMN is supported
   * - DROP COLUMN is supported (SQLite 3.35.0+)
   * - ALTER COLUMN (change type, nullability) is NOT supported
   *
   * For complex schema changes in SQLite, a table rebuild is required,
   * but for dynamic collections we keep it simple and only support
   * adding/removing columns.
   */
  generateAlterTableMigration(
    tableName: string,
    oldFields: FieldDefinition[],
    newFields: FieldDefinition[]
  ): string {
    const statements: string[] = [`-- Update dynamic collection: ${tableName}`];

    const oldFieldMap = new Map(oldFields.map(f => [f.name, f]));
    const newFieldMap = new Map(newFields.map(f => [f.name, f]));

    // Phase D (Option 2, 2026-05-01): structural rename detection.
    // Pre-Phase-D, this method diffed by name only — renaming a field
    // emitted DROP <old> + ADD <new>, destroying the column's data.
    // Now we detect "exactly one removed + exactly one added with
    // compatible types" as a rename and emit ALTER TABLE RENAME COLUMN
    // instead. Ambiguous cases (multiple removed/added) bail out to
    // the unsafe DROP+ADD path with a console.warn so the user sees
    // the data-loss risk.
    //
    // Limitation: when a rename happens together with an index toggle
    // or type change in the same save, only the RENAME is emitted —
    // index/type adjustments are silently skipped because the index/
    // modified loops below key on the new name and the rename pair
    // doesn't appear in oldFieldMap. Acceptable trade-off vs the
    // alternative (data destruction). Track as a follow-up; admin UI
    // ideally splits combined edits into two saves.
    const rename = this.detectFieldRename(oldFields, newFields);
    const renamedFromName = rename?.from.name ?? null;
    const renamedToName = rename?.to.name ?? null;
    if (rename) {
      const fromCol = this.toSnakeCase(rename.from.name);
      const toCol = this.toSnakeCase(rename.to.name);
      // RENAME COLUMN syntax is consistent across PG, MySQL 8.0+,
      // and SQLite 3.25+ — all dialects we support.
      statements.push(
        `ALTER TABLE ${this.quoteIdentifier(tableName)} RENAME COLUMN ${this.quoteIdentifier(fromCol)} TO ${this.quoteIdentifier(toCol)};`
      );
    }

    // Find added fields
    for (const field of newFields) {
      // Phase D: skip the renamed target — it's already been handled
      // above as ALTER TABLE RENAME COLUMN.
      if (field.name === renamedToName) continue;
      if (!oldFieldMap.has(field.name)) {
        // Skip manyToMany fields - they don't get columns, they get junction tables
        if (
          field.type === "relation" &&
          field.options?.relationType === "manyToMany"
        ) {
          // Generate junction table instead
          const junctionSQL = this.generateJunctionTable(tableName, field);
          statements.push(junctionSQL);
          continue;
        }

        const type = this.mapFieldTypeToSQL(field.type, field.length);
        const nullable = field.required ? "NOT NULL" : "";

        // When adding a NOT NULL column to an existing table, we must provide a default
        // value for existing rows. Use explicit defaultValue if provided, otherwise
        // use a sensible default based on field type.
        let defaultVal = "";
        if (field.defaultValue !== undefined) {
          defaultVal = `DEFAULT ${this.formatDefaultValue(field.defaultValue, field.type)}`;
        } else if (field.required) {
          // Required field without explicit default - provide sensible default for existing rows
          defaultVal = `DEFAULT ${this.getDefaultValueForType(field.type)}`;
        }

        const addColName = this.toSnakeCase(field.name);
        statements.push(
          `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD COLUMN ${this.quoteIdentifier(addColName)} ${type} ${nullable} ${defaultVal};`.trim()
        );

        // SQLite doesn't support adding constraints separately via ALTER TABLE
        // Foreign keys and unique constraints must be defined at table creation
        // For PostgreSQL/MySQL, we can add them
        if (this.dialect !== "sqlite") {
          // Add foreign key for non-manyToMany relations
          if (field.type === "relation" && field.options?.target) {
            const targetTable = `dc_${field.options.target}`;
            const onDelete = field.options.onDelete || "set null";
            const onUpdate = field.options.onUpdate || "no action";
            statements.push(
              `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD CONSTRAINT ${this.quoteIdentifier(`fk_${tableName}_${addColName}`)} FOREIGN KEY (${this.quoteIdentifier(addColName)}) REFERENCES ${this.quoteIdentifier(targetTable)}(${this.quoteIdentifier("id")}) ON DELETE ${this.mapOnDeleteAction(onDelete)} ON UPDATE ${this.mapOnUpdateAction(onUpdate)};`
            );
          }

          // Add unique constraint if needed
          if (field.unique) {
            statements.push(
              `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD CONSTRAINT ${this.quoteIdentifier(`uq_${tableName}_${addColName}`)} UNIQUE (${this.quoteIdentifier(addColName)});`
            );
          }
        } else {
          // For SQLite with unique constraint, create a unique index instead
          if (field.unique) {
            statements.push(
              `CREATE UNIQUE INDEX IF NOT EXISTS ${this.quoteIdentifier(`uq_${tableName}_${addColName}`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(addColName)});`
            );
          }
        }
      }
    }

    // Find fields that were modified to add/remove an index
    for (const field of newFields) {
      const oldField = oldFieldMap.get(field.name);
      if (oldField && oldField.index !== field.index) {
        const idxCol = this.toSnakeCase(field.name);
        const indexName = `idx_${tableName}_${idxCol}`;
        if (field.index) {
          // Add index
          if (this.dialect === "mysql") {
            statements.push(
              `CREATE INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(idxCol)});`
            );
          } else {
            statements.push(
              `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(idxCol)});`
            );
          }
        } else {
          // Drop index
          if (this.dialect === "mysql") {
            statements.push(
              `DROP INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)};`
            );
          } else {
            statements.push(
              `DROP INDEX IF EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)};`
            );
          }
        }
      }
    }

    // Find removed fields
    for (const field of oldFields) {
      // Phase D: skip the renamed source — it's already been handled
      // above as ALTER TABLE RENAME COLUMN.
      if (field.name === renamedFromName) continue;
      if (!newFieldMap.has(field.name)) {
        const dropCol = this.toSnakeCase(field.name);
        // SQLite doesn't support IF EXISTS on DROP COLUMN
        if (this.dialect === "sqlite") {
          statements.push(
            `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP COLUMN ${this.quoteIdentifier(dropCol)};`
          );
        } else {
          statements.push(
            `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP COLUMN IF EXISTS ${this.quoteIdentifier(dropCol)};`
          );
        }
      }
    }

    // Find modified fields
    // Note: SQLite doesn't support ALTER COLUMN - modifications require table rebuild
    // For simplicity, we skip column modifications for SQLite
    if (this.dialect !== "sqlite") {
      for (const field of newFields) {
        const oldField = oldFieldMap.get(field.name);
        if (oldField && this.isFieldModified(oldField, field)) {
          const alterCol = this.toSnakeCase(field.name);
          const type = this.mapFieldTypeToSQL(field.type, field.length);
          statements.push(
            `ALTER TABLE ${this.quoteIdentifier(tableName)} ALTER COLUMN ${this.quoteIdentifier(alterCol)} TYPE ${type};`
          );

          if (field.required !== oldField.required) {
            if (field.required) {
              statements.push(
                `ALTER TABLE ${this.quoteIdentifier(tableName)} ALTER COLUMN ${this.quoteIdentifier(alterCol)} SET NOT NULL;`
              );
            } else {
              statements.push(
                `ALTER TABLE ${this.quoteIdentifier(tableName)} ALTER COLUMN ${this.quoteIdentifier(alterCol)} DROP NOT NULL;`
              );
            }
          }
        }
      }
    }

    return statements.join("\n--> statement-breakpoint\n");
  }

  /**
   * Check if a field definition has been modified
   */
  isFieldModified(
    oldField: FieldDefinition,
    newField: FieldDefinition
  ): boolean {
    return (
      oldField.type !== newField.type ||
      oldField.length !== newField.length ||
      oldField.required !== newField.required ||
      oldField.unique !== newField.unique ||
      oldField.index !== newField.index
    );
  }

  /**
   * Phase D (Option 2) — structural rename detection.
   *
   * Pairs a removed field with an added field if and only if:
   *   1. There is exactly ONE removed field (in oldFields, not in newFields)
   *   2. AND exactly ONE added field (in newFields, not in oldFields)
   *   3. AND their types are compatible (same `type`, and for relations
   *      same target + relationType)
   *
   * This is the SAFE heuristic: zero ambiguity. If the user renames
   * multiple fields in a single save, the heuristic bails out and the
   * caller falls back to ADD+DROP. A console.warn surfaces the data-
   * loss risk so the user knows to rename one field at a time, OR an
   * admin-UI confirmation prompt can be added later (tracked as a
   * Phase D follow-up).
   *
   * Why not the more aggressive multi-pair scoring described in the
   * design doc: ambiguous pairings can silently rename to the wrong
   * column. The cost of that bug exceeds the cost of asking the user
   * to make smaller saves. We can soften this with an admin-UI
   * confirmation later if friction is real.
   */
  detectFieldRename(
    oldFields: FieldDefinition[],
    newFields: FieldDefinition[]
  ): { from: FieldDefinition; to: FieldDefinition } | null {
    const oldNames = new Set(oldFields.map(f => f.name));
    const newNames = new Set(newFields.map(f => f.name));

    const oldOnly = oldFields.filter(f => !newNames.has(f.name));
    const newOnly = newFields.filter(f => !oldNames.has(f.name));

    if (oldOnly.length === 0 || newOnly.length === 0) {
      // Pure add or pure drop — not a rename candidate.
      return null;
    }

    if (oldOnly.length > 1 || newOnly.length > 1) {
      // eslint-disable-next-line no-console -- structured warning is the
      // primary signal to operators that data could be at risk.
      console.warn(
        `[Nextly schema] Detected ${oldOnly.length} removed and ` +
          `${newOnly.length} added field(s) in the same save on this ` +
          `collection. Skipping rename detection (ambiguous) — emitting ` +
          `DROP/ADD which loses any data in the removed columns. To ` +
          `rename safely, edit and save one field at a time. Removed: [` +
          oldOnly.map(f => f.name).join(", ") +
          `]. Added: [` +
          newOnly.map(f => f.name).join(", ") +
          `].`
      );
      return null;
    }

    const from = oldOnly[0]!;
    const to = newOnly[0]!;

    if (!this.areFieldTypesCompatible(from, to)) {
      // eslint-disable-next-line no-console -- as above.
      console.warn(
        `[Nextly schema] Field "${from.name}" was removed and ` +
          `"${to.name}" was added in the same save, but their types ` +
          `(${from.type} vs ${to.type}) are not compatible. Treating ` +
          `as DROP "${from.name}" + ADD "${to.name}" — existing data ` +
          `in "${from.name}" will be lost. If this was intended as a ` +
          `type-changing rename, do it in two steps: first rename ` +
          `without changing type, then change the type.`
      );
      return null;
    }

    return { from, to };
  }

  /**
   * Are two field definitions compatible enough that renaming one to
   * the other preserves data semantics?
   *
   * Strict by design: same type, and for relations same target +
   * relationType. Length differences are allowed for text/varchar
   * since a column rename doesn't touch the size constraint. Required/
   * unique/index differences are allowed (those are independent
   * attribute changes the user can adjust on either side of a rename).
   */
  private areFieldTypesCompatible(
    a: FieldDefinition,
    b: FieldDefinition
  ): boolean {
    if (a.type !== b.type) return false;
    // manyToMany relations don't get columns — they get junction tables.
    // Renaming one is a different operation (rename junction table). We
    // do NOT auto-rename here because the junction-table flow has its
    // own naming conventions; safer to bail out and require explicit
    // handling. The caller's add/drop loop will do drop-junction +
    // add-junction (data loss for the join) — admin UI ideally warns
    // before this kind of edit.
    if (
      a.type === "relation" &&
      a.options?.relationType === "manyToMany"
    ) {
      return false;
    }
    if (a.type === "relation") {
      return (
        a.options?.target === b.options?.target &&
        a.options?.relationType === b.options?.relationType
      );
    }
    return true;
  }

  /**
   * Generate TypeScript/Drizzle schema code for a collection
   */
  generateSchemaCode(
    tableName: string,
    collectionName: string,
    fields: FieldDefinition[]
  ): string {
    // Determine dialect-specific imports and table function
    const dialectConfig = this.getDialectConfig();
    // Check for any field type that uses jsonb in PostgreSQL
    const jsonbFieldTypes = [
      "json",
      "repeater",
      "group",
      "blocks",
      "point",
      "group",
      "blocks",
      "point",
      "chips",
    ];
    const hasJsonField = fields.some(f => jsonbFieldTypes.includes(f.type));
    const hasRelation = fields.some(f => f.type === "relation");

    // Build base imports based on dialect
    const baseImports = ["text", "index", "uniqueIndex"];
    if (this.dialect !== "sqlite") {
      baseImports.push("varchar", "decimal", "boolean", "timestamp", "integer");
    } else {
      // SQLite uses integer for boolean and timestamp
      baseImports.push("integer", "real");
    }
    if (hasJsonField) {
      if (this.dialect === "postgresql") {
        baseImports.push("jsonb");
      }
      // SQLite and MySQL use text/json which is already covered
    }

    let imports = `import { ${dialectConfig.tableFunction}, ${baseImports.join(", ")} } from '${dialectConfig.importPath}';`;

    if (hasRelation) {
      imports += `\nimport { relations } from 'drizzle-orm';`;
    }

    const columns = fields
      .filter(
        f =>
          !(f.type === "relation" && f.options?.relationType === "manyToMany")
      )
      .map(f => {
        const drizzleType = this.mapFieldTypeToDrizzleDialectAware(f);
        const modifiers = [];
        if (f.required) modifiers.push(".notNull()");

        // Auto-add unique for one-to-one relationships
        if (
          f.unique ||
          (f.type === "relation" && f.options?.relationType === "oneToOne")
        ) {
          modifiers.push(".unique()");
        }

        // Handle default value (support both 'default' and 'defaultValue')
        const defaultValue =
          f.default !== undefined ? f.default : f.defaultValue;
        if (defaultValue !== undefined && defaultValue !== null) {
          if (f.type === "json") {
            modifiers.push(`.default(${JSON.stringify(defaultValue)})`);
          } else if (typeof defaultValue === "string") {
            modifiers.push(`.default('${defaultValue}')`);
          } else {
            modifiers.push(`.default(${defaultValue})`);
          }
        }

        // Add references for foreign keys
        if (
          f.type === "relation" &&
          f.options?.target &&
          f.options?.relationType !== "manyToMany"
        ) {
          const targetTable = `dc_${f.options.target}`;
          const onDelete = f.options.onDelete || "set null";
          const onUpdate = f.options.onUpdate || "no action";
          modifiers.push(
            `.references(() => ${targetTable}.id, { onDelete: "${onDelete}", onUpdate: "${onUpdate}" })`
          );
        }

        return `  ${f.name}: ${drizzleType}${modifiers.join("")},`;
      })
      .join("\n");

    // Generate relation definitions for Drizzle ORM
    const relationDefs = this.generateRelationDefinitions(tableName, fields);

    // Generate index definitions (including manual indexes and relations)
    const fieldIndexes = fields
      .filter(
        f =>
          f.index ||
          (f.type === "relation" && f.options?.relationType !== "manyToMany")
      )
      .map(
        f =>
          `  ${f.name}Idx: index('idx_${tableName}_${f.name}').on(table.${f.name}),`
      )
      .join("\n");

    const allIndexes = fieldIndexes
      ? `  createdAtIdx: index('idx_${tableName}_created_at').on(table.createdAt),\n${fieldIndexes}`
      : `  createdAtIdx: index('idx_${tableName}_created_at').on(table.createdAt),`;

    // Generate dialect-specific timestamp columns
    const timestampColumns = this.generateTimestampColumnsForDialect();

    return `${imports}

/**
 * Dynamic collection: ${collectionName}
 * Generated by nextly
 */
export const ${tableName} = ${dialectConfig.tableFunction}('${tableName}', {
  id: text('id').primaryKey().notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
${columns}
${timestampColumns}
}, (table) => ({
  slugIdx: uniqueIndex('idx_${tableName}_slug').on(table.slug),
${allIndexes}
}));
${relationDefs}
export type ${this.toPascalCase(collectionName)} = typeof ${tableName}.$inferSelect;
export type New${this.toPascalCase(collectionName)} = typeof ${tableName}.$inferInsert;
`;
  }

  /**
   * Get dialect-specific configuration for schema generation
   */
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

  /**
   * Generate dialect-specific timestamp column definitions
   */
  private generateTimestampColumnsForDialect(): string {
    if (this.dialect === "sqlite") {
      return `  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),`;
    }

    // PostgreSQL and MySQL
    return `  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),`;
  }

  /**
   * Map field type to Drizzle ORM column definition (dialect-aware)
   */
  private mapFieldTypeToDrizzleDialectAware(field: FieldDefinition): string {
    if (this.dialect === "sqlite") {
      // SQLite-specific mapping
      const sqliteTypeMap: Record<string, (f: FieldDefinition) => string> = {
        string: f => `text('${f.name}')`,
        text: f => `text('${f.name}')`,
        number: f =>
          f.options?.format === "float"
            ? `real('${f.name}')`
            : `integer('${f.name}')`,
        decimal: f => `real('${f.name}')`,
        boolean: f => `integer('${f.name}', { mode: 'boolean' })`,
        date: f => `integer('${f.name}', { mode: 'timestamp' })`,
        email: f => `text('${f.name}')`,
        password: f => `text('${f.name}')`,
        richtext: f => `text('${f.name}')`,
        json: f => `text('${f.name}', { mode: 'json' })`,
        chips: f => `text('${f.name}', { mode: 'json' })`,
        relation: f => `text('${f.name}')`,
      };
      const mapper = sqliteTypeMap[field.type];
      return mapper ? mapper(field) : `text('${field.name}')`;
    }

    if (this.dialect === "mysql") {
      // MySQL-specific mapping
      const mysqlTypeMap: Record<string, (f: FieldDefinition) => string> = {
        string: f => `varchar('${f.name}', { length: ${f.length || 255} })`,
        text: f =>
          f.options?.variant === "short"
            ? `varchar('${f.name}', { length: ${f.validation?.maxLength || 255} })`
            : `text('${f.name}')`,
        number: f =>
          f.options?.format === "float"
            ? `decimal('${f.name}', { precision: 10, scale: 2 })`
            : `int('${f.name}')`,
        decimal: f => `decimal('${f.name}', { precision: 10, scale: 2 })`,
        boolean: f => `boolean('${f.name}')`,
        date: f => `timestamp('${f.name}')`,
        email: f =>
          `varchar('${f.name}', { length: ${f.validation?.maxLength || 255} })`,
        password: f =>
          `varchar('${f.name}', { length: ${f.validation?.maxLength || 255} })`,
        richtext: f => `text('${f.name}')`,
        json: f => `json('${f.name}')`,
        chips: f => `json('${f.name}')`,
        relation: f => `varchar('${f.name}', { length: 36 })`,
      };
      const mapper = mysqlTypeMap[field.type];
      return mapper ? mapper(field) : `text('${field.name}')`;
    }

    // PostgreSQL (default) - use existing mapping
    return this.mapFieldTypeToDrizzle(field);
  }

  /**
   * Generate DROP TABLE migration SQL
   */
  generateDropTableMigration(
    collectionName: string,
    tableName: string
  ): {
    migrationSQL: string;
    migrationFileName: string;
  } {
    // SQLite doesn't support CASCADE on DROP TABLE
    const dropStatement =
      this.dialect === "sqlite"
        ? `DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)};`
        : `DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)} CASCADE;`;

    const migrationSQL = `-- Drop dynamic collection: ${collectionName}
${dropStatement}`;

    return {
      migrationSQL,
      migrationFileName: `${Date.now()}_drop_${collectionName}.sql`,
    };
  }

  /**
   * Generate junction table SQL for many-to-many relationships
   */
  generateJunctionTable(
    sourceTableName: string,
    field: FieldDefinition
  ): string {
    const targetCollectionName = field.options!.target!;
    const targetTableName = `dc_${targetCollectionName}`;

    // Generate junction table name
    // Custom junction table name or auto-generated
    const junctionTableName =
      field.options?.junctionTable ||
      this.generateJunctionTableName(
        sourceTableName,
        targetTableName,
        field.name
      );

    const onDelete = this.mapOnDeleteAction(
      field.options?.onDelete || "cascade"
    );
    const onUpdate = this.mapOnUpdateAction(
      field.options?.onUpdate || "no action"
    );

    // Extract collection name from table name (remove dc_ prefix)
    const sourceCollectionName = sourceTableName.replace("dc_", "");

    // Use dialect-specific timestamp default
    let timestampDefault = "";
    if (this.dialect === "sqlite") {
      timestampDefault = "integer DEFAULT (strftime('%s', 'now')) NOT NULL";
    } else if (this.dialect === "mysql") {
      timestampDefault = "timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL";
    } else {
      timestampDefault = "timestamp DEFAULT now() NOT NULL";
    }

    return `-- Junction table for many-to-many: ${sourceCollectionName}.${field.name} -> ${targetCollectionName}
CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(junctionTableName)} (
  ${this.quoteIdentifier("id")} ${this.dialect === "mysql" ? "varchar(36)" : "text"} PRIMARY KEY NOT NULL,
  ${this.quoteIdentifier(`${sourceCollectionName}_id`)} ${this.dialect === "mysql" ? "varchar(36)" : "text"} NOT NULL,
  ${this.quoteIdentifier(`${targetCollectionName}_id`)} ${this.dialect === "mysql" ? "varchar(36)" : "text"} NOT NULL,
  ${this.quoteIdentifier("created_at")} ${timestampDefault},
  CONSTRAINT ${this.quoteIdentifier(`fk_${junctionTableName}_${sourceCollectionName}`)} FOREIGN KEY (${this.quoteIdentifier(`${sourceCollectionName}_id`)}) REFERENCES ${this.quoteIdentifier(sourceTableName)}(${this.quoteIdentifier("id")}) ON DELETE ${onDelete} ON UPDATE ${onUpdate},
  CONSTRAINT ${this.quoteIdentifier(`fk_${junctionTableName}_${targetCollectionName}`)} FOREIGN KEY (${this.quoteIdentifier(`${targetCollectionName}_id`)}) REFERENCES ${this.quoteIdentifier(targetTableName)}(${this.quoteIdentifier("id")}) ON DELETE ${onDelete} ON UPDATE ${onUpdate},
  CONSTRAINT ${this.quoteIdentifier(`uq_${junctionTableName}_pair`)} UNIQUE (${this.quoteIdentifier(`${sourceCollectionName}_id`)}, ${this.quoteIdentifier(`${targetCollectionName}_id`)})
);
--> statement-breakpoint
  CONSTRAINT ${this.quoteIdentifier(`uq_${junctionTableName}_pair`)} UNIQUE (${this.quoteIdentifier(`${sourceCollectionName}_id`)}, ${this.quoteIdentifier(`${targetCollectionName}_id`)})
);
--> statement-breakpoint
${this.dialect === "mysql" ? "CREATE INDEX" : "CREATE INDEX IF NOT EXISTS"} ${this.quoteIdentifier(`idx_${junctionTableName}_${sourceCollectionName}`)} ON ${this.quoteIdentifier(junctionTableName)}(${this.quoteIdentifier(`${sourceCollectionName}_id`)});
--> statement-breakpoint
${this.dialect === "mysql" ? "CREATE INDEX" : "CREATE INDEX IF NOT EXISTS"} ${this.quoteIdentifier(`idx_${junctionTableName}_${targetCollectionName}`)} ON ${this.quoteIdentifier(junctionTableName)}(${this.quoteIdentifier(`${targetCollectionName}_id`)});`;
  }

  /**
   * Generate junction table name following naming convention
   */
  generateJunctionTableName(
    sourceTable: string,
    targetTable: string,
    fieldName: string
  ): string {
    // Sort table names alphabetically for consistency
    const tables = [sourceTable, targetTable].sort();
    return `${tables[0]}_${tables[1]}_${fieldName}`;
  }

  /**
   * Generate Drizzle ORM relation definitions
   */
  generateRelationDefinitions(
    tableName: string,
    fields: FieldDefinition[]
  ): string {
    const relationFields = fields.filter(f => f.type === "relation");
    if (relationFields.length === 0) {
      return "";
    }

    const relationDefs = relationFields
      .map(f => {
        const targetTable = `dc_${f.options!.target!}`;
        const relationType = f.options!.relationType!;

        switch (relationType) {
          case "oneToOne":
            return `    ${f.name}: one(${targetTable}, {
      fields: [${tableName}.${f.name}],
      references: [${targetTable}.id],
    }),`;

          case "manyToOne":
            return `    ${f.name}: one(${targetTable}, {
      fields: [${tableName}.${f.name}],
      references: [${targetTable}.id],
    }),`;

          case "oneToMany":
            // oneToMany is typically defined on the "one" side, referencing the "many" side
            // This assumes the target collection has a foreign key back to this collection
            return `    ${f.name}: many(${targetTable}),`;

          case "manyToMany":
            const junctionTableName =
              f.options?.junctionTable ||
              this.generateJunctionTableName(tableName, targetTable, f.name);
            return `    ${f.name}: many(${targetTable}), // Through ${junctionTableName}`;

          default:
            return "";
        }
      })
      .filter(Boolean)
      .join("\n");

    return `
// Drizzle ORM Relations
export const ${tableName}Relations = relations(${tableName}, ({ one, many }) => ({
${relationDefs}
}));
`;
  }

  // ==================== TYPE MAPPING METHODS ====================

  /**
   * Map field type to SQL column type (dialect-aware)
   */
  mapFieldTypeToSQL(
    type: string,
    length?: number,
    options?: FieldDefinition["options"],
    validation?: FieldDefinition["validation"]
  ): string {
    if (this.dialect === "sqlite") {
      // SQLite type mapping - SQLite has dynamic typing, so types are simplified
      const sqliteTypeMap: Record<string, string> = {
        string: "text",
        text: "text",
        number: options?.format === "float" ? "real" : "integer",
        decimal: "real",
        boolean: "integer", // SQLite uses 0/1 for boolean
        date: "integer", // Store as Unix timestamp
        email: "text",
        password: "text",
        richtext: "text",
        json: "text", // JSON stored as text in SQLite
        chips: "text", // Chips stored as JSON text in SQLite
        relation: "text", // Store foreign key as text (UUID or ID)
      };
      return sqliteTypeMap[type] || "text";
    }

    // MySQL type mapping
    if (this.dialect === "mysql") {
      const mysqlTypeMap: Record<string, string> = {
        string: `varchar(${length || 255})`,
        text:
          options?.variant === "short"
            ? `varchar(${validation?.maxLength || 255})`
            : "text",
        number: options?.format === "float" ? "decimal(10,2)" : "integer",
        decimal: "decimal(10,2)",
        boolean: "boolean",
        date: "timestamp",
        email: `varchar(${validation?.maxLength || 255})`,
        password: `varchar(${validation?.maxLength || 255})`,
        richtext: "text",
        json: "json", // MySQL uses 'json' type, not 'jsonb'
        chips: "json", // Chips stored as JSON array
        relation: "varchar(36)", // Store foreign key as varchar(36) for UUIDs
      };
      return mysqlTypeMap[type] || "text";
    }

    // PostgreSQL type mapping (default)
    const typeMap: Record<string, string> = {
      string: `varchar(${length || 255})`,
      text:
        options?.variant === "short"
          ? `varchar(${validation?.maxLength || 255})`
          : "text",
      number: options?.format === "float" ? "decimal(10,2)" : "integer",
      decimal: "decimal(10,2)",
      boolean: "boolean",
      date: "timestamp",
      email: `varchar(${validation?.maxLength || 255})`,
      password: `varchar(${validation?.maxLength || 255})`,
      richtext: "text",
      json: "jsonb",
      chips: "jsonb", // Chips stored as JSON array
      relation: "text", // Store foreign key as text (UUID or ID)
    };
    return typeMap[type] || "text";
  }

  /**
   * Map field type to Drizzle ORM column definition
   */
  mapFieldTypeToDrizzle(field: FieldDefinition): string {
    const typeMap: Record<string, (f: FieldDefinition) => string> = {
      string: f => `varchar('${f.name}', { length: ${f.length || 255} })`,
      text: f =>
        f.options?.variant === "short"
          ? `varchar('${f.name}', { length: ${f.validation?.maxLength || 255} })`
          : `text('${f.name}')`,
      number: f =>
        f.options?.format === "float"
          ? `decimal('${f.name}', { precision: 10, scale: 2 })`
          : `integer('${f.name}')`,
      decimal: f => `decimal('${f.name}', { precision: 10, scale: 2 })`,
      boolean: f => `boolean('${f.name}')`,
      date: f => `timestamp('${f.name}')`,
      email: f =>
        `varchar('${f.name}', { length: ${f.validation?.maxLength || 255} })`,
      password: f =>
        `varchar('${f.name}', { length: ${f.validation?.maxLength || 255} })`,
      richtext: f => `text('${f.name}')`,
      json: f => `jsonb('${f.name}')`,
      chips: f => `jsonb('${f.name}')`,
      relation: f => `text('${f.name}')`, // Foreign key
    };
    const mapper = typeMap[field.type];
    return mapper ? mapper(field) : `text('${field.name}')`;
  }

  /**
   * Get a sensible default value for a field type.
   * Used when adding NOT NULL columns to existing tables.
   */
  private getDefaultValueForType(type: string): string {
    switch (type) {
      case "string":
      case "text":
      case "textarea":
      case "email":
      case "password":
      case "richText":
      case "richtext":
      case "code":
        return "''";
      case "number":
      case "decimal":
        return "0";
      case "boolean":
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
      case "blocks":
        return "'{}'";
      case "chips":
        return "'[]'";
      case "relation":
      case "relationship":
      case "upload":
        // Relations are nullable by nature when adding to existing tables
        return "NULL";
      case "select":
      case "radio":
        return "''";
      case "point":
        return this.dialect === "postgresql" ? "'(0,0)'" : '\'{"x":0,"y":0}\'';
      default:
        return "''";
    }
  }

  /**
   * Format a default value for SQL (dialect-aware)
   */
  formatDefaultValue(value: unknown, type: string): string {
    // Handle string-like types (need quotes in SQL)
    if (
      type === "string" ||
      type === "text" ||
      type === "email" ||
      type === "password" ||
      type === "richtext" ||
      type === "select" ||
      type === "radio"
    ) {
      return `'${value}'`;
    }

    // Handle boolean (SQLite uses 0/1, PostgreSQL uses TRUE/FALSE)
    if (type === "boolean") {
      if (this.dialect === "sqlite") {
        return value ? "1" : "0";
      }
      return value ? "TRUE" : "FALSE";
    }

    // Handle JSON (needs to be a quoted JSON string)
    if (type === "json") {
      return `'${typeof value === "string" ? value : JSON.stringify(value)}'`;
    }

    // Handle date/timestamp
    if (type === "date") {
      // SQLite stores timestamps as integers (Unix timestamp)
      if (this.dialect === "sqlite" && typeof value === "string") {
        // If it's a date string, convert to timestamp
        const timestamp = new Date(value).getTime() / 1000;
        return String(Math.floor(timestamp));
      }
      return `'${value}'`;
    }

    // Handle numeric types (number, decimal) - no quotes
    if (type === "number" || type === "decimal") {
      return String(value);
    }

    // Handle relation (text field, needs quotes)
    if (type === "relation") {
      return `'${value}'`;
    }

    // Default: return as-is for numbers, quote for everything else
    return String(value);
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Convert snake_case to PascalCase
   */
  toPascalCase(str: string): string {
    return str
      .charAt(0)
      .toUpperCase()
      .concat(str.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
  }

  /**
   * Convert snake_case to camelCase
   */
  toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  /**
   * Map onDelete action to SQL syntax
   */
  mapOnDeleteAction(action: string): string {
    const actionMap: Record<string, string> = {
      cascade: "CASCADE",
      "set null": "SET NULL",
      restrict: "RESTRICT",
      "no action": "NO ACTION",
    };
    return actionMap[action.toLowerCase()] || "SET NULL";
  }

  /**
   * Map onUpdate action to SQL syntax
   */
  mapOnUpdateAction(action: string): string {
    const actionMap: Record<string, string> = {
      cascade: "CASCADE",
      "set null": "SET NULL",
      restrict: "RESTRICT",
      "no action": "NO ACTION",
    };
    return actionMap[action.toLowerCase()] || "NO ACTION";
  }
}
