/**
 * How a Count card's settings follow one another in its settings drawer, read from what the
 * drawer holds now: its Source, its Count (every entry, the published ones or the drafts) and
 * what it shows under the number.
 *
 * - Set to Users, it counts people: there is no Count to choose and no Filter to set.
 * - Set to a collection with no draft and published lifecycle, it counts every entry: there is
 *   no Count to choose.
 * - A status split splits every entry of a collection with a lifecycle, so it is offered only
 *   with Count: All entries; elsewhere the change this week takes its place, as the card's
 *   `load` draws it.
 *
 * @module components/features/dashboard/count-settings
 */

import type { PublishedContentSource } from "nextly/config";

import type { SettingRule } from "../widgets/edit/setting-rules";
import { USERS_SOURCE } from "../widgets/widget-as-asked";

/** Why a status split cannot be chosen, said under "Under the number". */
export const SPLIT_NEEDS_ALL =
  "Status split shows every status, so it needs Count: All entries (and a collection).";

/** A Count card's rule for one setting, by its name, as the drawer holds the others now. */
export function countSettingRule(
  name: string,
  values: Readonly<Record<string, unknown>>,
  sources: readonly PublishedContentSource[]
): SettingRule | undefined {
  const source = values.collection;
  const people = source === USERS_SOURCE;
  const lifecycle =
    sources.find(each => each.collection === source)?.lifecycle === true;
  if (name === "count")
    return people || !lifecycle ? { hidden: true } : undefined;
  if (name === "filter") return people ? { hidden: true } : undefined;
  if (name !== "show") return undefined;
  const counted =
    values.count === undefined || values.count === "" ? "all" : values.count;
  const splittable = !people && lifecycle && counted === "all";
  return splittable
    ? undefined
    : { disabled: ["split"], fallback: "change", hint: SPLIT_NEEDS_ALL };
}
