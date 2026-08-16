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

import { isFieldLocalized } from "../../i18n/classify-fields";
import { COMPANION_STRUCTURAL_COLUMNS } from "../../i18n/migration/generate-up";
import { buildDesiredTableFromComponentFields } from "../../schema/pipeline/diff/build-from-fields";
import type {
  ColumnSpec,
  IndexSpec,
  TableSpec,
} from "../../schema/pipeline/diff/types";
import {
  getColumnDescriptor,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";

/** Which of a field group's two tables a column lives in. */
export type ReconcileTable = "main" | "companion";

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
  attribute: "required" | "unique" | "index";
  from: boolean;
  to: boolean;
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
  /** Re-derived from which table holds the columns — never read from a flag. */
  localized: boolean;
  removed: ReconcileRemoval[];
  repaired: ReconcileRepair[];
  adopted: ReconcileAdoption[];
  /** True when nothing needed changing, so a caller can skip the write entirely. */
  unchanged: boolean;
}

export interface ReconcileInput<F extends ReconcilableField> {
  storedFields: readonly F[];
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
  key: "required" | "unique" | "index",
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
      ...(input.typeColumn !== undefined ? { typeColumn: input.typeColumn } : {}),
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
function deriveLocalized(liveCompanion: TableSpec | null): boolean {
  if (!liveCompanion) return false;
  return liveCompanion.columns.some(
    column => !COMPANION_STRUCTURAL_COLUMNS.has(column.name)
  );
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

  const localized = deriveLocalized(liveCompanion);

  const mainColumns = new Map(liveMain.columns.map(c => [c.name, c]));
  const companionColumns = new Map(
    (liveCompanion?.columns ?? []).map(c => [c.name, c])
  );

  const removed: ReconcileRemoval[] = [];
  const repaired: ReconcileRepair[] = [];
  const adopted: ReconcileAdoption[] = [];
  const fields: F[] = [];

  /** Column names a stored field accounted for, so the leftovers can be adopted. */
  const claimedMain = new Set<string>();
  const claimedCompanion = new Set<string>();

  for (const field of storedFields) {
    const descriptor = getColumnDescriptor(field as never, dialect, "fieldGroup");
    // A layout-only field produces no column, so no live column can confirm or deny it. Keeping it
    // is the only correct answer: removing it would delete an authored field on the evidence of a
    // column that was never supposed to exist.
    if (!descriptor || descriptor.kind === "skip") {
      fields.push(field);
      continue;
    }

    const inCompanion = localized && isFieldLocalized(field as never, true);
    const table: ReconcileTable = inCompanion ? "companion" : "main";
    const live = inCompanion
      ? companionColumns.get(descriptor.name)
      : mainColumns.get(descriptor.name);

    if (!live) {
      // 🔴 REPORTED by identity and removed, never silently dropped. The summary is the only thing
      // that makes this visible: a field the operator had just added, whose column was never
      // created, disappears from the definition here and nothing else would say so.
      removed.push({ fieldName: field.name, columnName: descriptor.name });
      continue;
    }

    (inCompanion ? claimedCompanion : claimedMain).add(descriptor.name);

    let repairedField = field;

    // `required` is the field's spelling of NOT NULL. A primary key is exempt for the same reason
    // the diff exempts it: the key implies the constraint without declaring it.
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
    const guessedType = guessFieldType(column.type);
    adopted.push({
      fieldName: column.name,
      columnName: column.name,
      table,
      liveType: column.type,
      guessedType,
    });
    fields.push({
      name: column.name,
      type: guessedType,
      required: !column.nullable && column.primaryKey !== true,
      ...(table === "companion" ? { localized: true } : {}),
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
    unchanged:
      removed.length === 0 && repaired.length === 0 && adopted.length === 0,
  };
}
