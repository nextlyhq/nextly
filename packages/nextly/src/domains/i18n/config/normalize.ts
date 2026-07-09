import type {
  LocaleInput,
  LocalizationConfig,
  ResolvedLocale,
  SanitizedLocalizationConfig,
} from "./types";

function normalizeLocale(input: LocaleInput): ResolvedLocale {
  if (typeof input === "string") {
    return { code: input, label: input, rtl: false, fallbackLocale: [] };
  }
  const fallbackLocale =
    input.fallbackLocale === undefined
      ? []
      : Array.isArray(input.fallbackLocale)
        ? input.fallbackLocale
        : [input.fallbackLocale];
  return {
    code: input.code,
    label: input.label ?? input.code,
    rtl: input.rtl ?? false,
    fallbackLocale,
  };
}

/**
 * Normalize a `LocalizationConfig`: expand string locales to objects, default
 * `label=code` / `rtl=false` / `fallbackLocale=[]`, and default `fallback` to `true`.
 * Pure — does not validate (see `validateLocalizationConfig`).
 */
export function normalizeLocalization(
  input: LocalizationConfig
): SanitizedLocalizationConfig {
  return {
    locales: input.locales.map(normalizeLocale),
    defaultLocale: input.defaultLocale,
    fallback: input.fallback ?? true,
  };
}
