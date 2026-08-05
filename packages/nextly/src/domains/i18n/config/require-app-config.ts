/**
 * Guard for enabling entity-level localization without the app-level
 * `localization` config block.
 *
 * The two switches are independent: the Schema Builder / registry persist a
 * per-entity `localized` flag, while reads and writes resolve locales from
 * the app-level `localization` config carried on the registered services.
 * The DDL layer honors the entity flag unconditionally (main table split +
 * `_locales` companion), so enabling it in an app with no localization
 * config produces a schema the runtime cannot address — every write then
 * fails with "table X has no column named Y" because the translatable
 * values have nowhere to go. Rejecting the enable up front with an
 * actionable validation error replaces that opaque 500.
 *
 * @module domains/i18n/config/require-app-config
 */

import { container } from "../../../di/container";
import { NextlyError } from "../../../errors";

/**
 * Whether the registered service config carries a localization block.
 * Reads the DI container directly (not the dispatcher's config helper) so
 * service-layer callers don't import dispatcher modules. Unregistered DI
 * reads as "not configured" — the only paths that reach these guards are
 * booted apps and the test harness, both of which register services first.
 */
export function isAppLocalizationConfigured(): boolean {
  try {
    if (container.has("config")) {
      const config = container.get<{ localization?: unknown }>("config");
      return config.localization != null;
    }
  } catch {
    // DI not initialized.
  }
  return false;
}

/**
 * Throw a validation error when an entity's Internationalization switch is
 * being turned ON while the app has no `localization` config. Call sites
 * gate on the false→true transition only: entities that are ALREADY
 * localized keep saving (blocking edits would trap existing content), and
 * disabling is always allowed.
 */
export function assertLocalizationConfigured(
  entity: "collection" | "single" | "component",
  slug: string,
  /**
   * Whether the CALLER was handed a localization config, when it knows.
   * Services can be constructed directly with one — `CollectionsHandler`
   * takes it as a constructor argument — and such an instance is fully able
   * to serve localized entities whether or not anything was registered in
   * DI. Only when this is undefined does the container decide.
   */
  configured?: boolean
): void {
  if (configured ?? isAppLocalizationConfigured()) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "localized",
        code: "localization_not_configured",
        message:
          "Internationalization requires a `localization` block in " +
          "nextly.config (locales + defaultLocale). Add it and restart " +
          "the dev server, then enable this switch.",
      },
    ],
    logContext: { reason: "localization-not-configured", entity, slug },
  });
}
