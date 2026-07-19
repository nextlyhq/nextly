/**
 * useLocalization — admin-side access to the app's content-localization config (i18n M7).
 *
 * Reads the localization block from admin-meta (surfaced on branding). Returns a small, stable
 * surface the entry editor uses to render the language switcher and resolve per-locale metadata
 * (label, RTL). When the app has no `localization` config, `enabled` is false and callers take
 * the non-localized path.
 *
 * @module hooks/useLocalization
 */

import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

export interface LocaleMeta {
  code: string;
  label: string;
  rtl: boolean;
  fallbackLocale: string[];
}

export interface UseLocalizationResult {
  /** Whether content localization is configured for this app. */
  enabled: boolean;
  /** Configured locales (empty when disabled). */
  locales: LocaleMeta[];
  /** The default locale code (empty string when disabled). */
  defaultLocale: string;
  /** Whether fallback is on. */
  fallback: boolean;
  /** Look up a locale's metadata by code. */
  getLocale: (code: string | undefined) => LocaleMeta | undefined;
}

export function useLocalization(): UseLocalizationResult {
  const branding = useBranding();
  const cfg = branding.locales;

  return useMemo(() => {
    const locales = cfg?.locales ?? [];
    const byCode = new Map(locales.map(l => [l.code, l]));
    return {
      enabled: !!cfg && locales.length > 1,
      locales,
      defaultLocale: cfg?.defaultLocale ?? "",
      fallback: cfg?.fallback ?? true,
      getLocale: (code: string | undefined) =>
        code ? byCode.get(code) : undefined,
    };
  }, [cfg]);
}
