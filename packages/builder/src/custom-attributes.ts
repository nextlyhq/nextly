/**
 * What an author may put on a block's root element, and why a row will not land.
 *
 * The engine models two fields beside a node's props: `cssId`, which becomes the
 * element's `id`, and `attributes`, a bag of author-supplied HTML attributes.
 * `blocks-react` already decides which of those reach the DOM and already
 * applies them — this module is the EDITOR's half, and it owns exactly one
 * question: what to tell an author before they save.
 *
 * ## Every rule here is ASKED, never restated
 *
 * The render-safe set lives in the renderer and says so in its own docblock, so
 * `isAllowedAttribute` is imported rather than copied. A second copy would
 * drift, and it drifts in the worse direction: an editor accepting a name the
 * renderer skips lets an author set an attribute, watch it save, and never see
 * it on the page. Nothing here decides what is safe — it decides what to SAY.
 *
 * @module custom-attributes
 */
import { isAllowedAttribute } from "@nextlyhq/blocks-react";

/** One row of the attributes editor, as the author is typing it. */
export interface AttributeRow {
  readonly name: string;
  readonly value: string;
}

/** Why a row will not reach the page, or `undefined` when it will. */
export type RowProblem =
  | { readonly kind: "not-allowed" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "overridden-by-css-id" };

/**
 * HTML attribute names are ASCII case-insensitive; React props are not.
 *
 * The renderer lowercases before writing for exactly that reason — `ID` and
 * `id` would otherwise both survive and land as two id attributes on one
 * element. So two rows differing only in case are ONE attribute here too, and
 * the editor has to say so rather than let an author believe they set two.
 */
export function attributeKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether a row has been started at all. A blank row is not an error. */
export function isBlankRow(row: AttributeRow): boolean {
  return row.name.trim() === "";
}

/**
 * What is wrong with one row, judged against its siblings and the node's id.
 *
 * `cssId` is checked because the renderer resolves the collision in its favour
 * and says so: "the modelled field wins over an attribute of the same name".
 * That is not a defect to fix here — a dedicated field beating an escape hatch
 * is the right precedence — but it is invisible from the editor, so an author
 * typing `id` beside a filled CSS id is writing a value that will never be
 * used. Naming it is the whole point of the surface.
 */
export function rowProblem(
  rows: readonly AttributeRow[],
  index: number,
  cssId: string
): RowProblem | undefined {
  const row = rows[index];
  if (row === undefined || isBlankRow(row)) return undefined;
  const key = attributeKey(row.name);
  if (!isAllowedAttribute(key)) return { kind: "not-allowed" };
  /*
   * Located by INDEX, never by object identity. A row is a plain value the UI
   * rebuilds on every keystroke, so two rows holding the same name and value
   * are indistinguishable by `===`, and a caller passing an equal-but-separate
   * object had every row reported as a duplicate of itself. Position is what
   * actually decides this — the FIRST row holding a key is the one that lands,
   * matching the renderer's own iteration over the stored record — so position
   * is what the caller passes.
   */
  const first = rows.findIndex(
    other => !isBlankRow(other) && attributeKey(other.name) === key
  );
  if (first !== -1 && first !== index) return { kind: "duplicate" };
  if (key === "id" && cssId.trim() !== "") {
    return { kind: "overridden-by-css-id" };
  }
  return undefined;
}

/** What to tell the author about a row that will not land. */
export function problemMessage(problem: RowProblem): string {
  switch (problem.kind) {
    case "not-allowed":
      return "This site does not put that attribute on a page. Names starting with “data-” or “aria-” are open, along with role, title, lang and dir.";
    case "duplicate":
      return "Another row already sets this attribute, and only the first is used. Attribute names ignore capitals, so “Data-X” and “data-x” are one name.";
    case "overridden-by-css-id":
      return "The CSS id above sets this element’s id, and it wins over this row, so this value would not be used. Clear the CSS id, or set the id there instead.";
  }
}

/**
 * The rows an author edits, from what the node stores.
 *
 * Sorted by name so the list does not reorder itself as an author types — a
 * record's key order is its insertion order, and rewriting the record on every
 * keystroke would make rows jump.
 */
export function rowsOf(
  attributes: Readonly<Record<string, string>> | undefined
): AttributeRow[] {
  return Object.entries(attributes ?? {})
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * What to store for a set of rows, or `undefined` to store nothing at all.
 *
 * Blank rows are dropped rather than saved as empty keys, and a row that cannot
 * land is dropped too: storing a value the page will never use is the silent
 * half of the problem this surface exists to make loud. `undefined` rather than
 * `{}` for an empty result, so removing the last attribute leaves the node as
 * it was before any were added rather than carrying an empty bag forever.
 */
export function storedAttributes(
  rows: readonly AttributeRow[],
  cssId: string
): Record<string, string> | undefined {
  const kept: Record<string, string> = {};
  rows.forEach((row, index) => {
    /*
     * Blankness is asked SEPARATELY from correctness, because they are
     * different questions and `rowProblem` answers only the second. A row an
     * author has not started typing is not an error to show them — that is why
     * it has no problem — and it is not something to store either. Reading one
     * answer for both stored an attribute under the empty name.
     */
    if (isBlankRow(row)) return;
    if (rowProblem(rows, index, cssId) !== undefined) return;
    kept[attributeKey(row.name)] = row.value;
  });
  return Object.keys(kept).length === 0 ? undefined : kept;
}
