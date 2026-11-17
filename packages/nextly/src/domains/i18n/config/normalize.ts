import { standardLanguageCode } from "./standard-code";
import type {
  LocaleInput,
  LocalizationConfig,
  ResolvedLocale,
  SanitizedLocalizationConfig,
} from "./types";

/**
 * A configured code in its standard form: a configuration written before codes were checked
 * (`pt_BR`) is read as `pt-BR`, the code every stored row is kept under once upgraded. A code
 * that is no language tag at all is kept as written, for validation to refuse.
 */
function standardOf(code: string): string {
  return standardLanguageCode(code) ?? code;
}

function normalizeLocale(input: LocaleInput): ResolvedLocale {
  if (typeof input === "string") {
    const code = standardOf(input);
    return { code, label: code, rtl: false, fallbackLocale: [] };
  }
  const fallbackLocale =
    input.fallbackLocale === undefined
      ? []
      : // Copy the array (don't alias the caller's) so later use can't mutate user input (L19).
        Array.isArray(input.fallbackLocale)
        ? input.fallbackLocale.map(standardOf)
        : [standardOf(input.fallbackLocale)];
  const code = standardOf(input.code);
  return {
    code,
    // Treat an empty/whitespace-only label as absent so the UI falls back to the code (L19).
    label: input.label && input.label.trim() !== "" ? input.label : code,
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
    defaultLocale: standardOf(input.defaultLocale),
    fallback: input.fallback ?? true,
  };
}
