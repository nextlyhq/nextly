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
 * @module runtime/site-settings-read
 */
import type { GeneralSettingsRecord } from "../schemas/site-settings/types";

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

/** A setting as text, or `null` for anything else. */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The public view of a settings record: the allowlisted settings and nothing
 * else. Named key by key rather than copied, so a setting added to the record
 * is never shown by accident; the return type holds the list and the code to
 * the same four keys.
 */
export function publicSiteSettingsOf(
  record: GeneralSettingsRecord
): PublicSiteSettings {
  return Object.freeze({
    applicationName: textOrNull(record.applicationName),
    siteUrl: textOrNull(record.siteUrl),
    logoUrl: textOrNull(record.logoUrl),
    timezone: textOrNull(record.timezone),
  });
}

/**
 * The site's public settings, read from the running instance.
 *
 * The service container and the boot are imported inside the call, so
 * importing `nextly/runtime` costs neither until a page asks for the
 * settings. Like `requireNextly`, this reads the process's registered
 * instance.
 *
 * @experimental
 */
export async function readPublicSiteSettings(): Promise<PublicSiteSettings> {
  const [{ getCachedNextly }, { getService }] = await Promise.all([
    import("../init"),
    import("../di/service-access"),
  ]);
  await getCachedNextly();
  const settings = await getService("generalSettingsService").getSettings();
  return publicSiteSettingsOf(settings);
}
