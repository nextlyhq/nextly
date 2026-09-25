// Operation types - the structured representation of schema changes.
//
// Replaces the F4 PR 1 approach of parsing raw SQL strings emitted by
// drizzle-kit's pushSchema. Operations are emitted by our diff() function
// (see ./diff.ts) and consumed by:
//   - RegexRenameDetector (groups DROP+ADD pairs into rename candidates)
//   - PromptDispatcher (renders prompts for renames + destructive ops)
//   - PreResolutionExecutor (runs SQL for ops we own: rename, drop)
//   - The remaining pushSchema call for purely additive ops
//
// Why operations instead of SQL strings:
// drizzle-kit's pushSchema invokes a TTY-prompting columnsResolver when it
// sees a DROP+ADD pair on the same table. There is no public API to bypass
// this. By computing our own diff and pre-executing renames ourselves, we
// ensure pushSchema never sees a rename ambiguity, so its prompt never
// for the full Option E rationale.

// Lightweight column representation - just what we need for diff + SQL gen.
// Not a full Drizzle column descriptor; we don't track every Drizzle attribute.
export interface ColumnSpec {
  name: string;
  // Raw type token as it appears in DDL or as introspected from
  // information_schema.columns.udt_name (PG) / COLUMN_TYPE (MySQL) /
  // PRAGMA table_info.type (SQLite). Examples: "text", "varchar(255)",
  // "int4", "uuid", "timestamptz", "bpchar".
  type: string;
  nullable: boolean;
  // Raw default expression as written in DDL. Undefined when no default.
  // Examples: "'foo'::text", "now()", "0", "true", "gen_random_uuid()".
  default?: string;
  // `true` when the column is the table's primary key. Recorded from the
  // desired side, which reads it from the Drizzle column; introspected
  // snapshots leave it undefined, and so do snapshots written before this
  // field existed. Both read as "not known to be a primary key", which only
  // costs the nullability exemption the diff grants primary keys — never a
  // wrong op.
  primaryKey?: boolean;
  // `true` when the DATABASE assigns this column's value — `col.serial()`.
  //
  // Carried separately from `type` because the two answer different
  // questions. `type` is what introspection REPORTS (`int4` on PostgreSQL,
  // `int` on MySQL) so the desired and live sides compare equal; this is what
  // the DDL has to SAY so the sequence or AUTO_INCREMENT exists at all.
  // Without it the generated migration produced a plain integer key, and every
  // insert that omitted the column failed after the module applied — while dev
  // push, which builds from Drizzle's own serial builders, worked.
  //
  // Recorded only on the desired side. Introspection reports the mechanism
  // through `ownedSequenceDefault` (PostgreSQL) or the column's EXTRA
  // (MySQL), and the diff must not read this field for the same reason it
  // must not read `typeModifier`.
  autoIncrement?: boolean;
  // `true` when the live default is a `nextval()` over the sequence this
  // column OWNS — what PostgreSQL materialises for a `serial` declaration.
  // Recorded only when true, and only by PostgreSQL introspection: no other
  // dialect has sequences in a default, and the desired side never spells the
  // default at all.
  //
  // Ownership is the point. A column can hold a `nextval()` default over a
  // sequence it does not own, either because someone pointed it at one
  // deliberately or because a `serial` column was later repointed. Those are
  // real defaults and the diff must keep reporting them; only the implicit
  // one may be suppressed. Reading the shape of the expression cannot tell
  // the two apart, which is why this is carried in the snapshot rather than
  // re-derived in the diff.
  ownedSequenceDefault?: boolean;
  // The size or precision the column was DECLARED with, when it has one:
  // "255" for varchar(255), "10,2" for numeric(10,2). Absent when the type
  // carries no modifier.
  //
  // Separate from `type` deliberately, and the diff must never read it.
  // `normalizeType` strips modifiers precisely so the live side (which on
  // PostgreSQL reads `udt_name` and cannot report one) and the desired side
  // (which authors lengths) compare equal — folding the modifier into `type`
  // would emit a `change_column_type` for every core column of every existing
  // PostgreSQL database, which is the whole failure that strip prevents.
  //
  // Recorded so a consumer that legitimately needs the width can ask for it
  // without re-deriving it from a string the strip has already flattened.
  typeModifier?: string;
}

