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

import { NextlyError } from "../../../errors/nextly-error";
import {
  validateNumberDecimalDimensionsShared,
  type BaseValidationError,
} from "../../../shared/base-validator";
import { env } from "../../../shared/lib/env";
import {
  pluginEmptyColumnDefault,
  storageTypeToken,
} from "../../../shared/lib/plugin-storage";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { generateSQL } from "../../schema/pipeline/sql-templates/index";
import {
  fieldProducesColumn,
  usesJunctionTable,
  getColumnDescriptor,
  getSystemColumnDescriptors,
  renderSystemColumnSql,
  toSnakeCase,
} from "../../schema/services/field-column-descriptor";
import {
  columnTypeIsIndexable,
  indexNameForColumn,
  uniqueIndexNameForColumn,
  uniquenessCanBeAnIndex,
} from "../../schema/services/index-name";
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
    // Asked as the builder this service IS. The descriptor bounds a slug column for every builder,
    // because the index needs a column MySQL can index and that is a property of the column rather
    // than of whoever created the table — so naming the real builder here is both honest and safe.
    // The rule lives there and not here so the paths that ADD a slug column to an existing table
    // reach it too; encoded only at this creator, a repaired table disagreed with a fresh one.
    return (
      getColumnDescriptor(field, this.dialect, "collection")?.dialectType ??
      null
    );
  }

  /**
   * Whether a field kept its name but moved between storage classes.
   *
   * A junction-backed field has no column on this row and a row-backed one has no junction table,
   * so changing between them is not a modification of anything: it is a removal from one storage
   * and an addition to the other. Read as a modification instead, it produced an ALTER COLUMN
   * against a name the table never had.
   *
   * Column production is the same kind of move: a plain type edited into a field group keeps its
   * name but leaves the parent row, so the old column must be dropped, and the reverse must ADD
   * one. Comparing only junction usage judged neither transition a storage-class change — the
   * plain type's column stayed behind as a ghost the next sync then offered to remove, and the
   * reverse was treated as a modification of a column that did not exist.
   */
  private storageClassChanged(
    previous: FieldDefinition,
    next: FieldDefinition
  ): boolean {
    return (
      fieldProducesColumn(previous) !== fieldProducesColumn(next) ||
      usesJunctionTable(previous) !== usesJunctionTable(next)
    );
  }

  /**
   * Whether the field's column is unique.
   *
   * A one-to-one relationship is unique by its cardinality, not by anything the author ticks, so
   * the flag alone does not decide it. Asked in one place because the answer has to be the same
   * whether the column arrives with its table or is added to one that already exists: a table
   * that gained its one-to-one by an edit was not enforcing the cardinality it declared.
   */
  private columnIsUnique(field: FieldDefinition): boolean {
    return (
      field.unique === true ||
      (field.type === "relationship" &&
        field.options?.relationType === "oneToOne")
    );
  }

  /**
   * The statement that makes a column unique, in the one spelling everything else expects.
   *
   * `uq_<table>_<column>` is what the desired schema declares for a unique field and what the
   * add-column path already emits, so a column that arrives with its table and the same column
   * added by a later edit now produce the same object. Asked in one place because the previous
   * arrangement — inline at create, named on add — made a table's physical shape depend on WHEN
   * the column appeared.
   *
   * MySQL is the exception on `IF NOT EXISTS`: it rejects the clause on CREATE INDEX rather than
   * ignoring it.
   */
  private uniqueIndexSql(tableName: string, column: string): string {
    const name = this.quoteIdentifier(
      uniqueIndexNameForColumn(tableName, column)
    );
    const target = `${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(column)})`;
    return this.dialect === "mysql"
      ? `CREATE UNIQUE INDEX ${name} ON ${target};`
      : `CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${target};`;
  }

  /**
   * Whether this dialect can carry the uniqueness as a NAMED index on this column.
   *
   * Delegates to the shared rule rather than restating it. This class, the add-column path and the
   * desired schema all decide the same thing about the same column, and a copy here that agreed on
   * the day it was written would drift silently — both spellings look correct in isolation, and
   * the disagreement only shows up as a diff proposing an index the generator never writes.
   *
   * Bounding a MySQL text column would make it keyable, and is the right end state, but it belongs
   * in the shared column descriptor: bounding it HERE alone makes the created column disagree with
   * the type the desired schema derives, and the next reconciliation tries to convert it back —
   * which MySQL cannot do while a full-value unique index stands on it.
   */
  private uniquenessCanBeAnIndex(rendered: string): boolean {
    return uniquenessCanBeAnIndex(rendered, this.dialect);
  }

  /**
   * The name of the UNIQUE index the create path emits for this field, or null when it emits none.
   *
   * Asked by the emitter and by `plannedAttachments` alike, so a prediction of what a create
   * artefact installs cannot disagree with what it installs. When only the emitter knew, a create
   * that had not been deployed yet still added this index, while the edit that followed emitted a
   * bare `DROP COLUMN` — which SQLite refuses while any index still names the column.
   */
  private plannedUniqueIndexName(
    tableName: string,
    field: FieldDefinition
  ): string | null {
    if (field.unique !== true || !fieldProducesColumn(field)) return null;
    // `slug` already carries a UNIQUE index that every generated table gets
    // unconditionally, so a field declaring `unique: true` on it would be asking for a
    // second index over the same column. The desired schema keeps only the system one —
    // `dedupeIndexes` discards the field-specific duplicate as logically identical — so
    // emitting both makes a freshly created table disagree with its own snapshot, and
    // every write maintains two identical unique indexes until a reconcile drops one.
    if (toSnakeCase(field.name) === "slug") return null;
    const rendered =
      this.canonicalSlugType(field) ??
      this.mapFieldTypeToSQL(
        field.type,
        field.length,
        field.options,
        field.validation,
        field
      );
    if (!this.uniquenessCanBeAnIndex(rendered)) return null;
    return uniqueIndexNameForColumn(tableName, toSnakeCase(field.name));
  }

  /**
   * Whether the field's column is indexed.
   *
   * A relationship is indexed whether or not the author asked: it is joined on every read that
   * expands it, and PostgreSQL does not index a foreign key on its own. Everything else is
   * indexed only on request. Asked in one place for the same reason as `columnIsUnique` — a
   * column added to an existing table was reaching neither rule, so a relationship created with
   * its table was indexed and the identical field added by an edit was not.
   */
  private columnIsIndexed(field: FieldDefinition): boolean {
    if (!fieldProducesColumn(field)) return false;
    if (field.type === "relationship") return true;
    return field.index === true;
  }

  /**
   * What happens to this row when the row it points at is deleted.
   *
   * A required relationship cannot be nulled out: the column forbids it. MySQL says so when the
   * constraint is created — "Column cannot be NOT NULL: needed in a foreign key constraint SET
   * NULL" — and PostgreSQL accepts the pair and fails later, at the delete, which is worse. So a
   * required relationship restricts the delete instead, and an optional one nulls the reference.
   * That is the same rule Prisma applies, for the same reason: the action has to be one the
   * column can actually perform.
   */
  private relationOnDelete(field: FieldDefinition): string {
    const declared = field.options?.onDelete;
    if (declared === undefined) return field.required ? "restrict" : "set null";

    // Declared, and still impossible: nulling a reference the column forbids cannot be done by
    // any database. MySQL refuses the constraint outright; PostgreSQL accepts it and fails
    // later, when a referenced row is deleted, which is worse because it ships. Refused rather
    // than quietly rewritten — the author asked for a specific behaviour on delete, and
    // substituting a different one silently is not an answer to that.
    //
    // Prisma treats the same pair as a schema error for the same reason.
    if (declared === "set null" && field.required) {
      throw NextlyError.validation({
        errors: [
          {
            path: `fields.${field.name}`,
            code: "REQUIRED_RELATION_CANNOT_SET_NULL",
            message:
              `"${field.name}" is required, so it cannot be emptied when the ${field.type} ` +
              `it points at is deleted. Choose "restrict" to prevent that deletion, ` +
              `"cascade" to delete this entry with it, or make the field optional.`,
          },
        ],
        logContext: { field: field.name, onDelete: declared },
      });
    }
    return declared;
  }

  /**
   * Every name this generator may have given one column's index, current first.
   *
   * Bounding long names changed what they are called, and an index already in a database still
   * carries the name it was created under. Looking only for the current one leaves the old index
   * in place while the field records that it was removed — the table then keeps enforcing
   * something the schema no longer says. The dialects even disagree on the legacy name: SQLite
   * stored it whole, PostgreSQL truncated it to 63 characters, and MySQL could not create it at
   * all, so an over-long name never existed there to find.
   *
   * Which of these the table actually has is decided by the live index list, never guessed.
   */

  /**
   * Every name this generator may have given one column's index, current first.
   *
   * Bounding long names changed what they are called, and an index already in a database still
   * answers to the name it was created under. Looking only for the current one leaves the old
   * index in place while the field records that it was removed. The dialects even disagree on
   * the legacy name: SQLite stored it whole, PostgreSQL truncated it to 63 characters, and
   * MySQL could not create an over-long one at all, so none exists there to find.
   *
   * Which of these the table actually has is decided by the live index list, never guessed.
   */
  /**
   * The names a column's UNIQUE index may carry, for the paths that REMOVE the column.
   *
   * Deliberately NOT part of `indexNameCandidates`. That list is also consulted when a field merely
   * turns its `index` flag off while staying unique, and a `uq_` name in it makes that path drop the
   * uniqueness itself — losing a guarantee the field still declares.
   */
  private uniqueIndexNameCandidates(
    tableName: string,
    column: string
  ): string[] {
    return [
      ...new Set([
        uniqueIndexNameForColumn(tableName, column),
        `uq_${tableName}_${column}`,
      ]),
    ];
  }

  private indexNameCandidates(tableName: string, column: string): string[] {
    const full = `idx_${tableName}_${column}`;
    const candidates = [indexNameForColumn(tableName, column), full];
    if (this.dialect === "postgresql") candidates.push(full.slice(0, 63));
    return [...new Set(candidates)];
  }

  /**
   * `CREATE INDEX` for one column, in the spelling the dialect accepts.
   *
   * MySQL cannot index a `BLOB`/`TEXT` column without a key length and rejects the statement
   * outright, so a text-backed column is indexed by prefix. 191 characters is the longest prefix
   * that fits the 767-byte index limit under utf8mb4 on every InnoDB row format, including the
   * compact ones where a longer prefix is refused. PostgreSQL and SQLite index the whole value.
   */
  private createIndexSql(
    tableName: string,
    column: string,
    columnType: string
  ): string | null {
    const name = this.quoteIdentifier(indexNameForColumn(tableName, column));
    const table = this.quoteIdentifier(tableName);
    const quoted = this.quoteIdentifier(column);
    // Asked through the shared rule, which the desired schema reads too: an index only one of
    // them believes in is proposed by every diff and refused by every apply.
    if (!columnTypeIsIndexable(columnType, this.dialect)) return null;
    if (this.dialect === "mysql") {
      const target = /\b(text|blob)\b/i.test(columnType)
        ? `${quoted}(191)`
        : quoted;
      return `CREATE INDEX ${name} ON ${table}(${target});`;
    }
    return `CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${quoted});`;
  }

  /**
   * `DROP INDEX` for one column's index, in the spelling the dialect accepts.
   *
   * Emitted before the column it names: SQLite refuses `DROP COLUMN` while any index still
   * references the column, reporting it as a missing column inside the index rather than as the
   * removal it refused.
   */
  private dropIndexSql(tableName: string, indexName: string): string {
    const name = this.quoteIdentifier(indexName);
    if (this.dialect === "mysql") {
      return `DROP INDEX ${name} ON ${this.quoteIdentifier(tableName)};`;
    }
    return `DROP INDEX IF EXISTS ${name};`;
  }

  /**
   * The literal that backfills existing rows when a required column is added, or null when the
   * field's type states none.
   *
   * A relationship is the case with no answer: every id the generator could write references a
   * row that does not exist, and `DEFAULT NULL` does not satisfy `NOT NULL` on any dialect.
   */
  private requiredColumnBackfill(field: FieldDefinition): string | null {
    const literal =
      field.default !== undefined
        ? this.formatDefaultValue(field.default, field.type)
        : this.getDefaultValueForType(field.type, field);
    // `NULL` is the absence of an answer however it was arrived at. Read from the explicit
    // default it is a contradiction with the required flag; derived from the type it is the
    // relationship case. Neither satisfies NOT NULL, so both are reported the same way.
    return literal === "NULL" ? null : literal;
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
    // Refuse an unusable decimal shape before any of it becomes SQL.
    this.assertDecimalDimensions(fields);

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
        // Component and field-group fields store their data in separate tables and
        // are stripped from the parent row on write, so they get no parent
        // column (a NOT NULL one would break every insert).
        if (!fieldProducesColumn(f)) {
          return null;
        }

        const type =
          this.canonicalSlugType(f) ??
          this.mapFieldTypeToSQL(f.type, f.length, f.options, f.validation, f);
        const nullable = f.required ? "NOT NULL" : "";

        // A one-to-one keeps its inline `UNIQUE`, and ONLY a one-to-one.
        //
        // Its cardinality has no other enforcement anywhere — no constraint, no index, no runtime
        // check — so removing this would silently let a one-to-one hold duplicates. The declared
        // `unique: true` case moves to a named index below; this one cannot follow it yet, because
        // the desired schema declares a one-to-one's index as NON-unique, and emitting a unique one
        // here would drift from that on every table carrying a one-to-one.
        //
        // Reconciling that means changing what the desired schema declares, which would then
        // propose ADDING a unique index to existing one-to-one columns — a statement that fails
        // wherever duplicates were already allowed in. That needs a precondition and a decision,
        // not a quiet edit here.
        const unique =
          this.columnIsUnique(f) &&
          (f.unique !== true || !this.uniquenessCanBeAnIndex(type))
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
            const onDelete = this.mapOnDeleteAction(this.relationOnDelete(f));
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
      if (usesJunctionTable(f) && f.options?.target) {
        const junctionTableSQL = this.generateJunctionTable(tableName, f);
        junctionTables.push(junctionTableSQL);
      }
    });

    // Add indexes for fields that benefit from indexing
    const indexStatements: string[] = [];

    // A relationship is indexed for JOIN performance whether or not it was asked for, and every
    // other column only on request; `columnIsIndexed` holds both rules, and the ALTER path reads
    // the same one so a column added later is indexed the way the same column created here is.
    // Use mainFields so a localized field (relocated to the companion) doesn't get an index on a
    // column the main table no longer has.
    mainFields.forEach(f => {
      if (this.columnIsIndexed(f)) {
        // Use the snake_case column name for both the index name and the
        // indexed column so this matches the actual physical column (created
        // snake_cased) and the migrate:create desired-state index naming.
        const col = toSnakeCase(f.name);
        const indexSql = this.createIndexSql(
          tableName,
          col,
          this.mapFieldTypeToSQL(f.type, f.length, f.options, f.validation, f)
        );
        if (indexSql) indexStatements.push(indexSql);
      }
    });

    // Uniqueness is a NAMED index, never a column-level `UNIQUE` inside CREATE TABLE.
    //
    // An inline constraint is anonymous: the server names its backing index, and on SQLite that is
    // an internal `sqlite_autoindex_*` which no statement can reference or drop. Nothing downstream
    // can then track it — so the desired schema, which declares `uq_<table>_<column>`, disagreed
    // with every table that had one, and the disagreement is only resolvable by rebuilding the
    // table. It also made a `unique: true` column impossible to drop on SQLite, since the constraint
    // outlives every index drop.
    //
    // The flag alone, NOT `columnIsUnique`: a one-to-one relationship is unique by cardinality, and
    // the desired schema gives it a NON-unique index. Emitting a unique one here would be a third
    // spelling of the same property, and the next diff would propose dropping it.
    mainFields.forEach(f => {
      if (this.plannedUniqueIndexName(tableName, f) === null) return;
      indexStatements.push(this.uniqueIndexSql(tableName, toSnakeCase(f.name)));
    });

    // For now, we'll add it as it's a common pattern in most applications
    // This can be made configurable in the future via collection settings
    // Note: SQLite doesn't support DESC in CREATE INDEX, only in ORDER BY
    // Note: MySQL 5.7 doesn't support IF NOT EXISTS for CREATE INDEX
    let createdAtIndex = "";
    if (this.dialect === "sqlite") {
      createdAtIndex = `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexNameForColumn(tableName, "created_at"))} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_at")});`;
    } else if (this.dialect === "mysql") {
      createdAtIndex = `CREATE INDEX ${this.quoteIdentifier(indexNameForColumn(tableName, "created_at"))} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_at")} DESC);`;
    } else {
      createdAtIndex = `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexNameForColumn(tableName, "created_at"))} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_at")} DESC);`;
    }
    indexStatements.push(createdAtIndex);

    // Index the owner column on collections. Owner-only reads/lists/counts and
    // bulk-by-query enumeration all filter on `created_by`, so without an index
    // a large owner-scoped collection would full-scan the primary access-control
    // predicate. Collections only — singles/components never carry the column,
    // mirroring the column gate above. Plain (non-unique) index; users cannot
    // request one on this reserved field, so it is injected here.
    if (!isSingleTable) {
      const ownerIndexName = indexNameForColumn(tableName, "created_by");
      const ownerIndex =
        this.dialect === "mysql"
          ? `CREATE INDEX ${this.quoteIdentifier(ownerIndexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_by")});`
          : `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(ownerIndexName)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("created_by")});`;
      indexStatements.push(ownerIndex);
    }

    // Add unique index for slug column (automatically available for all collections and singles)
    let slugIndex = "";
    if (this.dialect === "sqlite") {
      slugIndex = `CREATE UNIQUE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexNameForColumn(tableName, "slug"))} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("slug")});`;
    } else if (this.dialect === "mysql") {
      slugIndex = `CREATE UNIQUE INDEX ${this.quoteIdentifier(indexNameForColumn(tableName, "slug"))} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("slug")});`;
    } else {
      slugIndex = `CREATE UNIQUE INDEX IF NOT EXISTS ${this.quoteIdentifier(indexNameForColumn(tableName, "slug"))} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier("slug")});`;
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
      /**
       * Whether the table already holds rows, read from the live table by `tableHasRows`.
       *
       * Only a required column whose type states no backfill consults it, and only to decide
       * between emitting the column and refusing the edit. Undefined means the caller did not
       * look, which is read as "may have rows": guessing empty produces a statement that
       * PostgreSQL and MySQL reject and that SQLite accepts before rejecting every insert.
       */
      tableHasRows?: boolean;
      /**
       * Foreign-key constraint names by column, read from the live table by
       * `readForeignKeyColumns`.
       *
       * Which columns carry one is not derivable from the fields: on SQLite the ALTER path
       * cannot attach a foreign key, so a relationship added by an edit has none while the same
       * field created with its table does. Undefined is read as "none known", which leaves the
       * drop exactly as it behaved before anything was measured.
       */
      foreignKeysByColumn?: ReadonlyMap<string, readonly string[]>;
      /**
       * The index names the table carries, read from the live table by `readIndexNames`.
       *
       * Consulted before dropping one. Which columns are indexed is not derivable from the
       * fields: an index is created by whichever path added the column, and those paths have
       * not always agreed, so an identical field can be indexed on one table and not on
       * another. MySQL has no `DROP INDEX IF EXISTS`, so dropping an absent index aborts the
       * migration before the statements after it. Undefined means the caller did not look, and
       * the drop is then emitted only where the dialect can guard it itself.
       */
      indexNames?: ReadonlySet<string>;
    }
  ): string {
    // The added columns become SQL here too, so the same refusal applies.
    this.assertDecimalDimensions(newFields);

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
      const previous = oldFieldMap.get(field.name);
      if (!previous || this.storageClassChanged(previous, field)) {
        // Skip manyToMany fields - they don't get columns, they get junction tables
        if (usesJunctionTable(field)) {
          // Generate junction table instead
          const junctionSQL = this.generateJunctionTable(tableName, field);
          statements.push(junctionSQL);
          continue;
        }

        // Component and field-group fields store their data in a separate table, so
        // adding one must not ADD COLUMN on the parent table.
        if (!fieldProducesColumn(field)) {
          continue;
        }

        const type = this.mapFieldTypeToSQL(
          field.type,
          field.length,
          undefined,
          undefined,
          field
        );
        const nullable = field.required ? "NOT NULL" : "";
        const addColName = toSnakeCase(field.name);

        // An existing row has no value for a column that did not exist a moment ago, so a
        // required one has to say what those rows get. Most types state something usable; a
        // relationship states nothing, because every id it could write references a row that
        // is not there. Emitting `DEFAULT NULL` anyway is what produced three different
        // failures: PostgreSQL reports the nulls it found, MySQL calls the default invalid,
        // and SQLite writes the column and then refuses every insert that omits it.
        //
        // With no rows to backfill there is nothing to state, and a plain NOT NULL is
        // accepted by all three. With rows, the value has to come from the author, so the
        // edit is refused and names the order that works.
        let defaultVal = "";
        if (field.required || field.default !== undefined) {
          const backfill = this.requiredColumnBackfill(field);
          if (backfill !== null) {
            defaultVal = `DEFAULT ${backfill}`;
          } else if (field.required && options?.tableHasRows !== false) {
            throw NextlyError.validation({
              errors: [
                {
                  path: `fields.${field.name}`,
                  code: "REQUIRED_COLUMN_NEEDS_BACKFILL",
                  message:
                    `"${field.name}" is required, but ${tableName} already has entries and ` +
                    `a ${field.type} has no default value to give them. Add the field as ` +
                    `optional, set a value on the existing entries, then mark it required.`,
                },
              ],
              logContext: { tableName, field: field.name, type: field.type },
            });
          }
        }
        // Uniqueness this dialect cannot enforce is refused BEFORE any statement is generated,
        // not attempted and left half-done. MySQL commits each DDL statement on its own, so
        // emitting the column and then a constraint it rejects leaves the column in place
        // WITHOUT the guarantee — and a bare column matches what the desired schema declares for
        // an unkeyable type, so the next reconcile sees nothing wrong and the uniqueness is
        // silently gone. There is no spelling that works here: MySQL refuses to key an unbounded
        // TEXT/BLOB either way, and cannot index JSON at all. Saying so is the only honest
        // outcome, and saying it first is what keeps the table untouched.
        if (field.unique && !this.uniquenessCanBeAnIndex(type)) {
          throw NextlyError.validation({
            errors: [
              {
                path: `fields.${field.name}`,
                code: "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT",
                message:
                  `"${field.name}" is marked unique, but ${this.dialect} cannot enforce ` +
                  `uniqueness on a ${field.type} column. Store the value in a short-variant ` +
                  `text field, which becomes a bounded VARCHAR the server can key, or remove ` +
                  `the unique flag.`,
              },
            ],
            logContext: {
              tableName,
              field: field.name,
              type: field.type,
              dialect: this.dialect,
            },
          });
        }
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
            const onDelete = this.relationOnDelete(field);
            const onUpdate = field.options.onUpdate || "no action";
            statements.push(
              `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD CONSTRAINT ${this.quoteIdentifier(`fk_${tableName}_${addColName}`)} FOREIGN KEY (${this.quoteIdentifier(addColName)}) REFERENCES ${this.quoteIdentifier(targetTable)}(${this.quoteIdentifier("id")}) ON DELETE ${this.mapOnDeleteAction(onDelete)} ON UPDATE ${this.mapOnUpdateAction(onUpdate)};`
            );
          }

          // The flag only, not `columnIsUnique`. A one-to-one's uniqueness is spelled three
          // different ways today: the table CREATE writes it inline, where the dialect names the
          // index itself; the desired schema the diff compares against declares a NON-unique
          // index for the same field; and a named constraint here would be a third. Emitting one
          // makes the next diff propose dropping it, so the cardinality is enforced by agreeing
          // on one spelling, not by adding another.
          if (field.unique) {
            statements.push(
              `ALTER TABLE ${this.quoteIdentifier(tableName)} ADD CONSTRAINT ${this.quoteIdentifier(`uq_${tableName}_${addColName}`)} UNIQUE (${this.quoteIdentifier(addColName)});`
            );
          }
        } else {
          // For SQLite with unique constraint, create a unique index instead. The flag only,
          // for the reason above.
          if (field.unique) {
            statements.push(
              `CREATE UNIQUE INDEX IF NOT EXISTS ${this.quoteIdentifier(`uq_${tableName}_${addColName}`)} ON ${this.quoteIdentifier(tableName)}(${this.quoteIdentifier(addColName)});`
            );
          }
        }

        // The index this column carries, for a column that did not exist before this save. The
        // index loop below compares a field against its previous state to catch a toggle, and a
        // field being added has no previous state to differ from, so neither the index requested
        // at the same moment as the column nor the one a relationship always carries was created
        // by either.
        if (this.columnIsIndexed(field)) {
          const addIndexSql = this.createIndexSql(tableName, addColName, type);
          if (addIndexSql) statements.push(addIndexSql);
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
      // A column the add loop just created already carries whatever index was requested with
      // it. Reading the toggle for one of those emits a second CREATE INDEX for the same
      // column under the same name.
      if (!oldField || this.storageClassChanged(oldField, field)) continue;
      if (oldField.index !== field.index) {
        const idxCol = toSnakeCase(field.name);
        if (field.index) {
          const toggleIndexSql = this.createIndexSql(
            tableName,
            idxCol,
            this.mapFieldTypeToSQL(
              field.type,
              field.length,
              undefined,
              undefined,
              field
            )
          );
          if (toggleIndexSql) statements.push(toggleIndexSql);
        } else {
          // Same guard as the removal path: turning an index off that the table never carried
          // aborts on MySQL, which cannot express `DROP INDEX IF EXISTS`.
          // And whichever name the table carries it under, for the same reason as the removal
          // path: bounding long names changed what they are called, and an index already in a
          // database still answers to the name it was created under.
          const known = options?.indexNames !== undefined;
          const present = this.indexNameCandidates(tableName, idxCol).find(
            name => options?.indexNames?.has(name) === true
          );
          if (known) {
            if (present !== undefined) {
              statements.push(this.dropIndexSql(tableName, present));
            }
          } else if (this.dialect !== "mysql") {
            statements.push(
              this.dropIndexSql(
                tableName,
                indexNameForColumn(tableName, idxCol)
              )
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
      const next = newFieldMap.get(field.name);
      if (!next || this.storageClassChanged(field, next)) {
        const dropCol = toSnakeCase(field.name);

        // A column that something references cannot simply be removed, and the three dialects
        // do not agree on what that costs. PostgreSQL drops the constraints that depend on the
        // column along with it, so it needs nothing here. MySQL keeps them and refuses the drop
        // until the constraint is named and removed first. SQLite cannot remove a constraint at
        // all: the column stays until the whole table is rebuilt around it, so the edit is
        // refused rather than sent to fail as a driver error the author cannot act on.
        // Everything attached to the column comes off before the column does. SQLite refuses
        // `DROP COLUMN` while an index still names it, and reports that as a missing column
        // inside the index rather than as the removal it refused. PostgreSQL and MySQL drop the
        // index with the column, so removing it first is redundant there and never wrong.
        //
        const foreignKeys = options?.foreignKeysByColumn?.get(dropCol);
        if (foreignKeys !== undefined) {
          if (this.dialect === "sqlite") {
            throw NextlyError.validation({
              errors: [
                {
                  path: `fields.${field.name}`,
                  code: "FOREIGN_KEY_DROP_UNSUPPORTED",
                  message:
                    `"${field.name}" cannot be removed on SQLite: the link it holds to another ` +
                    `collection is part of ${tableName}'s definition, and SQLite can only drop ` +
                    `one by rebuilding the table. Remove the field on PostgreSQL or MySQL, or ` +
                    `recreate the collection.`,
                },
              ],
              logContext: { tableName, field: field.name, column: dropCol },
            });
          }
          if (this.dialect === "mysql") {
            for (const constraint of foreignKeys) {
              statements.push(
                `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP FOREIGN KEY ${this.quoteIdentifier(constraint)};`
              );
            }
          }
        }

        // After the constraint, before the column. MySQL enforces a foreign key THROUGH an
        // index and refuses to drop the one supporting it ("Cannot drop index: needed in a
        // foreign key constraint"), so the constraint has to go first; SQLite refuses to drop a
        // column an index still names, so the index has to go before that.
        //
        // Asked of the live table, not of the field: an index is created by whichever path
        // added the column, so a field that looks indexed may have none. MySQL cannot guard the
        // drop itself, so without the answer it is not attempted there.
        const indexIsKnown = options?.indexNames !== undefined;
        const present = this.indexNameCandidates(tableName, dropCol).find(
          name => options?.indexNames?.has(name) === true
        );
        if (indexIsKnown) {
          if (present !== undefined) {
            statements.push(this.dropIndexSql(tableName, present));
          }
        } else if (this.dialect !== "mysql") {
          statements.push(
            this.dropIndexSql(tableName, indexNameForColumn(tableName, dropCol))
          );
        }

        // The UNIQUE index, which is a separate object from the plain one above and may be present
        // without it. SQLite refuses to drop a column an index still names, so this has to go first.
        //
        // On PostgreSQL the same name can belong to a CONSTRAINT rather than to a free-standing
        // index, because the add-column path creates it with ADD CONSTRAINT. `DROP INDEX` on a
        // constraint-owned index is refused there, and the refusal aborts the migration before the
        // column drop that would have removed both. Dropping the constraint first covers that case
        // and is harmless when there is none; the index drop after it covers the create path, which
        // makes a free-standing index under the same name.
        const uniquePresent = this.uniqueIndexNameCandidates(
          tableName,
          dropCol
        ).find(name => options?.indexNames?.has(name) === true);
        if (uniquePresent !== undefined) {
          if (this.dialect === "postgresql") {
            statements.push(
              `ALTER TABLE ${this.quoteIdentifier(tableName)} DROP CONSTRAINT IF EXISTS ${this.quoteIdentifier(uniquePresent)};`
            );
          }
          statements.push(this.dropIndexSql(tableName, uniquePresent));
        }

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
        // A storage move is handled by the add and remove loops above; altering the column here
        // would target one the table does not have yet, or no longer has.
        if (oldField && this.storageClassChanged(oldField, field)) continue;
        if (oldField && this.isFieldModified(oldField, field)) {
          const alterCol = toSnakeCase(field.name);
          // The descriptor decides the target column, the same answer the comparison above used to
          // decide there was a change at all. Asking a different renderer here is what let a field
          // be judged modified by one definition and then rewritten by another: this call used to
          // drop `options` and `validation`, so a number switched to `format: "float"` was detected
          // and then re-emitted as `integer`.
          const before = getColumnDescriptor(
            oldField,
            this.dialect,
            "collection"
          );
          const described = getColumnDescriptor(
            field,
            this.dialect,
            "collection"
          );
          const type =
            described?.dialectType ??
            this.mapFieldTypeToSQL(
              field.type,
              field.length,
              field.options,
              field.validation,
              field
            );

          // 🔴 Whether the COLUMN changed, which is not the same question as whether the FIELD did.
          //
          // `isFieldModified` also answers true for an index or a unique constraint, and neither is
          // a property of the column's shape. Rewriting the type for one of those is not a harmless
          // no-op: the type written here is the DESCRIPTOR's, and the descriptor does not yet agree
          // with the generator that created the column. Enabling an index on a Builder `select`
          // would move it from the unbounded `text` it was created as to `varchar(255)`, truncating
          // every stored value past 255 characters — for an edit that never touched its storage.
          // Nullability is deliberately NOT part of this. The descriptor derives `nullable` from
          // `required`, so including it would make a requiredness toggle claim the column's TYPE
          // changed and rewrite it — the same truncation the index case caused, reached through a
          // different edit. It is tracked on its own below, where it belongs.
          const columnChanged =
            !before || !described
              ? before !== described
              : before.dialectType !== described.dialectType ||
                before.kind !== described.kind ||
                before.name !== described.name;
          const nullabilityChanged = field.required !== oldField.required;

          if (this.dialect === "mysql") {
            // MySQL restates the WHOLE definition, so everything the column carries travels with
            // the type or it is dropped: nullability, and the default the create path emits from
            // `field.default`. A MODIFY that omits either silently removes it.
            //
            // Issued when the column's shape changed OR its nullability did, because on this dialect
            // one statement carries both.
            if (columnChanged || nullabilityChanged) {
              const nullability = field.required ? " NOT NULL" : " NULL";
              const defaultClause =
                field.default !== undefined && field.default !== null
                  ? ` DEFAULT ${this.formatDefaultValue(field.default, field.type)}`
                  : "";
              // 🔴 Which type a MODIFY restates depends on WHY it is being issued, and getting this
              // wrong rewrites a column nobody asked to change.
              //
              // Changing the storage means asking for the descriptor's answer. Changing only the
              // nullability means preserving what the column already is — and what it already is,
              // for a table this service built, is what THIS generator renders. Restating the
              // descriptor's answer instead would move a `select` created as unbounded `text` to
              // `varchar(255)` and truncate stored values, for an edit that touched nothing but a
              // required flag. MySQL leaves no third option: the type has to be restated or the
              // column definition is lost.
              const restated = columnChanged
                ? type
                : this.mapFieldTypeToSQL(
                    field.type,
                    field.length,
                    field.options,
                    field.validation,
                    field
                  );
              statements.push(
                `ALTER TABLE ${this.quoteIdentifier(tableName)} MODIFY COLUMN ${this.quoteIdentifier(alterCol)} ${restated}${nullability}${defaultClause};`
              );
            }
          } else if (!columnChanged) {
            // Nothing about the column moved. Nullability is still handled below.
            if (nullabilityChanged) {
              statements.push(
                field.required
                  ? `ALTER TABLE ${this.quoteIdentifier(tableName)} ALTER COLUMN ${this.quoteIdentifier(alterCol)} SET NOT NULL;`
                  : `ALTER TABLE ${this.quoteIdentifier(tableName)} ALTER COLUMN ${this.quoteIdentifier(alterCol)} DROP NOT NULL;`
              );
            }
          } else {
            // Rendered by the shared template rather than written out here, so this path and
            // `migrate:create` emit the same statement. It also carries the `USING` clause
            // PostgreSQL requires for cross-family changes, which the hand-written form omitted.
            statements.push(
              `${generateSQL(
                {
                  type: "change_column_type",
                  tableName,
                  columnName: alterCol,
                  fromType: before?.dialectType ?? type,
                  toType: type,
                },
                this.dialect
              )};`
            );

            if (nullabilityChanged) {
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
    }

    return statements.join("\n--> statement-breakpoint\n");
  }

  /**
   * Check if a field definition has been modified
   */
  /**
   * Whether an edit changes the physical column, and therefore needs an ALTER.
   *
   * The column is compared through the descriptor rather than by listing the properties that
   * happen to affect it. A list is a claim about which properties matter, and it goes stale the
   * moment a new one is added: `dbType`, `precision`, `scale` and `options.format` all decide a
   * number's storage and none of them were listed, so changing a field to an exact decimal or
   * widening its precision produced no ALTER at all — the registry described a decimal while the
   * column stayed an integer, and every fractional write was still truncated.
   *
   * Asking the descriptor makes that class of omission impossible: whatever decides a column today
   * or later is, by construction, what this compares.
   *
   * `unique` and `index` are compared separately because they are not properties of the column's
   * shape. Two columns can be identical and differ in whether an index covers them.
   */
  isFieldModified(
    oldField: FieldDefinition,
    newField: FieldDefinition
  ): boolean {
    if (oldField.unique !== newField.unique) return true;
    if (oldField.index !== newField.index) return true;

    const before = getColumnDescriptor(oldField, this.dialect, "collection");
    const after = getColumnDescriptor(newField, this.dialect, "collection");
    // One producing no column and the other producing one is itself a change of storage class.
    if (!before || !after) return before !== after;

    return (
      before.name !== after.name ||
      before.dialectType !== after.dialectType ||
      before.nullable !== after.nullable ||
      before.kind !== after.kind
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
    if (usesJunctionTable(a)) {
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
  /**
   * The indexes and foreign keys a table WILL carry once its creation migration has run.
   *
   * A collection saved but not yet deployed has a registry record and no table. Reading the
   * absent table reports no attachments, and an edit made in that window then emits a bare
   * `DROP COLUMN` — which is correct against nothing and wrong against what the deployment
   * actually produces, because the create artefact runs first and installs the index and the
   * constraint the drop then trips over.
   *
   * Answered by the class that emits the CREATE, so what is predicted here and what is written
   * there cannot describe different tables.
   */
  plannedAttachments(
    tableName: string,
    fields: FieldDefinition[]
  ): {
    indexNames: Set<string>;
    foreignKeysByColumn: Map<string, string[]>;
  } {
    const indexNames = new Set<string>();
    const foreignKeysByColumn = new Map<string, string[]>();
    // The system indexes every generated table carries, named as `generateMigrationSQL` names
    // them, so a system column removed by an edit is not treated as unindexed.
    for (const column of ["slug", "created_at", "created_by"]) {
      indexNames.add(indexNameForColumn(tableName, column));
    }
    for (const field of fields) {
      if (!fieldProducesColumn(field)) continue;
      const column = toSnakeCase(field.name);
      // Asked through the statement builder, not through `columnIsIndexed` alone. Wanting an
      // index and being able to have one are different questions: MySQL cannot index a JSON
      // column, so the create emits nothing for one. Predicting it anyway makes a later edit
      // drop an index that was never installed, which on MySQL aborts the whole migration.
      if (
        this.columnIsIndexed(field) &&
        this.createIndexSql(
          tableName,
          column,
          this.mapFieldTypeToSQL(
            field.type,
            field.length,
            field.options,
            field.validation,
            field
          )
        ) !== null
      ) {
        indexNames.add(indexNameForColumn(tableName, column));
      }
      // The UNIQUE index is a separate object from the plain one and is emitted under its own
      // rule, so it has to be predicted through that rule rather than inferred from this one.
      const uniqueName = this.plannedUniqueIndexName(tableName, field);
      if (uniqueName !== null) indexNames.add(uniqueName);
      if (field.type === "relationship" && field.options?.target) {
        foreignKeysByColumn.set(column, [`fk_${tableName}_${column}`]);
      }
    }
    return { indexNames, foreignKeysByColumn };
  }

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
  /**
   * The column a number field reaches, for the dialect this service builds for.
   *
   * Two independent things can ask for fractions and they mean different storage. `dbType:
   * "decimal"` asks for exact fixed point, which is what money needs and what nothing else should
   * use; `options.format === "float"` is the UI's way of asking for an ordinary fractional number.
   * Silence means whole numbers.
   *
   * 🔴 "Exact" holds on PostgreSQL and MySQL, which have a real fixed-point type. SQLite has only
   * NUMERIC affinity: it stores what it can as an exact value and falls back to binary floating
   * point, and this package reads number columns back as JavaScript numbers either way. The column
   * is therefore the best storage SQLite offers rather than a guarantee, which is the same caveat
   * `NumberFieldConfig` already carries.
   *
   * Read here rather than inline in each dialect map because the same three-way answer is needed
   * three times, and a map that answered it per dialect is how one of the three came to be missing
   * from all of them.
   */
  private numberColumnType(
    options: FieldDefinition["options"],
    storage: Pick<FieldDefinition, "dbType" | "precision" | "scale"> | undefined
  ): string {
    if (storage?.dbType === "decimal") {
      // 🔴 Asked, not restated. The descriptor owns the decimal defaults and the per-dialect
      // spelling, and both are read by the runtime table and the schema diff. Copying them here
      // would be a second source of truth for the very question whose two answers produced this
      // defect: a later change to a default or a dialect rendering would make a newly created
      // table disagree with the schema that binds it, silently and only on one path.
      //
      // The dimensions are validated before this point, so what reaches the descriptor is a shape
      // it can render rather than whatever a request happened to carry.
      const described = getColumnDescriptor(
        {
          name: "n",
          type: "number",
          dbType: "decimal",
          precision: storage.precision,
          scale: storage.scale,
        },
        this.dialect,
        "collection"
      );
      if (described) return described.dialectType;
    }
    if (options?.format === "float") {
      return this.dialect === "sqlite" ? "real" : "decimal(10,2)";
    }
    return "integer";
  }

  /**
   * Refuse decimal dimensions that cannot safely become part of a type.
   *
   * `precision` and `scale` are interpolated into DDL, and on this path they arrive from a request
   * payload that is only name- and plugin-validated. A value that is not an integer therefore
   * reaches the template verbatim, which at best renders a migration no engine accepts and at worst
   * carries whatever the string contains into a statement.
   *
   * The same rule the code-first config already enforces, reused rather than restated: the ranges
   * and the scale-not-greater-than-precision check are one definition, so the Schema Builder cannot
   * accept a shape `defineCollection` rejects.
   */
  private assertDecimalDimensions(fields: FieldDefinition[]): void {
    const errors: BaseValidationError[] = [];
    fields.forEach((field, index) => {
      validateNumberDecimalDimensionsShared(field, `fields[${index}]`, errors);
    });
    if (errors.length > 0) {
      throw NextlyError.validation({
        errors: errors.map(e => ({
          path: e.path,
          code: e.code,
          message: e.message,
        })),
      });
    }
  }

  mapFieldTypeToSQL(
    declaredType: string,
    length?: number,
    options?: FieldDefinition["options"],
    validation?: FieldDefinition["validation"],
    /**
     * What a number field says about how it wants to be stored.
     *
     * Passed as its own argument because this map is reached from six call
     * sites and four of them used to hand over only a type and a length, which
     * is why an exact-decimal field silently became a whole-number column: the
     * facts that decide it never arrived. Optional so a caller that genuinely
     * has no field (a storage token resolved from a plugin type) is unchanged.
     */
    numberStorage?: Pick<FieldDefinition, "dbType" | "precision" | "scale">
  ): string {
    // A contributed type persists as its storage primitive, and this map has
    // never heard of the token it is declared under. Left unresolved it falls
    // through to `text`, so the column the DDL creates and the column the ORM
    // binds describe different things. The same resolution `getColumnDescriptor`
    // and the missing-column scan already make.
    const type = storageTypeToken({ type: declaredType }) ?? declaredType;

    // 🔴 Only a field DECLARED as the built-in number states how a number is stored.
    //
    // A plugin type resolves to the `number` storage primitive above, but `dbType`, `precision` and
    // `scale` are the built-in number field's own vocabulary — a plugin's payload carrying them
    // means something to the plugin, not to this map. Honouring them would give the plugin a decimal
    // column while `getColumnDescriptor` still describes its storage primitive as an integer, so the
    // ORM would bind a different shape than the table has and every diff would propose the change
    // again. It also routes around the dimension validation, which only inspects fields whose type
    // IS `number` and would never see the values being interpolated here.
    const storage = declaredType === "number" ? numberStorage : undefined;

    if (this.dialect === "sqlite") {
      // SQLite type mapping. SQLite has dynamic typing, so types are simplified.
      const sqliteTypeMap: Record<string, string> = {
        text: "text",
        textarea: "text",
        number: this.numberColumnType(options, storage),
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
        number: this.numberColumnType(options, storage),
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
      number: this.numberColumnType(options, storage),
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
