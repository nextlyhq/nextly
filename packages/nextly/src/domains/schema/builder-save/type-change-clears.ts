/**
 * The values a field type change would clear, as the person confirmed them in the save's review,
 * and the save's check that the count still holds. A change that loses values goes ahead only
 * where the save names the field and the count of values it clears (`confirmedClears`), and only
 * while the values that cannot convert are still that many: one written after the review would be
 * cleared without being shown, so the save is refused, naming the new count, and changes nothing.
 * It mirrors the count a removed field's deletion is confirmed with (`deletion-counts`).
 *
 * @module domains/schema/builder-save/type-change-clears
 */
import { NextlyError } from "../../../errors/nextly-error";
import {
  changedFieldName,
  type JudgedFieldTypeChange,
} from "../value-conversion/type-change/field-type-changes";

/** How many values of a field changing type the person confirmed clearing, by the field's name. */
export interface ConfirmedClear {
  field: string;
  count: number;
}

/**
 * The fields whose lost values the person confirmed clearing: the consent the type-change
 * judgement takes (`typeChangeRefusals`' `acknowledged`), by field name.
 */
export function clearedFieldsOf(
  confirmed: readonly ConfirmedClear[] | undefined
): ReadonlySet<string> {
  return new Set((confirmed ?? []).map(clear => clear.field));
}

/**
 * Refuse a save where a confirmed clear's count is no longer the number of values its field's
 * change would clear (`cleared`, as just judged): every such field is named with its new count,
 * so the review can show it and the person confirm it.
 *
 * @throws {NextlyError} a validation error, each entry coded `TYPE_CHANGE_CLEAR_COUNT_CHANGED`
 */
export function refuseChangedClearCounts(
  judged: readonly JudgedFieldTypeChange[],
  confirmed: readonly ConfirmedClear[] | undefined
): void {
  if (confirmed === undefined || confirmed.length === 0) return;
  const clearing = new Map<string, number>();
  for (const change of judged) {
    // Named as its refusal and its consent name it: by its path where it is held inside JSON.
    const name = changedFieldName(change);
    clearing.set(
      name,
      (clearing.get(name) ?? 0) + change.result.cleared.length
    );
  }
  const changed = confirmed.flatMap(clear => {
    const now = clearing.get(clear.field) ?? 0;
    return now === clear.count
      ? []
      : [{ field: clear.field, now, confirmed: clear.count }];
  });
  if (changed.length === 0) return;
  throw NextlyError.validation({
    errors: changed.map(({ field, now, confirmed: count }) => ({
      path: `fields.${field}`,
      code: "TYPE_CHANGE_CLEAR_COUNT_CHANGED",
      message: `${field} now holds ${String(now)} value(s) that cannot convert, not the ${String(count)} confirmed, so nothing was changed. Review the new count and save again.`,
    })),
    logContext: {
      reason: "type-change-clear-count-changed",
      fields: changed,
    },
  });
}
