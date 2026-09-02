/**
 * What an entry is called.
 *
 * Three surfaces ask this — the entry list picks a primary COLUMN, the editor
 * heading and the version comparison heading each need TEXT — and they were
 * answering it with two different preference lists. A collection with fields
 * `[description, subject]` and no `useAsTitle` was named "description" by one
 * and "subject" by the other, so a document could be called one thing by its
 * editor and another by the page comparing its versions.
 *
 * The preference ORDER lives here, once. The last resort deliberately does not:
 * a column has to name a field that exists, a heading has to produce text, and
 * those are different needs that each caller states where it can be read.
 *
 * @module components/features/entries/entry-title
 */

/**
 * Which field NAMES an entry, and the conventional names used when nothing is
 * nominated.
 *
 * Re-exported from core rather than defined here. The server resolves the same
 * question -- the activity feed labels a row with it, and the dashboard's
 * generated list widgets pick a row label with it before the query is made --
 * so the rule lives beside the collection domain and both sides ask it. Kept
 * exported from this module because this is where the admin's entry-title
 * questions are answered from.
 */
import {
  COMMON_TITLE_FIELDS,
  entryTitleField,
  readableTitleText,
} from "nextly/config";

export { COMMON_TITLE_FIELDS, entryTitleField };

/**
 * A value counts as a title if it is a scalar with something in it.
 *
 * Asked of core rather than answered here. This rule had three spellings and
 * they disagreed: one accepted a whitespace-only string, one refused a number,
 * and one refused a bigint -- so a collection whose title field held an invoice
 * number was named by it in the editor and by its id in the version-comparison
 * heading. Which FIELD names an entry and whether that field's VALUE can name
 * one are halves of the same question, and they now live together.
 */
const readableText = readableTitleText;

/**
 * What to call this entry, or `undefined` when it says nothing about itself.
 *
 * The nominated field is tried first and then the conventional ones IN ORDER,
 * rather than stopping at the nominated field: an entry whose title field is
 * still empty has a better name available if another conventional field is
 * filled, and showing the fallback there would be worse than showing it.
 */
export function entryTitleValue(
  entry: Record<string, unknown> | undefined,
  useAsTitle?: string
): string | undefined {
  if (!entry) return undefined;
  const nominated =
    useAsTitle && useAsTitle !== "id"
      ? readableText(entry[useAsTitle])
      : undefined;
  if (nominated !== undefined) return nominated;
  // No field-name list is consulted: a value lookup that also had to be told
  // which fields exist could be handed a list that disagrees with the entry,
  // and reading the entry answers the question directly.
  for (const name of COMMON_TITLE_FIELDS) {
    const value = readableText(entry[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}
