import { normalizeLocalization } from "./normalize";
import type { LocalizationConfig } from "./types";

/** A locale code: non-empty, letters/digits/`-`/`_` only (e.g. `en`, `en-US`, `zh_Hant`). */
const LOCALE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a `LocalizationConfig`, throwing a descriptive Error on any problem:
 * non-empty locales, unique codes, `defaultLocale` ∈ codes, and every `fallbackLocale`
 * reference resolves to a real code. Called from `defineConfig` / `validateNextlyConfig`.
 */
export function validateLocalizationConfig(input: LocalizationConfig): void {
  // Guard the shape BEFORE normalizing so a missing/invalid `locales` yields a descriptive
  // error rather than a "Cannot read properties of undefined (reading 'map')" TypeError (L19).
  if (!Array.isArray(input?.locales) || input.locales.length === 0) {
    throw new Error("localization.locales must contain at least one locale.");
  }

  const { locales, defaultLocale } = normalizeLocalization(input);

  if (locales.length === 0) {
    throw new Error("localization.locales must contain at least one locale.");
  }

  const codes = new Set<string>();
  // Case-insensitive view for duplicate detection so `en` / `EN` (and stray
  // whitespace variants) are caught rather than treated as distinct locales (M10).
  const seen = new Set<string>();
  for (const l of locales) {
    // Reject empty/whitespace/junk codes up front — they otherwise flow into the
    // companion `_locale` rows and the admin switcher as meaningless entries (M10).
    if (!LOCALE_CODE_PATTERN.test(l.code)) {
      throw new Error(
        `Invalid locale code '${l.code}' in localization.locales — a code must be ` +
          `non-empty and contain only letters, digits, '-' or '_' (e.g. 'en', 'en-US').`
      );
    }
    const lower = l.code.toLowerCase();
    if (seen.has(lower)) {
      throw new Error(
        `Duplicate locale code '${l.code}' in localization.locales ` +
          `(codes are compared case-insensitively).`
      );
    }
    seen.add(lower);
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
      // A locale falling back to itself is a config mistake — it does nothing (the resolver's
      // seen-set breaks the cycle) and signals confusion. Reject it explicitly (L18).
      if (fb === l.code) {
        throw new Error(
          `Locale '${l.code}' lists itself as a fallbackLocale — remove the self-reference.`
        );
      }
    }
  }
}