export interface IndexSpec {
  name: string;
  /** Empty when `expression` is set. Order is significant. */
  columns: string[];
  unique: boolean;
  /**
   * A partial-index predicate, stored per dialect in canonical form.
   *
   * PostgreSQL and SQLite only. MySQL has no partial indexes, so an index
   * carrying this is REFUSED there rather than created without the predicate —
   * a "unique" index over more rows than intended enforces a constraint
   * nobody asked for, and silently.
   */
  where?: string;
  /**
   * An expression index, as per-dialect SQL.
   *
   * Carried separately from `columns` because the converter reports an
   * expression index with an EMPTY column list: a comparison that counted
   * indexes would find the right number and the wrong ones.
   */
  expression?: string;
}

/**
 * A foreign key the database enforces.
 *
 * Distinct from `ExtensionColumn.references`, which records a target for
 * documentation and validation and creates nothing. This is the constraint
 * itself, and it is only representable now that the diff can see one.
 */
export interface ForeignKeySpec {
  /** `fk_<table>_<cols>`, hashed past 63 exactly as index names are. */
  name: string;
  columns: string[];
  referencesTable: string;
  referencesColumns: string[];
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
}

export type ReferentialAction =
  | "cascade"
  | "set null"
  | "restrict"
  | "no action"
  | "set default";

/** A check constraint, as SQL the dialect evaluates. */
export interface CheckSpec {
  name: string;
  /** Per-dialect SQL, because the expression languages differ. */
  sql: string;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  /**
   * Foreign keys, when the table's source tracked them.
   *
   * `undefined` means "not tracked", exactly as `indexes` does, so a snapshot
   * written before this field existed skips the dimension rather than being
   * read as "this table has none" — which would propose dropping every
   * constraint on every existing database.
   */
  foreignKeys?: ForeignKeySpec[];
  /** Check constraints, with the same `undefined` meaning as `foreignKeys`. */
  checks?: CheckSpec[];
  // undefined = "no index data tracked" (pre-C1 snapshots) — the diff/drift
  // index dimension is SKIPPED for such tables. [] = tracked, none.
  indexes?: IndexSpec[];
  // `true` when this entity has content-localization enabled, so its
  // translatable columns live in the migration-owned companion `_locales` table
  // rather than here. Recorded ONLY when true — `undefined` means "not localized,
  // OR a pre-marker snapshot that never tracked this". Both read as "don't know
  // that it was localized", which is exactly the safe answer: migrate:create only
  // emits a DISABLE transition when it sees an explicit `true`, so it can never
  // false-positive on the common "add fields to a non-localized collection" case.
  //
  // This is a config-derived marker: DB-introspected snapshots cannot know it and
  // leave it undefined, so it is deliberately NOT part of the diff/drift
  // comparison — it only drives companion migration planning.
  localized?: boolean;
  // the companion's column names at the time this snapshot was written, recorded
  // alongside `localized`. This is the AUTHORITATIVE answer to "what actually lives in the
  // `_locales` table", which a later DISABLE needs in order to bring exactly those columns
  // home. Re-deriving the list from the new config instead would be wrong in both directions:
  // a field whose `localized: true` was removed in the same edit would be missed, and a
  // translatable field ADDED in the same edit would be restored from a companion that never
  // held it (emitting SQL that fails on apply). Present only when `localized` is true.
  localizedColumns?: string[];
}

// A snapshot of either the live DB state or the desired state. Only includes
// MANAGED tables (filtered by MANAGED_TABLE_PREFIXES_REGEX from F3).
export interface NextlySchemaSnapshot {
  tables: TableSpec[];
}

// =============================================================================
// Operation union
// =============================================================================

