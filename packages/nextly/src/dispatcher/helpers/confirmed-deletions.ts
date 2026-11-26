/**
 * The counts of values a Schema Builder review confirmed deleting, as an apply's body sends them, for
 * every kind of entity the Builder saves: a collection's, a Single's and a field group's.
 *
 * @module dispatcher/helpers/confirmed-deletions
 */
import { z } from "zod";

import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import type { ConfirmedDeletion } from "../../domains/schema/builder-save/deletion-counts";
import type { LegacyResolutionsBundle } from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";

/**
 * The counts of removed fields' values the person confirmed in the review, as an apply's body
 * sends them: each field's name and a whole number of values. Absent where the body sends none,
 * and the save then deletes as it always has (`CollectionSave.confirmedDeletions`).
 */
const ConfirmedDeletionsBody = z.object({
  confirmedDeletions: z
    .array(
      z.object({
        field: z.string().min(1),
        count: z.number().int().min(0),
      })
    )
    .max(500)
    .optional(),
});

/** The counts an apply's body sends, or nothing; a malformed one is refused. */
export type ConfirmedDeletions = z.infer<
  typeof ConfirmedDeletionsBody
>["confirmedDeletions"];

/** The counts `body` sends, refused where they are malformed. */
export function readConfirmedDeletions(body: unknown): ConfirmedDeletions {
  try {
    return ConfirmedDeletionsBody.parse(body ?? {}).confirmedDeletions;
  } catch (error) {
    if (error instanceof z.ZodError) throw nextlyValidationFromZod(error);
    throw error;
  }
}

/** The save's answer of the counts confirmed, where the body sent them; nothing otherwise. */
export function confirmedDeletionsAnswer(
  confirmedDeletions: ConfirmedDeletions
): { confirmedDeletions?: readonly ConfirmedDeletion[] } {
  return confirmedDeletions === undefined ? {} : { confirmedDeletions };
}

/**
 * The dialog's answers by field name, with each removed field whose count of values the person
 * confirmed deleting answered as its drop confirmed, unless the field answers itself. Nothing
 * where neither is sent.
 */
export function withCountedDrops(
  tableName: string,
  answers: LegacyResolutionsBundle | undefined,
  confirmedDeletions: ConfirmedDeletions
): LegacyResolutionsBundle | undefined {
  const counted: LegacyResolutionsBundle["byFieldName"] = {};
  for (const deletion of confirmedDeletions ?? []) {
    counted[deletion.field] = { action: "confirm_drop" };
  }
  if (answers === undefined && Object.keys(counted).length === 0) {
    return undefined;
  }
  return { tableName, byFieldName: { ...counted, ...answers?.byFieldName } };
}

/** The dialog's answers as the change sent them by field, each counted drop among them. */
export function dialogConfirmations(
  tableName: string,
  resolutions: Record<string, FieldResolution> | undefined,
  confirmedDeletions: ConfirmedDeletions
): { legacy?: LegacyResolutionsBundle } {
  const legacy = withCountedDrops(
    tableName,
    resolutions === undefined
      ? undefined
      : { tableName, byFieldName: resolutions },
    confirmedDeletions
  );
  return legacy === undefined ? {} : { legacy };
}
