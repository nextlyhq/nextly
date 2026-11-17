/**
 * The site settings a page may bind, each with its field type: the one table
 * the renderer, the save's binding check and the report of bindings to fix
 * all judge a site binding by, so a binding to a setting a page is never
 * handed is refused at save as the renderer falls it back.
 *
 * Only these: the settings also hold values no visitor may see, such as the
 * administrator's address, so a page is handed this allowlist and nothing
 * else.
 *
 * @module site-setting-fields
 */
import type { BindingFieldShape } from "./binding-rules";

/**
 * The type of each site setting a page may bind, keyed by the setting.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const SITE_SETTING_FIELD_TYPES = {
  applicationName: "text",
  siteUrl: "url",
  logoUrl: "url",
  timezone: "text",
} as const;

/** A site setting a page may bind. */
export type SiteSettingName = keyof typeof SITE_SETTING_FIELD_TYPES;

/**
 * The values the site source works out when a page is drawn, beside the
 * stored settings: read-only, kept nowhere, and the same for every visitor.
 *
 * `currentYear` is the year in the site's time zone, as text ("2026"), so a
 * copyright line shows it as written rather than formatted as a number. A
 * cached page shows a new year from its next render.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const SITE_COMPUTED_FIELD_TYPES = {
  currentYear: "text",
} as const;

/** A value the site source works out when a page is drawn. */
export type SiteComputedName = keyof typeof SITE_COMPUTED_FIELD_TYPES;

/** Anything a site binding may name: a stored setting or a worked-out value. */
export type SiteValueName = SiteSettingName | SiteComputedName;

/**
 * The shapes of everything a site binding may name, derived from the two
 * tables above: the one list the save, the renderer and the picker judge a
 * site binding by.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const SITE_SETTING_FIELD_SHAPES: readonly BindingFieldShape[] =
  Object.entries({
    ...SITE_SETTING_FIELD_TYPES,
    ...SITE_COMPUTED_FIELD_TYPES,
  }).map(([name, type]) => ({ name, type }));

/**
 * The worked-out site values at `now`, in `timeZone` (an IANA zone the
 * caller has already checked; UTC when it is not one the runtime knows).
 *
 * @experimental Settles with the editor's binding controls.
 */
export function siteComputedValues(
  now: Date,
  timeZone: string
): { readonly [K in SiteComputedName]: string } {
  return { currentYear: yearIn(now, timeZone) };
}

/** The year `now` falls in, in `timeZone`, as four digits. */
function yearIn(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone,
    }).format(now);
  } catch {
    return String(now.getUTCFullYear());
  }
}

/**
 * What each site value a page may bind is called where an author picks or
 * reads one in the page builder, in words: "Site URL", not the key's "site
 * url".
 *
 * @experimental Settles with the editor's binding controls.
 */
export const SITE_SETTING_LABELS: { readonly [K in SiteValueName]: string } = {
  applicationName: "Application name",
  siteUrl: "Site URL",
  logoUrl: "Logo URL",
  timezone: "Time zone",
  currentYear: "Current year",
};
