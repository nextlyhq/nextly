/**
 * The languages a read can actually be performed in.
 *
 * @module domains/i18n/configured-locales
 */

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";

import type { SanitizedLocalizationConfig } from "./config/types";
import type { LanguageRegistry } from "./language-registry";

/**
 * The configured locale codes, or `null` when the install configures none.
 *
 * 🔴 Needed because forwarding an unconfigured locale does NOT authorize it:
 * `resolveRequestedLocale` substitutes the configured DEFAULT for any code it
 * does not recognise. A row written under a language later removed from the
 * configuration would be judged by the default language's verdict — a row
 * exposed on a predicate never evaluated for it, which is the same defect as
 * passing no locale at all.
 */
/**
 * The site's languages as they are now: the language registry's answer once services are
 * registered, so a list changed in Settings counts; the registered configuration's block for a
 * boot that registered no registry. Undefined where localization is off or nothing is registered.
 *
 * @throws whatever the container throws when it cannot answer, which callers decide about
 */
export function appLocalization(): SanitizedLocalizationConfig | undefined {
  if (container.has("languageRegistry")) {
    return container.get<LanguageRegistry>("languageRegistry").current();
  }
  if (!container.has("config")) return undefined;
  return container.get<NextlyServiceConfig>("config").localization;
}

export function configuredLocales(): ReadonlySet<string> | null {
  try {
    const localization = appLocalization();
    if (!localization) return null;
    return new Set(localization.locales.map(locale => locale.code));
  } catch {
    // A container that cannot answer leaves every localized row undecidable,
    // which each caller turns into "withheld" rather than "allowed".
    return null;
  }
}

/**
 * Runs one request with one language list from start to end: the registry is brought up to date
 * (at most one fingerprint read per interval) and the list it then holds is the one every read
 * inside `operation` sees, so a language added meanwhile reaches the next request rather than the
 * second half of this one. Before services are registered there is no registry, and the request
 * runs as it is.
 */
export async function withCurrentLanguages<T>(
  operation: () => Promise<T>
): Promise<T> {
  if (!container.has("languageRegistry")) return operation();
  const registry = container.get<LanguageRegistry>("languageRegistry");
  await registry.refresh();
  return registry.runWithSnapshot(operation);
}
