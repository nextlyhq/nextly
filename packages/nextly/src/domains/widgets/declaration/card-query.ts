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
 * The query core runs for one card, or `undefined` when there is none yet: a
 * widget whose data is not a query written from its settings, or a card with
 * a setting that has no value (a Collection setting is given one when a card
 * is placed).
 *
 * The query function is not run until every setting it is handed has a value:
 * its settings are typed as always present, so a valid widget may read one
 * without a check, and would throw on a value that is not there.
 *
 * The collection it names becomes core's `collection:<slug>` source, through
 * `collections` when the owner's collection was renamed. An answer that is not
 * a query is refused here, naming why; whether the query can run is checked
 * by the endpoint that runs it, as the person asking.
 */
export function buildCardQuery(
  declaration: CardQueryDeclaration,
  stored: Record<string, unknown> | undefined,
  collections?: Readonly<Record<string, string>>
): WidgetQuery | undefined {
  const data = declaration.data;
  if (!isQuerySource(data)) return undefined;
  const settings = resolveCardSettings(declaration.settings, stored);
  const unset = declaredSettings(declaration.settings).some(
    ([name]) => settings[name] === undefined
  );
  if (unset) return undefined;
  const { collection, ...rest } = queryAnswer(data.query({ settings }));
  return { ...rest, source: `collection:${renamed(collection, collections)}` };
}

/** A refusal of what a query function answered, naming why. */
const notAQuery = (reason: string): NextlyError =>
  new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage: reason,
  });

/**
 * What a query function answered, once it is known to be a query naming its
 * collection. A function written in plain JavaScript may answer anything:
 * `null`, which fails to destructure unreadably, or a promise, which has no
 * collection and would otherwise look like a card not yet placed.
 */
function queryAnswer(answer: unknown): ContentQuery & { collection: string } {
  if (!isRecord(answer)) {
    throw notAQuery(
      `it answered ${answer === null ? "null" : typeof answer}, not a query`
    );
  }
  if (typeof answer.then === "function") {
    throw notAQuery(
      "it answered a promise: a query function returns its query, and is not async"
    );
  }
  const { collection } = answer;
  if (typeof collection !== "string" || collection.trim() === "") {
    throw notAQuery("it named no collection, though every setting has a value");
  }
  // Checked as far as this module reads it; the rest is the query endpoint's.
  return answer as ContentQuery & { collection: string };
}

/**
 * The slug the site uses for a collection a query names: the owner's renamed
 * one where `.rename()` moved it, and the name as written otherwise. Trimmed,
 * as a slug never carries spaces. `Object.hasOwn`, since a plugin may own a
 * collection named `constructor`.
 */
function renamed(
  collection: string,
  collections: Readonly<Record<string, string>> | undefined
): string {
  const slug = collection.trim();
  return collections !== undefined && Object.hasOwn(collections, slug)
    ? collections[slug]
    : slug;
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
