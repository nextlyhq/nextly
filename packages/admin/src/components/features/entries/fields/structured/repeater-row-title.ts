/**
 * What a repeater row is called in words: the one reading for the row's own
 * header in the entry form and for every other surface that names the row,
 * such as the Page Builder opened on a field inside it.
 *
 * A custom `RowLabel` component, which the row header draws first, is React
 * rather than words, so a surface that needs text skips it and reads from
 * here; the header falls back to this same answer when there is none.
 *
 * @module components/entries/fields/structured/repeater-row-title
 */

/**
 * Field names read for a row's title when the repeater names none, in order
 * of priority.
 */
const TITLE_FIELD_NAMES = [
  "title",
  "name",
  "label",
  "heading",
  "subject",
] as const;

/** The parts of a repeater declaration a row's title reads. */
interface TitledRepeater {
  rowLabelField?: unknown;
  labels?: { singular?: unknown } | undefined;
  fields?: readonly unknown[] | undefined;
}

/** A value as a title, when it is one: non-empty text or a number. */
function asTitle(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The name of a sub-field marked `admin.useAsTitle`, if the rows have one. */
function markedTitleField(
  fields: readonly unknown[] | undefined
): string | undefined {
  for (const field of fields ?? []) {
    if (typeof field !== "object" || field === null) continue;
    const { name, admin } = field as { name?: unknown; admin?: unknown };
    const marked =
      typeof admin === "object" &&
      admin !== null &&
      (admin as { useAsTitle?: unknown }).useAsTitle === true;
    if (marked && typeof name === "string" && name !== "") return name;
  }
  return undefined;
}

/**
 * The row's title, in the order the row header resolves it:
 *
 * 1. the sub-field the repeater names as `rowLabelField`;
 * 2. a conventional title-like field (title, name, label, heading, subject);
 * 3. a sub-field marked `admin.useAsTitle`;
 * 4. `"{labels.singular} {position}"`, used only when the row holds none of
 *    the above. It is the one part that changes when the rows are reordered,
 *    so `fromContent` says which kind of title this is.
 */
export function repeaterRowTitle(
  repeater: object,
  row: Record<string, unknown>,
  index: number
): { title: string; fromContent: boolean } {
  const declared = repeater as TitledRepeater;
  const explicit =
    typeof declared.rowLabelField === "string" && declared.rowLabelField !== ""
      ? asTitle(row[declared.rowLabelField])
      : undefined;
  if (explicit !== undefined) return { title: explicit, fromContent: true };
  for (const name of TITLE_FIELD_NAMES) {
    const conventional = asTitle(row[name]);
    if (conventional !== undefined) {
      return { title: conventional, fromContent: true };
    }
  }
  const marked = markedTitleField(declared.fields);
  const fromMarked = marked === undefined ? undefined : asTitle(row[marked]);
  if (fromMarked !== undefined) return { title: fromMarked, fromContent: true };
  const singular =
    typeof declared.labels?.singular === "string" &&
    declared.labels.singular !== ""
      ? declared.labels.singular
      : "Item";
  return { title: `${singular} ${index + 1}`, fromContent: false };
}
