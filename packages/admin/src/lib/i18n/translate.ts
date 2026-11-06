/**
 * The admin's translator: one pure lookup, from a key to the string the
 * person reads in their interface language.
 *
 * The interface language is the language the admin itself speaks, its
 * buttons and messages. It is not the language of the content being edited,
 * which belongs to each document and is chosen in its editor.
 *
 * @module lib/i18n/translate
 */
import { isDevelopmentRuntime } from "@admin/lib/development-runtime";

import { en } from "./en";

/** A key of the admin's own strings. */
export type MessageKey = keyof typeof en;

/** One interface language's strings, keyed as the English catalog is. */
export type Catalog = Readonly<Partial<Record<string, string>>>;

/** Every catalog the admin has, by interface language (`"en"`, `"fr"`, ...). */
export type Catalogs = Readonly<Record<string, Catalog>>;

/** The language every other one falls back to, and whose catalog is complete. */
export const FALLBACK_INTERFACE_LANGUAGE = "en";

/** The catalogs the admin ships: English alone, for now. */
export const BUILT_IN_CATALOGS: Catalogs = {
  [FALLBACK_INTERFACE_LANGUAGE]: en,
};

/** The names of the `{name}` parameters a string asks for. */
type ParamNames<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | ParamNames<Rest>
    : never;

/**
 * The parameters a string asks for, each a string or number, as the rest of
 * a call's arguments: none for a string that asks for none.
 */
export type ParamsFor<S extends string> = [ParamNames<S>] extends [never]
  ? []
  : [params: Record<ParamNames<S>, string | number>];

/** The parameters a key's English string asks for. */
export type MessageParams<K extends MessageKey> = ParamsFor<(typeof en)[K]>;

/** A placeholder: a name of letters, digits and underscores, in braces. */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Fill each `{name}` from `params`, every time it appears. A placeholder with
 * no parameter given is left as written, so a missing value shows as itself
 * rather than as a blank the reader cannot see.
 */
function interpolate(
  text: string,
  params: Readonly<Record<string, string | number>> | undefined
): string {
  if (params === undefined) return text;
  return text.replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  );
}

/**
 * The unknown keys already warned about in this process, kept on
 * `globalThis` so every copy of this module shares them.
 */
const WARNED = Symbol.for("nextly/admin-unknown-message-keys");

function warnedKeys(): Set<string> {
  const holder = globalThis as unknown as Record<symbol, Set<string>>;
  holder[WARNED] ??= new Set();
  return holder[WARNED];
}

/**
 * The string for `key` in `interfaceLanguage`.
 *
 * In order: the language's own catalog, then English, then the key itself.
 * An unknown key is said once in development, naming it, since it is a fault
 * in the code asking; in production the key alone is shown and nothing is
 * said.
 */
export function translate(
  catalogs: Catalogs,
  interfaceLanguage: string,
  key: string,
  params?: Readonly<Record<string, string | number>>
): string {
  const text =
    catalogs[interfaceLanguage]?.[key] ??
    catalogs[FALLBACK_INTERFACE_LANGUAGE]?.[key];
  if (text === undefined) {
    const warned = warnedKeys();
    if (isDevelopmentRuntime() && !warned.has(key)) {
      warned.add(key);
      console.warn(
        `[nextly] The admin has no string for "${key}" in any catalog, so the key is shown as it is.`
      );
    }
    return key;
  }
  return interpolate(text, params);
}

/**
 * The interface language to use, from the languages a person prefers, most
 * preferred first: the first one the admin has a catalog for, matched as
 * written (`fr-CA`) and then by its language alone (`fr`), else English.
 */
export function resolveInterfaceLanguage(
  preferred: readonly string[],
  catalogs: Catalogs
): string {
  for (const language of preferred) {
    if (catalogs[language] !== undefined) return language;
    const [base] = language.split("-");
    if (base !== undefined && catalogs[base] !== undefined) return base;
  }
  return FALLBACK_INTERFACE_LANGUAGE;
}
