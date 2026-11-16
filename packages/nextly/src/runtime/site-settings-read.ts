/**
 * The site's general settings as a published page may show them: the
 * application's name, the site's address, its logo and its time zone.
 *
 * The settings row also holds what a page must never show, the
 * administrator's email address and the preview links' revocation counter
 * among it. So the public view is an allowlist: a setting reaches a page only
 * when it is named here, and a column the row gains later stays private until
 * it is.
 *
 * Nothing here writes. The time zone is the one the site sets, read as it is.
 * A write to the settings expires the tag `nextlySiteSettingsTags()` names, so
 * a page cached under it shows a new name or time zone on its next request.
 *
 * The settings belong to an instance. A page served by an instance of its own,
 * one per site in a process serving several, reads that instance's settings
 * through {@link readPublicSiteSettings}'s argument; only a read given none
 * reads the process's registered instance.
 *
 * @module runtime/site-settings-read
 */

/**
 * The settings a published page may show, under the names the settings
 * themselves use. Each is `null` while the site has not set it.
 *
 * @experimental
 */
export interface PublicSiteSettings {
  readonly applicationName: string | null;
  readonly siteUrl: string | null;
  readonly logoUrl: string | null;
  /** An IANA time zone such as `Europe/Paris`, as the site set it. */
  readonly timezone: string | null;
}

/**
 * What a site's settings are read from: a Nextly instance, which answers with
 * `publicSiteSettings()`, or a reader of one that forwards it.
 *
 * Only the allowlisted settings reach a page whatever the answer holds, so a
 * reader of one's own that answers with the whole settings record shows no
 * more than the instance's own answer does.
 *
 * @experimental
 */
export interface PublicSiteSettingsSource {
  publicSiteSettings(): Promise<PublicSiteSettings>;
}

/**
 * What the allowlist reads a setting from: a settings record, or an answer
 * already narrowed to the public settings. Each is read only by name, so any
 * other key the value carries is never looked at.
 */
type SiteSettingsFields = {
  readonly [K in keyof PublicSiteSettings]?: unknown;
};

/** A setting as text, or `null` for anything else. */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The public view of a settings record: the allowlisted settings and nothing
 * else. Named key by key rather than copied, so a setting added to the record
 * is never shown by accident; the return type holds the list and the code to
 * the same four keys.
 *
 * Takes anything holding those settings, the stored record or an instance's
 * answer, so the one allowlist also judges what a reader of one's own returns.
 */
export function publicSiteSettingsOf(
  record: SiteSettingsFields
): PublicSiteSettings {
  return Object.freeze({
    applicationName: textOrNull(record.applicationName),
    siteUrl: textOrNull(record.siteUrl),
    logoUrl: textOrNull(record.logoUrl),
    timezone: textOrNull(record.timezone),
  });
}

/**
 * The site's public settings, read from `nextly` when one is given and from
 * the process's registered instance otherwise.
 *
 * Given an instance, it reads that instance and nothing else: a process
 * serving several sites, each through an instance of its own, shows each page
 * its own site's name and time zone, and needs no instance registered for the
 * process. Given none, it reads the registered instance, booting it first as
 * `getCachedNextly` does; that boot is imported inside the call, so importing
 * `nextly/runtime` costs nothing until a page asks for the settings.
 *
 * Either way the answer passes through {@link publicSiteSettingsOf}, so the
 * one allowlist decides what a page may show.
 *
 * @experimental
 */
export async function readPublicSiteSettings(
  nextly?: PublicSiteSettingsSource
): Promise<PublicSiteSettings> {
  const source = nextly ?? (await (await import("../init")).getCachedNextly());
  return publicSiteSettingsOf(await source.publicSiteSettings());
}
