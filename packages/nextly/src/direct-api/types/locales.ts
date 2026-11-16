/**
 * The site's content languages, as the generated types know them.
 *
 * `generate:types` writes the languages into the `GeneratedTypes` augmentation where the
 * configuration locks them (`locales`), exactly as configured, since a read matches the code it is
 * given against them as written. A converted old code a read still accepts for one release is
 * written beside them (`deprecatedLocales`, each naming the code to use), marked deprecated. Where
 * Settings manages the languages nothing is written, and a language is any code, checked against
 * the site's languages at run time.
 *
 * The conditionals are factored into the `...From` forms so a test can apply them to a stand-in
 * for the augmentation; the published aliases apply them to the real one.
 *
 * @module direct-api/types/locales
 */
import type {
  EVERY_LOCALE,
  EVERY_TRANSLATION,
  NO_FALLBACK,
} from "../../domains/i18n/locale-selector";

import type { GeneratedTypes } from "./shared";

/**
 * What a call accepts for every language at once: `"all"`, a read's every translation in one
 * answer, and `"*"`, a write's every language (the all-language status change). Both are in the
 * language option on every site, so code using them keeps compiling once types are generated.
 * Spelled by the constants the runtime compares against, so the types cannot name a different
 * selector than the one a call is judged by.
 */
type EveryLanguage = typeof EVERY_TRANSLATION | typeof EVERY_LOCALE;

/**
 * What a read's fallback takes for "no fallback at all": `false` in code, and `"none"`, the
 * spelling a query string can carry, which a read accepts in code too.
 */
type NoFallback = typeof NO_FALLBACK | false;

/**
 * A site's language codes: exactly those its configuration locks, or any code where Settings
 * manages them.
 *
 * @experimental
 */
export type LocaleFrom<TGenerated> = TGenerated extends {
  locales: infer Codes;
}
  ? Extract<keyof Codes, string>
  : string;

/**
 * The old codes a site's reads still accept after their conversion, none where there are none.
 *
 * @experimental
 */
export type DeprecatedLocaleFrom<TGenerated> = TGenerated extends {
  deprecatedLocales: infer Codes;
}
  ? Extract<keyof Codes, string>
  : never;

/**
 * What a read's language option takes: one of the site's languages, an old code still accepted,
 * or every language.
 *
 * @experimental
 */
export type LocaleOptionFrom<TGenerated> =
  | LocaleFrom<TGenerated>
  | DeprecatedLocaleFrom<TGenerated>
  | EveryLanguage;

/**
 * What a read's fallback language takes: one of the site's languages, an old code still accepted,
 * or no fallback at all. Not every language at once: a fallback is one language, and a selector
 * there names none.
 *
 * @experimental
 */
export type FallbackLocaleOptionFrom<TGenerated> =
  | LocaleFrom<TGenerated>
  | DeprecatedLocaleFrom<TGenerated>
  | NoFallback;

/**
 * A call's language options, for a site whose generated types are `TGenerated`. Declared once,
 * here, for any `TGenerated`, so `DirectAPIConfig` takes them for the real `GeneratedTypes` and a
 * test can ask what they are for a site that has generated types.
 *
 * @experimental
 */
export interface LanguageOptionsFrom<TGenerated> {
  /**
   * Locale for localized content.
   *
   * When set, returns content in the specified locale. One of the site's languages where
   * generated types list them, `"all"` for every translation of a read, or `"*"` for every
   * language of a write; any code otherwise, checked at run time.
   */
  locale?: LocaleOptionFrom<TGenerated>;

  /**
   * Fallback locale when requested locale data is missing: one of the site's languages.
   *
   * Set to `false`, or `"none"`, to disable fallback behavior.
   */
  fallbackLocale?: FallbackLocaleOptionFrom<TGenerated>;
}

/**
 * The site's language codes, as `generate:types` wrote them; any code without generated types.
 *
 * @experimental
 */
export type Locale = LocaleFrom<GeneratedTypes>;

/**
 * What a call's `locale` takes.
 *
 * @experimental
 */
export type LocaleOption = LocaleOptionFrom<GeneratedTypes>;

/**
 * What a read's `fallbackLocale` takes.
 *
 * @experimental
 */
export type FallbackLocaleOption = FallbackLocaleOptionFrom<GeneratedTypes>;
