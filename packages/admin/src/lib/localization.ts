/**
 * Whether a site is multilingual: its localization config names two or more
 * content locales.
 *
 * One answer for every surface that depends on it. The entry editor shows its
 * language switcher on it (`useLocalization`'s `enabled`), and the rail shows
 * the Translations entry on it: with no localization, or a single locale,
 * there is nothing to translate, and the page would list nothing.
 *
 * @module lib/localization
 */
import type { AdminBranding } from "@admin/types/branding";

/** The localization block admin-meta delivers, absent on a site without one. */
export type LocalizationConfig = AdminBranding["locales"];

export function isMultilingual(localization: LocalizationConfig): boolean {
  return (localization?.locales.length ?? 0) >= 2;
}
