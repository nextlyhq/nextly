/**
 * A card's settings as its widget's `load` is handed them, on the server, and
 * the one rule for a card that cannot be loaded yet: a setting with no value.
 *
 * @module domains/widgets/declaration/card-settings
 */

import { resolveWidgetSettings, type AnyWidgetSetting } from "../settings";

/** A setting as a declaration holds it, read without its compile-time types. */
interface DeclaredSetting {
  readonly type: string;
  readonly label?: string;
  readonly defaultValue?: unknown;
  readonly of?: string;
  /** A Group by setting's fallback to what its collection divides by. */
  readonly defaultFrom?: unknown;
  /** A Collection setting's titled rows. */
  readonly rows?: unknown;
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
 * Read by `resolveWidgetSettings`, the reader every stored card goes through,
 * every setting type alike, so a declared widget's values and a
 * registered one's cannot be judged two ways. That reader also hides a
 * dependent setting whose Collection setting has no value, and hands on only
 * declared names, in a record with no prototype.
 */
export function resolveCardSettings(
  settings: unknown,
  stored: Record<string, unknown> | undefined
): Record<string, unknown> {
  return resolveWidgetSettings(declaredSettingList(settings), stored);
}

/**
 * A declaration's settings as the list every reader of a definition's
 * settings takes, each named by its key: what `resolveCardSettings` reads, and
 * what core's own widgets apply to the queries they ask on the server, so the
 * two read one list.
 */
export function declaredSettingList(settings: unknown): AnyWidgetSetting[] {
  // A cast, because a declaration's settings were checked at startup by the
  // same rules (`widgetSettingsProblems`) an `AnyWidgetSetting` passes.
  return declaredSettings(settings).map(
    ([name, setting]) => ({ ...setting, name }) as AnyWidgetSetting
  );
}

/**
 * Whether a setting left unset still has a meaning core gives it, so a card
 * missing its value can be loaded: a Group by setting that takes its grouping
 * from the collection (`defaultFrom: "collection"`), and a Fields setting over
 * a Collection setting with titled rows, whose rows then show their own
 * fields. Both are definitions' vocabulary the setting builders do not write,
 * so a plugin's declaration is judged exactly as before.
 */
function meansSomethingUnset(
  setting: DeclaredSetting,
  all: readonly [string, DeclaredSetting][]
): boolean {
  if (setting.type === "groupBy") return setting.defaultFrom === "collection";
  if (setting.type !== "fields") return false;
  return all.some(
    ([name, sibling]) =>
      name === setting.of &&
      sibling.type === "collection" &&
      sibling.rows === "titled"
  );
}

/**
 * The first setting a card's `load` would be handed without a value, by its
 * name and label, or `undefined` when every one has a value.
 *
 * 🔴 `load` is not run while one is missing: its settings are typed as always
 * present, so a valid widget may read one without a check, and would throw on
 * a value that is not there. A Collection setting with no default is the usual
 * case, given its value when a card is placed from a collection's group. The
 * card asks its reader for the setting instead (`needs-setting`). A setting
 * whose unset value core gives a meaning (`meansSomethingUnset`) is not
 * missing: a load reading one applies it through core's knobs, which read it
 * as that meaning.
 */
export function unsetSetting(
  settings: unknown,
  resolved: Readonly<Record<string, unknown>>
): { name: string; label: string } | undefined {
  const declared = declaredSettings(settings);
  const missing = declared.find(
    ([name, setting]) =>
      resolved[name] === undefined && !meansSomethingUnset(setting, declared)
  );
  if (missing === undefined) return undefined;
  const [name, setting] = missing;
  return { name, label: setting.label ?? name };
}

/**
 * The slug the site uses for a collection a query names: the owner's renamed
 * one where `.rename()` moved it, and the name as written otherwise. Trimmed,
 * as a slug never carries spaces. `Object.hasOwn`, since a plugin may own a
 * collection named `constructor`.
 */
export function renamedCollection(
  collection: string,
  collections: Readonly<Record<string, string>> | undefined
): string {
  const slug = collection.trim();
  return collections !== undefined && Object.hasOwn(collections, slug)
    ? collections[slug]
    : slug;
}
