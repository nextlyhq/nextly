/**
 * What a save brings up to date in a table an earlier Nextly version made, as the schema dialog
 * lists it, and the keys the apply confirms it by.
 *
 * The first save of such a table adopts it as it stands and converts each difference from what
 * Nextly now declares, writing a conversion only once the apply confirms it. The preview names
 * each one: its key, and what it does in plain words (`change`), which is shown as it is. The
 * dialog lists them under "Brought up to date", and its Save confirms every one listed.
 *
 * @module lib/builder/brought-up-to-date
 */
import type {
  SchemaPreviewConversion,
  SchemaPreviewResponse,
} from "@admin/services/schemaApi";

/** The keys an apply confirms the reviewed preview's conversions by: every one it listed. */
export function acknowledgedConversionsOf(
  preview: SchemaPreviewResponse
): string[] {
  return (preview.conversions ?? []).map(conversion => conversion.column);
}

/**
 * One line per conversion that deletes stored values, for the review's data-loss warning: what it
 * removes, in the server's words, and that the values stored in it go with it.
 */
export function lossLinesOf(
  conversions: readonly SchemaPreviewConversion[]
): string[] {
  return conversions
    .filter(conversion => conversion.deletesValues)
    .map(
      ({ table, change }) =>
        `Bringing ${table} up to date ${change} and the values stored in it.`
    );
}

/**
 * One line per table the save brings up to date: that an earlier version made it, then each
 * change the save makes to it, in the order the preview gives them.
 */
export function broughtUpToDateLines(
  conversions: readonly SchemaPreviewConversion[]
): string[] {
  const byTable = new Map<string, string[]>();
  for (const { table, change } of conversions) {
    byTable.set(table, [...(byTable.get(table) ?? []), change]);
  }
  return [...byTable].map(
    ([table, changes]) =>
      `${table} was made by an earlier Nextly version. Saving brings it up to date: ${changes.join("; ")}.`
  );
}
