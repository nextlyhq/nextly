/**
 * Content-localization config types.
 *
 * @module domains/i18n/config/types
 */

/** A locale as authored in config — a bare code or a full object. */
export type LocaleInput =
  | string
  | {
      code: string;
      label?: string;
      /** right-to-left content rendering for this locale's field inputs. */
      rtl?: boolean;
      /** a single fallback code or an ordered chain. */
      fallbackLocale?: string | string[];
    };

/** The user-facing localization config block on `NextlyConfig`. */
export interface LocalizationConfig {
  locales: LocaleInput[];
  defaultLocale: string;
  /** fall back to another locale's value when a field is untranslated. Default `true`. */
  fallback?: boolean;
}

/** A locale after normalization — all fields present, `fallbackLocale` an array. */
export interface ResolvedLocale {
  code: string;
  label: string;
  rtl: boolean;
  fallbackLocale: string[];
}

/** Normalized localization config stored on `SanitizedNextlyConfig`. */
export interface SanitizedLocalizationConfig {
  locales: ResolvedLocale[];
  defaultLocale: string;
  fallback: boolean;
  /**
   * Each configured code written before codes were checked (`pt_BR`), with the standard code it
   * is read as (`pt-BR`): what the start warns about, and refuses while stored rows still hold the
   * older spelling. Absent where the configuration writes every code in standard form.
   */
  olderCodes?: readonly { from: string; to: string }[];
}

/**
 * @experimental How each language's address is formed.
 *
 * - `prefix`: under the language's code, `/de/about`. The default language is
 *   prefixed too unless `defaultLanguage` is `"unprefixed"`.
 * - `domain`: the same path on the language's own origin, one per language.
 *
 * A site with several languages that declares none is read as `prefix`, every
 * language prefixed: what a `[locale]` route serves as it stands.
 */
export type LanguageAddressRule =
  | { by: "prefix"; defaultLanguage?: "prefixed" | "unprefixed" }
  | { by: "domain"; domains: Readonly<Record<string, string>> };
