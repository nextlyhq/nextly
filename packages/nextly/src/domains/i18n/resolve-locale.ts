import type {
  ResolvedLocale,
  SanitizedLocalizationConfig,
} from "./config/types";
import { EVERY_TRANSLATION, NO_FALLBACK } from "./locale-selector";

/** The application's default locale code. */
export function getDefaultLocale(cfg: SanitizedLocalizationConfig): string {
  return cfg.defaultLocale;
}

/** Whether `code` is one of the configured locales. */
export function isValidLocale(
  cfg: SanitizedLocalizationConfig,
  code: string
): boolean {
  return cfg.locales.some(l => l.code === code);
}

/** The locale to actually use for a request: the requested one if valid, else the default. */
export function resolveRequestedLocale(
  cfg: SanitizedLocalizationConfig,
  requested: string | undefined
): string {
  return requested && isValidLocale(cfg, requested)
    ? requested
    : cfg.defaultLocale;
}

/**
 * The ordered fallback chain for a locale: the locale itself, then its configured
 * `fallbackLocale` chain (each expanded), then the default locale. Deduplicated and
 * order-preserving. Cycles are naturally broken by the seen-set.
 */
export function resolveFallbackChain(
  cfg: SanitizedLocalizationConfig,
  code: string
): string[] {
  const byCode = new Map<string, ResolvedLocale>(
    cfg.locales.map(l => [l.code, l])
  );
  const chain: string[] = [];
  const seen = new Set<string>();
  const visit = (c: string): void => {
    if (seen.has(c)) return;
    seen.add(c);
    chain.push(c);
    const loc = byCode.get(c);
    if (loc) for (const fb of loc.fallbackLocale) visit(fb);
  };
  visit(code);
  visit(cfg.defaultLocale);
  return chain;
}

/**
 * The ordered languages a READ resolves a translatable field through, or
 * `null` when there is no single language to resolve for.
 *
 * One function rather than one per read path. A collection read, a single
 * read and a component read each ask this, and each once carried its own copy;
 * the copies agreed, and agreement is not the property that matters — a copy
 * that drifts answers a translated field differently on a single than on the
 * collection beside it, silently, because both copies still look correct.
 *
 * `null` for a caller with no localization, and for `locale=all`: that read
 * populates every locale keyed by code, which is a different shape from a
 * chain and is handled by its own path.
 *
 * Otherwise, in the order the decisions are judged:
 * - the requested locale, resolved to the default when unknown or absent;
 * - a per-request opt-out (`false` or `"none"`) is that locale alone — the
 *   admin editor asks for this so an untranslated field reads blank rather
 *   than showing the fallback as if it were a translation;
 * - a per-request NAMED fallback is the requested locale followed by that
 *   locale's own configured chain, deduped — `?locale=de&fallback-locale=en`
 *   falls back to `en`, not through `de`'s chain. Judged BEFORE the global
 *   switch, so it re-enables fallback for one read on a site that has it off;
 * - the global `fallback` switch off is the requested locale alone;
 * - else the requested locale's configured chain, ending at the default.
 */
export function resolveLocaleChain(
  cfg: SanitizedLocalizationConfig | undefined,
  locale: string | undefined,
  fallbackLocale: string | false | undefined
): string[] | null {
  if (!cfg || locale === EVERY_TRANSLATION) return null;
  const requested = resolveRequestedLocale(cfg, locale);
  if (fallbackLocale === false || fallbackLocale === NO_FALLBACK) {
    return [requested];
  }
  if (
    typeof fallbackLocale === "string" &&
    isValidLocale(cfg, fallbackLocale)
  ) {
    const seen = new Set<string>();
    return [requested, ...resolveFallbackChain(cfg, fallbackLocale)].filter(
      code => (seen.has(code) ? false : (seen.add(code), true))
    );
  }
  if (!cfg.fallback) return [requested];
  return resolveFallbackChain(cfg, requested);
}
