/**
 * The languages a read can actually be performed in.
 *
 * @module domains/i18n/configured-locales
 */

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";

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
export function configuredLocales(): ReadonlySet<string> | null {
  try {
    if (!container.has("config")) return null;
    const localization =
      container.get<NextlyServiceConfig>("config").localization;
    if (!localization) return null;
    return new Set(localization.locales.map(locale => locale.code));
  } catch {
    // A container that cannot answer leaves every localized row undecidable,
    // which each caller turns into "withheld" rather than "allowed".
    return null;
  }
}