export type Operation =
  | AddTableOp
  | DropTableOp
  | RenameTableOp
  | AddColumnOp
  | DropColumnOp
  | RenameColumnOp
  | ChangeColumnTypeOp
  | ChangeColumnNullableOp
  | ChangeColumnDefaultOp
  | AddIndexOp
  | DropIndexOp
  | AddCheckOp
  | DropCheckOp
  | AddForeignKeyOp
  | DropForeignKeyOp
  | ChangeForeignKeyActionOp;

export interface AddTableOp {
  type: "add_table";
  table: TableSpec;
}

export interface DropTableOp {
  type: "drop_table";
  tableName: string;
}

export interface RenameTableOp {
  type: "rename_table";
  fromName: string;
  toName: string;
}

export interface AddColumnOp {
  type: "add_column";
  tableName: string;
  column: ColumnSpec;
}

// drop_column carries the previous column type so the rename detector
// can read fromType without a separate lookup. Otherwise the detector
// would have to re-introspect the live DB at detection time.
export interface DropColumnOp {
  type: "drop_column";
  tableName: string;
  columnName: string;
  columnType: string;
}

export interface RenameColumnOp {
  type: "rename_column";
  tableName: string;
  fromColumn: string;
  toColumn: string;
  fromType: string;
  toType: string;
}

export interface ChangeColumnTypeOp {
  type: "change_column_type";
  tableName: string;
  columnName: string;
  fromType: string;
  toType: string;
  /**
   * The nullability and default the column must still have afterwards, when the caller knows them.
   *
   * 🔴 Only MySQL needs these, and it needs them absolutely. Its type change is spelled
   * `MODIFY COLUMN <name> <type>`, which RESTATES the whole definition — so a column that was
   * `NOT NULL DEFAULT 0` becomes nullable with no default unless both travel with the type. There
   * is no separate statement to put them back: `change_column_nullable` cannot be rendered for
   * MySQL at all, by design, because it would need the type it does not carry.
   *
   * PostgreSQL ignores them: it changes a type without disturbing either, and expresses each as its
   * own statement.
   *
   * Optional because a caller inside the apply pipeline does not need them — the schema push that
   * follows reconciles nullability and defaults against the desired snapshot. A generated migration
   * file has no such second pass, which is where omitting them silently changed the column.
   */
  nullable?: boolean;
  columnDefault?: string;
  /**
   * The same two facts about the column BEFORE the change.
   *
   * Carried for the same reason `fromType` is: an inverse operation has to restate the definition it
   * is returning the column to, and on MySQL `MODIFY COLUMN` deletes whatever it does not restate.
   * Without these a generated DOWN converts the type back and silently drops the `NOT NULL` and the
   * default the column originally had.
   */
  fromNullable?: boolean;
  fromColumnDefault?: string;
}

export interface ChangeColumnNullableOp {
  type: "change_column_nullable";
  tableName: string;
  columnName: string;
  fromNullable: boolean;
  toNullable: boolean;
}

export interface ChangeColumnDefaultOp {
  type: "change_column_default";
  tableName: string;
  columnName: string;
  fromDefault: string | undefined;
  toDefault: string | undefined;
}

export interface AddIndexOp {
  type: "add_index";
  tableName: string;
  index: IndexSpec;
}

export interface DropIndexOp {
  type: "drop_index";
  tableName: string;
  index: IndexSpec;
}

/**
 * A check constraint is added and dropped by NAME. The expression itself is
 * per-dialect SQL and is compared textually: a changed expression becomes a
 * drop plus an add under the same name, because no dialect edits a check's
 * expression in place.
 */
export interface AddCheckOp {
  type: "add_check";
  tableName: string;
  check: CheckSpec;
}

export interface DropCheckOp {
  type: "drop_check";
  tableName: string;
  check: CheckSpec;
}

/**
 * A foreign key is added and dropped whole. Compared STRUCTURALLY (columns,
 * target, actions) rather than textually, because introspection reports those
 * reliably on every dialect; a changed action alone arrives as a
 * `change_foreign_key_action` from the column-level diff when the name and
 * shape are unchanged.
 */
