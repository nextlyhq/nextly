import type {
  ResolvedLocale,
  SanitizedLocalizationConfig,
} from "./config/types";

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
