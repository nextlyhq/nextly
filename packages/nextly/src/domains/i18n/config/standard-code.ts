/**
 * A language code in its standard form: BCP 47, as `Intl.getCanonicalLocales` writes it.
 *
 * Earlier releases accepted a code such as `pt_BR`, which BCP 47 writes `pt-BR`. The one answer
 * to "what is this code's standard form", for every place that has to agree on it: the upgrade
 * that rewrites stored rows, the configuration that is read under the standard code, and a
 * request that still names the old one.
 *
 * @module domains/i18n/config/standard-code
 */

/**
 * `code` in its standard form, or `undefined` where it is no language tag even with its
 * underscores read as hyphens. A code already standard comes back unchanged.
 */
export function standardLanguageCode(code: string): string | undefined {
  try {
    const [standard] = Intl.getCanonicalLocales(code.replace(/_/g, "-"));
    return standard;
  } catch {
    return undefined;
  }
}
