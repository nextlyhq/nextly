/**
 * Addresses bots ask every site for, looking for the admin pages, config
 * files and scripts of other systems: `/wp-login.php`, `/.env`, `/.git/...`.
 * Nobody follows a link to them, so they are left out of the not-found log,
 * as it is written and as it is listed, rather than buried among the
 * addresses worth a redirect.
 *
 * Kept apart from `notAPageAddress`, which is the Proxy's rule for which
 * requests are pages at all: a redirect from one of these addresses may
 * still be saved and served.
 *
 * @module not-found/probes
 */

/** Path segments that only another system's admin, config or scripts have. */
const PROBE_SEGMENTS = new Set([
  "wp-login.php",
  "wp-admin",
  "wp-content",
  "wp-includes",
  "wp-json",
  "xmlrpc.php",
  "wp-config.php",
  "phpmyadmin",
  "pma",
  "myadmin",
  "cgi-bin",
  ".env",
  ".git",
  ".svn",
  ".hg",
  ".aws",
  ".ssh",
  ".ds_store",
  "phpinfo.php",
]);

/** File names ending one of these are another system's config, never a page. */
const PROBE_ENDINGS = [".env", ".sql", ".bak", ".ini", ".yml", ".yaml"];

/**
 * Whether `path` is an address bots probe for rather than one a person
 * followed a link to: any of its segments, case aside, is one only another
 * system has.
 */
export function isBotProbe(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  return segments.some(
    segment =>
      PROBE_SEGMENTS.has(segment) ||
      (segment.includes(".") &&
        PROBE_ENDINGS.some(ending => segment.endsWith(ending)))
  );
}
