/**
 * What the settings sheet needs to know about a card's content settings
 * (Collection, Filter, Sort, Group by, Fields, Field) beyond drawing them:
 * which settings follow a collection, and which stored values name a field
 * the reader may no longer be offered.
 *
 * Pure, and read from what the server sent: `widgetSources` lists only the
 * fields no read rule can refuse, so a field missing from it is one this
 * reader may not filter, sort or group by now, whatever the stored value says.
 */
import {
  contentFieldFits,
  staleValueTakesDefault,
  startsAtDefault,
  type AnyWidgetSetting,
  type ContentSetting,
  type PublishedContentSource,
  unfitContentField,
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
    setting.type === "groupBy" ||
    setting.type === "fields" ||
    setting.type === "field"
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

/**
 * The fields a dependent setting's value names: a filter's, sort's,
 * grouping's or Field setting's one, or each of a Fields setting's, and none
 * when unset.
 */
export function fieldsNamedBy(
  setting: DependentSetting,
  value: unknown
): string[] {
  if (setting.type === "filter") {
    const field = whereToCondition(value, () => undefined)?.field;
    return field === undefined ? [] : [field];
  }
  if (setting.type === "fields") {
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === "string")
      : [];
  }
  if (typeof value !== "string" || value === "") return [];
  return [setting.type === "sort" ? value.replace(/^-/, "") : value];
}

/** A dependent setting's value when it names nothing: no fields, or no field. */
function noneFor(setting: DependentSetting): unknown {
  return setting.type === "fields" ? [] : "";
}

/**
 * Whether two setting values are the same choice. A filter's value is an
 * object, so the same condition read from storage, or written again by the
 * row, is a different object holding the same thing: compared by reference,
 * a reader setting a filter back to its default would store the default and
 * stop following a later change to it.
 */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isRecord(a) || !isRecord(b)) return false;
  return canonical(a) === canonical(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** JSON with every object's keys in order, so key order never decides. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner) && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map(key => [key, inner[key]])
        )
      : inner
  );
}

type SourceField = PublishedContentSource["fields"][number];

/**
 * Whether a source field may be what this dependent setting names: the rule
 * the server also judges a stored value by (`contentFieldFits`).
 */
export function fieldFits(
  setting: DependentSetting,
  field: SourceField,
  titleField?: string
): boolean {
  return contentFieldFits(setting.type, field, titleField);
}

/** The first field a dependent setting's value names that it may not use here. */
function unfitField(
  setting: DependentSetting,
  value: unknown,
  source: PublishedContentSource
): string | undefined {
  return unfitContentField(setting.type, fieldsNamedBy(setting, value), source);
}

/**
 * The first field a dependent setting's value names that the collection the
 * form holds for it does not offer it, with that collection's source; or
 * `undefined` where every field fits, and where the collection has no source
 * to judge by.
 */
function unavailableField(
  setting: DependentSetting,
  values: Readonly<Record<string, unknown>>,
  sources: readonly PublishedContentSource[]
): { field: string; source: PublishedContentSource } | undefined {
  const source = sources.find(
    candidate => candidate.collection === values[setting.of]
  );
  if (source === undefined) return undefined;
  const field = unfitField(setting, values[setting.name], source);
  return field === undefined ? undefined : { field, source };
}

/**
 * Why a Field setting's value cannot be saved, or `undefined`: it names a
 * field the collection the form holds now does not offer this reader. The
 * field-fit rule is core's (`unfitContentField`), the one the layout write
 * refuses such a value by, and the words are the ones it refuses it with, so
 * a value it would refuse is named under its own control instead.
 *
 * Judged where the sheet judges a stale value (`staleContentValues`): nothing
 * while the sources have not arrived, or over a collection with no source.
 */
export function unavailableFieldProblem(
  setting: AnyWidgetSetting,
  values: Readonly<Record<string, unknown>>,
  sources: readonly PublishedContentSource[] | undefined
): string | undefined {
  if (setting.type !== "field" || sources === undefined) return undefined;
  if (unavailableField(setting, values, sources) === undefined) {
    return undefined;
  }
  return `"${setting.label ?? setting.name}" names a field that is not available.`;
}

/**
 * What a dependent setting starts at over `collection`: its default when the
 * default names a field it may use there, and none otherwise. A collection
 * whose fields were not sent leaves the default alone, as there is nothing to
 * judge it by. The rule is core's (`startsAtDefault`), which the server reads
 * too.
 */
