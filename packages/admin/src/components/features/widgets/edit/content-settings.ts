/**
 * What the settings sheet needs to know about a card's content settings
 * (Collection, Filter, Sort, Group by) beyond drawing them: which settings
 * follow a collection, and which stored values name a field the reader may no
 * longer be offered.
 *
 * Pure, and read from what the server sent: `widgetSources` lists only the
 * fields no read rule can refuse, so a field missing from it is one this
 * reader may not filter, sort or group by now, whatever the stored value says.
 */
import type {
  AnyWidgetSetting,
  ContentSetting,
  PublishedContentSource,
} from "nextly/config";

import { whereToCondition } from "./content-filter";

/** A content setting that works over a Collection setting of the widget. */
export type DependentSetting = Extract<ContentSetting, { of: string }>;

export function isContentSetting(
  setting: AnyWidgetSetting
): setting is ContentSetting {
  return (
    setting.type === "collection" ||
    setting.type === "filter" ||
    setting.type === "sort" ||
    setting.type === "groupBy"
  );
}

export function isDependentSetting(
  setting: AnyWidgetSetting
): setting is DependentSetting {
  return isContentSetting(setting) && setting.type !== "collection";
}

/** The settings that work over the Collection setting `name`. */
export function dependentsOf(
  settings: readonly AnyWidgetSetting[],
  name: string
): DependentSetting[] {
  return settings.filter(
    (setting): setting is DependentSetting =>
      isDependentSetting(setting) && setting.of === name
  );
}

/** The one field a dependent setting's value names, or none when unset. */
export function fieldNamedBy(
  setting: DependentSetting,
  value: unknown
): string | undefined {
  if (setting.type === "filter") {
    return whereToCondition(value, () => undefined)?.field;
  }
  if (typeof value !== "string" || value === "") return undefined;
  return setting.type === "sort" ? value.replace(/^-/, "") : value;
}

/** A stored value the sheet replaces with its default, and why. */
export interface StaleContentValue {
  name: string;
  /** The line the sheet shows, e.g. "Group by was reset: State is no longer available". */
  notice: string;
}

/**
 * The dependent settings whose stored value names a field this reader may no
 * longer be offered.
 *
 * Nothing while the sources have not arrived: an unknown answer is not a
 * reason to throw a person's choice away. A collection the reader is offered
 * nothing for leaves its dependents alone too, since there is no field list to
 * judge them by; the card's own query is refused by the server in that case.
 */
export function staleContentValues(
  settings: readonly AnyWidgetSetting[],
  values: Readonly<Record<string, unknown>>,
  sources: readonly PublishedContentSource[] | undefined
): StaleContentValue[] {
  if (sources === undefined) return [];
  const stale: StaleContentValue[] = [];
  for (const setting of settings) {
    if (!isDependentSetting(setting)) continue;
    const value = values[setting.name];
    if (value === setting.defaultValue) continue;
    const field = fieldNamedBy(setting, value);
    if (field === undefined) continue;
    const source = sources.find(
      candidate => candidate.collection === values[setting.of]
    );
    if (source === undefined) continue;
    if (source.fields.some(offered => offered.name === field)) continue;
    stale.push({
      name: setting.name,
      notice: `${setting.label ?? setting.name} was reset: ${field} is no longer available`,
    });
  }
  return stale;
}
