import { normalizeLocalization } from "./normalize";
import type { LocalizationConfig } from "./types";

/**
 * Validate a `LocalizationConfig`, throwing a descriptive Error on any problem:
 * non-empty locales, unique codes, `defaultLocale` ∈ codes, and every `fallbackLocale`
 * reference resolves to a real code. Called from `defineConfig` / `validateNextlyConfig`.
 */
export function validateLocalizationConfig(input: LocalizationConfig): void {
  const { locales, defaultLocale } = normalizeLocalization(input);

  if (locales.length === 0) {
    throw new Error("localization.locales must contain at least one locale.");
  }

  const codes = new Set<string>();
  for (const l of locales) {
    if (codes.has(l.code)) {
      throw new Error(
        `Duplicate locale code '${l.code}' in localization.locales.`
      );
    }
    codes.add(l.code);
  }

  if (!codes.has(defaultLocale)) {
    throw new Error(
      `localization.defaultLocale '${defaultLocale}' is not one of the configured locales.`
    );
  }

  for (const l of locales) {
    for (const fb of l.fallbackLocale) {
      if (!codes.has(fb)) {
        throw new Error(
          `Locale '${l.code}' has fallbackLocale '${fb}', which is not a configured locale.`
        );
      }
    }
  }
}
