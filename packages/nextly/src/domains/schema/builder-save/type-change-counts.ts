/**
 * What a save's review counted of each field changing type, as the person confirmed it, and the
 * check that the counts still hold. A type change goes ahead only while the values it keeps,
 * changes and loses are as many as were confirmed (`confirmedTypeChanges`), and one that loses
 * values only where they were: a value written after the review would be converted or cleared
 * without being shown, so the save is refused with the new counts and changes nothing.
 *
 * A save that confirms nothing (`confirmedTypeChanges` absent) was shown no counts: a change that
 * loses no value goes ahead, and one that does is refused.
 *
 * @module domains/schema/builder-save/type-change-counts
 */
import { NextlyError } from "../../../errors/nextly-error";
import {
  changedFieldName,
  type JudgedFieldTypeChange,
} from "../value-conversion/type-change/field-type-changes";
import type { ConversionReason } from "../value-conversion/types";

/** How many of a field's values its type change keeps, changes to the new type's form, and loses. */
export interface TypeChangeCounts {
  /** The field's name, or its path where it is held inside JSON (`changedFieldName`). */
  field: string;
  kept: number;
  changed: number;
  lost: number;
}

/** A field's counts as a person confirmed them, and the value chosen for the rows left with none. */
export interface ConfirmedTypeChange extends TypeChangeCounts {
  /**
   * The value the save writes into each row the change would leave with none, where the new field is
   * required (`ReviewedTypeChange.leavesEmpty`): in the new type's own JSON form.
   */
  fill?: unknown;
}

/** A field's type change as a save's review shows it: its counts, and the first rows of each. */
export interface ReviewedTypeChange extends TypeChangeCounts {
  /**
   * How many rows the change would leave with no value though the new field is required, which it is
   * refused for unless a fill is chosen (`ConfirmedTypeChange.fill`). Absent where there are none.
   */
  leavesEmpty?: number;
  /**
   * Each reason a value is not kept as it is (`new-form` for a changed one), its count and the
   * first of the rows, by key and, where the field is kept per language, by language: never a value.
   */
  reasons: readonly ConversionReason[];
}

/**
 * The fields whose lost values the person confirmed clearing, or replacing with a fill: the consent
 * the type-change judgement takes (`typeChangeRefusals`' `acknowledged`), by field name.
 */
export function clearedFieldsOf(
  confirmed: readonly ConfirmedTypeChange[] | undefined
): ReadonlySet<string> {
  return new Set(
    (confirmed ?? [])
      .filter(change => change.lost > 0 || change.fill !== undefined)
      .map(change => change.field)
  );
}

/** The fills chosen for the fields changing type (`EntityTypeChangeInput.fills`), by field name. */
export function chosenFillsOf(
  confirmed: readonly ConfirmedTypeChange[] | undefined
): ReadonlyMap<string, unknown> {
  return new Map(
    (confirmed ?? []).flatMap(change =>
      change.fill === undefined ? [] : [[change.field, change.fill] as const]
    )
  );
}

/**
 * Each judged field's counts, by its name: a field held in two tables (a translated one, or one
 * joining or leaving translation) counts the values of both.
 */
export function typeChangeCountsOf(
  judged: readonly JudgedFieldTypeChange[]
): TypeChangeCounts[] {
  const byField = new Map<string, TypeChangeCounts>();
  for (const change of judged) {
    const field = changedFieldName(change);
    const { kept, changed } = change.result.counts;
    const lost = change.result.cleared.length;
    const so = byField.get(field) ?? { field, kept: 0, changed: 0, lost: 0 };
    byField.set(field, {
      field,
      kept: so.kept + kept,
      changed: so.changed + changed,
      lost: so.lost + lost,
    });
  }
  return [...byField.values()];
}

/** Each judged field as the review shows it (`ReviewedTypeChange`). */
export function reviewedTypeChanges(
  judged: readonly JudgedFieldTypeChange[]
): ReviewedTypeChange[] {
  return typeChangeCountsOf(judged).map(counts => {
    const changes = judged.filter(
      change => changedFieldName(change) === counts.field
    );
    const leavesEmpty = changes.reduce(
      (rows, change) => rows + (change.leavesEmpty ?? 0),
      0
    );
    return {
      ...counts,
      ...(leavesEmpty === 0 ? {} : { leavesEmpty }),
      reasons: changes.flatMap(change => change.result.judgement.reasons),
    };
  });
}

/**
 * Refuse a save whose confirmed counts are not those just judged: each field whose numbers differ,
 * each one the save's change judges and the confirmation leaves out, and each one confirmed that
 * the change no longer makes. Asked before any statement, so nothing is changed and the review is
 * to be taken again (`reviewAgain`), with every judged field's new counts. Nothing is asked of a
 * save that confirms nothing.
 *
 * @throws {NextlyError} a validation error, each entry coded `TYPE_CHANGE_COUNTS_CHANGED`
 */
export function refuseChangedCounts(
  judged: readonly JudgedFieldTypeChange[],
  confirmed: readonly TypeChangeCounts[] | undefined
): void {
  if (confirmed === undefined) return;
  const now = typeChangeCountsOf(judged);
  const errors = [
    ...now.flatMap(counts => {
      const was = confirmed.find(each => each.field === counts.field);
      if (was === undefined) {
        return [countsIssue(counts.field, `${said(counts)} none confirmed`)];
      }
      return sameCounts(was, counts)
        ? []
        : [
            countsIssue(
              counts.field,
              `${said(counts)} not the ${numbersOf(was)} confirmed`
            ),
          ];
    }),
    ...confirmed
      .filter(
        was =>
          was.kept + was.changed + was.lost > 0 &&
          !now.some(counts => counts.field === was.field)
      )
      .map(was =>
        countsIssue(
          was.field,
          `${was.field} changes no value now, not the ${numbersOf(was)} confirmed`
        )
      ),
  ];
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    review: { reviewAgain: true, counts: { typeChanges: now } },
    logContext: { reason: "type-change-counts-changed", now, confirmed },
  });
}

/** Whether two counts of a field's kept, changed and lost values are the same. */
export function sameCounts(
  a: Omit<TypeChangeCounts, "field">,
  b: Omit<TypeChangeCounts, "field">
): boolean {
  return a.kept === b.kept && a.changed === b.changed && a.lost === b.lost;
}

/** A field's counts in words: `price now keeps 2, changes 1 and loses 1 of its values,`. */
function said(counts: TypeChangeCounts): string {
  return `${counts.field} now keeps ${String(counts.kept)}, changes ${String(counts.changed)} and loses ${String(counts.lost)} of its values,`;
}

/** A confirmation's counts in words, as they follow "not the". */
function numbersOf(counts: TypeChangeCounts): string {
  return `${String(counts.kept)}, ${String(counts.changed)} and ${String(counts.lost)}`;
}

function countsIssue(field: string, why: string) {
  return {
    path: `fields.${field}`,
    code: "TYPE_CHANGE_COUNTS_CHANGED",
    message: `${why}, so nothing was changed. Review the new counts and save again.`,
  };
}
