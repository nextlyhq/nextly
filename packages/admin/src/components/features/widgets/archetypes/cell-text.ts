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

import { formatGlobalDateTime } from "@admin/lib/dates/format";
import type { WidgetResultField } from "@admin/types/dashboard/widgets";

/** What a cell needs to know about its column to present a value: its kind and its value labels. */
export type CellColumn = Pick<WidgetResultField, "type" | "choices">;

/**
 * What a person calls a stored choice value, or `undefined` when the column names none.
 *
 * One lookup for every place a stored value is shown -- a row, a table cell, a chart group -- so a
 * status reads "Published" in all of them or in none. A value the column does not list (an option
 * removed since the row was written) falls back to the stored value, which is still the truth.
 */
export function choiceLabel(
  value: string,
  choices: CellColumn["choices"]
): string | undefined {
  return choices?.find(choice => choice.value === value)?.label;
}

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

/**
 * One cell as text, PRESENTED according to the kind the source declared it.
 *
 * 🔴 The layer `asText` deliberately is not. `asText` answers "can this value be
 * printed at all", which is a question about the value; this answers "how should
 * a reader see it", which is a question about the value AND its declared type.
 * Keeping them apart is what lets a source with no declaration still render.
 *
 * A `date` is the case that forced this. Every source declares its date fields
 * as such, the value crosses the wire as an ISO 8601 string, and printing it
 * verbatim put `2026-09-01T07:00:00.000Z` in front of a reader on a card whose
 * whole subject is when something happens. Selecting a different field is not a
 * remedy — it just moves which column is unreadable.
 *
 * 🔴 Formatted through `formatGlobalDateTime`, the same path every other admin
 * date goes through, NOT a bare `toLocaleString`. General Settings carries a
 * timezone, `GeneralSettingsSync` publishes it to that formatter at the
 * root of the admin, and a cell reading the browser's own zone instead would
 * make these cards disagree with every date beside them whenever an
 * administrator has configured one. The formatter falls back to the local zone
 * when nothing is configured, so the browser zone remains the default rather
 * than the rule.
 *
 * It is imported from `lib/dates/format` rather than through
 * `useAdminDateFormatter`: this module is a plain function called from a render
 * body, not a hook, and the underlying formatter reads a module-level config
 * that the provider has already set.
 *
 * What it still cannot show is the zone a value was AUTHORED against -- a
 * release scheduled for 09:00 Berlin is stored with that zone, and the widget
 * query contract carries a value and its declared type rather than a value and
 * its zone. This renders in the ADMIN's zone, which is the right answer for a
 * dashboard summary and the wrong one for a scheduling screen, where
 * `formatScheduledAt` already serves the authored zone from the full release.
 *
 * An UNPARSEABLE date falls back to the raw text rather than dropping the cell.
 * The value is still evidence — a reader can see something is wrong with it —
 * and an em dash would report a working row as missing data.
 */
export function asPresentedText(
  value: unknown,
  column: CellColumn | undefined
): string | undefined {
  // A choice column shows the value's label, never the stored value ("Published", not
  // `published`); the stored value is kept when the column names no label for it. Asked
  // before the value is judged printable, so an option that stores "" under a label ("None")
  // reads as that label, as it does on a bar, rather than as an empty cell.
  const named =
    typeof value === "string" && column?.choices
      ? choiceLabel(value, column.choices)
      : undefined;
  if (named !== undefined) return named;
  const text = asText(value);
  if (text === undefined) return undefined;
  if (column?.type !== "date") return text;

  // The raw text is the FALLBACK, so an unparseable value still reaches the
  // reader as evidence rather than as an em dash claiming the row has nothing.
  return formatGlobalDateTime(
    text,
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    text
  );
}

/**
 * The fields a declared widget's answer is drawn by, for a card core answered
 * on the server, which has no query to select them: the answer's own `fields`
 * when it describes them, else the first row's own keys, in their order.
 *
 * 🔴 The first row's keys only: a key a later row carries and the first does
 * not is not drawn. The rows are what the widget's own data function answered,
 * through reads already bound to this reader, so its first row is its own
 * description of them, not a guess at fields the reader may not see.
 */
export function declaredAnswerFields(result: {
  items: readonly Record<string, unknown>[];
  fields?: readonly WidgetResultField[];
}): WidgetResultField[] {
  if (result.fields !== undefined && result.fields.length > 0) {
    return [...result.fields];
  }
  return Object.keys(result.items[0] ?? {}).map(name => ({ name }));
}
