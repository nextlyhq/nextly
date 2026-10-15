/**
 * A card's settings as its readers are handed them, and the query core runs
 * for a card whose widget writes its query from those settings.
 *
 * Both run on the server. A widget's query function is server code: it is
 * never sent to the browser, so the query is built here, from the card's
 * stored values, rather than by the admin.
 *
 * @module domains/widgets/declaration/card-query
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { WidgetQuery } from "../query";
import { resolveWidgetSettings, type WidgetSetting } from "../settings";

import type { ContentQuery } from "./define-widget";
import {
  DEPENDENT_SETTING_TYPES,
  fitsNewSetting,
  NEW_SETTING_TYPES,
} from "./setting-builders";

/** A setting as a declaration holds it, read without its compile-time types. */
interface DeclaredSetting {
  readonly type: string;
  readonly defaultValue?: unknown;
  readonly of?: string;
}

/** The part of a declaration this module reads. */
interface CardQueryDeclaration {
  readonly settings?: unknown;
  readonly data: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A declaration's settings, by name, once they have been checked at startup. */
function declaredSettings(settings: unknown): [string, DeclaredSetting][] {
  if (!isRecord(settings)) return [];
  return Object.entries(settings).filter(
    (entry): entry is [string, DeclaredSetting] =>
      isRecord(entry[1]) && typeof entry[1].type === "string"
  );
}

/**
 * The values a card's readers are handed: the person's own where they fit,
 * the starting value everywhere else.
 *
 * - A setting of a type core already defines is read by `resolveWidgetSettings`,
 *   the reader every stored card goes through, so a declared widget's values and
 *   a registered one's cannot be judged two ways.
 * - A control core has no definition type for yet is read by `fitsNewSetting`.
 * - A dependent setting whose Collection setting has no value is hidden by it:
 *   there is nothing to filter, sort or group, so its stored value is not handed
 *   on, and its starting value is.
 *
 * Only declared names are handed on, in a record with no prototype: the keys
 * are names an author chose, and `__proto__` must stay a name.
 */
export function resolveCardSettings(
  settings: unknown,
  stored: Record<string, unknown> | undefined
): Record<string, unknown> {
  const declared = declaredSettings(settings);
  const canonical: WidgetSetting[] = declared
    .filter(([, setting]) => !NEW_SETTING_TYPES.has(setting.type))
    // A cast, because a declaration's settings were checked at startup by the
    // same reader (`widgetSettingsProblem`) that a `WidgetSetting` passes.
    .map(([name, setting]) => ({ ...setting, name }) as WidgetSetting);
  const resolved: Record<string, unknown> = Object.assign(
    Object.create(null),
    resolveWidgetSettings(canonical, stored)
  );

  // The Collection settings first, since the dependent ones read them.
  const ordered = [...declared].sort(
    ([, a], [, b]) =>
      Number(DEPENDENT_SETTING_TYPES.has(a.type)) -
      Number(DEPENDENT_SETTING_TYPES.has(b.type))
  );
  for (const [name, setting] of ordered) {
    if (!NEW_SETTING_TYPES.has(setting.type)) continue;
    const value = stored?.[name];
    const hidden =
      setting.of !== undefined && resolved[setting.of] === undefined;
    if (!hidden && value !== undefined && fitsNewSetting(setting.type, value)) {
      resolved[name] = value;
    } else if (setting.defaultValue !== undefined) {
      resolved[name] = setting.defaultValue;
    }
  }
  return resolved;
}

/**
 * The query core runs for one card, or `undefined` when there is none: a
 * widget whose data is not a query written from its settings, or a card whose
 * query names no collection yet.
 *
 * The declaration's query function is handed the card's resolved values, and
 * the collection it names becomes core's `collection:<slug>` source. Nothing is
 * checked here beyond that: the endpoint that runs a query validates it, as
 * the person asking, whoever wrote it.
 */
export function buildCardQuery(
  declaration: CardQueryDeclaration,
  stored: Record<string, unknown> | undefined
): WidgetQuery | undefined {
  const data = declaration.data;
  if (!isQuerySource(data)) return undefined;
  const settings = resolveCardSettings(declaration.settings, stored);
  const answer = data.query({ settings });
  // A query function written in plain JavaScript may answer anything; only an
  // object can be a query, and destructuring anything else fails unreadably.
  if (!isRecord(answer)) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage: `it answered ${answer === null ? "null" : typeof answer}, not a query`,
    });
  }
  const { collection, ...rest } = answer;
  // No query yet for a card whose collection is not chosen: the Collection
  // setting has no starting value, and a card is given one when it is placed.
  if (typeof collection !== "string" || collection.trim() === "")
    return undefined;
  return { ...rest, source: `collection:${collection}` };
}

/**
 * Whether a declaration's data is a query written from its settings.
 *
 * Its shape, `{ query: <function> }`, was checked at startup; what the
 * function returns is checked where the query runs.
 */
function isQuerySource(data: unknown): data is {
  query: (input: { settings: Record<string, unknown> }) => ContentQuery;
} {
  return isRecord(data) && typeof data.query === "function";
}
