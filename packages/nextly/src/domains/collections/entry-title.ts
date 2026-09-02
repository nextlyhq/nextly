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
 * The value of a title field, when it is one a reader would recognise as a name.
 *
 * 🔴 The VALUE half of the same question {@link entryTitleField} answers about
 * FIELDS, and it lives here for the same reason: every surface that names an
 * entry has to agree, and three separate spellings of this rule disagreed in
 * three different ways -- one accepted a whitespace-only string, one refused a
 * number, and only one trimmed. A collection whose title field holds an invoice
 * number was named by it in the editor and by its id in the version-comparison
 * heading, and a row whose `label` held two spaces was headed with those two
 * spaces in one place and with its `subject` in another.
 *
 * TRIMMED, and the trimmed value is what comes back: a heading of whitespace is
 * indistinguishable from a row that failed to load, and returning the untrimmed
 * original would leave each caller to decide again.
 *
 * Numbers and bigints count. An author who nominates an invoice or issue number
 * as the title means it, the entry table already shows that column, and the
 * bigint case is real -- an id beyond `Number.MAX_SAFE_INTEGER` arrives from the
 * driver as one. Objects and arrays are refused: they stringify to something no
 * reader recognises as a name.
 */
export function readableTitleText(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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
