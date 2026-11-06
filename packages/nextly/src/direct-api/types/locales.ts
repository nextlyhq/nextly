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
import type { GeneratedTypes } from "./shared";

/**
 * What a call accepts for every language at once: `"all"`, a read's "the default language, all
 * languages included", and `"*"`, a write's every language at once (the all-language status
 * change). Both are in the language option on every site, so code using them keeps compiling
 * once types are generated.
 */
type EveryLanguage = "all" | "*";

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
 * The site's language codes, as `generate:types` wrote them; any code without generated types.
 *
 * @experimental
 */
export type Locale = LocaleFrom<GeneratedTypes>;

/**
 * What a read's `locale` and `fallbackLocale` take.
 *
 * @experimental
 */
export type LocaleOption = LocaleOptionFrom<GeneratedTypes>;
