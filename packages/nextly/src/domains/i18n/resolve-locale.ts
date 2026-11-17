import { standardLanguageCode } from "./config/standard-code";
import type {
  ResolvedLocale,
  SanitizedLocalizationConfig,
} from "./config/types";
import { EVERY_TRANSLATION, NO_FALLBACK } from "./locale-selector";

/** The application's default locale code. */
export function getDefaultLocale(cfg: SanitizedLocalizationConfig): string {
  return cfg.defaultLocale;
}

/**
 * The configured code `code` names: itself, or, for one release, the configured code an older
 * spelling of it becomes in standard form (`pt_BR` for a site configuring `pt-BR`), which earlier
 * releases accepted. Undefined where it names no configured language.
 * The older spelling is accepted for one release; a caller answering over HTTP says so with a
 * deprecation header (`requestedCodeAlias`).
 */
export function configuredCodeOf(
  cfg: SanitizedLocalizationConfig,
  code: string
): string | undefined {
  if (cfg.locales.some(l => l.code === code)) return code;
  const standard = standardLanguageCode(code);
  return standard !== undefined && cfg.locales.some(l => l.code === standard)
    ? standard
    : undefined;
}

/**
 * Where a request named a configured language by its older spelling: the old code and the one it
 * is read as, for the deprecation a response reports. Undefined for any other request.
 */
export function requestedCodeAlias(
  cfg: SanitizedLocalizationConfig,
  code: string | undefined
): { requested: string; standard: string } | undefined {
  if (code === undefined) return undefined;
  const configured = configuredCodeOf(cfg, code);
  return configured !== undefined && configured !== code
    ? { requested: code, standard: configured }
    : undefined;
}

/** Whether `code` names one of the configured locales, an older spelling of one included. */
export function isValidLocale(
  cfg: SanitizedLocalizationConfig,
  code: string
): boolean {
  return configuredCodeOf(cfg, code) !== undefined;
}

/**
 * The locale to actually use for a request: the configured code the requested one names, else
 * the default. An older spelling of a configured code comes back as the configured code.
 */
export function resolveRequestedLocale(
  cfg: SanitizedLocalizationConfig,
  requested: string | undefined
): string {
  return (
    (requested === undefined ? undefined : configuredCodeOf(cfg, requested)) ??
    cfg.defaultLocale
  );
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
