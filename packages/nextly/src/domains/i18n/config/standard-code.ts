/**
 * A language code in its standard form: a BCP 47 tag, as `Intl.getCanonicalLocales` writes one.
 *
 * Earlier releases accepted a code such as `pt_BR`, which BCP 47 writes `pt-BR`. The one answer
 * to "what is this code's standard form", for every place that has to agree on it: the upgrade
 * that rewrites stored rows, the configuration that is read under the standard code, and a
 * request that still names the old one.
 *
 * @module domains/i18n/config/standard-code
 */

/** Whether `code` is a BCP 47 language tag as written. */
function isLanguageTag(code: string): boolean {
  try {
    Intl.getCanonicalLocales(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * `code` in its standard form, or `undefined` where it is no language tag even with its
 * underscores read as hyphens. A code that is already a BCP 47 tag comes back as written: only a
 * code BCP 47 does not accept (`pt_BR`) is converted, so a tag a site already stores, such as a
 * region alias the canonical form would rewrite, keeps naming the rows it names.
 */
export function standardLanguageCode(code: string): string | undefined {
  if (isLanguageTag(code)) return code;
  try {
    const [standard] = Intl.getCanonicalLocales(code.replace(/_/g, "-"));
    return standard;
  } catch {
    return undefined;
  }
}
