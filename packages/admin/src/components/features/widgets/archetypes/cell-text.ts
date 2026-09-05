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
 * timezone, `GeneralSettingsSyncProvider` publishes it to that formatter at the
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
  type: string | undefined
): string | undefined {
  const text = asText(value);
  if (text === undefined) return undefined;
  if (type !== "date") return text;

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
