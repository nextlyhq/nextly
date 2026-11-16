import type {
  DeprecatedLocaleFrom,
  FallbackLocaleOption,
  FallbackLocaleOptionFrom,
  LanguageOptionsFrom,
  Locale,
  LocaleFrom,
  LocaleOption,
  LocaleOptionFrom,
} from "./locales";
import type { DirectAPIConfig, GeneratedTypes } from "./shared";

// Compile-time half of the generated languages. In a `.test-d.ts` because the type-level
// assertions in a normal test file are transpiled away and never checked; `pnpm check-types`
// compiles this one.

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Whether `Value` is one of what `Accepted` takes. */
type Takes<Accepted, Value> = [Value] extends [Accepted] ? true : false;

declare function assertType<T extends true>(proof: T): void;

/** What `generate:types` writes for a site whose configuration locks two languages. */
interface LockedSite {
  locales: { en: true; fr: true };
}

/** A site whose configuration was written `en_US`, converted to `en-US`. */
interface UpgradedSite {
  locales: { "en-US": true; fr: true };
  deprecatedLocales: { en_US: "en-US" };
}

/** A site whose languages Settings manages: no list is generated. */
interface SettingsSite {
  collections: Record<string, never>;
}

// A locked site's languages, exactly.
assertType<Exact<LocaleFrom<LockedSite>, "en" | "fr">>(true);
assertType<Takes<LocaleOptionFrom<LockedSite>, "fr">>(true);
// Every language at once stays a read's choice on every site.
assertType<Takes<LocaleOptionFrom<LockedSite>, "all">>(true);
// And every language a write sweeps (`EVERY_LOCALE`, the all-language status change).
assertType<Takes<LocaleOptionFrom<LockedSite>, "*">>(true);
// A language the site does not have is not taken.
assertType<Exact<Takes<LocaleOptionFrom<LockedSite>, "de">, false>>(true);
// "No fallback" is a fallback's answer, not a language a call is made in.
assertType<Exact<Takes<LocaleOptionFrom<LockedSite>, "none">, false>>(true);

// A locked site's fallback: one of its languages, or no fallback, spelled either way.
assertType<Takes<FallbackLocaleOptionFrom<LockedSite>, "en">>(true);
assertType<Takes<FallbackLocaleOptionFrom<LockedSite>, "none">>(true);
assertType<Takes<FallbackLocaleOptionFrom<LockedSite>, false>>(true);
// Not a language the site does not have, and not every language at once: a fallback is one.
assertType<Exact<Takes<FallbackLocaleOptionFrom<LockedSite>, "de">, false>>(
  true
);
assertType<Exact<Takes<FallbackLocaleOptionFrom<LockedSite>, "all">, false>>(
  true
);
assertType<Exact<Takes<FallbackLocaleOptionFrom<LockedSite>, "*">, false>>(
  true
);
assertType<Exact<DeprecatedLocaleFrom<LockedSite>, never>>(true);

// An upgraded site takes the converted code and, deprecated, the code as it was written.
assertType<Exact<LocaleFrom<UpgradedSite>, "en-US" | "fr">>(true);
assertType<Exact<DeprecatedLocaleFrom<UpgradedSite>, "en_US">>(true);
assertType<Takes<LocaleOptionFrom<UpgradedSite>, "en_US">>(true);
assertType<Takes<LocaleOptionFrom<UpgradedSite>, "en-US">>(true);
assertType<Exact<Takes<LocaleOptionFrom<UpgradedSite>, "de">, false>>(true);
assertType<Takes<FallbackLocaleOptionFrom<UpgradedSite>, "en_US">>(true);

// Settings manages the languages: any code, checked against the registry at run time.
assertType<Exact<LocaleFrom<SettingsSite>, string>>(true);
assertType<Exact<LocaleOptionFrom<SettingsSite>, string>>(true);
assertType<Exact<FallbackLocaleOptionFrom<SettingsSite>, string | false>>(true);

// Unaugmented, the published aliases are open, so an app that generated nothing types as before.
assertType<Exact<Locale, string>>(true);
assertType<Exact<LocaleOption, string>>(true);
assertType<Exact<FallbackLocaleOption, string | false>>(true);

// A call's language options: `locale` the language option, `fallbackLocale` the fallback's, for
// a site with generated types (where the two differ) as for the real `GeneratedTypes`.
type LockedOptions = LanguageOptionsFrom<LockedSite>;
assertType<
  Exact<NonNullable<LockedOptions["locale"]>, LocaleOptionFrom<LockedSite>>
>(true);
assertType<
  Exact<
    NonNullable<LockedOptions["fallbackLocale"]>,
    FallbackLocaleOptionFrom<LockedSite>
  >
>(true);
assertType<Takes<NonNullable<LockedOptions["fallbackLocale"]>, "none">>(true);
assertType<Exact<NonNullable<DirectAPIConfig["locale"]>, LocaleOption>>(true);
assertType<
  Exact<NonNullable<DirectAPIConfig["fallbackLocale"]>, FallbackLocaleOption>
>(true);
// `DirectAPIConfig` takes its language options from that one declaration.
assertType<Takes<LanguageOptionsFrom<GeneratedTypes>, DirectAPIConfig>>(true);
