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
import { isFieldLocalized } from "../../i18n/classify-fields";
import { COMPANION_STRUCTURAL_COLUMNS } from "../../i18n/migration/generate-up";
import { buildDesiredTableFromComponentFields } from "../../schema/pipeline/diff/build-from-fields";
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
    | "unrepresentable-column-name";
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
 * The columns a field group's main table has regardless of its fields.
 *
 * Derived by asking the desired-state builder for a table with NO fields, rather than listing the
 * system columns here. A hand-kept list is a second opinion about what the generator writes, and it
 * would present a newly added system column to the operator as an unknown user column to adopt.
 */
function mainSystemColumnNames(
  input: Pick<ReconcileInput<never>, "tableName" | "dialect" | "typeColumn">
): Set<string> {
  const skeleton = buildDesiredTableFromComponentFields(
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
  return new Set(skeleton.columns.map(column => column.name));
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
  storedLocalized: boolean
): boolean {
  // No companion at all is unambiguous: nothing was ever moved out.
  if (!liveCompanion) return false;
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

  const localized = deriveLocalized(liveCompanion, input.storedLocalized);

  const mainColumns = new Map(liveMain.columns.map(c => [c.name, c]));
  const companionColumns = new Map(
    (liveCompanion?.columns ?? []).map(c => [c.name, c])
  );

  const removed: ReconcileRemoval[] = [];
  const repaired: ReconcileRepair[] = [];
  const adopted: ReconcileAdoption[] = [];
  const blockers: ReconcileBlocker[] = [];
  const fields: F[] = [];

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

    // 🔴 The PHYSICAL type, through the diff engine's own canonical form so `varchar(255)` and
    // `varchar` are one answer. A name match is not evidence the column still stores what the field
    // declares: a confirmed apply can change `number` to `text` and then fail its registry write,
    // and keeping the stored logical type would mark `synced` a definition the next diff instantly
    // disagrees with. Which logical type now belongs there cannot be derived — many map to one
    // physical column — so this refuses and names the drift rather than guessing.
    const liveType = normalizeType(live.type);
    const declaredType = normalizeType(descriptor.dialectType);
    if (liveType !== undefined && declaredType !== liveType) {
      blockers.push({
        fieldName: field.name,
        columnName: descriptor.name,
        kind: "physical-type-changed",
        detail: `"${field.name}" is declared ${field.type} (${descriptor.dialectType}) but its column is ${live.type}; the logical type that now belongs there cannot be derived from the column alone.`,
      });
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
  const systemMain = mainSystemColumnNames(input);
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
    }
    const guessedType = guessFieldType(column.type);
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