export function startingValue(
  setting: DependentSetting,
  collection: unknown,
  sources: readonly PublishedContentSource[] | undefined
): unknown {
  const fallback = setting.defaultValue ?? noneFor(setting);
  const source = sources?.find(
    candidate => candidate.collection === collection
  );
  return startsAtDefault(setting.type, fieldsNamedBy(setting, fallback), source)
    ? fallback
    : noneFor(setting);
}

/** A value the sheet replaces, what it replaces it with, and why. */
export interface StaleContentValue {
  name: string;
  /** The line the sheet shows, e.g. "Group by was reset: State is no longer available". */
  notice: string;
  /** What the form holds instead: the default, or none when that will not do either. */
  replacement: unknown;
}

/**
 * The dependent settings whose value names a field this reader may not use
 * over the chosen collection: one no longer offered, or for Group by one the
 * read will not group by. A default is judged like any other value, so a
 * default naming a field the collection lacks is not drawn as if it applied.
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
    const found =
      setting.type === "collection"
        ? staleCollection(setting, values[setting.name], sources)
        : isDependentSetting(setting)
          ? staleDependent(setting, values, sources)
          : undefined;
    if (found !== undefined) stale.push(found);
  }
  return stale;
}

/** A dependent setting whose value names a field it may not use here. */
function staleDependent(
  setting: DependentSetting,
  values: Readonly<Record<string, unknown>>,
  sources: readonly PublishedContentSource[]
): StaleContentValue | undefined {
  const unavailable = unavailableField(setting, values, sources);
  if (unavailable === undefined) return undefined;
  const { field, source } = unavailable;
  const value = values[setting.name];
  const label = setting.label ?? setting.name;
  const isDefault = sameSettingValue(value, setting.defaultValue);
  // Replaced by the rule the server applies before a card's `load` is handed
  // the value (`staleValueTakesDefault`), so the card loads with what the
  // sheet shows.
  const takesDefault = staleValueTakesDefault(
    setting.type,
    {
      isDefault,
      defaultNames: fieldsNamedBy(
        setting,
        setting.defaultValue ?? noneFor(setting)
      ),
    },
    source
  );
  return {
    name: setting.name,
    notice: isDefault
      ? `${label}'s default, ${field}, is not available for ${source.label}`
      : `${label} was reset: ${field} is no longer available`,
    replacement: takesDefault
      ? (setting.defaultValue ?? noneFor(setting))
      : noneFor(setting),
  };
}

/**
 * A Collection setting naming a collection this reader is no longer offered:
 * one removed, or one they lost access to. Its select has no option for it,
 * and saving it back would leave the card on a query the server refuses. It
 * goes back to its default where the reader is offered that, and to none
 * otherwise; the settings over it then have no collection to name fields of.
 *
 * Its own default is left alone: a default that names no collection (All
 * collections) is the widget's to mean, not a collection to look up.
 */
function staleCollection(
  setting: Extract<ContentSetting, { type: "collection" }>,
  value: unknown,
  sources: readonly PublishedContentSource[]
): StaleContentValue | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (sameSettingValue(value, setting.defaultValue)) return undefined;
  const offered = (slug: unknown) =>
    sources.some(source => source.collection === slug);
  if (offered(value)) return undefined;
  const label = setting.label ?? setting.name;
  return {
    name: setting.name,
    notice: `${label} was reset: ${value} is no longer available`,
    replacement:
      setting.defaultValue !== undefined && offered(setting.defaultValue)
        ? setting.defaultValue
        : "",
  };
}

/**
 * A Collection setting's choices: the collections the server sent, and its
 * own default when that names none of them. A widget may declare a default
 * that is not a collection (one meaning every collection, say); it is what
 * the card uses until the reader chooses, so it is offered by name rather
 * than left as a value the select cannot show or return to. A card's quick
 * popover offers the same choices.
 */
export function collectionOptions(
  setting: Extract<ContentSetting, { type: "collection" }>,
  sources: readonly PublishedContentSource[]
): { label: string; value: string }[] {
  const options = sources.map(source => ({
    label: source.label,
    value: source.collection,
  }));
  const fallback = setting.defaultValue;
  if (
    fallback === undefined ||
    fallback === "" ||
    options.some(option => option.value === fallback)
  ) {
    return options;
  }
  return [{ label: "Default", value: fallback }, ...options];
}
