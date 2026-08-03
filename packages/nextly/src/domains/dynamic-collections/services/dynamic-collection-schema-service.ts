/**
 * DynamicCollectionSchemaService
 *
 * Handles SQL generation for dynamic collections:
 * - SQL migration generation (CREATE TABLE, ALTER TABLE, DROP TABLE)
 * - Junction table generation for many-to-many relationships
 * - Type mapping between field types and SQL types
 *
 * Drizzle `.ts` schema-code generation was removed: nothing imports the
 * generated files (the runtime builds its Drizzle table from
 * dynamic_collections metadata via generateRuntimeSchema), so they were
 * orphan output. Singles and components never generated them.
 *
 * Supports multiple database dialects: postgresql, mysql, sqlite
 *
 * @example
 * ```typescript
 * const schemaService = new DynamicCollectionSchemaService(validationService, 'sqlite');
 * const sql = schemaService.generateMigrationSQL('dc_posts', fields);
 * ```
 */

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { env } from "../../../shared/lib/env";
import {
  pluginEmptyColumnDefault,
  storageTypeToken,
} from "../../../shared/lib/plugin-storage";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import {
  fieldProducesColumn,
  getColumnDescriptor,
  getSystemColumnDescriptors,
  renderSystemColumnSql,
  toSnakeCase,
} from "../../schema/services/field-column-descriptor";
import { quoteJsonSqlDefault } from "../../schema/utils/sql-literal";

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
    this.dialect = dialect || env.DB_DIALECT || "postgresql";
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

  /**
   * The column type for a declared `slug`, taken from the canonical
   * descriptor rather than this class's own type map.
   *
   * Every generated table gets a UNIQUE index on `slug`, and MySQL cannot
   * index a TEXT column without a prefix length. The canonical descriptor
   * already renders a text field as `varchar(255)` on MySQL, which is exactly
   * what the runtime Drizzle table and the schema diff use for this column;
   * this class's map renders it as `text`. The DDL therefore failed on the
   * CREATE INDEX and left the table uncreated, and any table that did exist
   * disagreed with the schema every later diff compared it against.
   *
   * Scoped to `slug` because that is the column this class indexes on
   * creation. The two mappings still disagree elsewhere — see the note on
   * `mapFieldTypeToSQL`.
   */
  private canonicalSlugType(field: FieldDefinition): string | null {
    if (toSnakeCase(field.name) !== "slug") return null;
    return getColumnDescriptor(field, this.dialect)?.dialectType ?? null;
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
    _options?: {
      isSingle?: boolean;
      /**
       * When true, inject a system `status` column ('draft' | 'published',
       * default 'draft', NOT NULL) so collections / singles that opt into
       * the Draft/Published lifecycle can persist the per-entry status.
       *
       * Without this, the Builder UI would persist `status: true` on
       * `dynamic_collections.status` but the data table (`dc_<slug>` or
       * `single_<slug>`) wouldn't have a column to write to, and the
       * first INSERT would fail with "table dc_X has no column named
       * status". Mirrors the runtime schema generator's `status` option
       * so the Drizzle table descriptor and the physical DDL stay in
       * lockstep.
       */
      hasStatus?: boolean;
      /**
       * i18n: when true, translatable fields are omitted from this (main) table's
       * CREATE — they live in the companion `<table>_locales` table. Mirrors the
       * runtime schema generator so the physical DDL and the Drizzle descriptor
       * stay in lockstep for a UI-created localized collection.
       */
      localized?: boolean;
    }
  ): string {
    const constraints: string[] = [];
    const checks: string[] = [];
    const junctionTables: string[] = [];

    // i18n: drop translatable fields from the main table when localized (they go to
    // the companion). Uses the shared classifier so main/companion agree on the split.
    const mainFields = _options?.localized
      ? fields.filter(
          f => !resolveLocalizedFieldNames([f], true).includes(f.name)
        )
      : fields;

    const columns = mainFields
      .map(f => {
        // Skip many-to-many fields as they don't create columns in the main table
        if (
          f.type === "relationship" &&
          f.options?.relationType === "manyToMany"
        ) {
          return null;
        }

        // Component fields store their data in a separate comp_{slug} table and
        // are stripped from the parent row on write, so they get no parent
        // column (a NOT NULL one would break every insert).
        if (f.type === STORAGE_FORMAT.fieldType) {
          return null;
        }

        const type =
          this.canonicalSlugType(f) ??
          this.mapFieldTypeToSQL(f.type, f.length, f.options, f.validation);
        const nullable = f.required ? "NOT NULL" : "";

        // one-to-one relationships should be unique
        const unique =
          f.unique ||
          (f.type === "relationship" && f.options?.relationType === "oneToOne")
            ? "UNIQUE"
            : "";

        const defaultVal =
          f.default !== undefined && f.default !== null
            ? `DEFAULT ${this.formatDefaultValue(f.default, f.type)}`
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
              f.type === "textarea" ||
              f.type === "email" ||
              f.type === "password" ||
              f.type === "code")
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
                `${this.quoteIdentifier(toSnakeCase(f.name))} REGEXP '${escapedRegex}'`
              );
            } else {
              checks.push(
                `${this.quoteIdentifier(toSnakeCase(f.name))} ~ '${escapedRegex}'`
              );
            }
          }
        }

        // Handle relations (foreign keys)
        if (f.type === "relationship" && f.options?.target) {
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

            const fkColName = toSnakeCase(f.name);
            constraints.push(
              `  CONSTRAINT ${this.quoteIdentifier(`fk_${tableName}_${fkColName}`)} FOREIGN KEY (${this.quoteIdentifier(fkColName)}) REFERENCES ${this.quoteIdentifier(targetTable)}(${this.quoteIdentifier("id")}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
            );
          }
        }

        // Convert camelCase field names to snake_case for column names
        // (matches the convention used by CollectionEntryService)
        const colName = toSnakeCase(f.name);
        return `  ${this.quoteIdentifier(colName)} ${type} ${nullable} ${unique} ${defaultVal}`.trim();
      })
      .filter(Boolean)
      .join(",\n");

    // Collect all column/constraint definitions into an array and join at
    // the end. The old approach appended each piece to `sql` with a
    // hardcoded trailing comma (e.g. `"slug" text NOT NULL,\n`). When
    // `columns` is empty (no user-defined fields), that left a dangling
    // comma before the timestamp section, producing invalid SQL.
    const allColumnDefs: string[] = [];

    // System columns, rendered from the one list that defines them rather than restated here.
    // Restating them is how a newly added system column reached the runtime schema and missed the
    // physical table: the generated SELECT then names a column that does not exist and every read
    // of the entity fails. Iterating the list — rather than sourcing each column in place — is
    // what makes that impossible, since a new entry needs no edit here to be created.
    //
    // A field that produces no column must not suppress the system title or slug column, or the
    // table would have neither: a component and a many-to-many relationship both keep their values
    // in their own tables. Asked through the shared predicate rather than a list of the types this
    // file remembers, because the runtime schema and the diff ask it that way and all three have to
    // reach the same answer.
    //
    // Matched on the COLUMN the field becomes rather than on its declared name. An author writing
    // `Title` means the same column, and comparing the raw name would inject the system one beside
    // it — two columns of the same name, which no dialect will create.
    const declaresColumn = (column: string) =>
      fields.some(
        f =>
          typeof f.name === "string" &&
          toSnakeCase(f.name) === column &&
          fieldProducesColumn(f)
      );
    const hasTitleField = declaresColumn("title");
    const hasSlugField = declaresColumn("slug");
    // A single is one global row, so owner-only ownership is meaningless and it gets no
    // `created_by`. Prefer the explicit flag, but fall back to the `single_` table prefix so this
    // stays in lockstep with the runtime schema and the diff, which derive it from the name, even
    // when a caller omits the option.
    const isSingleTable =
      _options?.isSingle === true || tableName.startsWith("single_");

    for (const systemColumn of getSystemColumnDescriptors(this.dialect, {
      hasTitleField,
      hasSlugField,
      hasStatus: _options?.hasStatus === true,
      isSingle: isSingleTable,
    })) {
      allColumnDefs.push(
        `  ${renderSystemColumnSql(systemColumn, name => this.quoteIdentifier(name))}`
      );
    }

    // user-defined columns (may be multi-line, already comma-separated internally)
    if (columns.length > 0) {
      allColumnDefs.push(columns);
    }

    // CHECK constraints
    if (checks.length > 0) {
      allColumnDefs.push(
        `  CONSTRAINT ${this.quoteIdentifier(`chk_${tableName}_validation`)} CHECK (${checks.join(" AND ")})`
      );
    }

    // FK constraints (each already indented)
    for (const c of constraints) {
      allColumnDefs.push(c);
    }

    let sql = `-- Create dynamic collection: ${tableName}
CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(tableName)} (
${allColumnDefs.join(",\n")}
);`;

    // Generate many-to-many junction tables
    fields.forEach(f => {
      if (
        f.type === "relationship" &&
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
    // Use mainFields so a localized relationship field (relocated to the companion) doesn't
    // get an index on a column the main table no longer has.
    mainFields.forEach(f => {
      if (
        f.type === "relationship" &&
        f.options?.relationType !== "manyToMany"
      ) {
        // Use the snake_case column name for both the index name and the
        // indexed column so this matches the actual physical column (created
        // snake_cased) and the migrate:create desired-state index naming.
        const col = toSnakeCase(f.name);
        const indexName = `idx_${tableName}_${col}`;
        if (this.dialect === "mysql") {
          indexStatements.push(
            `CREATE INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(col)});`
          );
        } else {
          indexStatements.push(
            `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(col)});`
          );
        }
      }
    });

    // Add manual indexes requested by the user. Use mainFields so a localized field
    // that also requested an index doesn't try to index a column relocated to the
    // companion table (i18n). Component fields have no column to index, so skip them
    // too (an index on a nonexistent column fails).
    mainFields.forEach(f => {
      if (
        f.index &&
        f.type !== "relationship" &&
        f.type !== STORAGE_FORMAT.fieldType
      ) {
        const col = toSnakeCase(f.name);
        const indexName = `idx_${tableName}_${col}`;
        if (this.dialect === "mysql") {
          indexStatements.push(
            `CREATE INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(col)});`
          );
        } else {
          indexStatements.push(
            `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(col)});`
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

    // Index the owner column on collections. Owner-only reads/lists/counts and
    // bulk-by-query enumeration all filter on `created_by`, so without an index
    // a large owner-scoped collection would full-scan the primary access-control
    // predicate. Collections only — singles/components never carry the column,
    // mirroring the column gate above. Plain (non-unique) index; users cannot
    // request one on this reserved field, so it is injected here.
    if (!isSingleTable) {
      const ownerIndexName = `idx_${tableName}_created_by`;
      const ownerIndex =
        this.dialect === "mysql"
          ? `CREATE INDEX ${this.quoteIdentifier(ownerIndexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_by")});`
          : `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(ownerIndexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_by")});`;
      indexStatements.push(ownerIndex);
    }

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
    newFields: FieldDefinition[],
    options?: {
      /**
       * Previous Draft/Published flag — pass `existing.status === true` so
       * the diff knows whether the table currently has a `status` column.
       */
      wasStatus?: boolean;
      /**
       * New Draft/Published flag — pass the toggle value the user is
       * saving so the diff can ADD or DROP the `status` column when the
       * lifecycle is enabled or disabled. Pairs with `wasStatus`.
       */
      hasStatus?: boolean;
    }
  ): string {
    const statements: string[] = [`-- Update dynamic collection: ${tableName}`];

    // Status system column flip (enable / disable Draft/Published). When
    // turning ON, ADD COLUMN with default 'draft' so existing rows get
    // backfilled. When turning OFF, DROP COLUMN — SQLite 3.35+, MySQL,
    // and PostgreSQL all support this. We don't preserve the column when
    // toggling off because the user explicitly opted out of the lifecycle;
    // re-enabling later would re-add the column with default 'draft'.
    //
    // DROP fires only on an *explicit* `hasStatus: false`. Undefined is
    // treated as "leave the column alone" so a missing flag from any
    // caller can't accidentally strip Draft/Published.
    const wasStatus = options?.wasStatus === true;
    const hasStatus = options?.hasStatus === true;
    if (
      wasStatus !== hasStatus &&
      (hasStatus || options?.hasStatus === false)
    ) {
      // The columns the lifecycle owns, derived by asking the descriptor for the set with the
      // lifecycle on and again with it off: whatever only the first has is what enabling adds and
      // disabling removes. Naming `status` here instead is how the first-publication marker came
      // to be expected by the runtime schema while this toggle never created it — the runtime
      // schema reads the same descriptor, so a column added there arrives here for free.
      const isSingleTable = tableName.startsWith("single_");
      const forFlag = (flag: boolean) =>
        getSystemColumnDescriptors(this.dialect, {
          hasTitleField: false,
          hasSlugField: false,
          hasStatus: flag,
          isSingle: isSingleTable,
        });
      const withoutLifecycle = new Set(forFlag(false).map(c => c.name));
      const lifecycleColumns = forFlag(true).filter(
        c => !withoutLifecycle.has(c.name)
      );

      for (const column of lifecycleColumns) {
        statements.push(
          hasStatus
            ? `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD COLUMN ${renderSystemColumnSql(column, name => this.quoteIdentifier(name))};`
            : `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP COLUMN ${this.quoteIdentifier(column.name)};`
        );
      }
    }

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
      const fromCol = toSnakeCase(rename.from.name);
      const toCol = toSnakeCase(rename.to.name);
      // Two spellings of one column — `foo_bar` to `FooBar` — are a rename in the config and no
      // change at all in the database. Emitting it anyway asks the dialect to rename a column to
      // its own name, which PostgreSQL rejects because the target already exists, failing an
      // update that has nothing to do. The pair still skips the add/drop loops below, so the
      // column is neither dropped nor re-added.
      if (fromCol !== toCol) {
        // RENAME COLUMN syntax is consistent across PG, MySQL 8.0+,
        // and SQLite 3.25+ — all dialects we support.
        statements.push(
          `ALTER TABLE ${this.quoteIdentifier(tableName)} RENAME COLUMN ${this.quoteIdentifier(fromCol)} TO ${this.quoteIdentifier(toCol)};`
        );
      }
    }

    // Find added fields
    for (const field of newFields) {
      // Phase D: skip the renamed target — it's already been handled
      // above as ALTER TABLE RENAME COLUMN.
      if (field.name === renamedToName) continue;
      if (!oldFieldMap.has(field.name)) {
        // Skip manyToMany fields - they don't get columns, they get junction tables
        if (
          field.type === "relationship" &&
          field.options?.relationType === "manyToMany"
        ) {
          // Generate junction table instead
          const junctionSQL = this.generateJunctionTable(tableName, field);
          statements.push(junctionSQL);
          continue;
        }

        // Component fields store their data in a separate comp_{slug} table, so
        // adding one must not ADD COLUMN on the parent table.
        if (field.type === STORAGE_FORMAT.fieldType) {
          continue;
        }

        const type = this.mapFieldTypeToSQL(field.type, field.length);
        const nullable = field.required ? "NOT NULL" : "";

        // When adding a NOT NULL column to an existing table, we must provide a default
        // value for existing rows. Use explicit defaultValue if provided, otherwise
        // use a sensible default based on field type.
        let defaultVal = "";
        if (field.default !== undefined) {
          defaultVal = `DEFAULT ${this.formatDefaultValue(field.default, field.type)}`;
        } else if (field.required) {
          // Required field without explicit default - provide sensible default for existing rows
          defaultVal = `DEFAULT ${this.getDefaultValueForType(field.type, field)}`;
        }

        const addColName = toSnakeCase(field.name);
        statements.push(
          `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD COLUMN ${this.quoteIdentifier(addColName)} ${type} ${nullable} ${defaultVal};`.trim()
        );

        // SQLite doesn't support adding constraints separately via ALTER TABLE
        // Foreign keys and unique constraints must be defined at table creation
        // For PostgreSQL/MySQL, we can add them
        if (this.dialect !== "sqlite") {
          // Add foreign key for non-manyToMany relations
          if (field.type === "relationship" && field.options?.target) {
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
      // A field with no parent column has no index to add or drop. Asked through the shared
      // predicate: a many-to-many relationship has no column either, and indexing one emitted
      // CREATE INDEX against a name the table does not have, which fails the whole save.
      if (!fieldProducesColumn(field)) continue;
      const oldField = oldFieldMap.get(field.name);
      if (oldField && oldField.index !== field.index) {
        const idxCol = toSnakeCase(field.name);
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
      // A field with no parent column has nothing to drop, and SQLite's DROP COLUMN has no
      // IF EXISTS to tolerate the absence. A many-to-many relationship is in that set too: its
      // links live in a junction table, so dropping one must not touch the parent.
      if (!fieldProducesColumn(field)) continue;
      if (!newFieldMap.has(field.name)) {
        const dropCol = toSnakeCase(field.name);
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
        // A field with no parent column has nothing to alter. Toggling `required` on a
        // many-to-many emitted ALTER COLUMN against a name the table does not have.
        if (!fieldProducesColumn(field)) continue;
        const oldField = oldFieldMap.get(field.name);
        if (oldField && this.isFieldModified(oldField, field)) {
          const alterCol = toSnakeCase(field.name);
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

    const from = oldOnly[0];
    const to = newOnly[0];

    if (!this.areFieldTypesCompatible(from, to)) {
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
    if (a.type === "relationship" && a.options?.relationType === "manyToMany") {
      return false;
    }
    if (a.type === "relationship") {
      return (
        a.options?.target === b.options?.target &&
        a.options?.relationType === b.options?.relationType
      );
    }
    return true;
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

    // The localized companion is excluded from the schema pipeline, so nothing else in a
    // replayed migration would remove it. It carries an FK to `<main>.id` and therefore has
    // to be dropped BEFORE the main table. IF EXISTS keeps this a no-op for collections that
    // were never localized, and for the API delete path that already tore it down in-process.
    const dropCompanionStatement = `DROP TABLE IF EXISTS ${this.quoteIdentifier(`${tableName}_locales`)};`;

    const migrationSQL = `-- Drop dynamic collection: ${collectionName}
${dropCompanionStatement}
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

    // The result is split on `--> statement-breakpoint` and each part executed
    // as one statement, so every part must be a complete, standalone statement:
    // one CREATE TABLE (closed by its own `);`), then the two CREATE INDEX
    // statements. The UNIQUE pair constraint belongs inside the CREATE TABLE
    // body only; it must not appear again as a trailing fragment (a bare
    // `CONSTRAINT ... );` is not valid SQL on any dialect).
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

  // ==================== TYPE MAPPING METHODS ====================

  /**
   * Map field type to SQL column type (dialect-aware)
   *
   * This is a SECOND field-to-column mapping. The canonical one is
   * `getColumnDescriptor` in `domains/schema/services/field-column-descriptor`,
   * which the runtime Drizzle table and the schema diff both read, and the two
   * do not agree: a plain `text` field renders here as `text` on MySQL and as
   * `varchar(255)` there. A table created from this map is therefore compared
   * against a schema that describes it differently.
   *
   * Only the `slug` column is routed to the canonical descriptor so far — see
   * `canonicalSlugType` — because that is the one this class indexes on
   * creation, where the disagreement stops being cosmetic and refuses the DDL
   * outright. Converging the rest belongs with the column-descriptor
   * consolidation rather than with a per-column patch.
   */
  mapFieldTypeToSQL(
    declaredType: string,
    length?: number,
    options?: FieldDefinition["options"],
    validation?: FieldDefinition["validation"]
  ): string {
    // A contributed type persists as its storage primitive, and this map has
    // never heard of the token it is declared under. Left unresolved it falls
    // through to `text`, so the column the DDL creates and the column the ORM
    // binds describe different things. The same resolution `getColumnDescriptor`
    // and the missing-column scan already make.
    const type = storageTypeToken({ type: declaredType }) ?? declaredType;

    if (this.dialect === "sqlite") {
      // SQLite type mapping. SQLite has dynamic typing, so types are simplified.
      const sqliteTypeMap: Record<string, string> = {
        text: "text",
        textarea: "text",
        number: options?.format === "float" ? "real" : "integer",
        checkbox: "integer", // SQLite uses 0/1 for boolean
        date: "integer", // Store as Unix timestamp
        email: "text",
        password: "text",
        code: "text",
        richText: "text",
        json: "text", // JSON stored as text in SQLite
        chips: "text", // Chips stored as JSON text in SQLite
        relationship: "text", // Store foreign key as text (UUID or ID)
      };
      return sqliteTypeMap[type] || "text";
    }

    // MySQL type mapping
    if (this.dialect === "mysql") {
      const mysqlTypeMap: Record<string, string> = {
        text:
          options?.variant === "short"
            ? `varchar(${validation?.maxLength || 255})`
            : "text",
        textarea: "text",
        number: options?.format === "float" ? "decimal(10,2)" : "integer",
        checkbox: "boolean",
        date: "timestamp",
        email: `varchar(${validation?.maxLength || 255})`,
        password: `varchar(${validation?.maxLength || 255})`,
        code: "text",
        richText: "text",
        json: "json", // MySQL uses 'json' type, not 'jsonb'
        chips: "json", // Chips stored as JSON array
        relationship: "varchar(36)", // Store foreign key as varchar(36) for UUIDs
      };
      return mysqlTypeMap[type] || "text";
    }

    // PostgreSQL type mapping (default)
    const typeMap: Record<string, string> = {
      text:
        options?.variant === "short"
          ? `varchar(${validation?.maxLength || 255})`
          : "text",
      textarea: "text",
      number: options?.format === "float" ? "decimal(10,2)" : "integer",
      checkbox: "boolean",
      date: "timestamp",
      email: `varchar(${validation?.maxLength || 255})`,
      password: `varchar(${validation?.maxLength || 255})`,
      code: "text",
      richText: "text",
      json: "jsonb",
      chips: "jsonb", // Chips stored as JSON array
      relationship: "text", // Store foreign key as text (UUID or ID)
    };
    return typeMap[type] || "text";
  }

  /**
   * Get a sensible default value for a field type.
   * Used when adding NOT NULL columns to existing tables.
   */
  private getDefaultValueForType(
    type: string,
    field?: Partial<FieldDefinition>
  ): string {
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
        return quoteJsonSqlDefault("{}", this.dialect);
      case "chips":
        return quoteJsonSqlDefault("[]", this.dialect);
      case "relationship":
      case "upload":
        // Relations are nullable by nature when adding to existing tables
        return "NULL";
      case "select":
      case "radio":
        return "''";
      default:
        return "''";
    }
  }

  /**
   * Format a default value for SQL (dialect-aware)
   */
  formatDefaultValue(value: unknown, declaredType: string): string {
    // Resolved for the same reason the type map is: a contributed token names
    // none of the branches below, so a structured default would fall through
    // to the string arm and be written as `[object Object]`.
    const type = storageTypeToken({ type: declaredType }) ?? declaredType;

    // Handle string-like types (need quotes in SQL)
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

    // Handle checkbox (SQLite uses 0/1, PostgreSQL uses TRUE/FALSE)
    if (type === "checkbox") {
      if (this.dialect === "sqlite") {
        return value ? "1" : "0";
      }
      return value ? "TRUE" : "FALSE";
    }

    // Handle JSON (needs to be a quoted JSON string)
    if (type === "json") {
      return quoteJsonSqlDefault(
        typeof value === "string" ? value : JSON.stringify(value),
        this.dialect
      );
    }

    // Handle date/timestamp
    if (type === "date") {
      // SQLite stores timestamps as integers (Unix timestamp)
      if (this.dialect === "sqlite" && typeof value === "string") {
        // If it's a date string, convert to timestamp
        const timestamp = new Date(value).getTime() / 1000;
        return String(Math.floor(timestamp));
      }
      return `'${String(value)}'`;
    }

    // Handle numeric types (no quotes)
    if (type === "number") {
      return String(value);
    }

    // Handle relationship (text field, needs quotes)
    if (type === "relationship") {
      return `'${String(value)}'`;
    }

    // Default: return as-is for numbers, quote for everything else
    return String(value);
  }

  // ==================== UTILITY METHODS ====================

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
