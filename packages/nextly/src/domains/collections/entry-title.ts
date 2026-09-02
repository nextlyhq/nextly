/**
 * Which field NAMES an entry, asked once for the whole product.
 *
 * A collection's author may nominate one through `admin.useAsTitle`; most do
 * not, and the conventional names below are what a reader recognises when they
 * have not. Both halves of that answer live here because three places need it
 * and they must agree: the entry list draws a column with it, the activity feed
 * labels a row with it, and a generated dashboard list picks its row label with
 * it. A reader who sees "Hello world" in one place and `a3f9-...` in another is
 * looking at two implementations of one question.
 *
 * In CORE rather than in the admin, where it was first written, because the
 * server needs the same answer: `record-activity` already resolves an entry's
 * heading server-side, and the dashboard's generated widgets have to know which
 * field to select before the query is made.
 *
 * @module domains/collections/entry-title
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
 * The field that names an entry, or `undefined` when nothing does.
 *
 * `undefined` is a real answer rather than a failure: a collection of pure data
 * rows has no title field, and a caller that invents one shows the reader a
 * column of identifiers. Callers are expected to handle it — the entry list
 * falls back to the id, and a generated list widget declines to exist.
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
