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
 * Field names that conventionally hold a title, in preference order.
 *
 * `subject` and `heading` are here because a mail-like or article-like
 * collection names its entries with them, and a reader scanning a list of
 * either sees nothing useful without them.
 */
export const COMMON_TITLE_FIELDS = [
  "title",
  "name",
  "label",
  "subject",
  "heading",
] as const;

/**
 * The field that names an entry, from the author's choice then convention.
 *
 * `undefined` where neither applies, so a caller can tell "no conventional
 * title field" from "the title field is empty" and answer each in its own way.
 */
export function entryTitleField(
  useAsTitle: string | undefined,
  fieldNames: readonly string[]
): string | undefined {
  // `id` is not a title even when nominated: it is what the fallbacks already
  // show, and treating it as one would hide a real title field behind it.
  if (useAsTitle && useAsTitle !== "id" && fieldNames.includes(useAsTitle)) {
    return useAsTitle;
  }
  return COMMON_TITLE_FIELDS.find(name => fieldNames.includes(name));
}

/** A value counts as a title only if it is text with something in it. */
function readableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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