export interface AddForeignKeyOp {
  type: "add_foreign_key";
  tableName: string;
  foreignKey: ForeignKeySpec;
}

export interface DropForeignKeyOp {
  type: "drop_foreign_key";
  tableName: string;
  foreignKey: ForeignKeySpec;
}

/**
 * Change what a foreign key does to its rows when the row it points at is
 * deleted or its key updated, leaving the constraint's name, column and target
 * exactly as they are.
 *
 * A referential action is not a property of the column, which is why this is
 * its own operation rather than a field on a column change: the column's type,
 * nullability and default all stay put, and the rewrite paths that serve those
 * would rebuild storage for a change that only touches a constraint.
 *
 * No dialect can edit an action in place, so every implementation drops the
 * constraint and declares it again. The name is unchanged by definition here,
 * and that is what forces two statements rather than one: MySQL rejects a drop
 * and an add of one name in a single `ALTER TABLE` outright (bug #68286, error
 * 1826), and on PostgreSQL a single statement would depend on the order the
 * server runs its subcommands in, which nothing here can test. SQLite cannot
 * alter a constraint at all and refuses, as it already does for an in-place
 * type, nullability or default change.
 */
export interface ChangeForeignKeyActionOp {
  type: "change_foreign_key_action";
  tableName: string;
  /** Unchanged by this operation: it is dropped and redeclared under it. */
  constraintName: string;
  columnName: string;
  referencesTable: string;
  referencesColumn: string;
  // Both sides are recorded, as every other change operation records them, so
  // `migrate:create` can write the inverse by swapping them.
  /** Already mapped to the dialect's spelling, e.g. "CASCADE", "NO ACTION". */
  fromOnDelete: string;
  fromOnUpdate: string;
  toOnDelete: string;
  toOnUpdate: string;
}

// =============================================================================
// Operation classification helpers
// =============================================================================

// Operations we PRE-RESOLVE (run via our own SQL before calling pushSchema):
//   - rename_column / rename_table: avoid drizzle-kit's TTY prompt
//   - drop_index: must run in the same phase as drop_column and BEFORE it —
//     SQLite refuses ALTER TABLE ... DROP COLUMN while an index still covers
//     the column, so leaving index drops to the later additive pass strands
//     every indexed-column drop (upload/relationship auto-indexes, unique,
//     index: true) behind an already-failed statement
//   - drop_column / drop_table: ensure F5's destructive-confirm runs first,
//     and stay symmetric with the pre-rename phase (ops we own end-to-end)
//
// Pre-dropping the index only reaches uniques that exist as a separate object.
// A `unique: true` field created AT THE SAME TIME as its SQLite table is
// rendered as a column-level UNIQUE inside CREATE TABLE, which SQLite backs
// with an internal `sqlite_autoindex_*`. That name is deliberately outside the
// managed set, no drop_index op is ever planned for it, and DROP INDEX cannot
// remove it in any case — so dropping such a column still fails with "cannot
// drop UNIQUE column". Fields that gained their unique later go through
// CREATE UNIQUE INDEX / ADD CONSTRAINT and are covered.
//
// Operations we let pushSchema handle (purely additive; no prompt in API):
//   - add_table, add_column, add_index
//   - change_column_type, change_column_nullable, change_column_default
export const PRE_RESOLUTION_OP_TYPES: ReadonlyArray<Operation["type"]> = [
  "rename_column",
  "rename_table",
  "drop_index",
  "drop_column",
  "drop_table",
] as const;

export function isPreResolutionOp(op: Operation): boolean {
  return (PRE_RESOLUTION_OP_TYPES as readonly string[]).includes(op.type);
}

// True when a (drop_column, add_column) pair could plausibly be a rename
// because they target the same table. The rename detector then applies
// type-family compatibility to decide the suggested resolution.
export function isPotentialRenamePair(
  drop: DropColumnOp,
  add: AddColumnOp
): boolean {
  return drop.tableName === add.tableName;
}
