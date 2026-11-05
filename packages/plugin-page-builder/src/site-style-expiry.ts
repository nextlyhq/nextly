/**
 * Expire the cached reads of the site style when something it answers with
 * changes outside the Site Style Single.
 *
 * A published route that reads the site style names the Single among the
 * reads it depends on, so its cached render carries the Single's tag and a
 * write to the Single expires it. The spacing model is kept beside the Single,
 * in the plugin's own table, and its writes go through no Single service, so
 * nothing would expire that tag: a page cached before the model changed would
 * go on being served under the old one. Each write of the model expires the
 * Single's tag itself, through the same Next.js revalidator the core's own
 * writes use, so a write outside a request (the step at start, a job) waits
 * for a request exactly as theirs do.
 *
 * Imported at call time, because this module is reached from the package root,
 * which a browser bundle imports, and `nextly/runtime` pulls in the request
 * lifecycle.
 *
 * @module site-style-expiry
 */

/** Expire the cached reads tagged with the Site Style Single `slug`. */
export type SiteStyleExpiry = (slug: string) => Promise<void>;

/**
 * Expire the Single's tag, best effort: the write that called this is
 * committed, so a failure is reported through `warn` and never thrown.
 */
export function siteStyleExpiry(
  warn: (message: string, meta?: Record<string, unknown>) => void
): SiteStyleExpiry {
  return async slug => {
    try {
      const { NextCacheRevalidator, nextlySingleTags } = await import(
        "nextly/runtime"
      );
      await new NextCacheRevalidator().flush([
        { tags: nextlySingleTags(slug) },
      ]);
    } catch (error) {
      warn(
        "[page-builder] the cached pages could not be expired after the spacing model changed",
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  };
}
