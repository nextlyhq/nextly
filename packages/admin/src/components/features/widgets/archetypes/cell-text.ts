/**
 * Turning one value from a widget row into text a card can print.
 *
 * Shared by every archetype that draws rows, because "what does this cell say"
 * is one question and two answers would drift the first time either was
 * corrected. `list` learned this reading first; `table` needs exactly the same
 * one.
 *
 * @module components/features/widgets/archetypes/cell-text
 */

/**
 * One cell as text, or `undefined` when it is not something to print.
 *
 * Objects and arrays are DROPPED rather than stringified. `String({})` is
 * "[object Object]", which is not a defect a reader can act on — it looks like
 * data. A relationship, a repeater or a rich-text value all arrive here as
 * objects, and no row-drawing archetype can render any of them; saying nothing
 * is better than saying that. The same reading `RecentEntriesWidget` had to be
 * taught when its titles came back as objects.
 *
 * `null` and `undefined` are absent values, not text. `0` and `false` ARE text:
 * a count of zero is a real answer and dropping it would make the row lie.
 */
export function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/**
 * The refusal an archetype gives when its query selects nothing.
 *
 * Both row-drawing archetypes need this and each names its own unit — a list
 * has rows, a table has columns — so the sentence is built rather than copied.
 * Judged from the DECLARATION, before any request is made, which is what keeps
 * the grid from spending an unprojected read on a card that can never draw.
 */
export function selectsNothing(
  title: string | undefined,
  archetype: string,
  unit: string
): string {
  const name = title ?? `This ${archetype} widget`;
  return `"${name}" is a ${archetype} widget whose query selects no fields, so there is nothing to show in each ${unit}.`;
}
