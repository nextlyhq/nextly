/**
 * Decide how a field group's STORED definition must change to describe its LIVE tables.
 *
 * `diverged` means the tables moved and the row recording them did not, so the stored definition
 * describes the previous shape. This plans the repair of the RECORD. It never issues DDL, and it is
 * pure: every input is a value, so the decisions can be tested without a database.
 *
 * 🔴 The truth is SPLIT, and getting this backwards destroys what the repair exists to preserve:
 *
 * - the STORED definition is truth for what each field MEANS — its logical type, and every
 *   authored property this planner copies through untouched;
 * - the LIVE tables are truth for what SHAPE each column has — presence, nullability, indexes.
 *
 * The reason is that `ColumnSpec` carries a PHYSICAL type only. `email`, `url` and `text` are one
 * `text` column, so rebuilding the definitions from introspection would silently downgrade every
 * one of them, on the single path an operator runs to get out of trouble. So a matched field keeps
 * its declared type and only the physical attributes are corrected.
 *
 * `core-reconcile.ts` is prior art with the OPPOSITE polarity — it repairs the DATABASE to match the
 * declared schema. Copying its shape here would produce an operation that re-applies DDL, which is
 * the last thing a diverged group needs.
 *
 * @module domains/field-groups/services/reconcile-field-group-plan
 */

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { fieldToLocalizedColumnSpec } from "../../i18n/migration/field-to-column-spec";
import {
  COMPANION_KEY_COLUMNS,
  COMPANION_OPTIONAL_STRUCTURAL_COLUMNS,
  COMPANION_STRUCTURAL_COLUMNS,
} from "../../i18n/migration/generate-up";
import { buildDesiredTableFromComponentFields } from "../../schema/pipeline/diff/build-from-fields";
import { sizeFromDeclaration } from "../../schema/pipeline/diff/declared-size";
import { normalizeDefault } from "../../schema/pipeline/diff/normalize-default";
import { normalizeType } from "../../schema/pipeline/diff/normalize-type";
import type {
  ColumnSpec,
  IndexSpec,
  TableSpec,
} from "../../schema/pipeline/diff/types";
import {
  getColumnDescriptor,
  toSnakeCase,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";

/** Which of a field group's two tables a column lives in. */
export type ReconcileTable = "main" | "companion";

/**
 * What the table builder would write as a column's DEFAULT, with "no expectation" kept distinct
 * from "expected to have none".
 */
export interface ExpectedColumnDefault {
  /** False when no expectation could be derived at all; the comparison is then skipped. */
  known: boolean;
  /** The default expression, or `undefined` when the builder writes none. Read only when `known`. */
  value?: string;
}

/**
 * What a field name may be, mirroring the payload validator every other write path enforces.
 *
 * Stated here rather than imported because that validator takes a whole payload and throws; this
 * planner is pure and reports instead. Kept identical on purpose — a live column that cannot pass
 * the real validator must never be adopted, and the service re-validates the finished field set
 * through the shared validator before writing, so this is a filter rather than the boundary.
 */
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The properties this planner reads or rewrites. A caller's field carries more than this and keeps
 * it: the generic below preserves the concrete type, so authored properties this module has never
 * heard of survive the repair untouched.
 */
export interface ReconcilableField {
  name: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
}

/** A stored field whose column is gone from both tables. */
export interface ReconcileRemoval {
  fieldName: string;
  columnName: string;
}

/** A stored field kept for its meaning, with one physical attribute corrected. */
export interface ReconcileRepair {
  fieldName: string;
  columnName: string;
  table: ReconcileTable;
  attribute: "required" | "unique" | "index" | "localized";
  from: boolean;
  to: boolean;
}

/**
 * A drift the planner can SEE but must not decide, so the whole repair refuses.
 *
 * Reported rather than resolved because each of these is genuinely ambiguous — the database holds
 * two readings and nothing in it says which the operator meant. Guessing would write a definition
 * that describes neither, and this operation's whole value is that its output describes the tables.
 */
export interface ReconcileBlocker {
  fieldName: string;
  columnName: string;
  kind:
    | "column-on-both-tables"
    | "physical-type-changed"
    | "unrepresentable-column-name"
    // A system column or index the generator always emits is absent from the live table. Repairing
    // it needs DDL, which this operation deliberately never issues.
    | "structural-column-missing"
    | "system-index-missing"
    // The column's DEFAULT no longer matches the authored one. Physical, and not recoverable from
    // the column alone: which side is intended is a question only the operator can answer.
    | "column-default-changed"
    // A stored field vanished while an unclaimed column appeared, which is equally a rename and a
    // drop-plus-add. Resolving it either way discards authored configuration or invents it.
    | "ambiguous-rename";
  detail: string;
}

/** A live column no stored field described, adopted with a type this planner had to guess. */
export interface ReconcileAdoption {
  fieldName: string;
  columnName: string;
  table: ReconcileTable;
  /** The physical type introspection reported, so the summary can show what the guess came from. */
  liveType: string;
  /** Always a guess — the physical type cannot name the logical one it came from. */
  guessedType: string;
}

export interface ReconcilePlan<F extends ReconcilableField> {
  /** The repaired field set, in the stored order, with adoptions appended. */
  fields: F[];
  /**
   * Re-derived from WHERE the columns are, except where the tables cannot say.
   *
   * A companion holding only structural columns is the ambiguous case: it is what both a
   * never-localized group and a localized group whose last translatable field was removed leave
   * behind. The stored flag breaks that tie — the one place it is evidence rather than the value
   * in doubt.
   */
  localized: boolean;
  removed: ReconcileRemoval[];
  repaired: ReconcileRepair[];
  adopted: ReconcileAdoption[];
  /** Non-empty means the caller must REFUSE rather than write. */
  blockers: ReconcileBlocker[];
  /** True when nothing needed changing, so a caller can skip the write entirely. */
  unchanged: boolean;
}

export interface ReconcileInput<F extends ReconcilableField> {
  storedFields: readonly F[];
  /**
   * The entity-level flag as the ROW records it, so drift in the flag alone is a change.
   *
   * The primary divergence this operation repairs is a localization transition whose DDL landed
   * and whose row write failed — a state where every FIELD matches its (new) table and only this
   * flag is wrong. A no-op decision computed from the field lists alone reports that as
   * unchanged, and the caller then skips exactly the write the repair exists to make.
   */
  storedLocalized: boolean;
  dialect: SupportedDialect;
  tableName: string;
  /** Introspected `comp_<slug>`. */
  liveMain: TableSpec;
  /** Introspected `comp_<slug>_locales`, or `null` when the table does not exist. */
  liveCompanion: TableSpec | null;
  /**
   * The discriminator the main table actually carries, probed by the caller.
   *
   * A system column's name is a fact about the table rather than a preference — the two storage
   * generations spell it differently — so naming the wrong one would present the real discriminator
   * as an unknown column and adopt it as a user field.
   */
  typeColumn?: string;
  /**
   * The column type the code that BUILDS these tables would give `field` in `table`.
   *
   * 🔴 Asked per (field, table) rather than supplied as a finished map, because the answer depends
   * on BOTH and only this module knows the second one. The two tables are built by different code —
   * the main table by `FieldGroupSchemaService`, the companion by the localization renderer — and
   * they spell the same field differently: a PostgreSQL `email` is `VARCHAR(255)` on the main table
   * and `TEXT` in the companion. A map keyed by column name alone has to pick one of those before
   * placement is known, and the placement it would have to guess from is the stored flag, which is
   * exactly the value this operation exists to correct. Guessing it wrong reports drift on the
   * PRIMARY divergence being repaired.
   *
   * Also the reason this takes the type rather than the rendered DDL: `getColumnDescriptor` answers
   * differently again (a MySQL `date` is `DATETIME` here and `timestamp` there), and reading a type
   * back out of printed SQL silently truncates any type spelled with more than one word.
   *
   * Returns the type as that code spells it; this module normalises both sides before comparing.
   * `undefined` means no expectation could be derived, which is NOT evidence of drift — those
   * columns are skipped rather than blocked, since treating an underivable answer as a mismatch is
   * what made an earlier version refuse healthy groups.
   *
   * A function rather than data so this module stays pure: the callers own the services and the
   * imports, and nothing here reaches for either.
   */
  expectedColumnType?: (field: F, table: ReconcileTable) => string | undefined;
  /**
   * The DEFAULT the code that builds `table` would give `field`.
   *
   * 🔴 Three-valued on purpose, and the third state is what makes the check correct rather than
   * merely present. "I could not derive an expectation" and "the builder writes no default" are
   * different claims that a bare `string | undefined` collapses into one value — and collapsing
   * them costs the case most worth catching, where an authored default was REMOVED from the
   * definition while the live column still carries it. Under the collapsed shape that reads as
   * nothing to compare, so the drift the check exists for is exactly what it cannot see.
   *
   * `known: false` is skipped, matching `expectedColumnType`: an underivable expectation is not
   * evidence of drift.
   */
  expectedColumnDefault?: (
    field: F,
    table: ReconcileTable
  ) => ExpectedColumnDefault;
  /**
   * The DEFAULT each SYSTEM column is created with, by column name.
   *
   * Separate from `expectedColumnDefault` because these belong to no FIELD: nothing derived from
   * the field list describes `_order` or the timestamps, and the desired-state skeleton records
   * `undefined` for every one of them — so comparing the skeleton against a live table would report
   * drift on every healthy database. The creator is the only side that knows.
   *
   * Load-bearing rather than cosmetic: the generated runtime schema declares these as DATABASE
   * defaults, so Drizzle omits the columns from an INSERT and the database supplies the value. A
   * dropped default fails a NOT NULL insert, or silently stores NULL where a zero was intended.
   */
  structuralColumnDefaults?: ReadonlyMap<string, string>;
}

/**
 * Build a field that is a copy of `field` with one boolean property overridden.
 *
 * Spread rather than mutation so the caller's stored field is never altered in place, and so every
 * property this module does not know about is carried through.
 */
function withOverride<F extends ReconcilableField>(
  field: F,
  key: "required" | "unique" | "index" | "localized",
  value: boolean
): F {
  return { ...field, [key]: value };
}

/**
 * What a field group's main table carries regardless of its fields — columns AND indexes.
 *
 * Derived by asking the desired-state builder for a table with NO fields, rather than listing the
 * system columns here. A hand-kept list is a second opinion about what the generator writes, and it
 * would present a newly added system column to the operator as an unknown user column to adopt.
 *
 * 🔴 The WHOLE spec is kept, not just the names. An earlier version narrowed this to a name set at
 * the point of derivation, which silently discarded the parent-link composite index — and a
 * discarded requirement cannot be checked, so the plan could report a table healthy while the index
 * every parent-scoped query depends on was absent. Whatever the builder adds next is carried here
 * for free; narrowing it again is what makes the next addition an unchecked requirement.
 */
function mainSkeleton(
  input: Pick<ReconcileInput<never>, "tableName" | "dialect" | "typeColumn">
): TableSpec {
  return buildDesiredTableFromComponentFields(
    input.tableName,
    [],
    input.dialect,
    {
      builtBy: "fieldGroup",
      ...(input.typeColumn !== undefined
        ? { typeColumn: input.typeColumn }
        : {}),
    }
  );
}

/**
 * The size modifier a type carries, normalised for comparison — `VARCHAR(255)` gives `255`.
 *
 * 🔴 Compared SEPARATELY from the type token because the canonical form deliberately strips it, and
 * that strip is correct for the reason its own module gives: PostgreSQL introspection reads
 * `udt_name`, which never carries a length, so keeping it would report drift on every healthy
 * PostgreSQL column. MySQL introspection reads `COLUMN_TYPE`, which DOES carry it — so a `maxLength`
 * change that resized a column and then failed its registry write leaves `VARCHAR(32)` live against
 * an authored `VARCHAR(255)`, and the two compare equal once the modifier is gone.
 *
 * Gated on BOTH sides having one rather than on a dialect name: presence is the property that
 * decides whether the comparison is meaningful, and a dialect list would be a second opinion about
 * which introspector preserves widths.
 */
const typeModifier = sizeFromDeclaration;

/**
 * Whether a live table carries an index covering exactly these columns, in this order.
 *
 * Matched by the ordered column LIST and uniqueness rather than by NAME: an engine appends a
 * collision suffix and truncates at its identifier limit, so the name is the engine's choice rather
 * than a property of the object. Order is significant — only `(a, b)` serves a left-prefix lookup on
 * `a` — which is why `indexKey` from the diff utilities is deliberately not reused here: it SORTS
 * the columns and so reads `(a, b)` and `(b, a)` as one index.
 */
function hasIndexOverColumns(
  indexes: readonly IndexSpec[] | undefined,
  columns: readonly string[],
  unique: boolean
): boolean {
  return (indexes ?? []).some(
    index =>
      index.columns.length === columns.length &&
      index.columns.every((column, at) => column === columns[at]) &&
      (index.unique === true) === unique
  );
}

/**
 * Structural requirements the live tables must already meet before any repair is planned.
 *
 * 🔴 These are BLOCKERS rather than repairs, because this operation never issues DDL. A missing
 * `_parent_id` or a missing parent-link index is a defect in the TABLE, and the only honest thing a
 * definition-only repair can do about it is refuse — writing `synced` over it would certify a table
 * that cannot answer the queries the runtime is about to register against it.
 *
 * Checked against the skeleton the generator produces rather than a list kept here, so a structural
 * column or index added later is required the moment the generator emits it.
 */
function structuralBlockers(
  skeleton: TableSpec,
  liveMain: TableSpec,
  liveCompanion: TableSpec | null,
  localized: boolean,
  structuralDefaults: ReadonlyMap<string, string> | undefined
): ReconcileBlocker[] {
  const blockers: ReconcileBlocker[] = [];
  const liveMainByName = new Map(liveMain.columns.map(c => [c.name, c]));

  // 🔴 The main table's key compared as a WHOLE, for the reason the companion's is. Asking only
  // whether `id` participates in a key accepts a composite `(id, user_column)`, which enforces
  // uniqueness over the pair and so lets one component id repeat whenever the other value differs —
  // the guarantee `id` exists for, absent, behind a check that passes. Membership is the wrong
  // question on either table; equality is the property both keys actually need.
  const skeletonKey = skeleton.columns
    .filter(column => column.primaryKey === true)
    .map(column => column.name);
  const liveMainKey = liveMain.columns
    .filter(column => column.primaryKey === true)
    .map(column => column.name);
  const mainKeyMatches =
    skeletonKey.length === liveMainKey.length &&
    skeletonKey.every(name => liveMainKey.includes(name));
  if (skeletonKey.length > 0 && !mainKeyMatches) {
    blockers.push({
      fieldName: skeletonKey.join(", "),
      columnName: skeletonKey.join(", "),
      kind: "structural-column-missing",
      detail: `${liveMain.name} has the primary key (${liveMainKey.join(", ") || "none"}) where every field-group table is keyed on (${skeletonKey.join(", ")}); any other key lets one row's identity repeat, and this operation issues no DDL to restore it.`,
    });
  }

  for (const column of skeleton.columns) {
    const live = liveMainByName.get(column.name);
    if (live === undefined) {
      blockers.push({
        fieldName: column.name,
        columnName: column.name,
        kind: "structural-column-missing",
        detail: `${liveMain.name} is missing the system column "${column.name}", which every field-group table carries; the definition cannot describe a table that cannot store its own rows.`,
      });
      continue;
    }
    // 🔴 Presence is not the whole requirement, and neither is the key. A system column can survive
    // with its TYPE or its NULLABILITY changed, and both break the assumptions the runtime schema
    // is about to be registered on: a nullable `_parent_id` admits rows belonging to no parent, and
    // a retyped one makes the parent-scoped queries compare values that no longer correspond. Every
    // attribute the skeleton states is therefore compared, rather than a list of the ones that have
    // been noticed so far.
    //
    // The skeleton is the only side that can be authoritative here: these columns belong to no
    // field, so nothing else in this module describes them.
    const attributeDrift: string[] = [];
    const wantType = normalizeType(column.type);
    const haveType = normalizeType(live.type);
    if (
      wantType !== undefined &&
      haveType !== undefined &&
      wantType !== haveType
    ) {
      attributeDrift.push(
        `is ${live.type} where the table requires ${column.type}`
      );
    }
    // Only a column the skeleton declares NOT NULL is checked. The reverse — a column the generator
    // leaves nullable that is live NOT NULL — rejects nothing this operation can repair and would
    // refuse tables an older generation created with a tighter constraint.
    if (column.nullable === false && live.nullable === true) {
      attributeDrift.push("is nullable where the table requires a value");
    }
    // The system column's DEFAULT, taken from the creator rather than the skeleton, which records
    // none for any of them. Compared through the diff engine's normaliser so a dialect reporting
    // `now()` where the DDL wrote `NOW()` is not drift.
    const wantDefault = structuralDefaults?.get(column.name);
    if (wantDefault !== undefined) {
      const want = normalizeDefault(wantDefault, column.type);
      const have = normalizeDefault(live.default, live.type);
      if (want !== have) {
        attributeDrift.push(
          `defaults to ${have ?? "nothing"} where the table requires ${want ?? "nothing"}`
        );
      }
    }
    if (attributeDrift.length > 0) {
      blockers.push({
        fieldName: column.name,
        columnName: column.name,
        kind: "structural-column-missing",
        detail: `${liveMain.name} still has "${column.name}" but it ${attributeDrift.join(" and ")}; this operation issues no DDL and cannot restore the structure.`,
      });
    }
  }

  // 🔴 Required indexes come from what the table BUILDER creates, not from the skeleton's index
  // list. The two disagree: the migrate snapshot builder additionally emits a `created_at` index
  // that `FieldGroupSchemaService` never creates, so requiring the skeleton's whole list refuses
  // every healthy table — measured on all three dialects, which is how this was caught. Columns
  // rather than a name, because the engine picks the name and truncates or suffixes it.
  const requiredIndexColumns = STORAGE_FORMAT.parentIndexColumns;
  if (!hasIndexOverColumns(liveMain.indexes, requiredIndexColumns, false)) {
    blockers.push({
      fieldName: requiredIndexColumns.join(", "),
      columnName: requiredIndexColumns.join(", "),
      kind: "system-index-missing",
      detail: `${liveMain.name} is missing its required index over (${requiredIndexColumns.join(", ")}); parent-scoped reads depend on it, and this operation issues no DDL to restore it.`,
    });
  }

  // Only meaningful once the companion is genuinely in use: a companion holding nothing but
  // structural columns is the ambiguous case `deriveLocalized` resolves from the stored flag, and
  // demanding structure from a table nothing was moved into would refuse a healthy group.
  if (localized && liveCompanion) {
    const liveCompanionColumns = new Set(
      liveCompanion.columns.map(c => c.name)
    );
    // 🔴 The exempt columns are subtracted rather than required. The structural set describes
    // companions in general and is right for its own purpose — subtracting it from a table leaves
    // the translated columns — but not every column in it is one a healthy companion must
    // physically have. `COMPANION_OPTIONAL_STRUCTURAL_COLUMNS` carries the reason for each
    // exemption beside the column itself: `_status` because a FIELD GROUP is never
    // Draft/Published, so its companion is built with `status: false` and never has that column;
    // `_updated_at` because it is added to existing companions by migration, so a companion
    // predating it is healthy-but-unstamped and its absence already means UNKNOWN to the only
    // thing that reads it.
    //
    // Still derived by exclusion rather than by listing what remains, which keeps the property
    // this was written for: a genuinely unconditional column added to the structural set later is
    // required here without this being touched. What changed is only that exempting one is now a
    // stated decision at the definition rather than a hard-coded name at the use.
    const requiredCompanionColumns = [...COMPANION_STRUCTURAL_COLUMNS].filter(
      column => !COMPANION_OPTIONAL_STRUCTURAL_COLUMNS.has(column)
    );
    for (const required of requiredCompanionColumns) {
      if (liveCompanionColumns.has(required)) continue;
      blockers.push({
        fieldName: required,
        columnName: required,
        kind: "structural-column-missing",
        detail: `${liveCompanion.name} holds translated values but is missing the system column "${required}", so its rows cannot be matched back to a parent or a locale.`,
      });
    }

    // 🔴 The composite key is load-bearing at RUNTIME, not merely structural: `upsertCompanionRow`
    // names `(_parent, _locale)` as its conflict target. A companion that kept those columns and
    // lost the key looks healthy to every check above while failing every localized write on
    // PostgreSQL and SQLite, and silently accepting duplicate locale rows on MySQL — which is the
    // worse outcome, because nothing reports it. Checked only where the columns are present, so a
    // table already refused above is not reported twice for the same cause.
    // 🔴 The WHOLE key, not membership of it. A key of `(_parent, _locale, title)` contains both
    // required columns and provides none of the guarantee they exist for: the uniqueness it
    // enforces is over three values, so PostgreSQL and SQLite have no constraint matching the
    // runtime's `(_parent, _locale)` conflict target and MySQL admits several rows per parent and
    // locale whenever the third value differs. Membership passes that table; equality is what the
    // claim actually needs.
    //
    // Compared as a SET rather than as an ordered list, and that limit is real: a snapshot records
    // `primaryKey` per column and carries no key ordinal, so a key over the right columns in the
    // wrong order is indistinguishable here. It is reported as unchecked rather than assumed
    // correct — the uniqueness guarantee, which is what the runtime depends on, does not vary with
    // key order.
    const liveKey = liveCompanion.columns
      .filter(column => column.primaryKey === true)
      .map(column => column.name);
    const required = [...COMPANION_KEY_COLUMNS];
    const keyMatches =
      liveKey.length === required.length &&
      required.every(column => liveKey.includes(column));
    if (!keyMatches) {
      blockers.push({
        fieldName: required.join(", "),
        columnName: required.join(", "),
        kind: "structural-column-missing",
        detail: `${liveCompanion.name} has the primary key (${liveKey.join(", ") || "none"}) where localized writes match rows on (${required.join(", ")}); without exactly that key the write has no matching constraint and duplicate locale rows are possible.`,
      });
    }
  }

  return blockers;
}

/**
 * Whether a live companion means the group is localized.
 *
 * 🔴 Re-derived from WHICH TABLE HOLDS THE COLUMNS, never from a flag. `TableSpec.localized` is
 * documented in the diff types as a config-derived marker that introspected snapshots cannot know,
 * and the STORED flag is exactly the value in doubt when a group is diverged. What is observable is
 * that a companion exists and carries at least one column that is not structural: an empty
 * companion holding only `_parent`/`_locale` is a table nothing was moved into.
 */
function deriveLocalized(
  liveCompanion: TableSpec | null,
  storedLocalized: boolean,
  // Whether this field set would produce any companion COLUMN, by the same predicate the
  // production companion builder uses to decide whether to make the table at all.
  companionWouldHaveColumns: boolean
): boolean {
  // 🔴 No companion is only evidence when a companion was DUE. `deriveCompanionSpec` returns null
  // for a localized entity whose fields produce no localized columns, so a healthy `localized: true`
  // group made only of non-localized or columnless fields correctly has no companion table. Reading
  // that absence as "not localized" rewrites a healthy group, and the damage lands later: the next
  // default-translatable field added to it goes to the MAIN table, which is the divergence this
  // operation exists to clear rather than create.
  if (!liveCompanion)
    return companionWouldHaveColumns ? false : storedLocalized;
  if (
    liveCompanion.columns.some(
      column => !COMPANION_STRUCTURAL_COLUMNS.has(column.name)
    )
  ) {
    return true;
  }
  // 🔴 A companion holding ONLY structural columns is physically ambiguous, and reading it as
  // "not localized" is wrong in a way that compounds: a healthy localized group whose last
  // translatable field was removed looks exactly like this, and rewriting it as non-localized
  // would send the next default-translatable field to the main table instead of the companion —
  // making the documented idempotent repair the thing that breaks the group. The tables cannot
  // separate the two readings, so the stored flag decides, which is the one case where it is
  // evidence rather than the value under repair.
  return storedLocalized;
}

/**
 * Whether an index covering exactly this one column exists, and whether it is unique.
 *
 * Compares the column LIST rather than the index name: an engine appends a collision suffix and
 * truncates at its identifier limit, so there is no single name to match. The list's ORDER is
 * significant for a composite index, which is why this asks for a single-column index by exact
 * membership rather than reusing `indexKey` from the diff utilities — that helper SORTS the columns
 * and so cannot separate `(a, b)` from `(b, a)`.
 */
function indexOver(
  indexes: readonly IndexSpec[] | undefined,
  columnName: string
): { present: boolean; unique: boolean } {
  const match = (indexes ?? []).find(
    index => index.columns.length === 1 && index.columns[0] === columnName
  );
  return { present: match !== undefined, unique: match?.unique === true };
}

/**
 * Guess a logical field type from a physical column.
 *
 * 🔴 This is a GUESS and the plan labels it as one. The physical type cannot name the logical type
 * it came from — `email`, `url` and `text` are all `text` — so this returns the widest type that
 * stores the column's values without loss. The operator corrects it from the summary, and doing so
 * is a definition-only edit: a narrower text type occupies the same column, so no DDL follows.
 *
 * Matched by PREFIX on the type token because dialects spell widths and precisions inline
 * (`varchar(255)`, `int(11)`, `numeric(10,2)`), and an exact-match list would fail to recognise
 * exactly the columns that carry a size.
 */
function guessFieldType(liveType: string): string {
  const token = liveType.trim().toLowerCase();
  const startsWithAny = (...prefixes: string[]): boolean =>
    prefixes.some(prefix => token.startsWith(prefix));

  if (startsWithAny("bool", "tinyint(1)")) return "checkbox";
  if (startsWithAny("json")) return "json";
  if (startsWithAny("timestamp", "datetime", "date")) return "date";
  if (startsWithAny("numeric", "decimal", "float", "double", "real"))
    return "number";
  if (startsWithAny("int", "bigint", "smallint", "serial")) return "number";
  // Everything else stores text. `textarea` rather than `text` would assert a widget the column
  // cannot evidence, so this returns the plainest text field.
  return "text";
}

/**
 * Plan the repair of a field group's stored definition against its live tables.
 *
 * Every question is answered by the code that already owns it — the desired-state builder for
 * system columns, the column descriptor for names, the localization predicate for placement — so
 * this cannot disagree with what actually created the tables.
 */
export function planFieldGroupReconcile<F extends ReconcilableField>(
  input: ReconcileInput<F>
): ReconcilePlan<F> {
  const { storedFields, dialect, liveMain, liveCompanion } = input;

  // Asked of the production column builder rather than of the field flags alone: a field can be
  // marked translatable and still produce no companion column, and it is the COLUMN that decides
  // whether a companion exists.
  const companionWouldHaveColumns = storedFields.some(
    field =>
      isFieldLocalized(field, true) &&
      fieldToLocalizedColumnSpec(field, dialect, "fieldGroup") !== null
  );
  const localized = deriveLocalized(
    liveCompanion,
    input.storedLocalized,
    companionWouldHaveColumns
  );

  const mainColumns = new Map(liveMain.columns.map(c => [c.name, c]));
  const companionColumns = new Map(
    (liveCompanion?.columns ?? []).map(c => [c.name, c])
  );

  const removed: ReconcileRemoval[] = [];
  const repaired: ReconcileRepair[] = [];
  const adopted: ReconcileAdoption[] = [];
  const fields: F[] = [];

  // What the generator says this table always has. Derived once and used for BOTH questions it
  // answers — which live columns are system columns rather than adoptable user ones, and which
  // structural columns and indexes the table is required to already have.
  const skeleton = mainSkeleton(input);

  // Structural integrity first: these describe a table that cannot do its job, and no amount of
  // definition repair changes that. Collected before any field is examined so a refusal names the
  // real problem rather than the field-level symptoms a broken table produces downstream.
  const blockers: ReconcileBlocker[] = structuralBlockers(
    skeleton,
    liveMain,
    liveCompanion,
    localized,
    input.structuralColumnDefaults
  );

  /** Column names a stored field accounted for, so the leftovers can be adopted. */
  const claimedMain = new Set<string>();
  const claimedCompanion = new Set<string>();
  /**
   * Kept columnless fields, by the column name each WOULD occupy. A stored `component` field that
   * a failed apply turned into a scalar leaves a live column under this very name; adopting it
   * while also keeping the columnless field would persist two fields with one name, and the
   * conditional write would then mark that ambiguity `synced`. The collision replaces the
   * columnless field — reported as a removal — rather than preserving both.
   */
  const columnlessByColumnName = new Map<string, F>();
  /**
   * Removals whose replacement column is known, so they are NOT candidates for a rename pairing.
   *
   * The columnless case above pairs a field and a column that share a name; every other removal is
   * a field whose column simply vanished, and those are the ones an unclaimed column could equally
   * well be a rename of.
   */
  const displacedRemovals = new Set<string>();

  for (const field of storedFields) {
    const descriptor = getColumnDescriptor(
      field as unknown as FieldDefinition,
      dialect,
      "fieldGroup"
    );
    // A layout-only field produces no column, so no live column can confirm or deny it. Keeping it
    // is the only correct answer: removing it would delete an authored field on the evidence of a
    // column that was never supposed to exist.
    if (!descriptor || descriptor.kind === "skip") {
      fields.push(field);
      columnlessByColumnName.set(toSnakeCase(field.name), field);
      continue;
    }

    // 🔴 Located across BOTH tables rather than only the one the stored flag implies. A `localized`
    // toggle on a single field MOVES its column between them, and a half-applied toggle is exactly
    // what this repairs — so searching only the expected table would report the field as removed
    // and then re-adopt its column from the other table as a minimal guess, discarding the logical
    // type, options and admin config the operator authored. Finding it where it actually IS keeps
    // all of that and corrects the placement flag instead.
    const expectedInCompanion = localized && isFieldLocalized(field, true);
    const onMain = mainColumns.get(descriptor.name);
    const onCompanion = companionColumns.get(descriptor.name);

    if (onMain && onCompanion) {
      // Both tables hold it: a localization enable that created and seeded the companion without
      // finishing the main-table drops. Which copy carries the live values is not something the
      // catalog can answer, and choosing wrong strands content silently — so the repair refuses.
      blockers.push({
        fieldName: field.name,
        columnName: descriptor.name,
        kind: "column-on-both-tables",
        detail: `"${descriptor.name}" exists on both ${input.tableName} and its companion, so which copy holds the live values cannot be determined from the schema.`,
      });
      claimedMain.add(descriptor.name);
      claimedCompanion.add(descriptor.name);
      fields.push(field);
      continue;
    }

    const live = onMain ?? onCompanion;

    if (!live) {
      // 🔴 REPORTED by identity and removed, never silently dropped. The summary is the only thing
      // that makes this visible: a field the operator had just added, whose column was never
      // created, disappears from the definition here and nothing else would say so.
      removed.push({ fieldName: field.name, columnName: descriptor.name });
      continue;
    }

    const inCompanion = onCompanion !== undefined;
    const table: ReconcileTable = inCompanion ? "companion" : "main";
    (inCompanion ? claimedCompanion : claimedMain).add(descriptor.name);

    let repairedField = field;

    // The column moved between tables, so the field's own placement flag is what is stale. The
    // authored meaning is kept and only that flag corrected.
    if (inCompanion !== expectedInCompanion) {
      repaired.push({
        fieldName: field.name,
        columnName: descriptor.name,
        table,
        attribute: "localized",
        from: expectedInCompanion,
        to: inCompanion,
      });
      repairedField = withOverride(repairedField, "localized", inCompanion);
    }

    // 🔴 The PHYSICAL type, compared against what the CREATOR would write — never against the
    // column descriptor, which answers differently for the same field and made this check refuse
    // healthy groups. Both sides go through the diff engine's canonical form so `VARCHAR(255)` and
    // `varchar` are one answer.
    //
    // A name match is not evidence the column still stores what the field declares: a confirmed
    // apply can change `number` to `text` and then fail its registry write, and keeping the stored
    // logical type would mark `synced` a definition the next diff instantly disagrees with. Which
    // logical type now belongs there cannot be derived — many map to one physical column — so this
    // refuses and names the drift rather than guessing.
    //
    // Asked for the table the column was actually FOUND in, which is `table` above rather than the
    // placement the stored flag implies: the two disagree precisely when a group has diverged, and
    // the tables spell the same field differently, so asking about the wrong one manufactures a
    // mismatch on the case this operation exists to repair.
    const expectedSpelling = input.expectedColumnType?.(field, table);
    const expectedType = normalizeType(expectedSpelling);
    const liveType = normalizeType(live.type);
    // The width is part of the physical type wherever the database reports one. Both must carry a
    // modifier for the comparison to mean anything: where the introspector drops it, an absent
    // modifier says nothing about the column and treating that as a mismatch would refuse every
    // healthy group on that dialect.
    const expectedWidth = typeModifier(expectedSpelling);
    // 🔴 From what introspection REPORTED, not from the live type string. On PostgreSQL that
    // string is `udt_name`, which never carries a modifier — so parsing it made this comparison
    // permanently inert on the dialect where a varchar length or numeric precision change is most
    // likely to be the whole edit. The snapshot records the modifier separately, gated per dialect
    // to what was actually declared.
    const liveWidth = live.typeModifier;
    const widthDiffers =
      expectedWidth !== undefined &&
      liveWidth !== undefined &&
      expectedWidth !== liveWidth;
    if (
      (expectedType !== undefined &&
        liveType !== undefined &&
        expectedType !== liveType) ||
      widthDiffers
    ) {
      blockers.push({
        fieldName: field.name,
        columnName: descriptor.name,
        kind: "physical-type-changed",
        // Both sides named as they are actually SPELLED, not as they compare. The canonical forms
        // decide the verdict, and an operator reading "double vs float8" has to work out which
        // declaration and which column those stand for.
        detail: `"${field.name}" is declared ${field.type}, whose column this database would create as ${expectedSpelling}, but the live column is ${live.type}; the logical type that now belongs there cannot be derived from the column alone.`,
      });
    }

    // The DEFAULT is physical exactly as the type is, and it drifts the same way: an apply that
    // changed a checkbox's default can commit its DDL and then fail its registry write, leaving a
    // column whose name, type, nullability and indexes all still match. Nothing above notices, so
    // without this the plan reports no repair and marks the row `synced` while every insert that
    // omits the field keeps receiving a value the definition does not specify.
    //
    // Refuses rather than repairs, for the same reason the type does: the column cannot say whether
    // the authored default or the live one is the intended survivor. Both sides go through the
    // diff engine's normaliser so `true`, `'true'::boolean` and `1` are one answer per dialect.
    const expectedDefault = input.expectedColumnDefault?.(field, table);
    if (expectedDefault?.known === true) {
      const want = normalizeDefault(expectedDefault.value, live.type);
      const have = normalizeDefault(live.default, live.type);
      if (want !== have) {
        blockers.push({
          fieldName: field.name,
          columnName: descriptor.name,
          kind: "column-default-changed",
          detail: `"${field.name}" declares ${want === undefined ? "no default" : `the default ${want}`}, but the live column ${have === undefined ? "has none" : `defaults to ${have}`}; rows inserted without this field would not get the value the definition specifies.`,
        });
      }
    }

    // `required` is the field's spelling of NOT NULL, and only the MAIN table can testify to it:
    // companion columns are created nullable regardless of the field's declaration, because a row
    // may legitimately have no value for a locale. A primary key is exempt for the same reason the
    // diff exempts it: the key implies the constraint without declaring it.
    if (!inCompanion) {
      const liveRequired = !live.nullable && live.primaryKey !== true;
      if ((field.required === true) !== liveRequired) {
        repaired.push({
          fieldName: field.name,
          columnName: descriptor.name,
          table,
          attribute: "required",
          from: field.required === true,
          to: liveRequired,
        });
        repairedField = withOverride(repairedField, "required", liveRequired);
      }
    }

    // Indexes live only on the main table; the companion is keyed by `(_parent, _locale)` and
    // carries no per-field index, so asking about one there would compare against an absence that
    // is structural rather than a drift.
    if (!inCompanion) {
      const { present, unique } = indexOver(liveMain.indexes, descriptor.name);
      // `indexes: undefined` means the snapshot tracks no index data at all, which is a different
      // statement from "there are none". Correcting against it would strip every declared index on
      // the strength of never having looked.
      if (liveMain.indexes !== undefined) {
        if ((field.unique === true) !== unique) {
          repaired.push({
            fieldName: field.name,
            columnName: descriptor.name,
            table,
            attribute: "unique",
            from: field.unique === true,
            to: unique,
          });
          repairedField = withOverride(repairedField, "unique", unique);
        }
        // A unique index satisfies a declared `index` as well, so only a field claiming an index
        // that no object of either kind provides is corrected.
        const indexed = present;
        if ((field.index === true) !== indexed && !unique) {
          repaired.push({
            fieldName: field.name,
            columnName: descriptor.name,
            table,
            attribute: "index",
            from: field.index === true,
            to: indexed,
          });
          repairedField = withOverride(repairedField, "index", indexed);
        }
      }
    }

    fields.push(repairedField);
  }

  // Whatever is left in the live tables is a column no stored field described.
  const systemMain = new Set(skeleton.columns.map(column => column.name));
  const adopt = (
    column: ColumnSpec,
    table: ReconcileTable,
    claimed: Set<string>,
    system: ReadonlySet<string>
  ): void => {
    if (claimed.has(column.name) || system.has(column.name)) return;
    // The same user column present on BOTH tables and claimed by no stored field. Adopting it
    // twice would write two fields under one name and mark the ambiguity synced, so the same
    // refusal the stored-field path makes applies here — reported once, from the main side.
    const otherTable =
      table === "main" ? companionColumns : new Map(mainColumns);
    if (
      otherTable.has(column.name) &&
      !COMPANION_STRUCTURAL_COLUMNS.has(column.name)
    ) {
      if (table === "main") {
        blockers.push({
          fieldName: column.name,
          columnName: column.name,
          kind: "column-on-both-tables",
          detail: `"${column.name}" exists on both tables and no stored field describes it, so which copy to adopt cannot be determined from the schema.`,
        });
      }
      return;
    }
    // 🔴 A live identifier is not necessarily a legal field name — `Legacy-Title`, `2fa_code` and
    // anything added by hand outside the builder reach here verbatim. Adopting one would persist a
    // definition that violates the field contract and mark it synced, so the next builder save or
    // manifest validation fails on the row this operation just "repaired".
    if (!FIELD_NAME_PATTERN.test(column.name)) {
      blockers.push({
        fieldName: column.name,
        columnName: column.name,
        kind: "unrepresentable-column-name",
        detail: `"${column.name}" is not a usable field name, so it cannot be adopted into the definition; rename the column or remove it before reconciling.`,
      });
      return;
    }
    // A columnless field under this very name is what a half-applied type change leaves behind:
    // the DDL created the scalar column, the row still declares the columnless field. One name
    // must map to one field, so the columnless declaration gives way — as a REPORTED removal —
    // and the adoption below stands in for whatever the column now is.
    const displaced = columnlessByColumnName.get(column.name);
    if (displaced) {
      const at = fields.indexOf(displaced);
      if (at !== -1) fields.splice(at, 1);
      removed.push({ fieldName: displaced.name, columnName: column.name });
      // Paired with THIS adoption by construction — the field and the column share a name, so
      // nothing about the correspondence is guessed. Recorded so the rename check below does not
      // read this documented case as an unexplained removal standing beside an unexplained column.
      displacedRemovals.add(displaced.name);
    }
    const guessedType = guessFieldType(column.type);
    // 🔴 A live DEFAULT is part of what the column does, and the matched-field check above never
    // sees an adoption. Dropping it writes a definition that understates the column — inserts
    // omitting the field keep receiving the database's value while the definition says there is
    // none — and the next apply, diffing that definition against the table, removes the default
    // outright. So it is carried where the field contract can express it and refused where it
    // cannot, rather than silently discarded.
    //
    // Only a checkbox default is representable: it is the one default this schema's creator emits,
    // so a live default on any other adopted column is something the pipeline did not write, and
    // guessing a logical form for it would invent authored intent. System columns carry defaults
    // (`_order`, the timestamps) and never reach here — they are excluded from adoption above.
    const liveDefault = normalizeDefault(column.default, column.type);
    let adoptedDefault: boolean | undefined;
    if (liveDefault !== undefined) {
      if (
        guessedType === "checkbox" &&
        (liveDefault === "true" || liveDefault === "false")
      ) {
        adoptedDefault = liveDefault === "true";
      } else {
        blockers.push({
          fieldName: column.name,
          columnName: column.name,
          kind: "column-default-changed",
          detail: `"${column.name}" is described by no field and its column defaults to ${liveDefault}, which a ${guessedType} field cannot record; adopting it would drop the default from the definition and the next schema change would remove it from the table.`,
        });
        return;
      }
    }
    adopted.push({
      fieldName: column.name,
      columnName: column.name,
      table,
      liveType: column.type,
      guessedType,
    });
    // A live index over the column is meaning worth keeping: dropping it from the adopted field
    // would tell the next schema edit to remove an object the operator's database relies on.
    // Companion columns carry no per-field index, and their nullability says nothing about
    // `required` — the same two exclusions the repair loop above makes.
    const { present, unique } =
      table === "main"
        ? indexOver(liveMain.indexes, column.name)
        : { present: false, unique: false };
    fields.push({
      name: column.name,
      type: guessedType,
      required:
        table === "main" && !column.nullable && column.primaryKey !== true,
      ...(unique ? { unique: true } : {}),
      ...(present && !unique ? { index: true } : {}),
      ...(adoptedDefault !== undefined ? { defaultValue: adoptedDefault } : {}),
      // The flag is written in BOTH directions, because for text-like guesses silence is not
      // neutral: `isFieldLocalized` defaults them to translatable in a localized group, which
      // would re-home a column the planner just found on the MAIN table — recording, on the
      // repair path itself, another definition that does not describe the database.
      ...(table === "companion" ? { localized: true } : {}),
      ...(table === "main" && localized ? { localized: false } : {}),
    } as F);
  };

  for (const column of liveMain.columns) {
    adopt(column, "main", claimedMain, systemMain);
  }
  for (const column of liveCompanion?.columns ?? []) {
    adopt(column, "companion", claimedCompanion, COMPANION_STRUCTURAL_COLUMNS);
  }

  // 🔴 A vanished field standing beside an unclaimed column is TWO stories the schema cannot
  // separate: a rename whose DDL landed and whose registry write did not, or a deliberate drop and
  // a deliberate add. Resolving it silently costs something real either way — reading it as a drop
  // discards the authored validation, options, defaults and admin configuration the renamed field
  // carried, while reading it as a rename invents a correspondence nobody stated.
  //
  // So it refuses and names both sides. That is a precondition rather than a preference: the plan
  // is about to be written and marked `synced`, and the discarded configuration is not recoverable
  // from anything left in the database afterwards. The operator resolves it by renaming the field
  // in the definition (making it a match) or by deleting it (making the column a plain adoption),
  // and either edit is cheap next to reconstructing lost field configuration.
  const unexplainedRemovals = removed.filter(
    entry => !displacedRemovals.has(entry.fieldName)
  );
  if (unexplainedRemovals.length > 0 && adopted.length > 0) {
    const gone = unexplainedRemovals.map(entry => `"${entry.fieldName}"`);
    const appeared = adopted.map(entry => `"${entry.columnName}"`);
    blockers.push({
      fieldName: unexplainedRemovals[0]?.fieldName ?? "",
      columnName: adopted[0]?.columnName ?? "",
      kind: "ambiguous-rename",
      detail: `${gone.join(", ")} lost ${gone.length === 1 ? "its column" : "their columns"} while ${appeared.join(", ")} ${appeared.length === 1 ? "is" : "are"} described by no field, which is equally a rename and a drop-plus-add; rename the field in the definition to keep its configuration, or delete it to accept the column as new.`,
    });
  }

  return {
    fields,
    localized,
    removed,
    repaired,
    adopted,
    blockers,
    unchanged:
      removed.length === 0 &&
      repaired.length === 0 &&
      adopted.length === 0 &&
      // Flag drift is a change even when every field matches: a localization transition whose DDL
      // landed but whose row write failed differs ONLY here, and it is the primary state this
      // repair exists to clear.
      localized === input.storedLocalized,
  };
}
